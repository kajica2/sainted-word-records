#!/usr/bin/env node
// Write real byte totals into packs/manifest.json.
//
// This used to be done in the browser: packs.html fired a HEAD request for
// every asset in every pack (556 of them on a fresh load) just to render
// "~12.3 MB total" in the note line. HEAD responses report content-length
// for an entity that is never sent, so that loop cost a request storm and
// bought nothing but a number. Compute it here, once, from disk.
//
// Idempotent: safe to re-run after any pack changes.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MANIFEST = path.join(ROOT, 'packs', 'manifest.json');
// Manifest entries are relative to /, and packs.html loads them under the
// site root, so resolve against packs/ using the pack key directory name.
const BASE = path.join(ROOT, 'packs');

const m = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
const bytes = {};
let files = 0;
let missing = 0;

for (const [key, rels] of Object.entries(m.packs || {})) {
  let sum = 0;
  for (const rel of rels) {
    const p = path.join(BASE, rel);
    try {
      sum += fs.statSync(p).size;
      files++;
    } catch {
      missing++;
    }
  }
  bytes[key] = sum;
}

const total = Object.values(bytes).reduce((a, b) => a + b, 0);
m.bytes = { ...bytes, __total: total };

fs.writeFileSync(MANIFEST, JSON.stringify(m, null, 2) + '\n');

console.log(`pack-manifest-bytes: ${files} files across ${Object.keys(bytes).length - 0} packs, ` +
  `${(total / 1048576).toFixed(2)} MB` + (missing ? `, ${missing} missing (counted as 0)` : ''));
