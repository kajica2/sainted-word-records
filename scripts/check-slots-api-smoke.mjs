#!/usr/bin/env node
// scripts/check-slots-api-smoke.mjs — HTTP-level smoke for the video-slot
// ledger API, hermetically.
//
// Boots the same middleware that `npm run dev` uses (scripts/dev-api.mjs
// handleApi) on a plain node:http server with a temp SWRC_DATA_DIR and an
// SWR_ADMIN_EMAILS allow-list. Drives the real grant → register → state flow
// over HTTP, including the auth walls:
//   - POST /api/slots/grant      admin-only; 401 unauth / 403 non-admin
//   - GET  /api/slots            PT-panel sync payload (self)
//   - PUT  /api/slots/<userId>   register videos, server-side quota wall
//   - GET  /api/slots/<userId>   state + grants + registrations (self or admin)
//
// No real sessions are minted through the mail flow — createSession() writes
// the same session row the magic-link verify handler would, and the cookie is
// passed as the browser would send it.
//
// Exit code 0 = all green, 1 = any failure (with reasons on stderr).

import http from 'node:http';
import { strict as assert } from 'node:assert';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const TMP = mkdtempSync(join(tmpdir(), 'swrc-slots-api-'));
process.env.SWRC_DATA_DIR = TMP;
process.env.SWR_ADMIN_EMAILS = 'kadmin@saintedwordrecords.com';

// Import AFTER the env is set — db.js picks its root at module load.
const { handleApi } = await import('./dev-api.mjs');
const db = await import('../api/_lib/db.js');

let failed = 0;
function test(name, fn) {
  return Promise.resolve()
    .then(fn)
    .then(() => process.stdout.write(`  ✓ ${name}\n`))
    .catch((e) => {
      failed += 1;
      process.stderr.write(`  ✗ ${name}\n    ${e.stack || e.message}\n`);
    });
}

const server = http.createServer((req, res) =>
  handleApi(req, res, () => {
    res.statusCode = 404;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ error: 'no_handler' }));
  })
);
await new Promise((r) => server.listen(0, r));
const BASE = 'http://127.0.0.1:' + server.address().port;

