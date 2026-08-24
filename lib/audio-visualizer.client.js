// lib/audio-visualizer.client.js — audio-reactive visualizer layer.
//
// Exposes window.MVM_AUDIO_VIZ with .render(ctx, w, h, feat, t).
// Drawn as an overlay on top of the MVM's preview canvas. Three layers:
//
//   1. Spectrum bars — 32 bars across the bottom 1/3, color accent
//      gradient. Heights driven by feat.bass / mid / treble.
//   2. Waveform — a thin line oscillating around vertical center.
//      Amplitude = feat.rms * h * 0.3; frequency derived from feat.bpm.
//   3. Beat pulse — when feat.beatPulse is true, an expanding ring
//      from center fades out (1-second period, looping on t).
//
// If feat is all zeros (no song loaded), the visualizer draws a thin
// baseline at the bottom only — no jazz on a silent canvas.
//
// Idempotent (guarded by __mvm_viz).

(function () {
  'use strict';
  if (window.MVM_AUDIO_VIZ && window.MVM_AUDIO_VIZ.__mvm) return;

  const BAR_COUNT = 32;
  const FALLBACK_BPM = 120;
  const FALLBACK_FREQ_HZ = FALLBACK_BPM / 60;

  function render(ctx, w, h, feat, t) {
    if (!ctx) return;
    const bass = (feat && (feat.bass || 0)) / 255;
    const mid = (feat && (feat.mid || 0)) / 255;
    const treble = (feat && (feat.treble || 0)) / 255;
    const rms = (feat && (feat.rms || 0)) / 255;
    const sub = (feat && (feat.sub || 0)) / 255;
    const beat = !!(feat && feat.beatPulse);
    const bpm = (feat && feat.bpm) || 0;
    const freqHz = bpm > 0 ? (bpm / 60) : FALLBACK_FREQ_HZ;

    // ---- 1. Spectrum bars across the bottom 1/3 ----
    const barAreaH = h / 3;
    const barAreaY = h - barAreaH;
    const barW = w / BAR_COUNT;
    const barGap = barW * 0.3;
    const barRealW = barW - barGap;
    // Fill the canvas with a soft backdrop behind the bars
    const backdrop = ctx.createLinearGradient(0, barAreaY, 0, h);
    backdrop.addColorStop(0, 'rgba(10, 0, 8, 0)');
    backdrop.addColorStop(1, 'rgba(255, 0, 102, 0.06)');
    ctx.fillStyle = backdrop;
    ctx.fillRect(0, barAreaY, w, barAreaH);

    for (let i = 0; i < BAR_COUNT; i++) {
      // Map bar index to one of three bands
      const band = i < BAR_COUNT / 3 ? bass : (i < (2 * BAR_COUNT) / 3 ? mid : treble);
      const jitter = (sub * 0.5) * Math.sin(t * 0.005 + i);
      const amp = Math.max(0.02, band + jitter * 0.2);
      const bh = amp * barAreaH * 0.9;
      const x = i * barW + barGap / 2;
      const y = h - bh;
      const grad = ctx.createLinearGradient(0, y, 0, h);
      grad.addColorStop(0, 'rgba(0, 204, 255, 0.95)');
      grad.addColorStop(1, 'rgba(255, 0, 102, 0.95)');
      ctx.fillStyle = grad;
      ctx.fillRect(x, y, barRealW, bh);
    }

    // If everything is silent, also draw a thin baseline at the bottom
    // so the user sees the visualizer exists (and not a void).
    if (bass + mid + treble + rms < 0.01) {
      ctx.fillStyle = 'rgba(102, 102, 102, 0.4)';
      ctx.fillRect(0, h - 2, w, 1);
    }

    // ---- 2. Waveform line through the center ----
    const centerY = h * 0.5;
    const ampPx = Math.max(2, rms * h * 0.3);
    const sampleCount = 200;
    ctx.beginPath();
    for (let s = 0; s <= sampleCount; s++) {
      const x = (s / sampleCount) * w;
      const phase = (s / sampleCount) * freqHz * 2 * Math.PI + (t * 0.002);
      // Composite: a primary sine + a higher-frequency detail
      const y = centerY
        + Math.sin(phase) * ampPx
        + Math.sin(phase * 2.3 + 1.7) * ampPx * 0.25;
      if (s === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.strokeStyle = 'rgba(0, 204, 255, 0.7)';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // ---- 3. Beat pulse ring ----
    if (beat) {
      const cycleMs = 800;
      const phase = ((t % cycleMs) / cycleMs);
      const r = phase * Math.max(w, h) * 0.6;
      const alpha = (1 - phase) * 0.4;
      ctx.beginPath();
      ctx.arc(w * 0.5, centerY, r, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(255, 0, 102, ' + alpha.toFixed(3) + ')';
      ctx.lineWidth = 2;
      ctx.stroke();
    }
  }

  window.MVM_AUDIO_VIZ = { __mvm: true, render };
})();