// self-assembling-director.js
// Drop-in module for Sainted Word Records.
//
// Analyzes a song, identifies structural sections (intro / verse / chorus /
// drop / breakdown / bridge / outro), and assembles the best-fitting
// personas + FX for each section.
//
// Requires:
//   - window.AudioAnalysisV2 (existing)
//   - window.Personas.apply / window.FX.setMut (existing)

(function () {
  if (window.SWRSelfAssemblingDirector) return;

  const SECTION_PROFILES = {
    intro: { preferred: ['smoke', 'morphavoid', 'filter', 'raw', 'morphaanchor'], intensity: 0.25 },
    verse: { preferred: ['raw', 'filmfilm', 'filter', 'morphaflow', 'vhsvibe'], intensity: 0.45 },
    prechorus: { preferred: ['neon', 'morphaflow', 'clubstrobe', 'fx'], intensity: 0.65 },
    chorus: { preferred: ['neon', 'hallucination', 'clubstrobe', 'fx', 'neonwash'], intensity: 0.85 },
    drop: { preferred: ['hallucination', 'clubstrobe', 'fx', 'grid', 'morphafracture'], intensity: 1.0 },
    breakdown: { preferred: ['smoke', 'morphavoid', 'morphaecho', 'mask', 'pearlhaze'], intensity: 0.35 },
    bridge: { preferred: ['filmfilm', 'morphaecho', 'filter', 'liquidglass'], intensity: 0.55 },
    outro: { preferred: ['morphavoid', 'smoke', 'filter', 'raw', 'morphaanchor'], intensity: 0.2 },
    instrumental: { preferred: ['liquidglass', 'morphaflow', 'neonwash', 'pearlhaze'], intensity: 0.5 },
    unknown: { preferred: ['raw', 'filter', 'neon'], intensity: 0.5 },
  };

  function availablePersonaKeys() {
    const P = window.Personas && window.Personas.PERSONAS;
    if (!P) return new Set();
    if (Array.isArray(P)) return new Set(P.map(p => p.id || p.key || p.name).filter(Boolean));
    return new Set(Object.keys(P));
  }

  function resolvePersona(preferred, available) {
    if (!preferred || !preferred.length) return 'raw';
    if (!available || available.size === 0) return preferred[0];
    for (const key of preferred) {
      if (available.has(key)) return key;
    }
    // last-resort known-good keys
    for (const fallback of ['raw', 'filter', 'neon', 'fx', 'smoke']) {
      if (available.has(fallback)) return fallback;
    }
    return preferred[0];
  }

  function rms(samples, start, end) {
    let sum = 0;
    const n = end - start;
    if (n <= 0) return 0;
    for (let i = start; i < end; i++) sum += samples[i] * samples[i];
    return Math.sqrt(sum / n);
  }

  function computeNovelty(frames) {
    const novelty = new Float32Array(frames.length);
    for (let i = 1; i < frames.length; i++) {
      const dE = Math.abs(frames[i].energy - frames[i - 1].energy);
      const dC = Math.abs(frames[i].centroid - frames[i - 1].centroid) * 0.002;
      novelty[i] = dE * 3.0 + dC;
    }
    return novelty;
  }

  function findPeaks(arr, minDist, threshold) {
    const peaks = [];
    for (let i = 1; i < arr.length - 1; i++) {
      if (arr[i] > arr[i - 1] && arr[i] > arr[i + 1] && arr[i] > threshold) {
        if (peaks.length === 0 || i - peaks[peaks.length - 1] >= minDist) peaks.push(i);
      }
    }
    return peaks;
  }

  function classifySection(features) {
    const { energy, energyTrend, spectral, duration, position, totalDuration } = features;
    const relPos = position / (totalDuration || 1);
    if (relPos < 0.08 && energy < 0.4) return 'intro';
    if (relPos > 0.88 && energyTrend < -0.1) return 'outro';
    if (energy > 0.75 && spectral > 0.55) return 'drop';
    if (energy > 0.62) return 'chorus';
    if (energy < 0.28 && spectral < 0.4) return 'breakdown';
    if (energyTrend > 0.15 && energy > 0.4) return 'prechorus';
    if (spectral > 0.6 && energy < 0.5) return 'instrumental';
    if (duration > 8 && energy > 0.35 && energy < 0.6) return 'verse';
    return 'unknown';
  }

  class SWRSelfAssemblingDirector {
    constructor(options = {}) {
      this.frameSize = options.frameSize || 2048;
      this.hopSize = options.hopSize || 1024;
      this.minSectionSec = options.minSectionSec || 4.0;
    }

    async assemble(audioBuffer) {
      if (!audioBuffer) throw new Error('No audio buffer');
      const sr = audioBuffer.sampleRate;
      const length = audioBuffer.length;
      const duration = length / sr;

      const mono = new Float32Array(length);
      const ch = audioBuffer.numberOfChannels;
      for (let c = 0; c < ch; c++) {
        const d = audioBuffer.getChannelData(c);
        for (let i = 0; i < length; i++) mono[i] += d[i] / ch;
      }

      let analysis = { bpm: 0, key: 'C', scale: 'major' };
      if (window.AudioAnalysisV2 && window.AudioAnalysisV2.analyzeBuffer) {
        try { analysis = window.AudioAnalysisV2.analyzeBuffer(audioBuffer) || analysis; } catch (_) {}
      }

      const frames = [];
      const fftSize = this.frameSize;
      const hop = this.hopSize;
      const nFrames = Math.floor((length - fftSize) / hop);
      for (let f = 0; f < nFrames; f++) {
        const start = f * hop;
        const end = Math.min(start + fftSize, length);
        const energy = rms(mono, start, end);
        let high = 0, low = 0;
        for (let i = start; i < end; i++) {
          const s = Math.abs(mono[i]);
          if (i % 4 === 0) high += s; else low += s;
        }
        frames.push({ t: start / sr, energy, centroid: high / (high + low + 1e-8) });
      }

      let maxE = 0;
      for (const fr of frames) if (fr.energy > maxE) maxE = fr.energy;
      if (maxE > 0) for (const fr of frames) fr.energy /= maxE;

      const novelty = computeNovelty(frames);
      const minDist = Math.max(2, Math.floor(this.minSectionSec * sr / hop));
      const peaks = findPeaks(novelty, minDist, 0.08);
      const boundaries = [0, ...peaks, frames.length - 1];
      const rawSections = [];
      for (let i = 0; i < boundaries.length - 1; i++) {
        const a = boundaries[i], b = boundaries[i + 1];
        const startT = frames[a].t, endT = frames[b].t;
        if (endT - startT < this.minSectionSec * 0.6) continue;
        let sumE = 0, sumC = 0, n = 0;
        for (let k = a; k < b; k++) { sumE += frames[k].energy; sumC += frames[k].centroid; n++; }
        rawSections.push({
          start: startT, end: endT, duration: endT - startT,
          energy: n ? sumE / n : 0, spectral: n ? sumC / n : 0,
          energyTrend: n > 4 ? (frames[b - 1].energy - frames[a].energy) : 0,
          position: (startT + endT) / 2, totalDuration: duration,
        });
      }

      const available = availablePersonaKeys();
      const sections = rawSections.map((s) => {
        const label = classifySection(s);
        const profile = SECTION_PROFILES[label] || SECTION_PROFILES.unknown;
        const persona = resolvePersona(profile.preferred, available);
        const intensity = Math.min(1, profile.intensity * (0.7 + s.energy * 0.6));
        return {
          start: +s.start.toFixed(2), end: +s.end.toFixed(2), duration: +s.duration.toFixed(2),
          label, persona, intensity: +intensity.toFixed(2), energy: +s.energy.toFixed(2),
          reason: `${label} · energy ${s.energy.toFixed(2)} · prefers ${persona}`,
        };
      });

      return {
        duration: +duration.toFixed(2),
        bpm: analysis.bpm || 0,
        key: analysis.key || 'C',
        scale: analysis.scale || 'major',
        sections,
        frameCount: frames.length,
      };
    }

    getActive(plan, currentTime) {
      if (!plan || !plan.sections) return null;
      for (const s of plan.sections) {
        if (currentTime >= s.start && currentTime < s.end) return s;
      }
      return plan.sections[plan.sections.length - 1] || null;
    }

    applyActive(plan, currentTime) {
      const active = this.getActive(plan, currentTime);
      if (!active) return null;
      const available = availablePersonaKeys();
      const persona = resolvePersona([active.persona], available);
      if (window.Personas && typeof window.Personas.apply === 'function' && persona) {
        if (this._lastPersona !== persona) {
          try { window.Personas.apply(persona); } catch (_) {}
          this._lastPersona = persona;
        }
      }
      if (window.FX && typeof window.FX.setMut === 'function') {
        try { window.FX.setMut(active.intensity); } catch (_) {}
      }
      return active;
    }
  }

  window.SWRSelfAssemblingDirector = SWRSelfAssemblingDirector;
})();
