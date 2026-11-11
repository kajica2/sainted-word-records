// client/automix-arc.client.js — L3 song arc: long-horizon automix structure
//
// The measured problem (2026-09-24, 75s probe on tape): without a macro
// layer, automix motion is Brownian — field ranges of 0.14–0.17 on 0–1
// uniforms over 75 seconds. This module gives every song a deterministic
// 3–5 act trajectory so change over time is guaranteed and visible.
//
// Pipeline (see local://automix-evolution-plan.md):
//   song load → Audio.analyzeFull() → AudioAnalysisV2.analyzeBuffer
//     → build(analysis) → arc { acts, sampleAt }
//     → automix-runtime.tick() samples the arc at el.currentTime / duration
//     → act anchor + baseline flow through the existing _fxOverride ramp.
//
// Contract:
//   SWR_AUTOMIX_ARC.build(analysis)  → arc | null
//     analysis: { duration (s), bpm, onsets: [s], energy?: [{t, v}] }
//     Deterministic: same analysis ⇒ same arc (seeded PRNG from duration,
//     bpm, onset count — a song's arc is its signature, not a random walk).
//   arc.sampleAt(currentTime) → { actIndex, actProgress, anchorId, coords,
//                                 preset, rampMs } | null
//   arc.tick(currentTime) → same shape as sampleAt(); the stateful entry the
//     runtime glide clock calls. Fires the inter-act transition
//     (window.SWRTransitions.fire) the first tick an act boundary is crossed.
//   arc.acts → [{ t0, t1, anchorId, coords, preset, rampMs }]
//
// Section cue (plan P1.3, architecture-audit-2026-10)
//   client/section-detector.client.js detects a boundary LIVE, from the
//   engine's own audio features, and announces it as `swr-section-change`.
//   The arc is built OFFLINE from a decoded buffer, so the two never meet on
//   the data path: the arc knows where its acts are, the detector knows what
//   the material just changed into, and nothing connected them. This is the
//   connection, and it is deliberately SOFT:
//
//     - a section boundary NEVER fires a transition. Only an act boundary
//       does, exactly as before. The detector can retime nothing and break
//       nothing: with no arc on the page (or no act boundary ahead) a
//       boundary has no effect at all.
//     - a boundary only BIASES which transition the next act boundary picks.
//       Entering a chorus biases toward the dynamic vocabulary; entering a
//       breakdown, intro or outro biases toward the subtle one; a verse or
//       prechorus is neutral and leaves the act's own warmth/intensity to
//       decide, because the act plan is a better signal there.
//     - the cue is ONE SHOT. The next act transition consumes it, so a busy
//       section with four boundaries cannot stack four votes into one pick.
//     - a boundary the detector is not confident about does not arm a cue at
//       all, at the same 0.5 threshold client/automix.client.js's own
//       tickSection() hysteresis already uses.
//
//   window.SWR_AUTOMIX_ARC.onSectionChange(detail)   the listener, also
//       callable directly (a page that republishes boundaries itself).
//   window.SWR_AUTOMIX_ARC.sectionCue               the armed cue, or null.
//   window.SWR_AUTOMIX_ARC.lastResetReason          why the last cue was
//       dropped ('gap' / 'silence' / 'reset'), or null if none was.
//
//     `swr-section-reset` is a SEPARATE event from `swr-section-change`, and
//     deliberately so: it fires when the detector empties its map (a song
//     swap, a seek, a hole in the clock, the end of a track) and carries
//     { reason, dropped }. Dressing an empty map up as a boundary to a chorus
//     would be a lie, and other consumers already parse detail.to. The arc
//     uses it to drop an armed cue, so a cue from the previous song cannot
//     bias the new song's first act boundary.
//   window.SWR_AUTOMIX_ARC._internals.pickTransition(warmth, intensity, cue)
//       the pure picker, so the bias is testable without a page.
//
// Movement budget: consecutive acts must differ by ≥ ARC_MIN_DISPLACEMENT
// (0.25 Euclidean on the anchor map) — the executable form of "changes over
// time are visible". build() returns null if the map can't satisfy it.

