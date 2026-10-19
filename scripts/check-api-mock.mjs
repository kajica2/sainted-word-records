#!/usr/bin/env node
// scripts/check-api-mock.mjs — gate for the in-process + HTTP mock
// server (stage 3 of the easy-testing & integration API plan).
//
// Verifies the mock contract:
//   1. Imports + registers defaults without throwing.
//   2. handle() returns the canned success body for every default
//      route.
//   3. handle() returns the canonical ErrorBody envelope for invalid
//      input (mock and real handler agree on shape).
//   4. handle() returns 404 + { error: 'no_mock_route' } for unknown
//      routes.
//   5. handle() honours the per-call `override` knob (test-specific
//      canned / status / errorCode).
//   6. start() / close() lifecycle works on an ephemeral port; a
//      real fetch() against the running server returns the canned
//      body.
//   7. OPTIONS preflight returns 204 + the right CORS headers.
//   8. Method gating: a route registered for POST returns
//      no_mock_route for GET (and vice versa).
//   9. Body parse error returns 400 + { error: 'invalid_request' }.
//
// Run: node scripts/check-api-mock.mjs
// Exit 0 on full pass, 1 otherwise.
//
// Wired into scripts/run-steps.mjs as `check:api-mock`.

import { strict as assert } from 'node:assert';
import { apiMock, register, clear, list } from './api-mock.mjs';
import { registerDefaults } from './api-mock-defaults.mjs';
import './api-mock-defaults.mjs';

let failed = 0;
function ok(name) { console.log('  PASS  ' + name); }
function bad(name, detail) {
  failed++;
  console.log('  FAIL  ' + name + (detail ? ' — ' + detail : ''));
}

async function check(name, fn) {
  try { await fn(); ok(name); }
  catch (e) { bad(name, e.message.slice(0, 200)); }
}

console.log('api-mock:');

// ---- 1. Imports + registration ----
await check('imports apiMock + auto-registers defaults', async () => {
  const routes = list();
  assert.ok(routes.length >= 10, `expected >= 10 default routes, got ${routes.length}`);
});

// ---- 2. Canned success for every route ----
const SUCCESS_CASES = [
  { method: 'POST', url: '/api/early-access', body: { email: 'a@b.com', agreed: true }, expect: { ok: true } },
  { method: 'GET', url: '/api/manifest', expect: (b) => b.name === 'swr' && b.version.startsWith('mock-') },
  { method: 'POST', url: '/api/auth/magic', body: { email: 'a@b.com' }, expect: { ok: true } },
  { method: 'GET', url: '/api/auth/verify', body: { token: 'abcdef0123456789' }, expect: (b) => b.ok === true },
  { method: 'GET', url: '/api/auth/session', expect: (b) => b.ok === true },
  { method: 'POST', url: '/api/auth/google', body: { code: 'mock-code' }, expect: { ok: true } },
  { method: 'GET', url: '/api/pt/verify', body: { key: 'swr-band-A2B3C4D5' }, expect: (b) => b.ok === true && b.valid === false },
  { method: 'POST', url: '/api/admin/pt/keys/import', body: { keys: ['swr-band-A2B3C4D5'] }, expect: (b) => b.ok === true && b.imported === 2 },
  { method: 'GET', url: '/api/presets', expect: (b) => b.ok === true && Array.isArray(b.families) },
  { method: 'GET', url: '/api/projects', expect: (b) => b.ok === true && Array.isArray(b.projects) },
  { method: 'POST', url: '/api/projects', body: { name: 'mock project' }, expect: (b) => typeof b.id === 'string' },
];

for (const c of SUCCESS_CASES) {
  await check(`canned: ${c.method} ${c.url}`, async () => {
    const res = await apiMock.handle({ method: c.method, url: c.url, body: c.body });
    assert.equal(res.status, c.method === 'POST' && c.url === '/api/projects' ? 201 : 200, `bad status: ${res.status}`);
    if (typeof c.expect === 'function') {
      assert.ok(c.expect(res.body), `body did not match predicate: ${JSON.stringify(res.body).slice(0, 80)}`);
    } else {
      for (const [k, v] of Object.entries(c.expect)) {
        assert.deepEqual(res.body[k], v, `field ${k}`);
      }
    }
  });
}

// ---- 3. Invalid input → ErrorBody envelope ----
await check('invalid input: magic with bad email → 400 invalid_request', async () => {
  const res = await apiMock.handle({ method: 'POST', url: '/api/auth/magic', body: { email: 'not-an-email' } });
  assert.equal(res.status, 400);
  assert.equal(res.body.error, 'invalid_request');
  assert.ok(typeof res.body.hint === 'string' && res.body.hint.length > 0);
});

await check('invalid input: pt-import with empty array → 400 invalid_request', async () => {
  const res = await apiMock.handle({ method: 'POST', url: '/api/admin/pt/keys/import', body: { keys: [] } });
  assert.equal(res.status, 400);
  assert.equal(res.body.error, 'invalid_request');
});

await check('invalid input: pt-import with bad tier → 400 invalid_request', async () => {
  const res = await apiMock.handle({ method: 'POST', url: '/api/admin/pt/keys/import', body: { keys: [{ key: 'swr-band-A1B2C3D4', tier: 'platinum' }] } });
  assert.equal(res.status, 400);
  assert.equal(res.body.error, 'invalid_request');
});

