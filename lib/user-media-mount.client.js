// lib/user-media-mount.client.js — wires up the persistent user media
// grid (SWR_MEDIA -> swr-media IDB) on any page that has the matching
// markup: #swr-user-media-grid + #swr-user-media-input +
// #swr-user-media-clear.
//
// Mounts:
//   - + Add (label) opens the file picker; on change, calls
//     SWR_MEDIA.addMedia(files) and refreshes the grid.
//   - per-card × calls SWR_MEDIA.deleteMedia(id).
//   - Clear button calls SWR_MEDIA.deleteAll() after a confirm().
//
// Errors surface via console + window.setStatus when available; on
// QUOTA_EXCEEDED the same offer-to-purge-Library-Hygiene flow as
// engine.html applies (the user can opt into auto-cleanup).
//
// Idempotent + safe to load on every page — if the required DOM
// nodes aren't present, the IIFE bails silently.
//
// Designed to be loaded with defer: <script src="lib/user-media-mount.client.js" defer></script>
// so it runs after DOMContentLoaded but before paint-blocking work.

(function () {
  'use strict';
  if (window.__SWR_USER_MEDIA_MOUNTED__) return;
  window.__SWR_USER_MEDIA_MOUNTED__ = true;

  var grid  = document.getElementById('swr-user-media-grid');
  var input = document.getElementById('swr-user-media-input');
  var clear = document.getElementById('swr-user-media-clear');
  if (!grid) return;

  // ---- onPick: add the clicked item as a layer --------------------------
  // The media-store renderer only wires up click → onPick IF opts.onPick
  // is a function. Without it, thumbnails render with `cursor: pointer`
  // (see media-store.client.js:392) but clicks silently do nothing. We
  // convert the media-store item shape (id/name/mime/blob/thumb) into
  // the engine layer shape (type/url/w/h/duration/rotation) and call
  // window.Layers.add(asset). Layers.add only needs a present `url` and
  // a `type`; w/h/duration are 0 until the asset is drawn (the render
  // loop fills in naturalWidth/naturalHeight from the HTMLMediaElement).
  function pickAsLayer(item) {
    if (!item || !item.blob) return;
    if (typeof window.Layers === 'undefined' || !window.Layers ||
        typeof window.Layers.add !== 'function') {
      if (typeof window.setStatus === 'function') {
        window.setStatus('Layers module not ready', 'err');
      }
      return;
    }
    var isVideo = item.mime && item.mime.indexOf('video/') === 0;
    var url;
    try { url = URL.createObjectURL(item.blob); } catch (e) { url = null; }
    if (!url) {
      if (typeof window.setStatus === 'function') {
        window.setStatus('could not load: blob URL failed', 'err');
      }
      return;
    }
    var layerAsset = {
      id: item.id,
      name: item.name,
      type: isVideo ? 'video' : 'image',
      blob: item.blob,
      url: url,
      thumb: item.thumb || null,
      w: 0, h: 0, duration: 0,
      rotation: 0,
    };
    try {
      window.Layers.add(layerAsset);
      if (typeof window.setStatus === 'function') {
        window.setStatus('♪ ' + (item.name || 'media') + ' → layer', 'ok');
      }
    } catch (err) {
      // Best-effort: revoke the URL we just minted so it doesn't leak.
      try { URL.revokeObjectURL(url); } catch (_) {}
      console.error('[user-media] add-as-layer failed', err, item);
      if (typeof window.setStatus === 'function') {
        window.setStatus('could not load: ' + (err && err.message || err), 'err');
      }
    }
  }

  function refresh() {
    if (!window.SWR_MEDIA) return;
    window.SWR_MEDIA.getUserMedia().then(function (items) {
      window.SWR_MEDIA.render(grid, items, {
        emptyText: 'No media yet. Click + Add to upload images or videos.',
        onPick: pickAsLayer,
      });
    });
  }

  function setStatus(text, kind) {
    if (typeof window.setStatus === 'function') {
      try { window.setStatus(text, kind); } catch (_) { /* best-effort */ }
    }
  }

  if (input) {
    input.addEventListener('change', function (ev) {
      var files = ev.target.files;
      if (!files || !files.length) return;
      if (!window.SWR_MEDIA) {
        console.warn('[user-media] SWR_MEDIA not loaded yet');
        return;
      }
      window.SWR_MEDIA.addMedia(files).then(function (inserted) {
        input.value = ''; // allow re-picking the same file
        console.log('[user-media] added', inserted.length, 'files');
        setStatus('added ' + inserted.length + ' file' + (inserted.length === 1 ? '' : 's'), 'ok');
        refresh();
      }, function (err) {
        console.warn('[user-media] addMedia failed', err);
        if (err && err.code === 'QUOTA_EXCEEDED') {
          setStatus('Storage full — try Library Hygiene or remove some media.', 'err');
          var hygieneBtn = document.getElementById('library-hygiene');
          if (hygieneBtn && typeof window.SWR_LIBRARY_HYGIENE !== 'undefined') {
            var run = window.confirm(
              'Your browser storage is full.\n\n' +
              'You can:\n' +
              '  • Click OK to run Library Hygiene (removes stale entries)\n' +
              '  • Click Cancel and remove some media manually\n\n' +
              'Continue with Library Hygiene?'
            );
            if (run) {
              window.SWR_LIBRARY_HYGIENE.purge().then(function (r) {
                console.log('[user-media] hygiene purged', r.removed, 'stale items');
                setStatus('Purged ' + r.removed + ' stale items. Try adding again.', 'ok');
              }, function (hygErr) {
                console.warn('[user-media] hygiene failed', hygErr);
              });
            }
          }
        } else {
          setStatus('storage error: ' + ((err && err.name) || 'unknown'), 'err');
        }
      });
    });
  }

  if (clear) {
    clear.addEventListener('click', function () {
      if (!window.SWR_MEDIA) return;
      if (!window.confirm('Remove ALL media from your library? This cannot be undone.')) return;
      window.SWR_MEDIA.deleteAll().then(function () {
        refresh();
      }, function (err) {
        console.warn('[user-media] deleteAll failed', err);
      });
    });
  }

  // SWR_MEDIA loads via <script src="lib/media-store.client.js" defer>.
  // By the time this IIFE runs at DOMContentLoaded, that script may
  // not have finished (modules + defer). Poll briefly, then mount.
  function boot() {
    if (window.SWR_MEDIA) { refresh(); return; }
    setTimeout(boot, 30);
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
  } else {
    boot();
  }

  // ---- Cross-tab sync (added 2026-09-20) ---------------------------------
  // Subscribe to SWR_MEDIA.onChange so this tab refreshes when ANOTHER tab
  // adds/deletes media. The originating tab is not notified (per spec),
  // so we won't double-refresh our own writes. We also subscribe to a
  // BroadcastChannel directly so this works even if SWR_MEDIA was loaded
  // by another script and hasn't finished its mutation callback yet.
  if (window.SWR_MEDIA && typeof window.SWR_MEDIA.onChange === 'function') {
    window.SWR_MEDIA.onChange(refresh);
  }
  if (typeof BroadcastChannel === 'function') {
    try {
      var bc = new BroadcastChannel('swr-media');
      bc.onmessage = function () {
        refresh();
      };
    } catch (_) { /* BroadcastChannel unsupported — fall through */ }
  }
})();
