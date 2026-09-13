// client/track-analyzer.client.js
//
// Phase C (Phase 3 of plan-doc) of the music_video.html hologram
// preset engine. Wraps window.AudioAnalysisV2.analyzeBuffer() and
// adds the three extra features the plan-doc asks for:
//
//   - centroid         spectral centroid, normalized to [0, 1]
//                       across the human-audible spectrum (0 Hz
//                       → 0, nyquist/2 → 1). Computed from a single
//                       FFT magnitude pass using
//                       window.__AudioAnalysisV2Internals.
//   - dynamicRange     95th - 5th percentile of per-window RMS over
//                       50ms hops. Cheap energy variance proxy.
//   - onsetDensity     onsets.length / duration (Hz).
//
// Public API:
//   window.SWR_TRACK_ANALYZE(file: Blob | File) → Promise<{
//     bpm: number,
//     key: string,           // 'C', 'C#', …
//     scale: 'major' | 'minor',
//     confidence: number,    // 0..1, Krumhansl-Schmuckler
//     chromagram: Float32Array(12),
//     onsets: number[],      // seconds
//     duration: number,      // seconds
//     centroid: number,      // 0..1
//     dynamicRange: number,  // 0..1 (rough, normalized)
//     onsetDensity: number,  // onsets per second
//   }>
//
// Pure browser-side. Phase D (hologram integration) consumes the
// mood/complexity/motion/color_temp vector that the audio features
// are mapped into. That mapping lives in this file too, as a
// utility `audioToFeatures(features)` returning a 4-vector in the
// same space the presets use.
//
// edge cases:
//   - silent file       → bpm=0, centroid=0, dynamicRange=0
//   - file < 1s         → analysis still runs on whatever is there
//   - decode failure    → throws; caller should catch
//   - empty buffer      → returns all-zero features + key='C'
//
// Loaded after audio-analysis-v2.js. Idempotent.
// window.AudioAnalysisV2 is required; if absent, SWR_TRACK_ANALYZE
// throws on call (no silent fallback so callers don't think they
// got real numbers when the engine never ran).

