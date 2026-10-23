// versions/_command-center-inject.js — codemod: wire the Studio Command
// Center into every full engine page. Run from the product root:
//
//   node versions/_command-center-inject.js
//
// Idempotent: re-running reports "skipped" for pages already patched.
//
// WHY A CODEMOD AND NOT A <script> IN EVERY PAGE BY HAND
// -------------------------------------------------------
// The 13 names below are the full engine surfaces — the ones with a Layers
// stack, a Library and a live output canvas. The six stub pages (baroque,
// gallery, kraft, mosaic, phosphor, tape) have no Layers, no Library and no
// canvas pipeline; the Command Center would open onto empty panels, so they
// are deliberately excluded — the same allowlist _genops-inject.js uses.
//
// One edit per page: load the Command Center's stylesheet and client script.
// The Command Center renders nothing until it is opened (a ◈ launcher button
// in the corner, or ?cc=1), so a page that never uses it pays one script tag.
//
// The manifest half of the contract lives in versions/manifest.json —
// versions/verify-codemods.mjs re-runs every codemod against a throwaway
// copy of the tree and fails when the record and the tree disagree.

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const ENGINES = [
  'aurora', 'chrome', 'eclipse', 'film', 'fractal', 'glitch', 'grid',
  'hallucination', 'neon', 'pulse', 'smoke', 'void', 'watercolor',
];

const DIR = path.dirname(fileURLToPath(import.meta.url));

// Honour --dry-run: report what a real run would do without writing.
// Only 4 of the 19 codemods in this repo do; the rest write
// unconditionally, which is why versions/verify-codemods.mjs sandboxes
// them instead of trusting a dry run.
const dry = process.argv.includes('--dry-run');

// The LAUNCHER, not the implementation. The implementation is ~47 KB of
// JS plus ~20 KB of CSS, and it is loaded on demand the first time the
// button is used. Injecting the whole thing made every variant's first page
// load carry 67 KB it almost never needs — and it was enough to push
// neon's render loop past the variants smoke's two-frame window (neon is
// walked first, so it eats the cold-start cost).
const JS_TAG = '  <script src="../lib/command-center-launcher.client.js" defer></script>\n';

let patched = 0, skipped = 0, failed = 0;

for (const name of ENGINES) {
  const file = path.join(DIR, name + '.html');
  if (!fs.existsSync(file)) { console.log(`  ${name}.html: MISSING`); failed++; continue; }

  let src = fs.readFileSync(file, 'utf8');
  if (src.includes('command-center-launcher.client.js')) {
    console.log(`  ${name}.html: skipped (already patched)`);
    skipped++;
    continue;
  }
  // Migrate a page patched by the earlier, eager version: drop the
  // stylesheet link (the implementation loads its own CSS on demand) and
  // swap the implementation tag for the launcher.
  if (src.includes('command-center.client.js')) {
    const before = src;
    src = src.replace(/[ \t]*<link rel="stylesheet" href="\.\.\/lib\/command-center\.css" \/>\n?/g, '');
    src = src.replace(
      /<script src="\.\.\/lib\/command-center\.client\.js" defer><\/script>/,
      '<script src="../lib/command-center-launcher.client.js" defer></script>',
    );
    if (src !== before) {
      fs.writeFileSync(file, src);
      console.log(`  ${name}.html: migrated to the lazy launcher`);
      patched++;
      continue;
    }
  }

  const before = src;

  if (/<script src="\.\.\/engine-genops\.client\.js"><\/script>/.test(src)) {
    src = src.replace(
      /(<script src="\.\.\/engine-genops\.client\.js"><\/script>)/,
      '$1\n' + JS_TAG.replace(/\n$/, ''),
    );
  } else if (/<script src="[^"]+" defer><\/script>/.test(src)) {
    src = src.replace(
      /(<script src="[^"]+" defer><\/script>)/,
      '$1\n' + JS_TAG.replace(/\n$/, ''),
    );
  } else if (/<\/body>/.test(src)) {
    src = src.replace('</body>', JS_TAG + '</body>');
  }

  if (src === before) { console.log(`  ${name}.html: failed (no anchor matched)`); failed++; continue; }
  if (!dry) fs.writeFileSync(file, src);
  console.log(`  ${name}.html: patched`);
  patched++;
}

console.log(`\n${dry ? '[dry-run] ' : ''}command-center-inject: ${patched} patched, ${skipped} skipped, ${failed} failed`);
if (failed) process.exit(1);
