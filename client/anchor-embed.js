// client/anchor-embed.js
//
// Shared audio-features → (warmth, intensity) embedding. Both the automix
// mixer (client/automix.client.js) and the gradient panel (music_video.html
// Gradient IIFE) consume this so a song and its automix blend land at the
// same coordinates on the gradient canvas.
//
// Single source of truth: client/anchor-embed.js. Phase C refactor.
// Previously duplicated as `featuresToCoords` in automix.client.js and
// `coordsFromFeatures` in music_video.html:1240; both now delegate here.
//
// Public API
//   window.SWR_ANCHOR_EMBED.featuresToCoords(features) -> { warmth, intensity }
//     features: { bass, mid, treb } (the three fields from SWR.Audio.feat
//               that anchor the embedding; other feat fields ignored).
//     Null/undefined features returns the safe midpoint (0.5, 0.5).
//     Bass-dominant -> warmth > 0.5 (warm); treb-dominant -> warmth < 0.5
//     (cool); balanced -> warmth = 0.5. Intensity is mid+treb energy with a
//     bass floor, clipped to [0, 1].
//
// Pure function — no DOM, no audio reads, no globals beyond Math.

(function () {
  'use strict';
  if (window.SWR_ANCHOR_EMBED) return; // idempotent

  function featuresToCoords(features) {
    if (!features) return { warmth: 0.5, intensity: 0.5 };
    var bass = features.bass || 0;
    var mid  = features.mid  || 0;
    var treb = features.treb || 0;
    // Warmth 0..1: bass-dominant → 0.8+, treb-dominant → 0.2-, balanced → 0.5
    var warmth = Math.max(0, Math.min(1, 0.5 + (bass - treb) * 0.5));
    // Intensity 0..1: mid+treb energy sum, clipped
    var intensity = Math.min(1, (mid + treb) * 0.9 + bass * 0.1);
    return { warmth: warmth, intensity: intensity };
  }

  window.SWR_ANCHOR_EMBED = { featuresToCoords: featuresToCoords };
})();