#!/usr/bin/env node
// versions/_library-loader-inject.js — codemod: route every engine
// page's library load through the shared client/library-loader.client.js
// (two-phase load). Run from the product root:
//
//   node versions/_library-loader-inject.js
//
// Idempotent: re-runs report "skipped" for pages already patched.
//
// One edit per page:
//   - Replace the synchronous fetch-manifest + Promise.all + addFiles
//     block with a call to SWR_LIBLOAD.boot({ ... }).
//   - The page must already define `Lib` (the inline Library object)
//     before this boot call runs; the script tag for
//     client/library-loader.client.js must be added to <head> so it
//     loads before the page's inline boot block.
//
// The script tag insertion is idempotent: we look for the existing
// tag and add ours only if absent.

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const ENGINES = [
  'aurora', 'chrome', 'eclipse', 'film', 'fractal', 'glitch', 'grid',
  'hallucination', 'neon', 'pulse', 'smoke', 'void', 'watercolor',
];

const LOADER_SCRIPT_TAG = '<script src="../client/library-loader.client.js" defer></script>';

const BOOT_REPLACEMENT = `    (function () {
      if (window.SWR_LIBLOAD && window.Lib) {
        // Two-phase: manifest + first 8 image thumbs synchronously,
        // videos + remaining thumbs deferred to idle time. See
        // client/library-loader.client.js for the implementation.
        // window.__swrPhase2Done resolves when phase 2 finishes
        // (verify tests can await it instead of magic setTimeouts).
        window.SWR_LIBLOAD.boot({
          manifestUrl: '../library/manifest.json',
          filePrefix:  '../library/',
          phase1Count: 8,
          Lib: window.Lib,
          doneFlag: 'swr-manifest-loaded',
        }).then(() => { try { Layers.remap(); } catch (_) {} });
      }
    })();`;

let patched = 0, skipped = 0, failed = 0;

for (const name of ENGINES) {
  const file = path.join(__dirname, name + '.html');
  if (!fs.existsSync(file)) { console.log(`  ${name}.html: MISSING`); failed++; continue; }

  let src = fs.readFileSync(file, 'utf8');
  const before = src;

  // Inject the script tag in <head> (idempotent)
  if (!src.includes('client/library-loader.client.js')) {
    if (!src.includes('</head>')) { console.log(`  ${name}.html: no </head>`); failed++; continue; }
    // Place next to the other client/ script tags for tidy grouping;
    // fall back to right before </head>.
    const anchor = '<script src="../client/visualizer-controller.js"';
    if (src.includes(anchor)) {
      src = src.replace(anchor, LOADER_SCRIPT_TAG + '\n' + anchor);
    } else {
      src = src.replace('</head>', LOADER_SCRIPT_TAG + '\n</head>');
    }
  }

  // Replace the synchronous library boot block.
  if (src.includes("window.SWR_LIBLOAD.boot")) {
    // already done
  } else {
    // Match the IIFE that contains the synchronous fetch. Each engine has
    // slight wording differences; match the broadest common shape:
    //   (async () => {
    //     try {
    //       const r = await fetch('../library/manifest.json'...);
    //       ...
    //       await Lib.addFiles(...);
    //       setTimeout(() => Layers.remap(), 500);
    //     } catch (e) { ... }
    //     // === Auto-load default audio ===
    //
    // Capture from "=== Auto-load library ===" (or the manifest fetch
    // start) up to (but not including) "=== Auto-load default audio ==="
    // OR (if no separator) up to the next "try {" block.
    const blockRe = /(    \/\/ === Auto-load library ===\n    \(async \(\) => \{\n[\s\S]*?\n    \}\)\(\);)\n(\s*)(\/\/ === Auto-load default audio ===|\/\/ === Auto-load)/;
    const m = src.match(blockRe);
    if (m) {
      const lead = m[2]; // whitespace before the next section comment
      src = src.replace(m[1], BOOT_REPLACEMENT);
    } else {
      // Try the simpler shape — just the async IIFE without the // ===
      // separator. The "=== Auto-load default audio ===" anchor is the
      // most reliable marker across all 13 pages.
      const simplerRe = /(    \(async \(\) => \{\n      try \{\n        const r = await fetch\('\.\.\/library\/manifest\.json'[\s\S]*?\n    \}\)\(\);)/;
      const m2 = src.match(simplerRe);
      if (m2) {
        src = src.replace(m2[1], BOOT_REPLACEMENT);
      } else {
        console.log(`  ${name}.html: no matchable library boot block`);
        failed++;
        continue;
      }
    }
  }

  if (src === before) { console.log(`  ${name}.html: no change`); skipped++; continue; }
  fs.writeFileSync(file, src, 'utf8');
  console.log(`  ${name}.html: patched`);
  patched++;
}

console.log(`\n${patched} patched, ${skipped} skipped, ${failed} failed`);
process.exit(failed ? 1 : 0);
