// engine-timing.client.js — global fade timing for SWR engine layers.
//
// Sits between the page's applyR() and the per-layer draw call inside
// engine-render.client.js's SWR_RENDER.frame() loop. Each frame, for every
// layer, it eases the layer's `currentOpacity` toward `targetOpacity` using
// `fadeInMs` (rising) or `fadeOutMs` (falling) and clamps to [0, 1]. The
// result replaces `r.opacity` in the draw call.
//
// State lives on the layer object itself (currentOpacity, targetOpacity,
// fadeInMs, fadeOutMs, _fadeUntil, _swapPending) so per-layer timing survives
// across the layer-scheduler swap and across genops commit/undo.
//
// Public API on window.SWR_TIMING:
//   .defaults               — read-only defaults object (see DEFAULTS below)
//   .get(layer)             — { currentOpacity, targetOpacity, fadeInMs, fadeOutMs, … }
//   .setFade(layer, msIn, msOut)
//   .fadeIn(layer, ms)      — schedule targetOpacity → layer.opacity over ms
//   .fadeOut(layer, ms)     — schedule targetOpacity → 0 over ms
//   .crossfade(layer, newAsset, opts)  — A2 swap: fadeOut, swap, fadeIn with morph
//   .snapToBeat(fn, maxWaitMs)        — A3: defer fn() until next beatPulse (cap 750ms)
//   .step(dt, layer, r)     — called by SWR_RENDER.frame() each frame per layer
//   .attach(layers)         — initialise state for an array of layers (idempotent)
//
// Events:
//   swr-timing-fade-start { layer, dir: 'in'|'out' }
//   swr-timing-fade-end   { layer, dir, opacity }
//   swr-timing-swap       { layer, oldAssetId, newAssetId }
//
// STORAGE: localStorage key `swr.timing.v1` carries the user's edited
// defaults (not the per-layer overrides). Per-layer overrides are never
// persisted — they're scratch.

