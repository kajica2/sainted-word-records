// versions/last-song.js — load the user's last-loaded song from IndexedDB
// so a versions/*.html page can use it as the auto-start audio instead of
// (or in addition to) the per-page hardcoded bundled loop.
//
// Storage layout (matches engine.html Library.init() / Audio._saveCurrentSong):
//   DB:    'sainted-word-records' v4
//   Store: 'songs'
//   Key:   'current'  → { id: 'current', blob, name, type, savedAt }
//
//   Store: 'sets'   (added in v4) — installed .swr-set documents for the
//   marketplace page. Key is the set's UUID.
//
// Clearing: Library.clearAll() in engine.html calls Audio._clearCurrentSong()
// which deletes this record. The next visit to a versions/*.html page sees no
// saved song and falls back to the per-page hardcoded DEFAULT_SONG.
//
// API:
//   window.SWR_LAST_SONG  →  Promise<{ blob, name, type, savedAt } | null>
//     Resolves to null if no saved song exists OR IDB is unavailable
//     (private mode, browsers without IDB, etc.). The auto-start overlay
//     should ALWAYS fallback to the per-page DEFAULT_SONG in that case.
//
//   window.SWR_PICK_DEFAULT_SONG(fallbackUrl)  →  Promise<{ blob, name, url }>
//     High-level helper: returns the saved song's blob if one exists, else
//     fetches fallbackUrl and returns its blob. Returns null if both fail.
//
//   window.SWR_LAST_SONG_SAVE(file)  →  Promise<void>
//     Persist the user-picked file to the 'songs' store under key 'current'
//     so the next visit auto-restores it as the default. Fire-and-forget —
//     callers should not await this in the song-input change handler; the
//     A.load() call below should run on the same file. Failures are logged
//     but do not throw. The write is debounced against rapid re-saves of
//     the same file (same name + size + lastModified).
//
//   window.SWR_LAST_SONG_CLEAR()  →  Promise<void>
//     Delete the saved record. Used by "Clear All" buttons that want to
//     reset the auto-restore state without touching assets/sets.

