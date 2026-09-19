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
  var DB_VERSION = 1;
  var STORE      = 'media';

  // ---- DB open --------------------------------------------------------

  function openDb() {
    return new Promise(function (resolve, reject) {
      var req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = function () {
        var db = req.result;
        if (!db.objectStoreNames.contains(STORE)) {
          db.createObjectStore(STORE, { keyPath: 'id' });
        }
      };
      req.onsuccess = function () { resolve(req.result); };
      req.onerror   = function () { reject(req.error); };
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

          tx.oncomplete = function () { resolve(mediaRecs); };
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

  function deleteMedia(id) {
    if (!id) return Promise.resolve();
    return db().then(function (handle) {
      return new Promise(function (resolve, reject) {
        var tx = handle.transaction(STORE, 'readwrite');
        tx.objectStore(STORE).delete(id);
        tx.oncomplete = function () { resolve(); };
        tx.onerror    = function () { reject(tx.error); };
      });
    });
  }

  function deleteAll() {
    return db().then(function (handle) {
      return new Promise(function (resolve, reject) {
        var tx = handle.transaction(STORE, 'readwrite');
        tx.objectStore(STORE).clear();
        tx.oncomplete = function () { resolve(); };
        tx.onerror    = function () { reject(tx.error); };
      });
    });
  }

  // ---- Render helper with built-in ObjectURL hygiene ------------------

  // container: HTMLElement — replaced in-place.
  // items:     array returned from getUserMedia().
  // opts:
  //   onPick(item, ev)         — fired when a card body is clicked.
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
      if (!list || !list.length) {
        var empty = document.createElement('div');
        empty.className = 'swr-media-empty';
        empty.textContent = emptyText;
        container.appendChild(empty);
        return;
      }

      for (var i = 0; i < list.length; i++) {
        var item = list[i];
        if (!item || !item.blob) continue;

        var url = URL.createObjectURL(item.blob);
        urls.push(url);

        var card = document.createElement('div');
        card.className = 'swr-media-card';
        card.dataset.id = item.id;

        var isVideo = item.mime && item.mime.indexOf('video/') === 0;
        // Prefer the captured JPEG thumb for videos — avoids forcing the
        // browser to decode the full video just to show a tile. Fall back
        // to the blob URL via a <video> element when no thumb was captured.
        var media;
        if (isVideo && item.thumb) {
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
    getUserMedia: getUserMedia,
    deleteMedia: deleteMedia,
    deleteAll: deleteAll,
    render: render,
  };
})();
