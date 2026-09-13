// client/hologram-presets.client.js
//
// Phase 2 (Phase B in the plan-doc) of the music_video.html hologram
// preset engine. Pure compute + interface — no DOM, no audio runtime,
// no integration with applyR() (that's Phase D).
//
// Two pieces:
//   1. PresetMap — embeds each manifest preset into a 4D coordinate
//      (mood, complexity, motion, color_temp) by reading its
//      fx_state / audio_reactivity / motion blocks. Deterministic.
//   2. HologramInterpolator — given a track feature vector and a
//      focus preset id, returns a blend map Σblend[i] = 1 over the 16
//      manifest presets. Default strategy: gaussian-weighted nearest
//      neighbours. `depth` slider flattens toward uniform; `focus`
//      slider sharpens the focus preset's weight.
//
// Why 4D, not the 2D of preset-anchor-map.client.js: this engine
// blends more than one preset at a time, and we want the four axes
// to be perceptually meaningful for four different keyboard axes
// (←/→ mood, ↑/↓ complexity, ',.' motion, [/] color_temp — see the
// plan-doc). 4 dimensions is enough to keep the four axes from
// collapsing into one ranking.
//
// Why we don't store the embedding in the manifest itself: the
// embedding is derived (4 axes from many knobs), not authored. A
// preset's mood/intensity reading depends on the rest of the library
// (rank-percentile mixing in preset-anchor-map); mixing is intentional
// here too.
//
// UMD-ish: attaches to window.SWR_HOLOGRAM in browsers and
// globalThis.SWR_HOLOGRAM in Node-like environments so the same file
// can be loaded by music_video.html and required by
// scripts/check-mv-unit.mjs without modification.
//
// Loaded after window.SWR_HOLOGRAM guard (idempotent).

