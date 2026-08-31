#!/usr/bin/env node
// versions/_canvas-hints-inject.js — codemod: add willReadFrequently
// hint to stage canvas contexts. The per-frame grain effect (and
// any other readback) on the main stage canvas calls getImageData
// every RAF, which triggers Chrome's "Canvas2D: Multiple readback
// operations using getImageData are faster with the willReadFrequently
// attribute set to true" performance warning. Adding the hint at
// context creation time suppresses the warning AND actually speeds
// up the readback.
//
//   node versions/_canvas-hints-inject.js
//
// Idempotent: re-runs report "skipped" for pages already patched.

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const ENGINES = [
  'aurora', 'baroque', 'chrome', 'collage', 'eclipse', 'film',
  'fractal', 'glitch', 'grid', 'hallucination', 'kraft', 'mosaic',
  'neon', 'phosphor', 'pulse', 'smoke', 'spectrum', 'tape',
  'typography', 'void', 'watercolor',
];

// Two patterns to patch:
//   1. stage.getContext('2d', { alpha: false })           — alpha-only
//   2. stage.getContext('2d')                              — no options
// Both should become:
//   stage.getContext('2d', { alpha: false, willReadFrequently: true })
// or:
//   stage.getContext('2d', { willReadFrequently: true })
// We preserve `alpha: false` if present (it matters for compositing).
const RE_ALPHA_ONLY  = /(\bstage\.getContext\(\s*['"]2d['"]\s*,\s*\{\s*alpha:\s*false\s*\})/;
const RE_NO_OPTS     = /(\bstage\.getContext\(\s*['"]2d['"]\s*)(?!\s*,)/;
const REP_ALPHA_ONLY = "stage.getContext('2d', { alpha: false, willReadFrequently: true })";
const REP_NO_OPTS    = "stage.getContext('2d', { willReadFrequently: true })";

let patched = 0, skipped = 0, failed = 0, alreadyPatched = 0;

for (const name of ENGINES) {
  const file = path.join(__dirname, name + '.html');
  if (!fs.existsSync(file)) { console.log(`  ${name}.html: MISSING`); failed++; continue; }
  let src = fs.readFileSync(file, 'utf8');
  const before = src;

  if (src.includes('willReadFrequently: true')) {
    console.log(`  ${name}.html: already patched`);
    alreadyPatched++;
    continue;
  }

  let touched = false;
  if (RE_ALPHA_ONLY.test(src)) {
    src = src.replace(RE_ALPHA_ONLY, REP_ALPHA_ONLY);
    touched = true;
  }
  // The no-options pattern: stage.getContext('2d') with no comma after
  // the '2d' string. We need to insert `, { willReadFrequently: true }`
  // before the closing `)`. The regex captures up to the `'2d'`; the
  // replacement adds the options + closing.
  if (RE_NO_OPTS.test(src)) {
    src = src.replace(RE_NO_OPTS, (match, p1) => p1 + ", { willReadFrequently: true })");
    touched = true;
  }

  if (!touched) {
    console.log(`  ${name}.html: no stage.getContext match`);
    skipped++;
    continue;
  }
  if (src === before) { console.log(`  ${name}.html: no change`); skipped++; continue; }
  fs.writeFileSync(file, src, 'utf8');
  console.log(`  ${name}.html: patched`);
  patched++;
}

console.log(`\n${patched} patched, ${alreadyPatched} already patched, ${skipped} skipped, ${failed} failed`);
process.exit(failed ? 1 : 0);
