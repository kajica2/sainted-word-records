// lib/media-store.client.js — user media library backed by IndexedDB.
//
// CRUD surface for media files (image/* + video/*) uploaded by the user.
//
//   addMedia(files)        — write one or more files; non-media MIME types
//                             are silently skipped. Returns the inserted
//                             records (id, name, mime, size, createdAt, blob).
//   getUserMedia()         — read all records (no ObjectURL here — callers
//                             create one with `render()` or `URL.createObjectURL`).
//   deleteMedia(id)        — remove a single record by id.
//   deleteAll()            — wipe the whole user library.
//   render(container,      — small DOM helper that draws thumbnails with a
//             items, opts)  × delete button and optional onPick handler.
//                             Tracks every ObjectURL it creates and revokes
//                             them on per-item delete or when `dispose()`
//                             is called by an SPA-style host. No leaks.
//
// Storage model
//
//   DB:    swr-media   (v1)
//   Store: media       (keyPath: 'id'  →  UUID v4)
//   Record: { id, name, mime, size, createdAt, blob }
//
// Why a separate DB from `sainted-word-records` (the existing 3-store DB)?
// - Existing DB lives in engine.html and tracks curated assets + saved
//   songs + marketplace sets. It uses `assets`, `songs`, `sets` stores and
//   has its own migration story.
// - User-facing CRUD on media is a clean standalone surface — easier to
//   reason about, easier to back up independently, easier to grant a friend
//   "here's my media library" without dragging the saved song along.
// - No migration needed: existing data in `sainted-word-records` is untouched.
//
// Idempotent: returns the existing window.SWR_MEDIA on second evaluation.

