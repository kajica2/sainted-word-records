// versions/_watermark-inject.js — codemod: load lib/watermark.client.js in every
// version renderer so recorded media always carries the SWR mark.
//
// Why: the renderers capture their stage canvas directly
// (`stage.captureStream(fps)`), so the on-page `.swr-watermark` DOM overlay
// never reached the recording — exports came out clean. The injected script
// wraps `captureStream` and paints the mark onto the captured canvas every
// frame (and hides the DOM overlay while live, so the two never stack).
//
// Idempotent: a page already carrying watermark.client.js is skipped.
// Not loaded by any page. Run it manually:
//
//   node versions/_watermark-inject.js --dry-run
//   node versions/_watermark-inject.js
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR = path.dirname(fileURLToPath(import.meta.url));
const MARKER = '<!-- SWR-WATERMARK-MARKER -->';
const TAG = MARKER + '\n<script src="../lib/watermark.client.js"></script>';
const LIB_TAG = /<script src="\.\.\/lib\/[^"]+"[^>]*><\/script>/;

const dry = process.argv.includes('--dry-run');
let injected = 0, skipped = 0;

for (const name of fs.readdirSync(DIR).filter((f) => f.endsWith('.html')).sort()) {
  const file = path.join(DIR, name);
  const src = fs.readFileSync(file, 'utf8');
  if (src.includes('watermark.client.js')) { skipped++; continue; }

  const lines = src.split('\n');
  let last = -1;
  for (let i = 0; i < lines.length; i++) if (LIB_TAG.test(lines[i])) last = i;
  if (last === -1) { console.log(`skip (no ../lib script to anchor to): ${name}`); skipped++; continue; }

  lines.splice(last + 1, 0, TAG);
  if (!dry) fs.writeFileSync(file, lines.join('\n'));
  injected++;
  console.log(`inject: ${name} (after line ${last + 1}: ${lines[last].trim().slice(0, 56)})`);
}

console.log(`\n${dry ? '[dry-run] ' : ''}${injected} page(s) injected, ${skipped} skipped`);
