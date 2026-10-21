// lib/reset-state.client.js — wipe local library + engine state across
// every page in the product.
//
// Semantics:
//   - Wipes the user's local data: uploaded media, saved song, marketplace
//     .swr-set documents, layer presets, etc.
//   - Clears the `swr-manifest-loaded` localStorage flag so the next visit
//     re-fetches the curated library/ from /library/manifest.json. The
//     curated assets themselves are NOT touched (they live on the server
//     and re-stream on demand).
//   - Does NOT clear the auth session cookie (`swrc_session`) — the user
//     stays signed in.
//   - Does NOT touch the bundled `audios/*.mp3` (served from the repo).
//   - Does NOT unregister the service worker or clear the cache API.
//     Clearing the SW cache is a "Reset EVERYTHING" flow that lives
//     elsewhere (devtools / unregister in the engine). This module
//     targets the user-data path.
//
// Public API:
//
//   await window.SWR_RESET_STATE.reset()  →  { stores: [{ name, cleared }, ...],
//                                              localStorage: [key, ...],
//                                              manifestFlag: true }
//     Wipes the data and returns a per-store summary so the caller can
//     show "Cleared N assets, M songs" feedback.
//
//   window.SWR_RESET_STATE.wipeOnly(['songs', 'manifestFlag'])
//     Wipe a subset. Useful for narrow flows ("clear just the saved
//     song" without nuking the rest). Pass store names, not aliases.
//
//   window.SWR_RESET_STATE.resolveAlias('library')
//     Expands "library" → ['assets', 'songs']. Use the same alias
//     vocabulary as the data-clear attribute: library, songs, sets,
//     media, manifestFlag. Unknown names pass through as singletons.
//
//   window.SWR_RESET_STATE.aliases
//     The full alias map for callers that want to enumerate.
//
// Buttons: any element with data-clear="<csv>" wires to wipeOnly
// automatically (see ALIASES at module scope). "Clear song" was the
// first narrow button; "Empty library" is the user-facing pair.
//
// Idempotent: re-evaluation returns the cached singleton.

