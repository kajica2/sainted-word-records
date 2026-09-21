// client/capture-runtime.client.js
//
// Periodic canvas frame capture runtime + download-to-device.
// Self-contained IIFE: owns its own state + localStorage keys.
// Disabled by default — zero behaviour change unless the user opts
// in via URL param `?capture=N` or the toolbar UI added in Task 2.
//
// Public API (window.SWR_CAPTURE):
//   enable()                       — start the timer, persist enabled=1
//   disable()                      — clear the timer, persist enabled=0
//   isEnabled()                    — boolean (live instance state)
//   setIntervalSec(n)              — clamp 1-300, persist, restart if on
//   getIntervalSec()               — current interval (default 5)
//   getState()                     — { enabled, intervalSec, lastCaptureAt, captureCount }
//   captureNow()                   — one-shot: capture + download (async toBlob)
//   reset()                        — clear localStorage keys, stop timer
//
// Pure logic in this task. The toolbar UI (toggle button + numeric input)
// is appended in Task 2; nothing here renders into the DOM.
//
// Persistence keys:
//   swr.capture.enabled       — '1' | '0'  (default '0')
//   swr.capture.intervalSec   — JSON number, clamped 1-300 (default 5)
//
// URL param:
//   ?capture=N  (1 ≤ N ≤ 300, integer)  → set interval + auto-enable + persist.

