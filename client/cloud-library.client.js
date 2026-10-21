// client/cloud-library.client.js — Firestore-backed user library API.
//
// Phase 1 scaffold. Exposes a thin client over the future
// /api/library/* endpoints; the FAB + menu (cloud-library-fab.client.js)
// talks to this module so the UI never needs to know the HTTP shape.
//
// Status shape (always observable via .status()):
//   {
//     state: 'idle'|'pushing'|'pulling'|'error'|'disabled',
//     lastSyncAt: '2026-10-20T07:00:00.000Z' | null,
//     count: 47,
//     sizeBytes: 327155712,
//     error: null | { message, code },
//     watching: false,
//   }
//
// Module emits 'swr-cloud-library' CustomEvent after each status change
// so the debug overlay (and any future UI) can react.

(() => {
  'use strict';
  if (window.SWR_CLOUD_LIBRARY) return;

  // ---- status singleton ------------------------------------------------

  const subscribers = new Set();
  let state = {
    state: 'idle',
    lastSyncAt: null,
    count: 0,
    sizeBytes: 0,
    error: null,
    watching: false,
  };

  function loadWatch() {
    try {
      const v = localStorage.getItem('swr.cloud.watch');
      state.watching = v === '1';
    } catch (_) {}
  }
  function saveWatch() {
    try { localStorage.setItem('swr.cloud.watch', state.watching ? '1' : '0'); } catch (_) {}
  }
  loadWatch();

  function emit(prev) {
    for (const fn of subscribers) {
      try { fn(state, prev); } catch (_) {}
    }
    try {
      window.dispatchEvent(new CustomEvent('swr-cloud-library', {
        detail: Object.assign({}, state)
      }));
    } catch (_) {}
  }
  function set(patch) {
    const prev = state;
    state = Object.assign({}, state, patch);
    emit(prev);
  }

  // ---- auth-aware fetch -------------------------------------------------

  async function authedFetch(url, opts) {
    opts = opts || {};
    const o = Object.assign({
      credentials: 'same-origin',
      headers: Object.assign({ 'Accept': 'application/json' }, opts.headers || {})
    }, opts);
    const r = await fetch(url, o);
    const text = await r.text();
    let json = {};
    try { json = text ? JSON.parse(text) : {}; } catch (_) {}
    if (!r.ok) {
      const err = new Error(json && json.error || ('HTTP ' + r.status));
      err.code = json && json.code || ('http_' + r.status);
      err.status = r.status;
      throw err;
    }
    return json;
  }

  // ---- public API ------------------------------------------------------

  async function manifest() {
    // GET manifest — counts + lastSyncAt without enumerating every asset.
    // Cheap enough to poll every ~30s on the FAB.
    const r = await authedFetch('/api/library', { method: 'GET' });
    if (r && r.manifest) {
      set({
        count: r.manifest.count || 0,
        sizeBytes: r.manifest.sizeBytes || 0,
        lastSyncAt: r.manifest.lastSyncAt || state.lastSyncAt,
        state: state.state === 'error' ? state.state : 'idle',
        error: null,
      });
    }
    return r;
  }

  // push: read local Library.items; upload metadata + (separately) the
  // blobs via signed-upload URLs. Phase 2 will wire the per-blob signed
  // upload; for now we POST the manifest+items JSON and let the server
  // decode + persist.
  async function push(localItems, opts) {
    opts = opts || {};
    set({ state: 'pushing', error: null });
    try {
      const items = Array.isArray(localItems) ? localItems.map(serializeItem) : [];
      const r = await authedFetch('/api/library', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items }),
      });
      if (opts.onProgress) opts.onProgress({ stage: 'done', uploaded: items.length });
      set({
        state: 'idle',
        lastSyncAt: new Date().toISOString(),
        count: r && r.count != null ? r.count : items.length,
        error: null,
      });
      return r;
    } catch (e) {
      set({ state: 'error', error: { message: e.message, code: e.code } });
      throw e;
    }
  }

  // pull: GET the cloud manifest, then fetch each missing asset by id.
  // Phase 2 will iterate signed-download URLs. For now we GET the
  // manifest and update the local status badge accordingly.
  async function pull(opts) {
    opts = opts || {};
    set({ state: 'pulling', error: null });
    try {
      const r = await authedFetch('/api/library', { method: 'GET' });
      if (opts.onProgress && r && r.manifest) {
        opts.onProgress({ stage: 'manifest', total: r.manifest.count || 0 });
      }
      set({
        state: 'idle',
        lastSyncAt: new Date().toISOString(),
        count: r && r.manifest && r.manifest.count || state.count,
        sizeBytes: r && r.manifest && r.manifest.sizeBytes || state.sizeBytes,
        error: null,
      });
      return r;
    } catch (e) {
      set({ state: 'error', error: { message: e.message, code: e.code } });
      throw e;
    }
  }

  async function sync() {
    try {
      // The push endpoint is expected to run a sync (compare local +
      // cloud, write back merged) under the POST contract. Phase 1 ships
      // a placeholder that reuses push(); Phase 2 swaps the URL for
      // /api/library/sync.
      await push(currentLocalItems());
      await pull();
    } catch (e) {
      // Already captured by set(); rethrow for the caller.
      throw e;
    }
  }

  async function listCloud() {
    const r = await authedFetch('/api/library', { method: 'GET' });
    return r && r.manifest ? r.manifest : null;
  }

  function setWatch(on) {
    set({ watching: !!on });
    saveWatch();
  }
  function isWatching() { return !!state.watching; }

  function currentLocalItems() {
    const Lib = (window.Library && Array.isArray(window.Library.items)) ? window.Library.items : [];
    return Lib.slice();
  }

  // Local copy of the items array — url is a blob: URL which doesn't
  // serialize. We strip it; the server uses cloudBlobPath or the
  // rendered thumbDataUrl to identify the asset.
  function serializeItem(item) {
    if (!item) return null;
    return {
      id: item.id,
      name: item.name,
      type: item.type,
      w: item.w || 0, h: item.h || 0,
      duration: item.duration || 0,
      size: item.size || 0,
      thumb: typeof item.thumb === 'string' && item.thumb.startsWith('data:')
        ? item.thumb
        : null,
      cloudBlobPath: item.cloudBlobPath || null,
      updatedAt: item.updatedAt || new Date().toISOString(),
      source: item.source || 'browser',
    };
  }

  function getStatus() {
    return Object.assign({}, state);
  }
  function subscribe(fn) {
    subscribers.add(fn);
    return () => subscribers.delete(fn);
  }

  window.SWR_CLOUD_LIBRARY = {
    manifest, push, pull, sync, listCloud,
    setWatch, isWatching,
    getStatus, subscribe,
    aliases: ['library', 'songs'], // mirrors api/_lib/reset-state aliases
    serializeItem,
  };
})();
