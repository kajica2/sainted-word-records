// lib/library-persist.client.js — shared IndexedDB persistence for variants.
//
// Each variants/<name>.html declares its own inline `const Lib = { items: [], nextId: 1, addFiles, render, ... }`.
// This module takes that Lib instance and augments it with persistence:
//   - Lib.addFiles(files, opts) — opts.curated skips IDB write for demo items.
//   - Lib.rm(id)               — deletes from in-memory + IDB.
//   - Lib.hydrate()            — pulls user uploads from IDB on boot.
//
// It also exposes a one-call boot helper (`window.SWR_LIB_PERSIST.boot(Lib)`)
// that handles hydrate-then-Libload ordering so variants don't each need to
// duplicate the orchestration. Variants register the boot by replacing their
// existing __swr_libboot() with a call to this.
//
// Loaded as <script src="../lib/library-persist.client.js" defer></script>
// after client/library-loader.client.js and lib/media-store.client.js.

(function () {
  'use strict';
  if (window.SWR_LIB_PERSIST) return;

  function augment(Lib) {
    if (!Lib || typeof Lib.addFiles !== 'function') return false;

    // ---- Patch addFiles to accept {curated} opts and persist user uploads.
    var _origAddFiles = Lib.addFiles;
    Lib.addFiles = function (files, opts) {
      var curated = !!(opts && opts.curated);
      var inserted = []; // collect items that need persist (post-call)
      var result = _origAddFiles.call(Lib, files);
      // _origAddFiles may be async — if so, attach persistence on settle.
      if (result && typeof result.then === 'function') {
        return result.then(function () {
          persistNewItems(Lib, curated);
          if (Lib.render) Lib.render();
        });
      }
      // Sync path: persist immediately.
      persistNewItems(Lib, curated);
      if (Lib.render) Lib.render();
      return result;
    };

    function persistNewItems(Lib, curated) {
      if (curated) return; // demo content — skip
      if (!window.SWR_MEDIA || !window.SWR_MEDIA.addMedia) return;
      var files = [];
      var items = [];
      for (var i = 0; i < Lib.items.length; i++) {
        var it = Lib.items[i];
        if (it.curated) continue;
        if (it.persistId) continue;          // already persisted
        if (it.persisting) continue;          // in-flight
        if (!it.blob) continue;
        it.persisting = true;
        files.push(it.blob);
        items.push(it);
      }
      if (!files.length) return;
      window.SWR_MEDIA.addMedia(files).then(function (inserted) {
        for (var j = 0; j < inserted.length; j++) {
          if (items[j] && inserted[j] && inserted[j].id) {
            items[j].persistId = inserted[j].id;
          }
          if (items[j]) items[j].persisting = false;
        }
      }, function (err) {
        console.warn('[swr-lib-persist] addMedia failed', err);
        for (var k = 0; k < items.length; k++) items[k].persisting = false;
      });
    }

    // ---- rm: in-memory + IDB + revoke URL.
    Lib.rm = function (id) {
      var it = null;
      for (var i = 0; i < Lib.items.length; i++) {
        if (Lib.items[i].id === id || Lib.items[i].persistId === id) { it = Lib.items[i]; break; }
      }
      Lib.items = Lib.items.filter(function (x) { return x.id !== id && x.persistId !== id; });
      if (it && !it.curated && it.persistId && window.SWR_MEDIA && window.SWR_MEDIA.deleteMedia) {
        window.SWR_MEDIA.deleteMedia(it.persistId).catch(function (err) {
          console.warn('[swr-lib-persist] deleteMedia failed', err);
        });
      }
      try { if (it && it.url) URL.revokeObjectURL(it.url); } catch (_) {}
      if (Lib.render) Lib.render();
    };

    // ---- hydrate: pull user uploads from IDB before Libboot runs.
    Lib.hydrate = function () {
      if (!window.SWR_MEDIA || !window.SWR_MEDIA.getUserMedia) return Promise.resolve();
      return window.SWR_MEDIA.getUserMedia().then(function (records) {
        if (!records || !records.length) return;
        for (var i = 0; i < records.length; i++) {
          var rec = records[i];
          if (!rec || !rec.blob) continue;
          // Skip if already hydrated (shouldn't happen on a fresh boot, but
          // covers the case where boot runs twice).
          var dup = false;
          for (var j = 0; j < Lib.items.length; j++) {
            if (Lib.items[j].persistId === rec.id) { dup = true; break; }
          }
          if (dup) continue;
          var f = rec.blob instanceof File ? rec.blob : new File([rec.blob], rec.name || 'media', { type: rec.mime || 'application/octet-stream' });
          var item = {
            id: Lib.nextId++,
            name: rec.name || f.name,
            type: (rec.mime || '').startsWith('video/') ? 'video' : 'image',
            blob: f,
            url: URL.createObjectURL(f),
            motion: 0, luma: 0.5, hue: 0, w: 0, h: 0,
            added: rec.createdAt || Date.now(),
            thumb: null,
            curated: false,
            persistId: rec.id,
          };
          Lib.items.push(item);
          if (typeof Lib._classify === 'function') Lib._classify(item);
        }
        if (Lib.items.length && Lib.render) Lib.render();
      }, function (err) {
        console.warn('[swr-lib-persist] hydrate failed', err);
      });
    };

    return true;
  }

  // ---- Boot helper: hydrate → Libload → ready.
  // Replaces the variant's __swr_libboot() orchestration.
  function boot(Lib, opts) {
    opts = opts || {};
    if (!window.SWR_LIBLOAD) return Promise.resolve();
    if (typeof Lib === 'undefined' || !Lib) {
      console.warn('[swr-lib-persist] boot called without Lib');
      return Promise.resolve();
    }
    augment(Lib);

    var p = Promise.resolve(Lib.hydrate ? Lib.hydrate() : null);
    if (opts.onHydrated) p = p.then(opts.onHydrated);
    return p.catch(function (err) { console.warn('[swr-lib-persist] hydrate failed', err); })
      .then(function () {
        return window.SWR_LIBLOAD.boot({
          manifestUrl: opts.manifestUrl || '../library/manifest.json',
          filePrefix:  opts.filePrefix  || '../library/',
          phase1Count: opts.phase1Count != null ? opts.phase1Count : 8,
          Lib: Lib,
          doneFlag:    opts.doneFlag    || 'swr-manifest-loaded',
        });
      })
      .then(function () { if (opts.onReady) try { opts.onReady(); } catch (_) {} });
  }

  window.SWR_LIB_PERSIST = { augment: augment, boot: boot };
})();
