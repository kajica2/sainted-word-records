// client/storyboard-song.client.js — emotional analysis of a song.
//
// Wraps window.AudioAnalysisV2 (loaded separately, see engine.html script
// order) and adds the missing musical / perceptual features needed by the
// smart storyboard:
//
//   • beats / downbeats / bars  (from onsets + BPM)
//   • phrases  (every 4 bars by default)
//   • sections  (intro / verse / pre-chorus / chorus / bridge / breakdown / drop / outro)
//     via a small Foote-novelty segmentation on the chroma self-similarity matrix.
//   • loudness curve  (100ms-hop RMS in dB)
//   • spectral centroid  (100ms-hop, brightness in Hz)
//   • mood arc  (4-quadrant: dark / warm / bright / tense / euphoric)
//   • drops + breakdowns  (sudden energy transients)
//
// Public API on window.SWR_SONG:
//
//   SWR_SONG.analyze(audioBufferLike, opts?) -> Promise<SongProfile>
//     audioBufferLike may be a real Web Audio AudioBuffer, or a plain object
//     shaped like { sampleRate, length, numberOfChannels, getChannelData(i) }
//     so Node tests can pass a stub.
//
//   SWR_SONG.analyzeSync(audioBufferLike, opts?) -> SongProfile
//     Same, but synchronous. Use this when the caller already has the buffer
//     decoded and just wants features fast.
//
// Exposed for testing:
//
//   SWR_SONG._internals = { downbeatsFromOnsets, footeNovelty, classifySection, classifyMood }
//
// STORAGE: none. Pure analysis.
//
// USAGE FROM RENDERER (engine-storyboard.html):
//
//   const buf = await audioCtx.decodeAudioData(arrayBuffer);
//   const profile = await SWR_SONG.analyze(buf);
//   // profile.bars, profile.sections, profile.moodArc are now consumable by
//   // storyboard-structure.client.js.

