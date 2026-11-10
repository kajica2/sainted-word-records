// client/image-layer-styles.client.js — image-layer swap styles for NEON /
// shared engines. When a still swaps (automix, lane step, demo), pick how
// it leaves and how the stack rearranges:
//
//   fade  — opacity crossfade only (no slide)
//   depth — reorder the layer toward the top of the stack, then fade
//   move  — flow slide across the frame (the still itself holds still)
//   mask  — drive a mask-illusion grade while fading out, then swap
//
// Motion note: while a still is being swapped, the ambient Ken Burns drift
// and zoom are switched off (engine-render's imageEvolve). A still that
// drifts while it dissolves reads as a glitch, not as a transition. The
// swap's own motion — this module's flow slide — is a separate offset and
// stays.
//
// One global: window.SWR_IMAGE_STYLES.

(function (global) {
  'use strict';

  if (global.SWR_IMAGE_STYLES) return;

  var LS_KEY = 'swr.imageLayerStyle.v1';
  var STYLES = [
    { id: 'fade', label: 'Fade', hint: 'Opacity dissolve only' },
    { id: 'depth', label: 'Depth', hint: 'Bring the layer forward, then fade' },
    { id: 'move', label: 'Move', hint: 'Slide across the frame' },
    { id: 'mask', label: 'Mask', hint: 'Mask illusion disappear, then swap' },
  ];
  var STYLE_IDS = STYLES.map(function (s) { return s.id; });
  var MASK_KEYS = ['maskThreshold', 'maskGooey', 'maskSlit', 'maskChromaBand', 'maskHalftone', 'maskKaleido'];
  var PERSONA_KEYS = ['temp', 'mut', 'mutAlgo', 'posterize', 'vignette', 'chroma', 'grain', 'sepia', 'glow', 'grayscale', 'blur', 'liquid', 'pearl', 'glitch', 'tone', 'sharp', 'cinematic'];

  var state = {
    style: loadStyle(),
    _maskTimer: null,
    _maskToken: 0,
    _maskRestore: null,
  };

  function loadStyle() {
    try {
      var raw = global.localStorage && global.localStorage.getItem(LS_KEY);
      if (raw && STYLE_IDS.indexOf(raw) >= 0) return raw;
    } catch (_) {}
    return 'fade';
  }

  function saveStyle(id) {
    try {
      if (global.localStorage) global.localStorage.setItem(LS_KEY, id);
    } catch (_) {}
  }

  function styleById(id) {
    for (var i = 0; i < STYLES.length; i++) {
      if (STYLES[i].id === id) return STYLES[i];
    }
    return STYLES[0];
  }

  function getStyle() {
    return styleById(state.style);
  }

  function setStyle(id) {
    if (STYLE_IDS.indexOf(id) < 0) return getStyle();
    state.style = id;
    saveStyle(id);
    try {
      global.dispatchEvent(new CustomEvent('swr:image-style', {
        detail: { style: id, label: styleById(id).label },
      }));
    } catch (_) {}
    return getStyle();
  }

  function layersApi() {
    return global.Layers || (global.SWR && global.SWR.Layers) || null;
  }

  function imageLaneApi() {
    return global.SWR_IMAGE_LANE || global.ImageLane || null;
  }

  /** Prefer the list that actually owns this layer (video stack or image lane). */
  function ownerList(layer) {
    var lane = imageLaneApi();
    if (lane && Array.isArray(lane.list) && lane.list.indexOf(layer) >= 0) {
      return { api: lane, list: lane.list, kind: 'lane' };
    }
    var L = layersApi();
    if (L && Array.isArray(L.list) && L.list.indexOf(layer) >= 0) {
      return { api: L, list: L.list, kind: 'layers' };
    }
    // Fallback: if the layer carries the image-lane mark, use the lane even
    // when identity differs (cloned/adopted records).
    if (lane && Array.isArray(lane.list) && layer && layer._imageLane) {
      var byId = -1;
      for (var i = 0; i < lane.list.length; i++) {
        if (lane.list[i] && layer.id && lane.list[i].id === layer.id) { byId = i; break; }
      }
      if (byId >= 0) return { api: lane, list: lane.list, kind: 'lane', indexHint: byId };
    }
    return null;
  }

  /** Move layer one step toward the top of the draw stack (end of list). */
  function swapDepth(layer) {
    if (!layer || layer.locked) return false;
    var owner = ownerList(layer);
    if (!owner) return false;
    var list = owner.list;
    var i = typeof owner.indexHint === 'number' ? owner.indexHint : list.indexOf(layer);
    if (i < 0) return false;
    if (list.length < 2) return false;
    if (i >= list.length - 1) {
      // Already top — rotate under the next-to-top so depth still changes.
      var top = list.pop();
      list.splice(list.length - 1, 0, top);
    } else {
      var next = list[i + 1];
      list[i + 1] = list[i];
      list[i] = next;
    }
    for (var z = 0; z < list.length; z++) {
      if (list[z]) list[z].z = z;
    }
    if (owner.api && typeof owner.api.render === 'function') owner.api.render();
    try {
      global.dispatchEvent(new CustomEvent('swr:image-depth-swap', {
        detail: { layerId: layer.id, stack: owner.kind },
      }));
    } catch (_) {}
    return true;
  }

  function clearFlow(layer) {
    if (!layer) return;
    layer._flowX = 0;
    layer._flowY = 0;
    layer._flowAmp = 0;
    layer._flowUntil = 0;
    layer._flowFrom = 0;
    layer._flowOffX = 0;
    layer._flowOffY = 0;
  }

  function seedFlow(layer, newAsset, ampScale, windowMs) {
    var key = String((newAsset && (newAsset.name || newAsset.url)) || (layer && layer.id) || 'flow');
    var h = 2166136261;
    for (var i = 0; i < key.length; i++) {
      h ^= key.charCodeAt(i);
      h = (h * 16777619) >>> 0;
    }
    var kick = 0.5;
    try {
      var LP = global.SWR_LIFE;
      if (LP && LP.__loaded) kick = Math.min(1, LP.pulse);
    } catch (_) {}
    var now = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
    layer._flowX = (h & 1) ? 1 : -1;
    layer._flowY = ((h >> 1) & 1) ? 0.35 : -0.35;
    layer._flowAmp = (ampScale == null ? 0.085 : ampScale) * (0.75 + 0.5 * kick);
    layer._flowFrom = now;
    layer._flowUntil = now + (windowMs != null ? windowMs : 700);
  }

  /**
   * Draw-path helper: while a move-style flow window is open, offset the
   * photo. Time-based ease (not opacity) so a layer that settles at
   * opacity < 1 does not keep a residual slide until the window expires.
   */
  function flowOffset(layer, W, H) {
    if (!layer || !layer._flowUntil) return { x: 0, y: 0 };
    var now = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
    if (now >= layer._flowUntil) {
      clearFlow(layer);
      return { x: 0, y: 0 };
    }
    var from = layer._flowFrom || (layer._flowUntil - 700);
    var dur = Math.max(1, layer._flowUntil - from);
    var t = Math.max(0, Math.min(1, (now - from) / dur));
    // Rise then fall: peak mid-window, land at 0 when the window ends.
    var e = Math.sin(Math.PI * t);
    var ampX = (layer._flowAmp || 0.085) * (W || 1280);
    var ampY = (layer._flowAmp || 0.085) * (H || 720) * 0.55;
    var ox = (layer._flowX || 1) * ampX * e;
    var oy = (layer._flowY || 0) * ampY * e;
    layer._flowOffX = ox;
    layer._flowOffY = oy;
    return { x: ox, y: oy };
  }

  function pickMaskKey(layer) {
    var key = String((layer && layer.asset && (layer.asset.name || layer.asset.url)) || 'mask');
    var h = 2166136261;
    for (var i = 0; i < key.length; i++) {
      h ^= key.charCodeAt(i);
      h = (h * 16777619) >>> 0;
    }
    return MASK_KEYS[h % MASK_KEYS.length];
  }

  function snapshotFx() {
    var snap = { personaKey: null, profile: null };
    try {
      if (global.Personas && typeof global.Personas.current === 'function') {
        snap.personaKey = global.Personas.current();
      }
    } catch (_) {}
    try {
      var fx = global.FX;
      var st = fx && fx.state;
      if (st) {
        snap.profile = {};
        for (var i = 0; i < PERSONA_KEYS.length; i++) {
          var k = PERSONA_KEYS[i];
          if (st[k] !== undefined) snap.profile[k] = st[k];
        }
      }
    } catch (_) {}
    return snap;
  }

  function restoreFx(snap) {
    if (!snap) return;
    try {
      if (snap.personaKey && snap.personaKey !== 'off'
          && global.Personas && typeof global.Personas.apply === 'function'
          && global.Personas.PERSONAS && global.Personas.PERSONAS[snap.personaKey]
          && !MASK_KEYS.some(function (m) { return m === snap.personaKey; })) {
        // Prefer restoring a named non-mask persona so UI stays in sync.
        global.Personas.apply(snap.personaKey);
        return;
      }
    } catch (_) {}
    try {
      if (snap.profile && global.FX && typeof global.FX.setPersona === 'function') {
        global.FX.setPersona(snap.profile);
      }
      if (global.Personas && typeof global.Personas.apply === 'function' && snap.personaKey === 'off') {
        global.Personas.apply('off');
      }
    } catch (_) {}
  }

  function applyMaskIllusion(layer, restoreAfterMs) {
    var name = pickMaskKey(layer);
    // Keep the ORIGINAL pre-mask snapshot across overlapping Mask swaps so a
    // second dissolve mid-window cannot restore the active mask forever.
    if (!state._maskRestore) state._maskRestore = snapshotFx();
    state._maskToken += 1;
    var token = state._maskToken;
    if (state._maskTimer) {
      try { clearTimeout(state._maskTimer); } catch (_) {}
      state._maskTimer = null;
    }
    if (global.MaskIllusions && typeof global.MaskIllusions.apply === 'function') {
      global.MaskIllusions.apply(name);
    } else if (global.Personas && typeof global.Personas.apply === 'function') {
      global.Personas.apply(name);
    }
    var wait = Math.max(200, restoreAfterMs || 900);
    state._maskTimer = setTimeout(function () {
      if (token !== state._maskToken) return;
      restoreFx(state._maskRestore);
      state._maskRestore = null;
      state._maskTimer = null;
    }, wait);
    return name;
  }

  function defaultMs(styleId) {
    if (styleId === 'mask') return { out: 420, in: 520 };
    if (styleId === 'move') return { out: 320, in: 380 };
    if (styleId === 'depth') return { out: 200, in: 260 };
    return { out: 220, in: 280 };
  }

  /**
   * Swap the layer's media using the active (or opted) style.
   * opts: { style, fadeOutMs, fadeInMs, depth?: bool }
   */
  function swap(layer, newAsset, opts) {
    opts = opts || {};
    if (!layer || !newAsset) return false;
    if (layer.locked) return false;
    var styleId = opts.style || state.style;
    if (STYLE_IDS.indexOf(styleId) < 0) styleId = 'fade';
    var ms = defaultMs(styleId);
    if (opts.fadeOutMs != null) ms.out = opts.fadeOutMs;
    if (opts.fadeInMs != null) ms.in = opts.fadeInMs;
    var windowMs = ms.out + ms.in + 80;

    if (styleId === 'depth' || opts.depth) {
      swapDepth(layer);
    }

    if (styleId === 'mask') {
      applyMaskIllusion(layer, windowMs);
    }

    var T = global.SWR_TIMING;
    if (T && typeof T.crossfade === 'function') {
      try { T.attach(layer); } catch (_) {}
      // Fade: suppress flow. Move/mask: keep / boost flow.
      if (styleId === 'fade' || styleId === 'depth') {
        clearFlow(layer);
        var ok = T.crossfade(layer, newAsset, { fadeOutMs: ms.out, fadeInMs: ms.in });
        // crossfade always seeds flow — clear again for fade/depth.
        clearFlow(layer);
        layer._flowUntil = 0;
        return !!ok;
      }
      if (styleId === 'move') {
        seedFlow(layer, newAsset, 0.12, windowMs);
      }
      var okMove = T.crossfade(layer, newAsset, { fadeOutMs: ms.out, fadeInMs: ms.in });
      if (styleId === 'move') {
        // Re-assert the time window after crossfade's own flow seed.
        seedFlow(layer, newAsset, 0.12, windowMs);
      }
      if (styleId === 'mask') {
        seedFlow(layer, newAsset, 0.085 * 0.55, windowMs);
      }
      return !!okMove;
    }

    layer.asset = newAsset;
    return true;
  }

  /** Cycle style: fade → depth → move → mask → fade. */
  function cycle() {
    var i = STYLE_IDS.indexOf(state.style);
    var next = STYLE_IDS[(i + 1) % STYLE_IDS.length];
    return setStyle(next);
  }

  global.SWR_IMAGE_STYLES = {
    STYLES: STYLES.slice(),
    getStyle: getStyle,
    setStyle: setStyle,
    cycle: cycle,
    swap: swap,
    swapDepth: swapDepth,
    flowOffset: flowOffset,
    clearFlow: clearFlow,
    applyMaskIllusion: applyMaskIllusion,
    _snapshotFx: snapshotFx,
    _restoreFx: restoreFx,
  };
})(typeof window !== 'undefined' ? window : globalThis);
