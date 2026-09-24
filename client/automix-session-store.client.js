// client/automix-session-store.client.js
//
// L4 session memory (evolution plan phase 5): accumulates which anchors
// recent SONGS used, so the automix runtime can avoid re-anchoring a new
// song where the previous ones already went (novelty across songs, not
// within one).
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
//   KEY: the localStorage key (exposed for tests/diagnostics).
//
// Storage shape (localStorage["swr.automix.session.v1"]):
//   { "songs": [{ "key": string, "ts": number, "anchorIds": [string] }] }
//
// Never throws: corrupted/unparseable payloads are treated as an empty
// store and overwritten on the next record (private-mode writes fail
// silently, same as last-mix-store).

(function () {
  'use strict';
  if (window.SWR_AUTOMIX_SESSION) return;

  var KEY = 'swr.automix.session.v1';
  var MAX_SONGS = 5;
  var MAX_ANCHORS = 8;

  function _read() {
    try {
      var raw = localStorage.getItem(KEY);
      if (!raw) return { songs: [] };
      var obj = JSON.parse(raw);
      if (!obj || !Array.isArray(obj.songs)) return { songs: [] };
      return obj;
    } catch (_) {
      return { songs: [] };
    }
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
    _write({ songs: songs });
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

  window.SWR_AUTOMIX_SESSION = {
    record: record,
    recent: recent,
    KEY: KEY,
    __loaded: true,
  };
})();
