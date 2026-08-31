// preset-preview.client.js — synthesize first-frame previews for each swr-preset.
//
// On engine load (or whenever `swr-presets-loaded` fires), iterate over the
// presets in the manifest and render a small PNG of what the first frame of
// each preset would look like, by running the actual fragment shader from
// fx-postprocess.js with the preset's fx_state. The previews are cached in
// `window.SWR_PRESET_PREVIEW.get(id)` and emitted on the
// `swr-preset-preview-ready` event so the presets panel (and any other
// surface) can swap the static SVG thumbnail for a real rendered first frame.
//
// Why this mirrors persona-preview.client.js:
//   The preset's `fx_state` has the same shape as the persona object
//   (temp/mut/mutAlgo/posterize/vignette/chroma/grain/sepia/glow/grayscale/
//    blur/liquid/pearl/glitch), so the same shader pipeline produces a
//    faithful preview. Bloom is part of the compositor and not in the shader
//    uniforms, but that's a known gap in the engine's apply path too.
//
// Palette handling:
//   Presets ship a 4-color palette (primary/secondary/accent/bg). The shader
//   pipeline operates on the input texture, so we tint the test pattern with
//   the preset's `bg` + `primary` so the rendered first frame visually echoes
//   the palette even before the user applies the preset to live layers.