(function () {
  'use strict';
  if (window.SWR_CAPTURE) return;

  // ---- Constants ---------------------------------------------------------
  var KEY_ENABLED  = 'swr.capture.enabled';
  var KEY_INTERVAL = 'swr.capture.intervalSec';
  var DEFAULT_INTERVAL = 5;
  var MIN_INTERVAL = 1;
  var MAX_INTERVAL = 300;
  var REVOKE_DELAY_MS = 1000;

  // ---- Helpers -----------------------------------------------------------
  function $(id) { return document.getElementById(id); }
  function _clampInterval(n) {
    var x = Number(n);
    if (!isFinite(x)) return DEFAULT_INTERVAL;
    x = Math.floor(x);
    if (x < MIN_INTERVAL) return MIN_INTERVAL;
    if (x > MAX_INTERVAL) return MAX_INTERVAL;
    return x;
  }
  function _safeGet(key) {
    try { return localStorage.getItem(key); } catch (_) { return null; }
  }
  function _safeSet(key, value) {
    try { localStorage.setItem(key, value); } catch (_) {}
  }
  function _safeRemove(key) {
    try { localStorage.removeItem(key); } catch (_) {}
  }
  function _warn(msg, err) {
    if (typeof console !== 'undefined' && console && console.warn) {
      console.warn(msg, err || '');
    }
  }
  // YYYY-MM-DDTHH-mm-ss — UTC, deterministic.
  function _filenameStamp() {
    return new Date().toISOString().slice(0, 19).replace(/[T:]/g, '-');
  }

  // ---- Canvas selection --------------------------------------------------
  // Engine convention: #stage is the main render surface. Fall back to
  // the first <canvas> if the page doesn't use #stage. Returns null when
  // neither is present so captureNow() can warn instead of crashing.
  function _findCanvas() {
    var byId = $('stage');
    if (byId && typeof byId.toBlob === 'function') return byId;
    if (typeof document.getElementsByTagName === 'function') {
      var all = document.getElementsByTagName('canvas');
      if (all && all.length && all[0] && typeof all[0].toBlob === 'function') {
        return all[0];
      }
    }
    return null;
  }

  // ---- Closure state -----------------------------------------------------
  // All instance state lives here. Tests inspect via getState(); nothing
  // outside the IIFE can mutate (encapsulation).
  var _enabled = false;
  var _intervalSec = DEFAULT_INTERVAL;
  var _lastCaptureAt = 0;
  var _captureCount = 0;
  var _timer = null;

  // ---- Timer management --------------------------------------------------
  function _startTimer() {
    _stopTimer();
    if (!_enabled) return;
    _timer = setInterval(function () { captureNow(); }, _intervalSec * 1000);
  }
  function _stopTimer() {
    if (_timer) { clearInterval(_timer); _timer = null; }
  }

  // ---- Core capture ------------------------------------------------------
  // Synchronously returns true if the canvas was found and toBlob was
  // dispatched; false otherwise. The actual download fires asynchronously
  // inside the toBlob callback (browsers don't support sync toBlob).
  function captureNow() {
    var canvas = _findCanvas();
    if (!canvas) {
      _warn('swr-capture: no canvas found (#stage or first <canvas>)');
      return false;
    }
    try {
      canvas.toBlob(function (blob) {
        if (!blob) {
          // Tainted canvas (cross-origin media) is the most common cause.
          _warn('swr-capture: canvas.toBlob returned null (tainted canvas?)');
          return;
        }
        var url = null;
        var a = null;
        try {
          url = URL.createObjectURL(blob);
          a = document.createElement('a');
          a.href = url;
          a.download = 'swr-frame-' + _filenameStamp() + '.png';
          a.style.display = 'none';
          if (document.body) document.body.appendChild(a);
          a.click();
          _captureCount += 1;
          _lastCaptureAt = Date.now();
        } catch (e) {
          _warn('swr-capture: download trigger failed', e);
          return;
        }
        setTimeout(function () {
          try { if (a && a.parentNode) a.parentNode.removeChild(a); } catch (_) {}
          try { if (url) URL.revokeObjectURL(url); } catch (_) {}
        }, REVOKE_DELAY_MS);
      }, 'image/png');
    } catch (e) {
      _warn('swr-capture: toBlob threw', e);
      return false;
    }
    return true;
  }

  // ---- Public surface ----------------------------------------------------
  function enable() {
    _enabled = true;
    _safeSet(KEY_ENABLED, '1');
    _startTimer();
  }
  function disable() {
    _enabled = false;
    _stopTimer();
    _safeSet(KEY_ENABLED, '0');
  }
  function isEnabled() { return _enabled; }
  function setIntervalSec(n) {
    _intervalSec = _clampInterval(n);
    _safeSet(KEY_INTERVAL, String(_intervalSec));
    if (_enabled) _startTimer();
  }
  function getIntervalSec() { return _intervalSec; }
  function getState() {
    return {
      enabled: _enabled,
      intervalSec: _intervalSec,
      lastCaptureAt: _lastCaptureAt,
      captureCount: _captureCount,
    };
  }
  function reset() {
    disable();
    _safeRemove(KEY_ENABLED);
    _safeRemove(KEY_INTERVAL);
    _intervalSec = DEFAULT_INTERVAL;
    _lastCaptureAt = 0;
    _captureCount = 0;
  }

  // ---- Config loader (URL + localStorage) --------------------------------
  // Called at IIFE init. Order:
  //   1. Parse URL `?capture=N`. If valid 1-300 integer → set interval +
  //      auto-enable (and persist; URL opt-in must round-trip).
  //   2. Otherwise, read localStorage. enabled=1 → restore. intervalSec →
  //      restore (clamped).
  function loadConfig() {
    // 1. URL opt-in (wins over localStorage; explicit user intent).
    try {
      var q = new URLSearchParams(window.location.search);
      var raw = q.get('capture');
      if (raw !== null && raw !== '') {
        var n = parseInt(raw, 10);
        // Reject '10.5' (parses to 10), '010' (parses to 10 but raw='010'),
        // negatives, NaN, out-of-range, zero.
        if (isFinite(n) && String(n) === raw &&
            n >= MIN_INTERVAL && n <= MAX_INTERVAL) {
          _intervalSec = n;
          _safeSet(KEY_INTERVAL, String(n));
          _safeSet(KEY_ENABLED, '1');
          _enabled = true;
          return;
        }
        // Invalid URL param — fall through to localStorage. Per spec,
        // invalid `?capture=` does NOT auto-enable.
      }
    } catch (_) { /* URLSearchParams unavailable (very old browsers) */ }

    // 2. Restore persisted state.
    try {
      var persisted = _safeGet(KEY_INTERVAL);
      if (persisted !== null) {
        var p = parseInt(persisted, 10);
        if (isFinite(p) && p >= MIN_INTERVAL && p <= MAX_INTERVAL) {
          _intervalSec = p;
        }
      }
      if (_safeGet(KEY_ENABLED) === '1') _enabled = true;
    } catch (_) {}
  }

  // ---- Public API --------------------------------------------------------
  window.SWR_CAPTURE = {
    enable: enable,
    disable: disable,
    isEnabled: isEnabled,
    setIntervalSec: setIntervalSec,
    getIntervalSec: getIntervalSec,
    getState: getState,
    captureNow: captureNow,
    reset: reset,
    // Constants for tests + diagnostics.
    KEY_ENABLED: KEY_ENABLED,
    KEY_INTERVAL: KEY_INTERVAL,
    DEFAULT_INTERVAL: DEFAULT_INTERVAL,
    MIN_INTERVAL: MIN_INTERVAL,
    MAX_INTERVAL: MAX_INTERVAL,
    loadConfig: loadConfig,
  };

  // ---- IIFE init ---------------------------------------------------------
  // Mirror automix-runtime.client.js's DOMContentLoaded pattern so the
  // loadConfig() + auto-start runs after the document parser is past the
  // script tag (in case a future caller inlines this before <body>).
  function _boot() {
    loadConfig();
    if (_enabled) _startTimer();
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', _boot);
  } else {
    _boot();
  }
})();
