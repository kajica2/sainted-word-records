// versions/last-song.js — load the user's last-loaded song from IndexedDB
// so a versions/*.html page can use it as the auto-start audio instead of
// (or in addition to) the per-page hardcoded bundled loop.
//
// Storage layout (matches engine.html Library.init() / Audio._saveCurrentSong):
//   DB:    'sainted-word-records' v2
//   Store: 'songs'
//   Key:   'current'  → { id: 'current', blob, name, type, savedAt }
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
      const req = indexedDB.open('sainted-word-records', 3);
      req.onupgradeneeded = (e) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains('songs')) {
          db.createObjectStore('songs', { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains('assets')) {
          db.createObjectStore('assets', { keyPath: 'id' });
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
})();