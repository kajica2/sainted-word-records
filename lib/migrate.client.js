// lib/migrate.client.js — first-login IndexedDB-to-cloud migration.
//
// On first sign-in (or whenever the user re-opens after dismissing the
// banner), scan IndexedDB for projects and offer to upload them. We do
// NOT auto-upload: an explicit consent banner is required.

(function () {
  if (window.SWR_MIGRATE) return;

  const ASK_KEY = 'swrc-migrate-asked-at';
  const ASK_INTERVAL_MS = 30 * 24 * 60 * 60 * 1000;

  async function openLibrary() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open('swr-library', 1); // Will be created if missing.
      req.onerror = () => reject(req.error);
      req.onsuccess = () => resolve(req.result);
      req.onupgradeneeded = () => {
        // Don't create the db; if it doesn't exist, treat as empty.
        req.transaction.abort();
        resolve({ __empty: true });
      };
    });
  }

  async function listIndexedDBProjects() {
    try {
      const db = await openLibrary();
      if (!db || db.__empty) return [];
      // We don't know what object stores the engine creates. Try common
      // names used by project.js / brandkit.client.js.
      const stores = Array.from(db.objectStoreNames || []);
      const hits = [];
      for (const name of stores) {
        // Heuristic: store entries that look like project docs have a
        // `name` + `library` + `layers` shape (project.js v2).
        await new Promise((resolve) => {
          try {
            const tx = db.transaction(name, 'readonly');
            const cursor = tx.objectStore(name).openCursor();
            cursor.onsuccess = (e) => {
              const cur = e.target.result;
              if (!cur) return resolve();
              const v = cur.value;
              if (v && typeof v === 'object' && v.layers && v.fx && v.library) {
                hits.push({ store: name, key: cur.key, value: v });
              }
              cur.continue();
            };
            cursor.onerror = () => resolve();
          } catch { resolve(); }
        });
      }
      return hits;
    } catch {
      return [];
    }
  }

  function shouldAsk() {
    try {
      const last = parseInt(localStorage.getItem(ASK_KEY) || '0', 10);
      if (!last) return true;
      return Date.now() - last > ASK_INTERVAL_MS;
    } catch { return true; }
  }

  function rememberAsk() {
    try { localStorage.setItem(ASK_KEY, String(Date.now())); } catch {}
  }

  async function migrateOne(local) {
    const doc = local.value;
    // Upload the audio blob if present
    if (doc.audio && doc.audio.dataUrl) {
      try {
        const res = await fetch(doc.audio.dataUrl);
        const blob = await res.blob();
        const file = new File([blob], doc.audio.name || 'song', { type: doc.audio.type || blob.type || 'audio/mpeg' });
        const up = await window.SWR_STORAGE.uploadFile(file, 'songs');
        doc.audio = { name: file.name, type: file.type, key: up.key, size: up.size };
      } catch (e) {
        console.warn('[migrate] audio upload failed; uploading project without audio:', e);
        delete doc.audio;
      }
    }
    doc.migratedFromLocalAt = new Date().toISOString();
    return window.SWR_STORAGE.saveProject(doc);
  }

  async function maybeOfferMigration({ force = false } = {}) {
    if (!window.SWR_AUTH || !window.SWR_STORAGE) return { offered: false };
    const user = await window.SWR_AUTH.session({ force: true });
    if (!user) return { offered: false, reason: 'not_signed_in' };
    if (!force && !shouldAsk()) return { offered: false, reason: 'asked_recently' };

    const locals = await listIndexedDBProjects();
    if (!locals.length) {
      rememberAsk();
      return { offered: false, reason: 'no_local_projects', count: 0 };
    }

    const cloud = await window.SWR_STORAGE.listProjects();
    if (cloud.length && !force) {
      // Already have cloud projects; only ask if there are MORE local
      // than cloud (cheap heuristic; users with 0 cloud projects always
      // see the banner).
      rememberAsk();
      return { offered: false, reason: 'already_has_cloud', cloudCount: cloud.length, localCount: locals.length };
    }

    return { offered: true, locals, cloud };
  }

  async function runMigration({ onProgress } = {}) {
    const r = await maybeOfferMigration({ force: true });
    if (!r.offered) return r;
    let done = 0;
    const total = r.locals.length;
    for (const local of r.locals) {
      try {
        await migrateOne(local);
      } catch (e) {
        console.warn('[migrate] failed for', local.key, e);
      }
      done += 1;
      onProgress && onProgress({ done, total });
    }
    rememberAsk();
    return { migrated: done, total };
  }

  window.SWR_MIGRATE = {
    listIndexedDBProjects,
    maybeOfferMigration,
    runMigration,
    shouldAsk,
    rememberAsk,
  };
})();
