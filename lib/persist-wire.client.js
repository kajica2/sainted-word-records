// lib/persist-wire.client.js — generic wire-up for versions/*.html pages
// that share the lib + layers UI surface. Auto-detects the pageId from
// <body data-page="..."> (each version page already sets this) and
// mounts the full persistence slice (library, engine state, presets,
// reset, export, RELINK flow).
//
// USAGE
//   <script src="../lib/persist.client.js"></script>
//   <script src="../lib/persist-wire.client.js"></script>
//
// Page expectations:
//   - window.SWR is set with at least { Library, Layers }
//   - DOM has #lib, #layers, #asset-input, #remap (optional),
//     #auto-cycle (optional), #sens, #gate, #decay (optional).
//   - body[data-page] is the canonical pageId.

(function () {
  'use strict';
  if (window.SWR_GRID_PERSIST_WIRED) return;
  window.SWR_GRID_PERSIST_WIRED = true;

  const P = window.SWR_GRID_PERSIST;
  if (!P) {
    console.warn('[persist-wire] requires window.SWR_GRID_PERSIST');
    return;
  }

  function pageId() {
    const m = (document.body && document.body.getAttribute('data-page')) || (location.pathname.split('/').pop().replace(/\.html$/, ''));
    return m || 'unknown';
  }

  const $ = id => document.getElementById(id);
  function setStatus(t, cls) {
    const p = $('status');
    if (!p) return;
    p.textContent = t;
    p.className = 'pill' + (cls ? ' ' + cls : '');
  }

  let SWR, Lib, Layers;

  function getSWR() {
    if (SWR) return SWR;
    SWR = window.SWR || {};
    Lib  = SWR.Library || (SWR.Audio && window.Lib) || null;
    Layers = SWR.Layers || null;
    return SWR;
  }

  // ---- toStored / fromStored -------------------------------------------

  function toStored(asset) {
    return {
      id: asset.id,
      name: asset.name,
      type: asset.type,
      tags: asset.tags || [],
      builtIn: !!asset.builtIn,
      needsRelink: !!asset.needsRelink,
      thumb: asset.thumb || null,
    };
  }

  // Curated library files served from ../library/ — matched by filename
  // pattern. Persisted entries whose name matches this set are treated as
  // built-in regardless of the stored `builtIn` flag. This recovers state
  // written before Lib.addFiles started tagging curated items as builtIn,
  // and shields against future code paths that forget to set the flag.
  const LIBRARY_FILE_RE = /^(persona\/)?[\w.-]+\.(jpe?g|png|gif|webp|mp4|webm|mov)$/i;

  function fromStored(s) {
    const type = s.type || 'image';
    const name = s.name || '';
    const id   = s.id;
    // Treat as built-in if explicitly flagged OR if the name looks like a
    // curated library file. Pre-fix saves wrote curated files with
    // builtIn:false, which `fromStored` then stubbed (url:null) — leaving
    // the canvas blank on reload.
    const looksBuiltIn = LIBRARY_FILE_RE.test(name) || (id && LIBRARY_FILE_RE.test(id));
    if (s.builtIn || looksBuiltIn) {
      // Old format: built-in items had filename-as-id (e.g. "persona/p26-neon-1.png").
      // Pre-fix persisted curated items with numeric ids but filename names;
      // resolve the URL from whichever side matches the library pattern.
      const pathSeg = (id && LIBRARY_FILE_RE.test(id)) ? id : name;
      const path = '../library/' + pathSeg;
      return {
        id, name, type,
        tags: s.tags || [],
        builtIn: true, needsRelink: false,
        url: path,
        blob: null,
        thumb: s.thumb || null,
        motion: 0, luma: 0.5, hue: 0, w: 0, h: 0, added: Date.now(),
      };
    }
    return {
      id, name, type,
      tags: s.tags || [],
      builtIn: false, needsRelink: true,
      url: null, blob: null,
      thumb: s.thumb || null,
      motion: 0, luma: 0.5, hue: 0, w: 0, h: 0, added: Date.now(),
    };
  }

  function saveLib() {
    if (!Lib || !Lib.items) return;
    // When SWR_LIB_PERSIST (the new IDB-based library persistence) is loaded,
    // defer to it: it owns library persistence end-to-end. persist-wire keeps
    // handling engine state (Layers, controls, presets) below, but it must
    // not write the library to localStorage — that would create a second
    // source of truth whose IDs collide with the IDB-hydrated items
    // (persist-wire's items have no persistId and would shadow the user
    // upload on the next reload via saveLib's id-dedup path).
    if (window.SWR_LIB_PERSIST) return;
    // Dedupe by id (page may have just re-fetched the manifest which
    // collides with our saved built-in records). Keep first occurrence.
    const seen = new Set();
    const deduped = [];
    for (const it of Lib.items) {
      const key = String(it.id);
      if (seen.has(key)) continue;
      seen.add(key);
      deduped.push(it);
    }
    if (deduped.length !== Lib.items.length) {
      Lib.items.length = 0;
      for (const it of deduped) Lib.items.push(it);
      if (typeof Lib.render === 'function') Lib.render();
    }
    P.saveLibrary(deduped.map(toStored));
  }

  function hydrateLib() {
    // Same rationale as saveLib above: when SWR_LIB_PERSIST is present, it
    // owns library hydration (reads from IDB on boot). If we also hydrate
    // from localStorage here, the items we push lack `curated` and would
    // later be tagged curated:true by the library-persist wrapper's
    // defaultTagUntagged — which then mis-classifies any user upload that
    // IDB hydrate pushes (it'd collide on `nextId` since persist-wire
    // never bumped it) and gets dropped by saveLib's id dedup.
    if (window.SWR_LIB_PERSIST) return;
    const stored = P.loadLibrary();
    if (!stored.length) return;
    if (!Lib || !Lib.items) return;
    Lib.items.length = 0;
    for (const s of stored) {
      Lib.items.push(fromStored(s));
    }
    if (typeof Lib.render === 'function') Lib.render();
  }

  // ---- engine state ----------------------------------------------------

  // Fallback reactor presets used when a persisted layer is missing its
  // `reactors` array (legacy snapshots written before reactors were saved,
  // or layers hand-edited in DevTools). Mirrors the default preset shape
  // used by versions/hallucination.html Layers.add/Layers.remap.
  const DEFAULT_REACTOR_PRESETS = [
    [ { feature: 'bass',     target: 'scale',     scale: 1.2, ease: 'sharp' },
      { feature: 'beat',     target: 'opacity',   scale: 1.0, ease: 'sharp' },
      { feature: 'centroid', target: 'hue',       scale: 360, ease: 'sharp' } ],
    [ { feature: 'mid',      target: 'hue',       scale: 720, ease: 'sharp' },
      { feature: 'rms',      target: 'scale',     scale: 0.8, ease: 'sharp' },
      { feature: 'onset',    target: 'x',         scale: 200, ease: 'sharp' } ],
    [ { feature: 'treble',   target: 'rot',       scale: 60,  ease: 'sharp' },
 { feature: 'air',      target: 'y',         scale: 200, ease: 'sharp' },
 { feature: 'onset',    target: 'scale',     scale: 0.5, ease: 'sharp' } ],
    [ { feature: 'rms',      target: 'scale',     scale: 1.0, ease: 'sharp' },
      { feature: 'onset',    target: 'brightness',scale: 1.0, ease: 'sharp' },
      { feature: 'beat',     target: 'hue',       scale: 180, ease: 'sharp' } ],
    [ { feature: 'centroid', target: 'hue',       scale: 720, ease: 'sharp' },
      { feature: 'treble',   target: 'scale',     scale: 0.8, ease: 'sharp' },
      { feature: 'bass',     target: 'x',         scale: 150, ease: 'sharp' } ],
    [ { feature: 'bass',     target: 'scale',     scale: 1.5, ease: 'sharp' },
      { feature: 'beat',     target: 'opacity',   scale: 1.2, ease: 'sharp' },
      { feature: 'mid',      target: 'rot',       scale: 60,  ease: 'sharp' } ],
  ];
  function defaultReactorsFor(layerIndex) {
    return DEFAULT_REACTOR_PRESETS[((layerIndex | 0) % DEFAULT_REACTOR_PRESETS.length + DEFAULT_REACTOR_PRESETS.length) % DEFAULT_REACTOR_PRESETS.length];
  }

  function saveEngineState() {
    if (!Layers) return;
    const PAGE_ID = pageId();
    const snapshot = {
      pageId: PAGE_ID,
      version: 1,
      savedAt: Date.now(),
      selectedLayerId: window.selectedLayerId || null,
      layers: (Layers.list || []).map(l => ({
        id: l.id,
        assetId: l.asset ? (l.asset.id || null) : null,
        blend: l.blend,
        opacity: l.opacity,
        baseScale: l.baseScale, contrast: l.contrast,
        brightness: l.brightness, alpha: l.alpha, mutate: l.mutate,
        hue: l.hue,
        cell: l.cell || null,
        // Per-clip transform state. Without pos, the audio loop crashes on
        // `l.pos.x = ...` (see engine.html loop()).
        pos: l.pos ? { x: l.pos.x, y: l.pos.y, rot: l.pos.rot || 0 } : { x: 0, y: 0, rot: 0 },
        rotOffset: Number.isFinite(l.rotOffset) ? l.rotOffset : 0,
        rotationEnabled: l.rotationEnabled !== false, // undefined = enabled
        snapBeat: !!l.snapBeat,
        reactors: Array.isArray(l.reactors) ? l.reactors : null,
      })),
      global: {
        sens:      $('sens')  ? parseFloat($('sens').value)  : undefined,
        gate:      $('gate')  ? parseFloat($('gate').value)  : undefined,
        decay:     $('decay') ? parseFloat($('decay').value) : undefined,
        autoCycle: $('auto-cycle') ? !!$('auto-cycle').checked : undefined,
        recDur:    $('rec-dur') ? $('rec-dur').value : undefined,
      },
      presets: window.__GRID_PRESETS__ || [],
    };
    // Strip undefined globals so pages without those controls still work.
    Object.keys(snapshot.global).forEach(k => snapshot.global[k] === undefined && delete snapshot.global[k]);
    P.saveEngineState(PAGE_ID, snapshot);
  }

  function loadEngineState() {
    if (!Layers) return;
    const PAGE_ID = pageId();
    const snap = P.loadEngineState(PAGE_ID);
    if (!snap || snap.version !== 1) return;
    window.selectedLayerId = snap.selectedLayerId || null;
    if (Array.isArray(snap.layers)) {
      Layers.list.length = 0;
      snap.layers.forEach((ls, idx) => {
        const a = ls.assetId
          ? ((Lib && Lib.items) ? Lib.items.find(x => x.id === ls.assetId) : null)
          : null;
        // Backwards compatibility: legacy snapshots (or hand-edited localStorage)
        // may omit `reactors`/`opacity`. Without these, the page's render() and
        // applyR() crash on `Cannot read properties of undefined (reading 'map')`
        // and `l.reactors is not iterable`. Default both to safe values.
        const reactors = Array.isArray(ls.reactors) && ls.reactors.length
          ? ls.reactors
          : defaultReactorsFor(idx);
        Layers.list.push({
          id: ls.id,
          asset: a,
          blend: ls.blend || 'source-over',
          opacity:     Number.isFinite(ls.opacity)    ? ls.opacity    : 0.85,
          baseScale:   Number.isFinite(ls.baseScale) ? ls.baseScale : 1,
          contrast:    Number.isFinite(ls.contrast)  ? ls.contrast  : 1,
          brightness:  Number.isFinite(ls.brightness)? ls.brightness: 1,
          alpha:       Number.isFinite(ls.alpha)     ? ls.alpha     : 1,
          mutate:      Number.isFinite(ls.mutate)    ? ls.mutate    : 0,
          hue:         Number.isFinite(ls.hue)       ? ls.hue       : 0,
          cell:        ls.cell || null,
          // Legacy snapshots may omit pos; default to origin. Without this,
          // engine.html's audio loop crashes on the first frame after load
          // (Cannot set properties of undefined (setting 'x')).
          pos: (ls.pos && Number.isFinite(ls.pos.x))
            ? { x: ls.pos.x, y: Number.isFinite(ls.pos.y) ? ls.pos.y : 0, rot: Number.isFinite(ls.pos.rot) ? ls.pos.rot : 0 }
            : { x: 0, y: 0, rot: 0 },
          rotOffset:        Number.isFinite(ls.rotOffset) ? ls.rotOffset : 0,
          rotationEnabled:  ls.rotationEnabled !== false, // undefined = enabled
          snapBeat:         !!ls.snapBeat,
          reactors,
        });
      });
    }
    if (snap.global) {
      if ($('sens')   && Number.isFinite(snap.global.sens))   { $('sens').value  = snap.global.sens;   $('sens-v')   && ($('sens-v').textContent  = snap.global.sens.toFixed(2));   }
      if ($('gate')   && Number.isFinite(snap.global.gate))   { $('gate').value  = snap.global.gate;   $('gate-v')   && ($('gate-v').textContent  = snap.global.gate.toFixed(2));   }
      if ($('decay')  && Number.isFinite(snap.global.decay))  { $('decay').value = snap.global.decay;  $('decay-v')  && ($('decay-v').textContent = snap.global.decay.toFixed(2));  }
      if ($('auto-cycle') && snap.global.autoCycle != null) $('auto-cycle').checked = !!snap.global.autoCycle;
      if ($('rec-dur') && snap.global.recDur != null) $('rec-dur').value = snap.global.recDur;
    }
    if (Array.isArray(snap.presets)) window.__GRID_PRESETS__ = snap.presets;
    if (typeof Layers.render === 'function') Layers.render();
  }

  let saveTimer = null;
  function scheduleSave() {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(saveEngineState, 250);
  }

  // ---- lib hooks -------------------------------------------------------

  function hookLib() {
    if (!Lib) return;
    if (!Lib.__persist_attached && typeof Lib.addFiles === 'function') {
      const orig = Lib.addFiles.bind(Lib);
      Lib.addFiles = async function (files, opts) {
        // opts must be forwarded: callers (e.g. library-loader.client.js for
        // curated manifest assets) pass { curated: true } to signal that the
        // items must NOT be persisted. Without this, every curated asset would
        // leak into IDB on every reload.
        await orig(files, opts);
        try { saveLib(); } catch (_) {}
      };
      Lib.__persist_attached = true;
    }
    if (!Lib.__persist_render_attached && typeof Lib.render === 'function') {
      const origRender = Lib.render.bind(Lib);
      Lib.render = function () {
        origRender();
        try { saveLib(); } catch (_) {}
        // Tag needsRelink items
        const lib = $('lib');
        if (lib) {
          Array.from(lib.children).forEach((el, i) => {
            const it = (this.items || [])[i];
            if (!it) return;
            if (it.needsRelink) {
              el.classList.add('is-offline');
              if (!el.querySelector('[data-relink]')) {
                const btn = document.createElement('button');
                btn.textContent = 'RELINK';
                btn.className = 'asset-relink';
                btn.type = 'button';
                btn.dataset.relink = it.id;
                btn.style.cssText = 'position:absolute;top:2px;right:2px;font-size:8px;padding:2px 4px;background:#ff2d8a;color:#fff;border-radius:2px;border:none;cursor:pointer;z-index:2;';
                el.style.position = el.style.position || 'relative';
                el.appendChild(btn);
              }
            }
          });
        }
      };
      Lib.__persist_render_attached = true;
    }
  }

  function wireDelete() {
    const lib = $('lib'); if (!lib) return;
    lib.addEventListener('click', (ev) => {
      const del = ev.target.closest('[data-delete]');
      if (!del) return;
      const id = del.dataset.delete;
      const item = (Lib.items || []).find(a => a.id === id);
      if (!item) return;
      if (item.builtIn) { setStatus('Built-in media cannot be deleted.', 'err'); return; }
      if (item.url && item.url.startsWith('blob:')) URL.revokeObjectURL(item.url);
      Lib.items = Lib.items.filter(a => a.id !== id);
      if (Layers && Layers.list) {
        Layers.list.forEach(l => { if (l.asset && l.asset.id === id) l.asset = null; });
      }
      saveLib();
      if (typeof Lib.render === 'function') Lib.render();
      if (Layers && typeof Layers.render === 'function') Layers.render();
      scheduleSave();
    });
  }

  function wireRelink() {
    let picker = $('relink-picker');
    if (!picker) {
      picker = document.createElement('input');
      picker.type = 'file';
      picker.accept = 'image/*,video/*';
      picker.hidden = true;
      picker.id = 'relink-picker';
      document.body.appendChild(picker);
    }
    const lib = $('lib'); if (!lib) return;
    lib.addEventListener('click', (ev) => {
      const rl = ev.target.closest('[data-relink]');
      if (!rl) return;
      window.__relinkTarget = rl.dataset.relink;
      picker.click();
    });
    picker.addEventListener('change', (ev) => {
      const f = ev.target.files && ev.target.files[0];
      const id = window.__relinkTarget;
      window.__relinkTarget = null;
      ev.target.value = '';
      if (!f || !id) return;
      const item = (Lib.items || []).find(a => a.id === id);
      if (!item) return;
      if (item.url && item.url.startsWith('blob:')) URL.revokeObjectURL(item.url);
      item.url = URL.createObjectURL(f);
      item.name = f.name;
      item.type = f.type.startsWith('video/') ? 'video' : 'image';
      item.needsRelink = false;
      saveLib();
      if (typeof Lib.render === 'function') Lib.render();
    });
  }

  function ensureActionsUI() {
    const lib = $('lib'); if (!lib) return;
    const parent = lib.parentElement; if (!parent) return;
    if (parent.querySelector('.lib-actions')) return;
    const wrap = document.createElement('div');
    wrap.className = 'lib-actions';
    wrap.style.cssText = 'display:flex;gap:6px;padding:8px;border-top:1px solid var(--line);';
    wrap.innerHTML = `
      <button id="export-state" class="tbtn ghost" type="button" style="flex:1;font-size:9px;">EXPORT STATE</button>
      <button id="reset-state"  class="tbtn ghost" type="button" style="flex:1;font-size:9px;color:#f55;">RESET LOCAL DATA</button>
    `;
    parent.appendChild(wrap);
  }

  function wireActions() {
    ensureActionsUI();
    $('export-state') && $('export-state').addEventListener('click', () => {
      const snap = P.exportSnapshot();
      const blob = new Blob([JSON.stringify(snap, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = Object.assign(document.createElement('a'), {
        href: url, download: 'swr-snapshot.json',
      });
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setStatus('state exported', 'ok');
    });
    $('reset-state') && $('reset-state').addEventListener('click', () => {
      if (!confirm('Reset local library + engine state for ALL pages? Built-ins stay on disk.')) return;
      P.resetLocalData();
      location.reload();
    });
  }

  function wireAutosave() {
    document.addEventListener('input', (ev) => {
      if (ev.target.matches && ev.target.matches('input, select, textarea')) scheduleSave();
    });
    document.addEventListener('change', scheduleSave);
    const remap = $('remap');
    if (remap) remap.addEventListener('click', () => setTimeout(scheduleSave, 0));
  }

  // ---- boot ------------------------------------------------------------

  function boot() {
    getSWR();
    if (!window.SWR || !window.SWR.Library) {
      setTimeout(boot, 30);
      return;
    }
    Lib = window.SWR.Library;
    Layers = window.SWR.Layers || null;
    // One-time migration: persisted library entries written before this
    // commit's fromStored fix carried curated items as builtIn:false, so
    // they reloaded as url:null stubs and the canvas went blank. We don't
    // *need* to clear them — the new fromStored() detects library files
    // by name pattern and rebuilds URLs — but we delete the stale entry
    // once so the next save writes a clean builtIn:true snapshot. Skipped
    // if the user already has any builtIn:true entries (meaning they're
    // on the new format).
    try {
      const stored = P.loadLibrary();
      const hasNewFormat = stored.some(s => s.builtIn === true);
      if (stored.length && !hasNewFormat && !localStorage.getItem('swr:grid:library:migrated-v1')) {
        localStorage.setItem('swr:grid:library:migrated-v1', '1');
        // Re-hydrate from the new fromStored() in this same boot — the
        // saveLib() at the end will persist the corrected builtIn:true
        // entries. If we cleared here, users would lose their uploaded
        // non-builtIn items for one tick; keeping them and letting
        // saveLib() rewrite is safer.
      }
    } catch (_) {}
    hookLib();
    hydrateLib();
    loadEngineState();
    wireDelete();
    wireRelink();
    wireActions();
    wireAutosave();
    setTimeout(() => { try { saveLib(); setStatus('ready', 'ok'); } catch (_) {} }, 200);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