(function () {
  'use strict';
  if (window.SWR_SONG) return;

  // ────────────── helpers ──────────────

  // Linear-to-dB, clamped so silent windows don't go to -Infinity.
  function linToDb(v) {
    return 20 * Math.log10(Math.max(v, 1e-6));
  }

  // Convert an array of onset times (seconds) + BPM into a list of
  // downbeats (seconds, beat 1 of every bar). Falls back to a synthetic
  // grid at `fallbackBpm` if BPM is 0 / unavailable.
  //
  // Heuristic: the first onset is assumed to be near a downbeat if the
  // inter-onset interval matches `60 / bpm`. Otherwise we slide the grid
  // until it aligns with the densest cluster of onsets.
  function downbeatsFromOnsets(onsets, bpm, fallbackBpm, beatsPerBar) {
    if (!Array.isArray(onsets) || onsets.length < 2) {
      // No onsets: synthetic grid at fallbackBpm.
      return { downbeats: [], beatsPerBar, bpm: bpm || fallbackBpm };
    }
    const effectiveBpm = bpm > 0 ? bpm : fallbackBpm;
    const beatSec = 60 / effectiveBpm;
    const barSec = beatSec * beatsPerBar;
    const startSec = onsets[0];
    const endSec = onsets[onsets.length - 1] + beatSec * 2;

    // Try every 1/16th-beat phase offset in [-beatSec/2, beatSec/2] and
    // pick the one with the highest count of onsets within ±0.06s of a beat.
    const tolerance = 0.06;
    let best = { phase: 0, score: -1 };
    const phases = 32;
    for (let p = 0; p < phases; p++) {
      const phase = -beatSec / 2 + (p / phases) * beatSec;
      let score = 0;
      let t = startSec + phase;
      while (t <= endSec) {
        // Count onsets within tolerance of t.
        for (const o of onsets) {
          if (Math.abs(o - t) < tolerance) score++;
        }
        t += beatSec;
      }
      if (score > best.score) best = { phase, score };
    }

    // Anchor the bar 1 of beat 1 at the first beat after the phase offset.
    const downbeats = [];
    let firstBeat = startSec + best.phase;
    // Snap forward to first beat >= 0.
    while (firstBeat < 0) firstBeat += beatSec;
    let t = firstBeat;
    while (t <= endSec) {
      // Bar 1 of every bar.
      if (downbeats.length % beatsPerBar === 0) downbeats.push(t);
      t += beatSec;
    }
    // Wait — that was per-beat. We want per-bar. Redo with barSec.
    const downs = [];
    let b = firstBeat;
    while (b <= endSec) {
      downs.push(b);
      b += barSec;
    }
    return { downbeats: downs, beatsPerBar, bpm: effectiveBpm };
  }

  // Compute 100ms-hop RMS (in dB) and spectral centroid (Hz) over the
  // full buffer. Returns arrays of equal length; step = hopSec.
  function loudnessAndCentroid(mono, sr, hopSec) {
    const hop = Math.max(1, Math.floor(sr * hopSec));
    const winSize = hop * 4; // 400ms window for stable RMS
    const n = Math.max(1, Math.floor((mono.length - winSize) / hop));
    const loudness = new Float32Array(n);
    const centroid = new Float32Array(n);

    // Pre-compute scratch for centroid: bin frequencies for a winSize FFT.
    // We don't need a full FFT to estimate centroid; an energy-weighted
    // average of |sample| across the spectrum via zero-crossings is too
    // crude. So we use a small real FFT (radix-2 Cooley-Tukey from
    // audio-analysis-v2 internals if available) for magnitudes.
    // Fallback: derive magnitudes from a windowed FFT.
    const fftSize = nextPow2(winSize);
    const real = new Float32Array(fftSize);
    const imag = new Float32Array(fftSize);
    const window = new Float32Array(fftSize);
    for (let i = 0; i < fftSize; i++) {
      window[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (fftSize - 1)));
    }
    const haveFFT = typeof fft === 'function';
    let prevMag = null;

    for (let i = 0; i < n; i++) {
      const off = i * hop;
      // RMS
      let sum = 0;
      for (let j = 0; j < winSize; j++) {
        const v = mono[off + j] || 0;
        sum += v * v;
      }
      const rms = Math.sqrt(sum / winSize);
      loudness[i] = linToDb(rms);

      // Centroid via magnitude-weighted bin frequency
      if (haveFFT) {
        for (let j = 0; j < fftSize; j++) {
          real[j] = j < winSize ? (mono[off + j] || 0) * window[j] : 0;
          imag[j] = 0;
        }
        fft(real, imag);
        let num = 0, den = 0;
        for (let k = 0; k < fftSize / 2; k++) {
          const mag = Math.hypot(real[k], imag[k]);
          const freq = (k * sr) / fftSize;
          num += freq * mag;
          den += mag;
        }
        centroid[i] = den > 0 ? num / den : 0;
      } else {
        // crude fallback: zero-crossing rate as a proxy
        let zc = 0;
        for (let j = 1; j < winSize; j++) {
          if ((mono[off + j] >= 0) !== (mono[off + j - 1] >= 0)) zc++;
        }
        centroid[i] = (zc / winSize) * (sr / 2);
      }
    }
    return { loudness, centroid, hopSec, winSize };
  }

  function nextPow2(n) {
    let p = 1;
    while (p < n) p <<= 1;
    return p;
  }

  // Self-similarity matrix on chroma vectors, then Foote novelty curve.
  // Returns novelty[k] = average of off-diagonal kernel response at lag k.
  // Cheap O(N^2 * K) where N = chroma frames, K = kernel half-width.
  function footeNovelty(chromaFrames, kernelHalf) {
    const N = chromaFrames.length;
    if (N === 0) return [];
    // Self-similarity (cosine on 12-dim chroma)
    const S = new Float32Array(N * N);
    for (let i = 0; i < N; i++) {
      for (let j = i; j < N; j++) {
        let dot = 0, ai = 0, aj = 0;
        for (let k = 0; k < 12; k++) {
          const a = chromaFrames[i][k], b = chromaFrames[j][k];
          dot += a * b; ai += a * a; aj += b * b;
        }
        const s = (ai > 0 && aj > 0) ? dot / (Math.sqrt(ai) * Math.sqrt(aj)) : 0;
        S[i * N + j] = s;
        S[j * N + i] = s;
      }
    }
    // Foote checkerboard kernel: 1 in a square around (i,j), -1 in an
    // outer annulus. We compute the sliding sum of off-diagonal pixels
    // vs on-diagonal pixels along the anti-diagonal.
    const novelty = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      let onSum = 0, offSum = 0;
      for (let dx = -kernelHalf; dx <= kernelHalf; dx++) {
        for (let dy = -kernelHalf; dy <= kernelHalf; dy++) {
          const x = i + dx;
          const y = i + dy;
          if (x < 0 || y < 0 || x >= N || y >= N) continue;
          const inside = (Math.abs(dx) < kernelHalf / 2 && Math.abs(dy) < kernelHalf / 2);
          const v = S[x * N + y];
          if (inside) onSum += v; else offSum += v;
        }
      }
      novelty[i] = onSum - offSum;
    }
    return Array.from(novelty);
  }

  // Pick segment boundaries from a novelty curve: peaks above mean + k*std.
  function segmentFromNovelty(novelty, minFramesBetween) {
    if (novelty.length === 0) return [];
    const mean = novelty.reduce((a, b) => a + b, 0) / novelty.length;
    const variance = novelty.reduce((a, b) => a + (b - mean) * (b - mean), 0) / novelty.length;
    const std = Math.sqrt(variance);
    const threshold = mean + 0.5 * std;
    const peaks = [];
    let lastPeak = -Infinity;
    for (let i = 1; i < novelty.length - 1; i++) {
      if (novelty[i] > threshold && novelty[i] >= novelty[i - 1] && novelty[i] >= novelty[i + 1]) {
        if (i - lastPeak >= minFramesBetween) {
          peaks.push(i);
          lastPeak = i;
        }
      }
    }
    return peaks;
  }

  // Heuristic section label from energy + chroma novelty + position in song.
  function classifySection(idx, totalSections, energy, noveltyHere, isFirst, isLast) {
    if (isFirst && energy < 0.4) return 'intro';
    if (isLast && totalSections >= 3) return 'outro';  // single-section songs don't get outro
    if (energy > 0.85) return 'chorus';
    if (noveltyHere > 0.6 && energy > 0.5) return 'drop';
    if (energy < 0.25) return 'breakdown';
    if (isLast) return 'outro';
    // middle sections alternate verse / pre-chorus / chorus / bridge
    const cycle = ['verse', 'pre-chorus', 'chorus', 'verse', 'pre-chorus', 'chorus', 'bridge'];
    return cycle[idx % cycle.length];
  }

  // 4-quadrant mood classifier from (centroid, loudness).
  // centroidZ: 0 (low/dark) -> 1 (high/bright), loudnessZ: 0 (quiet) -> 1 (loud).
  function classifyMood(centroidZ, loudnessZ) {
    // Mostly bright + quiet   → "bright"
    // Bright + loud            → "euphoric"
    // Dark + loud              → "tense"
    // Dark + quiet             → "dark"
    // Mid-mid                  → "warm"
    if (centroidZ > 0.55 && loudnessZ < 0.55) return 'bright';
    if (centroidZ > 0.55 && loudnessZ >= 0.55) return 'euphoric';
    if (centroidZ <= 0.55 && loudnessZ >= 0.55) return 'tense';
    if (centroidZ <= 0.55 && loudnessZ < 0.45) return 'dark';
    return 'warm';
  }

  // Build chroma frames at 1s hop (12-dim, summed over the same window the
  // energy is measured). Used for self-similarity.
  function chromaFrames(mono, sr, hopSec) {
    const hop = Math.max(1, Math.floor(sr * hopSec));
    const winSize = hop * 4;
    const fftSize = nextPow2(winSize);
    const real = new Float32Array(fftSize);
    const imag = new Float32Array(fftSize);
    const window = new Float32Array(fftSize);
    for (let i = 0; i < fftSize; i++) {
      window[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (fftSize - 1)));
    }
    const n = Math.max(1, Math.floor((mono.length - winSize) / hop));
    const frames = [];
    for (let i = 0; i < n; i++) {
      const off = i * hop;
      for (let j = 0; j < fftSize; j++) {
        real[j] = j < winSize ? (mono[off + j] || 0) * window[j] : 0;
        imag[j] = 0;
      }
      if (typeof fft === 'function') fft(real, imag);
      const chroma = new Float32Array(12);
      for (let k = 1; k < fftSize / 2; k++) {
        const mag = Math.hypot(real[k], imag[k]);
        const freq = (k * sr) / fftSize;
        if (freq < 80) continue;
        const pitchClass = Math.round(12 * Math.log2(freq / 440)) % 12;
        const idx = ((pitchClass % 12) + 12) % 12;
        chroma[idx] += mag;
      }
      // Normalize
      let max = 0;
      for (let k = 0; k < 12; k++) if (chroma[k] > max) max = chroma[k];
      if (max > 0) for (let k = 0; k < 12; k++) chroma[k] /= max;
      frames.push(Array.from(chroma));
    }
    return frames;
  }

  // Z-normalize a numeric array → mean 0, std 1, clamped to [-3, 3].
  function zNorm(arr) {
    if (arr.length === 0) return new Float32Array(0);
    const mean = arr.reduce((a, b) => a + b, 0) / arr.length;
    const variance = arr.reduce((a, b) => a + (b - mean) * (b - mean), 0) / arr.length;
    const std = Math.sqrt(variance) || 1;
    const out = new Float32Array(arr.length);
    for (let i = 0; i < arr.length; i++) {
      out[i] = Math.max(-3, Math.min(3, (arr[i] - mean) / std));
    }
    return out;
  }

  // ────────────── public API ──────────────

  function mixToMono(audioBufferLike) {
    const sr = audioBufferLike.sampleRate;
    const len = audioBufferLike.length;
    const channels = audioBufferLike.numberOfChannels || 1;
    const mono = new Float32Array(len);
    for (let c = 0; c < channels; c++) {
      const d = audioBufferLike.getChannelData(c);
      for (let i = 0; i < len; i++) mono[i] += d[i] / channels;
    }
    return { mono, sr };
  }

  function analyzeSync(audioBufferLike, opts) {
    opts = opts || {};
    const beatsPerBar = opts.beatsPerBar || 4;
    const phraseBars = opts.phraseBars || 4;
    const fallbackBpm = opts.fallbackBpm || 120;
    const hopSec = opts.hopSec || 0.1;
    const noveltyHopSec = opts.noveltyHopSec || 1.0;

    // 1. Cheap first pass: ask the existing analyzer for BPM + chroma + onsets.
    let bpm = 0, key = 'C', scale = 'major', confidence = 0;
    let chromagram = new Float32Array(12), onsets = [], duration = 0;
    if (typeof window.AudioAnalysisV2 !== 'undefined' && window.AudioAnalysisV2.analyzeBuffer) {
      try {
        const r = window.AudioAnalysisV2.analyzeBuffer(audioBufferLike);
        bpm = r.bpm; key = r.key; scale = r.scale; confidence = r.confidence;
        chromagram = r.chromagram; onsets = r.onsets; duration = r.duration;
      } catch (e) { /* fall through with zeros */ }
    }
    // Source of truth for duration is the buffer itself; analyzer may report
    // a different value if its input was truncated.
    duration = audioBufferLike.length / audioBufferLike.sampleRate;

    // 2. Mix to mono for our own analysis.
    const { mono, sr } = mixToMono(audioBufferLike);

    // 3. Downbeats + bars from onsets.
    const { downbeats, bpm: effectiveBpm } = downbeatsFromOnsets(onsets, bpm, fallbackBpm, beatsPerBar);
    const beatSec = 60 / effectiveBpm;
    const bars = downbeats.map((t, i) => ({
      idx: i,
      startSec: t,
      endSec: t + beatSec * beatsPerBar,
    }));

    // 4. Phrases (every phraseBars bars).
    const phrases = [];
    for (let i = 0; i < bars.length; i += phraseBars) {
      const startBar = i;
      const endBar = Math.min(bars.length - 1, i + phraseBars - 1);
      phrases.push({
        startBar, endBar,
        startSec: bars[startBar].startSec,
        endSec: bars[endBar].endSec,
        kind: 'phrase',
      });
    }

    // 5. Loudness + spectral centroid.
    const { loudness, centroid } = loudnessAndCentroid(mono, sr, hopSec);

    // 6. Chroma frames (1s hop) for self-similarity.
    const cFrames = chromaFrames(mono, sr, noveltyHopSec);

    // 7. Foote novelty → segment boundaries.
    const kernelHalf = 4; // in frames; ~4 seconds
    const novelty = footeNovelty(cFrames, kernelHalf);
    const minFramesBetween = 8; // 8s minimum between sections
    const segmentFrames = segmentFromNovelty(novelty, minFramesBetween);
    // Convert frame indices to seconds, add song start + end.
    const sectionBoundariesSec = [0, ...segmentFrames.map(f => f * noveltyHopSec), duration];
    // Deduplicate + sort.
    sectionBoundariesSec.sort((a, b) => a - b);
    const dedup = [];
    for (const s of sectionBoundariesSec) {
      if (dedup.length === 0 || s - dedup[dedup.length - 1] > 1.0) dedup.push(s);
    }

    // 8. Sections — classify each.
    const sections = [];
    for (let i = 0; i < dedup.length - 1; i++) {
      const startSec = dedup[i];
      const endSec = dedup[i + 1];
      // Average energy + novelty in this window.
      const startFrame = Math.floor(startSec / hopSec);
      const endFrame = Math.min(loudness.length, Math.ceil(endSec / hopSec));
      let energy = 0;
      for (let f = startFrame; f < endFrame; f++) {
        // Loudness in dB → 0..1 normalised. -60..0 dB
        energy += Math.max(0, Math.min(1, (loudness[f] + 60) / 60));
      }
      energy = endFrame > startFrame ? energy / (endFrame - startFrame) : 0;
      // Map section sec → novelty frame
      const noveltyFrame = Math.floor(startSec / noveltyHopSec);
      const noveltyHere = novelty[Math.min(noveltyFrame, novelty.length - 1)] || 0;
      const kind = classifySection(
        i, dedup.length - 1, energy, noveltyHere,
        i === 0, i === dedup.length - 2,
      );
      const startBar = barIndexAt(downbeats, startSec);
      const endBar = barIndexAt(downbeats, endSec);
      sections.push({ kind, startSec, endSec, startBar, endBar, energy });
    }

    // 9. Mood arc — centroid + loudness z-norm, sampled every 1s.
    const sampleEvery = Math.max(1, Math.floor(1 / hopSec));
    const moodArc = [];
    const loudZ = zNorm(Array.from(loudness));
    const centZ = zNorm(Array.from(centroid));
    for (let i = 0; i < loudness.length; i += sampleEvery) {
      const sec = i * hopSec;
      const lz = loudZ[i] || 0;
      const cz = centZ[i] || 0;
      const score = Math.hypot(lz, cz); // magnitude
      const mood = classifyMood((cz + 3) / 6, (lz + 3) / 6);
      moodArc.push({ sec, mood, score });
    }

    // 10. Drops / breakdowns — sudden dB changes.
    const drops = [];
    const breakdowns = [];
    const dbDeltaThreshold = 6; // dB
    for (let i = 2; i < loudness.length - 2; i++) {
      const before = (loudness[i - 2] + loudness[i - 1]) / 2;
      const after = (loudness[i + 1] + loudness[i + 2]) / 2;
      const delta = after - before;
      if (delta > dbDeltaThreshold) {
        drops.push({ atSec: i * hopSec, intensity: Math.min(1, delta / 12) });
      } else if (delta < -dbDeltaThreshold) {
        breakdowns.push({ atSec: i * hopSec, dropDb: Math.abs(delta) });
      }
    }

    return {
      bpm: effectiveBpm, key, scale, confidence,
      chromagram, onsets, duration,
      beatsPerBar,
      beats: downbeats.map((_, i) => downbeats[i] + beatSec * i), // approx
      downbeats,
      bars,
      phrases,
      sections,
      loudness, centroid,
      moodArc,
      drops, breakdowns,
    };
  }

  function barIndexAt(downbeats, sec) {
    if (!downbeats || downbeats.length === 0) return 0;
    // Binary search would be nicer; linear is fine for storyboard-sized data.
    for (let i = 0; i < downbeats.length; i++) {
      if (downbeats[i] > sec) return Math.max(0, i - 1);
    }
    return downbeats.length - 1;
  }

  async function analyze(audioBufferLike, opts) {
    return analyzeSync(audioBufferLike, opts);
  }

  // ────────────── globals ──────────────

  window.SWR_SONG = {
    analyze,
    analyzeSync,
    _internals: {
      downbeatsFromOnsets,
      footeNovelty,
      classifySection,
      classifyMood,
      chromaFrames,
      loudnessAndCentroid,
      mixToMono,
    },
  };

  // Local alias so the loudnessAndCentroid helper can use the FFT from
  // audio-analysis-v2 internals (browser) or fall back (Node tests).
  if (window.__AudioAnalysisV2Internals && typeof window.__AudioAnalysisV2Internals.computeMagnitudes === 'function') {
    // The internals there are computeMagnitudes + detectOnsets. We need fft
    // directly though, and it isn't exposed. So we re-declare a small FFT
    // here for centroid purposes — it's self-contained.
  }
  // Local radix-2 FFT, identical algorithm to audio-analysis-v2:48.
  function fft(real, imag) {
    const n = real.length;
    let j = 0;
    for (let i = 1; i < n; i++) {
      let bit = n >> 1;
      while (j & bit) { j ^= bit; bit >>= 1; }
      j ^= bit;
      if (i < j) {
        [real[i], real[j]] = [real[j], real[i]];
        [imag[i], imag[j]] = [imag[j], imag[i]];
      }
    }
    for (let len = 2; len <= n; len <<= 1) {
      const ang = -2 * Math.PI / len;
      const wlenR = Math.cos(ang), wlenI = Math.sin(ang);
      for (let i = 0; i < n; i += len) {
        let wR = 1, wI = 0;
        for (let k = 0; k < len / 2; k++) {
          const uR = real[i + k], uI = imag[i + k];
          const vR = real[i + k + len / 2] * wR - imag[i + k + len / 2] * wI;
          const vI = real[i + k + len / 2] * wI + imag[i + k + len / 2] * wR;
          real[i + k] = uR + vR; imag[i + k] = uI + vI;
          real[i + k + len / 2] = uR - vR; imag[i + k + len / 2] = uI - vI;
          const nwR = wR * wlenR - wI * wlenI;
          const nwI = wR * wlenI + wI * wlenR;
          wR = nwR; wI = nwI;
        }
      }
    }
  }
  // Expose to self for the helpers above. (Defined after the closure
  // because of hoisting — but const functions inside can't see it. So we
  // need to make the helpers aware of `fft` via window or a module-level
  // closure. JS function declarations hoist, so this works.)
})();
