// personas.js — editor personas that style the whole composition.
// Each persona tunes ALL of the post-process uniforms (temperature, mutations,
// algorithm, posterize, vignette, chroma, grain, sepia, glow, grayscale, blur,
// plus liquid/pearl/glitch distortion from the flexible-smart-videomaker
// preset system) for a coherent editor-style look. Picking a persona tween-
// slides every slider + uniform.
//
// The first 5 (RAW / POSTER / MASK / FX / FILTER) cover the user's requested
// building blocks: video style, masks, effects, filters, posterization. The
// next 5 (NEON / FILM / GRID / SMOKE / HALLUCINATION) are club/cinema looks.
// The last 5 (LIQUID GLASS / PEARL HAZE / CLUB STROBE / VHS VIBE / NEON WASH)
// are ported from github.com/kajica2/flexible-smart-videomaker.
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
      temp: 0, mut: 0.15, mutAlgo: 0,
      posterize: 0, vignette: 0, chroma: 0, grain: 0, sepia: 0, glow: 0,
      liquid: 0, pearl: 0, glitch: 0,
    },
    poster: {
      label: 'POSTER',
      desc:  'Heavy posterization (color reduction), high-contrast, no chromatic noise. Graphic-design look.',
      temp: 0.05, mut: 0.20, mutAlgo: 2,    // liquid
      posterize: 0.85, vignette: 0.30, chroma: 0, grain: 0, sepia: 0, glow: 0,
      liquid: 0, pearl: 0, glitch: 0,
    },
    mask: {
      label: 'MASK',
      desc:  'Strong radial vignette masks + soft glow. Cinematic, moody, focused center.',
      temp: -0.10, mut: 0.25, mutAlgo: 0,    // vortex
      posterize: 0, vignette: 0.75, chroma: 0, grain: 0.20, sepia: 0, glow: 0.45,
      liquid: 0, pearl: 0, glitch: 0,
    },
    fx: {
      label: 'FX',
      desc:  'Heavy effects: chromatic aberration, glitch displacement, scanlines. Cyberpunk / glitch art.',
      temp: -0.20, mut: 0.70, mutAlgo: 1,    // glitch
      posterize: 0, vignette: 0.20, chroma: 0.75, grain: 0.30, sepia: 0, glow: 0,
      liquid: 0.20, pearl: 0, glitch: 0.35,
    },
    filter: {
      label: 'FILTER',
      desc:  'Heavy film grain + sepia + soft glow. Analog, retro, nostalgic.',
      temp: 0.30, mut: 0.15, mutAlgo: 5,    // chromatic noise
      posterize: 0, vignette: 0.55, chroma: 0, grain: 0.85, sepia: 0.65, glow: 0.25,
      liquid: 0, pearl: 0, glitch: 0,
    },

    // ---- 5 club / cinema looks ----
    neon: {
      label: 'NEON',
      desc:  'Electric magenta / cyan. Hot club, screen-blend stacks, sharpened easings, scanlines. Cuts on the beat, not after it.',
      temp: -0.30, mut: 0.55, mutAlgo: 1,        // glitch (cuts on the beat)
      posterize: 0.20, vignette: 0.10, chroma: 0.85, grain: 0.40, sepia: 0, glow: 0.30,
      grayscale: 0, blur: 0,
      liquid: 0, pearl: 0, glitch: 0.15,
    },
    filmfilm: {
      label: 'FILM',
      desc:  'Sepia / 16mm grain. Handheld warm tone, per-pixel grain, soft vignette, slow drift. Smooth easings throughout.',
      temp: 0.25, mut: 0.20, mutAlgo: 0,        // vortex — slow drift
      posterize: 0, vignette: 0.45, chroma: 0, grain: 0.80, sepia: 0.70, glow: 0.15,
      grayscale: 0, blur: 0,
      liquid: 0, pearl: 0, glitch: 0,
    },
    grid: {
      label: 'GRID',
      desc:  'Monochrome / hard cells. 2×2 + half-cell composition, snap to the beat. Binary easings — no in-between, only on or off.',
      temp: 0, mut: 0.85, mutAlgo: 1,        // glitch (snap-beat feel)
      posterize: 0.95, vignette: 0.20, chroma: 0, grain: 0.10, sepia: 0, glow: 0,
      grayscale: 1.0, blur: 0,
      liquid: 0, pearl: 0, glitch: 0.10,
    },
    smoke: {
      label: 'SMOKE',
      desc:  'Cream warm / heavy blur. Everything at 0.5 opacity, slow drift, blurry and slow. The song moves through fog.',
      temp: 0.20, mut: 0.15, mutAlgo: 0,        // vortex — slow drift
      posterize: 0, vignette: 0.35, chroma: 0, grain: 0.15, sepia: 0.35, glow: 0.40,
      grayscale: 0, blur: 0.75,
      liquid: 0.10, pearl: 0.30, glitch: 0,
    },
    hallucination: {
      label: 'HALLUCINATION',
      desc:  'RGB shift / scanline body. Every reactor maxed. RGB channel shift, lighter and difference blends, noise canvas overlay.',
      temp: -0.50, mut: 0.95, mutAlgo: 5,        // chromatic noise (max chaos)
      posterize: 0, vignette: 0.10, chroma: 1.00, grain: 0.90, sepia: 0, glow: 0.50,
      grayscale: 0, blur: 0,
      liquid: 0.30, pearl: 0.40, glitch: 0.50,
    },

    // ---- 5 from flexible-smart-videomaker (kajica2/flexible-smart-videomaker) ----
    // Slider values are 0–100 in the source repo; here they're normalised to 0..1.
    // liquid  → u_liquid (fbm domain warp)
    // pearl   → u_pearl  (Voronoi cells)
    // grain   → u_grain  (existing)
    // chroma  → u_chroma (RGB split, existing)
    // glitch  → u_glitch (horizontal slice displacement)
    liquidglass: {
      label: 'LIQUID GLASS',
      desc:  'Refractive glass, soft pearl haze. From flexible-smart-videomaker.',
      temp: 0.10, mut: 0, mutAlgo: 0,
      posterize: 0, vignette: 0.10, chroma: 0.14, grain: 0.08, sepia: 0, glow: 0.10,
      liquid: 0.55, pearl: 0.18, glitch: 0.04,
    },
    pearlhaze: {
      label: 'PEARL HAZE',
      desc:  'Heavy bubble pearls, dreamy. From flexible-smart-videomaker.',
      temp: 0.20, mut: 0, mutAlgo: 0,
      posterize: 0, vignette: 0.20, chroma: 0.08, grain: 0.14, sepia: 0.10, glow: 0.30,
      liquid: 0.18, pearl: 0.70, glitch: 0,
    },
    clubstrobe: {
      label: 'CLUB STROBE',
      desc:  'Punchy RGB split + glitch slices. From flexible-smart-videomaker.',
      temp: -0.30, mut: 0.30, mutAlgo: 1,        // glitch algorithm
      posterize: 0.30, vignette: 0.10, chroma: 0.55, grain: 0.26, sepia: 0, glow: 0.20,
      liquid: 0.40, pearl: 0.30, glitch: 0.38,
    },
    vhsvibe: {
      label: 'VHS VIBE',
      desc:  'Tape grain, RGB drift, slice tear. From flexible-smart-videomaker.',
      temp: 0.05, mut: 0, mutAlgo: 1,
      posterize: 0.15, vignette: 0.40, chroma: 0.50, grain: 0.60, sepia: 0.25, glow: 0.05,
      liquid: 0.22, pearl: 0.10, glitch: 0.28,
    },
    neonwash: {
      label: 'NEON WASH',
      desc:  'Wet neon refraction, soft edges. From flexible-smart-videomaker.',
      temp: -0.20, mut: 0.20, mutAlgo: 2,        // liquid algorithm
      posterize: 0.10, vignette: 0.10, chroma: 0.36, grain: 0.12, sepia: 0, glow: 0.40,
      liquid: 0.60, pearl: 0.22, glitch: 0.10,
    },

    // ---- 5 from morpha-protocol (kajica2/morpha-protocol) ----
    // MORPHA is an open protocol for non-verbal symbolic communication through
    // transformation, sound, and silence. Its grammar requires:
    //   - no instantaneous transitions (continuous, no hard cuts)
    //   - silence as a first-class signal
    //   - overlap generates semantics
    //   - "If it feels alive, it is compliant."
    // The 5 symbol families each have a distinct semantic field and behavior,
    // translated below into FX parameters. glitch=0 across all of them —
    // hard slices violate the no-instantaneous-transitions rule.
    morphaanchor: {
      label: 'MORPHA · ANCHOR',
      desc:  'Anchor — presence, grounding, identity. High resistance, low velocity, central mass. From morpha-protocol.',
      temp: 0.15, mut: 0.10, mutAlgo: 0,        // vortex — central mass
      posterize: 0, vignette: 0.65, chroma: 0.05, grain: 0.20, sepia: 0.20, glow: 0.30,
      grayscale: 0, blur: 0.15,
      liquid: 0.30, pearl: 0.10, glitch: 0,     // continuity preserved
    },
    morphaflow: {
      label: 'MORPHA · FLOW',
      desc:  'Flow — movement, time, becoming. Low resistance, directional continuity. From morpha-protocol.',
      temp: 0.05, mut: 0.45, mutAlgo: 2,        // liquid algorithm — continuous flow
      posterize: 0, vignette: 0.10, chroma: 0.30, grain: 0.10, sepia: 0, glow: 0.20,
      grayscale: 0, blur: 0.10,
      liquid: 0.65, pearl: 0.25, glitch: 0,     // directional continuity
    },
    morphafracture: {
      label: 'MORPHA · FRACTURE',
      desc:  'Fracture — rupture, decision, conflict. Asymmetric resistance, instability. From morpha-protocol.',
      temp: -0.25, mut: 0.75, mutAlgo: 1,       // glitch algorithm — instability
      posterize: 0.50, vignette: 0.40, chroma: 0.80, grain: 0.40, sepia: 0, glow: 0,
      grayscale: 0, blur: 0,
      liquid: 0.10, pearl: 0, glitch: 0.45,     // asymmetric resistance (high)
    },
    morphavoid: {
      label: 'MORPHA · VOID',
      desc:  'Void — silence, waiting, surrender. Minimal mass, long decay, dominance through absence. From morpha-protocol.',
      temp: -0.40, mut: 0, mutAlgo: 0,          // surrender — no motion
      posterize: 0, vignette: 0.85, chroma: 0, grain: 0.15, sepia: 0.45, glow: 0,
      grayscale: 0.60, blur: 0.50,              // dissolved, dreamlike
      liquid: 0, pearl: 0.30, glitch: 0,        // silence as signal
    },
    morphaecho: {
      label: 'MORPHA · ECHO',
      desc:  'Echo — memory, reflection, longing. Delayed repetition, persistence. From morpha-protocol.',
      temp: 0.30, mut: 0.20, mutAlgo: 4,        // ripple — wave-based
      posterize: 0, vignette: 0.50, chroma: 0.15, grain: 0.55, sepia: 0.55, glow: 0.30,
      grayscale: 0.10, blur: 0.40,              // reflections are soft
      liquid: 0.10, pearl: 0.40, glitch: 0,     // persistence
    },

    // ---- 3 from an audio-GAN training schedule ----
    // Each persona embodies one stage of a multi-stage adversarial training
    // run. The mapping is conceptual: loss weights become FX layer amounts,
    // optimizer choice becomes mutation style, discriminator presence
    // becomes complexity. Stage 1 is the foundational look; Stage 3 is the
    // full multi-objective training configuration.
    //
    //   Loss weight → FX        | Optimizer / Disc  → mutation style
    //   λSTFT       → grain       | Muon (stable)     → low mut, smooth
    //   λKL         → posterize   | AdamW (adaptive)  → high mut, dynamic
    //   λtime-GAN   → glitch      | Disc present      → motion rate
    //   λspec-GAN   → liquid/pearl
    //   λIF_GD      → liquid (intermediate features)
    trainstage1: {
      label: 'TRAIN · STAGE 1',
      desc:  'Muon, no discriminator. STFT=1.0 only. Foundational, spectral, stable. One objective, no adversary.',
      temp: 0, mut: 0.10, mutAlgo: 2,           // liquid — spectral flow
      posterize: 0,                             // λKL ≈ 0
      vignette: 0.15, chroma: 0.10, grain: 0.60, sepia: 0, glow: 0,
      grayscale: 0, blur: 0,
      liquid: 0.15, pearl: 0, glitch: 0,        // no time-GAN, no spec-GAN
    },
    trainstage2: {
      label: 'TRAIN · STAGE 2',
      desc:  'Muon + discriminator, 1:1 interleave. STFT=1.0 + time-GAN=1.0. Balanced adversarial — time-domain kicks in.',
      temp: -0.05, mut: 0.35, mutAlgo: 1,       // glitch — time-GAN adds time-domain
      posterize: 0, vignette: 0.20, chroma: 0.15, grain: 0.40, sepia: 0, glow: 0.10,
      grayscale: 0, blur: 0,
      liquid: 0.30, pearl: 0.15, glitch: 0.50, // time-GAN adv=1.0
    },
    trainstage3: {
      label: 'TRAIN · STAGE 3',
      desc:  'AdamW + multi-discriminator (CQT + spectral). All losses. 4:1 G:D. Refined, complex, multi-objective.',
      temp: 0.10, mut: 0.60, mutAlgo: 5,        // chromatic noise — full multi-obj
      posterize: 0.15, vignette: 0.30, chroma: 0.30, grain: 0.20, sepia: 0.10, glow: 0.20,
      grayscale: 0, blur: 0,
      liquid: 0.50, pearl: 0.45, glitch: 0.18, // spec-GAN=0.5, time-GAN=0.175
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
    liquid:    'liquid',
    pearl:     'pearl',
    glitch:    'glitch',
  };

  // ---- Apply: snap FX state, then tween slider values ----
  function applyPersona(key) {
    if (key === 'off' || !PERSONAS[key]) {
      // Restore neutral state
      const neutral = {
        temp: 0, mut: 0, mutAlgo: 0,
        posterize: 0, vignette: 0, chroma: 0,
        grain: 0, sepia: 0, glow: 0,
        grayscale: 0, blur: 0,
        liquid: 0, pearl: 0, glitch: 0,
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
        if (k === 'liquid')    window.FX.setLiquid(v);
        if (k === 'pearl')     window.FX.setPearl(v);
        if (k === 'glitch')    window.FX.setGlitch(v);
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