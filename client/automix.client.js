// client/automix.client.js
// Pure mix engine for the automix stack (window.SWR_AUTOMIX). Engine-agnostic:
// loaded by engine.html, dashboard.html and all 24 versions/*.html pages, and
// consumed by client/automix-runtime.client.js — the orchestrator that owns
// window.SWR._fxOverride (this module never writes it).
//
// Given live audio features + a section, mix() synthesizes a fresh fx_state:
//   1. Maps the live audio features (bass/mid/treb/beat/rms/centroid/
//      onset/bpm) into the same 2D (warmth, intensity) space as
//      SWR_ANCHOR_MAP.
//   2. (Phase 2) Filters the anchor pool by the current song section
//      (intro/verse/chorus/etc) so chorus pulls a different blend than
//      breakdown.
//   3. Looks up the N nearest anchor presets.
//   4. Returns a weighted blend of those anchors' fx_state values.
//   5. (Phase 1.3) Applies beat-phased mutation drift on every detected
//      downbeat so the visual evolves instead of locking.
//   6. (Phase 3) Stuck detection + anti-pattern injection on flat audio.
//
// The runtime hands the returned preset to window.SWR._fxOverride; the GLSL
// render loop reads it each frame and blends it on top of the page preset,
// interpolating from the previous override with a smoothstep ramp over
// `RAMP_MS` so blends evolve continuously instead of snapping (Phase 1.2).
//
// Pure (no DOM, no audio reads outside the passed-in `features`
// argument) so it can be unit-tested under Node without a browser.

