// engine-render.client.js — shared DPR-aware canvas sizing + per-layer cache
// for the 13 engine pages (versions/*.html).
//
// Pages call SWR_RENDER.fit() from their fit() to size the canvas at the
// device pixel ratio, and SWR_RENDER.frame() from their RAF loop to draw
// each layer (cached when possible) plus their page-specific fx + meter.
//
// Cache policy: each layer's full draw (filter + transform + composite) is
// rasterized into an offscreen canvas on first use and blitted as a single
// drawImage on subsequent frames. The cache key is a version hash derived
// from the layer's applyR() result and asset id; when either changes, the
// next frame redraws. The "active" set (top N by audio energy) is never
// cached, so per-frame motion never serves a stale blit.

(function () {
  'use strict';
  if (window.SWR_RENDER) return;

  const LS_DPR_CAP = 'swr.render.dprCap';

  // ---- state ------------------------------------------------------------

  const state = {
    dpr: 1, cssW: 0, cssH: 0,
    dirty: true,
    bgColor: '#000',         // pages set this via setBackground() if they want
    cache: new Map(),         // layerId -> { canvas, version, lastDpr, lastSize }
    activeSet: new Set(),     // layerIds that should always redraw
    activeBudget: 2,          // how many layers stay uncached (top by audio energy)
  };

  function devicePixelRatio() {
    let cap = 2;
    try { const v = parseFloat(localStorage.getItem(LS_DPR_CAP)); if (v > 0 && isFinite(v)) cap = v; } catch (_) {}
    return Math.min(window.devicePixelRatio || 1, cap);
  }

  function setDprCap(n) {
    try { localStorage.setItem(LS_DPR_CAP, String(n)); } catch (_) {}
    state.dirty = true;
  }

  function setBackground(color) { state.bgColor = color || '#000'; }

  // ---- sizing -----------------------------------------------------------

  // Reads the canvas's CSS box, sizes the backing store at devicePixelRatio.
  // Returns the CSS dimensions that existing drawing math uses, so pages
  // keep using W,H in CSS pixels unchanged.
  function fit(stage) {
    const vw = stage.clientWidth, vh = stage.clientHeight;
    const dpr = devicePixelRatio();
    const targetCssW = Math.max(640, Math.round(vw));
    const targetCssH = Math.max(360, Math.round(vh));
    const targetW = targetCssW * dpr;
    const targetH = targetCssH * dpr;
    if (stage.width !== targetW || stage.height !== targetH) {
      stage.width = targetW;
      stage.height = targetH;
      // Backing store changed — caches will be wrong size; mark dirty.
      state.dirty = true;
    }
    const dprChanged = state.dpr !== dpr;
    state.dpr = dpr;
    state.cssW = targetCssW;
    state.cssH = targetCssH;
    if (dprChanged) state.dirty = true;  // invalidate caches for new dpr
    return { cssW: state.cssW, cssH: state.cssH, dpr: state.dpr };
  }

  function invalidate(layerId) {
    if (layerId == null) state.cache.clear();
    else state.cache.delete(layerId);
  }

  // ---- offscreen canvas ------------------------------------------------

  function makeOffscreen(w, h) {
    if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(w, h);
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    return c;
  }

  // ---- cache ------------------------------------------------------------

  // Stable, fast version hash. We don't need cryptographic strength; we need
  // (a) fast on every frame, (b) changes when any input changes.
  function hashVersion(s) {
    let h = 2166136261 >>> 0;
    for (let i = 0; i < s.length; i++) {
      h = Math.imul(h ^ s.charCodeAt(i), 16777619);
    }
    return (h >>> 0).toString(36);
  }

  function buildVersion(r, assetId, audioHash) {
    // r is applyR(l)'s output. Include every field that can affect the draw,
    // plus a coarse hash of the audio features so layers that read A.feat
    // directly (smoke, etc.) invalidate correctly when audio changes.
    return assetId + '|' + r._v + '|' + r.scale + '|' + r.x + '|' + r.y + '|' + r.rot +
           '|' + r.opacity + '|' + r.hue + '|' + r.brightness + '|' + r.contrast +
           '|a=' + audioHash;
  }

  // Coarse fingerprint of the audio features. 1 decimal of precision is
  // enough to invalidate on audible change but stable across the quantisation
  // noise of the analyser on idle frames.
  let _lastAudioHash = '';
  function audioFingerprint() {
    const f = (window.SWR && window.SWR.Audio && window.SWR.Audio.feat) || {};
    const round = (v) => Math.round((v || 0) * 10);
    return round(f.bass) + '|' + round(f.mid) + '|' + round(f.treble) + '|' +
           round(f.rms) + '|' + round(f.centroid) + '|' + round(f.beat) + '|' +
           round(f.onset);
  }

  function getCached(layerId, version) {
    const e = state.cache.get(layerId);
    if (!e) return null;
    if (e.version !== version) return null;
    if (e.lastDpr !== state.dpr) return null;
    if (e.lastSize !== state.cssW + 'x' + state.cssH) return null;
    return e.canvas;
  }

  function setCached(layerId, version, sourceCanvas) {
    state.cache.set(layerId, {
      canvas: sourceCanvas, version,
      lastDpr: state.dpr, lastSize: state.cssW + 'x' + state.cssH,
    });
  }

  // ---- frame scheduler -------------------------------------------------

  // The page calls this from its RAF loop. The page supplies:
  //   layers       — array of layer objects
  //   applyR       — (layer) => reactive result, must include _v
  //   drawToCtx    — (layer, r, ctx, cssW, cssH) draws the layer to the given ctx
  //                  using CSS-pixel coordinates (we already scaled)
  //   bgColor      — optional override; falls back to state.bgColor
  //   extraDraws   — array of () => {} called after layers but before meter
  function frame(stage, ctx, layers, applyR, drawToCtx, opts) {
    opts = opts || {};
    const bg = opts.bgColor || state.bgColor;
    if (state.dirty) fit(stage);

    // Clear in device pixels (ctx may have a transform from last frame).
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, stage.width, stage.height);
    ctx.setTransform(state.dpr, 0, 0, state.dpr, 0, 0);

    const backingW = stage.width, backingH = stage.height;
    const audioHash = audioFingerprint();

    for (let i = 0; i < layers.length; i++) {
      const l = layers[i];
      const r = applyR(l);
      const assetId = l.asset ? l.asset.id : 'none';
      const version = hashVersion(buildVersion(r, assetId, audioHash));
      const force = state.activeSet.has(l.id) || state.dirty;

      const cached = !force && getCached(l.id, version);
      if (cached) {
        // Blit cached layer. Cached canvas is at backing-store size; draw it
        // sized to CSS px so the transform we set above scales it.
        ctx.drawImage(cached, 0, 0, state.cssW, state.cssH);
      } else {
        // Render into offscreen at backing-store size, then blit.
        const oc = makeOffscreen(backingW, backingH);
        const octx = oc.getContext('2d');
        octx.setTransform(state.dpr, 0, 0, state.dpr, 0, 0);
        drawToCtx(l, r, octx, state.cssW, state.cssH);
        setCached(l.id, version, oc);
        ctx.drawImage(oc, 0, 0, state.cssW, state.cssH);
      }
    }

    if (opts.extraDraws) for (let i = 0; i < opts.extraDraws.length; i++) opts.extraDraws[i]();

    state.dirty = false;
  }

  // ---- public ----------------------------------------------------------

  window.SWR_RENDER = {
    fit, frame, invalidate, setBackground, setDprCap, devicePixelRatio,
    get dpr() { return state.dpr; },
    get cssW() { return state.cssW; },
    get cssH() { return state.cssH; },
    get dirty() { return state.dirty; },
    get cacheSize() { return state.cache.size; },
    markDirty() { state.dirty = true; },
    setActiveSet(ids) { state.activeSet = new Set(ids || []); },
    setActiveBudget(n) { state.activeBudget = Math.max(0, Math.min(8, n | 0)); },
  };
})();
