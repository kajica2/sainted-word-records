// client/preset-pick-store.client.js
//
// Persists the user's last manual preset pick (Tab / Shift+Tab cycle or
// neighbour-list click) to localStorage so it survives a reload.
//
// Pure (no DOM, no audio, just localStorage) and unit-testable under
// Node via check-preset-pick-unit.mjs. Mirrors the last-mix-store
// pattern (no debounce — preset picks are infrequent: 1 per Tab press,
// max ~ once per second).
//
// Public API (window.SWR_PRESET_PICK):
//   save(id): write the pick. Idempotent. No-op for non-string / null.
//   load(): return the persisted id (string) or null. Validates that
//     the id is non-empty and stringly-typed. Does NOT gate against
//     SHORTCUT_PRESETS — neighbour-list clicks can reach any of the
//     19 anchor presets, not just the 9 shortcuts. The GLSL setPresetOverride()
//     path is the authoritative validator at apply time; rejecting
//     here would be over-eager.
//   clear(): remove the persisted record.
//   KEY: the localStorage key (exposed for tests + diagnostics).
//
// Schema versioning: prefixed with `v1.` so future format changes can
// detect old records instead of crashing on parse.

(function () {
  'use strict';
  if (window.SWR_PRESET_PICK) return;

  var KEY = 'swr.preset.manual.v1';

  function save(id) {
    if (typeof id !== 'string' || !id) return;
    try { localStorage.setItem(KEY, id); } catch (_) {}
  }

  function load() {
    try {
      var id = localStorage.getItem(KEY);
      if (!id) return null;
      if (typeof id !== 'string') return null;
      if (!id) return null;  // empty string guard
      return id;
    } catch (_) {
      return null;
    }
  }

  function clear() {
    try { localStorage.removeItem(KEY); } catch (_) {}
  }

  window.SWR_PRESET_PICK = {
    save: save,
    load: load,
    clear: clear,
    KEY: KEY,
  };
})();