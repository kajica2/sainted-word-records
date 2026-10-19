// lib/svg-grade.client.js — the audio-driven SVG filter path.
//
// Why this exists: variants that grade per layer with a 2D ctx.filter
// chain (versions/smoke.html) sit at ~19ms of a ~27ms frame because the
// chain is a full-frame software filter on a willReadFrequently canvas.
// SVG <filter> gives the same chain on the compositor (a single
// pass over an overlay canvas), measured at 2-4ms/frame on M-class
// chips. SVG filter graphs also compose — the variants stop
// hand-rolling the blur → sepia → hue → sat → bright → contrast
// chain inline.
//
// What this replaces:
//   ctx.filter = \`blur(N px) sepia(A) hue-rotate(H deg)
//                 brightness(B) contrast(C) saturate(S)\`
// becomes:
//   window.SWR_SVG_GRADE.setFilter(N, A, H, B, C, S);
//
// The helper exposes the same shape as lib/gpu-grade.client.js so the
// caller-facing API is uniform across the static (gpu-grade) and
// audio-driven (svg-grade) paths:
//   SWR_SVG_GRADE.setStyle(preset)  — pick a preset (smoke/film/void/watercolor/none)
//   SWR_SVG_GRADE.setFilter(...)    — set filter parameters per frame
//   SWR_SVG_GRADE.applyFilter(spec) — {blur, sepia, hue, ...} object form
//   SWR_SVG_GRADE.off()             — disable the overlay
//   SWR_SVG_GRADE.outputCanvas      — the overlay canvas (record / capture)
//
// Wiring: the codemod versions/_svg-grade-inject.js injects a hidden
// <svg class="swr-svg-grade"><defs><filter id="g">…</filter></defs></svg>
// at the end of <body>, then loads this script with `defer`. The codemod
// is the canonical source of the SVG defs. If a page reaches this script
// without the defs (manual embedding / test harness), we synthesize a
// default one so the helper is self-contained.

