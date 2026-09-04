#!/usr/bin/env node
// scripts/check-auth-unit.mjs — Auth & membership (Stage 2) unit tests.
//
// Tests the membership primitive at the API level. Boots the dev-api
// middleware against the same in-process port the dev server uses, then
// exercises: magic-link signup → verify → session round-trip → profile
// get → tier patch → tier persistence → tier validation. Hits the
// actual HTTP endpoints so we catch import-path bugs the smoke test
// would also catch.
//
// Idempotent: creates a fresh user per run (the email includes the
// timestamp), so repeated runs don't collide.

import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// The dev-api middleware uses an in-process static server + a
// dev-api handler that dynamically imports api/*.js. We re-use the
// same code path by serving from scripts/dev-api.mjs through the
// /api/* middleware.
//
// Port: pick a free one. Avoid 5174 (vite) and 5180 (mv-smoke) and
// 5179 (gif-smoke).
const PORT = 5190;

// Build a tiny Vite-like dev server. We don't actually need Vite —
// the dev-api middleware just needs an HTTP server that routes /api/*
// through the handler. We re-implement the relevant pieces inline to
// keep this test self-contained.
const HANDLER_PATHS = {
  'auth/session':   path.join(ROOT, 'api/auth/session.js'),
  'auth/magic':     path.join(ROOT, 'api/auth/magic.js'),
  'auth/verify':    path.join(ROOT, 'api/auth/verify.js'),
  'users/item':     path.join(ROOT, 'api/users/[id].js'),
};

function pickHandlerPath(urlPath) {
  const segs = urlPath.replace(/^\/+/, '').split('?')[0].split('/');
  if (segs[0] !== 'api') return null;
  if (segs[1] === 'auth' && (segs[2] === 'session' || segs[2] === 'magic' || segs[2] === 'verify')) {
    return HANDLER_PATHS['auth/' + segs[2]];
  }
  if (segs[1] === 'users' && segs[2] && /^[a-f0-9-]{8,40}$/i.test(segs[2])) {
    return HANDLER_PATHS['users/item'];
  }
  return null;
}

const handlerCache = new Map();
async function loadHandler(abs) {
  if (handlerCache.has(abs)) return handlerCache.get(abs);
  const url = require('url').pathToFileURL(abs).href;
  const mod = await import(url);
  const handler = mod.default || mod;
  handlerCache.set(abs, handler);
  return handler;
}

async function readBody(req) {
  return new Promise((resolve) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      if (!raw) return resolve({});
      try { resolve(JSON.parse(raw)); } catch { resolve({}); }
    });
  });
}

function sendJson(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(body));
}

const server = http.createServer(async (req, res) => {
  const handlerPath = pickHandlerPath(req.url);
  if (!handlerPath) return sendJson(res, 404, { error: 'not_found' });
  try {
    const handler = await loadHandler(handlerPath);
    // Wrap req so handlers can read the body (the real middleware
    // exposes readJsonBody; we just attach a parsed body for the
    // session-less profile handler here).
    if (req.method !== 'GET' && req.method !== 'OPTIONS' && req.method !== 'HEAD') {
      req.body = await readBody(req);
    }
    await handler(req, res);
  } catch (e) {
    sendJson(res, 500, { error: 'handler_failed', message: e.message });
  }
});

let failures = 0;
function assert(cond, msg) {
  if (cond) console.log('  ✓', msg);
  else { console.log('  ✗', msg); failures++; }
}

