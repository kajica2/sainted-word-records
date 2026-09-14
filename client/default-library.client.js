// client/default-library.client.js — always-load the SWR default library
//
// Seeds the engine's Library + Audio with the curated default set shipped
// in /default-library/ (7 hologram/glitch texture WebP images) and
// /audios/endless-tomorrow.mp3. Loaded by engine.html via a defer'd script;
// it polls for window.Library (same pattern persist-wire uses) because the
// engine's module graph installs Library asynchronously.
//
// Idempotent: the engine's Library dedupes by name+size, and we also skip
// items already present. Re-visits that restored the same assets from IDB
// add nothing. Audio is only loaded when no song is currently set.
//
// Failure posture: any network error just logs a warn — the engine works
// normally without the defaults (users bring their own assets too).

(function () {
  'use strict';
  if (window.SWR_DEFAULT_LIBRARY) return;

  const MANIFEST_URL = '/default-library/manifest.json';

  function fileNameFromUrl(u) {
    try { return decodeURIComponent(new URL(u, location.origin).pathname.split('/').pop()); }
    catch (_) { return String(u).split('/').pop(); }
  }

  async function fetchFile(url, type) {
    const r = await fetch(url);
    if (!r.ok) throw new Error(`${url} → HTTP ${r.status}`);
    const blob = await r.blob();
    return new File([blob], fileNameFromUrl(url), { type: type || blob.type || 'application/octet-stream' });
  }

  async function seed() {
    let m;
    try {
      const r = await fetch(MANIFEST_URL);
      if (!r.ok) { console.warn('[default-library] manifest missing (' + r.status + ')'); return; }
      m = await r.json();
    } catch (e) { console.warn('[default-library] manifest fetch failed:', e.message); return; }

    const wanted = (m.images || []).concat(m.audio || [])
      .map((u) => ({ url: u, name: fileNameFromUrl(u) }));
    if (!wanted.length) return;

    // Poll until the engine's Library exists (module init ordering), max ~10s.
    let tries = 0;
    while ((!window.Library || !window.Library.addFiles) && tries < 50) {
      await new Promise((res) => setTimeout(res, 200));
      tries++;
    }
    if (!window.Library || !window.Library.addFiles) {
      console.warn('[default-library] Library not available; skipping seed');
      return;
    }

    const have = new Set((window.Library.items || []).map((it) => it.name));
    const missing = wanted.filter((w) => !have.has(w.name));
    if (!missing.length) {
      // Images already present — still make sure the default song is loaded.
      await ensureSong(m.audio || []);
      return;
    }

    const files = [];
    for (const w of missing) {
      try {
        const isAudio = /\.(mp3|wav|ogg|flac|m4a)$/i.test(w.name);
        files.push(await fetchFile(w.url, isAudio ? 'audio/mpeg' : 'image/webp'));
      } catch (e) { console.warn('[default-library] skip', w.url, e.message); }
    }
    if (files.length) {
      try {
        await window.Library.addFiles(files);
        console.info('[default-library] seeded', files.length, 'assets');
      } catch (e) { console.warn('[default-library] addFiles failed:', e.message); }
    }
    await ensureSong(m.audio || []);
  }

  // Load (not play — autoplay needs a gesture) the default song when the
  // transport has no song yet. The engine restores a user's saved song from
  // IDB asynchronously at boot, so poll briefly for either signal first:
  // an element already wired, or a 'current' row in the songs store.
  async function ensureSong(audioUrls) {
    if (!audioUrls.length) return;
    const A = window.Audio;
    if (!A || typeof A.loadFile !== 'function') return;
    for (let i = 0; i < 30; i++) {
      const cur = A.audioEl;
      if (cur && cur.getAttribute('src')) return;          // engine wired a song
      try {
        if (window.Library && window.Library.db) {
          const saved = await window.Library.db.get('songs', 'current');
          if (saved) return;                               // user has a saved song
        }
      } catch (_) {}
      if (window.Library && window.Library.db) break;      // db ready, nothing saved
      await new Promise((res) => setTimeout(res, 200));
    }
    try {
      const f = await fetchFile(audioUrls[0], 'audio/mpeg');
      A.loadFile(f);
      console.info('[default-library] song loaded:', f.name);
    } catch (e) { console.warn('[default-library] song load failed:', e.message); }
  }

  window.SWR_DEFAULT_LIBRARY = { seed };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => { seed(); }, { once: true });
  } else {
    seed();
  }
})();