(function () {
  if (window.SWR_LAST_SONG && window.SWR_PICK_DEFAULT_SONG) return; // idempotent

  function openDb(name, ver, upgrade) {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(name, ver);
      req.onupgradeneeded = (e) => upgrade(e.target.result);
      req.onsuccess = (e) => resolve(e.target.result);
      req.onerror = () => reject(req.error);
    });
  }

  // Tiny IDB wrapper — mirrors engine.html's openDb() but just enough to
  // read the 'songs' store. Kept self-contained so this script works on
  // versions/*.html pages that don't load the full engine bundle.
  function getSavedSong() {
    return new Promise((resolve) => {
      // IDB unavailable — resolve to null so callers can fall back cleanly
      if (typeof indexedDB === 'undefined') {
        resolve(null);
        return;
      }
      // NB: indexedDB.open() takes ONLY (name, version) — a third arg is
      // silently ignored by all current browsers (it was an early WebKit
      // extension that never made it to spec). To run schema setup we MUST
      // wire onupgradeneeded on the returned request. Using the 3-arg
      // form here created a v2 database with NO stores, which then
      // prevented engine.html from ever upgrading (same version = no
      // onupgradeneeded fire) and left the songs store uncreatable.
      // Bump version to 3 so the onupgradeneeded callback fires even for
      // users whose DB was previously created at v2 by the buggy 3-arg
      // form of indexedDB.open() (which silently ignored the upgrade
      // callback and created an empty schema). Fresh users hit v3
      // directly; poisoned users upgrade v2→v3 and get the missing
      // stores filled in. Users with an existing populated v2 DB don't
      // exist in the wild (the bug prevented the stores from being
      // created in the first place) so there's no data to lose.
      const req = indexedDB.open('sainted-word-records', 4);
      req.onupgradeneeded = (e) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains('songs')) {
          db.createObjectStore('songs', { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains('assets')) {
          db.createObjectStore('assets', { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains('sets')) {
          // Installed .swr-set documents (for marketplace page)
          db.createObjectStore('sets', { keyPath: 'id' });
        }
      };
      req.onsuccess = (e) => {
        const db = e.target.result;
        try {
          if (!db.objectStoreNames.contains('songs')) {
            db.close();
            resolve(null);
            return;
          }
          const tx = db.transaction('songs', 'readonly').objectStore('songs').get('current');
          tx.onsuccess = () => {
            db.close();
            const rec = tx.result;
            if (rec && rec.blob) {
              resolve({
                blob: rec.blob,
                name: rec.name || 'song',
                type: rec.type || rec.blob.type || 'audio/mpeg',
                savedAt: rec.savedAt || 0,
              });
            } else {
              resolve(null);
            }
          };
          tx.onerror = () => { db.close(); resolve(null); };
        } catch (err) {
          try { db.close(); } catch (_) {}
          resolve(null);
        }
      };
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    });
  }

  // Expose the low-level promise + a high-level helper. The helper is what
  // most callers want: it gives them a blob either way (saved song wins,
  // else the per-page fallback URL is fetched). Both paths fail-safe to
  // null if neither source produces a blob.
  window.SWR_LAST_SONG = getSavedSong();

  // ---- save the user's pick to IDB so the next visit auto-restores it ----
  // The version pages used to auto-restore the saved song (via
  // SWR_PICK_DEFAULT_SONG) but never wrote back: when the user picked a
  // new file via <input type="song-input">, A.load() ran but the IDB
  // record stayed stale (or empty), so a reload still served the OLD
  // saved song or fell through to the bundled MP3. Wiring the save into
  // the file-input change handler closes that loop.
  var _lastSaveSig = null;
  function saveCurrentSong(file) {
    if (!file) return Promise.resolve();
    // Cheap de-dupe: skip if the user re-picks the exact same file
    // (browsers fire `change` on cancel + re-select, etc.). Same name +
    // size + lastModified is a strong-enough identity signal for an
    // audio file the user just chose in a file picker.
    var sig = (file.name || '') + '|' + (file.size || 0) + '|' + (file.lastModified || 0);
    if (sig === _lastSaveSig) return Promise.resolve();
    _lastSaveSig = sig;
    return new Promise(function (resolve) {
      if (typeof indexedDB === 'undefined') { resolve(); return; }
      try {
        const req = indexedDB.open('sainted-word-records', 4);
        req.onupgradeneeded = function (e) {
          const db = e.target.result;
          if (!db.objectStoreNames.contains('songs')) db.createObjectStore('songs', { keyPath: 'id' });
          if (!db.objectStoreNames.contains('assets')) db.createObjectStore('assets', { keyPath: 'id' });
          if (!db.objectStoreNames.contains('sets')) db.createObjectStore('sets', { keyPath: 'id' });
        };
        req.onsuccess = function (e) {
          const db = e.target.result;
          try {
            const tx = db.transaction('songs', 'readwrite');
            tx.objectStore('songs').put({
              id:      'current',
              blob:    file,
              name:    file.name || 'song',
              type:    file.type || 'audio/mpeg',
              savedAt: Date.now(),
            });
            tx.oncomplete = function () { db.close(); resolve(); };
            tx.onerror    = function () { db.close(); resolve(); };
            tx.onabort    = function () { db.close(); resolve(); };
          } catch (_) {
            try { db.close(); } catch (_) {}
            resolve();
          }
        };
        req.onerror   = function () { resolve(); };
        req.onblocked = function () { resolve(); };
      } catch (_) {
        resolve();
      }
    });
  }

  function clearCurrentSong() {
    return new Promise(function (resolve) {
      if (typeof indexedDB === 'undefined') { resolve(); return; }
      try {
        const req = indexedDB.open('sainted-word-records', 4);
        req.onsuccess = function (e) {
          const db = e.target.result;
          try {
            if (!db.objectStoreNames.contains('songs')) { db.close(); resolve(); return; }
            const tx = db.transaction('songs', 'readwrite');
            tx.objectStore('songs').delete('current');
            tx.oncomplete = function () { db.close(); resolve(); };
            tx.onerror    = function () { db.close(); resolve(); };
          } catch (_) {
            try { db.close(); } catch (_) {}
            resolve();
          }
        };
        req.onerror   = function () { resolve(); };
        req.onblocked = function () { resolve(); };
      } catch (_) {
        resolve();
      }
    });
  }

  window.SWR_PICK_DEFAULT_SONG = async function (fallbackUrl) {
    // 1. Try the user's last-loaded song
    try {
      const saved = await window.SWR_LAST_SONG;
      if (saved && saved.blob) {
        return {
          blob: saved.blob,
          name: saved.name,
          url: null,           // came from IDB, not a URL fetch
          source: 'saved',
        };
      }
    } catch (_) { /* IDB errored; fall through */ }

    // 2. Fall back to the per-page bundled URL
    if (fallbackUrl) {
      try {
        const r = await fetch(fallbackUrl, { cache: 'force-cache' });
        if (r.ok) {
          const blob = await r.blob();
          const name = fallbackUrl.split('/').pop();
          return {
            blob,
            name,
            url: fallbackUrl,
            source: 'bundled',
          };
        }
      } catch (_) { /* fetch failed; fall through */ }
    }

    return null;
  };

  // Refresh the cached SWR_LAST_SONG promise after a save so the next
  // call to SWR_PICK_DEFAULT_SONG sees the freshly-picked file (instead
  // of the old IDB record that the first read fetched).
  function _refreshAfterSave(file) {
    _lastSaveSig = (file.name || '') + '|' + (file.size || 0) + '|' + (file.lastModified || 0);
    window.SWR_LAST_SONG = Promise.resolve({
      blob:    file,
      name:    file.name || 'song',
      type:    file.type || 'audio/mpeg',
      savedAt: Date.now(),
    });
  }

  window.SWR_LAST_SONG_SAVE = function (file) {
    return saveCurrentSong(file).then(function () { if (file) _refreshAfterSave(file); });
  };
  window.SWR_LAST_SONG_CLEAR = function () {
    _lastSaveSig = null;
    window.SWR_LAST_SONG = Promise.resolve(null);
    return clearCurrentSong();
  };
})();