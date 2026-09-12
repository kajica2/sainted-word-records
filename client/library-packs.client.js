// client/library-packs.client.js — opt-in "packs" toolbar for music_video.html.
//
// USAGE
//   <script src="../client/library-packs.client.js" defer></script>
//   <div id="packs"></div>       ← toolbar renders here
//   <div id="lib"></div>         ← existing render container
//   <input type="file" id="asset-input" multiple />
//
// PUBLIC API (window.SWR_LIBRARY_PACKS)
//   .load(id)       — load a pack by id; returns Promise<{loaded, items, error}>
//   .unload(id)     — clear pack-loaded items from the library
//   .toggle(id)     — flip state
//   .loaded()       — list of currently loaded pack ids
//   .state()        — Map<id, {loaded, itemCount, folder, lastError}>
//
// PACKS (initial)
//   photos          → /library/manifest.json → filter jpg, mp4
//   transparent-pngs→ /library/manifest.json → filter png (incl. persona/*)
//   audio-loops     → /library/audio/*.mp3, *.wav
//   gifts           → placeholder; uploads only (no curated set yet)
//
// No pack auto-loads. All opt-in via toolbar click. Toggle to unload.
//
// ALL FILE PATHS ARE FETCHED VIA "/library/manifest.json" + "/library/audio/<name>".
// If the manifest is empty (LIBRARY_BLOB_URL not set) the pack buttons
// fall back to a polite "fetch failed — drop files instead" message and
// remain functional for drag-drop.