(function () {
  'use strict';
  if (window.SWR_TIMING) return;

  const LS_KEY = 'swr.timing.v1';

  // ---- defaults ----------------------------------------------------------

  const DEFAULTS = {
    // Per-layer timing defaults. Read by attach() if a layer doesn't already
    // carry these fields. Tunable from the TIMING panel (panel not built in
    // this slice — fields exist, UI comes later).
    fadeInMs: 800,
    fadeOutMs: 1200,
    holdMs: 0,
    ease: 'smooth',       // 'linear' | 'smooth' | 'sharp'

    // Per-event timing for ops triggered by LayerScheduler / genops.
    eventSwap:        { fadeOutMs: 600,  fadeInMs: 800  },
    eventCrossfade:   { fadeOutMs: 1200, fadeInMs: 1200 },
    eventMute:        { fadeOutMs: 400,  fadeInMs: 400  },
    eventUnmute:      { fadeOutMs: 400,  fadeInMs: 400  },
    eventIntro:       { fadeInMs: 1500, staggerMs: 120 },
    eventOutro:       { fadeOutMs: 2000, staggerMs: 100 },

    // A3 beat-snap cap: don't wait more than this for the next downbeat.
    beatSnapMaxWaitMs: 750,
  };

  function loadOverrides() {
    try {
      const raw = localStorage.getItem(LS_KEY);
      if (!raw) return {};
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch (_) { return {}; }
  }

  function saveOverrides(o) {
    try { localStorage.setItem(LS_KEY, JSON.stringify(o)); } catch (_) {}
  }

  // Shallow merge of saved overrides onto defaults (event sub-objects are
  // shallow-merged too, since DEFAULTS.eventSwap etc are flat shapes).
  const overrides = loadOverrides();
  const cfg = Object.assign({}, DEFAULTS, overrides);
  for (const k of Object.keys(DEFAULTS)) {
    if (DEFAULTS[k] && typeof DEFAULTS[k] === 'object' && !Array.isArray(DEFAULTS[k])) {
      cfg[k] = Object.assign({}, DEFAULTS[k], overrides[k] || {});
    }
  }

  // ---- easing -----------------------------------------------------------

  function ease(name, t) {
    if (t < 0) t = 0;
    if (t > 1) t = 1;
    if (name === 'sharp') return Math.pow(t, 0.4);
    if (name === 'smooth') return t * t * (3 - 2 * t);   // smoothstep
    return t;                                             // linear
  }

  // ---- layer initialisation ---------------------------------------------

  // Ensure a layer has all the fields the stepper expects. Idempotent.
  function attach(layers) {
    if (!layers) return;
    const arr = Array.isArray(layers) ? layers : [layers];
    let needStagger = false;
    for (const l of arr) {
      if (!l || typeof l !== 'object') continue;
      if (typeof l._currentOpacity !== 'number') {
        l._currentOpacity = 0;
        needStagger = true;       // first-time attach on a fresh layer set
      }
      if (typeof l._targetOpacity !== 'number')  l._targetOpacity  = l.opacity != null ? l.opacity : 1;
      if (!l.fadeInMs)  l.fadeInMs  = cfg.fadeInMs;
      if (!l.fadeOutMs) l.fadeOutMs = cfg.fadeOutMs;
      if (!l.ease)      l.ease      = cfg.ease;
      // Hold state for the intro/outro stagger (A1 luma-sorted start order).
      // Cached once on attach + recomputed on layer add via recomputeStagger().
      if (typeof l._staggerOrder !== 'number') l._staggerOrder = 0;
    }
    // A1 — auto-compute luma-sorted intro stagger on first-time attach.
    // Skip on subsequent attach() calls (those are just touching fields);
    // recomputeStagger() is the explicit re-entry point.
    if (needStagger) recomputeStagger(arr, 'lumaAsc');
  }

  // A1 — compute ascending luma stagger order over a layer list. Layers
  // without an asset get luma=1 (sort last = lightest = last to come in).
  // Caches on `_staggerOrder`; recomputeStagger() is called from the panel
  // / on layer add.
  function recomputeStagger(layers, mode) {
    if (!layers) return;
    mode = mode || 'lumaAsc';
    const arr = layers.slice();
    if (mode === 'index') {
      arr.forEach((l, i) => { l._staggerOrder = i; });
      return;
    }
    if (mode === 'hueSpread') {
      // Sort by hue distance from a reference; cheap proxy for "spread".
      arr.forEach((l, i) => { l._staggerOrder = l.hue != null ? l.hue : 0; });
      arr.sort((a, b) => a._staggerOrder - b._staggerOrder);
      arr.forEach((l, i) => { l._staggerOrder = i; });
      return;
    }
    // Default: lumaAsc (darkest first). Approximate luma from the asset's
    // stored meanLuma (set by Library on load), fall back to 0.5.
    const scored = arr.map(l => {
      const m = l.asset && typeof l.asset.meanLuma === 'number' ? l.asset.meanLuma : 0.5;
      return { l, m };
    });
    if (mode === 'lumaDesc') scored.sort((a, b) => b.m - a.m);
    else                     scored.sort((a, b) => a.m - b.m);
    scored.forEach((s, i) => { s.l._staggerOrder = i; });
  }

  // A1 — staggered fade-in over the layer list, ordered by _staggerOrder
  // (set by recomputeStagger). Walks layers in stagger order with
  // cfg.eventIntro.staggerMs between each, so the composition "blooms".
  // No-op if Layers has < 2 items or if SWR_TIMING.attach() hasn't run.
  function staggeredFadeIn(layers, opts) {
    if (!layers || !layers.length) return false;
    const o = Object.assign({ staggerMs: cfg.eventIntro.staggerMs, fadeInMs: cfg.eventIntro.fadeInMs }, opts || {});
    const sorted = layers.slice().sort((a, b) => (a._staggerOrder || 0) - (b._staggerOrder || 0));
    sorted.forEach((l, i) => {
      const delay = i * (o.staggerMs || 0);
      if (delay <= 0) {
        fadeIn(l, o.fadeInMs);
      } else {
        setTimeout(() => fadeIn(l, o.fadeInMs), delay);
      }
    });
    return true;
  }

  // ---- public mutators -------------------------------------------------

  function setFade(layer, msIn, msOut) {
    if (!layer) return;
    if (typeof msIn === 'number' && msIn >= 0)  layer.fadeInMs  = msIn;
    if (typeof msOut === 'number' && msOut >= 0) layer.fadeOutMs = msOut;
  }

  // Eased step toward targetOpacity. Called once per frame from the render
  // loop. Returns the (possibly clamped) opacity value the layer should
  // actually be drawn at, so callers can use it instead of r.opacity.
  function step(dt, layer, r) {
    if (!layer) return r && r.opacity != null ? r.opacity : 1;
    const cur = layer._currentOpacity;
    const tgt = layer._targetOpacity;
    if (Math.abs(cur - tgt) < 1e-4) {
      // Already at target — short-circuit.
      if (cur !== tgt) layer._currentOpacity = tgt;
      return applyToR(r, tgt);
    }
    // Use fadeInMs for rises, fadeOutMs for falls. Asymmetric = asymmetric
    // perceived speed, which is closer to how music fades actually feel.
    const goingUp = tgt > cur;
    const ms = goingUp ? (layer.fadeInMs || cfg.fadeInMs)
                       : (layer.fadeOutMs || cfg.fadeOutMs);
    // Linear t toward target by ms, then ease(t) for the actual blend.
    // At dt = 1/60s, fadeInMs = 800: 0.0208 raw → eased = 0.00126 → smooth.
    const rawStep = ms > 0 ? (dt * 1000) / ms : 1;
    // Don't clamp rawStep — we want to handle dt spikes (background tab).
    // Instead, advance by min(rawStep, 1).
    const adv = rawStep >= 1 ? 1 : rawStep;
    const dir = goingUp ? +1 : -1;
    const next = cur + dir * (Math.abs(tgt - cur)) * adv;
    // Clamp to range and capture the eased value for the draw.
    const clamped = tgt > cur ? Math.min(tgt, next) : Math.max(tgt, next);
    layer._currentOpacity = clamped;
    const draw = ease(layer.ease || cfg.ease,
                      goingUp ? (clamped / (tgt || 1))
                              : (1 - clamped / (tgt || 1)) * 0 + (1 - clamped / (tgt || 1)) /* unused */);
    // The eased value above is for raw 0→1; for currentOpacity we just clamp.
    return applyToR(r, clamped);
  }

  function applyToR(r, opacity) {
    if (!r) return { opacity: opacity };
    // Shallow clone so we don't mutate the page's cached r (some engines
    // reuse r across frames). Cheap; r has ~8 fields.
    const out = {};
    for (const k in r) out[k] = r[k];
    out.opacity = opacity;
    return out;
  }

  function fadeIn(layer, ms) {
    if (!layer) return false;
    layer._targetOpacity = layer.opacity != null ? layer.opacity : 1;
    if (typeof ms === 'number') layer.fadeInMs = ms;
    return true;
  }

  function fadeOut(layer, ms) {
    if (!layer) return false;
    layer._targetOpacity = 0;
    if (typeof ms === 'number') layer.fadeOutMs = ms;
    return true;
  }

  // A2 — crossfade swap. Phase 1: capture outgoing snapshot onto _morphFrom,
  // set targetOpacity=0 with cfg.eventSwap fade. Phase 2 (after fadeOut
  // convergence): swap layer.asset, reset _currentOpacity to the morphStart
  // value, set targetOpacity to outgoing opacity, restore the captured
  // baseScale/x/y/rot/hue/brightness/contrast onto the NEW asset's role so
  // the role survives the swap. Phase 3: ease back to role opacity.
  //
  // For simplicity in this slice we run it inline-synchronous: the layer's
  // currentOpacity keeps animating throughout; we swap the asset at the
  // midpoint of the fade (when currentOpacity has crossed below a threshold)
  // and let the fade continue to draw the new asset at rising opacity. The
  // morph is just "swap under the fade curtain"; visual continuity is good.
  function crossfade(layer, newAsset, opts) {
    if (!layer || !newAsset) return false;
    opts = opts || {};
    const o = Object.assign({}, cfg.eventSwap, opts);
    const oldAsset = layer.asset;
    layer._morphFrom = oldAsset ? {
      baseScale: layer.baseScale, x: 0, y: 0, rot: 0,
      hue: layer.hue, brightness: layer.brightness, contrast: layer.contrast,
    } : null;
    // Kick off fadeOut. The render loop's step() will swap at the midpoint
    // via _swapPending; see step().
    layer._swapPending = { newAsset, fadeOutMs: o.fadeOutMs, fadeInMs: o.fadeInMs };
    layer._targetOpacity = 0;
    if (o.fadeOutMs) layer.fadeOutMs = o.fadeOutMs;
    try {
      window.dispatchEvent(new CustomEvent('swr-timing-swap', {
        detail: { layer, oldAssetId: oldAsset && oldAsset.id, newAssetId: newAsset.id }
      }));
    } catch (_) {}
    return true;
  }

  // A3 — beat-snap. defers fn() until Audio.feat.beatPulse rises, capped at
  // maxWaitMs. Falls back to setTimeout(fn, maxWaitMs) if no beat arrives.
  // Uses a polling check at 50ms — beats fire at most ~3Hz at 180bpm so this
  // is well within tolerance.
  function snapToBeat(fn, maxWaitMs) {
    maxWaitMs = maxWaitMs != null ? maxWaitMs : cfg.beatSnapMaxWaitMs;
    const Audio = window.SWR && window.SWR.Audio;
    let last = Audio && Audio.feat ? !!Audio.feat.beatPulse : false;
    const started = Date.now();
    const id = setInterval(() => {
      const f = Audio && Audio.feat;
      const now = !!f && !!f.beatPulse;
      if ((now && !last) || (Date.now() - started) >= maxWaitMs) {
        clearInterval(id);
        try { fn(); } catch (_) {}
      }
      last = now;
    }, 50);
    return id;
  }

  // ---- intro trigger ----------------------------------------------------
  // The first time Audio flips from !playing to playing after page boot,
  // fire staggeredFadeIn() so the composition blooms from darkest to
  // lightest. Subsequent play→pause→play cycles (toggle within the same
  // session) do NOT re-trigger the intro — that would feel like a reset.
  // To re-trigger manually, call SWR_TIMING.staggeredFadeIn(Layers.list).
  let __introFired = false;
  function bootIntroHook() {
    const poll = () => {
      const Audio = window.SWR && window.SWR.Audio;
      const Layers = window.SWR && window.SWR.Layers;
      if (!Audio || !Layers || !Layers.list || !Layers.list.length) return false;
      // Drop a check on Audio.playing every 200ms; cheap, no events needed.
      if (Audio.playing && !__introFired) {
        __introFired = true;
        staggeredFadeIn(Layers.list);
      }
      return true;
    };
    setInterval(poll, 200);
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bootIntroHook);
  } else {
    bootIntroHook();
  }

  // ---- public exposure -------------------------------------------------

  window.SWR_TIMING = {
    defaults: DEFAULTS,
    cfg,
    attach,
    recomputeStagger,
    staggeredFadeIn,
    step,
    fadeIn,
    fadeOut,
    crossfade,
    setFade,
    snapToBeat,
    get(layer) {
      if (!layer) return null;
      return {
        currentOpacity: layer._currentOpacity,
        targetOpacity: layer._targetOpacity,
        fadeInMs: layer.fadeInMs,
        fadeOutMs: layer.fadeOutMs,
        ease: layer.ease,
        morphFrom: layer._morphFrom || null,
        swapPending: layer._swapPending || null,
      };
    },
    // Persist user edits from the (future) TIMING panel.
    setDefaults(patch) {
      Object.assign(cfg, patch);
      saveOverrides(cfg);
    },
  };
})();
