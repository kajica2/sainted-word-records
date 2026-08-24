// audio-analysis-v2.js — AudioAnalysisV2 module (v2).
// Public API (attached to window.AudioAnalysisV2):
//   analyzeBuffer(audioBuffer)        -> { bpm, key, scale, confidence, chromagram, onsets, duration }
//   startLive(mediaStream, onUpdate?) -> { stop() }
//   chromagram(magnitudes, sampleRate) -> Float32Array(12)  (0..1, normalized)
//   estimateBPM(onsetTimes)           -> number  (BPM, 0 if no clear tempo)
//   estimateKey(chroma)               -> { key, scale, confidence }  (Krumhansl-Schmuckler)
//
// Notes:
//   - chromagram() takes FFT magnitudes (half-spectrum) and maps bins to
//     12 chroma classes using A4 = 440 Hz reference. C=0, A=9 (counting from C).
//   - estimateBPM() takes an array of onset times in seconds. Folds tempo into
//     60-180 BPM range. Returns 0 if the input is empty/insufficient/noisy.
//   - analyzeBuffer() does energy-based onset detection, BPM, chromagram, and
//     key estimation in one pass.

(function () {
  'use strict';

  // ──────────────── FFT helpers ────────────────
  function hannWindow(N) {
    const w = new Float32Array(N);
    for (let i = 0; i < N; i++) w[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (N - 1)));
    return w;
  }

  // In-place radix-2 Cooley-Tukey FFT. N must be a power of 2.
  function fft(real, imag) {
    const n = real.length;
    // Bit reversal
    for (let i = 1, j = 0; i < n; i++) {
      let bit = n >> 1;
      for (; j & bit; bit >>= 1) j ^= bit;
      j |= bit;
      if (i < j) {
        const tr = real[i]; real[i] = real[j]; real[j] = tr;
        const ti = imag[i]; imag[i] = imag[j]; imag[j] = ti;
      }
    }
    // Butterflies
    for (let len = 2; len <= n; len <<= 1) {
      const ang = (-2 * Math.PI) / len;
      const wlen_r = Math.cos(ang);
      const wlen_i = Math.sin(ang);
      for (let i = 0; i < n; i += len) {
        let w_r = 1, w_i = 0;
        const half = len >> 1;
        for (let k = 0; k < half; k++) {
          const a_r = real[i + k], a_i = imag[i + k];
          const b_r = real[i + k + half] * w_r - imag[i + k + half] * w_i;
          const b_i = real[i + k + half] * w_i + imag[i + k + half] * w_r;
          real[i + k] = a_r + b_r;
          imag[i + k] = a_i + b_i;
          real[i + k + half] = a_r - b_r;
          imag[i + k + half] = a_i - b_i;
          const tmp = w_r * wlen_r - w_i * wlen_i;
          w_i = w_r * wlen_i + w_i * wlen_r;
          w_r = tmp;
        }
      }
    }
  }

  // Compute magnitude spectrum (half) from PCM samples. Uses the middle
  // window of length fftSize. Defaults to 4096-point FFT.
  function computeMagnitudes(samples, sampleRate, fftSize) {
    const N = fftSize || 4096;
    const real = new Float32Array(N);
    const imag = new Float32Array(N);
    const win = hannWindow(N);
    const off = Math.max(0, Math.floor(samples.length / 2) - Math.floor(N / 2));
    for (let i = 0; i < N; i++) {
      const s = i + off < samples.length ? samples[i + off] : 0;
      real[i] = s * win[i];
    }
    fft(real, imag);
    const half = N >> 1;
    const mags = new Float32Array(half);
    for (let i = 0; i < half; i++) {
      mags[i] = Math.sqrt(real[i] * real[i] + imag[i] * imag[i]);
    }
    return mags;
  }

  // ──────────────── chromagram ────────────────
  // Input: Float32Array of FFT magnitudes (length = fftSize/2), sampleRate.
  // Output: Float32Array(12), values 0..1 (peak-normalized).
  function chromagram(magnitudes, sampleRate) {
    if (!magnitudes || magnitudes.length < 2) {
      return new Float32Array(12);
    }
    const sr = sampleRate || 44100;
    const n = magnitudes.length;
    const fftSize = n * 2;
    const binWidth = sr / fftSize;
    const chroma = new Float32Array(12);
    // Map each bin to a chroma class. Use A4=440 as reference; A → chroma 9
    // (counting from C=0). Range: A0 (~27.5 Hz) to C8 (~4186 Hz).
    for (let k = 1; k < n; k++) {
      const freq = k * binWidth;
      if (freq < 27.5 || freq > 4186) continue;
      const raw = 12 * Math.log2(freq / 440);
      // shift by +9 so A (log2=0) maps to chroma 9
      let cls = Math.round(raw) + 9;
      cls = ((cls % 12) + 12) % 12;
      chroma[cls] += magnitudes[k];
    }
    // Normalize to 0..1
    let max = 0;
    for (let i = 0; i < 12; i++) if (chroma[i] > max) max = chroma[i];
    if (max > 0) for (let i = 0; i < 12; i++) chroma[i] = chroma[i] / max;
    return chroma;
  }

  // ──────────────── estimateBPM ────────────────
  // Input: array of onset times in seconds (any order, will be sorted).
  // Output: BPM number (60-180 range, folded), or 0 if unclear/insufficient.
  // The algorithm needs enough onsets to find a stable tempo:
  //   - At least 4 onsets (3 intervals) for a tempo candidate.
  //   - The peak interval must account for >= 40% of all in-range intervals
  //     (confidence floor). If not, the input is "noisy" and we return 0.
  function estimateBPM(onsetTimes) {
    if (!Array.isArray(onsetTimes) || onsetTimes.length < 4) return 0;

    // Sort
    const times = onsetTimes.slice().sort((a, b) => a - b);
    // Reject degenerate / out-of-range intervals. Allow 0.2s-2.0s
    // (corresponds to 30-300 BPM before folding).
    const intervals = [];
    for (let i = 1; i < times.length; i++) {
      const iv = times[i] - times[i - 1];
      if (iv >= 0.2 && iv <= 2.0) intervals.push(iv);
    }
    if (intervals.length < 3) return 0;

    // Histogram (10ms buckets)
    const hist = new Map();
    for (const iv of intervals) {
      const bucket = Math.round(iv * 100);
      hist.set(bucket, (hist.get(bucket) || 0) + 1);
    }

    // Find peak bucket
    let bestBucket = 0, bestCount = 0;
    for (const [b, c] of hist) {
      if (c > bestCount) { bestCount = c; bestBucket = b; }
    }
    if (bestBucket === 0) return 0;

    // Confidence: the peak must represent at least 50% of all in-range
    // intervals. Otherwise the input is "noisy" (no clear dominant tempo).
    const confidence = bestCount / intervals.length;
    if (confidence < 0.5) return 0;
    // Also require at least 3 intervals at the peak for stability.
    if (bestCount < 3) return 0;

    let bpm = 60 / (bestBucket / 100);
    // Fold into 60-180 range
    while (bpm < 60) bpm *= 2;
    while (bpm > 180) bpm /= 2;
    return Math.round(bpm * 10) / 10;
  }

  // ──────────────── estimateKey ────────────────
  // Krumhansl-Schmuckler key profiles (C major / C minor templates).
  const MAJOR_PROFILE = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
  const MINOR_PROFILE = [6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];
  const KEY_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

  function pearson(x, y) {
    const n = x.length;
    let sx = 0, sy = 0, sxy = 0, sxx = 0, syy = 0;
    for (let i = 0; i < n; i++) {
      sx += x[i]; sy += y[i];
      sxy += x[i] * y[i];
      sxx += x[i] * x[i];
      syy += y[i] * y[i];
    }
    const denom = Math.sqrt((n * sxx - sx * sx) * (n * syy - sy * sy));
    if (denom === 0) return 0;
    return (n * sxy - sx * sy) / denom;
  }

  function rotateVec(arr, k) {
    const n = arr.length;
    const out = new Array(n);
    for (let i = 0; i < n; i++) out[i] = arr[((i - k) % n + n) % n];
    return out;
  }

  function estimateKey(chroma) {
    if (!chroma || chroma.length !== 12) {
      return { key: 'C', scale: 'major', confidence: 0 };
    }
    const v = Array.from(chroma);
    let bestKey = 'C', bestScale = 'major', bestScore = -Infinity;
    for (let i = 0; i < 12; i++) {
      const m = pearson(v, rotateVec(MAJOR_PROFILE, i));
      if (m > bestScore) { bestScore = m; bestKey = KEY_NAMES[i]; bestScale = 'major'; }
      const mi = pearson(v, rotateVec(MINOR_PROFILE, i));
      if (mi > bestScore) { bestScore = mi; bestKey = KEY_NAMES[i]; bestScale = 'minor'; }
    }
    return { key: bestKey, scale: bestScale, confidence: Math.max(0, bestScore) };
  }

  // ──────────────── analyzeBuffer ────────────────
  // Energy-based onset detection. 20ms window, 10ms hop.
  function detectOnsets(samples, sampleRate) {
    const win = Math.floor(sampleRate * 0.02);
    const hop = Math.floor(sampleRate * 0.01);
    const nFrames = Math.max(1, Math.floor(samples.length / hop));
    const energies = new Float32Array(nFrames);
    for (let f = 0; f < nFrames; f++) {
      const start = f * hop;
      let e = 0;
      for (let j = 0; j < win && start + j < samples.length; j++) {
        const s = samples[start + j];
        e += s * s;
      }
      energies[f] = e;
    }
    // Half-wave rectified positive flux
    const flux = new Float32Array(nFrames);
    for (let i = 1; i < nFrames; i++) {
      const d = energies[i] - energies[i - 1];
      if (d > 0) flux[i] = d;
    }
    // Adaptive threshold + local-peak picking. Min 200ms between onsets.
    const onsets = [];
    const minGap = 0.2;
    const winAvg = 10;
    let lastT = -1;
    for (let i = 2; i < flux.length - 2; i++) {
      let sum = 0;
      const lo = Math.max(0, i - winAvg);
      for (let k = lo; k < i; k++) sum += flux[k];
      const local = sum / (i - lo);
      const threshold = local * 1.5 + 1e-7;
      if (flux[i] > threshold && flux[i] >= flux[i - 1] && flux[i] >= flux[i + 1]) {
        const t = (i * hop) / sampleRate;
        if (t - lastT >= minGap) {
          onsets.push(t);
          lastT = t;
        }
      }
    }
    return onsets;
  }

  function analyzeBuffer(audioBuffer) {
    if (!audioBuffer || !audioBuffer.length) {
      return {
        bpm: 0, key: 'C', scale: 'major', confidence: 0,
        chromagram: new Float32Array(12), onsets: [], duration: 0,
      };
    }
    const sr = audioBuffer.sampleRate;
    const length = audioBuffer.length;
    const channels = audioBuffer.numberOfChannels;

    // Mix to mono
    const mono = new Float32Array(length);
    for (let c = 0; c < channels; c++) {
      const d = audioBuffer.getChannelData(c);
      for (let i = 0; i < length; i++) mono[i] += d[i] / channels;
    }

    const onsets = detectOnsets(mono, sr);
    const bpm = estimateBPM(onsets);

    // Chromagram: 2s window from 25%-75% of the buffer
    const start = Math.floor(length * 0.25);
    const end = Math.min(length, start + Math.floor(sr * 2));
    const segLen = end - start;
    const seg = new Float32Array(segLen);
    for (let i = 0; i < segLen; i++) seg[i] = mono[start + i];
    const mags = computeMagnitudes(seg, sr, 4096);
    const chroma = chromagram(mags, sr);
    const k = estimateKey(chroma);

    return {
      bpm, key: k.key, scale: k.scale, confidence: k.confidence,
      chromagram: chroma, onsets, duration: length / sr,
    };
  }

  // ──────────────── startLive ────────────────
  function startLive(stream, onUpdate) {
    if (!stream) {
      return { stop: function () {} };
    }
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return { stop: function () {} };
    const ctx = new Ctx();
    let source = null, analyser = null, intervalId = null;
    try {
      source = ctx.createMediaStreamSource(stream);
      analyser = ctx.createAnalyser();
      analyser.fftSize = 2048;
      source.connect(analyser);
    } catch (e) {
      return { stop: function () { try { ctx.close(); } catch (_) {} } };
    }

    if (typeof onUpdate === 'function') {
      const mags = new Float32Array(analyser.frequencyBinCount);
      intervalId = setInterval(function () {
        try {
          analyser.getFloatFrequencyData(mags);
          const chroma = chromagram(mags, ctx.sampleRate);
          const k = estimateKey(chroma);
          onUpdate({ chromagram: chroma, key: k.key, scale: k.scale, confidence: k.confidence });
        } catch (_) { /* swallow live-frame errors */ }
      }, 100);
    }

    return {
      stop: function () {
        if (intervalId) { clearInterval(intervalId); intervalId = null; }
        try { if (source) source.disconnect(); } catch (_) {}
        try { if (analyser) analyser.disconnect(); } catch (_) {}
        try { ctx.close(); } catch (_) {}
      },
    };
  }

  // ──────────────── Export ────────────────
  window.AudioAnalysisV2 = {
    analyzeBuffer: analyzeBuffer,
    startLive: startLive,
    chromagram: chromagram,
    estimateBPM: estimateBPM,
    estimateKey: estimateKey,
  };
  // Internal helpers exposed for debugging only
  window.__AudioAnalysisV2Internals = {
    computeMagnitudes: computeMagnitudes,
    detectOnsets: detectOnsets,
  };
})();
