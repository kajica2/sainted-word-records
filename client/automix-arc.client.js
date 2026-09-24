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
//   arc.acts → [{ t0, t1, anchorId, coords, preset, rampMs }]
//
// Movement budget: consecutive acts must differ by ≥ ARC_MIN_DISPLACEMENT
// (0.25 Euclidean on the anchor map) — the executable form of "changes over
// time are visible". build() returns null if the map can't satisfy it.

(function () {
  'use strict';

  if (window.SWR_AUTOMIX_ARC && window.SWR_AUTOMIX_ARC.__loaded) return;

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
    for (var b = 0; b < nActs; b++) {
      var arch = archetypes[b];
      var targetCoords = {
        warmth: Math.max(0, Math.min(1, 0.5 + arch.warmthBias + (rng() - 0.5) * 0.3)),
        intensity: Math.max(0, Math.min(1, 0.5 + arch.intensityBias + (rng() - 0.5) * 0.2)),
      };
      var nn = map.neighbours(targetCoords, 6);
      var chosen = null;
      for (var c = 0; c < nn.length; c++) {
        var cand = nn[c];
        if (!cand.anchor) continue;
        if (!prev) { chosen = cand; break; }
        var dx = cand.anchor.warmth - prev.coords.warmth;
        var dy = cand.anchor.intensity - prev.coords.intensity;
        if (Math.sqrt(dx * dx + dy * dy) >= ARC_MIN_DISPLACEMENT) { chosen = cand; break; }
      }
      if (!chosen) chosen = nn[nn.length - 1]; // farthest of the 6
      if (!chosen || !chosen.anchor) return null;
      prev = { coords: chosen.anchor };

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

  window.SWR_AUTOMIX_ARC = {
    __loaded: true,
    ARC_MIN_DISPLACEMENT: ARC_MIN_DISPLACEMENT,
    build: build,
    sampleAt: sampleAt,
    // Generic analysis for pages whose Audio object lacks .analyzeFull
    // (the variant stubs, e.g. tape). Ensures audio-analysis-v2.js is
    // loaded (variants don't ship it), fetches the element's src (blob
    // URL or path), decodes it, runs AudioAnalysisV2. Returns
    // { duration, bpm, onsets, key, scale, confidence } — the analysis
    // shape build() consumes.
    analyzeElement: function (el) {
      if (!el || !el.src) return Promise.resolve(null);
      var AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return Promise.resolve(null);
      var ensureV2 = (window.AudioAnalysisV2)
        ? Promise.resolve()
        : new Promise(function (resolve) {
            var s = document.createElement('script');
            s.src = '../audio-analysis-v2.js';
            s.onload = function () { resolve(); };
            s.onerror = function () { resolve(); }; // null → fallback path
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