(function (root) {
  'use strict';
  if (root.SWR_HOLOGRAM) return;

  // ---- Embedding formula ---------------------------------------------
  //
  // mood       in [0,1]  calm(0) → intense(1)
  //   bloom*0.4 + chroma*0.3 + mut*0.3  (the perceptual "intensity
  //                                       levers" of the GLSL family)
  // complexity in [0,1]  simple(0) → complex(1)
  //   posterize/16 + (liquor||0)*0.4 + ar_keys/4
  //     where ar_keys = number of distinct audio_reactivity features
  //     referenced (bass/mid/treble/onset = up to 4).
  // motion     in [0,1]  static(0) → kinetic(1)
  //   |rot|*4 + |sp|*2 + |pan_x|*2 + |pan_y|*2, clamped.
  // color_temp in [0,1]  cool(0) → warm(1)
  //   max(0, temp)*0.7 + max(0, sepia)*0.5  + warmth = chroma*0.1
  //
  // Each is then rank-percentile-mixed 60/40 with the raw value across
  // the population, mirroring preset-anchor-map.client.js. The 60/40
  // split keeps raw ordering (a calm preset doesn't outrank an intense
  // one) while spreading visually for the scatter panel.
  function rawEmbed(p) {
    var fx = p.fx_state || {};
    var motion = p.motion || {};
    var ar = p.audio_reactivity || {};

    var mood =
      (fx.bloom || 0) * 0.4 +
      (fx.chroma || 0) * 0.3 +
      (fx.mut || 0) * 0.3;

    var arKeys = (ar.bass ? 1 : 0) + (ar.mid ? 1 : 0) +
                 (ar.treble ? 1 : 0) + (ar.onset ? 1 : 0);

    var complexity =
      ((fx.posterize || 0) / 16) * 0.5 +
      (arKeys / 4) * 0.5;

    var m = Math.abs(motion.rotation_speed || 0) * 4 +
            Math.abs(motion.scale_pulse || 0) * 2 +
            Math.abs(motion.pan_x || 0) * 2 +
            Math.abs(motion.pan_y || 0) * 2;

    var colorTemp =
      Math.max(0, fx.temp || 0) * 0.7 +
      Math.max(0, fx.sepia || 0) * 0.5;

    function clamp01(x) { return Math.max(0, Math.min(1, x)); }
    return {
      mood:       clamp01(mood),
      complexity: clamp01(complexity),
      motion:     clamp01(m),
      color_temp: clamp01(colorTemp),
    };
  }

  // Rank-percentile mix across a population. Mirrors the 60/40 split
  // in preset-anchor-map. `values` is an array of raw numbers in the
  // same order as `ids`; returns a map id → mixed value in [0,1].
  function rankMix(ids, raw) {
    var n = ids.length;
    if (n === 0) return {};
    var sorted = ids.slice().sort(function (a, b) { return raw[a] - raw[b]; });
    var rankMap = {};
    for (var i = 0; i < n; i++) rankMap[sorted[i]] = n === 1 ? 0.5 : i / (n - 1);
    var mixed = {};
    for (var j = 0; j < n; j++) {
      var id = ids[j];
      mixed[id] = raw[id] * 0.6 + rankMap[id] * 0.4;
    }
    return mixed;
  }

  function sqDist(a, b) {
    var d = 0;
    var keys = ['mood', 'complexity', 'motion', 'color_temp'];
    for (var i = 0; i < keys.length; i++) {
      var k = keys[i];
      var dx = (a[k] || 0) - (b[k] || 0);
      d += dx * dx;
    }
    return d;
  }

  // Normalize an array of weights so they sum to 1. If all weights
  // are zero, returns a uniform distribution. (The latter is the
  // edge case where every preset is at the same distance — uniform
  // is the only fair fallback.)
  function normalize(weights) {
    var sum = 0;
    for (var i = 0; i < weights.length; i++) sum += weights[i];
    if (sum <= 0) {
      var u = 1 / weights.length;
      return weights.map(function () { return u; });
    }
    return weights.map(function (w) { return w / sum; });
  }

  function buildPresetMap(manifestPresets) {
    var ids = manifestPresets.map(function (p) { return p.id; });
    var raw = {};
    var raws = { mood: {}, complexity: {}, motion: {}, color_temp: {} };
    for (var i = 0; i < manifestPresets.length; i++) {
      var p = manifestPresets[i];
      var r = rawEmbed(p);
      raw[p.id] = r;
      raws.mood[p.id] = r.mood;
      raws.complexity[p.id] = r.complexity;
      raws.motion[p.id] = r.motion;
      raws.color_temp[p.id] = r.color_temp;
    }
    var moodMix = rankMix(ids, raws.mood);
    var compMix = rankMix(ids, raws.complexity);
    var motMix = rankMix(ids, raws.motion);
    var tempMix = rankMix(ids, raws.color_temp);

    var embeds = {};
    for (var j = 0; j < ids.length; j++) {
      var id = ids[j];
      embeds[id] = {
        mood: moodMix[id],
        complexity: compMix[id],
        motion: motMix[id],
        color_temp: tempMix[id],
      };
    }
    // Inline 4D-distance against the embedding (not against the
    // raw knobs — neighboursFn ranks by the same mixed values the
    // rest of the engine reads).
    function neighboursFn(coords, n) {
      n = (typeof n === 'number' && n > 0) ? n : 4;
      var ordered = ids.map(function (id) {
        var a = embeds[id];
        var d2 = sqDist(coords || {}, a);
        return { id: id, anchor: a, dist: Math.sqrt(d2) };
      });
      ordered.sort(function (x, y) { return x.dist - y.dist; });
      return ordered.slice(0, n);
    }
    return {
      list: function () { return ids.slice(); },
      get: function (id) { return embeds[id] || null; },
      embed: function (p) { return rawEmbed(p); },
      rawEmbed: rawEmbed,
      neighbours: neighboursFn,
      _all: function () { return embeds; },
      _raw: function () { return raw; },
    };
  }

  // HologramInterpolator
  //
  // Input:
  //   features   — { mood, complexity, motion, color_temp } in [0,1]^4
  //   focusId    — id of the focus preset (must exist in the map)
  //   depth      — 0..1. 0 means focus dominates; 1 means uniform
  //                blend across all presets.
  //   focus      — 0..1. 0 = pure hologram (no bias toward focus);
  //                1 = pinned to the focus preset entirely.
  //   sigma      — gaussian width in 4D distance units. Default 0.25
  //                (≈ one normalised axis). Tests can override.
  //
  // Output:
  //   { [presetId]: weight, _focus: id, _depth, _focus_amount }
  //   weights sum to 1.
  //
  // Algorithm:
  //   1. For each preset, compute sqDist(features, embed[preset]).
  //   2. Weights_i = exp(-dist² / σ²).
  //   3. depth > 0 flat-toward-uniform:
  //        w' = w*(1-depth) + uniform*depth
  //      (depth=0 keeps raw gaussian; depth=1 makes every weight 1/N.)
  //   4. focus > 0 sharpens:
  //        w[focus] = w[focus]*(1 + focus*5), other w reduced by
  //        (1 - focus*0.6) so weights still sum to 1 after renorm.
  //      (focus=0 leaves step 3 untouched.)
  //   5. Renormalize.
  //
  // The focus boost is multiplicative so it survives the depth-flatten;
  // focus=1 essentially returns {focusId: 1, *: 0}.
  function computeBlend(presetMap, features, focusId, depth, focus, sigma) {
    sigma = (typeof sigma === 'number') ? sigma : 0.25;
    depth = Math.max(0, Math.min(1, depth || 0));
    focus = Math.max(0, Math.min(1, focus || 0));

    var ids = presetMap.list();
    var N = ids.length;
    if (N === 0) return { _focus: focusId, _depth: depth, _focus_amount: 0 };

    var d2s = new Array(N);
    for (var i = 0; i < N; i++) {
      var embed = presetMap.get(ids[i]);
      d2s[i] = sqDist(features || {}, embed);
    }
    var inv2s = new Array(N);
    for (var j = 0; j < N; j++) inv2s[j] = Math.exp(-d2s[j] / (sigma * sigma));

    // Depth: flatten toward uniform.
    var uniform = 1 / N;
    if (depth > 0) {
      for (var k = 0; k < N; k++) {
        inv2s[k] = inv2s[k] * (1 - depth) + uniform * depth;
      }
    }

    // Focus: sharpen.
    if (focus > 0 && focusId && presetMap.get(focusId)) {
      var focusIdx = ids.indexOf(focusId);
      if (focusIdx >= 0) {
        inv2s[focusIdx] = inv2s[focusIdx] * (1 + focus * 5);
        var shrink = 1 - focus * 0.6;
        for (var m = 0; m < N; m++) {
          if (m !== focusIdx) inv2s[m] = inv2s[m] * shrink;
        }
      }
    }

    var normalized = normalize(inv2s);
    var weights = {};
    var focusAmount = 0;
    for (var p = 0; p < N; p++) {
      weights[ids[p]] = normalized[p];
      if (ids[p] === focusId) focusAmount = normalized[p];
    }
    return weights;
  }

  function makeHologram(manifestPresets) {
    var presetMap = buildPresetMap(manifestPresets || []);
    return {
      presetMap: presetMap,
      computeBlend: function (features, focusId, depth, focus, sigma) {
        return computeBlend(presetMap, features, focusId, depth, focus, sigma);
      },
      embed: function (p) { return presetMap.embed(p); },
      list: function () { return presetMap.list(); },
    };
  }

  // ---- Public API ----------------------------------------------------
  //
  // window.SWR_HOLOGRAM = {
  //   build(manifestPresets) → Hologram instance
  //   _impl: { rawEmbed, rankMix, sqDist, normalize, computeBlend,
  //            buildPresetMap }   // for tests
  // }

  root.SWR_HOLOGRAM = {
    build: makeHologram,
    _impl: {
      rawEmbed: rawEmbed,
      rankMix: rankMix,
      sqDist: sqDist,
      normalize: normalize,
      buildPresetMap: buildPresetMap,
      computeBlend: computeBlend,
    },
  };
})(typeof window !== 'undefined' ? window : globalThis);
