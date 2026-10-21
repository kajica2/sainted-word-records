// lib/layer-audio-algos.client.js — Audio-reactive layer algorithms.
//
// Three named audio-reactive behaviors per layer, each driven by the same
// canonical audio features (bass, mid, treble, beat, onset, rms, centroid, air)
// the engine already extracts. Intensity slider (0…1) scales how strongly the
// algorithm modulates the layer; at 0 the layer renders with its base
// properties unchanged.
//
//   PULSE  — bass/beat scale + brightness swell; great for lead layers
//   DRIFT  — centroid/mid hue + air-drift position; calm harmonic motion
//   SPARK  — onset/rms sharp flicker + bright flash; great for accent layers
//
// Each `apply(feat, intensity, out)` mutates `out` with `{ scale, dx, dy,
// dBrightness, dHue, opacityMul }` deltas the layer's render path reads as
// additive adjustments to the base transform/style.

(() => {
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

  const algos = {
    // PULSE: bass pumps the layer bigger; beat snaps opacity up. Warm,
    // body-led — the master tempo sits in here.
    pulse: {
      label: 'Pulse',
      hint: 'Scale + opacity pump on bass & beat. Body-led, great for the lead layer.',
      defaults: { scaleMax: 0.45, opacityMax: 0.35, brightnessMax: 0.5 },
      features: ['bass', 'beat'],
      apply(feat, intensity, out) {
        const k = clamp(intensity, 0, 1);
        if (k <= 0) return;
        const bass = feat.bass || 0;
        const beat = feat.beat || 0;
        const beatPulse = (typeof feat.beatPulse === 'number') ? feat.beatPulse : (feat.beat ? 1.0 : 0.0);
        out.scale += bass * this.defaults.scaleMax * k;
        out.opacityMul += beat * this.defaults.opacityMax * k;
        out.dBrightness += (bass * 0.6 + beatPulse * 0.4) * this.defaults.brightnessMax * k;
      },
    },

    // DRIFT: spectral centroid steers hue; mid-band RMS gently repositions.
    // Slow, smooth — harmonises with sustained chords + tonal shifts.
    drift: {
      label: 'Drift',
      hint: 'Centroid hue + mid RMS position drift. Calm, harmonic — supports the mood.',
      defaults: { hueMax: 90, driftRange: 30, brightnessMax: 0.15 },
      features: ['centroid', 'mid', 'rms', 'air'],
      apply(feat, intensity, out) {
        const k = clamp(intensity, 0, 1);
        if (k <= 0) return;
        const centroid = (feat.centroid != null) ? feat.centroid : 0.5;
        const mid = feat.mid || 0;
        const rms = feat.rms || 0;
        const air = feat.air || 0;
        // Centroid 0..1 → hue -hueMax..+hueMax (low freq=cool, high=warm)
        out.dHue += (centroid - 0.5) * 2 * this.defaults.hueMax * k;
        // Mid + air bias gentle XY drift within a small range
        out.dx += (mid - 0.5) * this.defaults.driftRange * k;
        out.dy += (air - 0.5) * this.defaults.driftRange * k;
        // RMS brightens slightly so quiet tracks don't disappear
        out.dBrightness += rms * this.defaults.brightnessMax * k;
      },
    },

    // SPARK: onset triggers sharp scale + opacity flash; RMS adds shimmer.
    // Percussive — sits well on rhythm accents and short percussive clips.
    spark: {
      label: 'Spark',
      hint: 'Onset-driven flicker + RMS shimmer. Sharp, percussive — accent layers.',
      defaults: { flashScale: 0.35, flashOpacity: 0.6, shimmer: 0.4 },
      features: ['onset', 'rms', 'treble'],
      apply(feat, intensity, out) {
        const k = clamp(intensity, 0, 1);
        if (k <= 0) return;
        const onset = feat.onset ? 1 : 0;
        const rms = feat.rms || 0;
        const treble = feat.treble || 0;
        // Onset = sharp kick
        out.scale += onset * this.defaults.flashScale * k;
        out.opacityMul += onset * this.defaults.flashOpacity * k;
        // RMS + treble = continuous shimmer
        out.dBrightness += (rms * 0.5 + treble * 0.5) * this.defaults.shimmer * k;
      },
    },
  };

  // Expose the API
  window.SWR_LAYER_AUDIO_ALGOS = {
    list: ['pulse', 'drift', 'spark'],
    get(name) { return algos[name] || null; },
    // Apply the chosen algo (or none) to the output transform bucket
    apply(name, feat, intensity, out) {
      const a = algos[name];
      if (!a) return out;
      // Seed out if missing
      if (!out) out = { scale: 0, dx: 0, dy: 0, dBrightness: 0, dHue: 0, opacityMul: 0 };
      a.apply.call(a, feat || {}, intensity, out);
      return out;
    },
    labels: {
      pulse: 'Pulse', drift: 'Drift', spark: 'Spark'
    },
  };
})();
