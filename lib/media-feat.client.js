// lib/media-feat.client.js — canonical audio-feature extractor for variants
// that load audio through a plain media element (Sprint: automix upgrade).
//
// The canonical feat shape (see versions/neon.html inline Audio object):
//   { bass, mid, treble, air, sub, rms, centroid, beat, onset,
//     beatPulse, onsetPulse, bpm }
// computed from an AnalyserNode (fftSize 2048, smoothing 0.6) exactly as
// neon does. Variants that synthesised fake features (tape) or shipped no
// analysis at all diverged from this shape, which is why they were forced
// to opt out of automix (`enabled: false` in variants/<name>.automix.json).
//
// Usage:
//   var handle = window.SWR_MEDIA_FEAT.attach(el);   // el = <audio>/<video>
//   handle.sample();                                  // once per frame
//   handle.feat   — the live feat object (also mirrored onto
//                   window.SWR.Audio.feat when that namespace exists)
//   handle.detach() — disconnect the graph; call before loading a new
//                   element into the same context.
//
// Idempotent per element: re-attaching the same element returns the
// existing handle. One shared AudioContext; sources are disconnected on
// detach so loading a new file never stacks graphs.

(function () {
  'use strict';

  if (window.SWR_MEDIA_FEAT && window.SWR_MEDIA_FEAT.__loaded) return;
  var ctx = null;
  var handles = new Map(); // element -> handle

  function ensureCtx() {
    if (ctx) return ctx;
    var AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
    return ctx;
  }

  function attach(el) {
    if (!el) return null;
    if (handles.has(el)) return handles.get(el);

    var ac = ensureCtx();
    if (!ac) return null;

    var an = ac.createAnalyser();
    an.fftSize = 2048;
    an.smoothingTimeConstant = 0.6;
    var src = ac.createMediaElementSource(el);
    src.connect(an);
    an.connect(ac.destination);

    var fft = new Uint8Array(an.frequencyBinCount);
    var time = new Uint8Array(an.fftSize);

    var feat = {
      bass: 0, mid: 0, treble: 0, air: 0, sub: 0, rms: 0, centroid: 0,
      beat: 0, onset: 0, beatPulse: false, onsetPulse: false, bpm: 0,
    };
    var hist = { prev: null, bassAvg: 0, fluxAvg: 0 };
    var beats = [];
    var lastBeat = 0;
    // Gate/decay constants from the canonical neon implementation
    // (params.sens is unused there too; gate and decay drive onset/beat).
    var GATE = 1.2, DECAY = 0.7, MIN_FLUX = 0.02, MIN_BEAT_BASS = 0.18;

    function lerp(a, b, t) { return a + (b - a) * t; }

    var handle = {
      feat: feat,
      an: an,
      sample: function () {
        if (!el || el.paused) { feat.beatPulse = false; feat.onsetPulse = false; return feat; }
        an.getByteFrequencyData(fft);
        an.getByteTimeDomainData(time);
        var N = fft.length, sr = ac.sampleRate, hz = sr / an.fftSize;
        var subLo = 1, subHi = Math.floor(60 / hz);
        var bassHi = Math.floor(250 / hz), midHi = Math.floor(2000 / hz);
        var trebHi = Math.floor(6000 / hz);
        function mean(lo, hi) {
          var s = 0, c = 0;
          for (var i = lo; i <= hi && i < N; i++) { s += fft[i]; c++; }
          return c ? s / c / 255 : 0;
        }
        feat.sub = mean(subLo, subHi);
        feat.bass = mean(subHi + 1, bassHi);
        feat.mid = mean(bassHi + 1, midHi);
        feat.treble = mean(midHi + 1, trebHi);
        feat.air = mean(trebHi + 1, N - 1);
        var rms = 0, i;
        for (i = 0; i < time.length; i++) { var v = (time[i] - 128) / 128; rms += v * v; }
        feat.rms = Math.sqrt(rms / time.length);
        var num = 0, den = 0;
        for (i = 1; i < N; i++) { num += i * fft[i]; den += fft[i]; }
        feat.centroid = den > 0 ? num / den / N : 0;

        var flux = 0;
        if (hist.prev) {
          for (i = 1; i < N; i++) { var d = fft[i] - hist.prev[i]; if (d > 0) flux += d; }
        }
        flux /= 255 * N;
        hist.fluxAvg = lerp(hist.fluxAvg, flux, 0.08);
        var onsetHit = flux > hist.fluxAvg * GATE && flux > MIN_FLUX;
        hist.bassAvg = lerp(hist.bassAvg, feat.bass, 0.06);
        var beatHit = feat.bass > hist.bassAvg * GATE && feat.bass > MIN_BEAT_BASS;

        var now = ac.currentTime;
        if (beatHit && now - lastBeat > 0.25) {
          lastBeat = now;
          beats.push(now);
          while (beats.length && beats[0] < now - 8) beats.shift();
          if (beats.length >= 4) {
            var t = 0;
            for (i = 1; i < beats.length; i++) t += beats[i] - beats[i - 1];
            var a = t / (beats.length - 1);
            if (a > 0) feat.bpm = Math.round(60 / a);
          }
        }
        feat.beat = beatHit ? 1 : feat.beat * DECAY;
        feat.onset = onsetHit ? 1 : feat.onset * DECAY;
        feat.beatPulse = beatHit;
        feat.onsetPulse = onsetHit;
        hist.prev = Uint8Array.from(fft);

        // Mirror onto the canonical namespace consumed by automix-runtime
        // (window.SWR.Audio.feat) and fx-postprocess.js.
        try {
          window.SWR = window.SWR || {};
          window.SWR.Audio = window.SWR.Audio || {};
          window.SWR.Audio.feat = feat;
        } catch (_) {}
        return feat;
      },
      detach: function () {
        try { src.disconnect(); } catch (_) {}
        try { an.disconnect(); } catch (_) {}
        handles.delete(el);
      },
    };
    handles.set(el, handle);
    return handle;
  }

  window.SWR_MEDIA_FEAT = { __loaded: true, attach: attach };
})();