(function () {
  'use strict';
  if (window.SWR_PRESET_PREVIEW) return;

  const REF_W = 160;
  const REF_H = 90;

  // Cache: preset id -> { dataURL, ready: true } (or just dataURL)
  const cache = new Map();
  const inflight = new Map();  // id -> Promise
  let rendering = false;       // serialize WebGL contexts to avoid GPU pile-up

  function $(id) { return document.getElementById(id); }

  // ---- test pattern (with optional palette tint) --------------------------

  function tintHex(hex, amount) {
    // Mix the hex color toward white by `amount` (0..1)
    if (!hex || typeof hex !== 'string') return null;
    const m = hex.replace('#', '').match(/^([0-9a-f]{6})$/i);
    if (!m) return null;
    const n = parseInt(m[1], 16);
    const r = (n >> 16) & 0xff, g = (n >> 8) & 0xff, b = n & 0xff;
    const mix = (c) => Math.round(c + (255 - c) * amount);
    return 'rgb(' + mix(r) + ',' + mix(g) + ',' + mix(b) + ')';
  }

  function makeTestPattern(palette) {
    const c = document.createElement('canvas');
    c.width = REF_W;
    c.height = REF_H;
    const ctx = c.getContext('2d');

    // Background: gradient seeded by the preset's bg + primary
    const bg = (palette && palette.bg) || '#1a1a22';
    const primary = (palette && palette.primary) || '#d4a24c';
    const grad = ctx.createLinearGradient(0, 0, REF_W, REF_H);
    grad.addColorStop(0,    bg);
    grad.addColorStop(0.55, tintHex(primary, 0.35) || primary);
    grad.addColorStop(1,    primary);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, REF_W, REF_H);

    // Circle (bright accent)
    ctx.beginPath();
    ctx.arc(REF_W * 0.35, REF_H * 0.4, REF_H * 0.28, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255, 230, 130, 0.85)';
    ctx.fill();

    // Bars (geometric)
    ctx.fillStyle = 'rgba(20, 20, 30, 0.55)';
    ctx.fillRect(REF_W * 0.55, REF_H * 0.15, REF_W * 0.08, REF_H * 0.7);
    ctx.fillRect(REF_W * 0.70, REF_H * 0.3,  REF_W * 0.12, REF_H * 0.5);

    // Diagonal slash
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.4)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, REF_H);
    ctx.lineTo(REF_W, 0);
    ctx.stroke();

    return c;
  }

  function makeTestPatternDataURL(palette) {
    return makeTestPattern(palette).toDataURL('image/png');
  }

  function loadImage(src) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('image load failed: ' + src));
      img.src = src;
    });
  }

  // ---- shader pipeline (same shape as persona-preview) -------------------

  // Snapshot + restore window.FX.state so the user's actual settings survive
  function snapshotFX() {
    if (!window.FX || !window.FX.state) return null;
    const s = window.FX.state;
    return {
      temp: s.temp, mut: s.mut, mutAlgo: s.mutAlgo,
      posterize: s.posterize, vignette: s.vignette, chroma: s.chroma,
      grain: s.grain, sepia: s.sepia, glow: s.glow,
      grayscale: s.grayscale || 0, blur: s.blur || 0,
      liquid: s.liquid || 0, pearl: s.pearl || 0, glitch: s.glitch || 0,
    };
  }
  function restoreFX(snap) {
    if (snap && window.FX) {
      try { window.FX.setPersona(snap); } catch (_) { /* ignore */ }
    }
  }

  // Map the preset's fx_state into the persona-shaped object the shader
  // uniforms expect. `bloom` is part of the compositor (not the shader) so
  // we drop it here — same gap as the live apply path.
  function fxStateToPersona(fx) {
    fx = fx || {};
    return {
      temp:      fx.temp      != null ? fx.temp      : 0,
      mut:       fx.mut       != null ? fx.mut       : 0,
      mutAlgo:   fx.mutAlgo   != null ? fx.mutAlgo   : 0,
      posterize: fx.posterize != null ? fx.posterize : 0,
      vignette:  fx.vignette  != null ? fx.vignette  : 0,
      chroma:    fx.chroma    != null ? fx.chroma    : 0,
      grain:     fx.grain     != null ? fx.grain     : 0,
      sepia:     fx.sepia     != null ? fx.sepia     : 0,
      glow:      fx.glow      != null ? fx.glow      : 0,
      grayscale: fx.grayscale != null ? fx.grayscale : 0,
      blur:      fx.blur      != null ? fx.blur      : 0,
      liquid:    fx.liquid    != null ? fx.liquid    : 0,
      pearl:     fx.pearl     != null ? fx.pearl     : 0,
      glitch:    fx.glitch    != null ? fx.glitch    : 0,
    };
  }

  // Run the persona shader pipeline. We compile a throwaway WebGL context
  // with the same FRAG source as fx-postprocess.js so the preview is honest.
  function runShader(gl, refImg, persona) {
    const VERT = `
      attribute vec2 a_pos;
      varying vec2 v_uv;
      void main() {
        v_uv = a_pos * 0.5 + 0.5;
        gl_Position = vec4(a_pos, 0.0, 1.0);
      }
    `;
    // Use the exact shader source from fx-postprocess.js. The minimal stub
    // below is a fallback for the very first paint before fx-postprocess has
    // set window.FX_FRAG_SOURCE (shouldn't happen on engine.html in practice).
    const FRAG = window.FX_FRAG_SOURCE || `
      precision highp float;
      varying vec2 v_uv;
      uniform sampler2D u_tex;
      uniform float u_temp, u_mut, u_posterize, u_vignette, u_chroma, u_grain, u_sepia, u_glow;
      uniform float u_bass, u_mid, u_treble, u_beat;
      void main() {
        vec3 col = texture2D(u_tex, v_uv).rgb;
        gl_FragColor = vec4(col, 1.0);
      }
    `;

    function compile(type, src) {
      const sh = gl.createShader(type);
      gl.shaderSource(sh, src);
      gl.compileShader(sh);
      if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
        gl.deleteShader(sh);
        return null;
      }
      return sh;
    }
    const vs = compile(gl.VERTEX_SHADER, VERT);
    const fs = compile(gl.FRAGMENT_SHADER, FRAG);
    if (!vs || !fs) return null;
    const prog = gl.createProgram();
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return null;
    gl.useProgram(prog);

    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 1,-1, -1,1, -1,1, 1,-1, 1,1]), gl.STATIC_DRAW);
    const aPos = gl.getAttribLocation(prog, 'a_pos');
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);

    const u = {
      tex:       gl.getUniformLocation(prog, 'u_tex'),
      temp:      gl.getUniformLocation(prog, 'u_temp'),
      mut:       gl.getUniformLocation(prog, 'u_mut'),
      posterize: gl.getUniformLocation(prog, 'u_posterize'),
      vignette:  gl.getUniformLocation(prog, 'u_vignette'),
      chroma:    gl.getUniformLocation(prog, 'u_chroma'),
      grain:     gl.getUniformLocation(prog, 'u_grain'),
      sepia:     gl.getUniformLocation(prog, 'u_sepia'),
      glow:      gl.getUniformLocation(prog, 'u_glow'),
      bass:      gl.getUniformLocation(prog, 'u_bass'),
      mid:       gl.getUniformLocation(prog, 'u_mid'),
      treble:    gl.getUniformLocation(prog, 'u_treble'),
      beat:      gl.getUniformLocation(prog, 'u_beat'),
    };

    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, refImg);
    gl.uniform1i(u.tex, 0);

    gl.viewport(0, 0, REF_W, REF_H);
    gl.uniform1f(u.temp,      persona.temp      || 0);
    gl.uniform1f(u.mut,       persona.mut       || 0);
    gl.uniform1f(u.posterize, persona.posterize || 0);
    gl.uniform1f(u.vignette,  persona.vignette  || 0);
    gl.uniform1f(u.chroma,    persona.chroma    || 0);
    gl.uniform1f(u.grain,     persona.grain     || 0);
    gl.uniform1f(u.sepia,     persona.sepia     || 0);
    gl.uniform1f(u.glow,      persona.glow      || 0);
    // Fixed audio features for preview — represent a "lively" track
    gl.uniform1f(u.bass,      0.6);
    gl.uniform1f(u.mid,       0.5);
    gl.uniform1f(u.treble,    0.4);
    gl.uniform1f(u.beat,      0.3);

    gl.drawArrays(gl.TRIANGLES, 0, 6);

    let dataURL = null;
    try { dataURL = gl.canvas.toDataURL('image/png'); } catch (_) { dataURL = null; }
    return dataURL;
  }

  // Fallback when WebGL is unavailable — a 2D approximation so the panel
  // still gets a non-SVG preview. Tints the test pattern with the palette.
  function fallbackPreview(fx, palette) {
    const c = makeTestPattern(palette);
    const ctx = c.getContext('2d');
    // Approximate sepia by darkening + warming
    if (fx && fx.sepia > 0.4) {
      ctx.fillStyle = 'rgba(120, 80, 30, ' + (fx.sepia * 0.4) + ')';
      ctx.fillRect(0, 0, REF_W, REF_H);
    }
    // Approximate vignette
    if (fx && fx.vignette > 0.4) {
      const v = fx.vignette;
      const g = ctx.createRadialGradient(REF_W/2, REF_H/2, REF_W*0.2, REF_W/2, REF_H/2, REF_W*0.7);
      g.addColorStop(0, 'rgba(0,0,0,0)');
      g.addColorStop(1, 'rgba(0,0,0,' + (v * 0.6) + ')');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, REF_W, REF_H);
    }
    return c.toDataURL('image/png');
  }

  // ---- per-preset render -------------------------------------------------

  async function renderOne(preset) {
    if (!preset || !preset.id) return null;
    if (cache.has(preset.id)) return cache.get(preset.id);

    const fx = fxStateToPersona(preset.fx_state);
    const palette = preset.palette || null;

    // Wait until fx-postprocess has exposed the FRAG source so the preview
    // is a faithful render. Without FX_FRAG_SOURCE we'd fall back to a stub
    // that ignores the FX state, which defeats the purpose.
    const waitForFrag = (function wait(deadline) {
      if (window.FX_FRAG_SOURCE) return Promise.resolve();
      if (deadline <= 0) return Promise.reject(new Error('FX_FRAG_SOURCE never exposed'));
      return new Promise(r => setTimeout(() => wait(deadline - 100).then(r), 100));
    })(15000);

    let refImg;
    try {
      refImg = await loadImage(makeTestPatternDataURL(palette));
    } catch (_) {
      return null;
    }

    const savedFX = snapshotFX();
    try {
      // Apply the preset so the live FX state matches the preview (also
      // restores on the way out via restoreFX in `finally`).
      if (window.FX) {
        try { window.FX.setPersona(fx); } catch (_) { /* ignore */ }
      }

      await waitForFrag;

      const canvas = document.createElement('canvas');
      canvas.width = REF_W;
      canvas.height = REF_H;
      canvas.style.cssText = 'position:fixed;top:-9999px;left:-9999px;';
      document.body.appendChild(canvas);

      const gl = canvas.getContext('webgl', { premultipliedAlpha: false }) ||
                 canvas.getContext('experimental-webgl');
      if (!gl) {
        document.body.removeChild(canvas);
        return fallbackPreview(preset.fx_state || {}, palette);
      }

      let dataURL = null;
      try {
        dataURL = runShader(gl, refImg, fx);
      } finally {
        const ext = gl.getExtension && gl.getExtension('WEBGL_lose_context');
        if (ext) ext.loseContext();
        document.body.removeChild(canvas);
      }
      return dataURL || fallbackPreview(preset.fx_state || {}, palette);
    } finally {
      restoreFX(savedFX);
    }
  }

  // Serialized render — one WebGL context at a time so we don't blow the
  // browser's GPU context budget (Chrome warns at ~16). Each render is
  // ~10–30ms so even 50 presets finish in <2s.
  async function renderAll(presets) {
    if (rendering) return;
    rendering = true;
    try {
      for (const p of presets) {
        if (!p || !p.id || cache.has(p.id)) continue;
        if (inflight.has(p.id)) { await inflight.get(p.id); continue; }
        const job = (async () => {
          try {
            const dataURL = await renderOne(p);
            if (dataURL) {
              cache.set(p.id, dataURL);
              window.dispatchEvent(new CustomEvent('swr-preset-preview-ready', {
                detail: { id: p.id, dataURL }
              }));
            }
          } catch (e) {
            // soft-fail; the panel will fall back to the static SVG
            console.warn('[preset-preview] failed for', p.id, e && e.message);
          } finally {
            inflight.delete(p.id);
          }
        })();
        inflight.set(p.id, job);
        await job;
      }
    } finally {
      rendering = false;
    }
  }

  // ---- public API --------------------------------------------------------

  function get(id) {
    return cache.get(id) || null;
  }

  // Render (or re-render) a single preset on demand. Used by the panel when
  // a card is hovered or applied, and by tests that need an immediate render.
  async function render(preset) {
    if (!preset || !preset.id) return null;
    if (cache.has(preset.id)) return cache.get(preset.id);
    if (inflight.has(preset.id)) return inflight.get(preset.id);
    const job = (async () => {
      try {
        const dataURL = await renderOne(preset);
        if (dataURL) {
          cache.set(preset.id, dataURL);
          window.dispatchEvent(new CustomEvent('swr-preset-preview-ready', {
            detail: { id: preset.id, dataURL }
          }));
        }
        return dataURL;
      } catch (e) {
        console.warn('[preset-preview] failed for', preset.id, e && e.message);
        return null;
      } finally {
        inflight.delete(preset.id);
      }
    })();
    inflight.set(preset.id, job);
    return job;
  }

  window.SWR_PRESET_PREVIEW = {
    get,
    render,
    renderAll,
    has: (id) => cache.has(id),
    _cache: cache,
  };

  // ---- boot --------------------------------------------------------------

  function start(presets) {
    if (!Array.isArray(presets) || presets.length === 0) return;
    // Defer one frame so the engine's first paint has settled before we
    // start poking the FX state and creating throwaway WebGL contexts.
    setTimeout(() => { renderAll(presets).catch(() => {}); }, 400);
  }

  function boot() {
    if (!window.SWR_PRESETS) {
      setTimeout(boot, 200);
      return;
    }
    // Render previews on every presets-loaded event. This covers the
    // normal boot path AND the on-device evolve case where a new variant
    // is added mid-session.
    window.addEventListener('swr-presets-loaded', (e) => {
      const all = (e && e.detail && e.detail.all) || [];
      start(all);
    });
    // Also kick once on the current manifest (covers pages that already
    // loaded presets before this script ran).
    try {
      const all = (window.SWR_PRESETS.getAll && window.SWR_PRESETS.getAll()) || [];
      if (all.length) start(all);
    } catch (_) { /* ignore */ }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
  } else {
    boot();
  }
})();
