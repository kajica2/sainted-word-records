// engine-layout.client.js — vanilla JS controller for engine-layout.css.
//
// Sets body[data-layout] based on (in priority order):
//   1. URL query param:    ?layout=studio  | ?layout=wide
//   2. localStorage:       swr.layout
//   3. Default:            studio
//
// Toggle keys:
//   - 'L' or 'l'      → cycle studio → wide → studio
//   - 'Shift+L'       → set wide
//   - 'Shift+S'       → set studio (mirror of L's other half)
//
// In wide mode a small "WIDE · L to exit" badge is injected into the
// top-right so the user knows how to get back. The badge is suppressed
// during recorder sessions so it never ends up baked into a take.

(function () {
  'use strict';
  if (window.__swrLayout) return;
  window.__swrLayout = true;

  var STORAGE_KEY = 'swr.layout';
  var VALID = ['studio', 'wide'];
  var current = null;

  function readInitial() {
    try {
      var u = new URL(window.location.href);
      var q = u.searchParams.get('layout');
      if (q && VALID.indexOf(q) >= 0) return q;
    } catch (_) {}
    try {
      var stored = localStorage.getItem(STORAGE_KEY);
      if (stored && VALID.indexOf(stored) >= 0) return stored;
    } catch (_) {}
    return 'studio';
  }

  function apply(mode) {
    if (VALID.indexOf(mode) < 0) mode = 'studio';
    current = mode;
    document.body.setAttribute('data-layout', mode);
    try { localStorage.setItem(STORAGE_KEY, mode); } catch (_) {}
    syncBadge();
  }

  function syncBadge() {
    var b = document.getElementById('swr-layout-badge');
    if (current === 'wide' && !document.body.hasAttribute('data-recording')) {
      if (!b) {
        b = document.createElement('div');
        b.id = 'swr-layout-badge';
        b.textContent = 'WIDE · press L';
        document.body.appendChild(b);
      }
    } else if (b) {
      b.remove();
    }
  }

  // -- observe recorder state to suppress the badge mid-take ------------
  // engine.html / versions set body[data-recording="1"] when recording
  // starts (see Recorder.start() in each variant). We watch for changes.
  function observeRecording() {
    new MutationObserver(syncBadge).observe(document.body, {
      attributes: true, attributeFilter: ['data-recording'],
    });
  }

  // -- key handler ------------------------------------------------------
  function onKey(ev) {
    if (ev.defaultPrevented) return;
    // Ignore when typing into form fields
    var t = ev.target;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
    if (ev.key === 'L' || ev.key === 'l') {
      ev.preventDefault();
      apply(current === 'wide' ? 'studio' : 'wide');
    } else if (ev.key === 'S' && ev.shiftKey) {
      ev.preventDefault();
      apply('studio');
    }
  }

  // -- reflect to URL so a reload on a bookmark preserves the mode --------
  function syncUrl() {
    try {
      var u = new URL(window.location.href);
      if (current === 'studio') u.searchParams.delete('layout');
      else u.searchParams.set('layout', current);
      history.replaceState(null, '', u.pathname + (u.search ? u.search : '') + u.hash);
    } catch (_) {}
  }

  // -- cycle observer: keep URL in sync when user toggles ----------------
  // (run on animation frame to batch bursts of toggles)
  var syncQueued = false;
  function maybeSyncUrl() {
    if (syncQueued) return;
    syncQueued = true;
    requestAnimationFrame(function () { syncQueued = false; syncUrl(); });
  }

  // Wrap apply to also keep URL synced. Direct DOM attribute isn't
  // observable cheaply, so we hook our own public method instead.
  var _origApply = apply;
  apply = function (mode) { _origApply(mode); maybeSyncUrl(); syncBadge(); };

  // -- boot --------------------------------------------------------------
  apply(readInitial());
  document.addEventListener('keydown', onKey, { passive: false });
  observeRecording();

  // Expose for debugging / scripting
  window.SWR_LAYOUT = {
    get: function () { return current; },
    set: apply,
    cycle: function () { apply(current === 'wide' ? 'studio' : 'wide'); },
  };
})();
