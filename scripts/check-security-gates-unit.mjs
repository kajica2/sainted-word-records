#!/usr/bin/env node
// scripts/check-security-gates-unit.mjs — gates for the 2026-10 security fixes:
//   • dist/data allowlist (no invite CSV or internal PRDs)
//   • control-centre admin-only mutating actions
//   • PATCH /api/users/:id rejects tier self-grant
//   • Drive routes use requireUser(req, res) and honour session auth

import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { ensureDist } from './with-dist.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 5198;

let failures = 0;
function assert(cond, label) {
  if (cond) console.log(`  ok  ${label}`);
  else {
    failures += 1;
    console.error(`FAIL  ${label}`);
  }
}

// ── 1. Build output: data/ allowlist only ───────────────────────────────────
console.log('\n=== dist/data deploy allowlist ===');
await ensureDist();
const distData = path.join(ROOT, 'dist', 'data');
const shipped = fs.existsSync(distData)
  ? fs.readdirSync(distData).filter((f) => !f.startsWith('.'))
  : [];
assert(shipped.length > 0, 'dist/data is non-empty (preset-transitions.json ships)');
assert(
  shipped.every((f) => f === 'preset-transitions.json'),
  `dist/data contains only allowlisted files (got: ${shipped.join(', ') || '(empty)'})`,
);
for (const forbidden of [
  'invite-codes.csv',
  'PRD-sovereign-signal-agent-hub-optimized.md',
  'prd-sovereign-signal-experiments.json',
]) {
  assert(!fs.existsSync(path.join(distData, forbidden)), `dist/data does not ship ${forbidden}`);
}

// ── HTTP fixtures for API gates ─────────────────────────────────────────────
const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'swr-sec-'));
process.env.SWRC_DATA_DIR = DATA_DIR;
process.env.SWR_ADMIN_EMAILS = 'admin@example.com,ops@example.com';

const {
  createUser,
  createSession,
  updateUser,
} = await import(pathToFileURL(path.join(ROOT, 'api/_lib/db.js')).href);

const member = await createUser({ email: 'member@example.com', name: 'Member' });
const adminUser = await createUser({ email: 'admin@example.com', name: 'Admin' });
const memberSession = await createSession({ userId: member.id });
const adminSession = await createSession({ userId: adminUser.id });

await updateUser(member.id, {
  googleDrive: {
    accessToken: 'drive-access-test',
    refreshToken: 'drive-refresh-test',
    tokenExpiry: Date.now() + 3_600_000,
    linkedAt: new Date().toISOString(),
  },
});

const HANDLERS = {
  '/api/control-centre': path.join(ROOT, 'api/control-centre.js'),
  '/api/users/[id]': path.join(ROOT, 'api/users/[id].js'),
  '/api/drive/files': path.join(ROOT, 'api/drive/files.js'),
  '/api/drive/unlink': path.join(ROOT, 'api/drive/unlink.js'),
};
const cache = new Map();
async function loadHandler(abs) {
  if (!cache.has(abs)) {
    const mod = await import(pathToFileURL(abs).href + `?t=${Date.now()}`);
    cache.set(abs, mod.default || mod);
  }
  return cache.get(abs);
}

const realFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  const url = typeof input === 'string' ? input : String(input && input.url);
  if (url.includes('googleapis.com/drive/v3/files')) {
    return {
      ok: true,
      status: 200,
      json: async () => ({ files: [{ id: 'f1', name: 'song.mp3', mimeType: 'audio/mpeg' }] }),
    };
  }
  if (url.startsWith('http://localhost:')) return realFetch(input, init);
  if (url.startsWith('https://api.github.com/')) {
    return { ok: true, status: 200, json: async () => ({ workflow_runs: [] }) };
  }
  throw new Error(`unexpected fetch in security gate: ${url}`);
};

const server = http.createServer(async (req, res) => {
  try {
    const u = new URL(req.url || '/', `http://localhost:${PORT}`);
    let handlerPath = null;
    if (u.pathname === '/api/control-centre') handlerPath = HANDLERS['/api/control-centre'];
    else if (u.pathname.startsWith('/api/users/')) handlerPath = HANDLERS['/api/users/[id]'];
    else if (u.pathname === '/api/drive/files') handlerPath = HANDLERS['/api/drive/files'];
    else if (u.pathname === '/api/drive/unlink') handlerPath = HANDLERS['/api/drive/unlink'];
    if (!handlerPath) {
      res.writeHead(404);
      return res.end('not found');
    }
    const handler = await loadHandler(handlerPath);
    req.query = Object.fromEntries(u.searchParams);
    if (u.pathname.startsWith('/api/users/')) {
      req.query.id = decodeURIComponent(u.pathname.slice('/api/users/'.length));
    }
    await handler(req, res);
  } catch (e) {
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'test_server', message: e.message }));
  }
});

await new Promise((resolve) => server.listen(PORT, resolve));
const base = `http://localhost:${PORT}`;

async function api(path, opts = {}) {
  return fetch(`${base}${path}`, opts);
}

// ── 2. Control centre admin gate ──────────────────────────────────────────
console.log('\n=== control-centre admin gate ===');
let r = await api('/api/control-centre?action=logs');
let body = await r.json();
assert(r.status === 503 || r.status === 401 || r.status === 403,
  `unauthenticated logs is rejected (${r.status})`);

r = await api('/api/control-centre?action=logs', {
  headers: { Cookie: `swrc_session=${memberSession.token}` },
});
body = await r.json();
assert(r.status === 403 && body.error === 'forbidden', 'non-admin session cannot read logs');

r = await api('/api/control-centre?action=logs', {
  headers: { Cookie: `swrc_session=${adminSession.token}` },
});
assert(r.status === 200 && Array.isArray((await r.json()).logs), 'admin session can read logs');

r = await api('/api/control-centre?action=status');
assert(r.status === 200, 'status remains public without session');

// ── 3. Tier self-grant blocked ──────────────────────────────────────────────
console.log('\n=== PATCH tier self-grant ===');
r = await api(`/api/users/${member.id}`, {
  method: 'PATCH',
  headers: {
    'Content-Type': 'application/json',
    Cookie: `swrc_session=${memberSession.token}`,
  },
  body: JSON.stringify({ membershipTier: 'creator' }),
});
body = await r.json();
assert(r.status === 403 && body.error === 'tier_readonly', 'owner cannot PATCH membershipTier');

// ── 4. Drive auth wiring ────────────────────────────────────────────────────
console.log('\n=== Drive route auth ===');
r = await api('/api/drive/files');
body = await r.json();
assert(r.status === 401 && body.error === 'unauthorized', 'drive/files rejects unauthenticated');

r = await api('/api/drive/files', {
  headers: { Cookie: `swrc_session=${memberSession.token}` },
});
body = await r.json();
assert(r.status === 200 && Array.isArray(body.files) && body.files.length === 1,
  'authenticated user with linked Drive can list files');

r = await api('/api/drive/unlink', { method: 'POST' });
body = await r.json();
assert(r.status === 401 && body.error === 'unauthorized', 'drive/unlink rejects unauthenticated');

server.close();

console.log('\n' + (failures === 0
  ? 'SECURITY GATES UNIT: ALL GREEN'
  : `SECURITY GATES UNIT: ${failures} failure(s)`));
process.exit(failures === 0 ? 0 : 1);