(function () {
  'use strict';

  const NAMESPACE = 'SWR_LIBRARY_PACKS';
  const MANIFEST_URL = '/library/manifest.json';
  const AUDIO_BASE = '/library/audio';

  // Pack definitions.
  // Sources:
  //   - 'manifest'        → fetched from /library/manifest.json, filtered by extension
  //   - 'audio-manifest'  → audio files listed in manifest.json under "audioFiles" (added here)
  //   - 'placeholder'     → no curated source; users drag their own
  const PACKS = [
    {
      id: 'photos',
      label: 'Photos',
      icon: '📸',
      source: 'pack',
      packKey: 'photos',
      folder: 'photos',
      emptyMsg: 'No JPGs/MP4s in the library.',
      description: 'Curated photos + video clips',
    },
    {
      id: 'transparent-pngs',
      label: 'Transparent PNGs',
      icon: '✂️',
      source: 'pack',
      packKey: 'transparent-pngs',
      folder: 'transparent-pngs',
      emptyMsg: 'No PNGs in the library.',
      description: 'Overlays, masks, persona cards',
    },
    {
      id: 'audio-loops',
      label: 'Audio Loops',
      icon: '🎵',
      source: 'audio-pack',
      packKey: 'audio-loops',
      folder: 'audio-loops',
      emptyMsg: 'No audio loops in manifest.',
      description: 'Demo WAV/MP3 loops',
    },
    {
      id: 'gifts',
      label: 'Animated Gifts',
      icon: '🎞️',
      source: 'pack',
      packKey: 'animated-gifts',
      folder: 'animated-gifts',
      emptyMsg: 'No curated gifts yet — drag animated GIFs here.',
      description: '3 curated animated gifts (Are.na · <1MB each)',
    },
  ];

  // ---------- state ----------
  const state = new Map(); // packId → { loaded, itemCount, folder, lastError }

  // ---------- helpers ----------
  function getLib() {
    return window.SWR && window.SWR.Library;
  }

  function getCurator() {
    return window.SWR_ASSET_CURATOR;
  }

  function getStage() {
    // Optional secondary stage for items in opt-in folders.
    // Currently `SWR.Library` adds items; we just route by .folder.
    return null;
  }

  async function fetchManifest() {
    const r = await fetch(MANIFEST_URL, { cache: 'no-cache' });
    if (!r.ok) throw new Error(`manifest ${r.status}`);
    return r.json();
  }

  function fileSizeOrNull(url) {
    return fetch(url, { method: 'HEAD' }).then((r) => {
      if (!r.ok) return null;
      const n = parseInt(r.headers.get('Content-Length') || '0', 10);
      return Number.isFinite(n) ? n : null;
    }).catch(() => null);
  }

  // Convert relative manifest path → absolute URL.
  function manifestUrl(rel) {
    if (!rel) return null;
    return '/library/' + rel.replace(/^\/+/, '');
  }

  // Build a synthetic File from a relative manifest path by fetching its bytes.
  // For images / videos this is what we want.
  async function fetchAsFile(url, name, type) {
    const r = await fetch(url, { cache: 'force-cache' });
    if (!r.ok) throw new Error(`${name}: HTTP ${r.status}`);
    const buf = await r.arrayBuffer();
    return new File([buf], name, { type: type || 'application/octet-stream' });
  }

  // Build a File from an audio loop: range-fetch the first ~256KB for metadata,
  // then queue the full asset lazily as a metadata stub. The user can then drop
  // the audio file as a track source. For audio-load we just record a metadata
  // entry in the library aside; the user clicks "play" to actually wire it.
  async function audioMetadataStub(name) {
    const url = AUDIO_BASE + '/' + name;
    const r = await fetch(url, { method: 'HEAD', cache: 'no-cache' });
    if (!r.ok) throw new Error(`${name}: HTTP ${r.status}`);
    const size = parseInt(r.headers.get('Content-Length') || '0', 10);
    // We don't fetch the bytes — audio is heavy.
    // Store a lightweight blob-less record.
    return {
      name,
      url,
      size: Number.isFinite(size) ? size : 0,
    };
  }

  // ---------- pack: photos / transparent-pngs ----------
  async function loadManifestPack(pack) {
    let manifest;
    try {
      manifest = await fetchManifest();
    } catch (err) {
      state.set(pack.id, { loaded: false, itemCount: 0, lastError: 'manifest unreachable' });
      return { loaded: false, items: [], error: 'manifest unreachable' };
    }

    // Authoritative source: manifest.packs[pack.packKey]
    const files = (manifest.packs && manifest.packs[pack.packKey]) || [];
    if (!files.length) {
      state.set(pack.id, { loaded: false, itemCount: 0, lastError: pack.emptyMsg });
      return { loaded: false, items: [], error: pack.emptyMsg };
    }

    const Lib = getLib();
    if (!Lib) {
      state.set(pack.id, { loaded: false, itemCount: 0, lastError: 'SWR.Library not present' });
      return { loaded: false, items: [], error: 'SWR.Library not present' };
    }

    // Build synthetic File objects and pipe through Lib.addFiles().
    const items = [];
    for (const rel of files) {
      const url = manifestUrl(rel);
      const ext = (rel.split('.').pop() || '').toLowerCase();
      const mime =
        ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' :
        ext === 'png' ? 'image/png' :
        ext === 'mp4' ? 'video/mp4' :
        'application/octet-stream';

      try {
        const file = await fetchAsFile(url, rel, mime);
        items.push(file);
      } catch (err) {
        // skip individual failures but keep going
        console.warn('[pack]', pack.id, 'skip', rel, err.message);
      }
    }

    // Add to library. Lib.addFiles() will route through the asset curator,
    // which already handles folder routing (gift-bags, transparent-pngs).
    // We override .folder AFTER addFiles so the user's opt-in pack wins.
    Lib.addFiles(items);

    // Re-stamp folder on the most recently added items so they group together
    // under the pack's folder regardless of the curator's guess.
    for (let i = Lib.items.length - items.length; i < Lib.items.length; i++) {
      const it = Lib.items[i];
      if (it) {
        it.folder = pack.folder;
        it.packId = pack.id;
      }
    }

    state.set(pack.id, { loaded: true, itemCount: items.length });
    // Force a re-render so the new items appear in the aside.
    try { Lib.render && Lib.render(); } catch (_) {}

    return { loaded: true, items, error: null };
  }

  // ---------- pack: audio-loops ----------
  async function loadAudioPack(pack) {
    let manifest;
    try {
      manifest = await fetchManifest();
    } catch (err) {
      state.set(pack.id, { loaded: false, itemCount: 0, lastError: 'manifest unreachable' });
      return { loaded: false, items: [], error: 'manifest unreachable' };
    }

    const audioFiles = (manifest.packs && manifest.packs[pack.packKey]) || [];
    if (!audioFiles.length) {
      state.set(pack.id, { loaded: false, itemCount: 0, lastError: 'no audio packs in manifest' });
      return { loaded: false, items: [], error: 'no audio packs in manifest' };
    }

    const Lib = getLib();
    if (!Lib) {
      state.set(pack.id, { loaded: false, itemCount: 0, lastError: 'SWR.Library not present' });
      return { loaded: false, items: [], error: 'SWR.Library not present' };
    }

    // Audio loops become placeholders in the library aside. The user can click
    // one to load it as the music source. We don't ship the bytes — the click
    // handler fetches lazily.
    const items = [];
    for (const name of audioFiles) {
      try {
        const stub = await audioMetadataStub(name);
        const item = {
          id: Lib.nextId++,
          type: 'audio-loop',
          name: stub.name,
          url: stub.url,
          size: stub.size,
          folder: pack.folder,
          packId: pack.id,
        };
        Lib.items.push(item);
        items.push(item);
      } catch (err) {
        console.warn('[pack]', pack.id, 'skip', name, err.message);
      }
    }

    state.set(pack.id, { loaded: true, itemCount: items.length });
    try { Lib.render && Lib.render(); } catch (_) {}

    return { loaded: true, items, error: null };
  }

  // ---------- pack: gifts (placeholder only) ----------
  async function loadPlaceholderPack(pack) {
    // Gifts has no curated source. Loading the pack just creates the folder
    // header so drag-dropped uploads group together under it.
    const Lib = getLib();
    if (!Lib) {
      state.set(pack.id, { loaded: false, itemCount: 0, lastError: 'SWR.Library not present' });
      return { loaded: false, items: [], error: 'SWR.Library not present' };
    }

    // Insert a "folder placeholder" so the UI shows the gifts folder even
    // when nothing is loaded into it yet.
    const placeholder = {
      id: Lib.nextId++,
      type: 'folder-empty',
      name: 'gifts',
      folder: pack.folder,
      packId: pack.id,
    };
    // Avoid duplicates if reloading.
    if (!Lib.items.some((it) => it.packId === pack.id && it.type === 'folder-empty')) {
      Lib.items.push(placeholder);
    }
    state.set(pack.id, { loaded: true, itemCount: 0 });
    try { Lib.render && Lib.render(); } catch (_) {}
    return { loaded: true, items: [], error: null };
  }

  // ---------- load / unload ----------
  async function load(id) {
    const pack = PACKS.find((p) => p.id === id);
    if (!pack) return { loaded: false, items: [], error: 'unknown pack id' };

    if (state.get(id) && state.get(id).loaded) {
      // Idempotent: already loaded, return current.
      return { loaded: true, items: state.get(id).itemCount, error: null };
    }

    let result;
    if (pack.source === 'pack') result = await loadManifestPack(pack);
    else if (pack.source === 'audio-pack') result = await loadAudioPack(pack);
    else if (pack.source === 'placeholder') result = await loadPlaceholderPack(pack);
    else result = { loaded: false, items: [], error: 'unknown source type' };

    // Reflect state in toolbar UI.
    const btn = document.querySelector(`[data-pack-id="${id}"]`);
    if (btn) paintButton(btn, pack, result);
    return result;
  }

  function unload(id) {
    const Lib = getLib();
    if (!Lib) return;
    const before = Lib.items.length;
    Lib.items = Lib.items.filter((it) => it.packId !== id);
    const removed = before - Lib.items.length;
    state.set(id, { loaded: false, itemCount: 0 });
    try { Lib.render && Lib.render(); } catch (_) {}

    const btn = document.querySelector(`[data-pack-id="${id}"]`);
    const pack = PACKS.find((p) => p.id === id);
    if (btn && pack) paintButton(btn, pack, { loaded: false, items: [], error: null });
    return removed;
  }

  async function toggle(id) {
    const cur = state.get(id);
    if (cur && cur.loaded) return unload(id);
    return load(id);
  }

  function loaded() {
    return [...state.entries()].filter(([, v]) => v.loaded).map(([k]) => k);
  }

  function stateOf() {
    return state;
  }

  // ---------- toolbar render ----------
  function paintButton(btn, pack, result) {
    btn.classList.remove('is-loaded', 'is-error');
    if (result && result.loaded) {
      btn.classList.add('is-loaded');
      btn.textContent = `${pack.icon} ${pack.label} · ✓`;
      btn.title = `Loaded · click to unload`;
    } else if (result && result.error) {
      btn.classList.add('is-error');
      btn.textContent = `${pack.icon} ${pack.label} · ⚠`;
      btn.title = `${result.error} — drag-drop your own instead.`;
    } else {
      btn.textContent = `${pack.icon} ${pack.label}`;
      btn.title = `Load pack (opt-in only, nothing auto-loads)`;
    }
  }

  function renderToolbar(toolbarEl) {
    if (!toolbarEl) return;
    toolbarEl.innerHTML = '';
    const head = document.createElement('div');
    head.className = 'packs-head';
    head.innerHTML = `<span class="packs-title">Packs</span><span class="packs-hint">opt-in</span>`;
    toolbarEl.appendChild(head);

    const grid = document.createElement('div');
    grid.className = 'packs-grid';
    toolbarEl.appendChild(grid);

    for (const pack of PACKS) {
      const btn = document.createElement('button');
      btn.className = 'pack-btn';
      btn.dataset.packId = pack.id;
      btn.type = 'button';
      paintButton(btn, pack, { loaded: false, items: [], error: null });
      btn.addEventListener('click', () => toggle(pack.id));
      grid.appendChild(btn);
    }

    // No-packs-loaded banner below the toolbar (rendered into #lib body).
    const libEl = document.getElementById('lib');
    if (libEl && !document.getElementById('packs-empty')) {
      const banner = document.createElement('div');
      banner.id = 'packs-empty';
      banner.className = 'packs-empty';
      banner.innerHTML = `<div>📭</div><div class="packs-empty-title">No public library loaded</div><div class="packs-empty-sub">Click a pack above, or drag-drop your own files. This page is session-private by default.</div>`;
      libEl.prepend(banner);
    }
  }

  // ---------- auto-hide empty banner when content lands ----------
  function observeLibrary() {
    const libEl = document.getElementById('lib');
    if (!libEl) return;
    // Toggle the banner on/off when items appear.
    const refresh = () => {
      const Lib = getLib();
      const banner = document.getElementById('packs-empty');
      if (!banner || !Lib) return;
      const hasItems = (Lib.items || []).some(
        (it) => it && it.type !== 'folder-empty'
      );
      banner.style.display = hasItems ? 'none' : '';
    };
    // Patch Lib.render to call refresh after each render.
    const Lib = getLib();
    if (Lib && !Lib._packsObserverPatched) {
      const origRender = Lib.render;
      Lib.render = function (...args) {
        const r = origRender && origRender.apply(this, args);
        refresh();
        return r;
      };
      Lib._packsObserverPatched = true;
    }
    refresh();
  }

  // ---------- public init ----------
  function init() {
    const toolbarEl = document.getElementById('packs');
    if (!toolbarEl) return;
    renderToolbar(toolbarEl);
    observeLibrary();
  }

  // Expose API.
  window[NAMESPACE] = {
    PACKS,
    load,
    unload,
    toggle,
    loaded,
    state: stateOf,
    init,
  };

  // Boot.
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
})();
