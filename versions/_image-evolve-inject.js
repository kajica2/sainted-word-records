#!/usr/bin/env node
// versions/_image-evolve-inject.js — codemod: wrap each variant's per-layer
// reactive result in SWR_RENDER.imageEvolve() so IMAGE layers drift with a
// seeded Ken Burns exactly like video layers play. The shared module
// (engine-render.client.js) owns imageEvolve() and applies it in frame() for
// the pages whose drawLayer accepts the module's r; this codemod covers the
// pages that recompute r locally inside their own drawLayer.
//
//   node versions/_image-evolve-inject.js
//
// Idempotent: re-runs report "skipped" for pages already patched.

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// The module pages whose drawLayer recomputes r (the pass-through pages —
// smoke, watercolor, grid — are covered by the module patch alone).
const ENGINES = [
  'aurora', 'chrome', 'eclipse', 'film', 'fractal', 'glitch',
  'hallucination', 'neon', 'pulse', 'void',
  'music_video', 'music_video_mtv',
];

const RE = /const r\s*=\s*applyR\(l\);/;
const REP = 'const r = SWR_RENDER.imageEvolve(l, applyR(l));';

let patched = 0, skipped = 0, failed = 0;

for (const name of ENGINES) {
  const file = path.join(__dirname, name + '.html');
  if (!fs.existsSync(file)) { console.log(`  ${name}.html: MISSING`); failed++; continue; }
  let src = fs.readFileSync(file, 'utf8');
  if (src.includes('SWR_RENDER.imageEvolve')) { console.log(`  ${name}.html: already patched — skipped`); skipped++; continue; }
  const before = src;
  src = src.replace(RE, REP);
  if (src === before) { console.log(`  ${name}.html: anchor not found — FAILED`); failed++; continue; }
  fs.writeFileSync(file, src);
  console.log(`  ${name}.html: patched`);
  patched++;
}

console.log(`\nimage-evolve codemod: ${patched} patched, ${skipped} skipped, ${failed} failed`);
process.exit(failed ? 1 : 0);
