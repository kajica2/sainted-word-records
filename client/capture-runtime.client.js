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
//   getToolbarEl()                 — #swr-capture-toolbar (or null) — Task 2 test hook
//   getToggleBtn()                 — toggle button (or null) — Task 2 test hook
//   getIntervalInput()             — interval <input> (or null) — Task 2 test hook
//
// Pure logic lives next to the toolbar UI. The DOM overlay (toggle button
// + numeric input + status text + red-dot pulse indicator) is appended
// to <body> as the last child at boot time.
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
    updateUI();
  }
  function disable() {
    _enabled = false;
    _stopTimer();
    _safeSet(KEY_ENABLED, '0');
    updateUI();
  }
  function isEnabled() { return _enabled; }
  function setIntervalSec(n) {
    _intervalSec = _clampInterval(n);
    _safeSet(KEY_INTERVAL, String(_intervalSec));
    if (_enabled) _startTimer();
    updateUI();
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

  // ---- Toolbar UI (Task 2) -----------------------------------------------
  // Self-contained overlay toolbar appended to <body>. Inline styles only
  // (matches the engine HTML <style> blocks + automix debug panel at
  // engine.html:1385). Idempotent — safe to call multiple times.
  var _styleEl = null;
  var TOOLBAR_CSS =
    '@keyframes swr-capture-pulse{' +
      '0%,100%{box-shadow:0 0 0 0 rgba(255,107,26,0.65);}' +
      '50%{box-shadow:0 0 0 6px rgba(255,107,26,0);}' +
    '}' +
    '#swr-capture-toolbar{' +
      'position:fixed;bottom:12px;right:12px;z-index:9999;' +
      'background:rgba(10,10,16,0.92);color:var(--fg,#E5E5E7);' +
      'padding:10px 12px;border-radius:8px;' +
      'font:11px ui-monospace,SFMono-Regular,Menlo,monospace;' +
      'line-height:1.3;display:flex;flex-direction:column;gap:6px;' +
      'min-width:160px;' +
      'box-shadow:0 4px 16px rgba(0,0,0,0.4);' +
      'user-select:none;-webkit-user-select:none;' +
    '}' +
    '#swr-capture-toolbar .swr-capture-row{' +
      'display:flex;align-items:center;gap:8px;' +
    '}' +
    '#swr-capture-toolbar button{' +
      'position:relative;background:transparent;color:inherit;' +
      'border:1px solid rgba(255,255,255,0.18);border-radius:4px;' +
      'padding:4px 10px 4px 18px;font:inherit;cursor:pointer;' +
    '}' +
    '#swr-capture-toolbar button:hover{' +
      'border-color:rgba(255,255,255,0.32);' +
    '}' +
    '#swr-capture-toolbar button:disabled{' +
      'opacity:0.4;cursor:not-allowed;' +
    '}' +
    '#swr-capture-toolbar button::before{' +
      'content:"";position:absolute;left:6px;top:50%;' +
      'width:8px;height:8px;margin-top:-4px;border-radius:50%;' +
      'background:rgba(255,255,255,0.25);' +
    '}' +
    '#swr-capture-toolbar.is-active button::before{' +
      'background:#FF6B1A;' +
      'animation:swr-capture-pulse 2s ease-in-out infinite;' +
    '}' +
    '#swr-capture-toolbar label{' +
      'display:inline-flex;align-items:center;gap:4px;' +
    '}' +
    '#swr-capture-toolbar input[type="number"]{' +
      'background:rgba(255,255,255,0.06);color:inherit;' +
      'border:1px solid rgba(255,255,255,0.18);border-radius:4px;' +
      'padding:3px 6px;font:inherit;width:60px;text-align:center;' +
    '}' +
    '#swr-capture-toolbar .swr-capture-status{' +
      'font-size:10px;opacity:0.7;text-align:right;letter-spacing:0.02em;' +
    '}';

  function _injectStyles() {
    if (_styleEl || !document.head) return;
    _styleEl = document.createElement('style');
    _styleEl.id = 'swr-capture-toolbar-style';
    _styleEl.textContent = TOOLBAR_CSS;
    document.head.appendChild(_styleEl);
  }

  function _statusText() {
    return _enabled ? ('every ' + _intervalSec + 's') : 'off';
  }

  // Refresh the button's disabled state based on canvas availability.
  // Engine surfaces populate #stage asynchronously after DOMContentLoaded,
  // so we re-check a couple of times.
  function _refreshBtnDisabled() {
    var wrap = $('swr-capture-toolbar');
    if (!wrap) return;
    var btn = wrap.querySelector('button');
    if (btn) btn.disabled = !_findCanvas();
  }

  function mountToolbar() {
    if ($('swr-capture-toolbar')) return;
    if (!document.body) return; // mount only after <body> is ready

    _injectStyles();

    var wrap = document.createElement('div');
    wrap.id = 'swr-capture-toolbar';

    var row = document.createElement('div');
    row.className = 'swr-capture-row';

    var btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = 'Capture';
    btn.setAttribute('aria-pressed', _enabled ? 'true' : 'false');
    btn.addEventListener('click', function () {
      if (_enabled) disable(); else enable();
    });

    var label = document.createElement('label');
    var lblText = document.createElement('span');
    lblText.textContent = 'every';
    var input = document.createElement('input');
    input.type = 'number';
    input.min = String(MIN_INTERVAL);
    input.max = String(MAX_INTERVAL);
    input.step = '1';
    input.value = String(_intervalSec);
    input.setAttribute('aria-label', 'Capture interval in seconds');
    function commitInput() {
      var n = parseInt(input.value, 10);
      if (!isFinite(n)) n = _intervalSec;
      setIntervalSec(n);
    }
    input.addEventListener('change', commitInput);
    input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); commitInput(); input.blur(); }
    });
    var lblUnit = document.createElement('span');
    lblUnit.textContent = 's';
    label.appendChild(lblText);
    label.appendChild(input);
    label.appendChild(lblUnit);

    row.appendChild(btn);
    row.appendChild(label);

    var status = document.createElement('span');
    status.className = 'swr-capture-status';
    status.textContent = _statusText();

    wrap.appendChild(row);
    wrap.appendChild(status);
    document.body.appendChild(wrap);

    _refreshBtnDisabled();
    // Re-check canvas availability after engine boot settles.
    setTimeout(_refreshBtnDisabled, 500);
    setTimeout(_refreshBtnDisabled, 2000);

    updateUI();
  }

  // Reflect current state into the toolbar DOM. Idempotent; safe to call
  // before mountToolbar() (it's a no-op when the toolbar is absent).
  function updateUI() {
    var wrap = $('swr-capture-toolbar');
    if (!wrap) return;
    wrap.classList.toggle('is-active', !!_enabled);
    var status = wrap.querySelector('.swr-capture-status');
    if (status) status.textContent = _statusText();
    var input = wrap.querySelector('input[type="number"]');
    // Don't clobber the input while the user is typing in it.
    if (input && document.activeElement !== input) {
      input.value = String(_intervalSec);
    }
    var btn = wrap.querySelector('button');
    if (btn) btn.setAttribute('aria-pressed', _enabled ? 'true' : 'false');
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
    // Test hooks — Task 2 (toolbar UI access for unit/smoke tests).
    getToolbarEl: function () { return $('swr-capture-toolbar'); },
    getToggleBtn: function () {
      var t = $('swr-capture-toolbar');
      return t && t.querySelector('button');
    },
    getIntervalInput: function () {
      var t = $('swr-capture-toolbar');
      return t && t.querySelector('input[type="number"]');
    },
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
    // Mount toolbar after loadConfig so updateUI() reflects the persisted
    // state on first paint. Mirrors automix-runtime.client.js:711-717.
    mountToolbar();
    updateUI();
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', _boot);
  } else {
    _boot();
  }
})();
