// scripts/db.mjs — auth + project store.
//
// This is the backing for auth + projects in the M1 slice. It has one
// optional runtime dependency, `pg`, imported lazily and only when
// DATABASE_URL is set — the filesystem path stays zero-dep. The API is
// shaped to mirror a Prisma-style adapter: the same calls work against
// either the file store or Postgres. Both backends are implemented in
// this module (see the POSTGRES BACKEND section); route handlers do not
// know which is active.
//
// Store layout. With the filesystem backend these are files under
// SWRC_DATA_DIR (default ./data); with Postgres they are `kv` table rows
// whose key is this same relative path minus the `.json` suffix
// (e.g. auth/users, projects/<id>).
//   auth/users.json      [{ id, email, name, image, provider, createdAt }]
//   auth/sessions.json   [{ token, userId, expiresAt }]
//   auth/accounts.json   [{ userId, provider, providerAccountId }]
//   auth/verifications.json [{ identifier, token, expires }]
//   projects/index.json  [{ id, userId, name, updatedAt, deletedAt }]
//   projects/<id>.json   { id, userId, name, doc, updatedAt, deletedAt }
//   storage/<userId>/...  binary blobs keyed by content hash
//
// Document sizes are small and the record count is human-scale, so whole-
// document read-modify-write is acceptable; correctness under concurrency
// comes from withLock(), not from partial updates.
//
// Auth + project state lives in one of two interchangeable backends,
// chosen at module load by env:
//
//   DATABASE_URL set  → Postgres (durable). See the POSTGRES BACKEND
//                       section below for why, and for the locking model.
//   else              → JSON files under SWRC_DATA_DIR.
//
// On Vercel, /var/task is read-only, so the filesystem backend falls back
// to /tmp — which is per-instance and dies with the instance. That is why
// production MUST set DATABASE_URL: without it, sign-ins and saved
// projects are wiped on every cold start. The fallback exists so local dev
// and the test suite work with zero setup.

import { promises as fs } from 'node:fs';
import { existsSync, mkdirSync, readFileSync, writeFileSync, statSync } from 'node:fs';
import { join, dirname, relative, sep } from 'node:path';
import { randomUUID, randomBytes, createHash } from 'node:crypto';

// On Vercel serverless (/var/task is read-only), fall back to /tmp so module
// evaluation doesn't crash on the top-level ensureDir() below. This root is
// only consulted by the filesystem backend — when DATABASE_URL is set the
// store is Postgres and nothing is written here. On Vercel without
// DATABASE_URL, /tmp is per-instance and dies with the instance, so data
// does not survive a cold start; db.js warns loudly in that case.
function pickDataRoot() {
  if (process.env.SWRC_DATA_DIR) return process.env.SWRC_DATA_DIR;
  if (process.env.VERCEL) return '/tmp/swr-data';
  return join(process.cwd(), 'data');
}
const ROOT = pickDataRoot();
const LOCK = join(ROOT, '.lock');

function ensureDir(p) {
  // /var/task may be read-only; swallow EROFS / EACCES so module evaluation
  // succeeds. Writes at runtime will surface real errors via fs.* calls.
  try {
    if (!existsSync(p)) mkdirSync(p, { recursive: true });
  } catch (e) {
    if (e && (e.code === 'EACCES' || e.code === 'EROFS')) return;
    throw e;
  }
}

ensureDir(ROOT);
try { ensureDir(join(ROOT, 'auth')); } catch (_) {}
try { ensureDir(join(ROOT, 'projects')); } catch (_) {}
try { ensureDir(join(ROOT, 'storage')); } catch (_) {}

// ---- Naive file lock (process-local; sufficient for Vercel single-lambda) ----
let lockChain = Promise.resolve();
async function fileWithLock(fn) {
  const next = lockChain.then(async () => {
    if (existsSync(LOCK)) {
      const st = statSync(LOCK);
      // Stale lock (older than 30s) -> ignore
      if (Date.now() - st.mtimeMs < 30_000) {
        await new Promise((r) => setTimeout(r, 25));
      }
    }
    try {
      writeFileSync(LOCK, String(process.pid));
      return await fn();
    } finally {
      try { await fs.unlink(LOCK); } catch {}
    }
  });
  lockChain = next.catch(() => {});
  return next;
}

// ---- JSON helpers (filesystem backend) ----
async function fileReadJson(path, fallback) {
  try {
    const txt = await fs.readFile(path, 'utf8');
    return JSON.parse(txt);
  } catch (e) {
    if (e.code === 'ENOENT') return fallback;
    throw e;
  }
}

