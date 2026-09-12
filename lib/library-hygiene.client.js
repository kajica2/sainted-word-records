// lib/library-hygiene.client.js — purge stale library items from IndexedDB.
//
// Stale = the stored blob is missing (null), corrupted (size 0 / un-readable),
// or the blob URL fails to decode as an image/video. These are the items that
// surface as 404s in the console (typically from a previous session whose IDB
// got pruned by the browser under quota pressure).
//
// Public API:
//   window.SWR_LIBRARY_HYGIENE.scan()    → Promise<{ stale: [{ id, name, reason }], total }>
//   window.SWR_LIBRARY_HYGIENE.purge(stale?)  → Promise<{ removed, kept }>
//     If `stale` is omitted, runs scan() first.
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
    return { stale, total: all.length };
  }

  async function purge(staleOpt) {
    const db = await getDb();
    let stale = staleOpt;
    if (!stale) {
      const result = await scan();
      stale = result.stale;
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
        if (result.stale.length === 0) {
          btn.textContent = 'CLEAN ✓';
          setTimeout(function () { btn.textContent = originalLabel; btn.removeAttribute('disabled'); }, 1400);
          console.info('[library-hygiene] library is clean — 0 stale items across ' + result.total + ' total.');
          return;
        }
        var preview = result.stale.slice(0, 8)
          .map(function (s) { return '  • ' + s.name + ' (' + s.reason + ')'; })
          .join('\n');
        var more = result.stale.length > 8 ? '\n  …and ' + (result.stale.length - 8) + ' more' : '';
        var msg = 'Purge ' + result.stale.length + ' stale library item' + (result.stale.length === 1 ? '' : 's') + '?\n\n' + preview + more + '\n\nThe curated library is unaffected; missing assets re-seed on the next page load.';
        if (!window.confirm(msg)) {
          btn.textContent = originalLabel;
          btn.removeAttribute('disabled');
          return;
        }
        btn.textContent = 'PURGING…';
        var summary = await purge(result.stale);
        btn.textContent = 'PURGED ' + summary.removed + ' ✓';
        console.info('[library-hygiene] purged ' + summary.removed + ' stale item(s) (' + summary.kept + ' failed).');
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

  window.SWR_LIBRARY_HYGIENE = { scan: scan, purge: purge, bindButton: bindButton };
})();