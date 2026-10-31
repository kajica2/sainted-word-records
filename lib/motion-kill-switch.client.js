// lib/motion-kill-switch.client.js — global rotation & zoom kill-switch (default: OFF).
//
// Every engine surface loads this before /lib/apply-reactors.js. Saved projects,
// presets, and localStorage flags cannot re-enable motion while the switch is off.

(function (global) {
  'use strict';

  var ROTATION_GLOBALLY_ENABLED = false;
  var ZOOM_GLOBALLY_ENABLED = false;

  // CSS classes from video-fx.css that animate scale and/or rotation on #stage.
  var BLOCKED_CSS_ZOOM = [
    'kenburns', 'zoom-pulse', 'dreamy', 'audio-reactive', 'camera-3d',
    'kaleidoscope', 'liquify', 'parallax-layer-back', 'parallax-layer-mid', 'parallax-layer-front',
  ];
  var BLOCKED_CSS_ROTATION = ['camera-3d', 'kaleidoscope', 'liquify'];

  // engine-transitions.client.js ids that animate scale and/or 3D rotation.
  var BLOCKED_TRANSITIONS = [
    'zoom-through', 'swivel', 'snap-zoom', 'frame-freeze-zoom', 'light-leak-pop',
    'warp-dissolve', 'lens-flare', 'particle-wipe', 'object-pass-through',
  ];

  function isRotationGloballyEnabled() {
    return ROTATION_GLOBALLY_ENABLED === true;
  }

  function isZoomGloballyEnabled() {
    return ZOOM_GLOBALLY_ENABLED === true;
  }

  function isRotationAllowed(layer) {
    if (!isRotationGloballyEnabled()) return false;
    return !!(layer && layer.rotationEnabled === true);
  }

  function isReactorTargetAllowed(target) {
    if (target === 'rot' && !isRotationGloballyEnabled()) return false;
    if (target === 'scale' && !isZoomGloballyEnabled()) return false;
    return true;
  }

  function isTransitionAllowed(id) {
    if (!id || typeof id !== 'string') return false;
    if (isRotationGloballyEnabled() && isZoomGloballyEnabled()) return true;
    if (!isZoomGloballyEnabled() && BLOCKED_TRANSITIONS.indexOf(id) >= 0) return false;
    if (!isRotationGloballyEnabled() && id === 'swivel') return false;
    return true;
  }

  function filterTransitionCatalog(entries) {
    if (!entries || typeof entries !== 'object') return entries;
    var out = {};
    for (var k in entries) {
      if (Object.prototype.hasOwnProperty.call(entries, k) && isTransitionAllowed(k)) {
        out[k] = entries[k];
      }
    }
    return out;
  }

  function isCssFxAllowed(name) {
    if (!name) return false;
    if (!isZoomGloballyEnabled() && BLOCKED_CSS_ZOOM.indexOf(name) >= 0) return false;
    if (!isRotationGloballyEnabled() && BLOCKED_CSS_ROTATION.indexOf(name) >= 0) return false;
    return true;
  }

  function filterCssFxCatalog(catalog) {
    if (!Array.isArray(catalog)) return catalog;
    return catalog.filter(function (entry) {
      var n = entry && (entry.name || entry);
      return isCssFxAllowed(typeof n === 'string' ? n : '');
    });
  }

  function sanitizeLayer(layer) {
    if (!layer || typeof layer !== 'object') return layer;
    layer.rotationEnabled = false;
    layer.rotOffset = 0;
    if (layer.pos && typeof layer.pos === 'object') layer.pos.rot = 0;
    if (Array.isArray(layer.reactors)) {
      layer.reactors = layer.reactors.filter(function (r) {
        return r && isReactorTargetAllowed(r.target);
      });
    }
    if (Array.isArray(layer.modulators)) {
      layer.modulators = layer.modulators.filter(function (m) {
        return m && isReactorTargetAllowed(m.target);
      });
    }
    return layer;
  }

  function sanitizeLayers(list) {
    if (!Array.isArray(list)) return;
    for (var i = 0; i < list.length; i++) sanitizeLayer(list[i]);
  }

  function coerceStoredRotationEnabled() {
    return isRotationGloballyEnabled();
  }

  function stripActiveCssFxFromStage(stageEl) {
    if (!stageEl || !stageEl.classList) return;
    var all = BLOCKED_CSS_ZOOM.concat(BLOCKED_CSS_ROTATION);
    for (var i = 0; i < all.length; i++) stageEl.classList.remove(all[i]);
  }

  /** Canvas / inline render helpers — honour global flags so one flip re-enables all paths. */
  function rotRadFromDeg(deg) {
    if (!isRotationGloballyEnabled()) return 0;
    return (Number(deg) || 0) * Math.PI / 180;
  }

  function gateRotate(ctx, rad) {
    if (!ctx || !isRotationGloballyEnabled()) return;
    var r = Number(rad) || 0;
    if (r) ctx.rotate(r);
  }

  function gateScale(ctx, sx, sy) {
    if (!ctx || !isZoomGloballyEnabled()) return;
    if (sy === undefined || sy === null) ctx.scale(sx, sx);
    else ctx.scale(sx, sy);
  }

  function cssZoomFactor(factor) {
    if (!isZoomGloballyEnabled()) return 1;
    return factor == null ? 1 : factor;
  }

  function injectMotionCssGuards() {
    if (typeof document === 'undefined') return;
    var id = 'swr-motion-kill-css';
    var existing = document.getElementById(id);
    if (!isZoomGloballyEnabled()) {
      if (!existing) {
        existing = document.createElement('style');
        existing.id = id;
        document.head.appendChild(existing);
      }
      existing.textContent =
        '@keyframes heartbeat{from,to{transform:scale(1)!important}}' +
        '#swr-start .pulse{transform:scale(1)!important}';
    } else if (existing) {
      existing.remove();
    }
  }

  function applyUiDisabledState() {
    try {
      injectMotionCssGuards();
      var rotBtn = document.getElementById('swr-rot-master');
      if (rotBtn) {
        rotBtn.disabled = true;
        rotBtn.setAttribute('aria-disabled', 'true');
        rotBtn.title = 'Rotation is disabled site-wide';
        rotBtn.style.opacity = '0.35';
      }
      var rotateSel = document.getElementById('rotate-sel');
      if (rotateSel) {
        rotateSel.disabled = true;
        rotateSel.setAttribute('aria-disabled', 'true');
      }
      document.querySelectorAll('.x-rot, .rot-enable-toggle, input[data-prop="rot"]').forEach(function (el) {
        el.disabled = true;
        if (el.classList && el.classList.contains('x-rot')) el.style.display = 'none';
      });
      document.querySelectorAll('.layer-row-toggle').forEach(function (row) {
        if (row.querySelector('.rot-enable-toggle')) row.style.display = 'none';
      });
    } catch (_) {}
  }

  if (typeof document !== 'undefined') {
    var paintUi = function () {
      try { applyUiDisabledState(); } catch (_) {}
    };
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', paintUi);
    } else {
      paintUi();
    }
  }

  global.SWR_MOTION_KILL = {
    rotationGloballyEnabled: ROTATION_GLOBALLY_ENABLED,
    zoomGloballyEnabled: ZOOM_GLOBALLY_ENABLED,
    BLOCKED_CSS_ZOOM: BLOCKED_CSS_ZOOM.slice(),
    BLOCKED_CSS_ROTATION: BLOCKED_CSS_ROTATION.slice(),
    isRotationGloballyEnabled: isRotationGloballyEnabled,
    isZoomGloballyEnabled: isZoomGloballyEnabled,
    isRotationAllowed: isRotationAllowed,
    isReactorTargetAllowed: isReactorTargetAllowed,
    isCssFxAllowed: isCssFxAllowed,
    isTransitionAllowed: isTransitionAllowed,
    filterTransitionCatalog: filterTransitionCatalog,
    filterCssFxCatalog: filterCssFxCatalog,
    BLOCKED_TRANSITIONS: BLOCKED_TRANSITIONS.slice(),
    sanitizeLayer: sanitizeLayer,
    sanitizeLayers: sanitizeLayers,
    coerceStoredRotationEnabled: coerceStoredRotationEnabled,
    stripActiveCssFxFromStage: stripActiveCssFxFromStage,
    applyUiDisabledState: applyUiDisabledState,
    rotRadFromDeg: rotRadFromDeg,
    gateRotate: gateRotate,
    gateScale: gateScale,
    cssZoomFactor: cssZoomFactor,
    injectMotionCssGuards: injectMotionCssGuards,
  };
})(typeof window !== 'undefined' ? window : globalThis);
