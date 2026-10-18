// api/admin/pt/keys/import.js — operator-minted PT key import (FIX 2 part B).
//
// FIX 2 of the architecture audit asked for "the watermark is removed
// only on a server-confirmed `paid` status. The mock-mode localStorage
// flag is bypassable; this isn't."
//
// The verify endpoint (api/pt/verify.js) looks keys up in the server
// ledger. The Stripe webhook (api/webhooks/stripe.js) writes to that
// ledger. Operator-minted keys (scripts/generate-pt-keys.mjs, writing
// to the gitignored pt-keys.local.txt) are NOT in the server ledger
// — that's the half-migration risk. This endpoint lets the operator
// bulk-import the local file into the server ledger so a single
// verify call covers both Stripe and operator keys.
//
// Auth: this is a destructive write (operator-mints count as paid
// grants without a Stripe payment). The audit suggested this lives
// behind an admin secret. We require `x-import-secret` to match
// `process.env.PT_IMPORT_SECRET` (set in Vercel env for production;
// not required in dev so local imports work). A failed match is a
// 401 with no further detail.
//
// Endpoint: POST /api/admin/pt/keys/import
// Headers: x-import-secret: <secret>
// Body (JSON):
//   { "keys": [ { "key": "swr-band-A1B2C3D4", "tier": "band" }, ... ] }
//
// Or a flat array:
//   { "keys": [ "swr-band-A1B2C3D4", ... ] }  (tier is parsed from the key)
//
// Response:
//   { ok: true,
//     imported: N,
//     skipped:   K,
//     errors:    [{ key, error }] }
//
// Idempotency: importing the same key twice does not double-count.
// We dedupe by key inside the withLock that readJson/writeJson
// share.

import { sendJson, setCors } from '../../../_lib/http.js';
import { withLock, readJson, writeJson, DATA_ROOT } from '../../../_lib/db.js';
import { PT_KEY_RE, PT_TIERS, listPtKeysForUser } from '../../../_lib/pt-keys.js';
import { join } from 'node:path';

const KEYS_INDEX = join(DATA_ROOT, 'pt-keys');
const INDEX_FILE = join(KEYS_INDEX, 'index.json');
const UUID_RE = /^[a-f0-9-]{8,40}$/i;

function parseTierFromKey(key) {
  if (typeof key !== 'string') return null;
  const m = PT_KEY_RE.exec(key.trim());
  return m ? m[1].toLowerCase() : null;
}

function isAuthorized(req) {
  const expected = process.env.PT_IMPORT_SECRET;
  if (!expected) {
    // No secret configured. In dev the operator imports by hand
    // (process.env.PT_IMPORT_SECRET isn't set locally). Allow
    // localhost so dev works; reject everything else.
    const ip = (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').toString().split(',')[0].trim();
    if (ip === '127.0.0.1' || ip === '::1' || ip === 'localhost' || ip.startsWith('::ffff:127.')) {
      return true;
    }
    return false;
  }
  const got = req.headers['x-import-secret'];
  return typeof got === 'string' && got === expected;
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let total = 0;
    const chunks = [];
    req.on('data', (c) => {
      total += c.length;
      if (total > 2_000_000) {
        reject(new Error('body too large'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function parseKeysPayload(parsed) {
  // Accept {keys: [...]} or {keys: [...]} where each entry is
  // either a string (key only) or {key, tier, [email], [sessionId]}.
  const out = [];
  const keys = (parsed && Array.isArray(parsed.keys)) ? parsed.keys : null;
  if (!keys) return { ok: false, error: 'body must be {keys: [...]}' };
  for (const entry of keys) {
    if (typeof entry === 'string') {
      out.push({ key: entry, tier: parseTierFromKey(entry) });
    } else if (entry && typeof entry === 'object' && entry.key) {
      out.push({
        key: String(entry.key).trim(),
        tier: entry.tier || parseTierFromKey(entry.key),
        email: entry.email || null,
        sessionId: entry.sessionId || null,
        slots: entry.slots || null,
      });
    } else {
      out.push({ key: null, error: 'invalid entry' });
    }
  }
  return { ok: true, items: out };
}

function genId() {
  // Simple ID: 12 random bytes hex. Doesn't need to be RFC4122 — this
  // is a local record id, not a UUID.
  const chars = '0123456789abcdef';
  let s = '';
  for (let i = 0; i < 24; i++) s += chars[Math.floor(Math.random() * 16)];
  return s;
}

export default async function handler(req, res) {
  setCors(res, req.headers.origin);

  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    return res.end();
  }
  if (req.method !== 'POST') {
    return sendJson(res, 405, { ok: false, error: 'method not allowed' });
  }

  if (!isAuthorized(req)) {
    return sendJson(res, 401, { ok: false, error: 'unauthorized' });
  }

  let body;
  try { body = await readBody(req); }
  catch (e) { return sendJson(res, 400, { ok: false, error: 'read body failed: ' + e.message }); }

  let parsed;
  try { parsed = JSON.parse(body); }
  catch (e) { return sendJson(res, 400, { ok: false, error: 'invalid JSON' }); }

  const input = parseKeysPayload(parsed);
  if (!input.ok) {
    return sendJson(res, 400, { ok: false, error: input.error });
  }

  // Validate each entry; queue the ones that pass.
  const valid = [];
  const errors = [];
  for (const it of input.items) {
    if (!it.key) { errors.push({ key: null, error: it.error || 'missing key' }); continue; }
    if (!PT_KEY_RE.test(it.key.trim())) {
      errors.push({ key: it.key, error: 'key format invalid' }); continue;
    }
    if (!it.tier || !PT_TIERS[it.tier]) {
      errors.push({ key: it.key, error: 'tier unknown or missing' }); continue;
    }
    valid.push({
      key: it.key.trim(),
      tier: it.tier,
      email: it.email,
      sessionId: it.sessionId || 'operator-import',
      slots: it.slots || PT_TIERS[it.tier].slots,
    });
  }

  // Idempotent import: dedupe by key inside the lock. If a key
  // already exists in the ledger, skip the new import for that key
  // and report it as skipped (not an error — the operator may be
  // re-running the import on the same file).
  const result = await withLock(async () => {
    const index = await readJson(INDEX_FILE, []);
    const existing = new Map();
    for (const r of (Array.isArray(index) ? index : [])) {
      if (r && r.key) existing.set(r.key.toLowerCase(), r);
    }
    const skipped = [];
    const toAdd = [];
    for (const v of valid) {
      if (existing.has(v.key.toLowerCase())) {
        skipped.push(v.key);
        continue;
      }
      toAdd.push({
        id: genId(),
        key: v.key,
        tier: v.tier,
        userId: v.email ? 'op:' + v.email : 'op:imported',
        email: v.email,
        sessionId: v.sessionId,
        slots: v.slots,
        createdAt: new Date().toISOString(),
        source: 'operator-import',
      });
      existing.set(v.key.toLowerCase(), toAdd[toAdd.length - 1]);
    }
    if (toAdd.length === 0) {
      return { added: 0, skipped: skipped.length, skippedKeys: skipped };
    }
    index.push(...toAdd);
    await writeJson(INDEX_FILE, index);
    return { added: toAdd.length, skipped: skipped.length, skippedKeys: skipped };
  });

  return sendJson(res, 200, {
    ok: true,
    imported: result.added,
    skipped: result.skipped,
    skippedKeys: result.skippedKeys,
    errors,
  });
}
