// lib/library-hygiene.client.js — purge stale library items from IndexedDB.
//
// Stale = the stored blob is missing (null), corrupted (size 0 / un-readable),
// or the blob URL fails to decode as an image/video. These are the items that
// surface as 404s in the console (typically from a previous session whose IDB
// got pruned by the browser under quota pressure).
//
// Scans TWO stores:
//   1. The curated library (`sainted-word-records` DB → `assets` store).
//   2. The user's media uploads (`swr-media` DB → `media` store — managed by
//      lib/media-store.client.js). These are the upload-their-own-media
//      entries that show up as `creatorium_*.png 404` and `IMG_*.jpg 404`
//      when the browser silently prunes IDB under quota pressure.
//
// Public API:
//   window.SWR_LIBRARY_HYGIENE.scan()    → Promise<{
//     stale: [{ id, name, reason }], total,
//     userMediaStale: [{ id, name, reason }], userMediaTotal
//   }>
//   window.SWR_LIBRARY_HYGIENE.purge(stale?, userMediaStale?)
//                                          → Promise<{
//     removed, kept, stale,
//     userMediaRemoved, userMediaKept, userMediaStale
//   }>
//     If either list is omitted, runs scan() first for that store.
//   window.SWR_LIBRARY_HYGIENE.bindButton() → wires any element with
//     id="library-hygiene" to a confirm → purge → reload flow.
//
// Auto-bind on DOMContentLoaded so the panel button just works.
//
// Does NOT touch:
//   - the curated /library/ (lives on the server, re-streams on demand)
//   - the saved song (separate IDB store)
//   - installed .swr-set documents
//   - the user's auth session

