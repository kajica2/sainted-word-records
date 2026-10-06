// api/_lib/kv.js — thin wrapper around @vercel/kv for invite-code storage.
//
// We use @vercel/kv directly (not the local FS / Postgres abstraction in
// db.js) because invite codes are an admin-issued, low-write, high-read
// workload that pairs naturally with a managed KV store, and because we
// want a clean migration story: when Vercel deprecates @vercel/kv and
// routes new projects to Upstash via Marketplace, the only thing that
// changes is the import line below — the kvGet/kvSet/kvDel surface here
// stays identical.
//
// Env: @vercel/kv reads KV_REST_API_URL + KV_REST_API_TOKEN from
// process.env automatically. If either is missing, calls fail with a
// clear error and the API returns 503 — the operator must provision a KV
// store before this endpoint is usable.

import { kv } from '@vercel/kv';

// Schema marker. Bump if the invite-code shape changes incompatibly;
// redeem.js refuses codes stored under a different schemaVersion.
const SCHEMA_VERSION = 1;
const SCHEMA_KEY = 'schemaVersion:invite';

let schemaReady = null;
async function ensureSchema() {
  if (schemaReady) return schemaReady;
  schemaReady = (async () => {
    const current = await kv.get(SCHEMA_KEY);
    if (current == null) {
      await kv.set(SCHEMA_KEY, String(SCHEMA_VERSION));
      return SCHEMA_VERSION;
    }
    const parsed = Number.parseInt(String(current), 10);
    if (parsed !== SCHEMA_VERSION) {
      throw new Error(
        `invite-code schema mismatch: store has v${parsed}, code expects v${SCHEMA_VERSION}`
      );
    }
    return parsed;
  })();
  return schemaReady;
}

// Reset for tests so each unit invocation starts clean.
export function _resetSchemaCache() {
  schemaReady = null;
}

export async function kvGet(key) {
  await ensureSchema();
  return kv.get(key);
}

export async function kvSet(key, value, opts) {
  await ensureSchema();
  return kv.set(key, value, opts);
}

export async function kvDel(key) {
  await ensureSchema();
  return kv.del(key);
}

// Invite-code helpers. The key shape and value shape are owned here
// only — api/invite/redeem.js and scripts/grant-invite.mjs both go
// through these.

const CODE_RE = /^[A-Z0-9]{4,8}(?:-[A-Z0-9]{4,8}){1,3}$/;

export function normalizeCode(raw) {
  if (typeof raw !== 'string') return null;
  const up = raw.trim().toUpperCase();
  if (!CODE_RE.test(up)) return null;
  return up;
}

export function inviteKey(code) {
  return `invite:${code}`;
}

// One-shot random code in the canonical shape (XXXX-XXXX-XXXX).
// Uses crypto.randomBytes for the entropy; the alphabet strips 0/O/1/I
// so codes are copy-paste safe.
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // 32 chars
function randomBlock(len) {
  const buf = new Uint8Array(len);
  // Node 18+ exposes globalThis.crypto; Vercel Functions are Node 20+.
  globalThis.crypto.getRandomValues(buf);
  let out = '';
  for (let i = 0; i < len; i++) out += CODE_ALPHABET[buf[i] % CODE_ALPHABET.length];
  return out;
}

export function generateCode() {
  return `${randomBlock(5)}-${randomBlock(5)}-${randomBlock(5)}`;
}

export async function readInvite(code) {
  return kvGet(inviteKey(code));
}

export async function writeInvite(code, value) {
  return kvSet(inviteKey(code), value);
}

export async function deleteInvite(code) {
  return kvDel(inviteKey(code));
}

// Email → code index. Batch grants write one entry per email so a re-run of
// the same list is idempotent (the existing code is reused instead of a new
// one being minted). The schema marker covers the invite *entry* shape only;
// this index key is additive and does not change that shape.
export function emailIndexKey(email) {
  return `invite:email:${String(email).trim().toLowerCase()}`;
}

export async function readEmailIndex(email) {
  return kvGet(emailIndexKey(email));
}

export async function writeEmailIndex(email, code) {
  return kvSet(emailIndexKey(email), code);
}
