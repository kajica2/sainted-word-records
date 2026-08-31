// client/library-loader.client.js — shared two-phase library loader
// for engine.html and the 13 versions/*.html pages.
//
// Phase 1 (boot, blocking): fetch the manifest + first N image thumbs.
//   Fast, cheap decodes. User can drop a song and start playing
//   immediately without waiting on 5 videos to decode.
//
// Phase 2 (idle): videos + remaining thumbs deferred via
//   requestIdleCallback (timeout 5s) with setTimeout(100) fallback.
//   By the time the user opens the library tab the rest is already
//   in IDB.
//
// First-paint payload drops from ~24 MB (manifest + 5 videos + all
// thumbs) to ~1 MB (manifest + 8 thumbs).
//
// Exposes window.__swrPhase2Done — a Promise that resolves when
// phase 2 finishes. Verify tests can `await window.__swrPhase2Done`
// instead of magic-number setTimeouts. The engine.html inline
// loader (commit 36a3fc9 + faff7af) is the predecessor; this file
// extracts the same logic for reuse across versions/*.html.
//
// Usage:
//   <script src="../client/library-loader.client.js" defer></script>
//   <script>
//     SWR_LIBLOAD.boot({
//       manifestUrl: '../library/manifest.json',
//       filePrefix:  '../library/',
//       phase1Count: 8,
//       Lib: window.Lib,         // must expose .addFiles(File[])
//       onPhase1Done: () => { /* optional */ },
//     });
//   </script>

(function () {
  'use strict';
  if (window.SWR_LIBLOAD) return;

  function isImage(name) {
    return /\.(jpe?g|png|webp|gif)$/i.test(name);
  }
  function isVideo(name) {
    return /\.(mp4|webm|mov)$/i.test(name);
  }

  function boot(opts) {
    opts = opts || {};
    var manifestUrl = opts.manifestUrl || './library/manifest.json';
    var filePrefix  = opts.filePrefix  || './library/';
    var phase1Count = (opts.phase1Count | 0) || 8;
    var Lib         = opts.Lib;
    var onPhase1Done = typeof opts.onPhase1Done === 'function' ? opts.onPhase1Done : null;
    var doneFlag     = opts.doneFlag || 'swr-manifest-loaded';

    if (!Lib || typeof Lib.addFiles !== 'function') {
      // No library to populate; resolve the promise so callers don't hang.
      return Promise.resolve();
    }

    let phase2Resolve;
    const phase2Done = new Promise((res) => { phase2Resolve = res; });
    // Expose globally so verify tests can `await window.__swrPhase2Done`
    // instead of guessing timeouts.
    window.__swrPhase2Done = phase2Done;

    return (async () => {
      try {
        const r = await fetch(manifestUrl, { cache: 'no-cache' });
        if (!r.ok) {
          phase2Resolve();
          return;
        }
        const m = await r.json();
        const files = m.files || [];
        const imageFiles = files.filter(isImage);
        const videoFiles = files.filter(isVideo);
        const phase1 = imageFiles.slice(0, phase1Count);
        const phase1Blobs = await Promise.all(phase1.map(async (f) => {
          const fr = await fetch(filePrefix + f);
          return { name: f, blob: await fr.blob() };
        }));
        await Lib.addFiles(phase1Blobs.map(function ({ name, blob }) {
          return new File([blob], name, { type: blob.type });
        }));
        if (onPhase1Done) {
          try { onPhase1Done(); } catch (_) {}
        }

        const phase2Files = imageFiles.slice(phase1Count).concat(videoFiles);
        if (phase2Files.length) {
          const runPhase2 = async () => {
            const blobs = await Promise.all(phase2Files.map(async (f) => {
              const fr = await fetch(filePrefix + f);
              return { name: f, blob: await fr.blob() };
            }));
            await Lib.addFiles(blobs.map(function ({ name, blob }) {
              return new File([blob], name, { type: blob.type });
            }));
            try { localStorage.setItem(doneFlag, '1'); } catch (_) {}
            phase2Resolve();
          };
          if (typeof requestIdleCallback === 'function') {
            requestIdleCallback(() => { runPhase2().catch(() => phase2Resolve()); }, { timeout: 5000 });
          } else {
            setTimeout(() => { runPhase2().catch(() => phase2Resolve()); }, 100);
          }
        } else {
          try { localStorage.setItem(doneFlag, '1'); } catch (_) {}
          phase2Resolve();
        }
      } catch (e) {
        console.warn('[swr-libload] boot failed', e);
        phase2Resolve();
      }
    })();
  }

  window.SWR_LIBLOAD = { boot: boot };
})();
