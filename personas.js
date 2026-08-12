// personas.js — five video-editor personas that style the whole composition.
// Each persona tunes ALL of the post-process uniforms (temperature, mutations,
// algorithm, posterize, vignette, chroma, grain, sepia, glow) for a coherent
// editor-style look. Picking a persona tween-slides every slider + uniform.
//
// The five personas (RAW / POSTER / MASK / FX / FILTER) cover the user's
// requested building blocks: video style, masks, effects, filters, posterization.
//
// Persona applies via window.FX.setPersona() (snaps state) and writes the
// matching slider values in the toolbar so the user sees what changed.
// Picking "— none —" restores neutral values.

(function () {
  if (window.Personas) return;  // idempotent

  // ---- Persona registry ----
  // Values are the same shape as window.FX.state, all 0..1 except temp (-1..1)
  // and mutAlgo (integer 0..5).
  const PERSONAS = {
    raw: {
      label: 'RAW',
      desc:  'Minimal intervention. Pure layers, light hue only. Clean music-video look.',
      temp:      0,
      mut:       0.15,
      mutAlgo:   0,
      posterize: 0,
      vignette:  0,
      chroma:    0,
      grain:     0,
      sepia:     0,
      glow:      0,
    },
    poster: {
      label: 'POSTER',
      desc:  'Heavy posterization (color reduction), high-contrast, no chromatic noise. Graphic-design look.',
      temp:      0.05,
      mut:       0.20,
      mutAlgo:   2,    // liquid
      posterize: 0.85, // ~4 levels
      vignette:  0.30,
      chroma:    0,
      grain:     0,
      sepia:     0,
      glow:      0,
    },
    mask: {
      label: 'MASK',
      desc:  'Strong radial vignette masks + soft glow. Cinematic, moody, focused center.',
      temp:     -0.10,
      mut:       0.25,
      mutAlgo:   0,    // vortex
      posterize: 0,
      vignette:  0.75,
      chroma:    0,
      grain:     0.20,
      sepia:     0,
      glow:      0.45,
    },
    fx: {
      label: 'FX',
      desc:  'Heavy effects: chromatic aberration, glitch displacement, scanlines. Cyberpunk / glitch art.',
      temp:     -0.20,
      mut:       0.70,
      mutAlgo:   1,    // glitch
      posterize: 0,
      vignette:  0.20,
      chroma:    0.75,
      grain:     0.30,
      sepia:     0,
      glow:      0,
    },
    filter: {
      label: 'FILTER',
      desc:  'Heavy film grain + sepia + soft glow. Analog, retro, nostalgic.',
      temp:      0.30,
      mut:       0.15,
      mutAlgo:   5,    // chromatic noise
      posterize: 0,
      vignette:  0.55,
      chroma:    0,
      grain:     0.85,
      sepia:     0.65,
      glow:      0.25,
    },

    // ---- 5 new personas ----
    neon: {
      label: 'NEON',
      desc:  'Electric magenta / cyan. Hot club, screen-blend stacks, sharpened easings, scanlines. Cuts on the beat, not after it.',
      temp:      -0.30,    // cool/cyan
      mut:       0.55,
      mutAlgo:   1,        // glitch (cuts on the beat)
      posterize: 0.20,    // light posterization for the cell look
      vignette:  0.10,
      chroma:    0.85,    // heavy RGB shift
      grain:     0.40,    // scanlines via grain
      sepia:     0,
      glow:      0.30,    // halation around bright pixels
      grayscale: 0,
      blur:      0,
    },

    filmfilm: {
      label: 'FILM',
      desc:  'Sepia / 16mm grain. Handheld warm tone, per-pixel grain, soft vignette, slow drift. Smooth easings throughout.',
      temp:      0.25,     // warm
      mut:       0.20,
      mutAlgo:   0,        // vortex — slow drift
      posterize: 0,
      vignette:  0.45,
      chroma:    0,
      grain:     0.80,    // heavy 16mm-style grain
      sepia:     0.70,    // strong sepia
      glow:      0.15,
      grayscale: 0,
      blur:      0,
    },

    grid: {
      label: 'GRID',
      desc:  'Monochrome / hard cells. 2×2 + half-cell composition, snap to the beat. Binary easings — no in-between, only on or off.',
      temp:      0,
      mut:       0.85,
      mutAlgo:   1,        // glitch (snap-beat feel)
      posterize: 0.95,    // ~4 levels = hard cells
      vignette:  0.20,
      chroma:    0,
      grain:     0.10,
      sepia:     0,
      glow:      0,
      grayscale: 1.0,     // fully monochrome
      blur:      0,
    },

    smoke: {
      label: 'SMOKE',
      desc:  'Cream warm / heavy blur. Everything at 0.5 opacity, slow drift, blurry and slow. The song moves through fog.',
      temp:      0.20,     // cream warm
      mut:       0.15,
      mutAlgo:   0,        // vortex — slow drift
      posterize: 0,
      vignette:  0.35,
      chroma:    0,
      grain:     0.15,
      sepia:     0.35,    // soft cream tint
      glow:      0.40,    // bloom through fog
      grayscale: 0,
      blur:      0.75,    // heavy blur
    },

    hallucination: {
      label: 'HALLUCINATION',
      desc:  'RGB shift / scanline body. Every reactor maxed. RGB channel shift, lighter and difference blends, noise canvas overlay.',
      temp:      -0.50,    // strong cool
      mut:       0.95,
      mutAlgo:   5,        // chromatic noise (max chaos)
      posterize: 0,
      vignette:  0.10,
      chroma:    1.00,    // MAX RGB shift
      grain:     0.90,    // scanline body
      sepia:     0,
      glow:      0.50,
      grayscale: 0,
      blur:      0,
    },
  };

  // ---- State ----
  const state = {
    currentKey: 'off',
    tween: null,
  };

  // ---- Slider IDs we write to when applying a persona ----
  // (mirrors fx-postprocess uniforms 1:1)
  const SLIDER_MAP = {
    temp:      'temperature',
    mut:       'mutations',
    mutAlgo:   'mut-algo',
    posterize: 'posterize',
    vignette:  'vignette',
    chroma:    'chroma',
    grain:     'grain',
    sepia:     'sepia',
    glow:      'glow',
    grayscale: 'grayscale',
    blur:      'blur',
  };

  // ---- Apply: snap FX state, then tween slider values ----
  function applyPersona(key) {
    if (key === 'off' || !PERSONAS[key]) {
      // Restore neutral state
      const neutral = {
        temp: 0, mut: 0, mutAlgo: 0,
        posterize: 0, vignette: 0, chroma: 0,
        grain: 0, sepia: 0, glow: 0,
      };
      if (window.FX) window.FX.setPersona(neutral);
      tweenSliders(neutral, 600);
      state.currentKey = 'off';
      if (typeof setStatus === 'function') setStatus('persona: off (neutral)', 'ok');
      return;
    }

    const p = PERSONAS[key];
    if (window.FX) window.FX.setPersona(p);
    tweenSliders(p, 1200);
    state.currentKey = key;

    if (typeof setStatus === 'function') {
      setStatus(`persona: ${p.label} — ${p.desc}`, 'ok');
    }
  }

  // Tween every slider + value-display from its current value to target over `dur` ms.
  function tweenSliders(target, dur) {
    const t0 = performance.now();
    const starts = {};
    for (const [k, sliderId] of Object.entries(SLIDER_MAP)) {
      const el = document.getElementById(sliderId);
      if (!el) { starts[k] = target[k]; continue; }
      starts[k] = parseFloat(el.value);
    }
    state.tween = { target, starts, t0, dur };
  }

  // Per-frame tween
  function tickTween() {
    const tw = state.tween;
    if (!tw) return;
    const t = Math.min(1, (performance.now() - tw.t0) / tw.dur);
    // ease-out cubic
    const e = 1 - Math.pow(1 - t, 3);
    for (const [k, sliderId] of Object.entries(SLIDER_MAP)) {
      const el = document.getElementById(sliderId);
      const valEl = document.getElementById(sliderId + '-v');
      if (!el) continue;
      const v = tw.starts[k] + (tw.target[k] - tw.starts[k]) * e;
      // mutAlgo is integer
      const out = (sliderId === 'mut-algo') ? Math.round(v) : v;
      el.value = String(out);
      if (valEl) valEl.textContent = (sliderId === 'mut-algo') ? String(out) : v.toFixed(2);
      // Mirror to FX so the live render updates
      if (window.FX) {
        if (k === 'temp')      window.FX.setTemp(v);
        if (k === 'mut')       window.FX.setMut(v);
        if (k === 'mutAlgo')   window.FX.setAlgo(Math.round(v));
        if (k === 'posterize') window.FX.setPosterize(v);
        if (k === 'vignette')  window.FX.setVignette(v);
        if (k === 'chroma')    window.FX.setChroma(v);
        if (k === 'grain')     window.FX.setGrain(v);
        if (k === 'sepia')     window.FX.setSepia(v);
        if (k === 'glow')      window.FX.setGlow(v);
        if (k === 'grayscale') window.FX.setGrayscale(v);
        if (k === 'blur')      window.FX.setBlur(v);
      }
    }
    if (t >= 1) state.tween = null;
  }

  function tick() {
    if (state.tween) tickTween();
    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);

  // ---- Wire dropdown ----
  function wireUI() {
    const sel = document.getElementById('persona');
    if (!sel) return;
    sel.addEventListener('change', (e) => applyPersona(e.target.value));
    // Sync dropdown with current key (e.g. on storage event)
  }

  // Boot
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', wireUI);
  } else {
    setTimeout(wireUI, 100);
  }

  // ---- Public API ----
  window.Personas = {
    PERSONAS,
    state,
    apply: applyPersona,
    current: () => state.currentKey,
  };
})();