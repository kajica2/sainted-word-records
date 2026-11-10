// client/image-layer-styles.client.js — image-layer swap styles for NEON /
// shared engines. When a still swaps (automix, lane step, demo), pick how
// it leaves and how the stack rearranges:
//
//   fade  — opacity crossfade only (no slide)
//   depth — reorder the layer toward the top of the stack, then fade
//   move  — flow slide + keep Ken Burns drift (imageEvolve)
//   mask  — drive a mask-illusion grade while fading out, then swap
//
// One global: window.SWR_IMAGE_STYLES.

(function (global) {
  'use strict';

  if (global.SWR_IMAGE_STYLES) return;

  var LS_KEY = 'swr.imageLayerStyle.v1';
  var STYLES = [
    { id: 'fade', label: 'Fade', hint: 'Opacity dissolve only' },
    { id: 'depth', label: 'Depth', hint: 'Bring the layer forward, then fade' },
    { id: 'move', label: 'Move', hint: 'Slide + Ken Burns drift' },
    { id: 'mask', label: 'Mask', hint: 'Mask illusion disappear, then swap' },
  ];
  var STYLE_IDS = STYLES.map(function (s) { return s.id; });
  var MASK_KEYS = ['maskThreshold', 'maskGooey', 'maskSlit', 'maskChromaBand', 'maskHalftone', 'maskKaleido'];

  var state = {
    style: loadStyle(),
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

  /** Move layer one step toward the top of the draw stack (end of list). */
  function swapDepth(layer) {
    var L = layersApi();
    if (!L || !Array.isArray(L.list) || !layer) return false;
    if (layer.locked) return false;
    var i = L.list.indexOf(layer);
    if (i < 0) return false;
    if (i >= L.list.length - 1) {
      // Already top — rotate under the next-to-top so depth still changes.
      if (L.list.length < 2) return false;
      var top = L.list.pop();
      L.list.splice(L.list.length - 1, 0, top);
    } else {
      var next = L.list[i + 1];
      L.list[i + 1] = layer;
      L.list[i] = next;
    }
    // Keep z fields consistent for pages that sort by z.
    for (var z = 0; z < L.list.length; z++) {
      if (L.list[z]) L.list[z].z = z;
    }
    if (typeof L.render === 'function') L.render();
    try {
      global.dispatchEvent(new CustomEvent('swr:image-depth-swap', {
        detail: { layerId: layer.id },
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
    layer._flowOffX = 0;
    layer._flowOffY = 0;
  }

  function seedFlow(layer, newAsset, ampScale) {
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
    layer._flowX = (h & 1) ? 1 : -1;
    layer._flowY = ((h >> 1) & 1) ? 0.35 : -0.35;
    layer._flowAmp = (ampScale == null ? 0.085 : ampScale) * (0.75 + 0.5 * kick);
  }

  /**
   * Draw-path helper: while a move-style flow window is open, offset the
   * photo. Returns { x, y } deltas in CSS pixels (0 when idle).
   */
  function flowOffset(layer, W, H) {
    if (!layer || !layer._flowUntil) return { x: 0, y: 0 };
    var now = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
    if (now > layer._flowUntil) {
      clearFlow(layer);
      return { x: 0, y: 0 };
    }
    var cur = typeof layer._currentOpacity === 'number' ? layer._currentOpacity : 1;
    var target = typeof layer._targetOpacity === 'number' ? layer._targetOpacity : 1;
    // Outgoing (target 0): ease toward edge; incoming (target > 0): ease from opposite edge.
    var leaving = target < 0.5;
    var e = leaving ? (1 - Math.max(0, Math.min(1, cur))) : Math.max(0, Math.min(1, 1 - cur));
    var ampX = (layer._flowAmp || 0.085) * (W || 1280);
    var ampY = (layer._flowAmp || 0.085) * (H || 720) * 0.55;
    var dir = leaving ? 1 : -1;
    var ox = dir * (layer._flowX || 1) * ampX * e;
    var oy = dir * (layer._flowY || 0) * ampY * e;
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

  function applyMaskIllusion(layer) {
    var name = pickMaskKey(layer);
    state._maskRestore = {
      at: Date.now(),
      name: name,
    };
    if (global.MaskIllusions && typeof global.MaskIllusions.apply === 'function') {
      global.MaskIllusions.apply(name);
      return name;
    }
    if (global.Personas && typeof global.Personas.apply === 'function') {
      global.Personas.apply(name);
      return name;
    }
    return null;
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

    if (styleId === 'depth' || opts.depth) {
      swapDepth(layer);
    }

    if (styleId === 'mask') {
      applyMaskIllusion(layer);
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
        seedFlow(layer, newAsset, 0.12);
      }
      var okMove = T.crossfade(layer, newAsset, { fadeOutMs: ms.out, fadeInMs: ms.in });
      if (styleId === 'move' && layer._flowAmp) {
        // Stretch the flow window across both fade legs.
        layer._flowUntil = (typeof performance !== 'undefined' && performance.now
          ? performance.now() : Date.now()) + ms.out + ms.in + 80;
      }
      if (styleId === 'mask') {
        // Soft flow under the mask so the dissolve is not a hard cut.
        layer._flowAmp = (layer._flowAmp || 0.085) * 0.55;
        layer._flowUntil = (typeof performance !== 'undefined' && performance.now
          ? performance.now() : Date.now()) + ms.out + ms.in + 80;
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
  };
})(typeof window !== 'undefined' ? window : globalThis);
