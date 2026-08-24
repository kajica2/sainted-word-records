// scripts/db.mjs — minimal local-first JSON store.
//
// This is the dev/prod backing for auth + projects in the M1 slice. It is
// intentionally zero-dep so the project stays free of runtime dependencies
// (only Vite as a devDependency today). The API is shaped to mirror a
// Prisma-style adapter: same calls work against either this file store or
// a real Postgres client. When M2/M3 add Postgres, swap `STORE` to a
// Prisma-backed implementation; route handlers do not change.
//
// File layout under SWRC_DATA_DIR (default ./data):
//   data/auth/users.json      [{ id, email, name, image, provider, createdAt }]
//   data/auth/sessions.json   [{ token, userId, expiresAt }]
//   data/auth/accounts.json   [{ userId, provider, providerAccountId }]
//   data/auth/verifications.json [{ identifier, token, expires }]
//   data/projects/index.json  [{ id, userId, name, updatedAt, deletedAt }]
//   data/projects/<id>.json   { id, userId, name, doc, updatedAt, deletedAt }
//   data/storage/<userId>/...  binary blobs keyed by content hash
//
// All writes are synchronous (small files; human-scale auth/project count).
// A flock on data/.lock serializes concurrent processes; the API runs
// single-process in dev and per-lambda in prod, so contention is rare.

import { promises as fs } from 'node:fs';
import { existsSync, mkdirSync, readFileSync, writeFileSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { randomUUID, randomBytes, createHash } from 'node:crypto';

const ROOT = process.env.SWRC_DATA_DIR || join(process.cwd(), 'data');
const LOCK = join(ROOT, '.lock');

function ensureDir(p) {
  if (!existsSync(p)) mkdirSync(p, { recursive: true });
}

ensureDir(ROOT);
ensureDir(join(ROOT, 'auth'));
ensureDir(join(ROOT, 'projects'));
ensureDir(join(ROOT, 'storage'));

// ---- Naive file lock (process-local; sufficient for Vercel single-lambda) ----
let lockChain = Promise.resolve();
async function withLock(fn) {
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

// ---- JSON helpers ----
async function readJson(path, fallback) {
  try {
    const txt = await fs.readFile(path, 'utf8');
    return JSON.parse(txt);
  } catch (e) {
    if (e.code === 'ENOENT') return fallback;
    throw e;
  }
}

async function writeJson(path, obj) {
  ensureDir(dirname(path));
  const tmp = path + '.tmp';
  await fs.writeFile(tmp, JSON.stringify(obj, null, 2));
  await fs.rename(tmp, path);
}

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
  if (existing) return existing;
  return withLock(async () => {
    const users = await readJson(USERS_PATH, []);
    if (users.find((u) => u.email.toLowerCase() === email.toLowerCase())) {
      return users.find((u) => u.email.toLowerCase() === email.toLowerCase());
    }
    const user = {
      id: uuid(),
      email: email.toLowerCase().trim(),
      name: name || email.split('@')[0],
      image,
      provider,
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

    const file = {
      ...meta,
      doc: doc || null,
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
// STORAGE (signed-upload + signed-download emulation)
// =====================================================================
//
// We don't have S3 in the dev slice. Instead we expose:
//   - createSignedUpload(userId, key, contentType) → { uploadUrl, key, method, fields }
//     For local: uploadUrl = `/api/storage/upload?key=<userId>/<key>`, method=PUT
//   - readSignedDownload(userId, key) → { downloadUrl, expiresAt }
//     For local: downloadUrl = `/api/storage/object?key=<userId>/<key>}`
// All files live under data/storage/<userId>/.

export function safeKey(key) {
  if (typeof key !== 'string') throw new Error('key required');
  if (key.includes('..') || key.startsWith('/') || key.startsWith('\\')) {
    throw new Error('invalid key');
  }
  // Forbid any backslashes anywhere (Windows-style paths)
  if (key.includes('\\')) throw new Error('invalid key');
  return key.replace(/^\/+/, '');
}

export async function createSignedUpload(userId, key, contentType) {
  const safe = safeKey(key);
  const uploadKey = `${userId}/${safe}`;
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
  const fullPath = join(ROOT, 'storage', userId, safe);
  ensureDir(dirname(fullPath));
  const buf = Buffer.isBuffer(body) ? body : Buffer.from(body);
  await fs.writeFile(fullPath, buf);
  const st = await fs.stat(fullPath);
  return { key: `${userId}/${safe}`, size: st.size, contentType: contentType || 'application/octet-stream' };
}

export async function storageGet(userId, key /* may include userId prefix or not */) {
  const safe = safeKey(key.startsWith(userId + '/') ? key.slice(userId.length + 1) : key);
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
  };
}
