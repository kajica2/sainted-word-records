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
  function featuresToCoords(features) {
    if (!features) return { warmth: 0.5, intensity: 0.5 };
    var bass = (features.bass || 0);
    var mid  = (features.mid  || 0);
    var treb = (features.treb || 0);
    // Warmth 0..1: bass-dominant → 0.8+, treb-dominant → 0.2-, balanced → 0.5
    var warmth = 0.5 + (bass - treb) * 0.5;
    warmth = Math.max(0, Math.min(1, warmth));
    // Intensity 0..1: mid+treb energy sum, clipped
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
  // doesn't lock. step ≤ 0.02 keeps the drift musically invisible.
  function drift(preset) {
    if (!preset) return preset;
    var out = {};
    for (var k in preset) {
      if (!Object.prototype.hasOwnProperty.call(preset, k)) continue;
      var delta = (Math.random() - 0.5) * 0.02;
      out[k] = Math.max(-1, Math.min(1, preset[k] + delta));
    }
    return out;
  }

  // ---- Public API ---------------------------------------------------------
  // mix(features, neighbours) → { coords, anchors, preset }
  // features: { bass, mid, treb } from the engine
  // neighbours: int, default HologramState.neighbours || 4
  function mix(features, neighbours) {
    var n = neighbours || (window.HologramState && window.HologramState.neighbours) || 4;
    var coords = featuresToCoords(features);
    var anchors = nearestAnchors(coords, n);
    if (!anchors.length) return null;
    var preset = blendAnchors(anchors);
    return {
      coords: coords,
      anchors: anchors.map(function (a) { return { id: a.id, dist: a.dist }; }),
      preset: drift(preset),
    };
  }

  window.SWR_AUTOMIX = { mix: mix, featuresToCoords: featuresToCoords, blendAnchors: blendAnchors, drift: drift };
})();
