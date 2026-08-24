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
  function addMedia(files) {
    var list = [];
    try { list = Array.from(files || []); } catch (_) { list = []; }
    if (!list.length) return Promise.resolve([]);

    var inserted = [];
    return db().then(function (handle) {
      return new Promise(function (resolve, reject) {
        var tx    = handle.transaction(STORE, 'readwrite');
        var store = tx.objectStore(STORE);

        for (var i = 0; i < list.length; i++) {
          var file = list[i];
          var type = (file && file.type) || '';
          if (!type.startsWith('image/') && !type.startsWith('video/')) continue;
          var rec = {
            id:        uuid(),
            name:      file.name || 'media',
            mime:      type,
            size:      file.size || 0,
            createdAt: Date.now(),
            blob:      file,
          };
          store.put(rec);
          inserted.push(rec);
        }

        tx.oncomplete = function () { resolve(inserted); };
        tx.onerror    = function () { reject(tx.error); };
        tx.onabort    = function () { reject(tx.error || new Error('addMedia aborted')); };
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

        var media = item.mime && item.mime.indexOf('video/') === 0
          ? document.createElement('video')
          : document.createElement('img');
        media.src = url;
        media.muted = true;
        if (media.tagName === 'IMG') media.loading = 'lazy';
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
