// lib/preset-distribution.client.js — Algorithms for distributing preset parameters
// across layers or over time. Use cases: automix, procedural generation,
// live performance parameter spreads.
//
// Three algorithms:
//   1. LINEAR_SPREAD   — even distribution across a range
//   2. RANDOM_DIST    — randomized but bounded distribution
//   3. BEAT_SYNDIST    — beat-synced distribution based on audio energy

window.PresetDistribution = {
  // ========================================================================
  // ALGORITHM 1: LINEAR_SPREAD
  // Distributes values evenly across N slots from min to max.
  // Use when: you want predictable, evenly-spaced parameter distribution.
  // ========================================================================
  LINEAR_SPREAD: {
    name: 'Linear Spread',
    desc: 'Evenly distribute values across layers',
    compute(values, min = 0, max = 1) {
      const n = values.length;
      if (n === 0) return values;
      const step = (max - min) / (n - 1 || 1);
      return values.map((_, i) => min + step * i);
    },
    // Convenience: distribute a single preset param across layers
    acrossLayers(baseValue, layerCount, variance = 0.2) {
      const min = baseValue * (1 - variance);
      const max = baseValue * (1 + variance);
      return this.compute(new Array(layerCount), min, max);
    },
    // Convenience: distribute over time (keyframes)
    overTime(baseValue, keyframeCount, variance = 0.3) {
      const min = baseValue * (1 - variance);
      const max = baseValue * (1 + variance);
      return this.compute(new Array(keyframeCount), min, max);
    },
  },

  // ========================================================================
  // ALGORITHM 2: RANDOM_DIST
  // Randomized distribution within bounds. Uses seeded random for reproducibility.
  // Use when: you want organic, non-uniform parameter variation.
  // ========================================================================
  RANDOM_DIST: {
    name: 'Random Distribution',
    desc: 'Randomized distribution within bounds',
    compute(values, min = 0, max = 1, seed = Date.now()) {
      // Simple seeded random (linear congruential generator)
      const seededRandom = (s) => {
        const a = 1103515245;
        const c = 12345;
        const m = Math.pow(2, 31);
        return ((a * s + c) % m) / m;
      };
      let s = seed;
      return values.map(() => {
        s = (s * 1103515245 + 12345) % 2147483647;
        return min + seededRandom(s) * (max - min);
      });
    },
    // Convenience: random across layers with optional clustering
    acrossLayers(baseValue, layerCount, variance = 0.4, seed = Date.now()) {
      const min = baseValue * (1 - variance);
      const max = baseValue * (1 + variance);
      return this.compute(new Array(layerCount), min, max, seed);
    },
    // Convenience: random over time with momentum (smoothing)
    overTime(baseValue, keyframeCount, variance = 0.5, seed = Date.now()) {
      const min = baseValue * (1 - variance);
      const max = baseValue * (1 + variance);
      const raw = this.compute(new Array(keyframeCount), min, max, seed);
      // Apply simple smoothing (adjacent values can't differ by more than 30%)
      return raw.map((v, i) => {
        if (i === 0) return v;
        const prev = raw[i - 1];
        const maxJump = prev * 0.3;
        return Math.max(min, Math.min(max, prev + Math.max(-maxJump, Math.min(maxJump, v - prev))));
      });
    },
  },

  // ========================================================================
  // ALGORITHM 3: BEAT_SYNDIST
  // Distributes values based on audio energy (beat/onset detection).
  // High energy = higher values, low energy = lower values.
  // Use when: parameters should react to the music's rhythm.
  // ========================================================================
  BEAT_SYNDIST: {
    name: 'Beat-Synced Distribution',
    desc: 'Distribute based on audio energy',
    // Compute distribution based on audio features
    compute(values, audioFeatures) {
      const { bass = 0, mid = 0, treble = 0, beat = 0, rms = 0 } = audioFeatures || {};
      const energy = (bass * 0.4) + (mid * 0.3) + (treble * 0.2) + (beat * 0.1);
      return values.map((_, i) => {
        // Layer index modulates the base energy
        const layerMod = 0.7 + (i / values.length) * 0.6; // 0.7 to 1.3
        return Math.min(1, energy * layerMod);
      });
    },
    // Apply to layer reactors: distribute reactor intensity based on beat
    forReactors(layers, audioFeatures) {
      return layers.map((layer, i) => {
        const { bass = 0, beat = 0, rms = 0 } = audioFeatures || {};
        // Bass-driven layers get more intensity on beat
        const beatMod = beat > 0.3 ? 1.2 : 1.0;
        const rmsMod = 0.5 + rms * 0.5;
        return {
          ...layer,
          scale: (layer.scale || 1) * beatMod * rmsMod,
        };
      });
    },
    // Generate keyframe values synchronized to beats
    overBeats(baseValue, beatTimes, audioFeaturesArray) {
      return beatTimes.map((beatTime, i) => {
        const features = audioFeaturesArray[i] || {};
        const { bass = 0, beat = 0, rms = 0 } = features;
        // Spike on beats, decay between
        const beatIntensity = beat > 0.5 ? 1.0 : 0.3;
        const decay = Math.pow(0.85, i % 8); // Decay over 8 beats
        return baseValue * beatIntensity * (0.5 + rms * 0.5) * (0.7 + decay * 0.3);
      });
    },
  },

  // ========================================================================
  // CONVENIENCE: Apply any algorithm to preset categories
  // ========================================================================
  applyToPreset(preset, algorithm, options = {}) {
    const { baseValue = 0.5, layerCount = 5, variance = 0.3, seed = Date.now() } = options;
    const alg = this[algorithm.toUpperCase()] || this.LINEAR_SPREAD;
    const categories = ['motion', 'generate', 'look'];
    const result = {};

    for (const cat of categories) {
      const catParams = preset[cat] || {};
      const distributed = {};

      for (const [param, value] of Object.entries(catParams)) {
        if (typeof value === 'number') {
          const values = alg.compute(new Array(layerCount), value * (1 - variance), value * (1 + variance), seed);
          distributed[param] = values;
        } else {
          distributed[param] = value;
        }
      }
      result[cat] = distributed;
    }
    return result;
  },
};
