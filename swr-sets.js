// swr-sets.js — .swr-set import/export
//
// A .swr-set is a JSON document that captures a complete engine state:
// which engine, FX chain, layer arrangement, audio, and metadata. Files
// can be shared, dropped onto the marketplace page to install, or
// dropped onto engine.html to restore a previous state.
//
// SCHEMA (v1):
// {
//   "schemaVersion": 1,
//   "id": "<uuid>",
//   "name": "Synthwave Sunset",
//   "author": "Kai",
//   "description": "...",
//   "tags": ["synthwave", "neon", "80s"],
//   "createdAt": "<iso8601>",
//   "engine": "neon",         // one of the 16 version pages
//   "audio": {
//     "name": "loop-demo.wav",
//     "mimeType": "audio/wav",
//     "size": 794000,
//     // EXACTLY ONE of:
//     "dataUrl": "data:audio/wav;base64,UklGRi...",  // embedded
//     "url": "library/audio/loop-demo.wav",            // external
//   },
//   "fx": {                  // fx-postprocess state
//     "temp": 0.3, "glow": 0.85, "vignette": 0.5, "chroma": 0.2,
//     "grain": 0.15, "sepia": 0.1, "blur": 0.05, "posterize": 0,
//     "grayscale": 0, "mut": 0, "mutAlgo": 0, "liquid": 0, "pearl": 0, "glitch": 0
//   },
//   "layers": [
//     {
//       "id": "L1",
//       "name": "Hero",
//       "blend": "source-over",
//       "opacity": 1,
//       "baseScale": 1.0,
//       "hue": 0, "brightness": 1, "contrast": 1,
//       "pos": { "x": 0, "y": 0, "rot": 0 },
//       "rotOffset": 0,
//       "reactors": [...],   // see engine-timeline
//       "modulators": [...],  // see engine-lfos
//       "asset": {
//         "name": "p01.jpg",
//         "mimeType": "image/jpeg",
//         "size": 102400,
//         "dataUrl": "data:image/jpeg;base64,..."  // embedded
//         // OR:
//         "url": "library/p01.jpg"
//       }
//     }
//   ],
//   "settings": {
//     "bpm": 120,
//     "key": "C",
//     "scale": "major"
//   }
// }
//
// USAGE:
//   import * as Sets from './swr-sets.js';
//   const setJson = await Sets.export({ engine, audio, layers, fx, settings, name, author });
//   // ... setJson is a JSON-serializable object
//   const blob = new Blob([JSON.stringify(setJson, null, 2)], { type: 'application/json' });
//   // ... user saves blob as "My Set.swr-set"
//
//   const file = event.target.files[0];
//   const parsed = await Sets.import(file);
//   // ... parsed contains { engine, audio, layers, fx, settings, meta }

