// client/look-filter-cycler.client.js — Tint + variant look cycler.
//
// T+1..9 apply pre-baked look filters that mix tone, tint, grain,
// sepia, vignette and (optionally) the engine variant. T+0 clears
// the filter and resets the FX back to no grade.
//
// Slot layout:
//   0 = no filter
//   1 = soft                  (subtle desaturation, slight cool)
//   2 = old cinema (polished) (sepia + grain + vignette + slight blur)
//                            — the dust & scratches feel, refined
//   3-7 = cinematic palette   (5 graded variants on the cinema theme)
//   8 = void warm             (heavy desaturation, warm push)
//   9 = echo                  (deep cool, high tone)
//
// `T+1..T+7` covers the cinematic colour-tone ramp so a director can
// quickly settle on a mood without leaving the keyboard.
//
// Why the T prefix? The bare digits are already claimed for layer
// selection, story, remap, FX-presets; we needed somewhere that
// wouldn't collide and reads naturally ("T" = tint). The 2s window is
// stored on window.__swrLookModeUntil.
//
// All values 0..1 unless marked otherwise. temp uses -100..100
// (cool..warm). The state is held on window.SWR_LOOK_FILTER and the
// UI can read what's applied.

(() => {
  // Full look table. fx shape mirrors FX.setPersona() so we could route
  // through that, but per-slot direct setters give finer control here
  // (intensity slider still applies on top — see fx-postprocess.js).
  const LOOKS = [
    // 1 — gentle: barely there
    {
      label: 'soft', tone: 0.20, temp: -8, sepia: 0, grain: 0.10,
      vignette: 0.15, blur: 0, grayscale: 0, variant: null,
    },
    // 2 — OLD CINEMA, polished. Sepia warm, real grain (the dust),
    // soft vignette (the projector halo), a hair of blur (the gate).
    // No variant swap — the underlying clip stays; the grade does the work.
    {
      label: 'old cinema', tone: 0.45, temp: 35, sepia: 0.6, grain: 0.55,
      vignette: 0.55, blur: 0.04, grayscale: 0.45, variant: null,
    },
    // 3..7 — five cinematic colour-tone variants. Each one sets its own
    // (temp, tone, vignette, grain) so the same clip reads as five
    // different moods. No hard grade overrides — they stay musical.
    {
      label: 'cinema · cool', tone: 0.30, temp: -45, sepia: 0.05, grain: 0.20,
      vignette: 0.30, blur: 0, grayscale: 0, variant: null,
    },
    {
      label: 'cinema · teal',  tone: 0.35, temp: -15, sepia: 0, grain: 0.18,
      vignette: 0.28, blur: 0, grayscale: 0, variant: null,
    },
    {
      label: 'cinema · amber', tone: 0.30, temp:  30, sepia: 0.10, grain: 0.22,
      vignette: 0.32, blur: 0, grayscale: 0, variant: null,
    },
    {
      label: 'cinema · rose',  tone: 0.28, temp:  18, sepia: 0, grain: 0.18,
      vignette: 0.30, blur: 0, grayscale: 0, variant: null,
    },
    {
      label: 'cinema · mono',  tone: 0.50, temp:   0, sepia: 0, grain: 0.28,
      vignette: 0.40, blur: 0, grayscale: 0.85, variant: null,
    },
    // 8 — void warm: deep desaturation + warm push (aftermovie feel)
    {
      label: 'void warm', tone: 0.70, temp: 35, sepia: 0.10, grain: 0.20,
      vignette: 0.35, blur: 0.02, grayscale: 0, variant: 'void',
    },
    // 9 — echo: cool + heavy tone, using the echo-manifold variant
    {
      label: 'echo', tone: 0.80, temp: -45, sepia: 0, grain: 0.15,
      vignette: 0.30, blur: 0, grayscale: 0, variant: 'echo-manifold',
    },
  ];

  // FX setters used by the filter (mapped to actual window.FX API)
  const FX_SETTERS = {
    tone:        (v) => window.FX.setTone && window.FX.setTone(v),
    sepia:       (v) => window.FX.setSepia && window.FX.setSepia(v),
    grain:       (v) => window.FX.setGrain && window.FX.setGrain(v),
    vignette:    (v) => window.FX.setVignette && window.FX.setVignette(v),
    blur:        (v) => window.FX.setBlur && window.FX.setBlur(v),
    grayscale:   (v) => window.FX.setGrayscale && window.FX.setGrayscale(v),
    // `temp` lives on FX.state directly (it's the temperature uniform)
    temp:        (v) => window.FX.setTemp && window.FX.setTemp(v),
  };

  function applyLook(slot) {
    // Pass 0 = clear filter (keep current variant)
    if (slot === 0) {
      Object.values(FX_SETTERS).forEach(fn => { try { fn(0); } catch (_) {} });
      if (window.setStatus) window.setStatus('look: none', 'ok');
      window.SWR_LOOK_FILTER = { slot: 0, label: 'none' };
      try { window.dispatchEvent(new CustomEvent('swr-look-filter', {
        detail: { slot: 0, label: 'none' }
      })); } catch (_) {}
      return true;
    }
    const idx = slot - 1;
    if (idx < 0 || idx >= LOOKS.length) return false;
    const look = LOOKS[idx];
    // Apply each FX setter. `temp` is held in -1..1 here (matches
    // window.FX.setTemp's clamp). -1 = full cool, +1 = full warm.
    if (window.FX) {
      for (const k of Object.keys(FX_SETTERS)) {
        if (typeof look[k] === 'number') {
          const v = (k === 'temp') ? look[k] / 100 : look[k];
          try { FX_SETTERS[k](v); } catch (_) {}
        }
      }
    }
    // Variant switcher: switch if a variant name was provided
    if (look.variant && window.SWR_VARIANTS && typeof window.SWR_VARIANTS.activate === 'function') {
      try { window.SWR_VARIANTS.activate(look.variant); } catch (_) {}
    }
    if (window.setStatus) window.setStatus('look: ' + look.label, 'ok');
    window.SWR_LOOK_FILTER = Object.assign({ slot: slot }, look);
    try { window.dispatchEvent(new CustomEvent('swr-look-filter', {
      detail: Object.assign({ slot: slot }, look)
    })); } catch (_) {}
    return true;
  }

  window.SWR_LOOK_FILTER_CYCLER = {
    list: LOOKS,
    apply: applyLook,
    get current() { return window.SWR_LOOK_FILTER || null; },
  };
})();
