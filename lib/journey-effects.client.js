// lib/journey-effects.client.js — Layer 3 subtle effects.
//
// Reads JourneyState, writes CSS custom properties + a CSS transform on the
// preview canvas. Designed to be SUBTLE — the user feels the picture breathe,
// doesn't see obvious movement. All effects are clamped to small magnitudes.
//
// CSS variables written to document.documentElement:
//   --journey-hue-deg       : hue rotation in degrees (0..360)
//   --journey-saturation    : saturation boost (-0.02..+0.02)
//   --journey-brightness    : brightness boost (-0.05..+0.05)
//   --journey-scale         : scale factor (0.997..1.003)
//   --journey-translate-x   : px (-2..+2)
//   --journey-translate-y   : px (-2..+2)
//
// Per-frame work: ~6 multiplications + 6 CSS writes. Cheap enough for 60fps.
//
// Consumers (downstream CSS): apply via filter: hue-rotate(...) saturate(...) brightness(...),
// transform: translate(...) scale(...).

(function () {
  'use strict';
  if (window.JourneyEffects && window.JourneyEffects.__v1) return;

  const Effects = {
    __v1: true,
    _rafId: 0,
    _previewEl: null,
    _reducedMotion: false,
    _hueAccum: 0,

    start() {
      if (this._rafId) return;
      this._previewEl = document.getElementById('preview');
      if (window.matchMedia) {
        const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
        this._reducedMotion = mq.matches;
        mq.addEventListener('change', e => { this._reducedMotion = e.matches; });
      }
      this._rafId = requestAnimationFrame((n) => this._tick(n));
    },

    stop() {
      if (this._rafId) cancelAnimationFrame(this._rafId);
      this._rafId = 0;
      // Reset CSS vars so the picture returns to baseline.
      const root = document.documentElement;
      root.style.setProperty('--journey-hue-deg', '0deg');
      root.style.setProperty('--journey-saturation', '0');
      root.style.setProperty('--journey-brightness', '0');
      root.style.setProperty('--journey-scale', '1');
      root.style.setProperty('--journey-translate-x', '0px');
      root.style.setProperty('--journey-translate-y', '0px');
    },

    _tick(now) {
      const JS = window.JourneyState;
      if (!JS || !JS._state.active) {
        this._rafId = requestAnimationFrame((n) => this._tick(n));
        return;
      }
      const s = JS._state;
      const root = document.documentElement;

      if (this._reducedMotion) {
        // Reduced motion: clamp everything to baseline, no breathing.
        root.style.setProperty('--journey-hue-deg', '0deg');
        root.style.setProperty('--journey-saturation', '0');
        root.style.setProperty('--journey-brightness', '0');
        root.style.setProperty('--journey-scale', '1');
        root.style.setProperty('--journey-translate-x', '0px');
        root.style.setProperty('--journey-translate-y', '0px');
        this._rafId = requestAnimationFrame((n) => this._tick(n));
        return;
      }

      // Slow hue rotation: ~1.2°/sec cumulative, time-based not position-based.
      this._hueAccum = (this._hueAccum + 1.2 / 60) % 360;  // assume 60fps tick
      const hueDeg = this._hueAccum;

      // Saturation boost: audio-energy drives it, capped at +0.02.
      const satBoost = Math.min(s.audio.energy * 0.15, 0.02);

      // Brightness drift: motion magnitude, capped at +0.05.
      const motionMag = Math.hypot(s.player.velocity.x,s.player.velocity.y,s.player.velocity.z);
      const brightBoost = Math.min(motionMag * 0.08, 0.05);

      // Scale breathing: 0.3% on beat pulses, decays back.
      const beatScale = s.audio.beatPulse ? 0.003 : 0;

      // Translate nudge: cumulative position, very small.
      const txPx = Math.max(-2, Math.min(2, s.player.position.x * 2));
      const tyPx = Math.max(-2, Math.min(2, s.player.position.y * 2));

      root.style.setProperty('--journey-hue-deg', hueDeg.toFixed(2) + 'deg');
      root.style.setProperty('--journey-saturation', satBoost.toFixed(4));
      root.style.setProperty('--journey-brightness', brightBoost.toFixed(4));
      root.style.setProperty('--journey-scale', (1 + beatScale).toFixed(4));
      root.style.setProperty('--journey-translate-x', txPx.toFixed(2) + 'px');
      root.style.setProperty('--journey-translate-y', tyPx.toFixed(2) + 'px');

      this._rafId = requestAnimationFrame((n) => this._tick(n));
    },
  };

  window.JourneyEffects = Effects;
})();
