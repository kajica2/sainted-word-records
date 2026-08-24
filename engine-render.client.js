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
//
// Fade stepper hook: SWR_RENDER.frame() calls SWR_TIMING.step(dt, l, r)
// once per layer per frame before the offscreen draw, replacing r.opacity
// with the eased currentOpacity. The cache key includes the stepped value
// so a fade-in/out does NOT cache a frozen frame. engine-timing.client.js
// is opt-in — if absent, r is passed through unchanged.

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
    const T = window.SWR_TIMING;
    // dt for the fade stepper: clamped to 0.5s so a backgrounded tab or a
    // very slow headless render doesn't fully skip the fade step but still
    // can't teleport opacity in a single frame. Empirically, Puppeteer
    // headless RAF can run at ~10-15fps when the page is off-screen; with
    // fadeOutMs=600 a 0.1s cap would silently drop half the elapsed time.
    const now = performance.now();
    let dt = (now - (state._lastFrameAt || now)) / 1000;
    if (!isFinite(dt) || dt < 0) dt = 1/60;
    if (dt > 0.5) dt = 0.5;
    state._lastFrameAt = now;
    // One-time attach for any layers that haven't been initialised. Cheap;
    // attach() is idempotent and only writes when fields are missing.
    if (T && typeof T.attach === 'function') {
      T.attach(layers);
    }

    // Wrap each layer's full pipeline (applyR → fade step → LFO apply → draw)
    // in try/catch so one broken layer (bad applyR, missing audio feature,
    // decoded-image error) can't freeze the render loop. Without this guard,
    // the first failure aborts the for-loop AND the per-layer draw try/catch
    // never wraps the applyR/step/LFO work — silent freeze.
    for (let i = 0; i < layers.length; i++) {
      try {
        const l = layers[i];
        let r = applyR(l);
        // Fade stepper: if a crossfade is in flight and currentOpacity has
        // crossed below the midpoint threshold, swap the asset under the
        // curtain. The fade continues drawing the new asset at rising
        // currentOpacity. See engine-timing.client.js crossfade().
        if (T && l && l._swapPending && l._currentOpacity < (l.opacity || 1) * 0.5) {
          const pending = l._swapPending;
          l.asset = pending.newAsset;
          l._currentOpacity = l._targetOpacity != null ? l._targetOpacity : 0;
          // Inherit the outgoing layer's visual signature (A2 morph).
          if (l._morphFrom) {
            l.baseScale   = l._morphFrom.baseScale;
            l.hue         = l._morphFrom.hue;
            l.brightness  = l._morphFrom.brightness;
            l.contrast    = l._morphFrom.contrast;
            l._morphFrom  = null;
          }
          l._targetOpacity = l.opacity != null ? l.opacity : 1;
          if (pending.fadeInMs) l.fadeInMs = pending.fadeInMs;
          l._swapPending = null;
          // Force a redraw by clearing this layer's cache.
          invalidate(l.id);
        }
        // Step fades. step() returns a new r with opacity replaced by the
        // eased currentOpacity (clamped to [0,1]).
        if (T && typeof T.step === 'function') {
          r = T.step(dt, l, r);
        }
        // Apply LFO modulators: each registered modulator on the layer
        // returns a per-frame scalar in [-1, +1] that the engine's own
        // applyR() already knows how to merge (opacity additive, scale
        // multiplicative, x/y additive, hue additive, rot additive).
        // The LFO registry reads .sample() and writes back into r via a
        // small per-target merger that mirrors the page's reactor maths.
        if (window.SWR_LFOS && typeof window.SWR_LFOS.apply === 'function') {
          r = window.SWR_LFOS.apply(dt, l, r);
        }
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
          try {
            drawToCtx(l, r, octx, state.cssW, state.cssH);
          } catch (err) {
            // A single broken layer (missing image, CORS, decoder error) must
            // not abort the whole frame — the rest of the composition still
            // draws. Cache the empty offscreen so we don't retry every frame;
            // the next version bump (asset swap, reactor change) clears it.
            if (!state._warnedAssets) {
              state._warnedAssets = true;
              try { console.warn('[SWR_RENDER] layer draw failed:', err && err.message); } catch (_) {}
            }
          }
          setCached(l.id, version, oc);
          ctx.drawImage(oc, 0, 0, state.cssW, state.cssH);
        }
      } catch (err) {
        // Defensive: applyR, T.step, or SWR_LFOS.apply threw. Skip this
        // layer for this frame, but keep the render loop alive. Warn once
        // per error category so we don't spam the console.
        const k = (err && err.message) || 'unknown';
        if (!state._warnedLayer || state._warnedLayer !== k) {
          state._warnedLayer = k;
          try { console.warn('[SWR_RENDER] layer pipeline failed:', k, 'at layer', i); } catch (_) {}
        }
      }
    }

    // Per-engine extras (drawFx, drawMeter, etc.) — wrap each call so a
    // broken extra draw can't kill the RAF loop either.
    if (opts.extraDraws) {
      for (let i = 0; i < opts.extraDraws.length; i++) {
        try { opts.extraDraws[i](); }
        catch (err) {
          if (!state._warnedExtras) {
            state._warnedExtras = true;
            try { console.warn('[SWR_RENDER] extraDraws failed:', err && err.message); } catch (_) {}
          }
        }
      }
    }

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

  // Install a ResizeObserver on the engine's stage canvas as soon as the
  // page exposes it. Every observed size change dispatches a window 'resize'
  // event, which each engine's existing `window.addEventListener('resize',
  // fit)` handler picks up. This recovers engines whose top-level fit()
  // ran with clientWidth=0 because CSS hadn't laid out yet (grid, smoke,
  // watercolor in the headless test) — they cache W=0/H=0 and never
  // re-fit without this. The observer is attached from script load, before
  // the page's IIFE runs, so the very first post-stylesheet pass triggers
  // the resize.
  function attachEngineResizeObserver() {
    if (typeof ResizeObserver === 'undefined') return;
    const tryAttach = () => {
      const swr = window.SWR;
      const stage = swr && swr.stage;
      if (!stage) return false;
      // Dispatch a resize when the canvas's CSS box changes; this triggers
      // each engine's `window.addEventListener('resize', fit)` listener.
      // We also call SWR_RENDER.fit directly in case the page didn't
      // expose the fit listener to window.
      let lastW = stage.clientWidth, lastH = stage.clientHeight;
      const ro = new ResizeObserver(() => {
        if (stage.clientWidth !== lastW || stage.clientHeight !== lastH) {
          lastW = stage.clientWidth; lastH = stage.clientHeight;
          state.dirty = true;
          try { window.SWR_RENDER.fit(stage); } catch (_) {}
          window.dispatchEvent(new Event('resize'));
        }
      });
      ro.observe(stage);
      // Some engines' first fit() runs while CSS hasn't laid out yet
      // (clientWidth=0). The ResizeObserver catches the eventual change
      // to the real size, but a few frames may have rendered with W=0.
      // Force a re-fit + resize event after one frame so the engine
      // picks up the real dimensions immediately, even if the observer's
      // initial measurement is unchanged.
      requestAnimationFrame(() => {
        if (stage.clientWidth > 0) {
          state.dirty = true;
          try { window.SWR_RENDER.fit(stage); } catch (_) {}
          window.dispatchEvent(new Event('resize'));
        }
      });
      return true;
    };
    // Poll briefly until SWR.stage exists, then attach once.
    let tries = 0;
    const id = setInterval(() => {
      tries += 1;
      if (tryAttach() || tries > 60) clearInterval(id);
    }, 100);
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', attachEngineResizeObserver);
  } else {
    attachEngineResizeObserver();
  }
})();

// touched
