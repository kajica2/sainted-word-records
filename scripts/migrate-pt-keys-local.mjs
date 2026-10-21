#!/usr/bin/env node
// scripts/migrate-pt-keys-local.mjs — migrate operator-minted PT keys
// from the gitignored local file (pt-keys.local.txt) into the server
// ledger via the /api/admin/pt/keys/import endpoint (FIX 2 part B).
//
// WHY THIS EXISTS
// ---------------
// The audit asked: the watermark must be removed only on a server-
// confirmed `paid` status. The verify endpoint (api/pt/verify.js)
// looks keys up in the server ledger. Stripe-issued keys reach
// the server ledger via api/webhooks/stripe.js. Operator-issued
// keys (from scripts/generate-pt-keys.mjs) currently land in a
// separate file (pt-keys.local.txt, gitignored). Without this
// migration, an operator-minted key would verify as invalid even
// though it IS a paid key — the operator just hasn't pushed it to
// the server yet.
//
// This script is the bridge: it reads the local file, filters
// for valid format, and POSTs to the import endpoint. The endpoint
// is idempotent so re-running is safe.
//
// USAGE
// -----
//   # 1. Set the import secret (must match PT_IMPORT_SECRET in Vercel env)
//   export PT_IMPORT_SECRET='...matching-vercel-env...'
//
//   # 2. Run against production (override the API origin)
//   node scripts/migrate-pt-keys-local.mjs
//     # or with explicit args
//   node scripts/migrate-pt-keys-local.mjs \
//     --api-origin=https://sainted-word-records.vercel.app \
//     --file=./pt-keys.local.txt
//
//   # In dev, the secret is optional (localhost is auto-allowed when
//   # PT_IMPORT_SECRET is unset). Just run:
//   node scripts/migrate-pt-keys-local.mjs
//
// The script reads pt-keys.local.txt (the operator's issuer writes
// one row per minted key in the format `<key>\t<timestamp>`). It
// POSTs only the valid-format keys, never deletes anything, never
// touches the local file. If the same key is imported twice the
// second call skips it.

import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

const args = process.argv.slice(2);
const arg = (name, dflt) => {
  const i = args.indexOf('--' + name);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : dflt;
};

// PT_KEY_RE — same shape as api/_lib/pt-keys.js. Kept in sync
// locally so the migration helper doesn't need to import the
// production module.
const PT_KEY_RE = /^swr-(solo|band|label)-[A-HJ-NP-Z2-9]{8}$/;

const API_ORIGIN = arg('api-origin', 'http://127.0.0.1:5174');
const FILE = arg('file', join(ROOT, 'pt-keys.local.txt'));
const SECRET = process.env.PT_IMPORT_SECRET || arg('secret', null);
const DRY_RUN = args.includes('--dry-run');

if (!existsSync(FILE)) {
  console.error('No local ledger at ' + FILE);
  console.error('Mint keys with: node scripts/generate-pt-keys.mjs');
  process.exit(2);
}

const raw = readFileSync(FILE, 'utf8');
const lines = raw.split('\n').filter(Boolean);
const keys = [];
const skipped = [];
for (const line of lines) {
  const tab = line.indexOf('\t');
  const key = (tab >= 0 ? line.slice(0, tab) : line).trim();
  if (!key) continue;
  if (!PT_KEY_RE.test(key)) {
    skipped.push({ key, reason: 'format invalid' });
    continue;
  }
  keys.push(key);
}

console.log('Found ' + keys.length + ' valid key(s) in ' + FILE);
if (skipped.length) {
  console.log('Skipping ' + skipped.length + ' malformed line(s):');
  for (const s of skipped) console.log('  - ' + s.key + ' (' + s.reason + ')');
}
if (keys.length === 0) {
  console.log('Nothing to import.');
  process.exit(0);
}

if (DRY_RUN) {
  console.log('DRY RUN: would POST ' + keys.length + ' key(s) to ' + API_ORIGIN + '/api/admin/pt/keys/import');
  for (const k of keys) console.log('  - ' + k);
  process.exit(0);
}

const url = API_ORIGIN.replace(/\/$/, '') + '/api/admin/pt/keys/import';
const headers = { 'content-type': 'application/json' };
if (SECRET) headers['x-import-secret'] = SECRET;

const res = await fetch(url, {
  method: 'POST',
  headers,
  body: JSON.stringify({ keys }),
});

const body = await res.json();
console.log('HTTP ' + res.status);
console.log(JSON.stringify(body, null, 2));
process.exit(res.ok && body.ok ? 0 : 1);
