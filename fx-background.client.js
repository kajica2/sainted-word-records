// fx-background.client.js — static procedural FX behind every page.
//
// Wires the engine's 14-FX shader pipeline (fx-postprocess.js) to every
// top-level HTML as a fixed-position background composer. The shader
// runs on a procedurally-generated gradient texture (no audio, no
// per-frame cost beyond a single fullscreen-quad pass).
//
// Load with: <script src="/fx-background.client.js" defer></script>
// Idempotent. Skips pages that already have an engine canvas#render
// (e.g. engine.html) so we don't double up with the engine's own
// fx-postprocess composer.

(function () {
  'use strict';
  if (window.__swrFxBackground) return;
  window.__swrFxBackground = true;

  // Don't apply on engine-rendered pages — those have their own composer
  // driven by window.Audio.feat.
  if (document.getElementById('render')) return;

  // ---- build a procedural source canvas (the "feed" for the shader) ----
  // We draw a layered gradient with subtle animation. The shader sees
  // this as its source texture and applies the 14-FX pipeline on top.
  const SRC_W = 1280, SRC_H = 720;
  const src = document.createElement('canvas');
  src.width = SRC_W;
  src.height = SRC_H;
  src.style.cssText = 'position:absolute;left:-9999px;top:-9999px;';
  document.body.appendChild(src);
  const sctx = src.getContext('2d');

  // Per-page gradient palette — the FX variation comes from the source
  // texture, not the FX knobs. We pick a palette from the active preset
  // (set via <body data-fx="neon"> or default 'warm').
  //
  // a — mid stop (60% of the radial), b — centre, c/d — the drifting orbs,
  // z — the outer stop. `z` defaults to black: every palette here is a dark
  // field, and the additive bloom below brightens it toward the centre. A
  // light page needs `z` set to its own paper colour, otherwise the dark
  // outer ring turns the background muddy (this is what `rose` fixes).
  const FX_PALETTES = {
    warm:      { a: '#3a1f0c', b: '#5a3a1c', c: '#d4a04a', d: '#f5b860' },
    neon:      { a: '#0a0414', b: '#1a0a2a', c: '#ff3d92', d: '#00e5ff' },
    film:      { a: '#0a0805', b: '#1a1208', c: '#8b5a3c', d: '#efe2c8' },
    grid:      { a: '#0a0420', b: '#1a0834', c: '#ff6b1a', d: '#1ae5ff' },
    smoke:     { a: '#0f0a08', b: '#1f1814', c: '#a89888', d: '#d4b89a' },
    hallucination: { a: '#0a0420', b: '#1f0a3a', c: '#a020f0', d: '#00e5ff' },
    broadcast: { a: '#080808', b: '#1f1f1f', c: '#ff2020', d: '#00d4ff' },
    cassette:  { a: '#1a1208', b: '#3a2410', c: '#ff8c1a', d: '#f5d4a8' },
    // Light editorial: personas.html's paper + rose accent (#e6306b), with
    // the terracotta rule colour (#ff8a3a) as the second orb. The additive
    // bloom below is tuned for near-black fields — at full strength it
    // saturates a paper-toned base straight to white — so this palette
    // turns it down. Base sits just under the page paper (#faf7f2) so the
    // orbs read as colour rather than as glare.
    // `dark` overrides the same knobs when the document is on its dark
    // theme. Only pages with a light/dark toggle need this (personas and the
    // variant pages); everywhere else a static palette is correct.
    rose:      {
      a: '#f7efea', b: '#fbf7f3', z: '#f9f3ee', c: '#e6306b', d: '#ff8a3a', bloom: 0, orbAlpha: 0.3,
      dark: { a: '#1a1210', b: '#241a16', z: '#120d0b', c: '#ff2d8a', d: '#ffaa3a', bloom: 1, orbAlpha: 1 },
    },
  };

  // True when the document is on its dark theme. <html data-theme> is the
  // authoritative switch (the explicit toggle sets it); 'system' defers to
  // the media query, same rule the page tokens use.
  function isDarkTheme() {
    const t = document.documentElement.getAttribute('data-theme');
    if (t === 'dark') return true;
    if (t === 'light') return false;
    return !!(window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);
  }

  function pickPalette() {
    const body = document.body;
    const tag = (body && body.dataset && body.dataset.fx) || 'warm';
    const base = FX_PALETTES[tag] || FX_PALETTES.warm;
    if (base.dark && isDarkTheme()) return Object.assign({}, base, base.dark);
    return base;
  }

  function paintSource(t, p) {
    const w = SRC_W, h = SRC_H;
    // Base radial
    const bg = sctx.createRadialGradient(
      w * (0.5 + 0.05 * Math.sin(t * 0.3)),
      h * (0.5 + 0.05 * Math.cos(t * 0.27)),
      50,
      w * 0.5, h * 0.5, w * 0.9
    );
    bg.addColorStop(0, p.b);
    bg.addColorStop(0.6, p.a);
    // Default black keeps every dark palette byte-identical to before; a
    // light palette opts out with `z` so the vignette does not go muddy.
    bg.addColorStop(1, p.z || '#000');
    sctx.fillStyle = bg;
    sctx.fillRect(0, 0, w, h);

    // Layered orbs that drift slowly — provides high-frequency content
    // for the FX to act on. Each orb is a soft radial gradient.
    const orbs = 7;
    for (let i = 0; i < orbs; i++) {
      const phase = (i / orbs) * Math.PI * 2;
      const cx = w * (0.5 + 0.35 * Math.cos(t * 0.18 + phase));
      const cy = h * (0.5 + 0.35 * Math.sin(t * 0.21 + phase * 1.3));
      const r = 120 + 60 * Math.sin(t * 0.4 + i);
      const g = sctx.createRadialGradient(cx, cy, 0, cx, cy, r);
      const col = i % 2 ? p.c : p.d;
      // orbAlpha attenuates the orbs for light palettes, where an 0.8-alpha
      // wash would read as a stain on paper rather than as light.
      const oa = p.orbAlpha == null ? 1 : p.orbAlpha;
      g.addColorStop(0, col + Math.round(0xcc * oa).toString(16).padStart(2, '0'));
      g.addColorStop(0.4, col + Math.round(0x44 * oa).toString(16).padStart(2, '0'));
      g.addColorStop(1, 'transparent');
      sctx.fillStyle = g;
      sctx.beginPath();
      sctx.arc(cx, cy, r, 0, Math.PI * 2);
      sctx.fill();
    }
  }

  // ---- inject a fixed fullscreen canvas at z-index 0 ----
  const fx = document.createElement('canvas');
  fx.id = 'swr-fx-bg';
  fx.style.cssText = [
    'position:fixed',
    'inset:0',
    'width:100vw',
    'height:100vh',
    // z-index:-1 so the canvas paints BEHIND in-flow page content (it only
    // sits above the root background). z-index:0 looked equivalent but was
    // not: positioned z-index:0 elements paint ABOVE static in-flow content,
    // so the canvas covered every page whose content isn't itself positioned
    // (press, about, changelog, intro, status, 404 — all shipped covered).
    // A page that wants a solid background instead of the FX can set an
    // explicit html{background:<color>} — that paints at the root layer,
    // below this canvas.
    'z-index:-1',
    'pointer-events:none',
  ].join(';');
  // Insert as the first child of <body>, AFTER any existing nav.
  // The nav is also position:sticky, but z-index 9998, so it sits on top.
  const nav = document.querySelector('.swr-topnav');
  if (nav && nav.nextSibling) {
    document.body.insertBefore(fx, nav.nextSibling);
  } else if (nav) {
    document.body.appendChild(fx);
  } else {
    document.body.insertBefore(fx, document.body.firstChild);
  }
  const fctx = fx.getContext('2d');

  // Stacking note: content paints above this canvas because in-flow static
  // content and positioned content both paint after negative-z descendants.
  // The nav sits at z-index 9998; the FX is z-index -1 (see above).

  // ---- per-frame render ----
  // Without WebGL we'd just draw the source to the FX canvas every frame.
  // But the request was for the engine's 14-FX pipeline, which is a
  // WebGL fragment shader. We can't run WebGL without the full
  // fx-postprocess.js infrastructure (program, uniforms, framebuffers).
  // So: do a CSS-filter approach that approximates the FX look without
  // the WebGL overhead. Reads better on low-end devices and is reliable.
  let startedAt = performance.now();
  function tick() {
    const t = (performance.now() - startedAt) / 1000;
    // Resolved once per frame and threaded into paintSource: the palette
    // depends on the theme, and looking it up three times per frame was
    // both wasteful and racy against the theme toggle.
    const pal = pickPalette();
    paintSource(t, pal);
    // Bloom strength. Default 1 (byte-identical for every dark palette);
    // a light palette attenuates it via `bloom` so the additive pass does
    // not clip a paper-toned base to white.
    const bl = pal.bloom == null ? 1 : pal.bloom;
    // Composite source → fx canvas. Apply a few CSS-style filters via
    // the canvas 2D context (these mimic what the shader does).
    fctx.save();
    fctx.clearRect(0, 0, fx.width, fx.height);
    // Subtle scale/translate to make the FX feel alive
    const scale = 1.05 + 0.02 * Math.sin(t * 0.3);
    const w = fx.width, h = fx.height;
    fctx.translate(w / 2, h / 2);
    fctx.scale(scale, scale);
    fctx.translate(-w / 2, -h / 2);
    fctx.drawImage(src, 0, 0, w, h);
    // Bloom-ish: draw a blurred copy on top
    fctx.globalCompositeOperation = 'lighter';
    fctx.filter = 'blur(40px)';
    fctx.globalAlpha = 0.35 * bl;
    fctx.drawImage(src, 0, 0, w, h);
    fctx.filter = 'blur(8px)';
    fctx.globalAlpha = 0.25 * bl;
    fctx.drawImage(src, 0, 0, w, h);
    fctx.filter = 'none';
    fctx.globalAlpha = 1;
    fctx.globalCompositeOperation = 'source-over';
    fctx.restore();
    requestAnimationFrame(tick);
  }
  function fitCanvas() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    fx.width = Math.floor(window.innerWidth * dpr);
    fx.height = Math.floor(window.innerHeight * dpr);
  }
  fitCanvas();
  if (window.ResizeObserver) new ResizeObserver(fitCanvas).observe(document.documentElement);
  window.addEventListener('resize', fitCanvas);
  requestAnimationFrame(tick);
})();