// Wait for server ready
async function waitReady() {
  for (let i = 0; i < 30; i++) {
    try {
      const r = await fetch(`http://localhost:${PORT}/api/auth/session`);
      if (r.ok) return;
    } catch (_) {}
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('server did not start');
}

async function main() {
  await new Promise((r) => server.listen(PORT, r));
  await waitReady();

  const TEST_EMAIL = `auth-unit-${Date.now()}@swr.local`;
  let cookieJar = '';

  // ─── Test 1: magic-link signup ────────────────────────────────────
  console.log('\n=== magic-link signup ===');
  let r = await fetch(`http://localhost:${PORT}/api/auth/magic`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: TEST_EMAIL }),
  });
  let body = await r.json();
  assert(r.ok, 'magic POST returns 2xx');
  assert(body.ok === true, 'magic response is { ok: true }');
  // Read token from disk (dev fallback)
  const verifs = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/auth/verifications.json'), 'utf8'));
  const tokenEntry = verifs.find((v) => v.identifier === TEST_EMAIL);
  assert(!!tokenEntry, 'verification token written to data/auth/verifications.json');

  // ─── Test 2: verify + session cookie ─────────────────────────────
  console.log('\n=== verify + session cookie ===');
  r = await fetch(`http://localhost:${PORT}/api/auth/verify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: TEST_EMAIL, token: tokenEntry.token }),
  });
  body = await r.json();
  assert(r.ok, 'verify POST returns 2xx');
  assert(body.user && body.user.id, 'verify response has user.id');
  assert(body.user.email === TEST_EMAIL, 'verify response email matches');
  assert(body.user.membershipTier === 'free', 'new user defaults to free tier');
  assert(!!body.user.joinedAt, 'new user has joinedAt timestamp');
  const setCookie = r.headers.get('set-cookie');
  assert(setCookie && setCookie.includes('swrc_session'), 'Set-Cookie header includes swrc_session');
  cookieJar = setCookie.split(';')[0]; // first segment = name=value

  // ─── Test 3: session round-trip with cookie ────────────────────────
  console.log('\n=== session round-trip ===');
  r = await fetch(`http://localhost:${PORT}/api/auth/session`, {
    headers: { Cookie: cookieJar },
  });
  body = await r.json();
  assert(body.user && body.user.id, 'GET /session returns user');
  assert(body.user.membershipTier === 'free', 'GET /session returns tier');
  assert(body.user.email === TEST_EMAIL, 'GET /session returns email');

  // ─── Test 4: GET /api/users/[id] public profile ───────────────────
  console.log('\n=== public profile (GET /api/users/[id]) ===');
  const userId = body.user.id;
  r = await fetch(`http://localhost:${PORT}/api/users/${userId}`, {
    headers: { Cookie: cookieJar },
  });
  body = await r.json();
  assert(body.user, 'profile returns user object');
  assert(body.user.id === userId, 'profile id matches');
  assert(body.user.membershipTier === 'free', 'profile includes tier');
  assert(!('email' in body.user), 'public profile does NOT include email');
  assert(!('provider' in body.user), 'public profile does NOT include provider');

  // ─── Test 5: PATCH tier to creator ────────────────────────────────
  console.log('\n=== PATCH tier ===');
  r = await fetch(`http://localhost:${PORT}/api/users/${userId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Cookie: cookieJar },
    body: JSON.stringify({ membershipTier: 'creator' }),
  });
  body = await r.json();
  assert(r.ok, 'PATCH returns 2xx');
  assert(body.user.membershipTier === 'creator', 'tier updated to creator');

  // ─── Test 6: PATCH persists across reads ─────────────────────────
  console.log('\n=== tier persistence ===');
  r = await fetch(`http://localhost:${PORT}/api/users/${userId}`, {
    headers: { Cookie: cookieJar },
  });
  body = await r.json();
  assert(body.user.membershipTier === 'creator', 'tier survives subsequent GET');

  // ─── Test 7: PATCH invalid tier ────────────────────────────────────
  console.log('\n=== PATCH invalid tier rejected ===');
  r = await fetch(`http://localhost:${PORT}/api/users/${userId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Cookie: cookieJar },
    body: JSON.stringify({ membershipTier: 'hacker' }),
  });
  body = await r.json();
  assert(r.status === 400, 'invalid tier returns 400');
  assert(body.error === 'invalid_tier', 'error code is invalid_tier');
  assert(Array.isArray(body.allowed) && body.allowed.includes('free'),
    'response lists allowed tiers');

  // ─── Test 8: PATCH another user's profile is forbidden ────────────
  console.log('\n=== PATCH another user is forbidden ===');
  const otherId = '00000000-0000-4000-8000-000000000001';
  r = await fetch(`http://localhost:${PORT}/api/users/${otherId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Cookie: cookieJar },
    body: JSON.stringify({ membershipTier: 'creator' }),
  });
  body = await r.json();
  assert(r.status === 403, 'PATCH on another user returns 403');
  assert(body.error === 'not_owner', 'error code is not_owner');

  // ─── Test 9: PATCH without session returns 401 ───────────────────
  console.log('\n=== PATCH without session ===');
  r = await fetch(`http://localhost:${PORT}/api/users/${userId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ membershipTier: 'free' }),
  });
  body = await r.json();
  assert(r.status === 401, 'PATCH without session returns 401');

  // ─── Test 10: GET profile without session returns 401 ─────────────
  console.log('\n=== GET profile without session ===');
  r = await fetch(`http://localhost:${PORT}/api/users/${userId}`);
  body = await r.json();
  assert(r.status === 401, 'GET profile without session returns 401');

  // ─── Test 11: PATCH tier back to free ─────────────────────────────
  console.log('\n=== PATCH tier back to free ===');
  r = await fetch(`http://localhost:${PORT}/api/users/${userId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Cookie: cookieJar },
    body: JSON.stringify({ membershipTier: 'free' }),
  });
  body = await r.json();
  assert(r.ok && body.user.membershipTier === 'free', 'tier reverts to free');

  // ─── Test 12: sign out ─────────────────────────────────────────────
  console.log('\n=== sign out ===');
  r = await fetch(`http://localhost:${PORT}/api/auth/session`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookieJar },
    body: JSON.stringify({ action: 'signout' }),
  });
  body = await r.json();
  assert(body.ok, 'signout returns {ok: true}');
  // After signout the cookie should be cleared
  r = await fetch(`http://localhost:${PORT}/api/auth/session`, {
    headers: { Cookie: cookieJar },
  });
  body = await r.json();
  assert(body.user === null, 'session is null after signout (cookie cleared)');

  server.close();
  console.log('\n' + (failures === 0
    ? 'AUTH UNIT: ALL GREEN (12 tests)'
    : `AUTH UNIT: ${failures} failure(s)`));
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  server.close();
  process.exit(2);
});