async function req(method, path, { body, cookie } = {}) {
  const headers = {};
  if (cookie) headers.Cookie = cookie;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const res = await fetch(BASE + path, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch (_) { /* non-JSON */ }
  return { status: res.status, json, text };
}

// One admin + one customer, each with a real server-side session cookie.
const admin = await db.createUser({ email: 'kadmin@saintedwordrecords.com' });
const adminCookie = `swrc_session=${(await db.createSession({ userId: admin.id })).token}`;
const alice = await db.createUser({ email: 'alice@example.com' });
const aliceCookie = `swrc_session=${(await db.createSession({ userId: alice.id })).token}`;

console.log('slots API smoke:');

// --- admin walls on grant ---
await test('POST /api/slots/grant without a session → 401', async () => {
  const r = await req('POST', '/api/slots/grant', { body: { email: 'x@example.com', slots: 10 } });
  assert.equal(r.status, 401, JSON.stringify(r.json));
});

await test('POST /api/slots/grant as a non-admin → 403', async () => {
  const r = await req('POST', '/api/slots/grant', { body: { email: 'x@example.com', slots: 10 }, cookie: aliceCookie });
  assert.equal(r.status, 403, JSON.stringify(r.json));
  assert.equal(r.json.error, 'forbidden');
});

await test('GET /api/slots/grant (wrong method) → 405 + Allow', async () => {
  const r = await req('GET', '/api/slots/grant', { cookie: adminCookie });
  assert.equal(r.status, 405, JSON.stringify(r.json));
});

// --- grant ---
await test('admin grants 30 slots to alice → 200 with state + grant', async () => {
  const r = await req('POST', '/api/slots/grant', {
    body: { email: 'alice@example.com', slots: 30, note: 'smoke grant' },
    cookie: adminCookie,
  });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(r.json.user.id, alice.id);
  assert.equal(r.json.state.totalSlots, 30);
  assert.equal(r.json.state.granted, 1);
  assert.equal(r.json.state.registered, 0);
  assert.equal(r.json.grant.slots, 30);
  assert.equal(r.json.grant.paid, false);
  assert.equal(r.json.grant.note, 'smoke grant');
});

await test('grant validation: bad email → 400 invalid_email', async () => {
  const r = await req('POST', '/api/slots/grant', { body: { email: 'nope', slots: 10 }, cookie: adminCookie });
  assert.equal(r.status, 400, JSON.stringify(r.json));
  assert.equal(r.json.error, 'invalid_email');
});

await test('grant validation: bad slots → 400 invalid_slots', async () => {
  const r = await req('POST', '/api/slots/grant', { body: { email: 'alice@example.com', slots: 7 }, cookie: adminCookie });
  assert.equal(r.status, 400, JSON.stringify(r.json));
  assert.equal(r.json.error, 'invalid_slots');
  assert.deepEqual(r.json.allowed, [10, 30, 50]);
});

// --- panel sync ---
await test('GET /api/slots (panel sync) for alice → full contract', async () => {
  const r = await req('GET', '/api/slots', { cookie: aliceCookie });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(r.json.email, 'alice@example.com');
  assert.equal(r.json.totalSlots, 30);
  assert.equal(r.json.granted, 1);
  assert.equal(r.json.registered, 0);
  assert.equal(r.json.remaining, 30);
  assert.equal(r.json.grants.length, 1);
  assert.equal(r.json.grants[0].paid, false);
});

await test('GET /api/slots without a session → 401', async () => {
  const r = await req('GET', '/api/slots');
  assert.equal(r.status, 401, JSON.stringify(r.json));
});

// --- register ---
await test('PUT /api/slots/<alice> register 30 → 200, remaining 0', async () => {
  const r = await req('PUT', `/api/slots/${alice.id}`, { body: { count: 30 }, cookie: aliceCookie });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(r.json.state.registered, 30);
  assert.equal(r.json.remaining, 0);
  assert.equal(r.json.registration.count, 30);
  assert.equal(r.json.registration.trial, true, 'registers under the trial marker until Stripe');
});

await test('PUT register over quota → 422 quota_exceeded, state unchanged', async () => {
  const r = await req('PUT', `/api/slots/${alice.id}`, { body: { count: 30 }, cookie: aliceCookie });
  assert.equal(r.status, 422, JSON.stringify(r.json));
  assert.equal(r.json.error, 'quota_exceeded');
  assert.equal(r.json.state.registered, 30, 'failed registration wrote nothing');
});

await test('PUT register invalid count → 400 invalid_count', async () => {
  const r = await req('PUT', `/api/slots/${alice.id}`, { body: { count: 5 }, cookie: aliceCookie });
  assert.equal(r.status, 400, JSON.stringify(r.json));
  assert.equal(r.json.error, 'invalid_count');
});

await test('unsigned register cannot touch another user’s ledger → 401', async () => {
  const r = await req('PUT', `/api/slots/${alice.id}`, { body: { count: 10 } });
  assert.equal(r.status, 401, JSON.stringify(r.json));
});

// --- per-user view ---
await test('GET /api/slots/<alice> (self) → state + grants + registrations', async () => {
  const r = await req('GET', `/api/slots/${alice.id}`, { cookie: aliceCookie });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(r.json.user.id, alice.id);
  assert.equal(r.json.state.totalSlots, 30);
  assert.equal(r.json.state.registered, 30);
  assert.equal(r.json.remaining, 0);
  assert.equal(r.json.grants.length, 1);
  assert.equal(r.json.registrations.length, 1);
  assert.equal(r.json.registrations[0].trial, true);
});

await test('GET /api/slots/<alice> as admin → allowed (view, not mutate)', async () => {
  const r = await req('GET', `/api/slots/${alice.id}`, { cookie: adminCookie });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.equal(r.json.state.totalSlots, 30);
});

await test('GET /api/slots/<admin> as alice → 403 (not self, not admin)', async () => {
  const r = await req('GET', `/api/slots/${admin.id}`, { cookie: aliceCookie });
  assert.equal(r.status, 403, JSON.stringify(r.json));
  assert.equal(r.json.error, 'forbidden');
});

await test('GET /api/slots/<bogus-id> → 400 invalid_id', async () => {
  // (a path-traversal id cannot even reach the server through fetch — the URL
  // is normalized client-side — so the traversal guard is unit-tested instead)
  const r = await req('GET', '/api/slots/not-a-uuid', { cookie: aliceCookie });
  assert.equal(r.status, 400, JSON.stringify(r.json));
  assert.equal(r.json.error, 'invalid_id');
});

// --- a fresh user starts at zero ---
await test('second customer starts at zero and registers cleanly', async () => {
  const bob = await db.createUser({ email: 'bob@example.com' });
  const bobCookie = `swrc_session=${(await db.createSession({ userId: bob.id })).token}`;
  const sync = await req('GET', '/api/slots', { cookie: bobCookie });
  assert.equal(sync.json.totalSlots, 0);
  assert.equal(sync.json.remaining, 0);
  const grant = await req('POST', '/api/slots/grant', {
    body: { email: 'bob@example.com', slots: 10 },
    cookie: adminCookie,
  });
  assert.equal(grant.status, 200, JSON.stringify(grant.json));
  const reg = await req('PUT', `/api/slots/${bob.id}`, { body: { count: 10 }, cookie: bobCookie });
  assert.equal(reg.status, 200, JSON.stringify(reg.json));
  assert.equal(reg.json.remaining, 0);
});

// --- OPTIONS/CORS + method walls ---
await test('OPTIONS on grant and index → 204', async () => {
  const a = await req('OPTIONS', '/api/slots/grant');
  const b = await req('OPTIONS', '/api/slots');
  assert.equal(a.status, 204);
  assert.equal(b.status, 204);
});

await test('POST /api/slots (index) → 405 method_not_allowed', async () => {
  const r = await req('POST', '/api/slots', { body: {}, cookie: aliceCookie });
  assert.equal(r.status, 405, JSON.stringify(r.json));
  assert.equal(r.json.error, 'method_not_allowed');
});

// Cleanup
server.close();
rmSync(TMP, { recursive: true, force: true });

console.log(failed === 0 ? '\nALL GREEN' : `\n${failed} FAILED`);
process.exit(failed === 0 ? 0 : 1);