async function fileWriteJson(path, obj) {
  ensureDir(dirname(path));
  const tmp = path + '.tmp';
  await fs.writeFile(tmp, JSON.stringify(obj, null, 2));
  await fs.rename(tmp, path);
}

// =====================================================================
// POSTGRES BACKEND (durable)
// =====================================================================
//
// Why this exists: on Vercel every function gets a per-instance /tmp that
// dies with the instance. Users, sessions, verifications and projects all
// live there, so a cold start silently wipes sign-ins and saved projects
// (observed: sign in, then /api/manifest?action=health reports users: 0).
//
// Activated by DATABASE_URL (Neon/Supabase/Vercel Postgres all set one).
// When unset the filesystem backend above is used, which is correct for
// local dev (files persist on disk) and keeps the test suite hermetic.
//
// Design: the store is a single key/value table holding the same JSON
// documents the filesystem held, so the ~30 call sites in this module are
// unchanged. Concurrency is the interesting part.
//
// The previous lock was a process-local promise chain plus a `.lock` file
// — it serialises within ONE warm instance only. Two concurrent requests
// landing on different instances could both read users.json, each append
// a user, and the second write would drop the first. That race exists
// today, independent of cold starts.
//
// Here, withLock() opens a transaction and takes pg_advisory_xact_lock(),
// which is held for the transaction and released automatically on
// COMMIT/ROLLBACK. That is a genuine cross-instance mutex with no TTL to
// tune and no stale-lock path. The transaction client is propagated to
// readJson/writeJson via AsyncLocalStorage, so the guarded read-modify-
// write pair runs on the same connection and sees a consistent snapshot.
//
// All 12 write sites in this module are inside withLock(), which is what
// makes this substitution sound.

