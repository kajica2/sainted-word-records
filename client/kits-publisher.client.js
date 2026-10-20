// client/kits-publisher.client.js — Browser-side kit publisher.
//
// Lets the engine user select assets from their library + audio + their
// current project JSON, POST the manifest to /api/kits, then GET the
// kit's zip. The download URL is a signed Vercel Blob URL.
//
// window.SWR_KITS_PUBLISHER = {
//   list()   -> Promise<{items: [...]}>
//   publish({ name, items }) -> Promise<{meta, ...}>
//   fetch(kitId, { refresh? }) -> Promise<{kit, url?}>
//   remove(kitId) -> Promise<{ok}>
// }
//
// `items` are of shape:
//   { kind: 'audio|image|video|project',
//     name: 'song.mp3',
//     storageKey: 'u123/songs/song.mp3',  // OR
//     inlineBase64: '...'                 // (only kind==='project')
//     size?: number }

(() => {
  'use strict';
  if (window.SWR_KITS_PUBLISHER) return;

  async function authedFetch(url, opts = {}) {
    const o = Object.assign({
      credentials: 'same-origin',
      headers: Object.assign({ 'Accept': 'application/json' }, opts.headers || {}),
    }, opts);
    const r = await fetch(url, o);
    if (!r.ok) {
      let msg = r.statusText;
      try { const j = await r.json(); msg = j.error || JSON.stringify(j); } catch (_) {}
      throw new Error('HTTP ' + r.status + ' — ' + msg);
    }
    return r.json();
  }

  async function list() {
    return authedFetch('/api/kits', { method: 'GET' });
  }

  async function publish({ name, items }) {
    return authedFetch('/api/kits', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, items }),
    });
  }

  async function fetchKit(kitId, opts = {}) {
    const qs = opts.refresh ? '?refresh=1' : '';
    return authedFetch('/api/kits/' + encodeURIComponent(kitId) + qs, { method: 'GET' });
  }

  async function remove(kitId) {
    return authedFetch('/api/kits/' + encodeURIComponent(kitId), { method: 'DELETE' });
  }

  // Pull together a kit manifest from the current engine state:
  //   - all library items with a storageKey
  //   - the current audio (if present)
  //   - the current project JSON
  // The library + audio derive storage keys from the engine's own key
  // helpers; project JSON is small enough to inline as base64.
  async function snapshotFromEngine({ name, embedProject = true } = {}) {
    const items = [];
    // Library items — pull straight from window.Library if present
    try {
      const Lib = (window.Library && Array.isArray(window.Library.items)) ? window.Library.items : [];
      const userId = (window.SWR && window.SWR.user && window.SWR.user.id) || null;
      for (const it of Lib) {
        if (!it || !it.url) continue;
        const kind = it.type === 'video' ? 'video'
                   : it.type === 'image' ? 'image'
                   : null;
        if (!kind) continue;
        // engine stores library blobs under /api/storage/object/<key>
        // — use the userId prefix when present (the storage helper
        // handles the rest). Public/CDN URLs go in verbatim.
        const path = it.storageKey || (userId ? `${userId}/library/${it.id}` : `library/${it.id}`);
        items.push({ kind, name: it.name || kind + '-' + it.id, storageKey: path });
      }
    } catch (_) {}
    // Audio (only if the engine exposes one with a known key)
    try {
      const Audio = window.Audio;
      if (Audio && Audio.file && Audio.file.name) {
        const userId = (window.SWR && window.SWR.user && window.SWR.user.id) || null;
        const path = userId ? `${userId}/audio/${Audio.file.name}` : `audio/${Audio.file.name}`;
        items.push({ kind: 'audio', name: Audio.file.name, storageKey: path });
      }
    } catch (_) {}
    // Project JSON — small enough to inline. The current project state is
    // mirrored on window.Layers + window.Audio + window.FX when the engine
    // exposes a snapshot helper. Here we read the same shape project.js
    // ships at /api/projects/<id>.
    if (embedProject) {
      try {
        let snap = null;
        if (window.SWR_PROJECT && typeof window.SWR_PROJECT.snapshot === 'function') {
          snap = window.SWR_PROJECT.snapshot();
        } else if (window.Layers && Array.isArray(window.Layers.list)) {
          // Fallback: hand-composed snapshot from Layers + state
          const proj = { name: name || 'untitled', doc: {} };
          proj.doc.layers = window.Layers.list.map((l) => ({
            id: l.id, blend: l.blend, opacity: l.opacity,
            baseScale: l.baseScale, hue: l.hue, brightness: l.brightness,
            contrast: l.contrast, pos: l.pos, rotOffset: l.rotOffset,
            rotationEnabled: l.rotationEnabled, snapBeat: l.snapBeat,
            reactors: l.reactors, algo: l.algo, algoIntensity: l.algoIntensity,
          }));
          if (window.FX && window.FX.state) proj.doc.fx = window.FX.state;
          snap = proj;
        }
        if (snap) {
          const json = JSON.stringify({ kind: 'project', name: name || 'untitled', snap: snap.doc || snap });
          const b64 = typeof btoa === 'function' ? btoa(unescape(encodeURIComponent(json))) : Buffer.from(json, 'utf8').toString('base64');
          items.push({ kind: 'project', name: (name || 'mix') + '.swr-project', inlineBase64: b64 });
        }
      } catch (_) {}
    }
    return { items, name: name || ('kit-' + new Date().toISOString().slice(0, 10)) };
  }

  window.SWR_KITS_PUBLISHER = {
    list, publish, fetch: fetchKit, remove,
    snapshotFromEngine,
  };
})();
