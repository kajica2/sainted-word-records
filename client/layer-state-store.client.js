// client/layer-state-store.client.js
//
// Persists music_video.html's Layers.list across reloads. Stores the
// per-layer metadata (id + slider values + reactors) but NOT the
// asset Blob URL — Blob URLs die on reload, and music_video.html's
// library is session-private (no built-ins). After reload, layers
// come back with their settings intact; the user re-uploads via the
// + button to slot assets back in.
//
// Mirrors the debounce pattern of last-mix-store.client.js: 1-second
// coalesce because layer-slider input fires many times per drag.
//
// Public API (window.SWR_LAYER_STATE):
//   save(layers): debounced write. layers is an array of layer
//     objects (e.g. Layers.list). Asset references are stripped —
//     asset is always null on restore. Idempotent.
//   load(): returns the persisted array of layer metadata, or [] if
//     nothing was persisted. Validates shape — drops entries missing
//     required fields rather than crashing the page.
//   clear(): remove the persisted record + cancel any pending write.
//   flush(): synchronously write any pending debounced value (for
//     tests + page unload handlers).
//   KEY: the localStorage key (exposed for tests + diagnostics).
//
// Schema versioning: prefixed with `v1.` so future format changes can
// detect old records instead of crashing on parse.

(function () {
  'use strict';
  if (window.SWR_LAYER_STATE) return;

  var KEY = 'swr.layers.state.v1';
  var DEBOUNCE_MS = 1000;
  var REQUIRED_FIELDS = ['id', 'blend', 'opacity', 'baseScale', 'hue',
                        'contrast', 'brightness', 'alpha', 'mutate', 'reactors'];

  // Strip non-serialisable fields before writing. asset is a Blob URL
  // (dies on reload); reactors is a small array, safe to round-trip.
  function _strip(layer) {
    if (!layer || typeof layer !== 'object') return null;
    var out = {};
    for (var k in layer) {
      if (Object.prototype.hasOwnProperty.call(layer, k)) {
        if (k === 'asset') continue;  // exclude Blob URL
        out[k] = layer[k];
      }
    }
    return out;
  }

  function _write(layers) {
    try {
      localStorage.setItem(KEY, JSON.stringify(layers));
    } catch (_) {}
  }

  var _pending = null;
  var _timer = null;

  function save(layers) {
    if (!Array.isArray(layers)) return;
    // Strip assets + drop non-objects (defensive).
    var stripped = [];
    for (var i = 0; i < layers.length; i++) {
      var s = _strip(layers[i]);
      if (s) stripped.push(s);
    }
    _pending = stripped;
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

  function load() {
    try {
      var raw = localStorage.getItem(KEY);
      if (!raw) return [];
      var arr = JSON.parse(raw);
      if (!Array.isArray(arr)) return [];
      // Drop entries missing required fields — old format or hand-edited.
      var out = [];
      for (var i = 0; i < arr.length; i++) {
        var e = arr[i];
        if (!e || typeof e !== 'object') continue;
        var ok = true;
        for (var j = 0; j < REQUIRED_FIELDS.length; j++) {
          if (!(REQUIRED_FIELDS[j] in e)) { ok = false; break; }
        }
        if (ok) out.push(e);
      }
      return out;
    } catch (_) {
      return [];
    }
  }

  function clear() {
    if (_timer) { clearTimeout(_timer); _timer = null; }
    _pending = null;
    try { localStorage.removeItem(KEY); } catch (_) {}
  }

  window.SWR_LAYER_STATE = {
    save: save,
    load: load,
    clear: clear,
    flush: flush,
    KEY: KEY,
    DEBOUNCE_MS: DEBOUNCE_MS,
    _strip: _strip,  // exposed for tests
  };
})();