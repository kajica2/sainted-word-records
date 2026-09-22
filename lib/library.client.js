// lib/library.client.js — Library subsystem extracted from engine.html
// (Sprint B2 of feat/asset-curator burndown).
//
// Public API
//
//   window.Library  — the Library IIFE instance, attached on script-eval.
//                     Same surface as the pre-extraction inline object:
//   .items          — array of {id, name, type, blob, url, w, h, duration,
//                     motion, luma, hue, added, thumb, rotation, ...}
//   .nextId         — monotonic id counter for in-memory assets
//   .db             — IndexedDB handle wrapper
//                     { getAll, put, delete, clear } per store
//   .init()                 — open IDB + load existing assets + render
//   .removeItem(id, opts?)  — optimistic per-item delete with 5s undo
//   .clearAll()             — wipe library + saved song (Clear button)
//   .addFiles(files)        — bulk import with throttled classify pipeline
//   .save(item)             — persist one record to IDB
//   .fromRecord(rec)        — rehydrate one record from IDB into an item
//   .buildThumb(item)       — generate 120×120 thumbnail (rotated)
//   .classify(item)         — motion / luma / hue sampling
//   .render()               — paint the library grid
//   .byId(id)               — find an item by id
//   .knownNames()           — set of all known names (folder-pick dedupe)
//   .promoteToSong(item)    — re-fetch a video item as the audio source
//
// Helpers inlined into this module (engine-private; only Library used them):
//   - openDb(name, ver, upgrade)        — tiny IndexedDB wrapper
//   - sampleLuma / sampleHue            — color-space samplers
//   - detectMp4Rotation / detectImageOrientation
//                                         — auto-rotate from file metadata
//   - _walkMp4Boxes(blob, name, cb)     — MP4/MOV box tree walker
//
// Dependencies (read via window.* at call time):
//   window.Audio          — lib/audio.client.js (Sprint B1)
//   window.Layers         — engine.html (Layers IIFE — used for render-on-
//                            thumb + add-as-layer)
//   window.setStatus, window.escapeHtml, window.clamp, window.UI
//                            — engine.html exposed
//
// Idempotent: re-evaluating the script returns the cached singleton.

