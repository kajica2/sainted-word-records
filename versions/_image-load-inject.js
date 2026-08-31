#!/usr/bin/env node
// versions/_image-load-inject.js — codemod: extend the per-frame
// "asset not ready" guard to include image-loaded state. The
// existing guard checks `video.readyState < 2` and skips the
// draw. This adds the equivalent check for images:
// `!image.complete || naturalWidth === 0`. Without it, the render
// loop hits `drawImage` on an image that hasn't finished decoding,
// which throws "HTMLImageElement in 'broken' state" — caught by
// the engine's defensive try/catch but still spams a warning.
//
//   node versions/_image-load-inject.js
//
// Idempotent: re-runs report "skipped" for pages already patched.
// Pattern detection: if the image-ready guard is present, skip.

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const ENGINES = [
  'aurora', 'chrome', 'eclipse', 'film', 'fractal', 'glitch',
  'grid', 'hallucination', 'neon', 'pulse', 'smoke', 'void', 'watercolor',
];

// The guard shape varies slightly between engines (whitespace, quotes,
// spacing around operators). Two main variants:
//   if (a.type==='video' && src.readyState<2) return;
//   if (a.type === 'video' && src.readyState < 2) return;
// We match BOTH (no-spaces and spaced) and replace with a single
// compound guard that covers both video and image.
const VIDEO_GUARD_RE = /if\s*\(\s*a\.type\s*===\s*['"]video['"]\s*&&\s*src\.readyState\s*<\s*2\s*\)\s*return\s*;/;
// Replacement adds an image-loaded check. `a._el.complete` is the
// natural signal: false until the image has loaded (or errored);
// `naturalWidth === 0` catches the broken-image state explicitly.
// Both must be false for the image to be drawable.
const VIDEO_GUARD_REPLACEMENT =
  "if (a.type==='video' && src.readyState<2) return;\n" +
  "      if (a.type==='image' && (!a._el.complete || !a._el.naturalWidth)) return;";

let patched = 0, skipped = 0, failed = 0, alreadyPatched = 0;

for (const name of ENGINES) {
  const file = path.join(__dirname, name + '.html');
  if (!fs.existsSync(file)) { console.log(`  ${name}.html: MISSING`); failed++; continue; }
  let src = fs.readFileSync(file, 'utf8');
  const before = src;

  // Idempotency: a page is "already patched" if its image guard is
  // already present.
  if (src.includes("a._el.naturalWidth")) {
    console.log(`  ${name}.html: already patched`);
    alreadyPatched++;
    continue;
  }

  const m = src.match(VIDEO_GUARD_RE);
  if (!m) {
    console.log(`  ${name}.html: no video guard found (skipping)`);
    skipped++;
    continue;
  }

  src = src.replace(VIDEO_GUARD_RE, VIDEO_GUARD_REPLACEMENT);
  if (src === before) { console.log(`  ${name}.html: no change`); skipped++; continue; }
  fs.writeFileSync(file, src, 'utf8');
  console.log(`  ${name}.html: patched`);
  patched++;
}

console.log(`\n${patched} patched, ${alreadyPatched} already patched, ${skipped} skipped, ${failed} failed`);
process.exit(failed ? 1 : 0);