// Prisma Postgres (and some other integrations) inject several variables,
// and only SOME are usable here. The `prisma+postgres://` form is an
// Accelerate URL that speaks a different protocol over HTTP — the pg
// driver cannot open it. Vercel marks these variables sensitive, so their
// values cannot be read back to check which is which; pick by scheme
// rather than trusting the name.
function pickDbUrl() {
  const unusable = [];
  for (const name of ['DATABASE_URL', 'POSTGRES_URL', 'PRISMA_DATABASE_URL']) {
    const v = process.env[name];
    if (!v) continue;
    if (/^postgres(ql)?:\/\//i.test(v)) return { url: v, from: name, unusable };
    if (/^prisma\+postgres:\/\//i.test(v)) unusable.push(name);
  }
  return { url: '', from: '', unusable };
}

const DB_URL = pickDbUrl();
const DATABASE_URL = DB_URL.url;

let pgPool = null;
async function getPool() {
  if (pgPool) return pgPool;
  const { default: pg } = await import('pg');
  pgPool = new pg.Pool({
    connectionString: DATABASE_URL,
    // Serverless: each instance should hold very few connections; the
    // provider's pooler (pgBouncer/Neon) does the real multiplexing.
    max: 1,
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 10_000,
    // Managed Postgres (Neon, Supabase, Vercel) terminates TLS with a
    // cert the driver does not verify against a bundled CA.
    ssl: /sslmode=disable/.test(DATABASE_URL) ? false : { rejectUnauthorized: false },
  });
  return pgPool;
}

// Holds the transaction client for the duration of withLock(fn) so the
// read/write helpers below join the same transaction.
const { AsyncLocalStorage } = await import('node:async_hooks');
const txStore = new AsyncLocalStorage();

let schemaReady = null;
function ensureSchema() {
  if (schemaReady) return schemaReady;
  schemaReady = (async () => {
    const pool = await getPool();
    await pool.query(`
      CREATE TABLE IF NOT EXISTS kv (
        key        TEXT PRIMARY KEY,
        value      JSONB NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `);
  })().catch((e) => {
    // Do not cache a failed migration — the next request should retry.
    schemaReady = null;
    throw e;
  });
  return schemaReady;
}

// Stable logical key for a store path, so the key does not depend on
// ROOT (which differs between /tmp/swr-data and ./data).
function kvKey(path) {
  const rel = relative(ROOT, path).split(sep).join('/').replace(/\.json$/, '');
  return rel || 'root';
}

async function pgReadJson(path, fallback) {
  await ensureSchema();
  const key = kvKey(path);
  const client = txStore.getStore() || (await getPool());
  const { rows } = await client.query('SELECT value FROM kv WHERE key = $1', [key]);
  return rows.length ? rows[0].value : fallback;
}

async function pgWriteJson(path, obj) {
  await ensureSchema();
  const key = kvKey(path);
  const client = txStore.getStore() || (await getPool());
  await client.query(
    `INSERT INTO kv (key, value, updated_at) VALUES ($1, $2, now())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
    [key, JSON.stringify(obj)],
  );
}

// Advisory-lock key. One global lock, matching the previous single-chain
// semantics (all mutations serialised). Fine at this volume; per-store
// locks are a trivial follow-up if contention ever matters.
const ADVISORY_LOCK_KEY = 0x5357_5201; // 'SWR' + 1

async function pgWithLock(fn) {
  await ensureSchema();
  const pool = await getPool();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock($1)', [ADVISORY_LOCK_KEY]);
    const result = await txStore.run(client, fn);
    await client.query('COMMIT');
    return result;
  } catch (e) {
    try { await client.query('ROLLBACK'); } catch (_) { /* connection already gone */ }
    throw e;
  } finally {
    client.release();
  }
}

// ---- Backend selection ----
const USE_PG = !!DATABASE_URL;
if (!USE_PG && process.env.NODE_ENV !== 'test' && process.env.VERCEL) {
  if (DB_URL.unusable.length) {
    // eslint-disable-next-line no-console
    console.warn(
      `[db] ${DB_URL.unusable.join(', ')} holds a prisma+postgres:// (Accelerate) URL, which the ` +
      'pg driver cannot open. Falling back to the ephemeral filesystem. Set DATABASE_URL ' +
      'to the DIRECT TCP connection string from the Prisma Postgres dashboard ' +
      '(postgres://…@db.prisma.io:5432/postgres?sslmode=require).',
    );
  } else {
    // eslint-disable-next-line no-console
    console.warn(
      '[db] No Postgres URL is set — auth + project data is on the ephemeral ' +
      'filesystem. Sign-ins and saved projects will NOT survive a cold start.',
    );
  }
}

const withLock = USE_PG ? pgWithLock : fileWithLock;
const readJson = USE_PG ? pgReadJson : fileReadJson;
const writeJson = USE_PG ? pgWriteJson : fileWriteJson;

// ---- ID helpers ----
export function uuid() {
  return randomUUID();
}
export function shortToken(bytes = 24) {
  return randomBytes(bytes).toString('base64url');
}
export function hashKey(s) {
  return createHash('sha256').update(s).digest('hex').slice(0, 32);
}

// =====================================================================
// USERS
// =====================================================================

const USERS_PATH = join(ROOT, 'auth', 'users.json');

export async function findUserByEmail(email) {
  if (!email) return null;
  const users = await readJson(USERS_PATH, []);
  const norm = email.toLowerCase().trim();
  return users.find((u) => u.email.toLowerCase() === norm) || null;
}

export async function findUserByProvider(provider, providerAccountId) {
  if (!provider || !providerAccountId) return null;
  const accounts = await readJson(join(ROOT, 'auth', 'accounts.json'), []);
  const users = await readJson(USERS_PATH, []);
  const acct = accounts.find((a) => a.provider === provider && a.providerAccountId === providerAccountId);
  if (!acct) return null;
  return users.find((u) => u.id === acct.userId) || null;
}

export async function getUser(id) {
  if (!id) return null;
  const users = await readJson(USERS_PATH, []);
  return users.find((u) => u.id === id) || null;
}

export async function createUser({ email, name = null, image = null, provider = 'email' }) {
  if (!email) throw new Error('email required');
  const existing = await findUserByEmail(email);
  if (existing) {
    // Auth & membership (Stage 2): backfill membershipTier on legacy
    // users that pre-date the field. Free tier is the default for any
    // sign-up that doesn't otherwise specify a tier.
    if (!existing.membershipTier) {
      return updateUser(existing.id, { membershipTier: 'free' });
    }
    return existing;
  }
  return withLock(async () => {
    const users = await readJson(USERS_PATH, []);
    if (users.find((u) => u.email.toLowerCase() === email.toLowerCase())) {
      const found = users.find((u) => u.email.toLowerCase() === email.toLowerCase());
      if (!found.membershipTier) {
        return updateUser(found.id, { membershipTier: 'free' });
      }
      return found;
    }
    const user = {
      id: uuid(),
      email: email.toLowerCase().trim(),
      name: name || email.split('@')[0],
      image,
      provider,
      membershipTier: 'free',
      joinedAt: new Date().toISOString(),
      createdAt: new Date().toISOString(),
    };
    users.push(user);
    await writeJson(USERS_PATH, users);
    return user;
  });
}

export async function updateUser(id, patch) {
  return withLock(async () => {
    const users = await readJson(USERS_PATH, []);
    const idx = users.findIndex((u) => u.id === id);
    if (idx === -1) return null;
    users[idx] = { ...users[idx], ...patch, updatedAt: new Date().toISOString() };
    await writeJson(USERS_PATH, users);
    return users[idx];
  });
}

// Auth & membership (Stage 2): set a user's membership tier. Validated
// against a small allow-list so callers can't set arbitrary strings.
// Only the user themselves can change their tier — the call site is
// expected to enforce that by passing userId from requireUser().
export const MEMBERSHIP_TIERS = ['free', 'creator'];
export async function setMembershipTier(userId, tier) {
  if (!MEMBERSHIP_TIERS.includes(tier)) {
    throw new Error(`invalid tier: ${tier}`);
  }
  return updateUser(userId, { membershipTier: tier });
}

// =====================================================================
// ACCOUNTS (provider linkage for OAuth)
// =====================================================================

const ACCOUNTS_PATH = join(ROOT, 'auth', 'accounts.json');

export async function linkAccount({ userId, provider, providerAccountId }) {
  return withLock(async () => {
    const accounts = await readJson(ACCOUNTS_PATH, []);
    if (!accounts.find((a) => a.provider === provider && a.providerAccountId === providerAccountId)) {
      accounts.push({ userId, provider, providerAccountId, linkedAt: new Date().toISOString() });
      await writeJson(ACCOUNTS_PATH, accounts);
    }
  });
}

// =====================================================================
// VERIFICATION TOKENS (magic-link emails)
// =====================================================================

const VERIFS_PATH = join(ROOT, 'auth', 'verifications.json');

export async function createVerificationToken({ identifier, ttlMs = 24 * 60 * 60 * 1000 }) {
  return withLock(async () => {
    const all = await readJson(VERIFS_PATH, []);
    const token = shortToken(32);
    const record = {
      identifier: identifier.toLowerCase().trim(),
      token,
      expires: new Date(Date.now() + ttlMs).toISOString(),
    };
    all.push(record);
    await writeJson(VERIFS_PATH, all);
    return record;
  });
}

export async function consumeVerificationToken({ identifier, token }) {
  return withLock(async () => {
    const all = await readJson(VERIFS_PATH, []);
    const idx = all.findIndex(
      (v) => v.token === token && v.identifier.toLowerCase().trim() === identifier.toLowerCase().trim()
    );
    if (idx === -1) return null;
    const [record] = all.splice(idx, 1);
    await writeJson(VERIFS_PATH, all);
    if (new Date(record.expires).getTime() < Date.now()) return null;
    return record;
  });
}

// =====================================================================
// SESSIONS (server-side; alternative to JWT — easier to revoke)
// =====================================================================

const SESSIONS_PATH = join(ROOT, 'auth', 'sessions.json');

export async function createSession({ userId, ttlMs = 30 * 24 * 60 * 60 * 1000 }) {
  return withLock(async () => {
    const all = await readJson(SESSIONS_PATH, []);
    const session = {
      token: shortToken(32),
      userId,
      expiresAt: new Date(Date.now() + ttlMs).toISOString(),
      createdAt: new Date().toISOString(),
    };
    all.push(session);
    await writeJson(SESSIONS_PATH, all);
    return session;
  });
}

export async function getSession(token) {
  if (!token) return null;
  const all = await readJson(SESSIONS_PATH, []);
  const s = all.find((x) => x.token === token);
  if (!s) return null;
  if (new Date(s.expiresAt).getTime() < Date.now()) return null;
  return s;
}

export async function destroySession(token) {
  return withLock(async () => {
    const all = await readJson(SESSIONS_PATH, []);
    const next = all.filter((x) => x.token !== token);
    await writeJson(SESSIONS_PATH, next);
    return all.length !== next.length;
  });
}

export async function purgeExpiredSessions() {
  return withLock(async () => {
    const all = await readJson(SESSIONS_PATH, []);
    const now = Date.now();
    const next = all.filter((x) => new Date(x.expiresAt).getTime() > now);
    await writeJson(SESSIONS_PATH, next);
    return all.length - next.length;
  });
}

// =====================================================================
// PROJECTS
// =====================================================================

const PROJECTS_INDEX = join(ROOT, 'projects', 'index.json');

function projectPath(id) {
  // Prevent path traversal: only [a-z0-9-]
  if (!/^[a-z0-9-]{8,40}$/i.test(id)) throw new Error('invalid project id');
  return join(ROOT, 'projects', `${id}.json`);
}

export async function listProjects(userId, { includeDeleted = false } = {}) {
  const idx = await readJson(PROJECTS_INDEX, []);
  return idx
    .filter((p) => p.userId === userId && (includeDeleted || !p.deletedAt))
    .sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
}

export async function getProject(userId, id) {
  if (!userId || !id) return null;
  const p = await readJson(projectPath(id), null);
  if (!p) return null;
  if (p.userId !== userId) return null;
  return p;
}

// P3.4 — public share: look up a project by its shareId (no auth).
// Returns the project doc if it has share:true and a matching shareId,
// otherwise null. We strip the userId before returning so the public
// viewer can't see who owns the project.
export async function getSharedProject(shareId) {
  if (!shareId || !/^[a-z0-9_-]{4,24}$/i.test(shareId)) return null;
  const idx = await readJson(PROJECTS_INDEX, []);
  // Linear scan is fine — projects index is per-user only, so we have
  // to read each project file to check shareId. For an MVP this is
  // fine; if the project count grows past a few hundred we'd add a
  // separate shareId → projectId map file.
  for (const entry of idx) {
    if (entry.deletedAt) continue;
    const proj = await readJson(projectPath(entry.id), null);
    if (!proj) continue;
    if (proj.share && proj.shareId === shareId) {
      // Project doc has the audio blob inline (b64) when uploaded. The
      // audio.url we add below is what the viewer reads; we don't
      // transform the existing blob shape. Strip userId for privacy.
      const { userId, ...rest } = proj;
      return rest;
    }
  }
  return null;
}

export async function upsertProject(userId, id, doc) {
  if (!userId) throw new Error('userId required');
  if (!id) id = uuid();
  return withLock(async () => {
    const idx = await readJson(PROJECTS_INDEX, []);
    const now = new Date().toISOString();
    const existing = idx.find((p) => p.id === id);
    const meta = {
      id,
      userId,
      name: (doc && doc.name) || (existing && existing.name) || 'Untitled',
      updatedAt: now,
      deletedAt: existing ? existing.deletedAt : null,
    };
    let nextIdx;
    if (existing) {
      nextIdx = idx.map((p) => (p.id === id ? { ...p, ...meta } : p));
    } else {
      nextIdx = [...idx, meta];
    }
    await writeJson(PROJECTS_INDEX, nextIdx);

    // P3.4 — hoist share/shareId out of `doc` and onto the top-level
    // meta block. The share state is project-level metadata (used by
    // the public viewer at /s/<shareId>), not user-doc content, and
    // keeping it at top level lets getSharedProject() find it without
    // crawling into doc.
    const { share, shareId, ...docOnly } = doc || {};
    const file = {
      ...meta,
      share: !!share,
      shareId: shareId || null,
      doc: docOnly || null,
    };
    await writeJson(projectPath(id), file);
    return meta;
  });
}

export async function softDeleteProject(userId, id) {
  return withLock(async () => {
    const idx = await readJson(PROJECTS_INDEX, []);
    const i = idx.findIndex((p) => p.id === id && p.userId === userId);
    if (i === -1) return false;
    idx[i].deletedAt = new Date().toISOString();
    idx[i].updatedAt = idx[i].deletedAt;
    await writeJson(PROJECTS_INDEX, idx);
    const file = await readJson(projectPath(id), null);
    if (file) {
      file.deletedAt = idx[i].deletedAt;
      await writeJson(projectPath(id), file);
    }
    return true;
  });
}

// =====================================================================
// STORAGE (signed-upload + signed-download)
// =====================================================================
//
// Two backends, selected at module load by env:
//   1. Vercel Blob — active when EITHER auth mode resolves:
//        a. BLOB_READ_WRITE_TOKEN (per-store read-write token), or
//        b. BLOB_STORE_ID + VERCEL_OIDC_TOKEN (OIDC; this is what the
//           Vercel dashboard's "Connect Project" dialog sets up).
//      Blobs persist across cold starts.
//   2. Local filesystem — fallback when neither mode resolves. Keeps
//      `npm run dev` working without a Vercel account. Files live under
//      <SWRC_DATA_DIR>/storage/<userId>/. Ephemeral on Vercel.
//
// Same function signatures either way, so callers + handlers don't care
// which backend is active. Switching requires no code change — set the
// env and restart. The cached USE_BLOB below is computed once at module
// load, so a running server picks up env changes on restart only.

import { put as blobPut, del as blobDel, head as blobHead } from '@vercel/blob';

export function safeKey(key) {
  if (typeof key !== 'string') throw new Error('key required');
  if (key.includes('..') || key.startsWith('/') || key.startsWith('\\')) {
    throw new Error('invalid key');
  }
  // Forbid any backslashes anywhere (Windows-style paths)
  if (key.includes('\\')) throw new Error('invalid key');
  return key.replace(/^\/+/, '');
}

// Parse a Vercel read-write token, validating its shape.
// Format: vercel_blob_rw_<storeId>_<secret>
// Mirrors parseStoreIdFromReadWriteToken() in @vercel/blob, but returns
// null for a malformed value instead of yielding `undefined` for the
// store id and failing later inside the SDK. A truncated or placeholder
// value in the env is common (a half-pasted token) and would otherwise be
// selected silently and then explode on first upload.
function parseReadWriteToken(tok) {
  const segs = String(tok || '').split('_');
  if (segs.length < 5) return null;
  if (segs[0] !== 'vercel' || segs[1] !== 'blob' || segs[2] !== 'rw') return null;
  if (!segs[3]) return null;
  return { storeId: segs[3] };
}

// Resolve Blob credentials and which store they point at.
//
// Vercel names these vars from the "custom environment variable prefix"
// chosen when a store is connected. Details that matter here:
//   - The prefix is USER-SUPPLIED, so its case is whatever was typed:
//     Vercel will happily create blob_, blob2_, or BLOB_. Matching is
//     therefore case-insensitive.
//   - Connecting a further store auto-bumps the prefix (BLOB2, BLOB3, ...)
//     rather than overwriting an existing STORE_ID.
//   - @vercel/blob only reads the exact uppercase names, case-sensitively,
//     so a lowercase set is invisible to it. We resolve ourselves and pass
//     the credentials explicitly on every call.
//
// Two auth modes per store:
//   token: <prefix>_READ_WRITE_TOKEN   (must parse; else ignored)
//   oidc:  <prefix>_STORE_ID + VERCEL_OIDC_TOKEN (platform-injected)
//
// Precedence when several stores are connected: valid tokens first (more
// reliable than OIDC), then the bare prefix over numbered ones, then
// uppercase over lowercase. Deterministic, and never env-iteration order.
function resolveBlobCredentials() {
  const env = process.env;
  const rank = (prefix, suffix) => {
    const digits = suffix ? Number(suffix) || 99 : 0;
    // Bare BLOB/blob outranks BLOB2/blob2; uppercase outranks lowercase.
    const caseRank = /^[A-Z]/.test(prefix) ? 0 : 1;
    return digits * 2 + caseRank;
  };

  const tokens = [];
  const stores = [];
  for (const key of Object.keys(env)) {
    if (!env[key]) continue;
    const tok = /^(blob\d*)_read_write_token$/i.exec(key);
    if (tok) {
      const base = tok[1].toUpperCase();
      const parsed = parseReadWriteToken(env[key]);
      if (parsed) {
        tokens.push({ prefix: base, suffix: tok[1].slice(4), token: env[key], storeId: parsed.storeId });
      } else if (process.env.NODE_ENV !== 'test') {
        // eslint-disable-next-line no-console
        console.warn(`[db] storage: ignoring malformed ${key} (expected vercel_blob_rw_<storeId>_<secret>)`);
      }
    }
    const sid = /^(blob\d*)_store_id$/i.exec(key);
    if (sid) stores.push({ prefix: sid[1].toUpperCase(), suffix: sid[1].slice(4), storeId: env[key] });
  }

  const byRank = (a, b) => rank(a.prefix, a.suffix) - rank(b.prefix, b.suffix);
  tokens.sort(byRank);

  if (tokens.length) {
    const { prefix, token, storeId } = tokens[0];
    return { mode: 'read-write-token', prefix, storeId, extra: { token } };
  }

  const oidcToken = env.VERCEL_OIDC_TOKEN;
  if (oidcToken) {
    stores.sort(byRank);
    if (stores.length) {
      const { prefix, storeId } = stores[0];
      return { mode: 'oidc', prefix, storeId, extra: { oidcToken, storeId } };
    }
  }
  return { mode: 'local-fs', prefix: null, storeId: null, extra: {} };
}

const BLOB_AUTH = resolveBlobCredentials();
const USE_BLOB = BLOB_AUTH.mode !== 'local-fs';
// Credentials to spread into every @vercel/blob call as trailing options,
// so the resolved store wins over the SDK's own env lookup.
const BLOB_OPTS = BLOB_AUTH.extra;

// Exported so diagnostics can report which backend + store is live. The
// fastest way to confirm a Vercel Blob link actually took effect:
//   curl '<host>/api/manifest?action=health'
//   -> "storage": { "mode": "read-write-token", "prefix": "BLOB2", ... }
// 'local-fs' means uploads will not survive a cold start.
export function storageBackend() {
  return {
    mode: BLOB_AUTH.mode,
    // Which env-var prefix supplied the credentials (BLOB, BLOB2, blob, ...).
    prefix: BLOB_AUTH.prefix,
    // The store the credentials point at, when we can tell. Compare this
    // against the dashboard's Blob store id to confirm the right one.
    storeId: BLOB_AUTH.storeId || null,
    persistent: USE_BLOB,
  };
}

if (!USE_BLOB && process.env.NODE_ENV !== 'test') {
  // One-time warning so devs know uploads vanish on cold starts.
  // Use console.warn (not console.log) so it's visible without -v.
  // Skip in test env so the verify suite stays silent.
  // eslint-disable-next-line no-console
  console.warn(
    '[db] storage: local-FS. No usable Blob credentials resolved. Looked for ' +
    'any <prefix>_READ_WRITE_TOKEN (BLOB, blob, BLOB2, blob2, ...) or ' +
    '<prefix>_STORE_ID + VERCEL_OIDC_TOKEN. Uploads will NOT survive a ' +
    'Vercel cold start. Connect a Blob store in the Vercel dashboard, or ' +
    'run `vercel env pull` locally.'
  );
}

export async function createSignedUpload(userId, key, contentType) {
  const safe = safeKey(key);
  const uploadKey = `${userId}/${safe}`;
  // The URL is Vercel-hosted in BOTH backends — the storage layer decides
  // where the bytes actually land (Blob vs local-FS). This keeps the
  // client contract identical across environments and avoids a second
  // upload protocol (Vercel Blob's client-token flow) in the browser.
  return {
    method: 'PUT',
    uploadUrl: `/api/storage/object?key=${encodeURIComponent(uploadKey)}`,
    key: uploadKey,
    contentType: contentType || 'application/octet-stream',
    expiresAt: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
  };
}

export async function readSignedDownload(userId, key) {
  const safe = safeKey(key);
  const downloadKey = key.startsWith(userId + '/') ? key : `${userId}/${safe}`;
  return {
    downloadUrl: `/api/storage/object?key=${encodeURIComponent(downloadKey)}`,
    expiresAt: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
  };
}

export async function storagePut(userId, key, body /* Buffer | Uint8Array | string */, contentType) {
  // `key` may already include the userId prefix (from signed-upload); if not, add it.
  const safe = safeKey(key.startsWith(userId + '/') ? key.slice(userId.length + 1) : key);
  const fullKey = `${userId}/${safe}`;
  if (USE_BLOB) {
    // On Vercel Blob, the client PUTs directly to the signed URL — the
    // server-side put path is only exercised by the local fallback or
    // admin tools. We mirror the body to Blob so storageGet reads see
    // the same bytes regardless of whether the upload came via the
    // signed URL or via direct API calls.
    const buf = Buffer.isBuffer(body) ? body : Buffer.from(body);
    const result = await blobPut(fullKey, buf, {
      access: 'public',
      addRandomSuffix: false,
      allowOverwrite: true,
      contentType: contentType || 'application/octet-stream',
      ...BLOB_OPTS,   // resolved store credentials; must win over env lookup
    });
    return { key: fullKey, size: buf.length, contentType: contentType || 'application/octet-stream', url: result.url };
  }
  const fullPath = join(ROOT, 'storage', userId, safe);
  ensureDir(dirname(fullPath));
  const buf = Buffer.isBuffer(body) ? body : Buffer.from(body);
  await fs.writeFile(fullPath, buf);
  const st = await fs.stat(fullPath);
  return { key: fullKey, size: st.size, contentType: contentType || 'application/octet-stream' };
}

export async function storageGet(userId, key /* may include userId prefix or not */) {
  const safe = safeKey(key.startsWith(userId + '/') ? key.slice(userId.length + 1) : key);
  const fullKey = `${userId}/${safe}`;
  if (USE_BLOB) {
    // Blobs are written with access:'public'; the key contains the user's
    // UUID so it's not enumerable in practice. head() gives us the CDN URL.
    try {
      const stat = await blobHead(fullKey, BLOB_OPTS);
      if (!stat || !stat.url) return null;
      const res = await fetch(stat.url);
      if (!res.ok) return null;
      const ab = await res.arrayBuffer();
      return { body: Buffer.from(ab), size: ab.byteLength };
    } catch (e) {
      return null;
    }
  }
  const fullPath = join(ROOT, 'storage', userId, safe);
  try {
    const buf = await fs.readFile(fullPath);
    return { body: buf, size: buf.length };
  } catch (e) {
    if (e.code === 'ENOENT') return null;
    throw e;
  }
}

export async function storageHead(userId, key) {
  const safe = safeKey(key.startsWith(userId + '/') ? key.slice(userId.length + 1) : key);
  const fullKey = `${userId}/${safe}`;
  if (USE_BLOB) {
    // @vercel/blob head() throws BlobNotFoundError (it does not return
    // null) — catch it and map to the null contract the callers expect.
    try {
      const stat = await blobHead(fullKey, BLOB_OPTS);
      return stat ? { size: stat.size } : null;
    } catch (e) {
      if (e && (e.name === 'BlobNotFoundError' || /not found/i.test(String(e.message)))) return null;
      throw e;
    }
  }
  const fullPath = join(ROOT, 'storage', userId, safe);
  try {
    const st = await fs.stat(fullPath);
    return { size: st.size };
  } catch (e) {
    if (e.code === 'ENOENT') return null;
    throw e;
  }
}

export async function storageDelete(userId, key) {
  const safe = safeKey(key.startsWith(userId + '/') ? key.slice(userId.length + 1) : key);
  const fullKey = `${userId}/${safe}`;
  if (USE_BLOB) {
    try {
      await blobDel(fullKey, BLOB_OPTS);
      return true;
    } catch (e) {
      if (e && /not found/i.test(String(e.message))) return false;
      return false;
    }
  }
  const fullPath = join(ROOT, 'storage', userId, safe);
  try {
    await fs.unlink(fullPath);
    return true;
  } catch (e) {
    if (e.code === 'ENOENT') return false;
    throw e;
  }
}

// =====================================================================
// RATE LIMIT (in-memory; per-lambda in prod, per-process in dev)
// =====================================================================

const rateBuckets = new Map();
export function rateLimit({ key, windowMs = 60_000, max = 60 }) {
  const now = Date.now();
  const bucket = rateBuckets.get(key) || [];
  const fresh = bucket.filter((t) => now - t < windowMs);
  if (fresh.length >= max) {
    return { ok: false, retryAfterMs: windowMs - (now - fresh[0]) };
  }
  fresh.push(now);
  rateBuckets.set(key, fresh);
  return { ok: true, remaining: max - fresh.length };
}

// =====================================================================
// HEALTH
// =====================================================================

export async function health() {
  const ok = existsSync(ROOT);
  const users = await readJson(USERS_PATH, []);
  const sessionsRaw = await readJson(SESSIONS_PATH, []);
  const sessions = Array.isArray(sessionsRaw) ? sessionsRaw.filter((x) => new Date(x.expiresAt) > new Date()) : [];
  const projects = await readJson(PROJECTS_INDEX, []);
  return {
    ok,
    root: ROOT,
    users: Array.isArray(users) ? users.length : 0,
    sessions: sessions.length,
    projects: Array.isArray(projects) ? projects.length : 0,
    // Which auth/project backend resolved at module load. Lets you confirm
    // a DATABASE_URL took effect with a single GET:
    //   curl /api/manifest?action=health
    // 'filesystem' means users/sessions/projects will NOT survive a cold
    // start on Vercel — the `users` count reported above reads 0 after one.
    store: USE_PG ? 'postgres' : 'filesystem',
    // Which storage backend resolved at module load. Lets you confirm a
    // Vercel Blob link took effect with a single GET:
    //   curl /api/manifest?action=health
    // 'local-fs' means uploads will not survive a cold start.
    storage: storageBackend(),
  };
}