(function () {
  'use strict';
  if (window.SWR_MEDIA) return;

  var DB_NAME    = 'swr-media';
  // v2 adds the `tombstones` store, used by cloud-mirror deletion
  // propagation. The upgrade only *creates* the new store — existing
  // `media` records are untouched, so no data is lost or rewritten.
  var DB_VERSION = 2;
  var STORE      = 'media';
  var TOMBS      = 'tombstones';

  // ---- Cross-tab broadcast --------------------------------------------
  // Mutations are announced on BroadcastChannel('swr-media') so other tabs
  // / windows of the same origin can refresh their grid. Per the spec,
  // BroadcastChannel does NOT echo messages back to the sender — only to
  // other contexts — so this is safe to call from any mutation handler
  // without causing a feedback loop in the originating tab.
  //
  // BroadcastChannel support: evergreen browsers (Chrome 54+, Firefox 38+,
  // Safari 15.4+). Older browsers silently no-op (the property check below
  // guards every post). In-process listeners get the same payload via the
  // `_changeListeners` array so a single-tab UI can subscribe too.

  var BC_NAME = 'swr-media';
  var bc = (typeof BroadcastChannel === 'function') ? new BroadcastChannel(BC_NAME) : null;
  var _changeListeners = [];

  function _emit(evt) {
    if (bc) {
      try { bc.postMessage(evt); } catch (_) { /* best-effort */ }
    }
    for (var i = 0; i < _changeListeners.length; i++) {
      try { _changeListeners[i](evt); } catch (e) { console.warn('[SWR_MEDIA listener]', e); }
    }
  }

  // ---- Persistent storage ---------------------------------------------
  // Without a persistence grant the browser treats IndexedDB as *best-effort*
  // storage and may silently evict the whole media library under storage
  // pressure. Nothing in this repo requested it before, so an entire upload
  // set could disappear with no error and no user action.
  //
  // Best-effort and non-blocking: never touches the upload path's promise
  // chain, never throws, and no-ops on browsers without the API (Safari
  // exposes storage.persist only from 15.2+; it silently grants for
  // installed/home-screen web apps). Privacy-mode contexts reject outright,
  // which is expected and ignored.
  //
  // Called from addMedia() rather than at module load: an explicit upload is
  // the engagement signal Chrome's heuristic looks for, and a grant is far
  // more likely there than on first paint.
  var _persistAsked = false;

  function requestPersistentStorage() {
    if (_persistAsked) return;
    _persistAsked = true;
    try {
      if (typeof navigator === 'undefined' || !navigator.storage) return;
      if (typeof navigator.storage.persist !== 'function') return;

      var check = (typeof navigator.storage.persisted === 'function')
        ? navigator.storage.persisted().catch(function () { return false; })
        : Promise.resolve(false);

      check.then(function (already) {
        if (already) return null;
        return navigator.storage.persist();
      }).then(function (granted) {
        if (granted === true) {
          console.log('[SWR_MEDIA] persistent storage granted — library is eviction-safe');
        } else if (granted === false) {
          console.warn(
            '[SWR_MEDIA] persistent storage NOT granted — the browser may evict ' +
            'this media library under storage pressure. Uploads are still saved, ' +
            'but are not guaranteed to survive.'
          );
        }
      }).catch(function () { /* best-effort; never surface to the upload path */ });
    } catch (_) { /* best-effort */ }
  }

  // ---- DB open --------------------------------------------------------

  function openDb() {
    return new Promise(function (resolve, reject) {
      var req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = function () {
        var db = req.result;
        if (!db.objectStoreNames.contains(STORE)) {
          db.createObjectStore(STORE, { keyPath: 'id' });
        }
        // Added in v2. Only creates when absent, so a v1 → v2 upgrade keeps
        // every existing media record.
        if (!db.objectStoreNames.contains(TOMBS)) {
          db.createObjectStore(TOMBS, { keyPath: 'id' });
        }
      };
      req.onsuccess = function () { resolve(req.result); };
      req.onerror   = function () {
        // VersionError means the DATABASE is newer than this script — which
        // happens for real: a browser (or Vercel's edge) can serve a cached,
        // older copy of this module after the store has been upgraded in
        // another tab. Opening at a lower version than exists is refused
        // outright, so the whole store stopped working and every sync logged
        // "The requested version (1) is less than the existing version (2)".
        //
        // The v2 change only ADDS a store, so an older script is still
        // compatible with a newer database. Reopen at whatever version
        // exists instead of failing, and treat the absence of the newer
        // store as "that feature is unavailable here" rather than an error.
        if (req.error && req.error.name === 'VersionError') {
          var retry = indexedDB.open(DB_NAME); // no version -> current
          retry.onsuccess = function () { resolve(retry.result); };
          retry.onerror   = function () { reject(retry.error); };
          return;
        }
        reject(req.error);
      };
    });
  }

  // Lazy singleton. openDb() is idempotent at the IDB layer; we cache the
  // promise so 50 addMedia calls in a row don't open 50 handles.
  var _dbPromise = null;
  function db() {
    if (!_dbPromise) _dbPromise = openDb();
    return _dbPromise;
  }

  // ---- UUID v4 with a Safari 14 fallback ------------------------------

  function uuid() {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }
    // RFC4122 v4 from 16 random bytes
    var b = (typeof crypto !== 'undefined' && crypto.getRandomValues)
      ? crypto.getRandomValues(new Uint8Array(16))
      : null;
    if (!b) {
      // Last-ditch: Math.random fallback. Not cryptographically secure but
      // unique enough for an IDB key.
      b = new Uint8Array(16);
      for (var i = 0; i < 16; i++) b[i] = Math.floor(Math.random() * 256);
    }
    b[6] = (b[6] & 0x0f) | 0x40; // v4
    b[8] = (b[8] & 0x3f) | 0x80; // variant
    var hex = '';
    for (var j = 0; j < 16; j++) hex += (b[j] + 0x100).toString(16).slice(1);
    return (
      hex.slice(0, 8) + '-' +
      hex.slice(8, 12) + '-' +
      hex.slice(12, 16) + '-' +
      hex.slice(16, 20) + '-' +
      hex.slice(20, 32)
    );
  }

  // ---- Pure CRUD ------------------------------------------------------

  // Returns array of records {id, name, mime, size, createdAt, blob}.
  // Each getUserMedia call gives fresh records (the blobs themselves are
  // safe to hold across calls because they're read-only Blob references).
  function getUserMedia() {
    return db().then(function (handle) {
      return new Promise(function (resolve, reject) {
        var tx  = handle.transaction(STORE, 'readonly');
        var req = tx.objectStore(STORE).getAll();
        req.onsuccess = function () { resolve(req.result || []); };
        req.onerror   = function () { reject(req.error); };
      });
    });
  }

  // files: FileList | File[] | single File — anything array-ish.
  // Each File must have type starting with image/ or video/.
  // Returns the records that were actually written (non-media files are
  // silently dropped before they touch the store).
  //
  // On QuotaExceededError the rejected error is augmented with:
  //   .code      = 'QUOTA_EXCEEDED'
  //   .hint      = a one-line human message about what to do
  //   .usage     = { usage, quota } from navigator.storage.estimate() (best-effort)
  // so callers can branch (suggesting library hygiene, deleting old media, etc.)
  // without re-detecting the error name.
  //
  // For VIDEO files, a 160×160 JPEG poster frame is captured at ~10% into
  // the video and stored on the record as `thumb` (data URL). The render
  // helper uses it instead of a `<video>` tag so the browser doesn't have
  // to decode the whole file just to show a thumbnail in the grid. For
  // images, no thumb is generated — the original blob URL works fine as
  // an `<img src>`. If thumb generation fails for any reason the record
  // still goes through with `thumb: null` and the renderer falls back to
  // loading the raw blob.
  function addMedia(files) {
    var list = [];
    try { list = Array.from(files || []); } catch (_) { list = []; }
    if (!list.length) return Promise.resolve([]);

    // Fire-and-forget: ask for eviction protection the first time the user
    // actually uploads. Deliberately not awaited — a prompt or a slow grant
    // must never delay or fail the write.
    requestPersistentStorage();

    // Phase 1: filter to media + capture thumbs in parallel (best-effort).
    var phase1 = list.map(function (file) {
      var type = (file && file.type) || '';
      var isMedia = type.startsWith('image/') || type.startsWith('video/');
      if (!isMedia) return Promise.resolve(null);
      var thumbPromise = type.startsWith('video/')
        ? makeVideoThumb(file).catch(function () { return null; })
        : Promise.resolve(null); // images use blob URL directly — no thumb needed
      return thumbPromise.then(function (thumb) {
        return {
          id:        uuid(),
          name:      file.name || 'media',
          mime:      type,
          size:      file.size || 0,
          createdAt: Date.now(),
          blob:      file,
          thumb:     thumb, // string data URL for video, null for image
        };
      });
    });

    return Promise.all(phase1).then(function (records) {
      var mediaRecs = records.filter(function (r) { return r !== null; });
      if (!mediaRecs.length) return [];

      // Phase 1b: pair an uploaded image to an uploaded video automatically.
      // An image whose filename stem matches a video's stem becomes that
      // video's COVER (item.coverBlob + item.coverName), so the library shows
      // one tile per video instead of the image floating loose as a second
      // entry. Matching is by stem ("clip.mp4" <- "clip.jpg") and only fires
      // when exactly one image and one video share that stem — a lone image
      // stays a standalone item, so this never guesses.
      pairCovers(mediaRecs);

      // Phase 2: write everything in a single readwrite transaction.
      return db().then(function (handle) {
        return new Promise(function (resolve, reject) {
          var tx    = handle.transaction(STORE, 'readwrite');
          var store = tx.objectStore(STORE);

          for (var i = 0; i < mediaRecs.length; i++) store.put(mediaRecs[i]);

          function quotaError(origErr) {
            var err = new Error('Storage quota exceeded — try removing some media or running library hygiene.');
            err.name = 'QuotaExceededError';
            err.code = 'QUOTA_EXCEEDED';
            err.hint = 'Remove media you no longer need, or click Library Hygiene to drop stale entries.';
            err.cause = origErr || null;
            if (typeof navigator !== 'undefined' && navigator.storage && typeof navigator.storage.estimate === 'function') {
              navigator.storage.estimate().then(function (u) {
                err.usage = u;
              }).catch(function () { /* best-effort */ });
            }
            reject(err);
          }

          tx.oncomplete = function () {
            _emit({ type: 'added', count: mediaRecs.length, ids: mediaRecs.map(function (r) { return r.id; }) });
            scheduleSync();
            resolve(mediaRecs);
          };
          tx.onerror    = function () {
            var e = tx.error;
            if (e && e.name === 'QuotaExceededError') return quotaError(e);
            reject(e);
          };
          tx.onabort    = function () {
            var e = tx.error;
            if (e && e.name === 'QuotaExceededError') return quotaError(e);
            reject(e || new Error('addMedia aborted'));
          };
        });
      });
    });
  }

  // ---- cover pairing ------------------------------------------------------
  // Filename stem, lowercased: "My Clip.Final.mp4" -> "my clip.final". The
  // LAST extension is dropped, so "clip.mp4" and "clip.jpg" collide on "clip"
  // while "clip.final.mp4" keeps its distinctive stem.
  function stemOf(name) {
    var n = String(name || '').toLowerCase().replace(/^.*[\\/]/, '');
    var dot = n.lastIndexOf('.');
    return dot > 0 ? n.slice(0, dot) : n;
  }

  /**
   * Pair images to videos inside one batch, in place.
   * An image becomes a video's cover when their stems match exactly AND the
   * match is unambiguous (one image, one video per stem). Unpaired images are
   * left as standalone items — deliberate: silently attaching a stray image
   * to an unrelated video would be worse than showing it separately.
   * Returns the number of pairs made.
   */
  function pairCovers(records) {
    var byStem = Object.create(null);
    for (var i = 0; i < records.length; i++) {
      var r = records[i];
      var isVid = (r.mime || '').indexOf('video/') === 0;
      var isImg = (r.mime || '').indexOf('image/') === 0;
      if (!isVid && !isImg) continue;
      var s = stemOf(r.name);
      if (!byStem[s]) byStem[s] = { videos: [], images: [] };
      (isVid ? byStem[s].videos : byStem[s].images).push(r);
    }
    var pairs = 0;
    Object.keys(byStem).forEach(function (s) {
      var g = byStem[s];
      if (g.videos.length === 1 && g.images.length === 1) {
        g.videos[0].coverBlob = g.images[0].blob;
        g.videos[0].coverName = g.images[0].name;
        g.images[0].pairedToId = g.videos[0].id;
        pairs++;
      }
    });
    return pairs;
  }

  /**
   * Attach (or clear) a cover image on an existing media item and persist it.
   * Pass coverItem = null to clear. Used by the UI's "drop an image on a
   * video card" gesture, and available programmatically.
   * Returns a promise for the updated record, or rejects if either side is
   * missing / the wrong type.
   */
  function setCover(videoId, coverItem) {
    if (!videoId) return Promise.reject(new Error('setCover: videoId required'));
    return getUserMedia().then(function (items) {
      var video = null;
      for (var i = 0; i < items.length; i++) if (items[i].id === videoId) video = items[i];
      if (!video) throw new Error('setCover: no such item');
      if ((video.mime || '').indexOf('video/') !== 0) throw new Error('setCover: target is not a video');

      if (coverItem && coverItem.blob) {
        if ((coverItem.mime || '').indexOf('image/') !== 0) throw new Error('setCover: cover must be an image');
        video.coverBlob = coverItem.blob;
        video.coverName = coverItem.name || 'cover';
      } else {
        delete video.coverBlob;
        delete video.coverName;
      }
      return db().then(function (handle) {
        return new Promise(function (resolve, reject) {
          var tx = handle.transaction(STORE, 'readwrite');
          tx.objectStore(STORE).put(video);
          tx.oncomplete = function () { resolve(video); };
          tx.onerror = function () { reject(tx.error || new Error('setCover write failed')); };
        });
      });
    });
  }

  // Capture a 160×160 JPEG poster frame at ~10% into the video.
  // Resolves with a data URL string ("data:image/jpeg;base64,…") or rejects
  // on decode failure (caller treats as best-effort and falls back to no thumb).
  function makeVideoThumb(file) {
    return new Promise(function (resolve, reject) {
      var url = URL.createObjectURL(file);
      var v = document.createElement('video');
      v.muted = true;
      v.playsInline = true;
      v.preload = 'metadata';
      v.src = url;

      var settled = false;
      var cleanup = function () {
        try { URL.revokeObjectURL(url); } catch (_) {}
        v.removeAttribute('src');
      };
      var finish = function (val, err) {
        if (settled) return;
        settled = true;
        cleanup();
        if (err) reject(err); else resolve(val);
      };

      var seekTimer = setTimeout(function () {
        finish(null, new Error('seek timed out'));
      }, 5000);

      v.addEventListener('loadedmetadata', function () {
        try { v.currentTime = Math.min(0.5, (v.duration || 1) * 0.1); }
        catch (e) { /* some codecs reject setting currentTime before play */ }
      });

      v.addEventListener('seeked', function () {
        clearTimeout(seekTimer);
        try {
          var w = 160, h = 160;
          var c = document.createElement('canvas');
          c.width = w; c.height = h;
          var cx = c.getContext('2d');
          // Letterbox / pillarbox to fit (videos are 16:9 etc.).
          var vw = v.videoWidth || w;
          var vh = v.videoHeight || h;
          var ar = vw / vh;
          var dw, dh;
          if (ar > 1) { dw = w; dh = w / ar; }
          else        { dh = h; dw = h * ar; }
          cx.fillStyle = '#000';
          cx.fillRect(0, 0, w, h);
          cx.drawImage(v, (w - dw) / 2, (h - dh) / 2, dw, dh);
          finish(c.toDataURL('image/jpeg', 0.7));
        } catch (e) {
          finish(null, e);
        }
      });

      v.addEventListener('error', function () {
        clearTimeout(seekTimer);
        finish(null, new Error('video decode failed'));
      });
    });
  }

  // ---- Tombstones + raw write (cloud-mirror plumbing) ------------------
  // A tombstone marks "this id was deleted here, at this time". Without it
  // a delete is invisible to sync: the next pull would see the item still
  // present in the cloud manifest and resurrect it.
  //
  // Deletion is permanent-intent, so tombstones are only ever grown or
  // cleared wholesale (deleteAll) — never silently dropped per-id, which
  // would let a resurrection happen later.

  function getTombstones() {
    return db().then(function (handle) {
      // A database restored by the VersionError retry above may predate the
      // tombstones store. Absent tombstones means "nothing was deleted here",
      // not a failure.
      if (!handle.objectStoreNames.contains(TOMBS)) return [];
      return new Promise(function (resolve, reject) {
        var tx  = handle.transaction(TOMBS, 'readonly');
        var req = tx.objectStore(TOMBS).getAll();
        req.onsuccess = function () { resolve(req.result || []); };
        req.onerror   = function () { reject(req.error); };
      });
    });
  }

  // Used by deleteMedia/deleteAll AND by sync when adopting a cloud
  // tombstone, so an adopted delete is not re-pushed on the next pass.
  function putTombstones(entries) {
    if (!entries || !entries.length) return Promise.resolve();
    return db().then(function (handle) {
      return new Promise(function (resolve, reject) {
        var tx = handle.transaction(TOMBS, 'readwrite');
        var store = tx.objectStore(TOMBS);
        for (var i = 0; i < entries.length; i++) store.put(entries[i]);
        tx.oncomplete = function () { resolve(); };
        tx.onerror    = function () { reject(tx.error); };
      });
    });
  }

  function clearTombstones() {
    return db().then(function (handle) {
      return new Promise(function (resolve, reject) {
        var tx = handle.transaction(TOMBS, 'readwrite');
        tx.objectStore(TOMBS).clear();
        tx.oncomplete = function () { resolve(); };
        tx.onerror    = function () { reject(tx.error); };
      });
    });
  }

  // Raw write used by the sync pull path — the caller already has a full
  // record (including a restored thumb), so this skips addMedia's
  // filtering/thumb work and does not emit an 'added' event per item.
  function putRecords(records) {
    if (!records || !records.length) return Promise.resolve();
    return db().then(function (handle) {
      return new Promise(function (resolve, reject) {
        var tx = handle.transaction(STORE, 'readwrite');
        var store = tx.objectStore(STORE);
        for (var i = 0; i < records.length; i++) store.put(records[i]);
        tx.oncomplete = function () { resolve(); };
        tx.onerror    = function () { reject(tx.error); };
      });
    });
  }

  // Remove local records by id WITHOUT tombstoning — used when adopting a
  // cloud tombstone, where the tombstone already exists on both sides.
  function removeRecords(ids) {
    if (!ids || !ids.length) return Promise.resolve();
    return db().then(function (handle) {
      return new Promise(function (resolve, reject) {
        var tx = handle.transaction(STORE, 'readwrite');
        var store = tx.objectStore(STORE);
        for (var i = 0; i < ids.length; i++) store.delete(ids[i]);
        tx.oncomplete = function () { resolve(); };
        tx.onerror    = function () { reject(tx.error); };
      });
    });
  }

  function deleteMedia(id) {
    if (!id) return Promise.resolve();
    return db().then(function (handle) {
      return new Promise(function (resolve, reject) {
        // One transaction across both stores: the media row and its
        // tombstone land together, so a crash cannot leave a delete that
        // sync would silently undo.
        var tx = handle.transaction([STORE, TOMBS], 'readwrite');
        tx.objectStore(STORE).delete(id);
        tx.objectStore(TOMBS).put({ id: id, deletedAt: Date.now() });
        tx.oncomplete = function () {
          _emit({ type: 'deleted', id: id });
          scheduleSync();
          resolve();
        };
        tx.onerror    = function () { reject(tx.error); };
      });
    });
  }

  function deleteAll() {
    return db().then(function (handle) {
      return new Promise(function (resolve, reject) {
        var tx = handle.transaction([STORE, TOMBS], 'readwrite');
        var media = tx.objectStore(STORE);
        // Tombstone every id we are about to drop, so the wipe propagates
        // instead of being undone by the next pull.
        var all = media.getAll();
        all.onsuccess = function () {
          var rows = all.result || [];
          var now = Date.now();
          var tombs = tx.objectStore(TOMBS);
          for (var i = 0; i < rows.length; i++) {
            tombs.put({ id: rows[i].id, deletedAt: now });
          }
          media.clear();
        };
        tx.oncomplete = function () {
          _emit({ type: 'cleared' });
          scheduleSync();
          resolve();
        };
        tx.onerror    = function () { reject(tx.error); };
      });
    });
  }

  // ---- Cloud mirror ---------------------------------------------------
  //
  // Local-first by construction: IndexedDB stays the working copy and every
  // read path above is unchanged and fully offline. The cloud is a backup
  // that also restores onto other devices.
  //
  // The manifest is a single small JSON document at a fixed key describing
  // what exists in the cloud. It is required because the storage API can
  // PUT/GET/DELETE individual keys but cannot LIST — so without a manifest
  // a client has no way to discover what it should pull.
  //
  //   { v, rev, items: [{id,name,mime,size,createdAt,key}], deleted: [{id,deletedAt}] }
  //
  // Blobs live at a deterministic key derived from the record id, so a
  // re-upload of the same record overwrites rather than accumulating
  // orphans, and the manifest does not strictly need to carry the key
  // (it does anyway, so a future layout change stays backward-compatible).
  //
  // Thumbnails are deliberately NOT stored: they are 5–10 KB per video and
  // would bloat a document fetched on every sync. They are regenerated from
  // the restored blob instead, which costs one decode per video, once.

  var MANIFEST_KEY = 'media-manifest/index.json';
  var BLOB_PREFIX  = 'media/';
  var SYNC_CONCURRENCY = 3;      // sign-upload is 60/min/user server-side
  var SYNC_DEBOUNCE_MS = 15000;  // collapse bursts of edits into one pass

  var _syncListeners = [];
  var _syncTimer = null;
  var _syncing = null;   // in-flight promise, so concurrent calls coalesce

  var _syncState = {
    status: 'idle',      // idle | syncing | synced | offline | error | unavailable
    lastSyncAt: null,
    error: null,
    pulled: 0,
    pushed: 0,
    removed: 0,
  };

  function _syncEmit() {
    for (var i = 0; i < _syncListeners.length; i++) {
      try { _syncListeners[i](_syncState); } catch (e) { console.warn('[SWR_MEDIA sync listener]', e); }
    }
  }

  function _setSync(patch) {
    for (var k in patch) {
      if (Object.prototype.hasOwnProperty.call(patch, k)) _syncState[k] = patch[k];
    }
    _syncEmit();
  }

  // Module presence only — cheap enough to call from a debounce path.
  // Actual sign-in state is resolved inside syncNow(), because
  // SWR_AUTH.session() is async and must not be awaited on a hot path.
  function canSync() {
    return !!(typeof window !== 'undefined' && window.SWR_STORAGE &&
              typeof window.SWR_STORAGE.uploadBlob === 'function' &&
              typeof window.SWR_STORAGE.downloadBlob === 'function');
  }

  // Cached session read (no {force:true}) — a sync is not worth an extra
  // network round trip, and a stale "signed in" just fails the upload.
  function _currentUser() {
    if (!window.SWR_AUTH || typeof window.SWR_AUTH.session !== 'function') {
      return Promise.resolve(null);
    }
    try {
      return Promise.resolve(window.SWR_AUTH.session()).catch(function () { return null; });
    } catch (_) {
      return Promise.resolve(null);
    }
  }

  // Run `worker` over `items` with a small fixed pool. Sequential-with-pool
  // rather than Promise.all: a 300-item library must not open 300 parallel
  // requests (or trip the per-user rate limit).
  function _pool(items, limit, worker) {
    var i = 0;
    var results = [];
    function next() {
      if (i >= items.length) return Promise.resolve();
      var idx = i++;
      return Promise.resolve(worker(items[idx], idx))
        .then(function (r) { results[idx] = r; }, function (e) { results[idx] = { __error: e }; })
        .then(next);
    }
    var workers = [];
    for (var w = 0; w < Math.min(limit, items.length); w++) workers.push(next());
    return Promise.all(workers).then(function () { return results; });
  }

  function readManifest() {
    return window.SWR_STORAGE.downloadBlob(MANIFEST_KEY)
      .then(function (blob) { return blob.text(); })
      .then(function (txt) {
        var doc = JSON.parse(txt);
        // Defensive: a malformed or foreign document must not wipe anything.
        return {
          v: 1,
          rev: (doc && doc.rev) || 0,
          items:   (doc && Array.isArray(doc.items))   ? doc.items   : [],
          deleted: (doc && Array.isArray(doc.deleted)) ? doc.deleted : [],
        };
      })
      .catch(function () {
        // 404 on first ever sync is the normal path, not an error.
        return { v: 1, rev: 0, items: [], deleted: [] };
      });
  }

  function writeManifest(doc) {
    doc.rev = Date.now();
    var blob = new Blob([JSON.stringify(doc)], { type: 'application/json' });
    return window.SWR_STORAGE.uploadBlob(blob, MANIFEST_KEY);
  }

  function _blobKeyFor(id) { return BLOB_PREFIX + id; }

  function _runSync() {
    if (!canSync()) {
      _setSync({ status: 'unavailable', error: null });
      return Promise.resolve(_syncState);
    }

    _setSync({ status: 'syncing', error: null, pulled: 0, pushed: 0, removed: 0 });

    _syncing = _currentUser()
      .then(function (user) {
        if (!user) {
          // Not signed in is a normal state, not a failure — the library
          // stays local and fully usable, exactly as before.
          _setSync({ status: 'offline', error: null });
          return null;
        }
        return Promise.all([readManifest(), getUserMedia(), getTombstones()]);
      })
      .then(function (res) {
        if (!res) return _syncState;
        var manifest  = res[0];
        var local     = res[1];
        var tombs     = res[2];

        var localById = {};
        for (var a = 0; a < local.length; a++) localById[local[a].id] = local[a];

        var tombById = {};
        for (var b = 0; b < tombs.length; b++) tombById[tombs[b].id] = tombs[b];

        var manifestById = {};
        for (var c = 0; c < manifest.items.length; c++) manifestById[manifest.items[c].id] = manifest.items[c];

        var pushed = 0, pulled = 0, removed = 0;

        // --- 1. Adopt cloud tombstones -----------------------------------
        // A remote delete wins only if we have no newer local change. Since
        // ids are UUIDs, "newer" is purely about the tombstone, not content.
        var toRemoveLocally = [];
        for (var d = 0; d < manifest.deleted.length; d++) {
          var del = manifest.deleted[d];
          if (localById[del.id] && !tombById[del.id]) toRemoveLocally.push(del.id);
        }

        var adopt = toRemoveLocally.length
          ? putTombstones(toRemoveLocally.map(function (id) { return { id: id, deletedAt: Date.now() }; }))
              .then(function () { return removeRecords(toRemoveLocally); })
              .then(function () {
                removed += toRemoveLocally.length;
                for (var r = 0; r < toRemoveLocally.length; r++) delete localById[toRemoveLocally[r].id];
              })
          : Promise.resolve();

        return adopt.then(function () {
          // --- 2. Pull: cloud items we are missing ---------------------
          var missing = [];
          for (var e = 0; e < manifest.items.length; e++) {
            var it = manifest.items[e];
            if (localById[it.id]) continue;        // already have it
            if (tombById[it.id]) continue;         // we deleted it on purpose
            missing.push(it);
          }

          return _pool(missing, SYNC_CONCURRENCY, function (item) {
            return window.SWR_STORAGE.downloadBlob(item.key || _blobKeyFor(item.id))
              .then(function (blob) {
                var rec = {
                  id: item.id, name: item.name, mime: item.mime,
                  size: item.size || blob.size, createdAt: item.createdAt || Date.now(),
                  blob: blob, thumb: null,
                };
                if (item.mime && item.mime.indexOf('video/') === 0) {
                  return makeVideoThumb(blob)
                    .then(function (t) { rec.thumb = t; return rec; })
                    .catch(function () { return rec; });   // thumb is best-effort
                }
                return rec;
              });
          }).then(function (fetched) {
            var good = fetched.filter(function (r) { return r && !r.__error; });
            pulled = good.length;
            return putRecords(good);
          });
        }).then(function () {
          // --- 3. Push: local items the cloud is missing ---------------
          var toPush = [];
          for (var f = 0; f < local.length; f++) {
            var rec = local[f];
            if (manifestById[rec.id]) continue;     // already mirrored
            if (tombById[rec.id]) continue;         // deleted; do not resurrect
            toPush.push(rec);
          }

          return _pool(toPush, SYNC_CONCURRENCY, function (rec) {
            var key = _blobKeyFor(rec.id);
            return window.SWR_STORAGE.uploadBlob(rec.blob, key, { contentType: rec.mime })
              .then(function () {
                return {
                  id: rec.id, name: rec.name, mime: rec.mime,
                  size: rec.size, createdAt: rec.createdAt,
                  key: key,
                };
              });
          }).then(function (uploaded) {
            var good = uploaded.filter(function (r) { return r && !r.__error; });
            pushed = good.length;
            for (var g = 0; g < good.length; g++) manifest.items.push(good[g]);
          });
        }).then(function () {
          // --- 4. Publish our tombstones ------------------------------
          var seen = {};
          for (var h = 0; h < manifest.deleted.length; h++) seen[manifest.deleted[h].id] = true;
          for (var j = 0; j < tombs.length; j++) {
            if (!seen[tombs[j].id]) { manifest.deleted.push(tombs[j]); seen[tombs[j].id] = true; }
          }

          // --- 5. Compact ---------------------------------------------
          // A tombstoned id must not also stay in `items`, or the manifest
          // grows without bound and every client keeps re-reading (and
          // re-skipping) dead entries forever. Compaction is what keeps the
          // tombstone the single authority on "this was deleted".
          var liveBefore = manifest.items.length;
          manifest.items = manifest.items.filter(function (it) { return !seen[it.id]; });
          var compacted = liveBefore - manifest.items.length;

          // Do not write a manifest when nothing changed — avoids a
          // pointless round trip on every boot.
          if (pushed || pulled || removed || compacted) {
            return writeManifest(manifest);
          }
          return null;
        }).then(function () {
          _setSync({
            status: 'synced', lastSyncAt: Date.now(), error: null,
            pulled: pulled, pushed: pushed, removed: removed,
          });
          if (pulled || pushed || removed) _emit({ type: 'synced', pulled: pulled, pushed: pushed, removed: removed });
          return _syncState;
        });
      })
      .catch(function (e) {
        // A failed sync must never damage local data — everything above is
        // additive or tombstone-driven, so nothing is lost by giving up.
        _setSync({ status: 'error', error: (e && e.message) || String(e) });
        return _syncState;
      })
      .then(function (st) { _syncing = null; return st; }, function (e) { _syncing = null; throw e; });

    return _syncing;
  }

  // Public entry point. When a pass is already in flight it is NOT returned
  // directly: that pass may have read state before the caller's most recent
  // mutation, so awaiting it would silently under-report (e.g. a delete that
  // has not yet been published). Instead the call queues one fresh pass
  // behind it, so `await syncNow()` always reflects state read after the
  // call was made.
  function syncNow() {
    var prev = _syncing;
    if (prev) {
      return prev.catch(function () { /* a failed prior pass must not block this one */ })
                 .then(function () { return _runSync(); });
    }
    return _runSync();
  }

  // Debounced auto-sync, kicked by mutations. Kept long because sign-upload
  // is rate-limited to 60/min/user and a bulk import would otherwise burn it.
  function scheduleSync() {
    if (!canSync()) return;
    clearTimeout(_syncTimer);
    _syncTimer = setTimeout(function () {
      _syncTimer = null;
      syncNow();
    }, SYNC_DEBOUNCE_MS);
  }

  // ---- Render helper with built-in ObjectURL hygiene ------------------

  // container: HTMLElement — replaced in-place.
  // items:     array returned from getUserMedia().
  // opts:
  //   onPick(item, ev)         — fired when a card body is clicked.
  //   onCover(videoItem, imageFile, ev)
  //                            — fired when an image is dropped ONTO a video
  //                              card (the explicit "make this the cover"
  //                              gesture). Only wired for video cards.
  //   onDelete(item, ev)       — fired AFTER deleteMedia succeeds for an item.
  //   emptyText                — string shown when items is [] (default "No media yet").
  // Returns a controller { refresh(), dispose() } for SPA-style hosts.
  //
  // Every URL.createObjectURL() we make is matched with a
  // URL.revokeObjectURL() before the helper returns. Per-item delete
  // revokes that item's URL immediately; dispose() revokes whatever is left.
  function render(container, items, opts) {
    if (!container) return { refresh: function () {}, dispose: function () {} };
    opts = opts || {};
    var onPick    = opts.onPick;
    var onDelete  = opts.onDelete;
    var onCover   = opts.onCover;   // (videoItem, imageFile, ev) — drop-to-cover
    var emptyText = opts.emptyText || 'No media yet.';

    var urls = []; // ObjectURLs created during this render — all revoked on dispose/refresh

    function cleanup() {
      for (var i = 0; i < urls.length; i++) {
        try { URL.revokeObjectURL(urls[i]); } catch (_) {}
      }
      urls.length = 0;
    }

    function draw(list) {
      container.innerHTML = '';
      // Items that were paired as another item's cover do not render as their
      // own tile — they ARE the video's tile. The record stays in the store
      // (so the pairing survives a reload) but the grid shows one entry per
      // piece of content rather than two.
      var pairedIds = Object.create(null);
      for (var pi = 0; pi < list.length; pi++) {
        if (list[pi] && list[pi].pairedToId) pairedIds[list[pi].id] = true;
      }
      var visible = list.filter(function (it) { return it && (it.blob || it.url) && !pairedIds[it.id]; });

      if (!visible.length) {
        var empty = document.createElement('div');
        empty.className = 'swr-media-empty';
        empty.textContent = emptyText;
        container.appendChild(empty);
        return;
      }

      for (var i = 0; i < visible.length; i++) {
        var item = visible[i];
        if (!item || (!item.blob && !item.url)) continue;

        // Engine-Library items arrive with a live object URL and no blob;
        // media-store uploads arrive with a blob. Both end up as one `url`.
        var url;
        if (item.url) {
          url = item.url;
        } else {
          url = URL.createObjectURL(item.blob);
          urls.push(url);
        }

        var card = document.createElement('div');
        card.className = 'swr-media-card';
        card.dataset.id = item.id;

        var isVideo = item.mime && item.mime.indexOf('video/') === 0;
        // Cover precedence for a video: an explicit or auto-paired cover image >
        // the captured JPEG poster frame > the live blob (metadata only).
        // The cover is what the user chose, so it must win over the auto thumb.
        var coverUrl = null;
        if (isVideo && item.coverBlob) {
          coverUrl = URL.createObjectURL(item.coverBlob);
          urls.push(coverUrl);
          card.dataset.hasCover = '1';
        }
        var media;
        if (isVideo && coverUrl) {
          media = document.createElement('img');
          media.src = coverUrl;
          media.loading = 'lazy';
          media.alt = '';
        } else if (isVideo && item.thumb) {
          media = document.createElement('img');
          media.src = item.thumb;
          media.loading = 'lazy';
        } else if (isVideo) {
          media = document.createElement('video');
          media.src = url;
          media.muted = true;
          media.preload = 'metadata';
        } else {
          media = document.createElement('img');
          media.src = url;
          media.loading = 'lazy';
        }
        card.appendChild(media);

        var meta = document.createElement('div');
        meta.className = 'swr-media-meta';
        var kb = Math.round((item.size || 0) / 1024);
        meta.textContent = (item.name || 'media') + ' · ' + kb + 'KB';
        card.appendChild(meta);

        // Drop an image straight onto a video card to make it the cover.
        // Same intent as uploading "clip.jpg" beside "clip.mp4" (which pairs
        // automatically), just explicit — for when the filename does not
        // match. Only videos accept the drop; an image card stays inert so
        // the gesture cannot be mistaken for a reorder.
        if (isVideo && typeof onCover === 'function') {
          // NOTE: dragover must call preventDefault() to mark the card as a
          // valid drop target (without it the browser cancels the drop and no
          // `drop` event ever fires). No stopPropagation here — the page's own
          // window-level dragover uses it to show the global "drop files"
          // affordance, and swallowing the event broke that.
          card.addEventListener('dragover', function (ev) {
            if (!ev.dataTransfer || !ev.dataTransfer.types) return;
            if (ev.dataTransfer.types.indexOf('Files') === -1) return;
            ev.preventDefault();
            if (!card.classList.contains('is-cover-target')) {
              card.classList.add('is-cover-target');
            }
          });
          card.addEventListener('dragleave', function () {
            card.classList.remove('is-cover-target');
          });
          card.addEventListener('drop', function (ev) {
            var files = ev.dataTransfer && ev.dataTransfer.files;
            if (!files || !files.length) return;
            var img = null;
            for (var fi = 0; fi < files.length; fi++) {
              if ((files[fi].type || '').indexOf('image/') === 0) { img = files[fi]; break; }
            }
            if (!img) return;             // not an image: let the page handle it
            ev.preventDefault();
            ev.stopPropagation();         // do NOT let the page stage this file
            card.classList.remove('is-cover-target');
            try { onCover(item, img, ev); } catch (e) { console.warn('[SWR_MEDIA onCover]', e); }
          });
        }

        if (typeof onPick === 'function') {
          card.style.cursor = 'pointer';
          card.addEventListener('click', function (ev) {
            if (ev.target.closest && ev.target.closest('.swr-media-del')) return;
            try { onPick(item, ev); } catch (e) { console.warn('[SWR_MEDIA onPick]', e); }
          });
        }

        var del = document.createElement('button');
        del.className = 'swr-media-del';
        del.type = 'button';
        del.title = 'Delete';
        del.setAttribute('aria-label', 'Delete ' + (item.name || 'media'));
        del.textContent = '×';
        del.addEventListener('click', (function (curItem, curUrl, curCard) {
          return function (ev) {
            ev.stopPropagation();
            deleteMedia(curItem.id).then(function () {
              curCard.remove();
              var idx = urls.indexOf(curUrl);
              if (idx !== -1) {
                try { URL.revokeObjectURL(curUrl); } catch (_) {}
                urls.splice(idx, 1);
              }
              if (typeof onDelete === 'function') {
                try { onDelete(curItem, ev); } catch (e) { console.warn('[SWR_MEDIA onDelete]', e); }
              }
              // If the grid is now empty, replace with the empty placeholder.
              if (!container.querySelector('.swr-media-card')) {
                cleanup();
                draw([]); // re-renders emptyText + fresh state
              }
            }, function (err) {
              console.warn('[SWR_MEDIA] delete failed', err);
            });
          };
        })(item, url, card));
        card.appendChild(del);

        container.appendChild(card);
      }
    }

    draw(items);

    return {
      refresh: function () {
        cleanup();
        return getUserMedia().then(function (fresh) { draw(fresh); });
      },
      dispose: cleanup,
    };
  }

  window.SWR_MEDIA = {
    db: db,
    uuid: uuid,
    addMedia: addMedia,
    // Attach/clear a video's cover image (pairing is automatic on upload when
    // an image and a video share a filename stem; this is the explicit path).
    setCover: setCover,
    getUserMedia: getUserMedia,
    deleteMedia: deleteMedia,
    deleteAll: deleteAll,
    render: render,
    // Subscribe to mutation events from any tab/window. The handler
    // receives { type: 'added'|'deleted'|'cleared'|'synced', ...payload }.
    // The originating tab is NOT notified (per BroadcastChannel spec), so
    // a UI in the originating tab won't double-refresh.
    onChange: function (handler) {
      if (typeof handler !== 'function') return function () {};
      _changeListeners.push(handler);
      return function () {
        var i = _changeListeners.indexOf(handler);
        if (i !== -1) _changeListeners.splice(i, 1);
      };
    },
    // True if BroadcastChannel is available; false means cross-tab
    // sync is a no-op on this browser (very old browsers).
    hasBroadcast: !!bc,

    // ---- Cloud mirror ------------------------------------------------
    // Local-first: nothing below is required for the library to work.
    // Without a signed-in session, syncNow() resolves to status 'offline'
    // and the store behaves exactly as it did before the mirror existed.
    syncNow: syncNow,
    getSyncState: function () {
      // Shallow copy so callers cannot mutate our state object.
      return {
        status: _syncState.status, lastSyncAt: _syncState.lastSyncAt,
        error: _syncState.error, pulled: _syncState.pulled,
        pushed: _syncState.pushed, removed: _syncState.removed,
      };
    },
    onSyncChange: function (handler) {
      if (typeof handler !== 'function') return function () {};
      _syncListeners.push(handler);
      return function () {
        var i = _syncListeners.indexOf(handler);
        if (i !== -1) _syncListeners.splice(i, 1);
      };
    },
    canSync: canSync,
  };

  // Boot-time sync. Deferred until the page is idle so it never competes
  // with first paint, and skipped entirely when the storage/auth modules
  // are absent (e.g. a version page that does not load this script stack).
  if (canSync()) {
    var _bootSync = function () { syncNow(); };
    if (typeof document !== 'undefined' && document.readyState === 'complete') {
      setTimeout(_bootSync, 0);
    } else if (typeof window !== 'undefined' && window.addEventListener) {
      window.addEventListener('load', function () { setTimeout(_bootSync, 0); });
    }
  }
})();