(function () {
  if (window.SWR_SETS) return; // idempotent

  // === UUID (no crypto.randomUUID dependency for older browsers) ===
  function uuid() {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
      const r = (Math.random() * 16) | 0;
      const v = c === 'x' ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  }

  // === Blob/File → base64 data URL ===
  function blobToDataUrl(blob) {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result);
      r.onerror = () => reject(r.error);
      r.readAsDataURL(blob);
    });
  }

  // === Data URL → Blob ===
  function dataUrlToBlob(dataUrl) {
    const [meta, b64] = dataUrl.split(',');
    const mime = (meta.match(/data:([^;]+)/) || [, 'application/octet-stream'])[1];
    const bin = atob(b64);
    const arr = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    return new Blob([arr], { type: mime });
  }

  // === Capture current engine state ===
  // Engine state is the live `window.SWR` object. We read fields by name
  // and emit a .swr-set document.
  async function exportState(opts) {
    const meta = opts || {};
    const swr = window.SWR || {};
    const audio = swr.Audio;
    const layers = swr.Layers;
    const fx = window.FX && window.FX.state;
    const settings = swr.UI || {};

    // Pull current page's engine id from body[data-page]
    const engine = (document.body && document.body.dataset && document.body.dataset.page) || 'unknown';

    // Audio: prefer the raw <audio> element's src (which is a blob: URL
    // from the loaded file). Fetch it to embed as data URL.
    let audioDoc = null;
    if (audio && audio.el && audio.el.src) {
      try {
        const r = await fetch(audio.el.src);
        if (r.ok) {
          const blob = await r.blob();
          // Skip if too big (> 25 MB inline)
          if (blob.size < 25 * 1024 * 1024) {
            const dataUrl = await blobToDataUrl(blob);
            audioDoc = {
              name: meta.audioName || audio.el.src.split('/').pop() || 'song',
              mimeType: blob.type || 'audio/mpeg',
              size: blob.size,
              dataUrl: dataUrl,
            };
          } else {
            audioDoc = {
              name: meta.audioName || audio.el.src.split('/').pop() || 'song',
              mimeType: blob.type || 'audio/mpeg',
              size: blob.size,
              url: audio.el.src,  // external reference
              tooLarge: true,
            };
          }
        }
      } catch (e) {
        console.warn('swr-set export: audio fetch failed', e);
      }
    }

    // FX state
    const fxDoc = fx ? {
      temp: fx.temp || 0,
      glow: fx.glow || 0,
      vignette: fx.vignette || 0,
      chroma: fx.chroma || 0,
      grain: fx.grain || 0,
      sepia: fx.sepia || 0,
      blur: fx.blur || 0,
      posterize: fx.posterize || 0,
      grayscale: fx.grayscale || 0,
      mut: fx.mut || 0,
      mutAlgo: fx.mutAlgo || 0,
      liquid: fx.liquid || 0,
      pearl: fx.pearl || 0,
      glitch: fx.glitch || 0,
    } : null;

    // Layers — embed each asset as data URL
    const layerDocs = [];
    if (layers && layers.list) {
      for (const l of layers.list) {
        const asset = l.asset || {};
        let assetDoc = null;
        // The asset object may have a blob URL (asset.url) or be a real file
        const assetUrl = asset.url || (asset.blob ? URL.createObjectURL(asset.blob) : null);
        if (assetUrl) {
          try {
            const r = await fetch(assetUrl);
            if (r.ok) {
              const blob = await r.blob();
              if (blob.size < 25 * 1024 * 1024) {
                const dataUrl = await blobToDataUrl(blob);
                assetDoc = {
                  name: asset.name || 'asset',
                  mimeType: blob.type || 'application/octet-stream',
                  size: blob.size,
                  dataUrl: dataUrl,
                };
              } else {
                assetDoc = {
                  name: asset.name || 'asset',
                  mimeType: blob.type || 'application/octet-stream',
                  size: blob.size,
                  url: assetUrl,
                  tooLarge: true,
                };
              }
            }
          } catch (e) {
            console.warn('swr-set export: asset fetch failed', e);
          }
        }
        layerDocs.push({
          id: l.id,
          name: l.name || l.id,
          blend: l.blend,
          opacity: l.opacity,
          baseScale: l.baseScale,
          hue: l.hue,
          brightness: l.brightness,
          contrast: l.contrast,
          pos: l.pos ? { x: l.pos.x, y: l.pos.y, rot: l.pos.rot } : null,
          rotOffset: l.rotOffset,
          reactors: l.reactors || [],
          modulators: l.modulators || [],
          asset: assetDoc,
        });
      }
    }

    return {
      schemaVersion: 1,
      id: uuid(),
      name: meta.name || `Set ${new Date().toISOString().slice(0, 10)}`,
      author: meta.author || 'anonymous',
      description: meta.description || '',
      tags: meta.tags || [],
      createdAt: new Date().toISOString(),
      engine,
      audio: audioDoc,
      fx: fxDoc,
      layers: layerDocs,
      settings: {
        bpm: settings.bpm || null,
        key: settings.key || null,
        scale: settings.scale || null,
      },
    };
  }

  // === Restore engine state from a .swr-set document ===
  // Returns a promise resolving to a "set" object that callers (engine
  // or marketplace) can apply. The actual application is left to the
  // caller because engine.html and versions/*.html have different
  // initialization paths.
  async function importSet(fileOrJson) {
    let doc;
    if (typeof fileOrJson === 'string') {
      doc = JSON.parse(fileOrJson);
    } else if (fileOrJson instanceof Blob || fileOrJson instanceof File) {
      const text = await fileOrJson.text();
      doc = JSON.parse(text);
    } else {
      doc = fileOrJson;  // assume already-parsed object
    }

    if (doc.schemaVersion !== 1) {
      throw new Error(`Unsupported .swr-set schema version: ${doc.schemaVersion} (expected 1)`);
    }

    // Convert audio dataUrl back to File (so it can be loaded via the
    // standard song-input change event)
    let audioFile = null;
    if (doc.audio) {
      if (doc.audio.dataUrl) {
        const blob = dataUrlToBlob(doc.audio.dataUrl);
        audioFile = new File([blob], doc.audio.name, { type: doc.audio.mimeType || blob.type });
      } else if (doc.audio.url) {
        // External reference — try to fetch
        try {
          const r = await fetch(doc.audio.url);
          if (r.ok) {
            const blob = await r.blob();
            audioFile = new File([blob], doc.audio.name, { type: doc.audio.mimeType || blob.type });
          }
        } catch (e) {
          console.warn('swr-set import: external audio fetch failed', e);
        }
      }
    }

    // Convert layer assets
    const layers = [];
    for (const ld of (doc.layers || [])) {
      let assetFile = null;
      if (ld.asset) {
        if (ld.asset.dataUrl) {
          const blob = dataUrlToBlob(ld.asset.dataUrl);
          assetFile = new File([blob], ld.asset.name, { type: ld.asset.mimeType || blob.type });
        } else if (ld.asset.url) {
          try {
            const r = await fetch(ld.asset.url);
            if (r.ok) {
              const blob = await r.blob();
              assetFile = new File([blob], ld.asset.name, { type: ld.asset.mimeType || blob.type });
            }
          } catch (e) {
            console.warn('swr-set import: external asset fetch failed', e);
          }
        }
      }
      layers.push({
        id: ld.id,
        name: ld.name,
        blend: ld.blend,
        opacity: ld.opacity,
        baseScale: ld.baseScale,
        hue: ld.hue,
        brightness: ld.brightness,
        contrast: ld.contrast,
        pos: ld.pos,
        rotOffset: ld.rotOffset,
        reactors: ld.reactors,
        modulators: ld.modulators,
        asset: assetFile,
      });
    }

    return {
      meta: {
        id: doc.id,
        name: doc.name,
        author: doc.author,
        description: doc.description,
        tags: doc.tags,
        createdAt: doc.createdAt,
        engine: doc.engine,
        schemaVersion: doc.schemaVersion,
      },
      audio: audioFile,
      fx: doc.fx,
      layers,
      settings: doc.settings,
    };
  }

  // === Download a .swr-set document as a file ===
  function download(doc, filename) {
    const json = JSON.stringify(doc, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = (filename || (doc.name || 'set') + '.swr-set').replace(/\s+/g, '-');
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  }

  // === Save a .swr-set to IndexedDB (for "Installed Sets") ===
  async function saveInstalled(doc) {
    if (!window.Library || !window.Library.db) {
      throw new Error('Library.db not available; install via engine.html first');
    }
    const db = window.Library.db;
    return new Promise((resolve, reject) => {
      const tx = db.transaction('sets', 'readwrite');
      const store = tx.objectStore('sets');
      const req = store.put({
        id: doc.id,
        doc: doc,
        installedAt: Date.now(),
      });
      req.onsuccess = () => resolve(doc.id);
      req.onerror = () => reject(req.error);
    });
  }

  async function listInstalled() {
    if (!window.Library || !window.Library.db) return [];
    const db = window.Library.db;
    return new Promise((resolve, reject) => {
      const tx = db.transaction('sets', 'readonly');
      const req = tx.objectStore('sets').getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
  }

  async function removeInstalled(id) {
    if (!window.Library || !window.Library.db) return false;
    const db = window.Library.db;
    return new Promise((resolve, reject) => {
      const tx = db.transaction('sets', 'readwrite');
      const req = tx.objectStore('sets').delete(id);
      req.onsuccess = () => resolve(true);
      req.onerror = () => reject(req.error);
    });
  }

  // === Apply an imported set to the running engine ===
  // Sets FX state, restores audio (if engine is loaded), restores layers.
  // Engines that don't have all of these (e.g. minimal versions pages) just
  // apply what they can.
  async function applySet(set, opts) {
    opts = opts || {};
    const log = [];
    const ok = (msg) => { log.push({ ok: true, msg }); };
    const fail = (msg, e) => { log.push({ ok: false, msg, err: e && e.message }); };

    // 1. Apply FX state (works on every page that loads fx-postprocess.js)
    if (set.fx && window.FX && window.FX.setPersona) {
      try {
        window.FX.setPersona({
          temp:      set.fx.temp      || 0,
          mut:       set.fx.mut       || 0,
          mutAlgo:   set.fx.mutAlgo   || 0,
          posterize: set.fx.posterize || 0,
          vignette:  set.fx.vignette  || 0,
          chroma:    set.fx.chroma    || 0,
          grain:     set.fx.grain     || 0,
          sepia:     set.fx.sepia     || 0,
          glow:      set.fx.glow      || 0,
          grayscale: set.fx.grayscale || 0,
          blur:      set.fx.blur      || 0,
          liquid:    set.fx.liquid    || 0,
          pearl:     set.fx.pearl     || 0,
          glitch:    set.fx.glitch    || 0,
        });
        ok('FX state applied');
      } catch (e) { fail('FX state apply', e); }
    } else if (set.fx) {
      fail('FX state — fx-postprocess not loaded', null);
    }

    // 2. Load audio (works on engine.html + most versions pages)
    if (set.audio) {
      const swr = window.SWR || {};
      if (swr.Audio && typeof swr.Audio.loadFile === 'function') {
        try {
          swr.Audio.loadFile(set.audio);
          swr.Audio.play && swr.Audio.play();
          ok('Audio loaded');
        } catch (e) { fail('Audio load', e); }
      } else if (swr.Audio && typeof swr.Audio.load === 'function') {
        try {
          swr.Audio.load(set.audio);
          swr.Audio.play && swr.Audio.play();
          ok('Audio loaded');
        } catch (e) { fail('Audio load', e); }
      } else {
        fail('Audio — no Audio.load available on this page', null);
      }
    }

    // 3. Add layers (only on engine.html which has Library + Layers)
    if (set.layers && set.layers.length) {
      const lib = window.Library;
      const layers = window.Layers;
      if (lib && typeof lib.addFiles === 'function' && layers && Array.isArray(layers.list)) {
        try {
          const files = set.layers.filter(l => l.asset).map(l => l.asset);
          if (files.length) {
            const added = await lib.addFiles(files);
            // Map newly-added assets to our restored layer metadata
            // (addFiles may push them onto Library.items)
            for (let i = 0; i < set.layers.length; i++) {
              const ld = set.layers[i];
              if (!ld.asset) continue;
              // The new layer is the last in layers.list
              const newLayer = layers.list[layers.list.length - set.layers.length + i];
              if (newLayer) {
                if (ld.blend) newLayer.blend = ld.blend;
                if (typeof ld.opacity === 'number') newLayer.opacity = ld.opacity;
                if (typeof ld.baseScale === 'number') newLayer.baseScale = ld.baseScale;
                if (typeof ld.hue === 'number') newLayer.hue = ld.hue;
                if (typeof ld.brightness === 'number') newLayer.brightness = ld.brightness;
                if (typeof ld.contrast === 'number') newLayer.contrast = ld.contrast;
                if (ld.pos) newLayer.pos = ld.pos;
                if (typeof ld.rotOffset === 'number') newLayer.rotOffset = ld.rotOffset;
                if (Array.isArray(ld.reactors)) newLayer.reactors = ld.reactors;
                if (Array.isArray(ld.modulators)) newLayer.modulators = ld.modulators;
              }
            }
            layers.render && layers.render();
            ok(`Layers added: ${files.length}`);
          }
        } catch (e) { fail('Layers add', e); }
      } else {
        fail('Layers — engine.html Library/Layers not available on this page', null);
      }
    }

    return { log };
  }

  // === Public API ===
  window.SWR_SETS = {
    SCHEMA_VERSION: 1,
    uuid,
    blobToDataUrl,
    dataUrlToBlob,
    exportState,
    importSet,
    applySet,
    download,
    saveInstalled,
    listInstalled,
    removeInstalled,
  };
})();