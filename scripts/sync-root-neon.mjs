#!/usr/bin/env node
// scripts/sync-root-neon.mjs — Emit root neon.html from versions/neon.html.
//
// The canonical NEON renderer lives in versions/neon.html (relative ../ paths).
// Root neon.html is the same page at /neon and /neon.html with absolute paths
// and its own canonical URL — no duplicated engine logic.
//
// Usage:
//   node scripts/sync-root-neon.mjs [--check]
//
// Exit 1 on --check when neon.html would change.

import fs from 'node:fs';
import path from 'node:path';

const SRC = path.join('versions', 'neon.html');
const DST = 'neon.html';
const MARKER = '<!-- SWR-ROOT-NEON-SYNC: generated from versions/neon.html; run node scripts/sync-root-neon.mjs -->';

const CHECK = process.argv.includes('--check');

function transform(src) {
  let out = src.replace(/\.\.\//g, '/');
  out = out.replace(
    /https:\/\/sainted-word-records\.vercel\.app\/versions\/neon/g,
    'https://sainted-word-records.vercel.app/neon',
  );
  out = out.replace(
    /<title>NEON · SWR engine v1<\/title>/,
    '<title>NEON demo · SWR engine</title>',
  );
  if (!out.includes(MARKER)) {
    out = out.replace('<!doctype html>', `<!doctype html>\n${MARKER}`);
  }
  return out;
}

if (!fs.existsSync(SRC)) {
  console.error(`✗ missing ${SRC}`);
  process.exit(1);
}

const next = transform(fs.readFileSync(SRC, 'utf8'));
const prev = fs.existsSync(DST) ? fs.readFileSync(DST, 'utf8') : '';

if (CHECK) {
  if (next !== prev) {
    console.error(`✗ ${DST} is out of sync with ${SRC} — run: node scripts/sync-root-neon.mjs`);
    process.exit(1);
  }
  console.log(`✓ ${DST} in sync with ${SRC}`);
  process.exit(0);
}

if (next !== prev) {
  fs.writeFileSync(DST, next);
  console.log(`✓ wrote ${DST}`);
} else {
  console.log(`✓ ${DST} already up to date`);
}
