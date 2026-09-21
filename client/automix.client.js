// client/automix.client.js
// Self-evolving smart automixer for the music_video page.
//
// While enabled, periodically synthesizes a fresh fx_state preset by:
//   1. Mapping the live audio features (bass/mid/treb/beat/rms/centroid/
//      onset/bpm) into the same 2D (warmth, intensity) space as
//      SWR_ANCHOR_MAP.
//   2. (Phase 2) Filtering the anchor pool by the current song section
//      (intro/verse/chorus/etc) so chorus pulls a different blend than
//      breakdown.
//   3. Looking up the N nearest anchor presets.
//   4. Returning a weighted blend of those anchors' fx_state values.
//   5. (Phase 1.3) Applying beat-phased mutation drift on every detected
//      downbeat so the visual evolves instead of locking.
//   6. (Phase 3) Stuck detection + anti-pattern injection on flat audio.
//
// The page consumes the blended fx_state via window.SWR._fxOverride;
// the GLSL render loop reads each frame and blends it on top of the
// static page preset.
//
// (Phase 1.2) The render loop interpolates from the previous override
// toward the new one with a smoothstep ramp over `RAMP_MS` so blends
// evolve continuously instead of snapping.
//
// Pure (no DOM, no audio reads outside the passed-in `features`
// argument) so it can be unit-tested under Node without a browser.