(function () {
  'use strict';
  if (window.SWR_RESET_STATE) return;

  // The full set of IDB databases + stores the product uses for user
  // data. Bump this list when a new store appears (e.g. the persona
  // group table in presets/). The reset visits every database and every
  // store, so a new store is auto-covered.
  var DATABASES = [
    { name: 'sainted-word-records', version: 4, stores: ['assets', 'songs', 'sets'] },
    // version MUST track lib/media-store.client.js's DB_VERSION. It was
    // left at 1 when that store went to v2 (tombstones, for the cloud
    // mirror), so 'reset state' opened swr-media at a LOWER version than
    // the existing DB and threw:
    //   VersionError: The requested version (1) is less than the existing version (2).
    // 'tombstones' is included so a reset also clears deletion markers —
    // otherwise a later sync could still delete media that the reset had
    // deliberately removed.
    { name: 'swr-media',           version: 2, stores: ['media', 'tombstones'] },
  ];

  // localStorage keys that control user data behaviour. The
  // `swr-manifest-loaded` flag is the one we want to clear so the
  // curated library re-seeds on the next visit. The auth cookie is
  // HttpOnly and lives in document.cookie, not localStorage, so we
  // never have to worry about it here.
  var LOCALSTORAGE_KEYS = ['swr-manifest-loaded', 'swr.pending-set', 'swr.lastSong', 'swrc-migrate-asked-at'];

  // User-facing aliases for the data-clear attribute. Resolved in
  // bindButtons() before the actual store names land in wipeOnly().
  // Also exposed at SWR_RESET_STATE.aliases for callers.
  var ALIASES = {
    library:      ['assets', 'songs'],     // "Empty library" wipes user uploads + song
    songs:        ['songs'],                // alias of the single saved-song record
    sets:         ['sets'],                 // cleared-sets-only
    media:        ['media', 'tombstones'],  // cloud mirror bundle
    manifestFlag: ['manifestFlag'],         // re-seed the curated library
  };

  // Friendly confirm messages keyed by alias. Mirrors ALIASES so the
  // default prompt matches whatever the alias actually wipes.
  var FRIENDLY = {
    library:      'Empty the library? Every uploaded asset + saved song will be removed. Built-ins (curated library, bundled audio) will re-seed on the next page load.',
    songs:        'Clear only the saved song — your library assets + bundled songs stay.',
    sets:         'Clear the saved sets?',
    media:        'Clear the cloud-mirror media + tombstones?',
    manifestFlag: 'Force the curated library to re-seed on the next load?',
  };


  // ---- IDB helpers ------------------------------------------------------

  function openDb(name, version) {
    return new Promise(function (resolve, reject) {
      var req = indexedDB.open(name, version);
      req.onupgradeneeded = function (e) {
        // The reset should be a no-op on a fresh DB (no stores yet) and
        // a clean clear on an existing one. We don't recreate the
        // schema here — if the user reaches a fresh page after a reset
        // and there's no stores, the page's own init() will create them
        // on first use.
        e.target.transaction.abort();
      };
      req.onsuccess = function () { resolve(req.result); };
      req.onerror   = function () { reject(req.error); };
      req.onblocked = function () { reject(new Error('IDB blocked')); };
    });
  }

  function clearStore(db, store) {
    return new Promise(function (resolve) {
      try {
        if (!db.objectStoreNames.contains(store)) { resolve({ name: store, cleared: 0 }); return; }
        var tx  = db.transaction(store, 'readwrite');
        var req = tx.objectStore(store).clear();
        req.onsuccess = function () { resolve({ name: store, cleared: req.result || 0 }); };
        req.onerror   = function () { resolve({ name: store, cleared: 0, error: String(req.error) }); };
        tx.onabort    = function () { resolve({ name: store, cleared: 0, error: 'aborted' }); };
      } catch (e) {
        resolve({ name: store, cleared: 0, error: String(e) });
      }
    });
  }

  function clearDatabase(spec) {
    return openDb(spec.name, spec.version).then(async function (db) {
      try {
        var results = [];
        for (var i = 0; i < spec.stores.length; i++) {
          // eslint-disable-next-line no-await-in-loop
          results.push(await clearStore(db, spec.stores[i]));
        }
        return results;
      } finally {
        try { db.close(); } catch (_) {}
      }
    }).catch(function (e) {
      return spec.stores.map(function (s) { return { name: s, cleared: 0, error: String(e) }; });
    });
  }

  // ---- public API -------------------------------------------------------

  async function reset(opts) {
    opts = opts || {};
    var which = (opts.only && opts.only.length) ? new Set(opts.only) : null;
    var summary = { stores: [], localStorage: [], manifestFlag: false };

    // 1. Wipe every configured IDB store (or just the requested subset)
    for (var i = 0; i < DATABASES.length; i++) {
      var spec = DATABASES[i];
      var storesToClear = which
        ? spec.stores.filter(function (s) { return which.has(s); })
        : spec.stores;
      if (storesToClear.length === 0) continue;
      var subSpec = { name: spec.name, version: spec.version, stores: storesToClear };
      // eslint-disable-next-line no-await-in-loop
      var res = await clearDatabase(subSpec);
      summary.stores = summary.stores.concat(res);
    }

    // 2. Clear localStorage control flags so the next visit re-seeds
    if (!which || which.has('manifestFlag')) {
      for (var k = 0; k < LOCALSTORAGE_KEYS.length; k++) {
        var key = LOCALSTORAGE_KEYS[k];
        try {
          if (localStorage.getItem(key) !== null) {
            localStorage.removeItem(key);
            summary.localStorage.push(key);
            if (key === 'swr-manifest-loaded') summary.manifestFlag = true;
          }
        } catch (_) { /* localStorage unavailable (private mode); skip */ }
      }
    }

    return summary;
  }

  async function wipeOnly(names) {
    if (!Array.isArray(names) || !names.length) return reset();
    // Aliases are NOT expanded here — bindButtons() resolves
    // "library" → ["assets", "songs"] before the call. wipeOnly
    // expects store-name arguments. Pages calling wipeOnly() directly
    // (not via [data-clear]) should pass store names themselves.
    return reset({ only: names });
  }

  // ---- bind the Clear / Reset button(s) ---------------------------------
  // Any element with id="clear-all", "reset", "reset-state", or
  // "reset-library" gets wired automatically. The click is gated on
  // a confirm() so a misclick doesn't wipe data; pages that want a
  // custom confirm message can set data-confirm on the button.
  //
  // Narrow clear: any element with [data-clear="<csv>"] calls
  //   wipeOnly(<csv>) instead of reset(). E.g. data-clear="songs"
  //   wipes only the saved-song record, leaving library assets + sets
  //   intact. Useful for "Clear song" buttons that should not touch
  //   anything else.

  function bindButtons() {
    var BTN_IDS = ['clear-all', 'reset', 'reset-state', 'reset-library'];
    BTN_IDS.forEach(function (id) {
      var btn = document.getElementById(id);
      if (!btn) return;
      bindClearButton(btn, null);
    });

    // data-clear="<csv>" handlers (separate from the id-list). Allows
    // multiple narrow-clear buttons on one page (e.g. "Clear song",
    // "Empty library") without ID collisions. ALIASES (defined at
    // module scope, just above bindButtons) maps "library" →
    // ["assets", "songs"] etc. before the actual store names land in
    // wipeOnly(). Bare store names pass through verbatim.
    var nodes = document.querySelectorAll('[data-clear]');
    for (var i = 0; i < nodes.length; i++) {
      var csv = nodes[i].getAttribute('data-clear');
      if (!csv) continue;
      var raw = csv.split(',').map(function (s) { return s.trim(); }).filter(Boolean);
      if (!raw.length) continue;
      var names = [];
      raw.forEach(function (r) {
        if (ALIASES[r]) Array.prototype.push.apply(names, ALIASES[r]);
        else names.push(r);
      });
      bindClearButton(nodes[i], names);
    }
  }

  function bindClearButton(btn, onlyNames) {
    btn.addEventListener('click', async function (e) {
      e.preventDefault();
      // Use the button's data-confirm if present, otherwise derive a
      // readable message from the alias the user clicked. FRIENDLY
      // mirrors ALIASES so the prompt and the actual wipe stay in sync.
      var head = (onlyNames && onlyNames.length === 1 && FRIENDLY[onlyNames[0]])
        ? FRIENDLY[onlyNames[0]]
        : (onlyNames && onlyNames.length)
          ? 'Clear ' + onlyNames.join(' + ') + '? Bundled songs, library assets, and other data will be kept.'
          : 'Reset local library + engine state? Built-ins (curated library, bundled audio) will re-seed on the next page load. Auth stays signed in.';
      var msg = btn.getAttribute('data-confirm') || head;
      if (!window.confirm(msg)) return;
      try {
        if (typeof btn.setAttribute === 'function') btn.setAttribute('disabled', 'disabled');
        var summary = onlyNames
          ? await window.SWR_RESET_STATE.wipeOnly(onlyNames)
          : await window.SWR_RESET_STATE.reset();
        // Tiny status line so the user sees what happened. Pages that
        // want richer feedback can pass a data-on-done attribute and
        // hook into the result, but the common case is "page reload
        // so the UI re-renders clean".
        var totalCleared = summary.stores.reduce(function (s, r) { return s + (r.cleared || 0); }, 0);
        var lsk = summary.localStorage.length;
        console.info('[reset-state] cleared ' + totalCleared + ' records across ' +
                     summary.stores.length + ' stores, ' + lsk + ' localStorage key(s).');
        // Reload the page so the UI re-mounts from a clean state
        // (engine.html's Library, Lib in version pages, the song
        // picker, etc. all re-init against empty IDB).
        location.reload();
      } catch (err) {
        console.error('[reset-state] failed', err);
        if (typeof btn.removeAttribute === 'function') btn.removeAttribute('disabled');
      }
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bindButtons);
  } else {
    bindButtons();
  }

  // Exposed aliases so callers can use the same vocabulary as buttons.
  // resolveAlias('library') -> ['assets', 'songs']; unknown keys
  // pass through single-token.
  function resolveAlias(name) {
    if (!name) return [];
    var a = ALIASES[name];
    return a ? a.slice() : [name];
  }
  window.SWR_RESET_STATE = {
    reset: reset,
    wipeOnly: wipeOnly,
    aliases: ALIASES,
    resolveAlias: resolveAlias,
  };
})();
