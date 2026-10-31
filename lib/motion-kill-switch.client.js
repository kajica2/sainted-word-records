// lib/motion-kill-switch.client.js — global motion kill-switches (default: OFF).
//
// Rotation, zoom, vortex, and CSS transitions/animations. Every engine surface
// loads this before /lib/apply-reactors.js. Saved projects, presets, and
// localStorage flags cannot re-enable motion while a switch is off.

(function (global) {
  'use strict';

  var ROTATION_GLOBALLY_ENABLED = false;
  var ZOOM_GLOBALLY_ENABLED = false;
  /** FX mutAlgo 0 — time-based vortex swirl in fx-postprocess.js (independent of layer rotation). */
  var VORTEX_GLOBALLY_ENABLED = false;
  var VORTEX_MUT_ALGO = 0;
  /** When vortex is off, presets/UI selecting algo 0 remap here (glitch — no u_time spin matrix). */
  var VORTEX_FALLBACK_MUT_ALGO = 1;
  /** CSS transition / @keyframes / Web Animations on visuals and chrome. */
  var CSS_TRANSITIONS_GLOBALLY_ENABLED = false;

  var CSS_MOTION_STYLE_ID = 'swr-motion-kill-css-transitions';
  var cssMotionGuardsInstalled = false;

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

  function isVortexGloballyEnabled() {
    return VORTEX_GLOBALLY_ENABLED === true;
  }

  function isCssTransitionsGloballyEnabled() {
    return CSS_TRANSITIONS_GLOBALLY_ENABLED === true;
  }

  function isMotionCssPropertyName(name) {
    return /^(-webkit-)?(transition|animation)(-|$)/i.test(String(name || ''));
  }

  function injectCssTransitionKill() {
    if (typeof document === 'undefined' || typeof document.getElementById !== 'function') return;
    var existing = document.getElementById(CSS_MOTION_STYLE_ID);
    if (!isCssTransitionsGloballyEnabled()) {
      if (!existing) {
        existing = document.createElement('style');
        existing.id = CSS_MOTION_STYLE_ID;
        var parent = document.head || document.documentElement;
        if (!parent || typeof parent.appendChild !== 'function') return;
        parent.appendChild(existing);
      }
      existing.textContent =
        '*,*::before,*::after{' +
        'transition:none!important;' +
        'animation:none!important;' +
        'animation-duration:0s!important;' +
        'transition-duration:0s!important;' +
        '}';
    } else if (existing) {
      existing.remove();
    }
  }

  function createImmediateAnimation(el, keyframes) {
    try {
      if (el && el.style && keyframes) {
        var last = keyframes;
        if (Array.isArray(keyframes) && keyframes.length) {
          last = keyframes[keyframes.length - 1];
        }
        if (last && typeof last === 'object') {
          for (var k in last) {
            if (!Object.prototype.hasOwnProperty.call(last, k)) continue;
            if (k === 'offset' || k === 'composite' || k === 'easing') continue;
            try { el.style[k] = last[k]; } catch (_) {}
          }
        }
      }
    } catch (_) {}
    var finishHandlers = [];
    var anim = {
      cancel: function () {},
      finish: function () {},
      pause: function () {},
      play: function () {},
      addEventListener: function (type, fn) {
        if (type === 'finish' || type === 'cancel') finishHandlers.push(fn);
      },
      removeEventListener: function () {},
      finished: Promise.resolve(),
    };
    Object.defineProperty(anim, 'onfinish', {
      configurable: true,
      enumerable: true,
      get: function () { return anim._onfinish; },
      set: function (fn) {
        anim._onfinish = fn;
        if (typeof fn === 'function') queueMicrotask(fn);
      },
    });
    queueMicrotask(function () {
      for (var i = 0; i < finishHandlers.length; i++) {
        try { finishHandlers[i](); } catch (_) {}
      }
      if (typeof anim._onfinish === 'function') {
        try { anim._onfinish(); } catch (_) {}
      }
    });
    return anim;
  }

  function canInstallDomGuards() {
    return typeof window !== 'undefined'
      && typeof document !== 'undefined'
      && typeof document.getElementById === 'function'
      && typeof document.createElement === 'function';
  }

  function installCssMotionGuards() {
    if (cssMotionGuardsInstalled || !canInstallDomGuards()) return;
    cssMotionGuardsInstalled = true;
    injectCssTransitionKill();
    if (isCssTransitionsGloballyEnabled()) return;

    if (typeof CSSStyleDeclaration !== 'undefined' && CSSStyleDeclaration.prototype.setProperty) {
      var origSetProperty = CSSStyleDeclaration.prototype.setProperty;
      CSSStyleDeclaration.prototype.setProperty = function (name, value, priority) {
        if (!isCssTransitionsGloballyEnabled() && isMotionCssPropertyName(name)) {
          return origSetProperty.call(this, name, 'none', priority || 'important');
        }
        return origSetProperty.apply(this, arguments);
      };
    }

    if (typeof CSSStyleDeclaration !== 'undefined') {
      ['transition', 'animation'].forEach(function (prop) {
        var desc = Object.getOwnPropertyDescriptor(CSSStyleDeclaration.prototype, prop);
        if (!desc || !desc.set || !desc.get) return;
        Object.defineProperty(CSSStyleDeclaration.prototype, prop, {
          configurable: true,
          enumerable: desc.enumerable,
          get: desc.get,
          set: function (v) {
            if (!isCssTransitionsGloballyEnabled()) desc.set.call(this, 'none');
            else desc.set.call(this, v);
          },
        });
      });
    }

    if (typeof Element !== 'undefined' && Element.prototype.animate) {
      var origAnimate = Element.prototype.animate;
      Element.prototype.animate = function (keyframes, options) {
        if (!isCssTransitionsGloballyEnabled()) {
          return createImmediateAnimation(this, keyframes, options);
        }
        return origAnimate.apply(this, arguments);
      };
    }

    if (typeof EventTarget === 'undefined' || !EventTarget.prototype) return;
    var origAddEventListener = EventTarget.prototype.addEventListener;
    EventTarget.prototype.addEventListener = function (type, listener, options) {
      if (!isCssTransitionsGloballyEnabled()
          && (type === 'animationend' || type === 'transitionend')) {
        var self = this;
        var once = !!(options && typeof options === 'object' && options.once);
        var fired = false;
        queueMicrotask(function () {
          if (once && fired) return;
          fired = true;
          try {
            var ev = new Event(type, { bubbles: true, cancelable: false });
            if (typeof listener === 'function') listener.call(self, ev);
            else if (listener && typeof listener.handleEvent === 'function') {
              listener.handleEvent(ev);
            }
          } catch (_) {}
        });
        return;
      }
      return origAddEventListener.apply(this, arguments);
    };
  }

  /** Coerce mutAlgo for FX.setAlgo / presets / automix (0 → fallback when vortex off). */
  function coerceMutAlgo(algo) {
    var a = Math.floor(Number(algo));
    if (!isFinite(a)) a = VORTEX_MUT_ALGO;
    if (a < 0) a = 0;
    if (a > 5) a = 5;
    if (a === VORTEX_MUT_ALGO && !isVortexGloballyEnabled()) {
      return VORTEX_FALLBACK_MUT_ALGO;
    }
    return a;
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

  /** Filter an id list at selection time (automix arc, storyboard, …). */
  function filterTransitionPool(pool) {
    if (!pool || !pool.length) return [];
    if (isRotationGloballyEnabled() && isZoomGloballyEnabled()) return pool.slice();
    return pool.filter(function (id) { return isTransitionAllowed(id); });
  }

  var FALLBACK_TRANSITION = 'fade-to-black';

  /** Random pick from a pool, re-filtered so blocked ids never become no-op fires. */
  function pickAllowedTransition(pool) {
    var allowed = filterTransitionPool(pool);
    if (!allowed.length) allowed = filterTransitionPool([FALLBACK_TRANSITION]);
    if (!allowed.length) allowed = [FALLBACK_TRANSITION];
    return allowed[Math.floor(Math.random() * allowed.length)];
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
    if (!isZoomGloballyEnabled()) {
      layer.baseScale = 1;
      if (layer._morphFrom && typeof layer._morphFrom === 'object') {
        layer._morphFrom.baseScale = 1;
      }
    }
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

  /** Variant pages and engine.html publish layers on window.SWR.Layers.list. */
  function sanitizeAllLayerStacks() {
    var n = 0;
    var swr = global.SWR;
    if (swr && swr.Layers && Array.isArray(swr.Layers.list)) {
      sanitizeLayers(swr.Layers.list);
      n += swr.Layers.list.length;
    }
    return n;
  }

  /**
   * Automix FX presets drive u_mut / u_mutAlgo (vortex + kaleidoscope read as
   * spin). Zero those fields while rotation is globally off.
   */
  function sanitizeFxPreset(preset) {
    if (!preset || typeof preset !== 'object') return preset;
    if (!isRotationGloballyEnabled()) {
      preset.mut = 0;
      preset.mutAlgo = coerceMutAlgo(preset.mutAlgo != null ? preset.mutAlgo : VORTEX_MUT_ALGO);
    } else if (preset.mutAlgo != null) {
      preset.mutAlgo = coerceMutAlgo(preset.mutAlgo);
    } else if (!isVortexGloballyEnabled()) {
      preset.mutAlgo = VORTEX_FALLBACK_MUT_ALGO;
    }
    if (!isZoomGloballyEnabled()) {
      preset.liquid = 0;
    }
    return preset;
  }

  /** One call from automix.start() — layers, stage CSS FX, live _fxOverride. */
  function sanitizeAutomixEntry() {
    sanitizeAllLayerStacks();
    try {
      if (typeof document !== 'undefined') {
        var stage = document.getElementById('render')
          || document.querySelector('#stage canvas')
          || document.getElementById('stage');
        stripActiveCssFxFromStage(stage);
      }
    } catch (_) {}
    try {
      if (global.SWR && global.SWR._fxOverride) sanitizeFxPreset(global.SWR._fxOverride);
    } catch (_) {}
    return true;
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
      injectCssTransitionKill();
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
      document.querySelectorAll('#mut-algo').forEach(function (sel) {
        var vortexOpt = sel.querySelector('option[value="0"]');
        if (!vortexOpt) return;
        if (!isVortexGloballyEnabled()) {
          vortexOpt.disabled = true;
          vortexOpt.hidden = true;
          if (String(sel.value) === '0') sel.value = String(VORTEX_FALLBACK_MUT_ALGO);
        } else {
          vortexOpt.disabled = false;
          vortexOpt.hidden = false;
        }
      });
      document.querySelectorAll('select option').forEach(function (opt) {
        if (!isVortexGloballyEnabled() && opt.textContent && opt.textContent.trim().toLowerCase() === 'vortex') {
          opt.disabled = true;
          opt.hidden = true;
          var sel = opt.parentElement;
          if (sel && sel.tagName === 'SELECT' && sel.selectedIndex === opt.index) {
            var fallback = sel.querySelector('option:not([hidden]):not([disabled])');
            if (fallback) sel.selectedIndex = fallback.index;
          }
        }
      });
    } catch (_) {}
  }

  if (canInstallDomGuards()) {
    installCssMotionGuards();
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
    vortexGloballyEnabled: VORTEX_GLOBALLY_ENABLED,
    cssTransitionsGloballyEnabled: CSS_TRANSITIONS_GLOBALLY_ENABLED,
    VORTEX_MUT_ALGO: VORTEX_MUT_ALGO,
    VORTEX_FALLBACK_MUT_ALGO: VORTEX_FALLBACK_MUT_ALGO,
    BLOCKED_CSS_ZOOM: BLOCKED_CSS_ZOOM.slice(),
    BLOCKED_CSS_ROTATION: BLOCKED_CSS_ROTATION.slice(),
    isRotationGloballyEnabled: isRotationGloballyEnabled,
    isZoomGloballyEnabled: isZoomGloballyEnabled,
    isVortexGloballyEnabled: isVortexGloballyEnabled,
    isCssTransitionsGloballyEnabled: isCssTransitionsGloballyEnabled,
    coerceMutAlgo: coerceMutAlgo,
    injectCssTransitionKill: injectCssTransitionKill,
    installCssMotionGuards: installCssMotionGuards,
    isRotationAllowed: isRotationAllowed,
    isReactorTargetAllowed: isReactorTargetAllowed,
    isCssFxAllowed: isCssFxAllowed,
    isTransitionAllowed: isTransitionAllowed,
    filterTransitionCatalog: filterTransitionCatalog,
    filterTransitionPool: filterTransitionPool,
    pickAllowedTransition: pickAllowedTransition,
    filterCssFxCatalog: filterCssFxCatalog,
    BLOCKED_TRANSITIONS: BLOCKED_TRANSITIONS.slice(),
    sanitizeLayer: sanitizeLayer,
    sanitizeLayers: sanitizeLayers,
    sanitizeAllLayerStacks: sanitizeAllLayerStacks,
    sanitizeFxPreset: sanitizeFxPreset,
    sanitizeAutomixEntry: sanitizeAutomixEntry,
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
