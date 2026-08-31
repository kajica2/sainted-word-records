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
  const LS_AUTO_DPR = 'swr.render.autoDpr';
  // Lower bound chosen by the auto-DPR step-DOWN heuristic. Persisted so
  // it survives fit() — fit() calls devicePixelRatio() on every dirty
  // frame and would otherwise overwrite state.dpr with the cap value,
  // silently undoing the autoDpr adjustment. Cleared when the user steps
  // back UP to the natural cap or disables autoDpr.
  const LS_DPR_AUTO_LOW = 'swr.render.dprAutoLow';

  // ---- state ------------------------------------------------------------

  const state = {
    dpr: 1, cssW: 0, cssH: 0,
    dirty: true,
    bgColor: '#000',         // pages set this via setBackground() if they want
    cache: new Map(),         // layerId -> { canvas, version, lastDpr, lastSize }
    activeSet: new Set(),     // layerIds that should always redraw
    activeBudget: 1,          // how many layers stay uncached (top by audio energy)
    // Cap on cached entries. Each entry holds a full backing-store canvas
    // (~16.6 MB at the DPR-2 default backing store). Without a cap, long
    // sessions that swap many layers leak canvases forever. Cap=4 covers
    // the visual sweet spot (most engines use 4-8 layers; the rest get
    // redrawn uncached each frame, which is fine because the per-layer
    // draw is fast for uncached entries). Worst-case GPU memory drops
    // from ~266 MB to ~66 MB. Tunable via SWR_RENDER.setCacheCap(n).
    cacheCap: 4,
    // Auto-DPR state. The auto mode measures rolling frame time and
    // steps DPR down (or back up) to hold ~60fps. Defaults to off; opt
    // in with SWR_RENDER.setAutoDpr(true) or localStorage.swr.render.autoDpr=1.
    autoDpr: false,
    autoDprCooldownMs: 2000,  // minimum gap between adjustments
    autoDprUpThresholdMs: 12, // step UP only if avg frame < 12ms (room to spare)
    autoDprDownThresholdMs: 18, // step DOWN if avg frame > 18ms (missing 60fps)
    _frameSamples: [],        // rolling window of frame times
    _lastDprAdjustAt: 0,
    _lastBeat: -1,            // last beat value seen by audioFingerprint() (for memo invalidation)
  };

  function isAutoDprEnabled() {
    try {
      const v = localStorage.getItem(LS_AUTO_DPR);
      if (v === '1' || v === 'true') return true;
      if (v === '0' || v === 'false') return false;
    } catch (_) {}
    return state.autoDpr;
  }

  function devicePixelRatio() {
    let cap = 2;
    try { const v = parseFloat(localStorage.getItem(LS_DPR_CAP)); if (v > 0 && isFinite(v)) cap = v; } catch (_) {}
    const natural = Math.min(window.devicePixelRatio || 1, cap);
    // Honor the auto-DPR step-down lower bound if set. Without this the
    // autoAdjustDpr() mutation gets clobbered by the next fit() call:
    // fit() invokes devicePixelRatio() which would return the natural
    // (cap-clamped) DPR, silently undoing the auto-adjustment on every
    // dirty frame. Stepping UP clears the bound so the user returns to
    // the natural cap; setAutoDpr(false) also clears it.
    let low = 0;
    try { const v = parseFloat(localStorage.getItem(LS_DPR_AUTO_LOW)); if (v > 0 && isFinite(v)) low = v; } catch (_) {}
    if (low > 0 && low < natural) return low;
    return natural;
  }

  function setDprCap(n) {
    try { localStorage.setItem(LS_DPR_CAP, String(n)); } catch (_) {}
    state.dirty = true;
  }

  function setAutoDpr(on) {
    state.autoDpr = !!on;
    try { localStorage.setItem(LS_AUTO_DPR, on ? '1' : '0'); } catch (_) {}
    if (!on) {
      // Disabling clears the step-down bound so the next fit() returns
      // to the natural cap immediately.
      try { localStorage.removeItem(LS_DPR_AUTO_LOW); } catch (_) {}
    }
    state._frameSamples = [];
    state._lastDprAdjustAt = 0;
  }

  // Record one frame's render time and step DPR up or down when the
  // rolling average crosses the thresholds. Called once per RAF from frame().
  // Conservative: 2s cooldown, asymmetric thresholds (easier to step DOWN
  // than UP — battery cost of stepping UP is real).
  function autoAdjustDpr(frameMs) {
    if (!isAutoDprEnabled()) return;
    state._frameSamples.push(frameMs);
    if (state._frameSamples.length > 60) state._frameSamples.shift();
    if (state._frameSamples.length < 30) return; // need a stable sample
    let sum = 0;
    for (let i = 0; i < state._frameSamples.length; i++) sum += state._frameSamples[i];
    const avg = sum / state._frameSamples.length;
    const now = performance.now();
    if (now - state._lastDprAdjustAt < state.autoDprCooldownMs) return;
    let cap = 2;
    try { const v = parseFloat(localStorage.getItem(LS_DPR_CAP)); if (v > 0 && isFinite(v)) cap = v; } catch (_) {}
    const target = Math.min(cap, window.devicePixelRatio || 1);
    if (avg > state.autoDprDownThresholdMs && state.dpr > 1) {
      const next = Math.max(1, +(state.dpr - 0.25).toFixed(2));
      if (next !== state.dpr) {
        state.dpr = next;
        // Persist the step-down lower bound so fit()'s next call to
        // devicePixelRatio() returns the auto-chosen value instead of
        // silently resetting to the cap. Without this, the autoDpr
        // feature is a no-op on every device where natural DPR > cap
        // (every iPhone, iPad, and most Android phones since 2018).
        try { localStorage.setItem(LS_DPR_AUTO_LOW, String(next)); } catch (_) {}
        state.dirty = true;
        state._lastDprAdjustAt = now;
        state._frameSamples = [];
      }
    } else if (avg < state.autoDprUpThresholdMs && state.dpr < target) {
      const next = Math.min(target, +(state.dpr + 0.25).toFixed(2));
      if (next !== state.dpr) {
        state.dpr = next;
        // Stepping back UP to the natural cap clears the bound so the
        // next fit() doesn't keep clamping us at the previous step-down.
        if (next >= target) {
          try { localStorage.removeItem(LS_DPR_AUTO_LOW); } catch (_) {}
        }
        state.dirty = true;
        state._lastDprAdjustAt = now;
        state._frameSamples = [];
      }
    }
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
  // Memoized for ~32 ms (3 RAF frames at 60fps) — the audio analyser updates
  // at most at its own rate (60 Hz typically) but with float32 quantisation
  // noise; the cache key doesn't need to change on every frame. Throttling
  // the fingerprint cuts cache invalidations from analyser noise by ~3x,
  // which means fewer offscreen redraws and smoother motion on busy audio.
  // The shader still reads SWR.Audio.feat directly every frame — only the
  // cache-key fingerprint is throttled.
  const FINGERPRINT_TTL_MS = 32;
  let _lastAudioHash = '';
  let _lastAudioHashAt = 0;
  function audioFingerprint() {
    const now = performance.now();
    const f = (window.SWR && window.SWR.Audio && window.SWR.Audio.feat) || {};
    // Beat onset detection: a hard beat (analyser fires beat=1.0 in one
    // frame, drops to 0 the next) within the memo TTL would produce a
    // stale cache key for one frame — visible as a one-frame lag on
    // bass-driven layers. Invalidate the memo whenever beat flips so
    // the very next cache key includes the new value. Cheap (one int
    // compare per call).
    if (state._lastBeat !== f.beat) {
      state._lastBeat = f.beat;
      _lastAudioHashAt = 0;
    }
    if (_lastAudioHash && (now - _lastAudioHashAt) < FINGERPRINT_TTL_MS) {
      return _lastAudioHash;
    }
    const round = (v) => Math.round((v || 0) * 10);
    _lastAudioHash = round(f.bass) + '|' + round(f.mid) + '|' + round(f.treble) + '|' +
                     round(f.rms) + '|' + round(f.centroid) + '|' + round(f.beat) + '|' +
                     round(f.onset);
    _lastAudioHashAt = now;
    return _lastAudioHash;
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
    // If the entry already exists at a stale version/size, delete it first
    // so the new .set() places it at the tail (Map insertion order). This
    // keeps the eviction policy (oldest-first) predictable even when the
    // same layerId is re-rendered at a new size/version.
    if (state.cache.has(layerId)) state.cache.delete(layerId);
    state.cache.set(layerId, {
      canvas: sourceCanvas, version,
      lastDpr: state.dpr, lastSize: state.cssW + 'x' + state.cssH,
    });
    // Evict the oldest entry (first iteration key) when over cap. This is
    // technically FIFO rather than LRU, but for layer caching where recently
    // *set* entries are also recently *used* the distinction is academic —
    // and FIFO avoids the re-insert-on-hit cost of a true LRU.
    while (state.cache.size > state.cacheCap) {
      const oldest = state.cache.keys().next().value;
      if (oldest === undefined) break;
      state.cache.delete(oldest);
    }
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

    // Auto-DPR: feed this frame's elapsed time (post-draw, so it reflects
    // the full frame cost including extras). Only runs when opted in
    // (off by default). State adjustment marks dirty, picked up on next
    // frame's fit().
    autoAdjustDpr(performance.now() - now);

    state.dirty = false;
  }

  // ---- public ----------------------------------------------------------

  window.SWR_RENDER = {
    fit, frame, invalidate, setBackground, setDprCap, setAutoDpr, devicePixelRatio,
    get dpr() { return state.dpr; },
    get cssW() { return state.cssW; },
    get cssH() { return state.cssH; },
    get dirty() { return state.dirty; },
    get cacheSize() { return state.cache.size; },
    get cacheCap() { return state.cacheCap; },
    setCacheCap(n) { state.cacheCap = Math.max(1, Math.min(64, n | 0)); while (state.cache.size > state.cacheCap) { const oldest = state.cache.keys().next().value; if (oldest === undefined) break; state.cache.delete(oldest); } },
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
      //
      // Cache lastW/lastH and only re-fit when the box actually changes —
      // ResizeObserver fires once on attach with the initial measurement,
      // and we already know the size from `clientWidth/Height`, so we can
      // skip the redundant re-fit that would otherwise cascade into a
      // window 'resize' event and force every engine listener to re-layout.
      let lastW = stage.clientWidth, lastH = stage.clientHeight;
      // Belt-and-braces: if the engine booted with clientWidth=0 (CSS not
      // laid out yet), schedule one rAF to re-fit when the real size
      // arrives. Without this, some engines cache W=0/H=0 forever.
      const needsLazyFit = (lastW === 0 || lastH === 0);
      const ro = new ResizeObserver((entries) => {
        const entry = entries[entries.length - 1];
        // Prefer contentBoxSize when available — avoids a forced layout
        // to read clientWidth/Height. Falls back to the property read for
        // older browsers.
        const w = entry && entry.contentBoxSize
          ? entry.contentBoxSize[0].inlineSize
          : stage.clientWidth;
        const h = entry && entry.contentBoxSize
          ? entry.contentBoxSize[0].blockSize
          : stage.clientHeight;
        if (w === lastW && h === lastH) return;
        lastW = w; lastH = h;
        state.dirty = true;
        try { window.SWR_RENDER.fit(stage); } catch (_) {}
        window.dispatchEvent(new Event('resize'));
      });
      ro.observe(stage);
      if (needsLazyFit) {
        requestAnimationFrame(() => {
          const w = stage.clientWidth, h = stage.clientHeight;
          if (w === 0 || h === 0 || (w === lastW && h === lastH)) return;
          lastW = w; lastH = h;
          state.dirty = true;
          try { window.SWR_RENDER.fit(stage); } catch (_) {}
          window.dispatchEvent(new Event('resize'));
        });
      }
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
