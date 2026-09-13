// client/preset-cycle.client.js
//
// Cycle through SHORTCUT_PRESETS in order. Wraps at both ends.
//
// Pure — no DOM, no audio, no globals beyond the SHORTCUT_PRESETS
// array (passed as a parameter so tests can stub). Unit-testable
// under Node via check-preset-cycle-unit.mjs.
//
// Public API (window.SWR_PRESET_CYCLE):
//   next(prevId)    -> string  (the id after prevId in order; wraps
//                          from the last id back to the first.
//                          If prevId is null/undefined/unknown, returns
//                          the first id.)
//   prev(prevId)    -> string  (the id before prevId; wraps from the
//                          first id back to the last.
//                          Same fallback as next.)
//   first()         -> string  (the first id in the list.)
//   last()          -> string  (the last id in the list.)
//   indexOf(id)     -> number  (0-based; -1 if not in list.)
//   ids()           -> string[] (defensive copy.)

(function () {
  'use strict';
  if (window.SWR_PRESET_CYCLE) return;

  function indexOf(list, id) {
    if (typeof id !== 'string') return -1;
    for (var i = 0; i < list.length; i++) if (list[i] === id) return i;
    return -1;
  }

  function next(ids, prevId) {
    if (!Array.isArray(ids) || !ids.length) return null;
    var i = indexOf(ids, prevId);
    if (i < 0) return ids[0];
    return ids[(i + 1) % ids.length];
  }

  function prev(ids, prevId) {
    if (!Array.isArray(ids) || !ids.length) return null;
    var i = indexOf(ids, prevId);
    if (i < 0) return ids[ids.length - 1];
    return ids[(i - 1 + ids.length) % ids.length];
  }

  function make(presetList) {
    var list = Array.isArray(presetList) ? presetList.slice() : [];
    return {
      next: function (prevId) { return next(list, prevId); },
      prev: function (prevId) { return prev(list, prevId); },
      first: function () { return list[0] || null; },
      last: function () { return list.length ? list[list.length - 1] : null; },
      indexOf: function (id) { return indexOf(list, id); },
      ids: function () { return list.slice(); },
      _list: list,
    };
  }

  var liveList = (window.VersionsPresets && Array.isArray(window.VersionsPresets.SHORTCUT_PRESETS))
    ? window.VersionsPresets.SHORTCUT_PRESETS
    : ['pulse', 'neon', 'grid', 'eclipse', 'smoke', 'aurora', 'film', 'glitch', 'void'];
  window.SWR_PRESET_CYCLE = make(liveList);

  window.SWR_PRESET_CYCLE.rebuild = function () {
    var fresh = (window.VersionsPresets && Array.isArray(window.VersionsPresets.SHORTCUT_PRESETS))
      ? window.VersionsPresets.SHORTCUT_PRESETS
      : [];
    var newApi = make(fresh);
    for (var k in newApi) window.SWR_PRESET_CYCLE[k] = newApi[k];
  };
})();
