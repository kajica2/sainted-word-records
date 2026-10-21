// lib/webgl-feature-detect.client.js — single source of truth for the
// "is WebGL allowed on this page?" check.
//
// Decision: WebGL is OFF by default (changed 2026-10; was default-on
// before). The reasons:
//   - rAF-bound WebGL passes on the engine's main 2D canvas tax every
//     device. Headless Chromium (CI), low-power laptops, and a subset
//     of Safari users see frame hitches and battery drain. The 2D-only
//     fallback is the legacy behaviour and is correct — WebGL was an
//     additive layer.
//   - Some CI environments don't have a real GPU and fall back to
//     SwiftShader, which is slow enough to break recording timeouts.
//     The opt-in (`?webgl=1`) lets a test pass when needed.
//
// Opt-in surface (any one of these turns WebGL on):
//   URL query:        ?webgl=1
//   localStorage:     swrWebGL = "1"
//
// Opt-out (force off, even if the user previously opted in):
//   URL query:        ?webgl=0
//   localStorage:     swrWebGL = "0"
//   legacy:           swrDisableWebGL = "1"  (kept for one cycle)
//
// Public surface (attaches to window.SWR_WEBGL):
//   isWebGLEnabled()              — boolean, side-effect free
//   requireWebGL(canvas, opts)    — getContext('webgl', opts) or null
//   isWebGLExplicitlyDisabled()   — boolean, true iff the user said no
//   WEBGL_DEFAULT_ENABLED = false — exported for tests / docs
//
// Wired into (read window.SWR_WEBGL.isWebGLEnabled()):
//   fx-postprocess.js, versions-presets.js,
//   lib/gpu-grade.client.js, client/dashboard-engine.client.js,
//   engine-3d.client.js, persona-runtime.client.js,
//   preset-preview.client.js, client/mesh-renderer.client.js,
//   persona-preview.client.js
//
// Loaded as a regular script (no `type="module"`), before any WebGL
// consumer. Attaches to `window.SWR_WEBGL` so module and defer scripts
// can both consume the helper without import/export plumbing.

(function () {
  function readUrlParam() {
    if (typeof location === 'undefined') return null;
    try {
      return new URLSearchParams(location.search).get('webgl');
    } catch {
      return null;
    }
  }

  function readLs(key) {
    if (typeof localStorage === 'undefined') return null;
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  }

  function isWebGLEnabled() {
    // 1. URL query param wins (most explicit; e.g. CI passes ?webgl=1).
    const q = readUrlParam();
    if (q === '1') return true;
    if (q === '0') return false;

    // 2. Legacy: the old swrDisableWebGL=1 still wins. Anyone with the
    //    flag set explicitly before this change keeps their behaviour.
    if (readLs('swrDisableWebGL') === '1') return false;

    // 3. New contract: localStorage 'swrWebGL' = '1' enables.
    const v = readLs('swrWebGL');
    if (v === '1') return true;
    if (v === '0') return false;

    // 4. Default off — see file header for rationale.
    return false;
  }

  function requireWebGL(canvas, opts) {
    if (!isWebGLEnabled()) return null;
    if (!canvas || typeof canvas.getContext !== 'function') return null;
    try {
      return canvas.getContext('webgl', opts)
          || canvas.getContext('experimental-webgl', opts);
    } catch {
      return null;
    }
  }

  function isWebGLExplicitlyDisabled() {
    const q = readUrlParam();
    if (q === '0') return true;
    if (readLs('swrDisableWebGL') === '1') return true;
    if (readLs('swrWebGL') === '0') return true;
    return false;
  }

  const WEBGL_DEFAULT_ENABLED = false;

  const api = {
    isWebGLEnabled,
    requireWebGL,
    isWebGLExplicitlyDisabled,
    WEBGL_DEFAULT_ENABLED,
  };

  if (typeof window !== 'undefined') {
    window.SWR_WEBGL = api;
  }
  if (typeof globalThis !== 'undefined' && typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})();