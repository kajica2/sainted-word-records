// api/_lib/kv.js — thin wrapper around @upstash/redis for invite-code storage.
//
// Vercel KV was sunset Dec 2024; all stores migrated to Upstash Redis.
// We now use @upstash/redis (HTTP-based) which reads UPSTASH_REDIS_REST_URL
// and UPSTASH_REDIS_REST_TOKEN from process.env.
//
// Env:
//   UPSTASH_REDIS_REST_URL   — https://{db-id}.upstash.io
//   UPSTASH_REDIS_REST_TOKEN — the Upstash REST token
// If either is missing, all kv* calls fail with a clear error so the operator
// can fix it instead of leaking a generic 500.

import { Redis } from '@upstash/redis';

const MISSING_URL = !process.env.UPSTASH_REDIS_REST_URL;
const MISSING_TOKEN = !process.env.UPSTASH_REDIS_REST_TOKEN;

function redisClient() {
  if (MISSING_URL || MISSING_TOKEN) {
    const missing = [
      MISSING_URL && 'UPSTASH_REDIS_REST_URL',
      MISSING_TOKEN && 'UPSTASH_REDIS_REST_TOKEN',
    ].filter(Boolean);
    throw new Error(`kv: missing env vars: ${missing.join(', ')}`);
  }
  return new Redis({
    url: process.env.UPSTASH_REDIS_REST_URL,
    token: process.env.UPSTASH_REDIS_REST_TOKEN,
  });
}

function isUpstashError(msg) {
  return (
    /KV_REST_API|KV_|@vercel\/kv|@upstash|upstash|ECONNREFUSED|ENOTFOUND|fetch failed/i.test(
      String(msg)
    )
  );
}

// Schema marker. Bump if the invite-code shape changes incompatibly;
// redeem.js refuses codes stored under a different schemaVersion.
const SCHEMA_VERSION = 1;
const SCHEMA_KEY = 'schemaVersion:invite';

let schemaReady = null;
async function ensureSchema() {
  if (schemaReady) return schemaReady;
  schemaReady = (async () => {
    const client = redisClient();
    let current;
    try {
      current = await client.get(SCHEMA_KEY);
    } catch (e) {
      const msg = String(e && e.message || e);
      if (isUpstashError(msg)) {
        throw Object.assign(new Error('kv_unavailable'), { cause: e });
      }
      throw e;
    }
    if (current == null) {
      await client.set(SCHEMA_KEY, String(SCHEMA_VERSION));
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
  const client = redisClient();
  try {
    return await client.get(key);
  } catch (e) {
    const msg = String(e && e.message || e);
    if (isUpstashError(msg)) {
      throw Object.assign(new Error('kv_unavailable'), { cause: e });
    }
    throw e;
  }
}

export async function kvSet(key, value) {
  await ensureSchema();
  const client = redisClient();
  try {
    return await client.set(key, value);
  } catch (e) {
    const msg = String(e && e.message || e);
    if (isUpstashError(msg)) {
      throw Object.assign(new Error('kv_unavailable'), { cause: e });
    }
    throw e;
  }
}

export async function kvDel(key) {
  await ensureSchema();
  const client = redisClient();
  try {
    return await client.del(key);
  } catch (e) {
    const msg = String(e && e.message || e);
    if (isUpstashError(msg)) {
      throw Object.assign(new Error('kv_unavailable'), { cause: e });
    }
    throw e;
  }
}

// Invite-code helpers. The key shape and value shape are owned here
// only — api/invite/redeem.js and api/invite/register.js both go
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
