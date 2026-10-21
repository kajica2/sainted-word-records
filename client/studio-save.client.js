// client/studio-save.client.js / save / restore / share presets +
// bundle the library as a .swr-set zip.
//
// Presets are JSON snapshots of the current layer + filter state,
// keyed by name. They persist in localStorage under
// `swr.presets.v1`. The same shape is reusable: import a preset to
// restore state, export a preset to share with another device.
//
// Libraries are bundled via the existing kits endpoint
// (api/kits/index.js, /api/kits/[id].js). The server is the local-FS
// path; Firestore kicks in automatically when SWR_PROJECTS_STORE=firestore.

(function () {
  'use strict';
  if (window.SWR_STUDIO_SAVE) return;
  const PRESETS_KEY = 'swr.presets.v1';

  function loadPresets() {
    try {
      const raw = JSON.parse(localStorage.getItem(PRESETS_KEY) || '{}');
      const out = {};
      if (raw && typeof raw === 'object') {
        for (const k of Object.keys(raw)) {
          if (raw[k] && typeof raw[k] === 'object') out[k] = raw[k];
        }
      }
      return out;
    } catch (_) { return {}; }
  }
  function savePresets(presets) {
    try { localStorage.setItem(PRESETS_KEY, JSON.stringify(presets)); } catch (_) {}
  }

  // ---- snapshot ----
  // Captures the live engine state. The engine exposes its pieces
  // through globals: window.Layers, window.Audio, window.FX, and
  // the cycler for the active filter.
  function snapshot(name) {
    const L = window.Layers;
    const A = window.Audio;
    const cyc = (window.SWR_LOOK_FILTER_CYCLER && window.SWR_LOOK_FILTER_CYCLER.get)
      ? window.SWR_LOOK_FILTER_CYCLER.get() : {};
    // The song-video layer (lib/song-video-layer.client.js) holds the song's
    // live <video> element — it cannot be restored from a snapshot, and the
    // song's own restore path re-adds it. Saving it would restore a ghost
    // layer with a missing-asset stub.
    const layers = (L && Array.isArray(L.list)) ? L.list
      .filter(function (l) { return !(l.asset && l.asset.songBound); })
      .map(function (l) {
        return {
          id: l.id,
          assetId: l.asset ? (l.asset.id || null) : null,
          blend: l.blend,
          opacity: l.opacity,
          baseScale: l.baseScale,
          hue: l.hue,
          brightness: l.brightness,
          contrast: l.contrast,
          pos: l.pos,
          rotOffset: l.rotOffset || 0,
          rotationEnabled: l.rotationEnabled !== false,
          z: l.z,
          algo: l.algo || 'none',
          algoIntensity: l.algoIntensity || 0,
        };
      }) : [];
    return {
      schema: 'swr-preset/v1',
      name: String(name || 'Untitled'),
      savedAt: new Date().toISOString(),
      audio: A ? { file: A.file ? (A.file.name || null) : null } : null,
      filter: {
        slot: cyc.slot || 0,
        intensity: typeof cyc.intensity === 'number' ? cyc.intensity : 0,
        step: cyc.step || 0,
      },
      layers: layers,
    };
  }
  function restore(preset) {
    if (!preset || preset.schema !== 'swr-preset/v1') return false;
    if (!window.Layers) return false;
    // Clear existing layers then rebuild from snapshot
    const L = window.Layers;
    while (L.list && L.list.length) L.remove(L.list[L.list.length - 1].id);
    // Best-effort library resolve: look up asset by saved assetId.
    const Lib = window.Library;
    const libItems = (Lib && Array.isArray(Lib.items)) ? Lib.items : [];
    for (const snap of preset.layers) {
      let asset = null;
      if (snap.assetId) asset = libItems.find(function (i) { return i && i.id === snap.assetId; });
      if (!asset && snap.assetId) {
        // The asset isn't loaded locally. The layer still spawns with a
        // minimal stub so the layer's transform survives.
        asset = { id: snap.assetId, name: snap.assetId, type: 'image', _missing: true };
      }
      if (asset && typeof L.add === 'function') {
        const l = L.add(asset);
        if (l) {
          // Restore the rest of the field
          if (snap.blend)        l.blend        = snap.blend;
          if (typeof snap.opacity   === 'number') l.opacity   = snap.opacity;
          if (typeof snap.baseScale === 'number') l.baseScale = snap.baseScale;
          if (typeof snap.hue       === 'number') l.hue       = snap.hue;
          if (typeof snap.brightness === 'number') l.brightness = snap.brightness;
          if (typeof snap.contrast   === 'number') l.contrast   = snap.contrast;
          if (snap.pos) l.pos = Object.assign({ x: 0, y: 0, rot: 0 }, snap.pos);
          if (typeof snap.rotOffset === 'number') l.rotOffset = snap.rotOffset;
          l.rotationEnabled = snap.rotationEnabled !== false;
          if (typeof snap.z === 'number') l.z = snap.z;
          if (snap.algo) l.algo = snap.algo;
          if (typeof snap.algoIntensity === 'number') l.algoIntensity = snap.algoIntensity;
        }
      }
    }
    // Filter
    if (preset.filter && window.SWR_LOOK_FILTER_CYCLER) {
      const slot = preset.filter.slot || 0;
      if (slot > 0) window.SWR_LOOK_FILTER_CYCLER.apply(slot);
    }
    return true;
  }

  function save(name) {
    const presets = loadPresets();
    const key = (name || 'Untitled').trim().slice(0, 80);
    if (!key) return null;
    const data = snapshot(key);
    presets[key] = data;
    savePresets(presets);
    return data;
  }
  function remove(name) {
    const presets = loadPresets();
    if (presets[name]) {
      delete presets[name];
      savePresets(presets);
      return true;
    }
    return false;
  }
  function list() {
    return Object.values(loadPresets()).sort(function (a, b) {
      return (a.savedAt < b.savedAt) ? 1 : -1;
    });
  }
  function exportJson(name) {
    const presets = loadPresets();
    return presets[name] || null;
  }
  function importJson(data) {
    if (!data || data.schema !== 'swr-preset/v1') return false;
    const presets = loadPresets();
    presets[data.name || 'Imported'] = data;
    savePresets(presets);
    return true;
  }

  // ---- Library bundle (kits API) ----
  async function saveLibrary(name, opts) {
    opts = opts || {};
    const Lib = window.Library;
    const items = (Lib && Array.isArray(Lib.items)) ? Lib.items : [];
    const A = window.Audio;
    const preset = (opts.attachPresetName && list().find(function (p) { return p.name === opts.attachPresetName; })) || null;
    const payload = {
      name: name || ('Studio ' + new Date().toISOString().slice(0, 10)),
      items: items.map(function (i) {
        return {
          id: i.id, name: i.name, type: i.type,
          w: i.w || 0, h: i.h || 0, duration: i.duration || 0,
          size: i.size || 0, thumb: i.thumb || null,
          source: i.source || 'browser',
          updatedAt: new Date().toISOString(),
        };
      }),
      preset: preset ? preset : null,
    };
    let r;
    try {
      r = await fetch('/api/kits', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
        body: JSON.stringify(payload),
      });
    } catch (e) {
      return { ok: false, error: 'network: ' + (e && e.message || e) };
    }
    if (!r.ok) {
      let err = 'http_' + r.status;
      try { const j = await r.json(); if (j && j.error) err = j.error; } catch (_) {}
      return { ok: false, error: err };
    }
    let data;
    try { data = await r.json(); } catch (_) { data = null; }
    if (!data || !data.meta) return { ok: false, error: 'bad_response' };
    // Optionally fetch a signed download URL
    let url = null;
    if (opts.includeUrl) {
      try {
        const rr = await fetch('/api/kits/' + encodeURIComponent(data.meta.id), {
          method: 'GET', credentials: 'same-origin',
        });
        if (rr.ok) {
          const j = await rr.json();
          url = (j && j.url) || null;
        }
      } catch (_) {}
    }
    return { ok: true, id: data.meta.id, count: data.meta.count, url: url };
  }

  // ---- public surface ----
  window.SWR_STUDIO_SAVE = {
    snapshot, restore, save, remove, list, exportJson, importJson,
    saveLibrary,
    clearAll: function () {
      try { localStorage.removeItem(PRESETS_KEY); } catch (_) {}
    },
  };
})();