(function () {
  'use strict';

  // Note: don't use `if (window.Library) return` — see Sprint B1 for the
  // native-namespace-collision lesson. Use a private marker.
  if (window.__SWR_LIBRARY_LOADED) return;
  window.__SWR_LIBRARY_LOADED = true;

  // ---- Helpers (engine-private, moved from engine.html) ----------------

  // Walk an MP4 / MOV box tree. Yields every box whose type is `name`.
  // Returns nothing; calls cb(boxStart, boxSize) for each match.
  async function _walkMp4Boxes(blob, name, cb, _opts) {
    // Read up to 16 MiB — enough for tkhd in the moov.trak.tkhd location
    // for any reasonable file. Larger uploads fall back to "0 deg".
    const MAX = 16 * 1024 * 1024;
    const size = Math.min(blob.size, MAX);
    const buf = await blob.slice(0, size).arrayBuffer();
    const dv = new DataView(buf);
    const dec = new TextDecoder('latin1');
    const parse = (off, end) => {
      let p = off;
      while (p + 8 <= end) {
        let boxSize = dv.getUint32(p);
        const type = dec.decode(buf.slice(p + 4, p + 8));
        if (boxSize === 0) return;          // box extends to EOF
        if (boxSize === 1 && p + 16 <= end) { // 64-bit largesize
          const hi = dv.getUint32(p + 8), lo = dv.getUint32(p + 12);
          boxSize = hi * 0x100000000 + lo;
        }
        if (type === name) cb(p, boxSize, dv);
        // Recurse into container boxes (moov, trak, mdia, minf, stbl, edts, udta).
        const containers = ['moov', 'trak', 'mdia', 'minf', 'stbl', 'edts', 'udta'];
        if (containers.indexOf(type) >= 0 && boxSize > 8 && p + boxSize <= end) {
          parse(p + 8, p + boxSize);
        }
        if (boxSize < 8) return;
        p += boxSize;
      }
    };
    parse(0, dv.byteLength);
  }

  // Read the QuickTime display matrix out of the first 'tkhd' box.
  // The matrix is 36 bytes of signed 16.16 fixed-point at content offset 36.
  // Returns 0/90/180/270 clockwise as the user would see when played.
  async function detectMp4Rotation(blob) {
    if (!blob) return 0;
    try {
      return await new Promise(resolve => {
        let found = 0;
        _walkMp4Boxes(blob, 'tkhd', (off, size, dv) => {
          if (found) return;
          found = 1;
          // tkhd layout (QuickTime / ISO-BMFF, version 0):
          //   version(1) flags(3) creation(4) modification(4)
          //   track_id(4) reserved(4) duration(4) reserved(8)
          //   layer(2) alternate_group(2) volume(2) reserved(2)
          //   matrix(36) width(4) height(4)
          // That's 40 bytes of header before the matrix.
          // We also account for the 8-byte box header (size + 'tkhd') passed
          // in `off` (which points at the start of the size field).
          const m = off + 8 + 40;
          if (size < 48 + 36) return;
          const a = dv.getInt32(m + 0) / 65536;   // matrix[0][0]
          const b = dv.getInt32(m + 4) / 65536;   // matrix[1][0]
          if (!isFinite(a) || !isFinite(b)) return;
          // For a pure 2D screen transform, the rotation θ satisfies
          // matrix[0][0] = a = cos θ, matrix[1][0] = b = sin θ (CW positive).
          const deg = Math.round(Math.atan2(b, a) * 180 / Math.PI / 90) * 90;
          const norm = ((deg % 360) + 360) % 360;
          resolve(norm);
        });
        // If we never hit a tkhd (rare), resolve 0 after the file is scanned.
        setTimeout(() => { if (!found) resolve(0); }, 50);
      });
    } catch {
      return 0;
    }
  }

  // Minimal EXIF orientation reader for JPEGs. We only need the IFD0
  // orientation tag (0x0112). Returns 0/90/180/270.
  function detectImageOrientation(blob) {
    return new Promise(resolve => {
      if (!blob || blob.type !== 'image/jpeg') return resolve(0);
      // Node and very-old browsers won't have FileReader; treat that as "no EXIF".
      if (typeof FileReader === 'undefined') return resolve(0);
      const reader = new FileReader();
      reader.onload = () => {
        try {
          const dv = new DataView(reader.result);
          if (dv.getUint16(0) !== 0xFFD8) return resolve(0); // not JPEG
          let p = 2;
          while (p < dv.byteLength) {
            const markerSize = dv.getUint16(p + 2);
            if (dv.getUint16(p) === 0xFFE1) { // APP1 (EXIF)
              // EXIF starts with "Exif\0\0" then 'MM' (big) or 'II' (little).
              const tiff = p + 4 + 6;
              const little = dv.getUint16(tiff) === 0x4949;
              const get16 = o => dv.getUint16(o + (little ? 0 : 0), little);
              const get32 = o => dv.getUint32(o + (little ? 0 : 0), little);
              if (get16(tiff) === 0x002A) {
                const ifd0 = tiff + get32(tiff + 4);
                const entries = get16(ifd0);
                for (let i = 0; i < entries; i++) {
                  const ent = ifd0 + 2 + i * 12;
                  if (get16(ent) === 0x0112) {
                    // orientation is a SHORT in the value field (first 2 bytes).
                    const raw = get16(ent + 8);
                    const map = { 1: 0, 3: 180, 6: 90, 8: 270 };
                    return resolve(map[raw] || 0);
                  }
                }
              }
            }
            p += 2 + markerSize;
          }
          return resolve(0);
        } catch { return resolve(0); }
      };
      reader.onerror = () => resolve(0);
      // Only read first 64 KiB — EXIF is always in the first segment.
      reader.readAsArrayBuffer(blob.slice(0, 65536));
    });
  }

  function sampleLuma(data) {
    let s = 0;
    for (let i = 0; i < data.length; i += 4) {
      s += 0.299 * data[i] + 0.587 * data[i+1] + 0.114 * data[i+2];
    }
    return (s / (data.length / 4)) / 255;
  }

  function sampleHue(data) {
    // simple average hue using atan2
    let sx = 0, sy = 0;
    for (let i = 0; i < data.length; i += 4) {
      const r = data[i], g = data[i+1], b = data[i+2];
      const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
      if (mx === mn) continue;
      const d = mx - mn;
      let h = 0;
      if (mx === r) h = ((g - b) / d) % 6;
      else if (mx === g) h = (b - r) / d + 2;
      else h = (r - g) / d + 4;
      h /= 6;
      const a = Math.cos(h * Math.PI * 2);
      const b2 = Math.sin(h * Math.PI * 2);
      sx += a; sy += b2;
    }
    const n = data.length / 4;
    return (Math.atan2(sy / n, sx / n) / (Math.PI * 2) + 1) % 1;
  }

  // Tiny IndexedDB wrapper
  function openDb(name, ver, upgrade) {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(name, ver);
      req.onupgradeneeded = (e) => upgrade(e.target.result);
      req.onsuccess = (e) => {
        const db = e.target.result;
        const api = {
          getAll: (store) => new Promise((r, rj) => {
            const t = db.transaction(store, 'readonly').objectStore(store).getAll();
            t.onsuccess = () => r(t.result);
            t.onerror = () => rj(t.error);
          }),
          put: (store, val) => new Promise((r, rj) => {
            const t = db.transaction(store, 'readwrite').objectStore(store).put(val);
            t.onsuccess = () => r();
            t.onerror = () => rj(t.error);
          }),
          delete: (store, key) => new Promise((r, rj) => {
            const t = db.transaction(store, 'readwrite').objectStore(store).delete(key);
            t.onsuccess = () => r();
            t.onerror = () => rj(t.error);
          }),
          clear: (store) => new Promise((r, rj) => {
            const t = db.transaction(store, 'readwrite').objectStore(store).clear();
            t.onsuccess = () => r();
            t.onerror = () => rj(t.error);
          }),
        };
        resolve(api);
      };
      req.onerror = () => reject(req.error);
    });
  }

  // ---- Dep lookups ------------------------------------------------------
  function setStatus(t, cls) {
    if (typeof window.setStatus === 'function') window.setStatus(t, cls);
  }
  function escapeHtml(s) {
    if (typeof window.escapeHtml === 'function') return window.escapeHtml(s);
    return String(s);
  }
  function clamp(v, lo, hi) {
    if (typeof window.clamp === 'function') return window.clamp(v, lo, hi);
    return Math.max(lo, Math.min(hi, v));
  }
  function libGrid() {
    return document.getElementById('library-grid');
  }
  function Layers() {
    return window.Layers || null;
  }
  function Audio() {
    return window.Audio || null;
  }
  function $(id) { return document.getElementById(id); }

  // ---- Library IIFE -----------------------------------------------------
  const Library = {
    items: [],          // {id, name, type, blob, url, w, h, duration, motion, luma, hue, added, thumb}
    nextId: 1,
    db: null,
    async init() {
      this.db = await openDb('sainted-word-records', 4, (db) => {
        if (!db.objectStoreNames.contains('assets')) {
          const s = db.createObjectStore('assets', { keyPath: 'id' });
          s.createIndex('added', 'added');
        }
        if (!db.objectStoreNames.contains('songs')) {
          // Single-record store for the currently-loaded song. Key is always 'current'.
          // When the user loads a new song, we overwrite 'current' so only the latest
          // survives. The blob itself is large (could be 100MB+ for an MP4 song) so we
          // keep it in IDB and not in localStorage.
          db.createObjectStore('songs', { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains('sets')) {
          // Installed .swr-set documents (marketplace page)
          db.createObjectStore('sets', { keyPath: 'id' });
        }
      });
      // Load existing assets
      const all = await this.db.getAll('assets');
      for (const rec of all) {
        const item = await this._fromRecord(rec);
        if (item) this.items.push(item);
      }
      this.render();
      setStatus(this.items.length ? 'lib ' + this.items.length : 'idle', this.items.length ? 'ok' : '');
    },
    // Remove a single asset with a 5-second undo window.
    //
    // UI path: user clicks the × button on a Library thumbnail. The asset
    // leaves the visible grid immediately (optimistic), persists removal
    // to IDB, and surfaces a status-bar undo affordance. If the user
    // doesn't click the undo prompt within 5 s, the underlying blob is
    // revoked and forgotten forever. If they do, the blob URL is re-issued
    // from a stored buffer and the asset is put back at the original index.
    //
    // Why optimistic + undo rather than confirm() modals: the user already
    // has a global Clear-All (which does confirm()) for the dangerous case;
    // per-item × should be one click. The 5 s window is short enough that
    // a stray click is recoverable, long enough that any deliberate click
    // has time to land.
    async removeItem(id, opts) {
      opts = opts || {};
      const idx = this.items.findIndex(i => i.id === id);
      if (idx < 0) return false;
      const it = this.items[idx];
      // Snapshot for potential undo. Buffer is cheap (we're not in the
      // hot path; the asset was just sitting on disk).
      const snapshot = { index: idx, item: it };
      // If this asset is currently used as a layer on stage, refuse quietly
      // (setStatus='err') — the user must remove the layer first. The
      // global Clear-All handles the bulk case where they accept losing refs.
      const layers = Layers();
      if (layers && Array.isArray(layers.list)) {
        const usedAsLayer = layers.list.some(l => l.asset === it);
        if (usedAsLayer) {
          setStatus('remove it from the stage first', 'err');
          return false;
        }
      }
      // Optimistic UI removal
      this.items.splice(idx, 1);
      try { URL.revokeObjectURL(it.url); } catch (e) {}
      if (it._el) { try { it._el.src = ''; } catch (e) {} }
      this.render();
      // Persist removal to IDB
      if (this.db) {
        try { await this.db.delete('assets', it.id); }
        catch (e) { console.warn('remove asset', e); }
      }
      // Surface the undo prompt
      if (!opts.skipUndo) {
        // Use the engine's status pill with a click target embedded as a
        // CSS-classed child — setStatus() in this codebase takes a string
        // (or DOM node). Build the pill inline.
        const pill = document.createElement('span');
        pill.appendChild(document.createTextNode(`removed ${it.name} · `));
        const undo = document.createElement('a');
        undo.href = '#';
        undo.textContent = 'undo';
        undo.style.cssText = 'color: var(--accent-2); text-decoration: underline; cursor: pointer; margin-left: 4px;';
        pill.appendChild(undo);
        const armed = { done: false };
        const restore = async () => {
          if (armed.done) return;
          armed.done = true;
          // Put the blob back at its original index.
          try { it.url = URL.createObjectURL(it.blob); } catch (e) {}
          this.items.splice(Math.min(snapshot.index, this.items.length), 0, it);
          if (this.db) {
            try { await this.db.put('assets', {
              id: it.id, name: it.name, type: it.type, blob: it.blob,
              added: it.added, motion: it.motion, luma: it.luma, hue: it.hue,
              w: it.w, h: it.h, duration: it.duration || 0, rotation: it.rotation || 0,
            }); } catch (e) { console.warn('undo save', e); }
          }
          this.render();
          this._buildThumb(it);
        };

        undo.addEventListener('click', (ev) => {
          ev.preventDefault();
          restore().then(() => {
            setStatus(`restored ${it.name}`, 'ok');
          });
        });
        setStatus(pill, 'ok');
        // After 5 s the unguarded path finalizes the removal (blob URL is
        // already revoked; the asset is already gone from IDB; nothing to do
        // except clear `armed` so an undo arriving in the post-window race
        // doesn't re-add a stale item).
        setTimeout(() => { armed.done = true; }, 5000);
      }
      return true;
    },

    // Wipe everything: library assets + saved song. Used by the Clear All
    // button (with a confirm() prompt — the per-item × button on each
    // thumbnail has its own optimistic-delete + 5s undo flow and does not
    // ask for confirmation). After this, both the on-screen library and the
    // IndexedDB 'songs'/'assets' stores are empty, and the song-name pill
    // goes back to "no song".
    async clearAll() {
      // 1. In-memory items + their blob URLs
      for (const it of this.items) {
        try { URL.revokeObjectURL(it.url); } catch (e) {}
      }
      this.items = [];
      // NOTE: we intentionally do NOT reset the swr-manifest-loaded flag here.
      // Once the demo library has been seeded, the user has seen it — Clear
      // means "wipe everything I uploaded and remember nothing", not "reset
      // the engine to factory state". To re-seed the demo library the user
      // would have to clear localStorage manually.
      // 2. IndexedDB 'assets' store (the wrapper exposes clear())
      if (this.db) {
        try { await this.db.clear('assets'); } catch (e) { console.warn('clear assets', e); }
      }
      // 3. Saved song
      const audio = Audio();
      if (audio) await audio._clearCurrentSong();
      // 4. UI
      this.render();
      const sn = $('song-name');
      if (sn) sn.innerHTML = '<i style="opacity:.5">no song</i>';
      const play = $('play');
      if (play) { play.disabled = true; play.textContent = '▶ Play'; play.classList.add('primary'); play.classList.remove('danger'); }
      const rec = $('rec');
      if (rec) rec.disabled = true;
      if (audio) { audio.pause(); audio.audioEl = null; audio.source = null; }
      setStatus('cleared', 'ok');
    },
    async addFiles(files) {
      const arr = Array.from(files);
      // ---- Progress UI bootstrap ----
      // Show an inline progress badge in the library panel-head. Cleared
      // when the import finishes (success or cancel). The same UI is
      // shared with the folder-picker and any future batch flow.
      const progressEl = $('import-progress');
      const progressText = $('import-progress-text');
      const progressCancel = $('import-progress-cancel');
      const cancelled = { v: false };
      const onCancel = () => { cancelled.v = true; };
      if (progressCancel) progressCancel.onclick = onCancel;
      const updateProgress = (state) => {
        if (!progressEl || !progressText) return;
        progressEl.hidden = false;
        progressEl.classList.remove('done', 'error');
        progressText.textContent = `importing ${state.done}/${state.total}`
          + (state.skipped ? ` · ${state.skipped} dup` : '')
          + (state.errors ? ` · ${state.errors} err` : '');
      };
      const finishProgress = (kind) => {
        if (!progressEl || !progressText) return;
        progressEl.classList.add(kind);
        if (progressCancel) progressCancel.onclick = null;
        if (kind === 'done') {
          progressText.textContent = `+${state.imported}`;
        } else if (kind === 'error') {
          progressText.textContent = `import error`;
        } else { // cancelled
          progressText.textContent = `cancelled`;
        }
        setTimeout(() => { progressEl.hidden = true; }, 1600);
      };

      const state = { total: arr.length, done: 0, imported: 0, skipped: 0, errors: 0 };
      if (state.total > 1) updateProgress(state);

      const knownKeys = new Set(this.items.map(i => i.name + ':' + (i.blob ? i.blob.size : 0)));
      // ---- Concurrency-throttled classify pipeline ----
      // _buildThumb/_classify are background tasks per item. With 50+ files
      // they pile up (50 video metadata loads = browser stall). A simple
      // promise-pool caps in-flight work at 4.
      const THUMB_POOL = 4;
      let inflight = 0;
      const waiters = [];
      const acquire = () => new Promise(res => {
        if (inflight < THUMB_POOL) { inflight++; res(); }
        else waiters.push(() => { inflight++; res(); });
      });
      const release = () => {
        inflight--;
        const next = waiters.shift();
        if (next) next();
      };
      const runClassify = (item) => acquire().then(() => {
        try {
          this._buildThumb(item);
          return this._classify(item)
            .then(() => { if (item.id) return this._save(item); })
            .then(() => this.render())
            .catch(err => { console.warn('classify', item.name, err); state.errors++; });
        } finally { release(); }
      });

      for (const f of arr) {
        if (cancelled.v) break;
        if (!f.type) { state.skipped++; continue; }
        const isVid = f.type.startsWith('video/');
        const isImg = f.type.startsWith('image/');
        if (!isVid && !isImg) { state.skipped++; state.done++; if (state.total > 1) updateProgress(state); continue; }
        // Dedupe by name+size (relativePath for folder picks so two folders
        // with same-name files don't collide)
        const relKey = (f.webkitRelativePath || f.name) + ':' + f.size;
        if (knownKeys.has(relKey)) { state.skipped++; state.done++; if (state.total > 1) updateProgress(state); continue; }
        knownKeys.add(relKey);
        const id = this.nextId++;
        const item = {
          id,
          name: f.name,
          relPath: f.webkitRelativePath || null,
          type: isVid ? 'video' : 'image',
          blob: f,
          url: URL.createObjectURL(f),
          added: Date.now(),
          thumb: null,
          motion: 0, luma: 0.5, hue: 0, w: 0, h: 0, duration: 0,
          rotation: 0,   // overridden by _detectRotation() once metadata loads
        };
        this.items.push(item);
        state.imported++;
        state.done++;
        this.render();
        // Build thumb + classify in background (throttled).
        runClassify(item);
        if (state.total > 1) updateProgress(state);
        // Tiny pause between items keeps the UI thread from stalling on
        // 100-file drops. The await isn't necessary for correctness but
        // gives the browser a frame to paint the progress badge.
        if (state.done % 8 === 0) await new Promise(r => setTimeout(r, 0));
      }
      if (state.total > 1) {
        finishProgress(cancelled.v ? 'cancelled' : (state.errors > 0 ? 'error' : 'done'));
      } else {
        setStatus('lib ' + this.items.length, 'ok');
      }
      return state;
    },
    async _save(item) {
      if (!this.db) return;
      const rec = {
        id: item.id, name: item.name, type: item.type,
        blob: item.blob, added: item.added,
        motion: item.motion, luma: item.luma, hue: item.hue,
        w: item.w, h: item.h, duration: item.duration || 0,
        rotation: item.rotation || 0,   // 0/90/180/270 — user-set asset orientation override
      };
      await this.db.put('assets', rec);
    },
    async _fromRecord(rec) {
      try {
        const item = {
          id: rec.id, name: rec.name, type: rec.type,
          blob: rec.blob, added: rec.added,
          url: URL.createObjectURL(rec.blob),
          thumb: null,
          motion: rec.motion, luma: rec.luma, hue: rec.hue,
          w: rec.w, h: rec.h, duration: rec.duration || 0,
          rotation: rec.rotation || 0,
        };
        // Build thumb
        this._buildThumb(item);
        return item;
      } catch (e) { console.warn(e); return null; }
    },
    _buildThumb(item) {
      const w = 120, h = 120;
      const c = document.createElement('canvas');
      c.width = w; c.height = h;
      const cx = c.getContext('2d');
      const onThumb = () => {
        const layers = Layers();
        if (typeof layers !== 'undefined' && layers && layers.render) layers.render();
      };
      // drawRotated: writes `src` into `cx` fitting a `w x h` square,
      // pre-rotating by `deg` (0/90/180/270). Used by thumbs and stage draw.
      const drawRotated = (src, deg) => {
        cx.save();
        cx.clearRect(0, 0, w, h);
        if (!deg) {
          cx.drawImage(src, 0, 0, w, h);
        } else {
          // For 90/270 we swap the canvas so the rotated image still fills.
          const swap = (deg === 90 || deg === 270);
          const dw = swap ? h : w;
          const dh = swap ? w : h;
          const cx2 = (cx.canvas.width - dw) / 2;
          const cy2 = (cx.canvas.height - dh) / 2;
          cx.translate(cx.canvas.width / 2, cx.canvas.height / 2);
          cx.rotate(deg * Math.PI / 180);
          cx.drawImage(src, -dw / 2, -dh / 2, dw, dh);
        }
        cx.restore();
      };
      if (item.type === 'video') {
        const v = document.createElement('video');
        v.muted = true; v.playsInline = true; v.preload = 'metadata';
        v.src = item.url;
        v.addEventListener('loadedmetadata', () => {
          try { v.currentTime = Math.min(0.5, (v.duration || 1) * 0.1); } catch (e) {}
        });
        v.addEventListener('seeked', () => {
          try {
            item.w = v.videoWidth; item.h = v.videoHeight;
            item.duration = v.duration;
            drawRotated(v, item.rotation || 0);
            item.thumb = c.toDataURL('image/jpeg', 0.7);
            this.render();
            onThumb();
          } catch (e) {}
        });
        // Detect tkhd rotation if we haven't already (one-shot, lazy).
        if (!item.rotationProbeDone) {
          item.rotationProbeDone = true;
          detectMp4Rotation(item.blob).then(deg => {
            if (deg && !item.rotationUserSet) {
              item.rotation = deg;
              // Re-render thumb + save to IDB once the seeked event has run.
              // (If thumb is already built, we just re-mark it dirty.)
              item.thumb = null;
              this._buildThumb(item);
              // _save runs after _classify; if rotation was discovered after classification,
              // persist explicitly.
              if (item.id) this._save(item).catch(() => {});
            }
          }).catch(() => {});
        }
      } else {
        const img = new Image();
        img.onload = () => {
          item.w = img.naturalWidth; item.h = img.naturalHeight;
          drawRotated(img, item.rotation || 0);
          item.thumb = c.toDataURL('image/jpeg', 0.7);
          this.render();
          onThumb();
          // Detect EXIF orientation for JPEGs (very common on phone photos).
          if (item.type === 'image' && !item.rotationProbeDone) {
            item.rotationProbeDone = true;
            detectImageOrientation(item.blob).then(deg => {
              if (deg && !item.rotationUserSet) {
                item.rotation = deg;
                item.thumb = null;
                this._buildThumb(item);
                if (item.id) this._save(item).catch(() => {});
              }
            }).catch(() => {});
          }
        };
        img.src = item.url;
      }
    },
    async _classify(item) {
      // Probe 4 frames (video) or 1 frame (image), sample to 32x32 grayscale
      const w = 32, h = 32;
      const c = document.createElement('canvas');
      c.width = w; c.height = h;
      const cx = c.getContext('2d', { willReadFrequently: true });
      const samples = [];
      let lumaSum = 0, hueSum = 0;
      const tryGet = (source, t) => new Promise(res => {
        if (item.type === 'video') {
          source.currentTime = t;
          source.addEventListener('seeked', () => {
            cx.drawImage(source, 0, 0, w, h);
            const d = cx.getImageData(0, 0, w, h).data;
            const luma = sampleLuma(d);
            const hue = sampleHue(d);
            samples.push(luma);
            lumaSum += luma; hueSum += hue;
            res();
          }, { once: true });
        } else {
          cx.drawImage(source, 0, 0, w, h);
          const d = cx.getImageData(0, 0, w, h).data;
          lumaSum += sampleLuma(d);
          hueSum += sampleHue(d);
          res();
        }
      });
      const source = item.type === 'video'
        ? Object.assign(document.createElement('video'), { src: item.url, muted: true, playsInline: true, crossOrigin: 'anonymous', preload: 'metadata' })
        : Object.assign(new Image(), { src: item.url });
      await new Promise(res => {
        if (source.readyState >= 2) res();
        else source.addEventListener(source.tagName === 'VIDEO' ? 'loadeddata' : 'load', res, { once: true });
      });
      if (item.type === 'video') {
        const dur = source.duration || 0;
        item.duration = dur;
        for (const t of [0.05, 0.3, 0.55, 0.8].map(f => f * dur)) {
          try { await tryGet(source, Math.min(t, Math.max(0, dur - 0.05))); } catch (e) {}
        }
        if (samples.length >= 2) {
          let v = 0;
          for (let i = 1; i < samples.length; i++) v += Math.abs(samples[i] - samples[i-1]);
          item.motion = clamp(v / (samples.length - 1) * 4, 0, 1);
        }
      } else {
        await tryGet(source, 0);
      }
      item.luma = clamp(lumaSum, 0, 1);
      item.hue = ((hueSum % 1) + 1) % 1;
    },
    render() {
      const grid = libGrid();
      if (!this.items.length) {
        if (grid) grid.innerHTML = '<div class="lib-empty">Drop videos, GIFs, or images<br/>anywhere on the page</div>';
        return;
      }
      const frag = document.createDocumentFragment();
      for (const it of this.items) {
        const d = document.createElement('div');
        d.className = 'lib-item';
        d.draggable = true;
        d.dataset.id = it.id;
        const tag = it.type === 'video' ? 'VID' :
                 it.type === 'camera' ? 'CAM' :
                 (it.name.toLowerCase().endsWith('.gif') ? 'GIF' : 'IMG');
        // Video items get a "use as song" button so users can promote a
        // library clip to the audio source. Other types just get the tag + name.
        const songBtn = (it.type === 'video')
          ? '<button class="lib-use-as-song" title="Use this clip as the song (audio only)">♪</button>'
          : '';
        // Rotate-the-asset button. This is the (orthogonal) "fix sideways"
        // control — the per-layer `↻ ROT` button tilts the layer on stage.
        // The asset rotation persists in IDB and shows the rotation badge.
        const rotBadge = it.rotation ? `<span class="lib-rot-badge">${it.rotation}°</span>` : '';
        const rotBtn = '<button class="lib-rot" title="Rotate this asset 90° clockwise">↻</button>';
        // Per-asset remove (top-right ×). Distinct from the global Clear
        // All button — this deletes one item, with a 5s undo window via
        // the existing setStatus() helper. Hover-revealed to keep the
        // card clean; always-visible on touch devices (see CSS).
        const delBtn = '<button class="lib-del" aria-label="Remove this asset" title="Remove this asset (5s undo via status bar)">×</button>';
        d.innerHTML = `
          <span class="tag">${tag}</span>
          <span class="name">${escapeHtml(it.name)}</span>
          ${rotBadge}
          ${rotBtn}
          ${delBtn}
          ${songBtn}
        `;
        if (it.thumb) {
          const img = new Image();
          img.src = it.thumb;
          d.appendChild(img);
        } else if (it.type === 'video') {
          const v = document.createElement('video');
          v.src = it.url; v.muted = true; v.playsInline = true;
          d.appendChild(v);
        } else {
          const img = new Image();
          img.src = it.url;
          d.appendChild(img);
        }
        const self = this;
        d.addEventListener('click', (e) => {
          // If the user clicked the "use as song" button, route there instead
          // of adding a layer. (Stop event from bubbling to the layer handler.)
          if (e.target && e.target.classList && e.target.classList.contains('lib-use-as-song')) {
            e.stopPropagation();
            self.promoteToSong(it);
            return;
          }
          // Asset rotate: flips through 0/90/180/270, marks user-set so the
          // EXIF/tkhd auto-detect won't clobber it, rebuilds the thumb, and
          // persists to IDB. Sideways-phone clips → click ↻ until right-side up.
          if (e.target && e.target.classList && e.target.classList.contains('lib-rot')) {
            e.stopPropagation();
            it.rotation = (((it.rotation || 0) + 90) % 360);
            it.rotationUserSet = true;          // protect from detection clobber
            it.thumb = null;
            it._rotated = null;                // invalidate stage cache too
            self._buildThumb(it);
            self._save(it).catch(() => {});
            setStatus(`${it.name}: ${it.rotation}°`, 'ok');
            return;
          }
          // Per-asset × (top-right). One-click optimistic delete with a 5s
          // undo window surfaced via setStatus — see Library.removeItem for
          // the IDB + layer-ref safety details. Refuses (toast=err) if the
          // asset is currently a layer on stage; user removes the layer first.
          if (e.target && e.target.classList && e.target.classList.contains('lib-del')) {
            e.stopPropagation();
            e.preventDefault();
            self.removeItem(it.id);
            return;
          }
          // Add a new layer using this asset
          const layers = Layers();
          if (layers && layers.add) layers.add(it);
        });
        d.addEventListener('dragstart', (e) => {
          e.dataTransfer.setData('text/sainted-id', String(it.id));
          e.dataTransfer.effectAllowed = 'copy';
        });
        frag.appendChild(d);
      }
      if (grid) {
        grid.innerHTML = '';
        grid.appendChild(frag);
      }
    },
    byId(id) { return this.items.find(i => i.id === id); },
    // List every already-known asset name (used to detect new ones in folder)
    knownNames() { return new Set(this.items.map(i => i.name)); },
    // Promote a library video item to the song slot. Re-fetches the blob from
    // the (object URL) source so the Audio module can decode it the same way
    // it would any user-picked file.
    async promoteToSong(item) {
      if (!item) return;
      try {
        const resp = await fetch(item.url);
        if (!resp.ok) throw new Error('fetch failed: ' + resp.status);
        const blob = await resp.blob();
        const file = new File([blob], item.name, { type: blob.type || 'video/mp4' });
        const audio = Audio();
        if (audio && audio.loadFile) audio.loadFile(file);
        setStatus(`♪ ${item.name} loaded as song`, 'ok');
      } catch (e) {
        setStatus('could not load as song: ' + (e.message || e), 'err');
      }
    },
  };

  window.Library = Library;
})();