(function () {
  if (window.SWR_LIBRARY_HYGIENE) return;  // idempotent

  const DB_NAME = 'sainted-word-records';
  const STORE = 'assets';

  function getDb() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async function getAllAssets(db) {
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly');
      const req = tx.objectStore(STORE).getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
  }

  async function deleteAsset(db, id) {
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      const req = tx.objectStore(STORE).delete(id);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  }

  // ---- Staleness checks --------------------------------------------------
  // Each check returns a string reason if the record is stale, else null.
  // Order matters; the first failure wins. Cheap checks first.

  function reasonMissingBlob(rec) {
    if (!rec) return 'record is null';
    if (!rec.blob) return 'blob is missing (IDB entry stored without a blob — likely quota-pruned)';
    if (typeof rec.blob === 'object' && rec.blob.size === 0) return 'blob is empty (0 bytes)';
    if (rec.blob instanceof Blob && rec.blob.size === 0) return 'blob is empty (0 bytes)';
    return null;
  }

  // Asynchronously try to decode the blob. If it errors or times out, mark stale.
  // Times out after 3s so a single corrupt asset doesn't block the scan forever.
  function reasonUnreadableBlob(rec) {
    return new Promise((resolve) => {
      if (!rec.blob || !(rec.blob instanceof Blob)) return resolve(null);
      const url = URL.createObjectURL(rec.blob);
      const cleanup = () => { try { URL.revokeObjectURL(url); } catch (_) {} };
      const t = setTimeout(() => { cleanup(); resolve('blob decode timed out (>3s)'); }, 3000);
      if (rec.type === 'image') {
        const img = new Image();
        img.onload = () => { clearTimeout(t); cleanup(); resolve(null); };
        img.onerror = () => { clearTimeout(t); cleanup(); resolve('image decode failed (corrupt or unsupported)'); };
        img.src = url;
      } else {
        // video or unknown type — try a quick <video> probe
        const v = document.createElement('video');
        v.preload = 'metadata';
        v.muted = true;
        v.onloadedmetadata = () => { clearTimeout(t); cleanup(); resolve(null); };
        v.onerror = () => { clearTimeout(t); cleanup(); resolve('video decode failed (corrupt or unsupported)'); };
        v.src = url;
      }
    });
  }

  async function scan() {
    const db = await getDb();
    const all = await getAllAssets(db);
    const stale = [];
    for (const rec of all) {
      const quick = reasonMissingBlob(rec);
      if (quick) {
        stale.push({ id: rec.id, name: rec.name || '(unnamed)', reason: quick });
        continue;
      }
      const deep = await reasonUnreadableBlob(rec);
      if (deep) stale.push({ id: rec.id, name: rec.name || '(unnamed)', reason: deep });
    }
    const userMediaResult = await scanUserMedia();
    return {
      stale,
      total: all.length,
      userMediaStale: userMediaResult.userMediaStale,
      userMediaTotal: userMediaResult.userMediaTotal,
    };
  }

  async function purge(staleOpt, userMediaStaleOpt) {
    const db = await getDb();
    let stale = staleOpt;
    let userMediaStale = userMediaStaleOpt;
    if (!stale || !userMediaStale) {
      const result = await scan();
      if (!stale) stale = result.stale;
      if (!userMediaStale) userMediaStale = result.userMediaStale || [];
    }
    let removed = 0;
    for (const item of stale) {
      try {
        await deleteAsset(db, item.id);
        removed++;
      } catch (err) {
        console.warn('[library-hygiene] failed to delete', item.id, err);
      }
    }
    // Drop the same IDs from in-memory Library.items if we're on engine.html.
    if (typeof window.Library !== 'undefined' && Array.isArray(window.Library.items)) {
      const staleIds = new Set(stale.map(s => s.id));
      window.Library.items = window.Library.items.filter(it => !staleIds.has(it.id));
      if (typeof window.Library.render === 'function') window.Library.render();
    }
    const userMediaResult = await purgeUserMedia(userMediaStale);
    return {
      removed,
      kept: stale.length - removed,
      stale,
      userMediaRemoved: userMediaResult.removed,
      userMediaKept: userMediaResult.kept,
      userMediaStale,
    };
  }

  // ---- User-media store (`swr-media` DB) --------------------------------
  // Mirrors the assets-store scan/purge above but for the separate DB
  // that lib/media-store.client.js writes to when users upload their own
  // files. These are the entries that surface as 404s after the browser
  // prunes IDB under quota pressure.

  const MEDIA_DB_NAME = 'swr-media';
  const MEDIA_STORE = 'media';

  function getMediaDb() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(MEDIA_DB_NAME);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
      // Older versions of swr-media may not have a `media` store yet — bail
      // gracefully so the assets-store scan still completes.
      req.onupgradeneeded = () => {
        try {
          const db = req.result;
          if (!db.objectStoreNames.contains(MEDIA_STORE)) {
            db.createObjectStore(MEDIA_STORE, { keyPath: 'id' });
          }
        } catch (_) { /* best-effort */ }
      };
    });
  }

  function getAllMediaRecords(db) {
    return new Promise((resolve, reject) => {
      try {
        const tx = db.transaction(MEDIA_STORE, 'readonly');
        const req = tx.objectStore(MEDIA_STORE).getAll();
        req.onsuccess = () => resolve(req.result || []);
        req.onerror = () => reject(req.error);
      } catch (e) {
        // Store doesn't exist in this DB version.
        resolve([]);
      }
    });
  }

  function deleteMediaRecord(db, id) {
    return new Promise((resolve, reject) => {
      try {
        const tx = db.transaction(MEDIA_STORE, 'readwrite');
        const req = tx.objectStore(MEDIA_STORE).delete(id);
        req.onsuccess = () => resolve();
        req.onerror = () => reject(req.error);
      } catch (e) {
        // Store doesn't exist — nothing to delete.
        resolve();
      }
    });
  }

  async function scanUserMedia() {
    let db;
    try { db = await getMediaDb(); } catch (e) { return { userMediaStale: [], userMediaTotal: 0 }; }
    const all = await getAllMediaRecords(db);
    const userMediaStale = [];
    for (const rec of all) {
      const quick = reasonMissingBlob(rec);
      if (quick) {
        userMediaStale.push({ id: rec.id, name: rec.name || '(unnamed)', reason: quick });
        continue;
      }
      const deep = await reasonUnreadableBlob(rec);
      if (deep) userMediaStale.push({ id: rec.id, name: rec.name || '(unnamed)', reason: deep });
    }
    return { userMediaStale, userMediaTotal: all.length };
  }

  async function purgeUserMedia(userMediaStaleOpt) {
    let stale = userMediaStaleOpt;
    if (!stale) {
      const result = await scanUserMedia();
      stale = result.userMediaStale;
    }
    if (!stale || !stale.length) return { removed: 0, kept: 0, stale: [] };
    let db;
    try { db = await getMediaDb(); } catch (e) { return { removed: 0, kept: stale.length, stale }; }
    let removed = 0;
    for (const item of stale) {
      try {
        await deleteMediaRecord(db, item.id);
        removed++;
      } catch (err) {
        console.warn('[library-hygiene] failed to delete user-media', item.id, err);
      }
    }
    return { removed, kept: stale.length - removed, stale };
  }

  // ---- Button binding ----------------------------------------------------

  function bindButton() {
    var btn = document.getElementById('library-hygiene');
    if (!btn) return;
    btn.addEventListener('click', async function (e) {
      e.preventDefault();
      btn.setAttribute('disabled', 'disabled');
      var originalLabel = btn.textContent;
      btn.textContent = 'SCANNING…';
      try {
        var result = await scan();
        var staleLib = result.stale || [];
        var staleUser = result.userMediaStale || [];
        if (staleLib.length === 0 && staleUser.length === 0) {
          btn.textContent = 'CLEAN ✓';
          setTimeout(function () { btn.textContent = originalLabel; btn.removeAttribute('disabled'); }, 1400);
          console.info('[library-hygiene] library is clean — 0 stale items across ' +
            (result.total + result.userMediaTotal) + ' total (assets=' + result.total +
            ', user-media=' + result.userMediaTotal + ').');
          return;
        }
        var previewLines = [];
        if (staleLib.length) {
          previewLines.push('Curated library (' + staleLib.length + '):');
          previewLines = previewLines.concat(staleLib.slice(0, 6)
            .map(function (s) { return '  • ' + s.name + ' (' + s.reason + ')'; }));
        }
        if (staleUser.length) {
          previewLines.push('Your uploads (' + staleUser.length + '):');
          previewLines = previewLines.concat(staleUser.slice(0, 6)
            .map(function (s) { return '  • ' + s.name + ' (' + s.reason + ')'; }));
        }
        var total = staleLib.length + staleUser.length;
        var preview = previewLines.join('\n');
        var more = total > 12 ? '\n  …and ' + (total - 12) + ' more' : '';
        var msg = 'Purge ' + total + ' stale item' + (total === 1 ? '' : 's') + '?\n\n' + preview + more +
          '\n\nThe curated library re-seeds on next page load; your uploads must be re-added manually.';
        if (!window.confirm(msg)) {
          btn.textContent = originalLabel;
          btn.removeAttribute('disabled');
          return;
        }
        btn.textContent = 'PURGING…';
        var summary = await purge(staleLib, staleUser);
        var totalRemoved = summary.removed + summary.userMediaRemoved;
        btn.textContent = 'PURGED ' + totalRemoved + ' ✓';
        console.info('[library-hygiene] purged ' + summary.removed + ' curated + ' +
          summary.userMediaRemoved + ' user-media = ' + totalRemoved + ' stale item(s).');
        setTimeout(function () { location.reload(); }, 800);
      } catch (err) {
        console.error('[library-hygiene] failed', err);
        btn.textContent = 'ERROR';
        setTimeout(function () { btn.textContent = originalLabel; btn.removeAttribute('disabled'); }, 1600);
      }
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bindButton);
  } else {
    bindButton();
  }

  window.SWR_LIBRARY_HYGIENE = {
    scan: scan,
    purge: purge,
    scanUserMedia: scanUserMedia,
    purgeUserMedia: purgeUserMedia,
    bindButton: bindButton,
  };
})();