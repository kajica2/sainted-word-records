// client/variant-switcher.client.js — select any variant look inside the main engine
//
// The version pages (versions/neon.html, film, grid, smoke, hallucination, eclipse)
// are NOT data: each variant's visual identity lives in bespoke inline canvas
// functions (drawFx + friends) that the user has hand-tuned per page. Flattening
// them into preset values would destroy that identity.
//
// Instead this module extracts each variant's drawFx source VERBATIM from its own
// version page (`fetch('/versions/<id>.html')` → brace-matched source → compiled
// with the page's own free variable names bound to engine equivalents) and runs it
// as a post-FX pass on the stage canvas. Because the source comes byte-for-byte
// from the version page at runtime, the engine's output can never drift from the
// standalone variant — this is a genuine one-page-app consolidation, not a port.
//
// Public API on window.SWR_VARIANTS:
//
//   .list()             -> [{id, name, desc, song}] for the switcher UI
//   .activate(id)       -> apply variant: theme tokens, default song, ensure DOM
//                          overlays the body needs, compile+swap drawFx. No reload.
//   .deactivate()       -> restore engine defaults (no-op hook resumes)
//   .current()          -> active id or null
//   .postFx(ctx)        -> called from engine.html render loop every frame; no-op
//                          unless a variant is active. Reads canvas dims itself.
//
// The engine hook (engine.html, in the Layers render loop):
//   if (window.SWR_VARIANTS) window.SWR_VARIANTS.postFx(stageCtx);
// With no variant active this is a strict no-op — all existing verify suites pass
// unchanged.
//
// Theme tokens map each variant's signature palette onto the engine's --accent
// custom properties; original values are restored on deactivate().
//
// drawLayer-level deltas (grid's cell-snap, hallucination's drawNoise) are NOT
// ported: the engine has its own layer compositor and replacing it would touch
// the core render pipeline. The fullscreen drawFx pass carries the visible
// identity (scanlines, grain, ghosts); per-layer deltas stay variant-page-only.
// If that changes, deactivate() keeps working and the hook stays a no-op.