(function () {
  'use strict';
  if (window.SWR_AUTOMIX) return;

  // ---- Constants ---------------------------------------------------------
  // Tunable knobs. Exported for tests + diagnostics.
  var FIELDS = ['temp','mut','sepia','chroma','grain','glow','grayscale','posterize'];
  // ---- Bars-based tick interval -------------------------------------------
  // Phase 4: replaced the ms-based "tick every 0.5–3 s" with a musical
  // "tick every N bars" model. Default 8 bars (typical song-section length:
  // verse→chorus happens every 8 bars). At 120 BPM that maps to 16 s — the
  // visual settles long enough for the listener to absorb a section before
  // the next major blend lands. Intensity still modulates, but gently:
  //   intensity = 0 (quiet)   → 1.5× bars  (12 bars — slowdown for breakdowns)
  //   intensity = 0.5 (mid)   → 1.0× bars  ( 8 bars — default)
  //   intensity = 1 (chorus)  → 0.5× bars  ( 4 bars — "music calls for it")
  // The bar-nudge in automix-runtime.client.js (per-2-second subtle lerp
  // toward a neighbour anchor) keeps the visual evolving between major
  // blends so 8 bars never feels static.
  var BARS_PER_TICK = 8;
  var BARS_INTENSITY_FLOOR = 0.5;     // multiplier at intensity = 1
  var BARS_INTENSITY_CEILING = 1.5;   // multiplier at intensity = 0
  var DEFAULT_BPM = 120;
  var BPM_MIN = 40;
  var BPM_MAX = 240;
  // ---- Legacy ms-based bounds --------------------------------------------
  // Retained for the public API + getter so existing callers / tests that
  // read SWR_AUTOMIX.TICK_INTERVAL_MIN_MS / MAX_MS don't break. They no
  // longer drive computeTickInterval() — _setTuning() now consumes
  // barsPerTick (preferred) and derives BARS_PER_TICK from the midpoint
  // at 120 BPM if only the legacy ms fields are provided.
  var TICK_INTERVAL_MIN_MS = 4000;
  var TICK_INTERVAL_MAX_MS = 24000;
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

  // ---- Adaptive tick interval (Phase 4) -----------------------------------
  // BPM-aware, bars-based. Reads feat.bpm (defaults to 120), then:
  //   barMs    = 4 beats × (60000 ms / bpm)
  //   barsMul  = ceiling − intensity × (ceiling − floor)        // [floor, ceiling]
  //   interval = BARS_PER_TICK × barsMul × barMs               // ms
  // Examples (default 8 bars, ceiling 1.5, floor 0.5):
  //   90 BPM,  intensity 0   → 8 × 1.5 × 4 × (60000/90)  = 32000 ms (12 bars)
  //  120 BPM,  intensity 0.5 → 8 × 1.0 × 4 × 500         = 16000 ms ( 8 bars)
  //  140 BPM,  intensity 1   → 8 × 0.5 × 4 × (60000/140) =  6857 ms ( 4 bars)
  function computeTickInterval(features) {
    var f = features || {};
    var bpm = (typeof f.bpm === 'number' && f.bpm >= BPM_MIN && f.bpm <= BPM_MAX)
      ? f.bpm
      : DEFAULT_BPM;
    var barMs = 4 * (60000 / bpm);
    var rms = (typeof f.rms === 'number') ? f.rms : 0;
    var onset = (typeof f.onset === 'number') ? f.onset : 0;
    var intensity = Math.max(0, Math.min(1, rms * 1.5 + onset * 0.8));
    var barsMul = BARS_INTENSITY_CEILING -
      intensity * (BARS_INTENSITY_CEILING - BARS_INTENSITY_FLOOR);
    return Math.round(BARS_PER_TICK * barsMul * barMs);
  }

  // ---- Anchor read --------------------------------------------------------
  // We re-read SWR_ANCHOR_MAP.neighbours() each tick so the map stays
  // in sync if the page loads more presets in the future. No caching.

  // Style pool filter (client/automix-style.client.js). When a style is
  // active, only its anchors are eligible. Null / empty = every anchor,
  // which is the historical behaviour.
  //
  // Kept as a closure var with a public setter rather than a config read per
  // tick: the filter is checked on every blend, and an object-property read
  // of a mutable module var is cheaper than re-deriving it, while still
  // letting a style switch take effect on the very next tick.
  var ANCHOR_POOL = null;   // null | { [anchorId]: true }

  function _poolAllows(id) {
    if (!ANCHOR_POOL) return true;
    return ANCHOR_POOL[id] === true;
  }

  function nearestAnchors(coords, n, options) {
    if (!window.SWR_ANCHOR_MAP || !window.SWR_ANCHOR_MAP.neighbours) return [];
    // Phase 2.2: optional section-bias filtering.
    if (options && options.section && POOL_BIAS[options.section]) {
      var bias = POOL_BIAS[options.section];
      // Ask the map for more neighbours than we need, then filter. The pool
      // is applied here too so a style restricts the pool BEFORE the section
      // bias narrows it further — otherwise a style could be silently undone
      // by an unfiltered fallback path below.
      var expanded = window.SWR_ANCHOR_MAP.neighbours(coords, Math.max(n * 4, 16));
      var filtered = [];
      for (var i = 0; i < expanded.length; i++) {
        var a = expanded[i];
        if (!_poolAllows(a.id)) continue;
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
      // The section bias over-constrained the style pool. Retry with the
      // pool still applied but no section bias, so a style is never bypassed
      // by the fallback. Only if THAT is also too narrow do we drop the
      // filter entirely (pool had no anchors near these coords at all).
      if (ANCHOR_POOL) {
        var poolOnly = [];
        var wide = window.SWR_ANCHOR_MAP.neighbours(coords, Math.max(n * 4, 16));
        for (var j = 0; j < wide.length; j++) {
          if (_poolAllows(wide[j].id)) poolOnly.push(wide[j]);
        }
        if (poolOnly.length >= 2) return poolOnly.slice(0, n);
      }
    }
    // Unfiltered path still honours the style pool.
    if (ANCHOR_POOL) {
      var allowed = [];
      var all = window.SWR_ANCHOR_MAP.neighbours(coords, Math.max(n * 4, 16));
      for (var k = 0; k < all.length; k++) {
        if (_poolAllows(all[k].id)) allowed.push(all[k]);
      }
      if (allowed.length >= 2) return allowed.slice(0, n);
      // Style pool too small near these coords — mix() returning null would
      // freeze the visual, so widen to the full map rather than go dark.
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
    var mid = features.mid || 0;
    var treb = features.treb || 0;
    var centroid = (typeof features.centroid === 'number') ? features.centroid : 0;
    var rms = (typeof features.rms === 'number') ? features.rms : 0;

    // The previous formula spanned only warmth≈0.35..0.65 and
    // intensity≈0.1..0.9, so six of the nineteen anchors sat permanently
    // out of reach: grid, fractal, pulse, void, gallery, phosphor. Measured
    // before this change: 13/19 anchors reachable from any audio. The
    // range, not the anchor definitions, was the limit — so widen the
    // mapping rather than move the anchors (moving them would shift the
    // gradient canvas users already know).
    //
    // Warmth spreads the full 0..1 across the spectral tilt. `contrast`
    // (bass vs treb) dominates because that is what the ear reads as
    // "warm"; centroid adds a smaller independent push so a bright-but-
    // bassy track is not pinned to the same warmth as a dark one. Real
    // audio rarely reaches the extremes, so the gain is >1 to guarantee
    // the corners are reachable.
    var contrast = (bass - treb) * 0.5 + (mid - 0.5) * 0.2;
    var warmth = Math.max(0, Math.min(1, 0.5 + contrast * 1.35 + (centroid - 0.5) * 0.45));

    // Intensity adds a "busyness" term — onset density separates a sparse
    // ballad from a busy drum track at the same band energies, and it was
    // entirely unused. That term is what opens the high-intensity corner
    // (hallucination, glitch, grid).
    var energy = mid * 0.45 + treb * 0.25 + bass * 0.30;
    var busyness = (typeof features.onset === 'number') ? features.onset : 0;
    var intensity = Math.max(0, Math.min(1,
      energy * 0.72 + rms * 0.18 + busyness * 0.22 + 0.12));

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
  // Bounded evolution on the blended values, layered so it reads as
  // intentional rather than as sensor noise:
  //
  //   1. BREATH (new) — a per-field sine whose phase advances with the
  //      number of detected beats. This is the part the user actually sees:
  //      a slow, periodic swell on top of the anchor blend. The old
  //      implementation was a flat random walk with std-dev ~0.011 on a
  //      0..1 field — about 1%, below the perceptual floor, so the whole
  //      mutation layer did essentially nothing.
  //   2. JITTER (old behaviour, kept) — a small random walk so successive
  //      cycles never look identical. The random walk alone was too small to
  //      read; combined with the breath it now supplies texture without
  //      being the only signal.
  //
  // Amplitude scales with beat, exactly as before:
  //   beat = 0   → ±DRIFT_BASE        (gentle, no rhythmic anchor)
  //   beat = 1   → ±(DRIFT_BASE + DRIFT_BEAT_BONUS)
  //   beat omitted → ±DRIFT_BASE      (backward-compat default)
  // Each field is clamped to [-1, 1] so the visual stays in its safe range.
  // Amplitudes are closure-private vars that the runtime config-loader
  // mutates via _setDriftAmplitude() (per Task 1 fix round 1).

  // Phase counter + per-field offsets. Advances once per detected beat, so
  // the breath is locked to the song's tempo rather than to wall-clock time
  // (which would drift against the music the moment the BPM changed).
  var DRIFT_PHASE = 0;
  // Stable per-field offsets so every field breathes on its own phase —
  // otherwise all eight move in lockstep and read as a single global
  // brightness pump rather than as organic drift.
  var DRIFT_FIELD_OFFSETS = (function () {
    var offsets = {};
    var keys = ['temp', 'mut', 'mutAlgo', 'sepia', 'chroma', 'grain', 'glow',
                'grayscale', 'posterize'];
    for (var i = 0; i < keys.length; i++) {
      offsets[keys[i]] = (i * 0.7) % (Math.PI * 2);
    }
    return offsets;
  })();
  // One full breath cycle every N beats. 16 beats ≈ 4 bars at 120 BPM: long
  // enough to read as a swell, short enough that a listener notices the
  // change happening.
  var DRIFT_BREATH_BEATS = 16;
  // The amplitude is a TOTAL per-step budget shared between the two terms.
  // They must sum to 1 so the peak step never exceeds what the old
  // single-term random walk could produce.
  var BREATH_SHARE = 0.72;
  var JITTER_SHARE = 0.28;

  // Test/diagnostic hook: reset the breath phase so a caller can compare
  // two presets from the same starting point.
  function _resetDriftPhase() { DRIFT_PHASE = 0; }
  function _getDriftPhase() { return DRIFT_PHASE; }

  function drift(preset, beat) {
    if (!preset) return preset;
    var b = (typeof beat === 'number' && isFinite(beat)) ? Math.max(0, Math.min(1, beat)) : 0;
    var amplitude = DRIFT_BASE + DRIFT_BEAT_BONUS * b;
    DRIFT_PHASE++;
    var out = {};
    for (var k in preset) {
      if (!Object.prototype.hasOwnProperty.call(preset, k)) continue;
      // Breath: full sine cycle per DRIFT_BREATH_BEATS, scaled by the same
      // beat-gated amplitude so it swells with the music instead of moving
      // constantly. This is the dominant, visible term.
      var offset = Object.prototype.hasOwnProperty.call(DRIFT_FIELD_OFFSETS, k)
        ? DRIFT_FIELD_OFFSETS[k] : 0;
      var angle = (DRIFT_PHASE / DRIFT_BREATH_BEATS) * Math.PI * 2 + offset;
      var breath = Math.sin(angle) * amplitude * BREATH_SHARE;
      // Jitter: the original random walk, held to its share of the budget.
      // Adding the two terms instead of splitting the amplitude would double
      // the peak step and break the "cold drift step ≤ 0.012" contract
      // asserted by scripts/check-automix-unit.mjs.
      var jitter = (Math.random() - 0.5) * 2 * amplitude * JITTER_SHARE;
      out[k] = Math.max(-1, Math.min(1, preset[k] + breath + jitter));
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

  // Mutator for the closure-private tick-cadence knob. Phase 4: now takes an
  // optional `barsPerTick` (preferred) and falls back to deriving one from
  // the legacy (minTickMs, maxTickMs) midpoint at 120 BPM when only the
  // legacy fields are provided. Bars are clamped to [1, 32] (matching the
  // runtime's _validateTuning contract) and rounded to integers. Bad
  // inputs (NaN, non-number, invalid range) are silently ignored so the
  // public setter stays safe to call from untrusted configs. Mirrors the
  // _setDriftAmplitude shape.
  function _setTuning(minTickMs, maxTickMs, barsPerTick) {
    if (typeof barsPerTick === 'number' && isFinite(barsPerTick)) {
      BARS_PER_TICK = Math.max(1, Math.min(32, Math.round(barsPerTick)));
      return;
    }
    if (typeof minTickMs === 'number' && isFinite(minTickMs) &&
        typeof maxTickMs === 'number' && isFinite(maxTickMs) &&
        minTickMs <= maxTickMs) {
      var mn = Math.max(1, Math.min(10000, Math.round(minTickMs)));
      var mx = Math.max(1, Math.min(10000, Math.round(maxTickMs)));
      // Legacy fallback — derive bars from midpoint at 120 BPM.
      // 1 bar @ 120 BPM = 4 × 500 ms = 2000 ms.
      var midMs = (mn + mx) / 2;
      var inferred = Math.max(1, Math.min(32, Math.round(midMs / 2000)));
      BARS_PER_TICK = inferred;
      TICK_INTERVAL_MIN_MS = mn;
      TICK_INTERVAL_MAX_MS = mx;
    }
  }
  // Read accessor — returns the CURRENT closure-private state. Includes
  // both the new bars-based knob and the legacy ms bounds so existing
  // callers / tests keep working.
  function _getTuning() {
    return {
      barsPerTick: BARS_PER_TICK,
      intensityFloor: BARS_INTENSITY_FLOOR,
      intensityCeiling: BARS_INTENSITY_CEILING,
      minTickMs: TICK_INTERVAL_MIN_MS,
      maxTickMs: TICK_INTERVAL_MAX_MS,
    };
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
    // Breath-phase hooks. Exposed so tests can align two comparisons and so
    // the debug panel can show where in the breath cycle the visual sits.
    _resetDriftPhase: _resetDriftPhase,
    _getDriftPhase: _getDriftPhase,
    DRIFT_BREATH_BEATS: DRIFT_BREATH_BEATS,
    // Task 1 fix round 2 — runtime config-loader replaces the closure-
    // private tick-interval bounds in place. Mirrors the driftAmplitude
    // shape (mutator + read accessor) so the runtime can apply
    // per-variant `tuning` overrides via a single setter call instead
    // of carrying a local mirror that duplicates the formula.
    _setTuning: _setTuning,
    _getTuning: _getTuning,
    // Style pool. `setAnchorPool(ids | null)` restricts which anchors a
    // blend may draw from; null restores the full 19-anchor map. Applied to
    // the next tick — no restart, and no re-blend of the current frame
    // (the runtime's ramp handles the transition).
    setAnchorPool: function (ids) {
      if (ids == null) { ANCHOR_POOL = null; return; }
      if (!Array.isArray(ids) || !ids.length) { ANCHOR_POOL = null; return; }
      var set = Object.create(null);
      for (var i = 0; i < ids.length; i++) set[ids[i]] = true;
      ANCHOR_POOL = set;
    },
    getAnchorPool: function () {
      if (!ANCHOR_POOL) return null;
      return Object.keys(ANCHOR_POOL);
    },
    anchorAllowed: _poolAllows,
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
    // Phase 4: bars-based cadence
    BARS_PER_TICK: BARS_PER_TICK,
    BARS_INTENSITY_FLOOR: BARS_INTENSITY_FLOOR,
    BARS_INTENSITY_CEILING: BARS_INTENSITY_CEILING,
    DEFAULT_BPM: DEFAULT_BPM,
    FIELDS: FIELDS,
    // Back-compat (test hooks)
    blendAnchors: blendAnchors,
  };
  // Convert the closure-private numeric constants to live getters on
  // the exported object. Without this, `SWR_AUTOMIX.DRIFT_BASE` holds
  // the IIFE-time value (0.01) even after `_setDriftAmplitude(0.5, …)`
  // mutates the closure var — callers reading the export see a stale
  // snapshot. Same applies to TICK_INTERVAL_*MS and BARS_PER_TICK after
  // _setTuning(). (Task 1 fix round 2 + Phase 4.)
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
    BARS_PER_TICK: {
      get: function () { return BARS_PER_TICK; },
      enumerable: true,
      configurable: true,
    },
  });
})();