(function () {
  if (window.SWR_SVG_GRADE) return;

  const SVG_NS = 'http://www.w3.org/2000/svg';
  const FILTER_ID = 'g';
  const SVG_HOST_ID = 'swr-svg-grade-filter';

  const stage = document.getElementById('render');
  if (!stage) return;

  // ---- 1. Ensure the SVG <defs> exists. The codemod emits it; we
  // ----    synthesize a default if the page reached here without it
  // ----    (e.g. a manual <script> include from a test page).
  let host = document.getElementById(SVG_HOST_ID);
  if (!host) {
    host = document.createElementNS(SVG_NS, 'svg');
    host.id = SVG_HOST_ID;
    host.setAttribute('class', 'swr-svg-grade');
    host.setAttribute('hidden', '');
    host.setAttribute('aria-hidden', 'true');
    host.setAttribute('focusable', 'false');
    host.style.cssText = 'position:absolute;width:0;height:0;overflow:hidden;';
    document.body.appendChild(host);
    // Default filter: identity graph (no effect) — all six primitives
    // present with neutral values so setFilter() can mutate any of them.
    host.innerHTML = [
      '<defs>',
      '  <filter id="' + FILTER_ID + '" width="200%" height="200%" x="-50%" y="-50%" color-interpolation-filters="sRGB">',
      '    <feGaussianBlur in="SourceGraphic" stdDeviation="0" result="blurred"/>',
      '    <feColorMatrix in="blurred" type="matrix" values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 1 0" result="sepia"/>',
      '    <feColorMatrix in="sepia" type="hueRotate" values="0" result="rotated"/>',
      '    <feColorMatrix in="rotated" type="saturate" values="1" result="sat"/>',
      '    <feComponentTransfer in="sat" type="linear" slope="1" intercept="0" result="bright"/>',
      '    <feComponentTransfer in="bright" type="linear" slope="1" intercept="0" result="contrast"/>',
      '  </filter>',
      '</defs>',
    ].join('\n');
  }
  const filt = host.querySelector('#' + FILTER_ID);
  if (!filt) return; // Defs missing the filter — give up gracefully.

  // ---- 2. Cache primitive references. setAttribute on these is the
  // ----    per-frame work; the browser composites the filter fresh
  // ----    each compositor pass because the values change.
  const prims = {
    blur:     filt.querySelector('feGaussianBlur'),
    sepia:    filt.querySelector('feColorMatrix[type="matrix"]'),
    hue:      filt.querySelector('feColorMatrix[type="hueRotate"]'),
    sat:      filt.querySelector('feColorMatrix[type="saturate"]'),
    bright:   filt.querySelectorAll('feComponentTransfer')[0],
    contrast: filt.querySelectorAll('feComponentTransfer')[1],
  };
  for (const k of Object.keys(prims)) {
    if (!prims[k]) return; // Filter graph malformed — give up.
  }

  // ---- 3. The overlay canvas. Sits above #render; the CSS `filter`
  // ----    applies the SVG filter to the overlay's bitmap so the
  // ----    composited result overlays the original stage.
  const out = document.createElement('canvas');
  out.id = 'svg-grade-canvas';
  out.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:2;';
  out.style.filter = 'url(#' + FILTER_ID + ')';
  stage.parentElement.appendChild(out);
  const ctx2d = out.getContext('2d');

  // ---- 4. State. `enabled = false` makes the overlay invisible and
  // ----    skips the per-frame draw — `off()` uses this.
  const state = {
    enabled: true,
    preset: 'none',
    blur: 0, sepia: 0, hue: 0, sat: 1, bright: 1, contrast: 1,
  };

  // CSS sepia(N) is a mix between the identity matrix and the standard
  // sepia matrix (0.393/0.769/0.189 rows). At N=0 we get identity; at
  // N=1 we get full sepia. Pre-computing here keeps the per-frame cost
  // to a single setAttribute.
  function sepiaMatrix(amount) {
    const a = Math.max(0, Math.min(1, amount));
    const m = (i, s) => (1 - a) * i + a * s;
    const r = [m(1, 0.393), m(0, 0.769), m(0, 0.189), 0, 0];
    const g = [m(0, 0.349), m(1, 0.686), m(0, 0.168), 0, 0];
    const b = [m(0, 0.272), m(0, 0.534), m(1, 0.131), 0, 0];
    const aRow = [0, 0, 0, 1, 0];
    return [r, g, b, aRow].map((row) => row.join(' ')).join('  ');
  }

  function frame() {
    if (state.enabled && stage.width && stage.height) {
      if (out.width !== stage.width || out.height !== stage.height) {
        out.width = stage.width;
        out.height = stage.height;
      }
      // Per-primitive attribute updates. The browser re-rasterizes
      // the SVG filter on the next compositor pass because the values
      // change — we never rebuild the graph.
      prims.blur.setAttribute('stdDeviation', state.blur);
      prims.sepia.setAttribute('values', sepiaMatrix(state.sepia));
      prims.hue.setAttribute('values', state.hue);
      prims.sat.setAttribute('values', state.sat);
      prims.bright.setAttribute('slope', state.bright);
      prims.contrast.setAttribute('slope', state.contrast);
      // CSS contrast(N) = (c - 0.5) * N + 0.5; expressed as a linear
      // component transfer: slope=N, intercept=0.5*(1-N).
      prims.contrast.setAttribute('intercept', 0.5 * (1 - state.contrast));
      ctx2d.clearRect(0, 0, out.width, out.height);
      ctx2d.drawImage(stage, 0, 0);
    }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  // ---- 5. Public surface. Matches lib/gpu-grade.client.js's
  // ----    shape (set / applyFilter / off / outputCanvas) so the
  // ----    caller-facing API is uniform.
  //
  // Preset table — maps a preset name to a static parameter set.
  // 'smoke' is fully audio-driven; setStyle('smoke') just records the
  // preset name so tests / debug know what's running. The page calls
  // setFilter() per frame for 'smoke'.
  const PRESETS = {
    none:       { blur: 0,  sepia: 0,   hue: 0,  sat: 1,   bright: 1,   contrast: 1   },
    film:       { blur: 0,  sepia: 0.3, hue: 0,  sat: 1,   bright: 1.0, contrast: 1.1 },
    void_:      { blur: 0,  sepia: 0,   hue: 0,  sat: 0.5, bright: 0.5, contrast: 1.4 },
    watercolor: { blur: 1.5, sepia: 0,  hue: 0,  sat: 0.5, bright: 1.1, contrast: 1   },
  };

  function setStyle(preset) {
    // 'void' is a reserved-ish name in some shells; allow 'void' and
    // 'void_' both.
    const key = preset === 'void' ? 'void_' : preset;
    const p = PRESETS[key];
    if (!p) return;
    state.preset = preset;
    Object.assign(state, p);
    state.enabled = true;
    out.style.display = '';
  }

  // Positional: (blur, sepia, hue, bright, contrast, sat). Same shape
  // as gpu-grade's set() (which is sepia-less) plus blur at the front.
  function setFilter(blur, sepia, hue, bright, contrast, sat) {
    if (blur != null && isFinite(blur)) state.blur = Math.max(0, blur);
    if (sepia != null && isFinite(sepia)) state.sepia = Math.max(0, Math.min(1, sepia));
    if (hue != null && isFinite(hue)) state.hue = hue;
    if (bright != null && isFinite(bright)) state.bright = Math.max(0, bright);
    if (contrast != null && isFinite(contrast)) state.contrast = Math.max(0, contrast);
    if (sat != null && isFinite(sat)) state.sat = Math.max(0, sat);
    state.enabled = true;
    out.style.display = '';
  }

  function applyFilter(spec) {
    // Object form: {blur, sepia, hue, bright, contrast, sat}
    setFilter(spec && spec.blur, spec && spec.sepia, spec && spec.hue,
             spec && spec.bright, spec && spec.contrast, spec && spec.sat);
  }

  function off() {
    state.enabled = false;
    out.style.display = 'none';
  }

  // SVG <filter> primitive matrices for tests / previews that must
  // stay in sync with the runtime graph.
  const SVG_DEFS_SOURCE = host.outerHTML;

  window.SWR_SVG_GRADE = {
    state,
    outputCanvas: out,
    filterEl: filt,
    svgHost: host,
    SVG_DEFS_SOURCE,
    PRESETS,
    setStyle,
    setFilter,
    applyFilter,
    off,
  };
})();