(function (root) {
  'use strict';
  if (root.SWR_TRACK_ANALYZE) return;

  // ───────── helpers ─────────
  function clamp01(x) { return Math.max(0, Math.min(1, x)); }

  // Percentile of a sorted ascending array, linear interp.
  function percentile(sorted, p) {
    var n = sorted.length;
    if (n === 0) return 0;
    if (n === 1) return sorted[0];
    var i = (p / 100) * (n - 1);
    var lo = Math.floor(i);
    var hi = Math.ceil(i);
    if (lo === hi) return sorted[lo];
    return sorted[lo] + (i - lo) * (sorted[hi] - sorted[lo]);
  }

  // 50ms-RMS per window over a mono buffer.
  function rmsBins(mono, sampleRate, hopSec) {
    var hop = Math.max(1, Math.floor(sampleRate * hopSec));
    var n = Math.max(1, Math.floor(mono.length / hop));
    var bins = new Array(n);
    for (var i = 0; i < n; i++) {
      var start = i * hop;
      var sum = 0;
      for (var j = 0; j < hop && start + j < mono.length; j++) {
        var s = mono[start + j];
        sum += s * s;
      }
      bins[i] = Math.sqrt(sum / hop);
    }
    return bins;
  }

  // Spectral centroid over a magnitude array (one FFT snapshot).
  // Returns normalized [0, 1] where 0 = DC, 1 = last bin.
  function spectralCentroid(magnitudes) {
    var n = magnitudes.length;
    if (n === 0) return 0;
    var sumW = 0, sumM = 0;
    for (var i = 0; i < n; i++) {
      var m = magnitudes[i];
      sumW += m * i;
      sumM += m;
    }
    if (sumM <= 0) return 0;
    return clamp01(sumW / sumM / (n - 1));
  }

  // Convert raw mono Float32Array to one FFT magnitude snapshot for
  // the centroid calculation. We avoid pulling in a real FFT for a
  // single centroid — a 4096-point Hann windowed slice through
  // __AudioAnalysisV2Internals.computeMagnitudes gives a valid
  // spectral centroid. Window from 50% of the buffer to skip the
  // attack.
  function magnitudesForCentroid(mono, sampleRate) {
    var internals = root.__AudioAnalysisV2Internals;
    if (!internals || typeof internals.computeMagnitudes !== 'function') {
      return null;
    }
    var fftSize = 4096;
    var start = Math.floor(mono.length * 0.5);
    var end = Math.min(mono.length, start + fftSize);
    var seg = new Float32Array(end - start);
    for (var i = 0; i < seg.length; i++) seg[i] = mono[start + i];
    return internals.computeMagnitudes(seg, sampleRate, fftSize);
  }

  // Mix an AudioBuffer to mono Float32Array (one channel).
  function mixToMono(audioBuffer) {
    var len = audioBuffer.length;
    var channels = audioBuffer.numberOfChannels;
    var mono = new Float32Array(len);
    for (var c = 0; c < channels; c++) {
      var data = audioBuffer.getChannelData(c);
      for (var i = 0; i < len; i++) mono[i] += data[i] / channels;
    }
    return mono;
  }

  // Map the raw audio features into the 4D space the hologram
  // presets are embedded in. The mapping is intentionally simple:
  // each [0, 1] audio feature → one 4D axis or linear blend.
  //
  //   mood       ← dynamicRange (varied dynamics → high mood)
  //                 + (bpm > 100 ? 0.2 : 0)
  //   complexity ← onsetDensity saturating at 4 onsets/sec
  //   motion     ← bpm / 200 (clamped) — 200 BPM = max kinetic
  //   color_temp ← spectral centroid (low centroid = warm, high = cool)
  //
  // Callers can override or extend these mappings later; this is
  // the v1 default.
  function audioToFeatures(audioResult) {
    var bpm = audioResult.bpm || 0;
    var dynamicRange = audioResult.dynamicRange || 0;
    var onsetDensity = audioResult.onsetDensity || 0;
    var centroid = audioResult.centroid || 0;

    var mood = clamp01(dynamicRange + (bpm > 100 ? 0.2 : 0));
    var complexity = clamp01(onsetDensity / 4);
    var motion = clamp01(bpm / 200);
    // Invert: low centroid (bass-heavy) = warm = 1; high = cool = 0.
    var colorTemp = clamp01(1 - centroid);

    return { mood: mood, complexity: complexity, motion: motion, color_temp: colorTemp };
  }

  // ───────── public ─────────

  async function analyze(file) {
    if (!file) throw new Error('SWR_TRACK_ANALYZE: no file');
    if (!root.AudioAnalysisV2 || typeof root.AudioAnalysisV2.analyzeBuffer !== 'function') {
      throw new Error('SWR_TRACK_ANALYZE: AudioAnalysisV2 not loaded');
    }

    // Decode via OfflineAudioContext or regular AudioContext as
    // available. OfflineAudioContext is preferred so the user
    // device's audio routing doesn't matter.
    var arrayBuffer = await file.arrayBuffer();
    var Ctx = root.OfflineAudioContext || root.webkitOfflineAudioContext
           || root.AudioContext || root.webkitAudioContext;
    if (!Ctx) throw new Error('SWR_TRACK_ANALYZE: no WebAudio context available');

    // OfflineAudioContext needs a length arg; for decode-only we
    // can give it a dummy length and feed the buffer in. The decode
    // path doesn't actually render, so 1 sample is enough.
    var ctx;
    if (root.OfflineAudioContext) {
      try {
        ctx = new Ctx(1, 1, 44100);
      } catch (_) {
        // Some browsers throw if first arg is wrong; fall back to
        // AudioContext.
        ctx = new (root.AudioContext || root.webkitAudioContext)();
      }
    } else {
      ctx = new Ctx();
    }

    var decoded = await ctx.decodeAudioData(arrayBuffer);

    // Existing analysis
    var r = root.AudioAnalysisV2.analyzeBuffer(decoded);

    // Derived features
    var mono = mixToMono(decoded);
    var mags = magnitudesForCentroid(mono, decoded.sampleRate);
    var centroid = mags ? spectralCentroid(mags) : 0;

    var bins = rmsBins(mono, decoded.sampleRate, 0.05);
    var sorted = bins.slice().sort(function (a, b) { return a - b; });
    var dynamicRange = clamp01(percentile(sorted, 95) - percentile(sorted, 5));

    var onsetDensity = (r.duration > 0)
      ? (r.onsets.length / r.duration)
      : 0;

    return {
      bpm: r.bpm,
      key: r.key,
      scale: r.scale,
      confidence: r.confidence,
      chromagram: r.chromagram,
      onsets: r.onsets,
      duration: r.duration,
      centroid: centroid,
      dynamicRange: dynamicRange,
      onsetDensity: onsetDensity,
    };
  }

  function featuresFor(audioResult) { return audioToFeatures(audioResult); }

  root.SWR_TRACK_ANALYZE = analyze;
  root.SWR_AUDIO_TO_FEATURES = featuresFor;
  root.SWR_TRACK_INTERNALS = {
    percentile: percentile,
    rmsBins: rmsBins,
    spectralCentroid: spectralCentroid,
    audioToFeatures: audioToFeatures,
  };
})(typeof window !== 'undefined' ? window : globalThis);