(function () {
  'use strict';

  if (window.SWR_AUTOMIX_ARC && window.SWR_AUTOMIX_ARC.__loaded) return;

  // Load transitions module — act-boundary transitions reuse the same
  // vocabulary the manual transition panel fires. Idempotent (the module
  // self-guards) and deferred, so a page that never advances an act never
  // pays for it. Absolute path: works from root pages and nested routes
  // alike (matches the /audio-analysis-v2.js convention below).
  if (typeof window !== 'undefined' && typeof document !== 'undefined' && !window.SWRTransitions) {
    var txScript = document.createElement('script');
    txScript.src = '/engine-transitions.client.js';
    txScript.defer = true;
    document.head.appendChild(txScript);
  }

  // Deterministic PRNG (mulberry32) — tiny, seedable, no deps.
  function mulberry32(seed) {
    var a = seed >>> 0;
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function hashSeed(analysis) {
    var s = Math.round((analysis.duration || 0) * 1000) +
            Math.round((analysis.bpm || 0) * 977) +
            ((analysis.onsets || []).length * 31) +
            ((analysis.key || '').length * 7);
    return s >>> 0;
  }

  var MIN_ACTS = 3, MAX_ACTS = 5;
  var ARC_MIN_DISPLACEMENT = 0.25;
  // Candidate boundaries sit near equal fifths; snap window ±12% of duration.
  var SNAP_WINDOW = 0.12;

  // Onset flux: onsets per second in 2s windows — the cheap energy curve
  // derived from the onsets array analyzeBuffer already returns.
  function fluxCurve(analysis) {
    var dur = analysis.duration || 0;
    var onsets = analysis.onsets || [];
    if (dur <= 0) return null;
    var win = 2;
    var n = Math.max(1, Math.floor(dur / win));
    var curve = new Array(n).fill(0);
    for (var i = 0; i < onsets.length; i++) {
      var idx = Math.min(n - 1, Math.floor(onsets[i] / win));
      curve[idx] += 1;
    }
    for (var j = 0; j < n; j++) curve[j] /= win;
    return curve;
  }

  // Pick the lowest-flux point near each target fraction — boundaries at
  // musical "breaths" (quiet transitions), not arbitrary fifths.
  function snapBoundary(flux, dur, frac) {
    var n = flux ? flux.length : 0;
    var center = frac * dur;
    var half = SNAP_WINDOW * dur;
    var best = -1, bestV = Infinity;
    for (var t = Math.max(0, center - half); t <= Math.min(dur - 1, center + half); t += 1) {
      var v = flux ? (flux[Math.min(n - 1, Math.floor(t / 2))] || 0) : 0;
      // Prefer low flux; tiebreak toward the target fraction.
      var score = v + Math.abs(t - center) / dur * 0.5;
      if (score < bestV) { bestV = score; best = t; }
    }
    return best > 0 ? best : center;
  }

  // Act archetypes — the arc's emotional grammar. fullRange targets use the
  // whole 0–1 dial (the measured invisibility came from presets clustering
  // low); each archetype blends the anchor preset toward its targets.
  var ARCHETYPES = [
    { name: 'intro',     intensityBias: -0.30, mut: 0.20, grain: 0.30, glow: 0.25, warmthBias: +0.10 },
    { name: 'lift',      intensityBias: +0.05, mut: 0.45, grain: 0.35, glow: 0.50, warmthBias: 0 },
    { name: 'peak',      intensityBias: +0.30, mut: 0.70, grain: 0.55, glow: 0.75, warmthBias: -0.10 },
    { name: 'breakdown', intensityBias: -0.40, mut: 0.12, grain: 0.15, glow: 0.15, warmthBias: +0.15 },
    { name: 'outro',     intensityBias: -0.20, mut: 0.15, grain: 0.20, glow: 0.25, warmthBias: +0.10 },
  ];

  function build(analysis) {
    if (!analysis || !(analysis.duration > 0)) return null;
    var map = window.SWR_ANCHOR_MAP;
    if (!map || !map.list) return null;
    var dur = analysis.duration;

    var rng = mulberry32(hashSeed(analysis));
    var nActs = MIN_ACTS + Math.floor(rng() * (MAX_ACTS - MIN_ACTS + 1));
    nActs = Math.min(nActs, MAX_ACTS);

    // Boundaries: snapped fifths between the first and last act edges.
    var flux = fluxCurve(analysis);
    var bounds = [0];
    for (var i = 1; i < nActs; i++) {
      var frac = i / nActs;
      // Skip snapping for very short tracks — window collapses onto center.
      var snapped = dur > 45 ? snapBoundary(flux, dur, frac) : frac * dur;
      bounds.push(snapped);
    }
    bounds.push(dur);

    // Snapped boundaries are chosen independently inside overlapping
    // ±12%-of-duration windows, so two adjacent picks can cross and leave a
    // zero/negative-span act — sampleAt then skips it and an act becomes
    // unreachable. Sort the interior bounds and enforce a minimum span so the
    // sequence is strictly increasing and ends exactly at `dur`.
    var minSpan = dur / (nActs * 4);
    var interior = bounds.slice(1, bounds.length - 1).sort(function (a, b) { return a - b; });
    var seq = [0];
    for (var m = 0; m < interior.length; m++) {
      var lo = seq[seq.length - 1] + minSpan;
      seq.push(interior[m] < lo ? lo : interior[m]);
    }
    // Degenerate overflow (every pick pushed past the end): fall back to equal
    // fifths — still a valid strictly-increasing arc.
    if (seq[seq.length - 1] >= dur) {
      for (var q = 1; q < seq.length; q++) seq[q] = dur * q / seq.length;
    }
    seq.push(dur);
    bounds = seq;

    // Act archetype order: deterministic shuffle of the canonical dramatic
    // arc — always starts intro-ish, always ends outro-ish, middle acts
    // permute lift/peak/breakdown.
    var middles = ARCHETYPES.slice(1, 4); // lift, peak, breakdown
    for (var s = middles.length - 1; s > 0; s--) {
      var r = Math.floor(rng() * (s + 1));
      var tmp = middles[s]; middles[s] = middles[r]; middles[r] = tmp;
    }
    var archetypes = [];
    for (var a = 0; a < nActs; a++) {
      if (a === 0) archetypes.push(ARCHETYPES[0]);
      else if (a === nActs - 1) archetypes.push(ARCHETYPES[4]);
      else archetypes.push(middles[(a - 1) % middles.length]);
    }

    // Anchor picks: whole-map spread with the movement budget. Walk acts,
    // rejecting candidates closer than ARC_MIN_DISPLACEMENT to the previous
    // act's anchor; after 8 rejections take the farthest candidate.
    var ids = map.list();
    var acts = [];
    var prev = null;
    // Anchors already spent earlier in THIS arc. Without this the builder
    // only compared against the immediately preceding act, so a 3-act arc
    // could legitimately resolve to [smoke, aurora, smoke] — the same look
    // bookending itself. Measured before the fix: 9 distinct anchors across
    // 40 synthetic songs, with repeats in 3-4 act arcs.
    var usedIds = Object.create(null);
    for (var b = 0; b < nActs; b++) {
      var arch = archetypes[b];
      var targetCoords = {
        warmth: Math.max(0, Math.min(1, 0.5 + arch.warmthBias + (rng() - 0.5) * 0.3)),
        intensity: Math.max(0, Math.min(1, 0.5 + arch.intensityBias + (rng() - 0.5) * 0.2)),
      };
      // Query MORE candidates than we need. `neighbours(coords, 6)` returns
      // the 6 globally nearest, which under an active style pool can contain
      // zero allowed anchors (the style's anchors may all sit further out).
      // Filtering that short list would fall through to the unfiltered
      // fallback and quietly ignore the style, so widen first and narrow
      // after. The full map is small (~19) so asking for all of it is cheap
      // and removes any dependence on how far a style's region sits.
      var nn = map.neighbours(targetCoords, map.list().length);
      // Style pool (client/automix-style.client.js). When a style is
      // active, the arc's per-act anchor choice must respect it — the arc
      // supplies the preset the runtime actually applies, so an
      // unfiltered pick here would override the pool that nearestAnchors()
      // enforces on the legacy path, and a style would have almost no
      // visible effect. Falls back to the full candidate list when the
      // pool cannot satisfy this act (better a slightly-off look than an
      // act with no anchor at all).
      var pool = window.SWR_AUTOMIX && typeof window.SWR_AUTOMIX.anchorAllowed === 'function'
        ? window.SWR_AUTOMIX.anchorAllowed : null;
      var candidates = nn;
      if (pool) {
        var allowed = [];
        for (var pj = 0; pj < nn.length; pj++) {
          if (nn[pj] && pool(nn[pj].id)) allowed.push(nn[pj]);
        }
        if (allowed.length) candidates = allowed;
      }

      // Prefer anchors never used earlier in this arc. Two passes: require
      // "never used" first, then relax when the pool is too small to avoid
      // a repeat (a style legitimately narrows the map to 4-5 anchors).
      var chosen = null;
      var passes = [function (c) { return !usedIds[c.id]; },
                    function () { return true; }];
      for (var pi = 0; pi < passes.length && !chosen; pi++) {
        var fresh = [];
        for (var fi = 0; fi < candidates.length; fi++) {
          if (candidates[fi] && candidates[fi].anchor && passes[pi](candidates[fi])) {
            fresh.push(candidates[fi]);
          }
        }
        if (!fresh.length) continue;
        for (var c = 0; c < fresh.length; c++) {
          var cand = fresh[c];
          if (!prev) { chosen = cand; break; }
          var dx = cand.anchor.warmth - prev.coords.warmth;
          var dy = cand.anchor.intensity - prev.coords.intensity;
          if (Math.sqrt(dx * dx + dy * dy) >= ARC_MIN_DISPLACEMENT) { chosen = cand; break; }
        }
        // No unused candidate clears the displacement budget — take the
        // farthest unused one rather than reusing something adjacent.
        if (!chosen && prev) {
          var far = fresh[0];
          for (var fd = 1; fd < fresh.length; fd++) {
            var fx = fresh[fd].anchor.warmth - prev.coords.warmth;
            var fy = fresh[fd].anchor.intensity - prev.coords.intensity;
            var vx = far.anchor.warmth - prev.coords.warmth;
            var vy = far.anchor.intensity - prev.coords.intensity;
            if (fx * fx + fy * fy > vx * vx + vy * vy) far = fresh[fd];
          }
          chosen = far;
        } else if (!chosen) {
          chosen = fresh[0];
        }
      }
      if (!chosen) chosen = candidates[candidates.length - 1]; // farthest of the candidates
      if (!chosen || !chosen.anchor) return null;
      prev = { coords: { ...chosen.anchor } };
      usedIds[chosen.id] = true;

      // Baseline: anchor preset pulled toward the archetype's full-range
      // targets (50/50) — louder acts genuinely reach the top of the dial.
      var p = chosen.anchor.preset;
      var baseline = {};
      var fields = ['temp', 'mut', 'posterize', 'chroma', 'grain', 'sepia', 'glow', 'grayscale'];
      for (var f = 0; f < fields.length; f++) {
        var key = fields[f];
        var base = typeof p[key] === 'number' ? p[key] : 0;
        var archTarget = arch[key];
        baseline[key] = (archTarget === undefined) ? base : base * 0.5 + archTarget * 0.5;
      }
      baseline.mutAlgo = p.mutAlgo || 0;
      if (typeof window !== 'undefined' && window.SWR_MOTION_KILL
          && typeof window.SWR_MOTION_KILL.coerceMutAlgo === 'function') {
        baseline.mutAlgo = window.SWR_MOTION_KILL.coerceMutAlgo(baseline.mutAlgo);
      }
      acts.push({
        t0: bounds[b],
        t1: bounds[b + 1],
        anchorId: chosen.id,
        coords: chosen.anchor,
        preset: baseline,
        name: arch.name,
        rampMs: 1000,
      });
    }

    // Enforce the movement budget explicitly (the anchor-walk above gets
    // there heuristically; the check makes the contract load-bearing).
    for (var d = 1; d < acts.length; d++) {
      var ddx = acts[d].coords.warmth - acts[d - 1].coords.warmth;
      var ddy = acts[d].coords.intensity - acts[d - 1].coords.intensity;
      if (Math.sqrt(ddx * ddx + ddy * ddy) < ARC_MIN_DISPLACEMENT * 0.9) return null;
    }

    return { acts: acts, duration: dur };
  }

  function sampleAt(arc, currentTime) {
    if (!arc || !arc.acts || !arc.acts.length) return null;
    var acts = arc.acts;
    var t = Math.max(0, Math.min(arc.duration, currentTime || 0));
    for (var i = 0; i < acts.length; i++) {
      if (t >= acts[i].t0 && t < acts[i].t1) {
        var span = acts[i].t1 - acts[i].t0;
        return {
          actIndex: i,
          actCount: acts.length,
          actName: acts[i].name,
          actProgress: span > 0 ? (t - acts[i].t0) / span : 1,
          anchorId: acts[i].anchorId,
          coords: acts[i].coords,
          preset: acts[i].preset,
          rampMs: acts[i].rampMs,
        };
      }
    }
    var last = acts[acts.length - 1];
    return { actIndex: acts.length - 1, actCount: acts.length, actName: last.name, actProgress: 1, anchorId: last.anchorId, coords: last.coords, preset: last.preset, rampMs: last.rampMs };
  }

  // ---- Act-boundary transitions ---------------------------------------
  // sampleAt() stays a pure read (the debug HUD and the arc unit tests call
  // it); tick() is the stateful entry the runtime glide clock drives. It
  // samples, and the first tick an act boundary is crossed fires the
  // inter-act transition. Tracking lives on the arc object, so a rebuilt
  // arc (new song) arms fresh with no extra bookkeeping.
  // ---- section cue (live detector -> offline arc) --------------------------
  // Which vocabulary a section argues for. verse/prechorus are deliberately
  // absent: they map to null, i.e. "no opinion", because the act plan's own
  // warmth/intensity is a better signal through the middle of a song.
  var SECTION_CLASS = {
    chorus: 'dynamic',
    breakdown: 'subtle',
    intro: 'subtle',
    outro: 'subtle',
  };

  // Same threshold client/automix.client.js uses to accept a label, so the
  // arc never trusts a boundary automix has already refused.
  var MIN_CUE_CONFIDENCE = 0.5;

  var SUBTLE = ['fade-to-black', 'cross-dissolve', 'warp-dissolve'];
  var DYNAMIC = ['glitch-burst', 'chromatic-split', 'circle-wipe', 'linear-wipe-lr', 'vhs-tracking'];

  // ---- Act → transition family ------------------------------------------
  // The act's dramatic shape argues for a transition FAMILY — the same
  // `family` tag engine-transitions.client.js puts on every catalog entry.
  // The pool for a family is read from the LIVE catalog, never from a
  // hardcoded list: a hardcoded name that drifts out of the catalog makes
  // an act boundary silently fire nothing, which is exactly the failure
  // this map exists to remove.
  //
  // The cue still outranks the act plan (one vote, consumed by the caller),
  // and the warmth/intensity rule stays the fallback when the catalog is
  // absent or knows no member of the family.
  var ACT_FAMILY = {
    intro: 'fade',
    lift: 'wipe',
    peak: 'distortion',
    breakdown: 'brightness',
    outro: 'fade',
  };

  // Every catalog entry whose `family` matches, or null when the catalog is
  // absent or has no member of that family (the caller then falls back).
  function familyPool(family) {
    var tx = (typeof window !== 'undefined') && window.SWRTransitions;
    var catalog = tx && tx._TRANSITIONS;
    if (!catalog || !family) return null;
    var pool = [];
    for (var name in catalog) {
      if (!Object.prototype.hasOwnProperty.call(catalog, name)) continue;
      var entry = catalog[name];
      if (entry && entry.family === family) pool.push(name);
    }
    return pool.length ? pool : null;
  }

  var pendingCue = null;

  function clamp01(v) {
    return v < 0 ? 0 : (v > 1 ? 1 : v);
  }

  // Arm the one-shot cue from a `swr-section-change` detail. A boundary with
  // no usable name, or one the detector is unsure about, leaves whatever was
  // already armed alone: it does not clear a good cue with a weak one.
  function noteSection(detail) {
    var d = detail || {};
    var to = d.to;
    if (!to || !SECTION_CLASS[to]) return pendingCue;
    var conf = (typeof d.confidence === 'number' && isFinite(d.confidence)) ? d.confidence : 0;
    if (conf < MIN_CUE_CONFIDENCE) return pendingCue;
    pendingCue = {
      from: d.from || null,
      to: to,
      cls: SECTION_CLASS[to],
      confidence: clamp01(conf),
      novelty: (typeof d.novelty === 'number' && isFinite(d.novelty)) ? d.novelty : 0,
      tMs: (typeof d.tMs === 'number' && isFinite(d.tMs)) ? d.tMs : 0,
    };
    return pendingCue;
  }

  function onSectionChange(ev) {
    var d = (ev && ev.detail) ? ev.detail : ev;
    try {
      noteSection(d);
    } catch (_) { /* a cue is a hint: never let it break the render loop */ }
  }

  function onSectionReset(ev) {
    var d = (ev && ev.detail) ? ev.detail : {};
    try {
      // The analysis that produced this cue has ended: a song swap, a seek, a
      // hole in the clock, or the end of the track. An armed cue from the
      // previous stream would otherwise bias the new song's first act
      // boundary, which is the one boundary where a stale opinion is least
      // defensible.
      pendingCue = null;
      lastResetReason = d.reason || 'reset';
    } catch (_) { /* ignore */ }
  }

  var lastResetReason = null;

  if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
    try {
      window.addEventListener('swr-section-change', onSectionChange);
      window.addEventListener('swr-section-reset', onSectionReset);
    } catch (_) { /* no event surface: the arc simply runs cue-less */ }
  }

  // ---- Act-aware shaping of the within-act glide -------------------------
  //
  // The glide from one act's baseline to the next is not one curve for the
  // whole song: each act archetype moves at its own pace. The shape is a
  // PURE function of (actName, progress) — the arc unit pins it, the
  // runtime calls it in one line.
  //
  // Every curve is monotone and maps 0→0 and 1→1, so the act boundaries
  // stay continuous (the glide still arrives exactly on the next act's
  // baseline) and a boundary can never jump backwards.
  //
  //   intro     — eases in: the song settles before it starts moving.
  //   lift      — steady, slightly front-loaded (the lift IS the rise).
  //   peak      — HOLDS its own baseline, then releases late: the peak is
  //               the act that stays put, and the release into the next
  //               act happens near the end.
  //   breakdown — releases early: the picture falls away while the act
  //               still has time left.
  //   outro     — eases out: the drift back is gradual.
  var ACT_SHAPE = {
    intro:     function (p) { return p * p * (3 - 2 * p) * 0.55 + p * 0.45; },
    lift:      function (p) { return Math.pow(p, 0.85); },
    // Hold the baseline for the first quarter of the act, then release
    // with a smoothstep: the peak stays put, and the move into the next
    // act happens late and lands softly. A small creep (6%) during the
    // hold keeps the frame alive — a completely frozen quarter reads as a
    // stall, not as a held peak.
    peak:      function (p) {
      if (p <= 0.25) return 0.06 * (p / 0.25);
      var t = (p - 0.25) / 0.75;
      return 0.06 + 0.94 * (t * t * (3 - 2 * t));
    },
    breakdown: function (p) { return Math.pow(p, 1.6); },
    outro:     function (p) { return 1 - Math.pow(1 - p, 2.2); },
  };

  function shapeActProgress(actName, progress) {
    var p = typeof progress === 'number' && isFinite(progress) ? progress : 0;
    if (p < 0) p = 0;
    if (p > 1) p = 1;
    var shape = actName && ACT_SHAPE[actName];
    // An unknown act is linear: the old behaviour, unchanged.
    if (!shape) return p;
    var v = shape(p);
    if (typeof v !== 'number' || !isFinite(v)) return p;
    if (v < 0) v = 0;
    if (v > 1) v = 1;
    return v;
  }

  function pickFromPool(pool) {
    var mk = (typeof window !== 'undefined') && window.SWR_MOTION_KILL;
    if (mk && typeof mk.pickAllowedTransition === 'function') {
      return mk.pickAllowedTransition(pool);
    }
    return pool[Math.floor(Math.random() * pool.length)];
  }

  function pickTransition(warmth, intensity, cue, actName) {
    // The cue has an opinion and the act plan does not get a say. One vote,
    // consumed by the caller.
    if (cue && cue.cls === 'subtle') {
      return pickFromPool(SUBTLE);
    }
    if (cue && cue.cls === 'dynamic') {
      return pickFromPool(DYNAMIC);
    }
    // The act's family — the deliberate plan for THIS act. It outranks the
    // warmth/intensity proxy because the act name is the arc's own
    // decision, while warmth/intensity is a continuous guess. The pool
    // comes from the live catalog and is kill-filtered like any other.
    if (actName && ACT_FAMILY[actName]) {
      var pool = familyPool(ACT_FAMILY[actName]);
      if (pool && pool.length) return pickFromPool(pool);
    }
    if (warmth < 0.3 || intensity < 0.3) {
      return pickFromPool(SUBTLE);
    }
    return pickFromPool(DYNAMIC);
  }

  // The plan's picker names 'cross-dissolve'; the shipped vocabulary calls
  // the same beat 'pure-crossfade'. Normalize so a subtle pick never
  // resolves to an unknown name (fire() rejects those).
  var TRANSITION_ALIASES = { 'cross-dissolve': 'pure-crossfade' };

  function fireActTransition(sample) {
    var tx = (typeof window !== 'undefined') && window.SWRTransitions;
    if (!tx || typeof tx.fire !== 'function') return;
    var coords = sample.coords || {};
    // Consume the armed cue here, not in pickTransition(): pickTransition is
    // a pure read that the unit gate calls directly, and a pure function
    // must not be able to spend a one-shot. Whether or not the name resolves
    // to a catalog entry below, the vote is spent either way, so the next act
    // boundary is decided by the plan again.
    var cue = pendingCue;
    pendingCue = null;
    // The act name is the arc's own plan for the act being entered, so the
    // transition that lands on this boundary belongs to that act's family.
    var name = pickTransition(coords.warmth, coords.intensity, cue, sample.actName);
    if (TRANSITION_ALIASES[name]) name = TRANSITION_ALIASES[name];
    var catalog = tx._TRANSITIONS;
    if (catalog && !catalog[name]) return; // unknown → skip, never reject
    try {
      // fire() serializes its own queue; a missing asset or unknown name
      // must never break the arc tick.
      var p = tx.fire(name, { _src: 'automix-arc' });
      if (p && typeof p.catch === 'function') p.catch(function () {});
    } catch (_) { /* ignore */ }
  }

  function tick(arc, currentTime) {
    var sample = sampleAt(arc, currentTime);
    if (!sample) return sample;
    if (arc._lastActIndex == null) {
      arc._lastActIndex = sample.actIndex; // first sample arms tracking
      return sample;
    }
    if (sample.actIndex !== arc._lastActIndex) {
      arc._lastActIndex = sample.actIndex;
      fireActTransition(sample);
    }
    return sample;
  }

  window.SWR_AUTOMIX_ARC = {
    __loaded: true,
    ARC_MIN_DISPLACEMENT: ARC_MIN_DISPLACEMENT,
    build: build,
    sampleAt: sampleAt,
    tick: tick,
    // Live section cue (plan P1.3). onSectionChange is the `swr-section-change`
    // listener and is also callable directly; sectionCue is the armed vote, or
    // null. Reading it does not consume it: only an act transition spends it.
    onSectionChange: onSectionChange,
    onSectionReset: onSectionReset,
    // The act-aware glide shape (pure). The runtime calls it in one line.
    shapeActProgress: shapeActProgress,
    get sectionCue() {
      return pendingCue;
    },
    get lastResetReason() {
      return lastResetReason;
    },
    _internals: {
      pickTransition: pickTransition,
      noteSection: noteSection,
      SECTION_CLASS: SECTION_CLASS,
      MIN_CUE_CONFIDENCE: MIN_CUE_CONFIDENCE,
      SUBTLE: SUBTLE,
      DYNAMIC: DYNAMIC,
      ACT_FAMILY: ACT_FAMILY,
      familyPool: familyPool,
    },
    // Generic analysis for pages whose Audio object lacks .analyzeFull
    // (the variant stubs, e.g. tape). Ensures audio-analysis-v2.js is
    // loaded (variants don't ship it), fetches the element's src (blob
    // URL or path), decodes it, runs AudioAnalysisV2. Returns
    // { duration, bpm, onsets, key, scale, confidence } — the analysis
    // shape build() consumes. Rejects when the analysis script cannot be
    // loaded so callers can retry (see _ensureArc's bounded retry).
    analyzeElement: function (el) {
      if (!el || !el.src) return Promise.resolve(null);
      var AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return Promise.resolve(null);
      var ensureV2 = (window.AudioAnalysisV2)
        ? Promise.resolve()
        : new Promise(function (resolve, reject) {
            var s = document.createElement('script');
            // Absolute path: works from root pages and nested routes alike
            // ('../' silently 404s on any page not exactly one level below
            // the root). Reject on failure so _ensureArc's catch can retry
            // instead of disabling the arc for the rest of the song.
            s.src = '/audio-analysis-v2.js';
            s.onload = function () { resolve(); };
            s.onerror = function () { reject(new Error('audio-analysis-v2.js failed to load')); };
            document.head.appendChild(s);
          });
      return ensureV2.then(function () {
        if (!window.AudioAnalysisV2) return null;
        return fetch(el.src)
          .then(function (r) { return r.arrayBuffer(); })
          .then(function (buf) { return new AC().decodeAudioData(buf); })
          .then(function (audio) {
            var res = window.AudioAnalysisV2.analyzeBuffer(audio);
            if (!res) return null;
            if (!res.duration) res.duration = audio.duration || 0;
            return res;
          });
      });
    },
  };
})();
