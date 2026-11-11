// client/automix-session-store.client.js
//
// L4 session memory (evolution plan phase 5): accumulates which anchors
// recent SONGS used, so the automix runtime can avoid re-anchoring a new
// song where the previous ones already went (novelty across songs, not
// within one).
//
// It also holds a SOFT PREFERENCE: which anchors the user kept (they froze,
// locked or saved that look). The preference is a prior, never a rule —
// novelty still wins, so a preferred anchor that is already in the recent
// set is not reused.
//
// Why a separate module: unit-testable under Node without a browser
// (check-automix-session-unit.mjs), same pattern as last-mix-store.
//
// Public API (window.SWR_AUTOMIX_SESSION):
//   record(songKey, anchorIds): upsert the song's anchor usage. Re-record
//     with the same key replaces the old entry. Keeps at most 5 songs
//     (oldest dropped) and at most 8 anchor ids per song.
//   recent(): deduped anchor ids across all stored songs, newest song
//     first. Empty array when nothing stored.
//   prefer(anchorId): record that the user KEPT this anchor. The weight
//     is capped, so a long session cannot grow the table without bound.
//   prefs(): a copy of the preference table (anchor id → weight).
//   pickPreferred(candidates, excludeIds): the candidate the user has
//     shown the most preference for, ignoring the excluded ids. null when
//     nothing is preferred (the caller then keeps its own order).
//   KEY: the localStorage key (exposed for tests/diagnostics).
//   LEGACY_KEY: the v1 key, read once and migrated on the first write.
//
// Storage shape (localStorage["swr.automix.session.v2"]):
//   { "songs": [{ "key": string, "ts": number, "anchorIds": [string] }],
//     "prefs": { "<anchorId>": number } }
//
// A v1 payload ({ "songs": [...] }) is migrated on first read: the songs
// carry over, the preferences start empty.
//
// Never throws: corrupted/unparseable payloads are treated as an empty
// store and overwritten on the next record (private-mode writes fail
// silently, same as last-mix-store).

