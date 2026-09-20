// client/library-loader.client.js — shared two-phase library loader
// for engine.html and the 13 versions/*.html pages.
//
// The curated demo library (./library/*) has been removed. This loader
// is now a stub: it fetches the manifest just to confirm the 404, then
// resolves window.__swrPhase2Done immediately. Users bring their own
// assets via the Media Manager upload affordance.
//
// The two-phase load + phase-1/phase-2 IDB seeding logic from the
// original implementation is preserved verbatim — if the manifest ever
// returns a 200 again (e.g. user re-enables the library feature later),
// the loader Just Works without any caller changes.
//
// API surface is unchanged:
//   window.SWR_LIBLOAD.boot({ manifestUrl, filePrefix, phase1Count,
//                             Lib, onPhase1Done, doneFlag })
//   window.__swrPhase2Done — Promise that resolves when phase 2 finishes
//                            (or when the manifest 404s, which is now the
//                            default state).
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

    // Expose phase2Done BEFORE the async work starts so verify-* tests
    // that race to await it don't hang on a missing property.
    let phase2Resolve;
    const phase2Done = new Promise((res) => { phase2Resolve = res; });
    window.__swrPhase2Done = phase2Done;

    if (!Lib || typeof Lib.addFiles !== 'function') {
      // No library to populate; resolve the promise so callers don't hang.
      phase2Resolve();
      return Promise.resolve();
    }

    // Opt-out: pass manifestUrl: null (or empty string) to skip the curated
    // library fetch entirely. The curated demo library was removed from the
    // build (AGENTS.md, 2026-09-13) — versions now hydrate exclusively from
    // user uploads + IDB-persisted items. Skipping the fetch prevents a
    // browser-logged 404 on every page load (BUG-005/012).
    if (!manifestUrl) {
      phase2Resolve();
      return Promise.resolve();
    }

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
        }), { curated: true });
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
            }), { curated: true });
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