(function () {
  'use strict';
  if (window.SWR_VARIANTS) return;

  const VARIANTS = [
    { id: 'neon',         name: 'Neon',         desc: 'Scanlines · magenta beat flash · center glow pulse',  song: 'audios/neon.mp3',
      accent: { r: 0xff, g: 0x2d, b: 0x8a }, accent2: { r: 0x00, g: 0xf0, b: 0xff }, accent3: { r: 0xff, g: 0xf0, b: 0x4a } },
    { id: 'film',         name: 'Film',         desc: 'Per-pixel grain · projector flicker · warm overlay · vignette', song: 'audios/film.mp3',
      accent: { r: 0xc8, g: 0xa8, b: 0x78 }, accent2: { r: 0x8a, g: 0x6a, b: 0x3a }, accent3: { r: 0xf5, g: 0xe8, b: 0xc8 } },
    { id: 'grid',         name: 'Grid',         desc: 'Kick flash · grid-line pulse · white punch on downbeat', song: 'audios/grid.mp3',
      accent: { r: 0xff, g: 0x3d, b: 0x00 }, accent2: { r: 0xff, g: 0x3d, b: 0x00 }, accent3: { r: 0xff, g: 0xff, b: 0xff } },
    { id: 'smoke',        name: 'Smoke',        desc: 'Warm haze · amber chromatic-aberration ghost', song: 'audios/smoke.mp3',
      accent: { r: 0xd6, g: 0x8b, b: 0x5a }, accent2: { r: 0xb8, g: 0x9a, b: 0x72 }, accent3: { r: 0xf0, g: 0xd8, b: 0xb0 } },
    { id: 'hallucination',name: 'Hallucination', desc: 'Lighter flash · RGB torn-signal ghosts · noise punch', song: 'audios/hallucination.mp3',
      accent: { r: 0xff, g: 0x00, b: 0x66 }, accent2: { r: 0x00, g: 0xff, b: 0x66 }, accent3: { r: 0xff, g: 0xff, b: 0x00 } },
  ];

  // ------------------------------------------------------------------
  // Brace-matched source extraction. Tokenizes so nested braces inside
  // template literals / strings / comments never break the match.
  // ------------------------------------------------------------------
  function extractFunctionSource(html, fnName) {
    const marker = `function ${fnName}(`;
    const start = html.indexOf(marker);
    if (start < 0) throw new Error(`function ${fnName} not found in variant page`);
    const open = html.indexOf('{', start);
    if (open < 0) throw new Error(`no body brace for ${fnName}`);
    let depth = 0;
    let i = open;
    let mode = 'code'; // code | line | block | str | tpl | tplExpr
    let quote = '';
    let tplDepth = 0;  // brace depth INSIDE a ${...} expression
    while (i < html.length) {
      const c = html[i];
      const n = html[i + 1];
      if (mode === 'code') {
        if (c === '/' && n === '/') { mode = 'line'; i += 2; continue; }
        if (c === '/' && n === '*') { mode = 'block'; i += 2; continue; }
        if (c === '"' || c === "'") { mode = 'str'; quote = c; i++; continue; }
        if (c === '`') { mode = 'tpl'; i++; continue; }
        if (c === '{') depth++;
        if (c === '}') { depth--; if (depth === 0) return html.slice(start, i + 1); }
        i++; continue;
      }
      if (mode === 'line') { if (c === '\n') mode = 'code'; i++; continue; }
      if (mode === 'block') { if (c === '*' && n === '/') { mode = 'code'; i += 2; continue; } i++; continue; }
      if (mode === 'str') {
        if (c === '\\') { i += 2; continue; }
        if (c === quote) mode = 'code';
        i++; continue;
      }
      if (mode === 'tpl') {
        if (c === '\\') { i += 2; continue; }
        if (c === '`') { mode = 'code'; i++; continue; }
        if (c === '$' && n === '{') { mode = 'tplExpr'; tplDepth = 0; i += 2; continue; }
        i++; continue;
      }
      if (mode === 'tplExpr') {
        // Track NESTED braces inside the ${...} only. The matching '}' of
        // this ${ closes it WITHOUT touching depth — otherwise a template
        // like `rgba(0,0,0,${0.5})` would end the extraction early.
        if (c === '\'' || c === '"') { mode = 'str'; quote = c; i++; continue; }
        if (c === '`') { mode = 'tpl'; i++; continue; }
        if (c === '{') { tplDepth++; i++; continue; }
        if (c === '}') {
          if (tplDepth > 0) { tplDepth--; i++; continue; }
          mode = 'tpl'; i++; continue;
        }
        i++; continue;
      }
    }
    throw new Error(`unterminated body for ${fnName}`);
  }

  // Bind the variant's page-scope free names to engine equivalents.
  // Names the bodies use: ctx, W, H, A (audio), stage (canvas el), $
  // (getElementById), clamp, lerp, SWR_AUDIO_DAMP (guarded → undefined ok),
  // performance (global), _beatCount (grid only), document (global).
  function compileFx(source) {
    let beatCount = 0;
    const fn = new Function(
      'ctx', 'W', 'H', 'A', 'stage', '$', 'clamp', 'lerp', 'SWR_AUDIO_DAMP', 'performance', '_beatCount',
      source + '\nreturn typeof drawFx === "function" ? drawFx() : undefined;'
    );
    return {
      run(ctx, W, H, A, stageCanvas, $, clamp, lerp) {
        if (!ctx || !W || !H) return;
        fn(ctx, W, H, A, stageCanvas, $, clamp, lerp, undefined, window.performance, beatCount);
        if (A && A.feat && A.feat.beatPulse) beatCount++;
      },
    };
  }

  // DOM overlays the verbatim bodies touch that don't exist in engine.html.
  // Created lazily on activate, with the exact CSS from the source page
  // (grid: #grid + #flash · film: #vignette). Scoped to the stage element
  // (position:relative on #stage makes it the containing block so the
  // absolute overlays align to the canvas and not the viewport).
  function ensureOverlays(id) {
    const stage = document.getElementById('stage');
    if (!stage) return;
    if (getComputedStyle(stage).position === 'static') stage.style.position = 'relative';
    const have = (sel) => stage.querySelector(sel);
    if (id === 'grid') {
      if (!have('#grid')) {
        const el = document.createElement('div');
        el.id = 'grid';
        el.style.cssText = 'position:absolute;inset:0;pointer-events:none;' +
          'background-image:linear-gradient(to right,rgba(0,0,0,0.14) 1px,transparent 1px),linear-gradient(to bottom,rgba(0,0,0,0.14) 1px,transparent 1px),linear-gradient(to right,rgba(0,0,0,0.05) 1px,transparent 1px),linear-gradient(to bottom,rgba(0,0,0,0.05) 1px,transparent 1px);' +
          'background-size:12.5% 12.5%,12.5% 12.5%,6.25% 6.25%,6.25% 6.25%;opacity:0.35;';
        stage.appendChild(el);
      }
      if (!have('#flash')) {
        const el = document.createElement('div');
        el.id = 'flash';
        el.style.cssText = 'position:absolute;inset:0;pointer-events:none;background:#ff3d00;opacity:0;mix-blend-mode:multiply;will-change:opacity;';
        stage.appendChild(el);
      }
    }
    if (id === 'film' && !have('#vignette')) {
      const el = document.createElement('div');
      el.id = 'vignette';
      el.style.cssText = 'position:absolute;inset:0;pointer-events:none;background:radial-gradient(ellipse at center,transparent 40%,rgba(0,0,0,0.7) 100%);';
      el.style.zIndex = '9';
      stage.appendChild(el);
    }
  }

  const state = {
    active: null,
    fx: null,            // compiled drawFx runner
    cache: new Map(),    // id -> Promise<compiled>
    savedAccents: null,
  };

  async function loadVariant(id) {
    const cached = state.cache.get(id);
    if (cached) return cached;
    const p = fetch(`/versions/${id}.html`)
      .then((r) => {
        if (!r.ok) throw new Error(`versions/${id}.html HTTP ${r.status}`);
        return r.text();
      })
      .then((html) => {
        const src = extractFunctionSource(html, 'drawFx');
        return compileFx(src);
      })
      .catch((e) => {
        state.cache.delete(id);
        throw e;
      });
    state.cache.set(id, p);
    return p;
  }

  function cssColor(c) { return `rgb(${c.r},${c.g},${c.b})`; }

  function restoreAccents() {
    if (!state.savedAccents) return;
    const root = document.documentElement;
    for (const [k, v] of Object.entries(state.savedAccents)) {
      if (v === null) root.style.removeProperty(k);
      else root.style.setProperty(k, v);
    }
    state.savedAccents = null;
  }

  async function activate(id) {
    const v = VARIANTS.find((x) => x.id === id);
    if (!v) return deactivate();
    ensureOverlays(id);
    const fx = await loadVariant(id);
    // Theme tokens (restore-safe)
    if (!state.savedAccents) {
      const root = document.documentElement;
      const cs = getComputedStyle(root);
      state.savedAccents = {
        '--accent': cs.getPropertyValue('--accent').trim() || null,
        '--accent-2': cs.getPropertyValue('--accent-2').trim() || null,
        '--accent-3': cs.getPropertyValue('--accent-3').trim() || null,
      };
    }
    const root = document.documentElement;
    root.style.setProperty('--accent', cssColor(v.accent));
    root.style.setProperty('--accent-2', cssColor(v.accent2));
    root.style.setProperty('--accent-3', cssColor(v.accent3));
    state.active = id;
    state.fx = fx;
    if (typeof window.SWR_VARIANTS_UI === 'function') window.SWR_VARIANTS_UI(id);
    return v;
  }

  function deactivate() {
    restoreAccents();
    state.active = null;
    state.fx = null;
    if (typeof window.SWR_VARIANTS_UI === 'function') window.SWR_VARIANTS_UI(null);
  }

  // Engine render-loop hook. Strict no-op when no variant is active.
  function postFx(ctx) {
    if (!state.fx) return;
    // Rebind every frame so late engine init (stageCanvas/Audio) is always seen.
    const stage = document.getElementById('render');
    if (!stage) return;
    const W = stage.width || stage.clientWidth || 1280;
    const H = stage.height || stage.clientHeight || 720;
    const A = window.Audio;
    const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
    const lerp = (a, b, t) => a + (b - a) * t;
    const $ = (id) => document.getElementById(id);
    try {
      state.fx.run(ctx, W, H, A, stage, $, clamp, lerp);
    } catch (e) {
      // One bad frame must not kill the engine render loop.
      if (!postFx._warned) { console.warn('variant fx', e.message); postFx._warned = true; }
      state.fx = null;
    }
  }

  window.SWR_VARIANTS = {
    list: () => VARIANTS.map((v) => ({ id: v.id, name: v.name, desc: v.desc, song: v.song })),
    activate,
    deactivate,
    current: () => state.active,
    postFx,
    _debug: { extractFunctionSource, state },
  };

  // ----------------------------------------------------------------
  // Self-wiring: populate the #variant select in engine.html and
  // reflect activate()/deactivate() calls back into it. Loaded with
  // defer so the DOM (including the select) exists by the time this
  // runs. No-op if the select isn't present (e.g. preview pages).
  // ----------------------------------------------------------------
  function wireUI() {
    const sel = document.getElementById('variant');
    if (!sel) return;
    for (const v of VARIANTS) {
      const opt = document.createElement('option');
      opt.value = v.id;
      opt.textContent = v.name;
      sel.appendChild(opt);
    }
    sel.addEventListener('change', () => {
      const v = sel.value;
      if (!v || v === 'off') window.SWR_VARIANTS.deactivate();
      else window.SWR_VARIANTS.activate(v).catch((e) => { console.warn('variant activate', e.message); });
    });
    // External/sync path: activate('film') from code updates the select.
    window.SWR_VARIANTS_UI = (id) => {
      const cur = document.getElementById('variant');
      if (cur) cur.value = id || 'off';
    };
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', wireUI, { once: true });
  } else {
    wireUI();
  }
})();