(function () {
  'use strict';
  if (window.SWR_AUTOMIX) return;

  // ---- Constants ---------------------------------------------------------
  // Tunable knobs. Exported for tests + diagnostics.
  var FIELDS = ['temp','mut','sepia','chroma','grain','glow','grayscale','posterize'];
  // Tick-interval bounds (Phase 1.1): active sections → fast ticks,
  // quiet sections → slow ticks. Linear between, intensity ∈ [0,1].
  var TICK_INTERVAL_MIN_MS = 500;
  var TICK_INTERVAL_MAX_MS = 3000;
  // Blend ramp duration (Phase 1.2): when the target moves, the render
  // loop smoothsteps from the previous to the new value over this many ms.
  var RAMP_MS = 1000;
  // Drift amplitudes (Phase 3.1): baseline doubled from the v1 numbers;
  // beat-scaled still 3× the baseline.
  var DRIFT_BASE = 0.01;
  var DRIFT_BEAT_BONUS = 0.02;   // beat=1 → amplitude = 0.01 + 0.02 = 0.03
  // Stuck-detection thresholds (Phase 3.2).
  var STUCK_EPSILON = 0.05;       // Euclidean in fx_state 8-space
  var STUCK_DURATION_MS = 12000;  // must be stuck this long to fire
  var STUCK_HOP_COUNT = 3;        // scene change hops this far away
  // Anti-pattern thresholds (Phase 3.3): flat centroid variance.
  var FLAT_CENTROID_VAR = 0.05;
  var FLAT_DURATION_MS = 16000;   // 8 bars at 120 BPM ≈ 16s
  var ANTI_PATTERN_INTERVAL_MS = 8000;
  // Per-section anchor pool biases (Phase 2.2). Confidence < 0.5 → 'verse'.
  var POOL_BIAS = {
    intro:     { warmth: [0.4, 0.6], intensity: [0.0, 0.4] },
    verse:     { warmth: [0.3, 0.7], intensity: [0.3, 0.6] },
    prechorus: { warmth: [0.4, 0.7], intensity: [0.5, 0.8] },
    chorus:    { warmth: [0.2, 0.8], intensity: [0.6, 1.0] },
    breakdown: { warmth: [0.5, 0.9], intensity: [0.0, 0.3] },
    outro:     { warmth: [0.3, 0.6], intensity: [0.2, 0.5] },
  };
  // Section-change hysteresis (Phase 2.5): section must be stable for
  // this many consecutive ticks before we accept it.
  var SECTION_HYSTERESIS_TICKS = 2;

  // ---- Math helpers (Phase 1.2) -----------------------------------------
  function smoothstep(t) {
    if (t <= 0) return 0;
    if (t >= 1) return 1;
    return t * t * (3 - 2 * t);
  }
  function lerpPreset(from, to, t) {
    if (!from) return to;
    if (!to) return from;
    var out = {};
    for (var i = 0; i < FIELDS.length; i++) {
      var f = FIELDS[i];
      var a = (typeof from[f] === 'number') ? from[f] : 0;
      var b = (typeof to[f] === 'number') ? to[f] : 0;
      out[f] = a + (b - a) * t;
    }
    return out;
  }
  // Euclidean distance in 8-space. Used for stuck detection.
  function presetDistance(a, b) {
    if (!a || !b) return Infinity;
    var sum = 0;
    for (var i = 0; i < FIELDS.length; i++) {
      var f = FIELDS[i];
      var x = (a[f] || 0) - (b[f] || 0);
      sum += x * x;
    }
    return Math.sqrt(sum);
  }

  // ---- Adaptive tick interval (Phase 1.1) --------------------------------
  // intensity = clamp(rms*1.5 + onset*0.8, 0, 1) → ms linearly between
  // MAX and MIN. Quiet → 3000ms, active → 500ms.
  function computeTickInterval(features) {
    var f = features || {};
    var rms = (typeof f.rms === 'number') ? f.rms : 0;
    var onset = (typeof f.onset === 'number') ? f.onset : 0;
    var intensity = Math.max(0, Math.min(1, rms * 1.5 + onset * 0.8));
    return Math.round(TICK_INTERVAL_MAX_MS - intensity * (TICK_INTERVAL_MAX_MS - TICK_INTERVAL_MIN_MS));
  }

  // ---- Anchor read --------------------------------------------------------
  // We re-read SWR_ANCHOR_MAP.neighbours() each tick so the map stays
  // in sync if the page loads more presets in the future. No caching.
  function nearestAnchors(coords, n, options) {
    if (!window.SWR_ANCHOR_MAP || !window.SWR_ANCHOR_MAP.neighbours) return [];
    // Phase 2.2: optional section-bias filtering.
    if (options && options.section && POOL_BIAS[options.section]) {
      var bias = POOL_BIAS[options.section];
      // Ask the map for more neighbours than we need, then filter.
      var expanded = window.SWR_ANCHOR_MAP.neighbours(coords, Math.max(n * 4, 16));
      var filtered = [];
      for (var i = 0; i < expanded.length; i++) {
        var a = expanded[i];
        // Need the anchor's coords; the map returns { id, dist, anchor }
        var w = (a.anchor && typeof a.anchor.warmth === 'number') ? a.anchor.warmth : null;
        var inten = (a.anchor && typeof a.anchor.intensity === 'number') ? a.anchor.intensity : null;
        if (w === null || inten === null) continue;
        if (w >= bias.warmth[0] && w <= bias.warmth[1] &&
            inten >= bias.intensity[0] && inten <= bias.intensity[1]) {
          filtered.push(a);
        }
      }
      // If filtering leaves us with < 2 candidates, fall back to unfiltered.
      if (filtered.length >= 2) return filtered.slice(0, n);
    }
    return window.SWR_ANCHOR_MAP.neighbours(coords, n);
  }

  // ---- Feature → coords ---------------------------------------------------
  // Maps the live audio bands into (warmth, intensity). Delegates to
  // client/anchor-embed.js (single source of truth) so the gradient panel
  // and the automix blend always land at the same coordinates for the
  // same features. Falls back to a local implementation if anchor-embed.js
  // failed to load (load-order bug).
  //
  // Phase 2.3: pass `centroid`/`onset`/`rms` through featuresToCoordsV2 for
  // a richer embedding. Falls back to v1 if those fields are absent so
  // existing callers stay green.
  function featuresToCoords(features) {
    if (window.SWR_ANCHOR_EMBED && window.SWR_ANCHOR_EMBED.featuresToCoords) {
      return window.SWR_ANCHOR_EMBED.featuresToCoords(features);
    }
    if (!features) return { warmth: 0.5, intensity: 0.5 };
    var bass = (features.bass || 0);
    var mid  = (features.mid  || 0);
    var treb = (features.treb || 0);
    var warmth = Math.max(0, Math.min(1, 0.5 + (bass - treb) * 0.5));
    var intensity = Math.min(1, (mid + treb) * 0.9 + bass * 0.1);
    return { warmth: warmth, intensity: intensity };
  }
  function featuresToCoordsV2(features) {
    if (!features) return { warmth: 0.5, intensity: 0.5 };
    var bass = features.bass || 0;
    var mid  = features.mid  || 0;
    var treb = features.treb || 0;
    var centroid = (typeof features.centroid === 'number') ? features.centroid : 0;
    var rms = (typeof features.rms === 'number') ? features.rms : 0;
    // Richer embedding: warmth now also leans on spectral centroid
    // (bright tracks lean cooler than bass alone would suggest).
    var warmth = Math.max(0, Math.min(1, 0.5 + (bass - treb) * 0.4 + centroid * 0.2));
    // Intensity combines mid + treble + a small RMS floor (always some
    // motion even on quiet songs).
    var intensity = Math.max(0, Math.min(1, mid * 0.6 + treb * 0.3 + rms * 0.2));
    return { warmth: warmth, intensity: intensity };
  }

  // ---- Weighted blend of anchor fx_state ----------------------------------
  // weights ∝ 1 / (dist + ε) so closer anchors dominate. Output
  // preserves the schema of anchor.preset (8 fields).
  function blendAnchors(anchors) {
    if (!anchors || !anchors.length) return null;
    var eps = 1e-3;
    var out = {};
    for (var i = 0; i < FIELDS.length; i++) {
      var f = FIELDS[i];
      var wsum = 0, vsum = 0;
      for (var j = 0; j < anchors.length; j++) {
        var a = anchors[j];
        var w = 1 / (a.dist + eps);
        wsum += w;
        vsum += (a.anchor.preset[f] || 0) * w;
      }
      out[f] = vsum / wsum;
    }
    return out;
  }

  // ---- Mutation drift (Phase 1.3 + 3.1) -----------------------------------
  // Tiny bounded random walk on the blended values. Phase 1.3: callers
  // invoke drift() on every detected beat rather than every tick; the
  // beat-phase step is then visual-evolution that breathes with the
  // song's tempo. Amplitude scales linearly with beat:
  //   beat = 0   → step ±DRIFT_BASE         (gentle, no rhythmic anchor)
  //   beat = 1   → step ±(DRIFT_BASE + DRIFT_BEAT_BONUS)  (visual breathes with tempo)
  //   beat undefined / omitted → step ±DRIFT_BASE  (backward-compat default)
  // Each field is clamped to [-1, 1] so the visual stays in its safe range.
  // Amplitudes are closure-private vars that the runtime config-loader
  // mutates via _setDriftAmplitude() (per Task 1 fix round 1).
  function drift(preset, beat) {
    if (!preset) return preset;
    var b = (typeof beat === 'number' && isFinite(beat)) ? Math.max(0, Math.min(1, beat)) : 0;
    var amplitude = DRIFT_BASE + DRIFT_BEAT_BONUS * b;
    var out = {};
    for (var k in preset) {
      if (!Object.prototype.hasOwnProperty.call(preset, k)) continue;
      var delta = (Math.random() - 0.5) * 2 * amplitude;
      out[k] = Math.max(-1, Math.min(1, preset[k] + delta));
    }
    return out;
  }
  // Mutator for the closure-private drift amplitudes. Replaces the
  // constants in place so subsequent drift() calls honour the override
  // (no per-tick compounding in callers). Used by the runtime
  // config-loader to apply per-variant `driftAmplitude` overrides.
  // Bad inputs (NaN, non-number) are silently ignored to keep the
  // public setter safe to call from untrusted configs.
  function _setDriftAmplitude(base, beatScale) {
    if (typeof base !== 'number' || !isFinite(base)) return;
    if (typeof beatScale !== 'number' || !isFinite(beatScale)) return;
    DRIFT_BASE = Math.max(0, Math.min(1, base));
    DRIFT_BEAT_BONUS = Math.max(0, Math.min(1, beatScale));
  }
  // Read accessor — returns the CURRENT closure-private values (the
  // by-value `DRIFT_BASE` / `DRIFT_BEAT_BONUS` exports below are
  // converted to live getters at IIFE time, so reading them yields the
  // current values too — but tests prefer this object form for clarity).
  function _getDriftAmplitude() {
    return { base: DRIFT_BASE, beatScale: DRIFT_BEAT_BONUS };
  }

  // Mutator for the closure-private tick-interval bounds. Replaces
  // TICK_INTERVAL_MIN_MS / TICK_INTERVAL_MAX_MS in place so subsequent
  // computeTickInterval() calls honour the override (no per-tick
  // compounding in callers). Mirrors the _setDriftAmplitude shape.
  // Bad inputs (NaN, non-number, min > max) are silently ignored so
  // the public setter is safe to call from untrusted configs. Values
  // are clamped to [1, 10000] ms (matching the runtime's
  // _validateTuning contract) and rounded to integers so the
  // computeTickInterval() return value stays predictable.
  function _setTuning(minTickMs, maxTickMs) {
    if (typeof minTickMs !== 'number' || !isFinite(minTickMs)) return;
    if (typeof maxTickMs !== 'number' || !isFinite(maxTickMs)) return;
    var mn = Math.max(1, Math.min(10000, Math.round(minTickMs)));
    var mx = Math.max(1, Math.min(10000, Math.round(maxTickMs)));
    if (mn > mx) return; // invalid range; ignore
    TICK_INTERVAL_MIN_MS = mn;
    TICK_INTERVAL_MAX_MS = mx;
  }
  // Read accessor — returns the CURRENT closure-private bounds.
  function _getTuning() {
    return { minTickMs: TICK_INTERVAL_MIN_MS, maxTickMs: TICK_INTERVAL_MAX_MS };
  }

  // ---- Section classification (Phase 2.1) --------------------------------
  // Reads from window.SWR_SECTION.detect if available, otherwise returns
  // a static 'verse' fallback so the rest of the pipeline keeps working.
  // Phase 2.5: hysteresis — same section must persist for N ticks before
  // we accept the change. `sectionState` is shared mutable state held by
  // the orchestrator via the returned tickSection() helper.
  function tickSection(features, state) {
    state = state || { current: 'verse', pending: null, pendingCount: 0 };
    if (!window.SWR_SECTION || typeof window.SWR_SECTION.detect !== 'function') {
      state.current = 'verse';
      return state;
    }
    var result = window.SWR_SECTION.detect(features || {});
    var detected = (result && result.section) || 'verse';
    var confidence = (result && typeof result.confidence === 'number') ? result.confidence : 0;
    if (confidence < 0.5) detected = state.current; // hold
    if (detected === state.current) {
      state.pending = null;
      state.pendingCount = 0;
      return state;
    }
    if (detected === state.pending) {
      state.pendingCount += 1;
    } else {
      state.pending = detected;
      state.pendingCount = 1;
    }
    if (state.pendingCount >= SECTION_HYSTERESIS_TICKS) {
      state.current = detected;
      state.pending = null;
      state.pendingCount = 0;
    }
    return state;
  }

  // ---- Stuck detection + anti-pattern (Phase 3) ---------------------------
  function isStuck(prevPreset, currPreset, sinceMs) {
    if (!prevPreset || !currPreset) return false;
    if (presetDistance(prevPreset, currPreset) < STUCK_EPSILON && sinceMs >= STUCK_DURATION_MS) {
      return true;
    }
    return false;
  }
  function isFlatAudio(features, sinceMs) {
    if (!features) return false;
    // We don't track centroid variance here directly; we trust the
    // caller's precomputed variance. Default behaviour: if `centroidVar`
    // is provided and the elapsed time crosses the threshold, fire.
    if (typeof features.centroidVar === 'number' &&
        features.centroidVar < FLAT_CENTROID_VAR &&
        sinceMs >= FLAT_DURATION_MS) {
      return true;
    }
    return false;
  }

  // ---- Public API ---------------------------------------------------------
  // mix(features, neighbours, options) → { coords, anchors, preset, section }
  // features: from Audio.feat (bass/mid/treb/beat/rms/centroid/onset/bpm).
  //   beat is optional (used to scale the drift amplitude).
  // neighbours: int, default HologramState.neighbours || 4.
  // options: { section } (Phase 2) — when present, anchor pool is
  //   filtered by POOL_BIAS[section] first.
  function mix(features, neighbours, options) {
    var n = neighbours || (window.HologramState && window.HologramState.neighbours) || 4;
    var opts = options || {};
    // Phase 2.3: use the richer embedding when centroid/rms/onset are
    // present; otherwise fall back to v1 (bass/mid/treb only).
    var f = features || {};
    var coords = (typeof f.centroid === 'number' || typeof f.rms === 'number')
      ? featuresToCoordsV2(f)
      : featuresToCoords(f);
    var anchors = nearestAnchors(coords, n, opts);
    if (!anchors.length) return null;
    var preset = blendAnchors(anchors);
    var beat = features ? features.beat : undefined;
    return {
      coords: coords,
      anchors: anchors.map(function (a) { return { id: a.id, dist: a.dist }; }),
      preset: drift(preset, beat),
      section: opts.section || null,
    };
  }

  window.SWR_AUTOMIX = {
    // Phase 1: speed & responsiveness
    mix: mix,
    computeTickInterval: computeTickInterval,
    RAMP_MS: RAMP_MS,
    // Task 1 fix round 2 — TICK_INTERVAL_MIN_MS / TICK_INTERVAL_MAX_MS
    // are converted to live getters below so they stay in sync with
    // the closure-private vars after _setTuning() mutates them.
    smoothstep: smoothstep,
    lerpPreset: lerpPreset,
    presetDistance: presetDistance,
    // Phase 1.3: drift
    drift: drift,
    // Task 1 fix round 2 — DRIFT_BASE / DRIFT_BEAT_BONUS are converted
    // to live getters below so they stay in sync with the closure-
    // private vars after _setDriftAmplitude() mutates them.
    // Task 1 fix round 1 — runtime config-loader replaces the closure-
    // private drift amplitudes in place. Read accessor returns the
    // current values.
    _setDriftAmplitude: _setDriftAmplitude,
    _getDriftAmplitude: _getDriftAmplitude,
    // Task 1 fix round 2 — runtime config-loader replaces the closure-
    // private tick-interval bounds in place. Mirrors the driftAmplitude
    // shape (mutator + read accessor) so the runtime can apply
    // per-variant `tuning` overrides via a single setter call instead
    // of carrying a local mirror that duplicates the formula.
    _setTuning: _setTuning,
    _getTuning: _getTuning,
    // Phase 2: musical intelligence
    featuresToCoords: featuresToCoords,
    featuresToCoordsV2: featuresToCoordsV2,
    tickSection: tickSection,
    POOL_BIAS: POOL_BIAS,
    SECTION_HYSTERESIS_TICKS: SECTION_HYSTERESIS_TICKS,
    // Phase 3: visual evolution
    isStuck: isStuck,
    isFlatAudio: isFlatAudio,
    STUCK_EPSILON: STUCK_EPSILON,
    STUCK_DURATION_MS: STUCK_DURATION_MS,
    STUCK_HOP_COUNT: STUCK_HOP_COUNT,
    FLAT_CENTROID_VAR: FLAT_CENTROID_VAR,
    FLAT_DURATION_MS: FLAT_DURATION_MS,
    ANTI_PATTERN_INTERVAL_MS: ANTI_PATTERN_INTERVAL_MS,
    FIELDS: FIELDS,
    // Back-compat (test hooks)
    blendAnchors: blendAnchors,
  };
  // Convert the closure-private numeric constants to live getters on
  // the exported object. Without this, `SWR_AUTOMIX.DRIFT_BASE` holds
  // the IIFE-time value (0.01) even after `_setDriftAmplitude(0.5, …)`
  // mutates the closure var — callers reading the export see a stale
  // snapshot. Same applies to TICK_INTERVAL_*MS after _setTuning().
  // (Task 1 fix round 2.)
  Object.defineProperties(window.SWR_AUTOMIX, {
    DRIFT_BASE: {
      get: function () { return DRIFT_BASE; },
      enumerable: true,
      configurable: true,
    },
    DRIFT_BEAT_BONUS: {
      get: function () { return DRIFT_BEAT_BONUS; },
      enumerable: true,
      configurable: true,
    },
    TICK_INTERVAL_MIN_MS: {
      get: function () { return TICK_INTERVAL_MIN_MS; },
      enumerable: true,
      configurable: true,
    },
    TICK_INTERVAL_MAX_MS: {
      get: function () { return TICK_INTERVAL_MAX_MS; },
      enumerable: true,
      configurable: true,
    },
  });
})();