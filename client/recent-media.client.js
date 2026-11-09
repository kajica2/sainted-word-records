// client/recent-media.client.js — the Recent folder in the media panel.
//
// The library lists everything in upload order (or grouped by filename).
// Nothing said which clips were just dropped or just put on a layer, so a
// performer hunting the clip they used a minute ago had to re-read names.
//
// This module is that folder. A page calls touch() when media is added or
// assigned, and pick() returns those items newest-first for a "recent"
// group the page paints above the rest of the list. The times survive a
// reload in localStorage, keyed by persist id or by name and size, because
// in-memory ids are minted again on every boot.
//
// It does not own the list and it does not render. groupItems() is
// untouched, so the automix pool still groups by name.

(function () {
  'use strict';
  if (window.SWR_RECENT_MEDIA) return;

  var STORE_KEY = 'swr.recent-media.v1';
  var STORE_CAP = 40;
  var DEFAULT_LIMIT = 12;

  function storage() {
    try {
      return window.localStorage || null;
    } catch (_) {
      return null;
    }
  }

  function readStore() {
    var ls = storage();
    if (!ls) return {};
    try {
      var raw = ls.getItem(STORE_KEY);
      var parsed = raw ? JSON.parse(raw) : {};
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch (_) {
      return {};
    }
  }

  function writeStore(map) {
    var ls = storage();
    if (!ls) return;
    var keys = Object.keys(map);
    if (keys.length > STORE_CAP) {
      keys.sort(function (a, b) { return (map[b] || 0) - (map[a] || 0); });
      var trimmed = {};
      for (var i = 0; i < STORE_CAP; i++) trimmed[keys[i]] = map[keys[i]];
      map = trimmed;
    }
    try {
      ls.setItem(STORE_KEY, JSON.stringify(map));
    } catch (_) {}
  }

  function keysOf(item) {
    var keys = [];
    if (!item) return keys;
    if (item.persistId) keys.push('id:' + item.persistId);
    if (item.name) {
      var size = item.blob && item.blob.size;
      keys.push('name:' + String(item.name) + ':' + (size || 0));
    }
    return keys;
  }

  function keyOf(item) {
    var keys = keysOf(item);
    return keys.length ? keys[0] : '';
  }

  function touch(item, when) {
    var keys = keysOf(item);
    if (!keys.length) return 0;
    var t = Number.isFinite(when) ? when : Date.now();
    item.recentAt = t;
    var map = readStore();
    for (var i = 0; i < keys.length; i++) map[keys[i]] = t;
    writeStore(map);
    return t;
  }

  function stamp(item) {
    if (!item) return 0;
    var map = readStore();
    var keys = keysOf(item);
    var stored = 0;
    var missingId = item.persistId && !map['id:' + item.persistId];
    for (var i = 0; i < keys.length; i++) {
      if ((map[keys[i]] || 0) > stored) stored = map[keys[i]];
    }
    var own = item.recentAt || 0;
    var t = stored > own ? stored : own;
    if (t) item.recentAt = t;
    // An upload is touched before persistence assigns an id, so the time
    // lives under the file name. Once the id exists, copy the time across
    // so the next reload finds it on the id the library restores.
    if (t && missingId) {
      map['id:' + item.persistId] = t;
      writeStore(map);
    }
    return t;
  }

  function pick(items, limit) {
    var cap = Number.isFinite(limit) && limit > 0 ? limit : DEFAULT_LIMIT;
    var ranked = [];
    (items || []).forEach(function (it) {
      if (!it) return;
      var t = stamp(it);
      if (t) ranked.push({ it: it, t: t });
    });
    ranked.sort(function (a, b) {
      if (b.t !== a.t) return b.t - a.t;
      return String(a.it.name || '').localeCompare(String(b.it.name || ''));
    });
    var out = [];
    for (var i = 0; i < ranked.length && out.length < cap; i++) out.push(ranked[i].it);
    return out;
  }

  window.SWR_RECENT_MEDIA = {
    keyOf: keyOf,
    touch: touch,
    stamp: stamp,
    pick: pick,
    LIMIT: DEFAULT_LIMIT,
  };
})();
