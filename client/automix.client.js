// client/automix.client.js
// Self-evolving smart automixer for the music_video page.
//
// While enabled, periodically synthesizes a fresh fx_state preset by:
//   1. Mapping the live audio features (bass/mid/treb/beat) into the
//      same 2D (warmth, intensity) space as SWR_ANCHOR_MAP.
//   2. Looking up the N nearest anchor presets.
//   3. Returning a weighted blend of those anchors' fx_state values.
//   4. Applying a small bounded random walk ("mutation drift") so the
//      visual evolves instead of locking onto one anchor mix.
//
// The page consumes the blended fx_state via window.SWR._fxOverride;
// the GLSL render loop reads it each frame instead of the static page
// preset. This module is pure (no DOM, no audio reads outside the
// passed-in `features` argument) so it can be unit-tested under Node
// without a browser.

(function () {
  'use strict';
  if (window.SWR_AUTOMIX) return;

  // ---- Anchor read --------------------------------------------------------
  // We re-read SWR_ANCHOR_MAP.neighbours() each tick so the map stays
  // in sync if the page loads more presets in the future. No caching.
  function nearestAnchors(coords, n) {
    if (!window.SWR_ANCHOR_MAP || !window.SWR_ANCHOR_MAP.neighbours) return [];
    return window.SWR_ANCHOR_MAP.neighbours(coords, n);
  }

  // ---- Feature → coords ---------------------------------------------------
  // Maps the live audio bands into (warmth, intensity). Bass-heavy
  // tracks feel "warm" + "low-intensity" (sepia-ish), treble-heavy
  // tracks feel "cool" + "high-intensity" (chroma/grain).
  //
  // Delegates to client/anchor-embed.js (Phase C single source of truth)
  // so the gradient panel and the automix blend always land at the same
  // coordinates for the same features. If anchor-embed.js failed to
  // load (load-order bug), fall back to the previous local implementation
  // so automix still works.
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

  // ---- Weighted blend of anchor fx_state ----------------------------------
  // weights ∝ 1 / (dist + ε) so closer anchors dominate. Output
  // preserves the schema of anchor.preset (8 fields).
  var FIELDS = ['temp','mut','sepia','chroma','grain','glow','grayscale','posterize'];
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

  // ---- Mutation drift -----------------------------------------------------
  // Tiny bounded random walk on the blended values so the visual
  // doesn't lock. The step amplitude scales with the live audio beat
  // (0..1, decaying after each detected beat):
  //   beat = 0   → step ±0.005  (gentle, no rhythmic anchor)
  //   beat = 1   → step ±0.015  (3× more, the visual breathes with tempo)
  //   beat undefined / omitted → step ±0.005  (backward-compat default)
  // Linear scale: amplitude = 0.005 + 0.01 * beat. Each field is
  // clamped to [-1, 1] so the visual stays in its safe range.
  function drift(preset, beat) {
    if (!preset) return preset;
    var b = (typeof beat === 'number' && isFinite(beat)) ? Math.max(0, Math.min(1, beat)) : 0;
    var amplitude = 0.005 + 0.01 * b;
    var out = {};
    for (var k in preset) {
      if (!Object.prototype.hasOwnProperty.call(preset, k)) continue;
      var delta = (Math.random() - 0.5) * 2 * amplitude;
      out[k] = Math.max(-1, Math.min(1, preset[k] + delta));
    }
    return out;
  }

  // ---- Public API ---------------------------------------------------------
  // mix(features, neighbours) → { coords, anchors, preset }
  // features: { bass, mid, treb } from the engine (beat is optional,
  //   used to scale the drift amplitude — see drift() above). Pass
  //   features.beat when available so the visual breathes with the
  //   tempo; omit for backward-compat callers.
  // neighbours: int, default HologramState.neighbours || 4
  function mix(features, neighbours) {
    var n = neighbours || (window.HologramState && window.HologramState.neighbours) || 4;
    var coords = featuresToCoords(features);
    var anchors = nearestAnchors(coords, n);
    if (!anchors.length) return null;
    var preset = blendAnchors(anchors);
    var beat = features ? features.beat : undefined;
    return {
      coords: coords,
      anchors: anchors.map(function (a) { return { id: a.id, dist: a.dist }; }),
      preset: drift(preset, beat),
    };
  }

  window.SWR_AUTOMIX = { mix: mix, featuresToCoords: featuresToCoords, blendAnchors: blendAnchors, drift: drift };
})();