(function () {
  'use strict';
  if (window.SWR_AUTOMIX_SESSION) return;

  var KEY = 'swr.automix.session.v2';
  var LEGACY_KEY = 'swr.automix.session.v1';
  var MAX_SONGS = 5;
  var MAX_ANCHORS = 8;
  // Bounded preference table: the most-preferred anchors are the useful
  // ones, so the tail is dropped and each weight is capped.
  var MAX_PREFS = 12;
  var MAX_PREF_WEIGHT = 5;

  function _blank() {
    return { songs: [], prefs: {} };
  }

  // Parse a stored payload. Anything that is not an object with a songs
  // array is treated as an empty store — a corrupt payload must never
  // throw into the render loop.
  function _parse(raw) {
    if (!raw) return null;
    var obj;
    try {
      obj = JSON.parse(raw);
    } catch (_) {
      return null;
    }
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return null;
    if (!Array.isArray(obj.songs)) return null;
    var prefs = {};
    if (obj.prefs && typeof obj.prefs === 'object' && !Array.isArray(obj.prefs)) {
      for (var id in obj.prefs) {
        if (!Object.prototype.hasOwnProperty.call(obj.prefs, id)) continue;
        var w = obj.prefs[id];
        if (typeof w === 'number' && isFinite(w) && w > 0) prefs[id] = Math.min(w, MAX_PREF_WEIGHT);
      }
    }
    return { songs: obj.songs, prefs: prefs };
  }

  function _read() {
    var raw = null;
    try {
      raw = localStorage.getItem(KEY);
    } catch (_) {
      return _blank();
    }
    if (raw) {
      var parsed = _parse(raw);
      return parsed || _blank();
    }
    // No v2 payload: migrate a v1 one if it is there.
    var legacy = null;
    try {
      legacy = localStorage.getItem(LEGACY_KEY);
    } catch (_) {
      return _blank();
    }
    var old = _parse(legacy);
    if (!old) return _blank();
    var migrated = { songs: old.songs, prefs: {} };
    _write(migrated);
    return migrated;
  }

  function _write(state) {
    try {
      localStorage.setItem(KEY, JSON.stringify(state));
    } catch (_) { /* private mode, quota, etc. — silently skip */ }
  }

  function record(songKey, anchorIds) {
    if (!songKey) return;
    var ids = (anchorIds || []).filter(function (id) {
      return typeof id === 'string' && id;
    }).slice(0, MAX_ANCHORS);
    var state = _read();
    var songs = state.songs.filter(function (s) {
      return s && s.key !== songKey;
    });
    songs.push({ key: songKey, ts: Date.now(), anchorIds: ids });
    while (songs.length > MAX_SONGS) songs.shift();
    state.songs = songs;
    _write(state);
  }

  function recent() {
    var state = _read();
    var seen = {};
    var out = [];
    for (var i = state.songs.length - 1; i >= 0; i--) {
      var ids = (state.songs[i] && state.songs[i].anchorIds) || [];
      for (var j = 0; j < ids.length; j++) {
        if (!seen[ids[j]]) {
          seen[ids[j]] = true;
          out.push(ids[j]);
        }
      }
    }
    return out;
  }

  // The user kept this anchor. The weight is a COUNT of keeps, capped, so
  // one very enthusiastic session cannot dominate the table forever.
  function prefer(anchorId) {
    if (typeof anchorId !== 'string' || !anchorId) return 0;
    var state = _read();
    var prefs = state.prefs || (state.prefs = {});
    var w = (typeof prefs[anchorId] === 'number' && isFinite(prefs[anchorId])) ? prefs[anchorId] : 0;
    w = Math.min(w + 1, MAX_PREF_WEIGHT);
    prefs[anchorId] = w;
    // Bound the table: drop the lightest entries once it is over the cap.
    var ids = Object.keys(prefs);
    if (ids.length > MAX_PREFS) {
      ids.sort(function (a, b) { return prefs[a] - prefs[b]; });
      for (var k = 0; k < ids.length - MAX_PREFS; k++) delete prefs[ids[k]];
    }
    _write(state);
    return w;
  }

  function prefs() {
    var state = _read();
    var out = {};
    for (var id in state.prefs) {
      if (Object.prototype.hasOwnProperty.call(state.prefs, id)) out[id] = state.prefs[id];
    }
    return out;
  }

  // The candidate the user has shown the most preference for, ignoring the
  // excluded ids (the recent set). null when nothing is preferred — the
  // caller then keeps its own ordering, which is the pre-P6 behaviour.
  // A tie keeps the earlier candidate, so an equally-liked set of anchors
  // still resolves to the nearest one.
  function pickPreferred(candidates, excludeIds) {
    var list = candidates || [];
    var excluded = {};
    var ex = excludeIds || [];
    for (var e = 0; e < ex.length; e++) excluded[ex[e]] = true;
    var table = _read().prefs || {};
    var best = null;
    var bestW = 0;
    for (var i = 0; i < list.length; i++) {
      var c = list[i];
      if (!c || !c.id || excluded[c.id]) continue;
      var w = table[c.id];
      if (typeof w !== 'number' || !isFinite(w) || w <= 0) continue;
      if (w > bestW) { bestW = w; best = c; }
    }
    return best;
  }

  // ---- Positive signals -------------------------------------------------
  // The user says "keep this one" by freezing, locking or saving the look
  // they are on. The runtime ALREADY emits these events, so the signals
  // are read here — no new runtime methods, and the runtime does not grow.
  //
  // The anchor the picture is on comes from the tick event, which carries
  // the mixed result and its anchor. Without a tick there is no anchor to
  // prefer, so the signal is dropped rather than guessed.
  var currentAnchorId = null;

  function _onTick(ev) {
    try {
      var mixed = (ev && ev.detail && ev.detail.mixed) || null;
      var anchors = mixed && mixed.anchors;
      if (anchors && anchors[0] && anchors[0].id) currentAnchorId = anchors[0].id;
    } catch (_) { /* never break the tick */ }
  }

  function _onKeep(ev) {
    try {
      if (!currentAnchorId) return;
      prefer(currentAnchorId);
    } catch (_) { /* a preference is never worth an exception */ }
  }

  // Freezing ON is a keep; freezing OFF is not. Locking ON is a keep;
  // unlocking is not. Saving is always a keep.
  function _onFreeze(ev) {
    var d = (ev && ev.detail) || {};
    if (d.frozen === true) _onKeep(ev);
  }
  function _onLock(ev) {
    var d = (ev && ev.detail) || {};
    if (d.locked === true) _onKeep(ev);
  }

  if (typeof window.addEventListener === 'function') {
    try {
      window.addEventListener('swr-automix-tick', _onTick);
      window.addEventListener('swr-automix-freeze', _onFreeze);
      window.addEventListener('swr-automix-save', _onKeep);
      window.addEventListener('swr-automix-lock', _onLock);
    } catch (_) { /* no event surface: no preference, no harm */ }
  }

  window.SWR_AUTOMIX_SESSION = {
    record: record,
    recent: recent,
    prefer: prefer,
    prefs: prefs,
    pickPreferred: pickPreferred,
    KEY: KEY,
    LEGACY_KEY: LEGACY_KEY,
    __loaded: true,
  };
})();
