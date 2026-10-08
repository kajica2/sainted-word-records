// api/_lib/kv.js — the invite-code store.
//
// Backing store history, because two sunsets got us here:
//   Vercel KV   → sunset Dec 2024, everything migrated to Upstash Redis.
//   Upstash     → an agent-provisioned database is deleted in days unless
//                 an account claims it, and claiming needs a human login.
// Neither is a durable home for codes people are meant to redeem months
// later, so the store now goes through the same backend-transparent JSON
// layer that already holds auth, sessions, projects and the slot ledger
// (api/_lib/db.js):
//
//   DATABASE_URL set → Postgres, the `kv` table. This is what production
//                      and preview run — confirm with one GET:
//                        curl /api/manifest?action=health  → "store":"postgres"
//   else             → JSON files under SWRC_DATA_DIR (./data locally;
//                      /tmp on Vercel, which is per-instance and dies with
//                      the instance — correct for local dev and the test
//                      suite, never the production path).
//
// No new env vars, no new account, nothing to claim before it expires.
//
// Key shape and value shape are owned here and only here —
// api/invite/redeem.js, api/invite/register.js and scripts/grant-invite.mjs
// all go through these helpers. Keys map onto paths under
// <ROOT>/invite-store/, and every path segment is encodeURIComponent'd so
// the mapping is reversible and can never contain a separator (`invite:`
// keys are validated by normalizeCode before they get here, but path
// builders never trust their input):
//
//   invite:<CODE>        → invite-store/codes/<CODE>.json
//   invite:email:<addr>  → invite-store/emails/<addr>.json
//   schemaVersion:invite → invite-store/schema.json
//
// Failure mode: a store-level outage (Postgres unreachable, disk error)
// throws Error('kv_unavailable'), which the invite handlers map to 503 —
// deliberately distinct from "code not found" (404) so an operator can
// tell a broken store from a bad code in their logs.

import { join } from 'node:path';
import { readJson, writeJson, deleteJson, DATA_ROOT } from './db.js';

const INVITE_PREFIX = 'invite:';
const EMAIL_PREFIX = 'invite:email:';
const STORE_ROOT = join(DATA_ROOT, 'invite-store');

// Schema marker. Bump if the invite-entry shape changes incompatibly;
// redeem.js refuses codes stored under a different schemaVersion.
const SCHEMA_VERSION = 1;
const SCHEMA_KEY = 'schemaVersion:invite';

function storePath(key) {
  // Order matters: an email key also starts with INVITE_PREFIX.
  if (key === SCHEMA_KEY) return join(STORE_ROOT, 'schema.json');
  if (key.startsWith(EMAIL_PREFIX)) {
    return join(STORE_ROOT, 'emails', encodeURIComponent(key.slice(EMAIL_PREFIX.length)) + '.json');
  }
  if (key.startsWith(INVITE_PREFIX)) {
    return join(STORE_ROOT, 'codes', encodeURIComponent(key.slice(INVITE_PREFIX.length)) + '.json');
  }
  return join(STORE_ROOT, encodeURIComponent(key) + '.json');
}

// Transport-level failures only. A corrupt document (JSON parse error) or a
// schema mismatch must NOT be reported as "unavailable" — those are real
// errors the operator needs to see, not a retry-later condition.
const UNAVAILABLE_RE = new RegExp(
  [
    'ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN', 'ETIMEDOUT', 'ECONNRESET', 'EPIPE',
    'getaddrinfo', 'Connection terminated', 'Connection refused', 'Connection ended',
    'timeout expired', 'no pg_hba', 'password authentication failed',
    'Client has encountered a connection error', 'closed the connection unexpectedly',
    'fetch failed', 'EACCES', 'EROFS', 'ENOSPC',
  ].join('|'),
  'i'
);

function mapStoreError(e) {
  const msg = String((e && e.message) || e);
  if (msg === 'kv_unavailable') return e;
  if (UNAVAILABLE_RE.test(msg)) {
    return Object.assign(new Error('kv_unavailable'), { cause: e });
  }
  return e;
}

// Raw single-key ops — no schema guard, so ensureSchema() itself can use them.
async function storeGet(key) {
  try {
    return await readJson(storePath(key), null);
  } catch (e) {
    throw mapStoreError(e);
  }
}

async function storeSet(key, value) {
  try {
    // One write, one atomic step on either backend: a single upsert on
    // Postgres, tmp+rename on the filesystem. No withLock() — see the note
    // on db.js's export for why a nested lock would deadlock the max:1 pool.
    await writeJson(storePath(key), value);
    return value;
  } catch (e) {
    throw mapStoreError(e);
  }
}

async function storeDel(key) {
  try {
    return await deleteJson(storePath(key));
  } catch (e) {
    throw mapStoreError(e);
  }
}

let schemaReady = null;
async function ensureSchema() {
  if (schemaReady) return schemaReady;
  schemaReady = (async () => {
    const current = await storeGet(SCHEMA_KEY);
    if (current == null) {
      await storeSet(SCHEMA_KEY, String(SCHEMA_VERSION));
      return SCHEMA_VERSION;
    }
    const parsed = Number.parseInt(String(current), 10);
    if (parsed !== SCHEMA_VERSION) {
      throw new Error(
        `invite-code schema mismatch: store has v${parsed}, code expects v${SCHEMA_VERSION}`
      );
    }
    return parsed;
  })().catch((e) => {
    // Do not cache a failed migration — the next request should retry,
    // and a cold start must not be poisoned by one transient outage.
    schemaReady = null;
    throw e;
  });
  return schemaReady;
}

// Reset for tests so each unit invocation starts clean.
export function _resetSchemaCache() {
  schemaReady = null;
}

export async function kvGet(key) {
  await ensureSchema();
  return storeGet(key);
}

export async function kvSet(key, value) {
  await ensureSchema();
  return storeSet(key, value);
}

export async function kvDel(key) {
  await ensureSchema();
  return storeDel(key);
}

// Invite-code helpers.

const CODE_RE = /^[A-Z0-9]{4,8}(?:-[A-Z0-9]{4,8}){1,3}$/;

export function normalizeCode(raw) {
  if (typeof raw !== 'string') return null;
  const up = raw.trim().toUpperCase();
  if (!CODE_RE.test(up)) return null;
  return up;
}

export function inviteKey(code) {
  return `${INVITE_PREFIX}${code}`;
}

// One-shot random code in the canonical shape (XXXXX-XXXXX-XXXXX).
// Uses crypto.getRandomValues for the entropy; the alphabet strips 0/O/1/I
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
  return `${INVITE_PREFIX}email:${String(email).trim().toLowerCase()}`;
}

export async function readEmailIndex(email) {
  return kvGet(emailIndexKey(email));
}

export async function writeEmailIndex(email, code) {
  return kvSet(emailIndexKey(email), code);
}
