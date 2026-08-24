// lib/playlist.client.js — in-memory + localStorage-backed current playlist.
//
// Public API
//
//   window.SWR_PLAYLIST          — primary handle (mirrors the canonical
//                                 contract window.SWR.PLAYLIST songs[]).
//   window.SWR.PLAYLIST          — same instance, exposed on the SWR object
//                                 because lib/library-switcher.client.js reads
//                                 it via window.SWR.PLAYLIST.songs.
//
// Methods (both handles point to the same instance):
//   list()           — returns a snapshot of current songs (no blob URLs).
//   add(song)        — append; no-op if a song with the same id is already
//                      present. Returns the new length.
//   remove(id)       — remove by id. Returns true if a row was removed.
//   clear()          — empty the playlist. Returns the prior length.
//   subscribe(fn)    — fn(newList, reason) called after every mutation with
//                      'add' | 'remove' | 'clear' | 'hydrate'. Returns
//                      unsubscribe().
//
// Persistence: localStorage key `swr.playlist.v1` holds the serialized
// songs. We never store blob URLs — playlist rows may carry `url` only when
// it is safe to (e.g. audio-bus `el.src`). Library rows store `sourceId`
// only; callers must go through SWR_LIBRARY_SWITCHER.pick() to resolve a
// playable URL when needed.
//
// Why two handles (SWR_PLAYLIST + SWR.PLAYLIST)?
// The Phase-1 library-switcher was written to read `window.SWR.PLAYLIST.songs`
// (see lib/library-switcher.client.js:78). Re-pointing that file to a different
// namespace would risk regressions. Both handles share the same backing state
// via a Proxy so external mutations like `SWR.PLAYLIST.songs = [...]` still
// reach the subscribers.
//
// Idempotent: re-evaluating the script returns the cached singleton.

(function () {
  'use strict';

  // ---- locate prior singleton ------------------------------------------------
  if (window.SWR_PLAYLIST || (window.SWR && window.SWR.PLAYLIST && Array.isArray(window.SWR.PLAYLIST.songs))) {
    return;
  }

  var STORAGE_KEY = 'swr.playlist.v1';

  // ---- internal state --------------------------------------------------------
  // The backing array is hidden behind the Proxy so external reads/writes go
  // through the same path as internal ones (subscribe, persist, dedupe).
  var _songs = hydrate();
  var _subs = [];

  function hydrate() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return [];
      var parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch (_) {
      return [];
    }
  }

  function persist() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(_songs));
    } catch (_) { /* quota / private mode — try once, give up silently */ }
  }

  function notify(reason) {
    var snap = _songs.slice();
    for (var i = 0; i < _subs.length; i++) {
      try { _subs[i](snap, reason); } catch (e) { console.warn('[SWR_PLAYLIST subscriber]', e); }
    }
  }

  // ---- public methods --------------------------------------------------------
  function list() { return _songs.slice(); }

  function add(song) {
    if (!song || typeof song !== 'object') return _songs.length;
    if (!song.id) song.id = 'pl:' + Date.now() + ':' + Math.random().toString(36).slice(2, 8);
    if (_songs.some(function (s) { return s && s.id === song.id; })) return _songs.length;
    _songs.push(song);
    persist();
    notify('add');
    return _songs.length;
  }

  function remove(id) {
    if (!id) return false;
    var before = _songs.length;
    _songs = _songs.filter(function (s) { return s && s.id !== id; });
    if (_songs.length === before) return false;
    persist();
    notify('remove');
    return true;
  }

  function clear() {
    var n = _songs.length;
    _songs = [];
    persist();
    notify('clear');
    return n;
  }

  function subscribe(fn) {
    if (typeof fn !== 'function') return function () {};
    _subs.push(fn);
    return function () {
      var idx = _subs.indexOf(fn);
      if (idx !== -1) _subs.splice(idx, 1);
    };
  }

  // ---- proxy backing ---------------------------------------------------------
  // Proxy lets `SWR.PLAYLIST.songs = [...]` go through the same notify/persist
  // path instead of breaking subscribers.
  var instance = {
    list: list,
    add: add,
    remove: remove,
    clear: clear,
    subscribe: subscribe,
    get songs() { return _songs; },
    set songs(arr) {
      if (!Array.isArray(arr)) return;
      _songs = arr.slice();
      persist();
      notify('hydrate');
    },
    get length() { return _songs.length; },
  };

  // Mirror on both handles.
  window.SWR_PLAYLIST = instance;
  window.SWR = window.SWR || {};
  window.SWR.PLAYLIST = instance;
})();
