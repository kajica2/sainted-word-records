// client/last-mix-store.client.js
//
// Persists the last automix blend to localStorage so the music_video
// page can restore a faded "last session" dot on reload. Tiny pure
// module: no DOM, no audio, just a debounced key/value write.
//
// Why debounced: automix.tick() fires every 2s; we don't need 60
// writes/minute to localStorage. The 1-second debounce coalesces.
//
// Why a separate module: unit-testable under Node without a browser
// (check-last-mix-unit.mjs). The page wires it from automix.tick()
// and from Gradient.setTrack().
//
// Public API (window.SWR_LAST_MIX):
//   save(mix): schedule a debounced write. mix = { ts, coords, anchors, preset }
//     where ts is Date.now(), coords = { warmth, intensity }, anchors is
//     the N-nearest list from SWR_ANCHOR_MAP.neighbours, preset is the
//     blended fx_state object.
//   flush(): synchronously write any pending debounced value (for tests +
//     page unload handlers).
//   read(): return the persisted mix object or null.
//   clear(): delete the persisted record + cancel pending writes.
//   KEY: the localStorage key (exposed for tests/diagnostics).
//
// Schema versioning: prefixed with `v1.` so future format changes can
// detect old records instead of crashing on parse.

(function () {
  'use strict';
  if (window.SWR_LAST_MIX) return;

  var KEY = 'swr.automix.lastMix.v1';
  var DEBOUNCE_MS = 1000;
  var _timer = null;
  var _pending = null;

  function _write(mix) {
    try {
      localStorage.setItem(KEY, JSON.stringify(mix));
    } catch (_) { /* private mode, quota, etc. — silently skip */ }
  }

  function save(mix) {
    _pending = mix;
    if (_timer) clearTimeout(_timer);
    _timer = setTimeout(function () {
      _timer = null;
      if (_pending) _write(_pending);
      _pending = null;
    }, DEBOUNCE_MS);
  }

  function flush() {
    if (_timer) { clearTimeout(_timer); _timer = null; }
    if (_pending) { _write(_pending); _pending = null; }
  }

  function read() {
    try {
      var raw = localStorage.getItem(KEY);
      if (!raw) return null;
      var obj = JSON.parse(raw);
      // Minimal shape check — older formats get discarded.
      if (obj && typeof obj.ts === 'number' && obj.coords && obj.anchors && obj.preset) {
        return obj;
      }
      return null;
    } catch (_) {
      return null;
    }
  }

  function clear() {
    if (_timer) { clearTimeout(_timer); _timer = null; }
    _pending = null;
    try { localStorage.removeItem(KEY); } catch (_) {}
  }

  window.SWR_LAST_MIX = {
    save: save,
    flush: flush,
    read: read,
    clear: clear,
    KEY: KEY,
    DEBOUNCE_MS: DEBOUNCE_MS,
  };
})();