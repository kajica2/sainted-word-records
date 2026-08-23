// versions/_genops-inject.js — codemod: wire the generative control system into
// every full engine page. Run from the product root:
//
//   node versions/_genops-inject.js
//
// Idempotent: re-running reports "skipped" for pages already patched.
//
// Two edits per page:
//   1. Load engine-genops.css + engine-genops.client.js.
//   2. Route the page's own randomness through the seeded RNG, so deterministic
//      mode reproduces asset selection and not just parameters (plan Task 3b).
//
// The 13 names below are an explicit allowlist, NOT feature detection. The six
// stub pages (baroque, gallery, kraft, mosaic, phosphor, tape) have no Layers,
// no Library and no canvas pipeline; giving them an action bar would produce a
// control panel with nothing behind it.

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const ENGINES = [
  'aurora', 'chrome', 'eclipse', 'film', 'fractal', 'glitch', 'grid',
  'hallucination', 'neon', 'pulse', 'smoke', 'void', 'watercolor',
];

const DIR = path.dirname(fileURLToPath(import.meta.url));

const CSS_TAG = '  <link rel="stylesheet" href="../engine-genops.css" />\n';
const JS_TAG  = '<script src="../engine-genops.client.js"></script>';

// Declared once inside each page's IIFE; every former Math.random() call site in
// the generative paths goes through it. The guard keeps the page working if the
// module fails to load.
const RND_SHIM =
  "    // Seeded randomness: routed through SWR_GENOPS so deterministic mode\n" +
  "    // reproduces asset selection as well as parameters. Falls back when absent.\n" +
  "    const _rnd = () => (window.SWR_GENOPS ? window.SWR_GENOPS.rand() : Math.random());\n";

let patched = 0, skipped = 0, failed = 0;

for (const name of ENGINES) {
  const file = path.join(DIR, name + '.html');
  if (!fs.existsSync(file)) { console.log(`  ${name}.html: MISSING`); failed++; continue; }

  let src = fs.readFileSync(file, 'utf8');

  // Two independent guards so a partially-patched page can be completed on a
  // later run (e.g. the assets landed but the rng shim's anchor didn't match).
  const hasAssets = src.includes('engine-genops.client.js');
  const hasRng    = src.includes('const _rnd =');
  if (hasAssets && hasRng) {
    console.log(`  ${name}.html: skipped (already patched)`);
    skipped++;
    continue;
  }

  const before = src;

  // --- 1. asset tags ------------------------------------------------------
  if (!hasAssets) {
    if (!src.includes('engine-genops.css')) {
      if (!src.includes('</head>')) { console.log(`  ${name}.html: FAILED (no </head>)`); failed++; continue; }
      src = src.replace('</head>', CSS_TAG + '</head>');
    }

    const presetsTag = '<script src="../versions-presets.js"></script>';
    if (src.includes(presetsTag)) {
      src = src.replace(presetsTag, presetsTag + '\n' + JS_TAG);
    } else if (src.includes('</body>')) {
      src = src.replace('</body>', JS_TAG + '\n</body>');
    } else {
      console.log(`  ${name}.html: FAILED (nowhere to insert the script tag)`);
      failed++;
      continue;
    }
  }

  // --- 2. seeded randomness (plan Task 3b) -------------------------------
  // The shim must be declared before EVERY call site. On several pages
  // __shuffle_once() sits outside the main IIFE, above it, so declaring inside
  // the IIFE leaves that call unresolved (ReferenceError: _rnd is not defined).
  // Anchor on the opening <script> tag of the block holding the engine code so
  // the declaration precedes both the helper and the IIFE.
  const scriptOpen = src.match(/\n[ \t]*<script>\n/);
  const anchor = (scriptOpen && src.includes('const $ = '))
    ? scriptOpen
    : src.match(/^[ \t]*const \$ = \(?id\)? => document\.getElementById\(id\);\n/m);
  if (anchor) {
    src = src.replace(anchor[0], anchor[0] + RND_SHIM);

    // Rewrite Math.random() only inside the generative paths:
    //   __shuffle_once()  — blend-order shuffle
    //   Layers.remap()    — topN pick + weighted candidate pick
    //   the per-layer .rnd handler — blend/opacity/scale/hue/brightness/contrast
    // Leave render-loop jitter (onset micro-shake) on Math.random(): it is
    // per-frame visual noise, not part of a reproducible patch.
    const regions = [
      /function __shuffle_once\([\s\S]*?\n    \}\n/,
      /      remap\(\) \{[\s\S]*?\n      \}\n/,
      /          d\.querySelector\('\.rnd'\)\.addEventListener\([\s\S]*?\n          \}\);\n/,
    ];
    for (const re of regions) {
      const m = src.match(re);
      if (!m) continue;
      src = src.replace(m[0], m[0].replace(/Math\.random\(\)/g, '_rnd()'));
    }
  } else {
    console.log(`  ${name}.html: warn — no $ anchor, seeded-rng shim not inserted`);
  }

  if (src === before) { console.log(`  ${name}.html: no change`); skipped++; continue; }

  fs.writeFileSync(file, src, 'utf8');
  const shim = src.includes('const _rnd =') ? 'rng' : 'no-rng';
  const calls = (src.match(/_rnd\(\)/g) || []).length - 1;  // minus the declaration
  console.log(`  ${name}.html: patched (assets + ${shim}, ${calls} seeded call sites)`);
  patched++;
}

console.log(`\n${patched} patched, ${skipped} skipped, ${failed} failed`);
process.exit(failed ? 1 : 0);
