// lib/audio-damp.client.js — exponential smoothing for audio feature
// values used across all variants. Each variant reads A.feat.{bass,mid,...}
// directly in its drawLayer / applyR, which makes values jitter on every
// frame (audio analyser quantizes noisily even when nothing is changing).
// Wrapping each value in a damped follower yields visibly smoother
// motion — bass sways breathe instead of stutter, scale/rotation/pos
// pulses settle between beats, particles drift instead of twitch.
//
// Usage:
//   const D = SWR_AUDIO.damp;          // shorthand for the damp() helper
//   const bass = D(A.feat.bass, 0.6);  // 0.6s half-life smoothing
//   // or wrap multiple features at once:
//   const f = SWR_AUDIO.smoothAll(A.feat, 0.5);
//   bass = f.bass; mid = f.mid; ...     // each is independently damped
//
// Math: half-life in seconds → smoothing factor per frame at 60fps:
//   alpha = 1 - exp(-ln(2) / (halfLife * 60))
//   y[t] = y[t-1] + alpha * (x[t] - y[t-1])
// Lower halfLife = snappier; higher = smoother. 0.3-0.7s is the sweet
// spot for most audio-reactive visual content.

(function () {
  'use strict';
  if (window.SWR_AUDIO_DAMP) return;

  // Per-feature last-value cache. We key by the value itself + an instance
  // id so multiple damp() calls on the same value don't alias each other
  // (e.g. one place reads it for scale, another for opacity, with different
  // half-lives).
  var cache = new WeakMap();

  function damp(x, halfLife, instanceId) {
    if (typeof x !== 'number' || isNaN(x)) return 0;
    halfLife = halfLife || 0.4;
    instanceId = instanceId || x;
    var alpha = 1 - Math.exp(-Math.LN2 / (halfLife * 60));
    var prev = cache.get(instanceId);
    if (prev == null || isNaN(prev)) prev = x;
    var next = prev + alpha * (x - prev);
    cache.set(instanceId, next);
    return next;
  }

  function smoothAll(feat, halfLife) {
    halfLife = halfLife || 0.4;
    var out = {};
    for (var k in feat) {
      if (Object.prototype.hasOwnProperty.call(feat, k) && typeof feat[k] === 'number') {
        out[k] = damp(feat[k], halfLife, feat);
      } else {
        out[k] = feat[k];
      }
    }
    return out;
  }

  // Frame-rate-independent damp — pass dt in seconds and the smoothing
  // is the same regardless of fps.
  function dampDt(x, halfLife, dt, instanceId) {
    if (typeof x !== 'number' || isNaN(x)) return 0;
    if (!dt || isNaN(dt) || dt < 0) dt = 1 / 60;
    halfLife = halfLife || 0.4;
    var alpha = 1 - Math.exp(-Math.LN2 * dt / halfLife);
    var prev = cache.get(instanceId || x);
    if (prev == null || isNaN(prev)) prev = x;
    var next = prev + alpha * (x - prev);
    cache.set(instanceId || x, next);
    return next;
  }

  window.SWR_AUDIO_DAMP = { damp: damp, dampDt: dampDt, smoothAll: smoothAll };
})();