// ---- 4. Unknown route → 404 ----
await check('unknown route → 404 no_mock_route', async () => {
  const res = await apiMock.handle({ method: 'GET', url: '/api/no/such/route' });
  assert.equal(res.status, 404);
  assert.equal(res.body.error, 'no_mock_route');
});

// ---- 5. Per-call override ----
await check('override.canned replaces the canned body', async () => {
  const res = await apiMock.handle({
    method: 'GET', url: '/api/manifest',
    override: { canned: { name: 'override-test', version: 'x', serverTime: '2026-01-01T00:00:00.000Z' } },
  });
  assert.equal(res.status, 200);
  assert.equal(res.body.name, 'override-test');
});

await check('override.errorCode returns the structured error', async () => {
  const res = await apiMock.handle({
    method: 'GET', url: '/api/manifest',
    override: { errorCode: 'rate_limited', status: 429, hint: 'slow down' },
  });
  assert.equal(res.status, 429);
  assert.equal(res.body.error, 'rate_limited');
  assert.equal(res.body.hint, 'slow down');
});

await check('override.status bumps the success status', async () => {
  const res = await apiMock.handle({
    method: 'GET', url: '/api/manifest',
    override: { status: 201 },
  });
  assert.equal(res.status, 201);
});

// ---- 6. Method gating ----
await check('method gating: POST /api/manifest returns no_mock_route', async () => {
  const res = await apiMock.handle({ method: 'POST', url: '/api/manifest' });
  assert.equal(res.status, 404);
  assert.equal(res.body.error, 'no_mock_route');
});

await check('method gating: GET /api/auth/magic returns no_mock_route', async () => {
  const res = await apiMock.handle({ method: 'GET', url: '/api/auth/magic' });
  assert.equal(res.status, 404);
  assert.equal(res.body.error, 'no_mock_route');
});

// ---- 7. Custom handler ----
await check('custom handler overrides canned-default', async () => {
  const unregister = register({
    method: 'GET', path: '/api/custom-test',
    handler: (req) => ({ status: 418, body: { teapot: true, query: req.body } }),
  });
  try {
    const res = await apiMock.handle({ method: 'GET', url: '/api/custom-test', body: { hi: 'there' } });
    assert.equal(res.status, 418);
    assert.deepEqual(res.body, { teapot: true, query: { hi: 'there' } });
  } finally {
    unregister();
  }
});

// ---- 8. register/clear lifecycle ----
await check('clear() removes every default route', async () => {
  const before = list().length;
  assert.ok(before >= 10, 'defaults should be registered');
  clear();
  assert.equal(list().length, 0, 'list should be empty after clear');
});

// ---- 9. OPTIONS preflight ----
await check('OPTIONS request returns 204 with no body', async () => {
  const res = await apiMock.handle({ method: 'OPTIONS', url: '/api/manifest' });
  assert.equal(res.status, 204);
  assert.deepEqual(res.body, {});
});

// Re-register defaults for the HTTP-server tests
clear();
registerDefaults();

// ---- 11. HTTP server lifecycle ----
let handle;
await check('start() boots a server and close() shuts it down', async () => {
  handle = await apiMock.start({ port: 0 });
  assert.ok(handle.port > 0, 'OS-assigned port should be non-zero');
  assert.equal(typeof handle.close, 'function');

  // fetch the manifest
  const r = await fetch(`${handle.baseUrl}/api/manifest`);
  assert.equal(r.status, 200);
  const body = await r.json();
  assert.equal(body.name, 'swr');

  await handle.close();
});

await check('HTTP server: invalid body returns 400', async () => {
  handle = await apiMock.start({ port: 0 });
  const r = await fetch(`${handle.baseUrl}/api/auth/magic`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{ this is not json',
  });
  assert.equal(r.status, 400);
  const body = await r.json();
  assert.equal(body.error, 'invalid_request');
  await handle.close();
});

await check('HTTP server: invalid JSON body returns 400 invalid_request', async () => {
  handle = await apiMock.start({ port: 0 });
  const r = await fetch(`${handle.baseUrl}/api/auth/magic`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'not-an-email' }),
  });
  assert.equal(r.status, 400);
  const body = await r.json();
  assert.equal(body.error, 'invalid_request');
  await handle.close();
});

await check('HTTP server: OPTIONS returns 204 + CORS headers', async () => {
  handle = await apiMock.start({ port: 0 });
  const r = await fetch(`${handle.baseUrl}/api/manifest`, { method: 'OPTIONS' });
  assert.equal(r.status, 204);
  assert.equal(r.headers.get('access-control-allow-origin'), '*');
  await handle.close();
});

await check('HTTP server: unknown route returns 404', async () => {
  handle = await apiMock.start({ port: 0 });
  const r = await fetch(`${handle.baseUrl}/api/no/such/thing`);
  assert.equal(r.status, 404);
  const body = await r.json();
  assert.equal(body.error, 'no_mock_route');
  await handle.close();
});

console.log('');
if (failed) {
  console.log('FAIL — ' + failed + ' api-mock check(s) failed');
  process.exit(1);
} else {
  console.log('PASS — all api-mock checks passed');
}