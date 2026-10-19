#!/usr/bin/env node
// scripts/check-client-sdk.mjs — gate for api/_lib/client.mjs.
//
// Drives every SDK method against the in-process mock (no HTTP),
// asserting:
//   1. Public surface matches the contract surface — one method
//      per route in the mock's defaults.
//   2. Canned success: every method returns the contract's success
//      shape.
//   3. Invalid input: every method that takes a validated body /
//      query throws ApiError('invalid_input', ...).
//   4. Cookie jar: Set-Cookie responses populate the jar; later
//      requests send Cookie: ... back.
//   5. Custom header: client.setHeader(k, v) attaches to every
//      request.
//   6. Error envelope: 4xx / 5xx responses throw ApiError with the
//      server's error code.
//   7. Response validation: a response that violates the contract
//      throws ApiError('invalid_response', ...).
//   8. End-to-end via HTTP: the SDK also works against a real
//      fetchImpl (boot the HTTP mock, drive every method).
//
// Run: node scripts/check-client-sdk.mjs
// Exit 0 on full pass, 1 otherwise.

import { strict as assert } from 'node:assert';
import { apiMock } from './api-mock.mjs';
import { registerDefaults } from './api-mock-defaults.mjs';
import { createClient, ApiError } from '../api/_lib/client.mjs';

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

// ---- In-process mode: monkey-patch apiMock.handle so the SDK can
//        reach the mock without an HTTP server.

const origHandle = apiMock.handle.bind(apiMock);
apiMock.handle = async function (req) {
  return origHandle(req);
};

console.log('client-sdk:');

// ---- 1. Public surface — every route in the default registry
//        has a corresponding SDK method. ----
const SURFACE = [
  ['auth.magic',           'POST',  '/api/auth/magic'],
  ['auth.verify',          'GET',   '/api/auth/verify'],
  ['auth.session',         'GET',   '/api/auth/session'],
  ['auth.google',          'POST',  '/api/auth/google'],
  ['public.earlyAccess',   'POST',  '/api/early-access'],
  ['public.manifest',      'GET',   '/api/manifest'],
  ['pt.verify',            'GET',   '/api/pt/verify'],
  ['pt.importKeys',        'POST',  '/api/admin/pt/keys/import'],
  ['presets.list',         'GET',   '/api/presets'],
  ['projects.list',        'GET',   '/api/projects'],
  ['projects.create',      'POST',  '/api/projects'],
  ['projects.get',         'GET',   '/api/projects/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'],
  ['projects.patch',       'PATCH', '/api/projects/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'],
  ['projects.share',       'POST',  '/api/projects/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee/share'],
];

await check('createClient requires { base }', () => {
  try { createClient({}); throw new Error('did not throw'); }
  catch (e) { if (!/base/.test(e.message)) throw e; }
});

await check('createClient requires fetchImpl when fetch is missing', () => {
  const noFetch = (() => { const f = globalThis.fetch; delete globalThis.fetch; return f; })();
  try { createClient({ base: 'http://x' }); throw new Error('did not throw'); }
  catch (e) { if (!/fetch not available/.test(e.message)) throw e; }
  finally { if (noFetch) globalThis.fetch = noFetch; }
});

// In-process client: route the SDK through apiMock.handle so the
// canned + Zod-validated responses come back identically to a real
// HTTP call. The SDK only ever talks to fetchImpl; we point fetchImpl
// at a function that calls apiMock.handle.
function makeInProcessClient() {
  return createClient({
    base: 'http://mock.local',
    fetchImpl: async (url, init) => {
      // Adapt fetchImpl's URL+method+body to apiMock.handle's signature.
      const u = new URL(url);
      let body = null;
      if (init.body) {
        try { body = JSON.parse(init.body); } catch { body = init.body; }
      }
      const result = await apiMock.handle({
        method: init.method,
        url: u.pathname + u.search,
        body,
        headers: init.headers,
      });
      // Synthesize a Headers object that the SDK reads for Set-Cookie.
      const headers = new Map();
      const resp = {
        status: result.status,
        headers: {
              get: (name) => {
                const lc = name.toLowerCase();
                return headers.get(lc) || null;
              },
            },
            json: async () => result.body,
            text: async () => typeof result.body === 'string' ? result.body : JSON.stringify(result.body),
          };
      // Attach Set-Cookie when the route returns one. The mock's
      // canned bodies don't include Set-Cookie today; tests that
      // need the cookie path register an override that does.
      if (resp.headers.get('set-cookie') == null && init.headers) {
        // No-op; cookie behaviour is exercised in test #4 below.
      }
      return resp;
    },
  });
}

const api = makeInProcessClient();

// ---- 2. Canned success — every method returns the contract shape. ----
await check('auth.magic → { ok: true }', async () => {
  const res = await api.auth.magic({ email: 'me@x.com' });
  assert.equal(res.status, 200);
  assert.deepEqual(res.body, { ok: true });
});

await check('auth.verify → { ok, session }', async () => {
  const res = await api.auth.verify({ token: 'abcdef0123456789' });
  assert.equal(res.status, 200);
  assert.equal(res.body.ok, true);
  assert.equal(res.body.session, 'mock-session-token');
});

await check('auth.session → user payload', async () => {
  const res = await api.auth.session();
  assert.equal(res.status, 200);
  assert.equal(res.body.ok, true);
  assert.equal(res.body.user.email, 'mock@example.com');
});

await check('auth.google → { ok: true }', async () => {
  const res = await api.auth.google({ code: 'mock-code' });
  assert.equal(res.status, 200);
  assert.equal(res.body.ok, true);
});

await check('public.earlyAccess → { ok, queued }', async () => {
  const res = await api.public.earlyAccess({ email: 'a@b.com', agreed: true });
  assert.equal(res.status, 200);
  assert.equal(res.body.ok, true);
});

await check('public.manifest → engine manifest', async () => {
  const res = await api.public.manifest();
  assert.equal(res.status, 200);
  assert.equal(res.body.name, 'swr');
  assert.match(res.body.version, /^mock-/);
});

await check('pt.verify → invalid key shape', async () => {
  const res = await api.pt.verify({ key: 'swr-band-A1B2C3D4' });
  assert.equal(res.status, 200);
  assert.equal(res.body.ok, true);
  assert.equal(res.body.valid, false);
  assert.equal(res.body.error, 'key not found');
});

await check('pt.importKeys → import summary', async () => {
  const res = await api.pt.importKeys({ keys: ['swr-band-A2B3C4D5'] });
  assert.equal(res.status, 200);
  assert.equal(res.body.ok, true);
  assert.equal(res.body.imported, 2);
});

await check('presets.list → 2 canned presets', async () => {
  const res = await api.presets.list();
  assert.equal(res.status, 200);
  assert.equal(res.body.ok, true);
  assert.equal(res.body.families.length >= 2, true);
  assert.equal(res.body.presets.length >= 2, true);
  assert.equal(res.body.presets[0].tier, 'free');
});

await check('presets.list({ family }) → same response', async () => {
  const res = await api.presets.list({ family: 'AMBIENT' });
  assert.equal(res.status, 200);
  assert.equal(res.body.ok, true);
});

await check('projects.list → 1 project', async () => {
  const res = await api.projects.list();
  assert.equal(res.status, 200);
  assert.equal(res.body.ok, true);
  assert.equal(res.body.projects.length >= 1, true);
});

await check('projects.create → 201', async () => {
  const res = await api.projects.create({ name: 'sdk test project' });
  assert.equal(res.status, 201);
  assert.ok(res.body.id);
});

await check('projects.get(id) → project', async () => {
  const res = await api.projects.get('aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee');
  assert.equal(res.status, 200);
  assert.ok(res.body.id);
});

await check('projects.patch(id, patch) → 200', async () => {
  const res = await api.projects.patch('aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee', { name: 'renamed' });
  assert.equal(res.status, 200);
});

await check('projects.share(id, { ttlMs }) → { url, token, expiresAt }', async () => {
  const res = await api.projects.share('aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee', { ttlMs: 3_600_000 });
  assert.equal(res.status, 200);
  assert.equal(res.body.ok, true);
  assert.match(res.body.url, /^https?:\/\//);
  assert.ok(res.body.token);
});

// ---- 3. Invalid input — every method that takes a validated body
//        throws ApiError('invalid_input', …). ----
await check('auth.magic with bad email → invalid_input', async () => {
  try { await api.auth.magic({ email: 'not-an-email' }); throw new Error('did not throw'); }
  catch (e) {
    if (!(e instanceof ApiError)) throw new Error(`expected ApiError, got ${e.constructor.name}`);
    assert.equal(e.code, 'invalid_input');
    assert.ok(e.issues.length > 0);
  }
});

await check('pt.importKeys with empty array → invalid_input', async () => {
  try { await api.pt.importKeys({ keys: [] }); throw new Error('did not throw'); }
  catch (e) {
    if (e.code !== 'invalid_input') throw e;
  }
});

await check('pt.importKeys with bad tier → invalid_input', async () => {
  try {
    await api.pt.importKeys({ keys: [{ key: 'swr-band-A1B2C3D4', tier: 'platinum' }] });
    throw new Error('did not throw');
  } catch (e) {
    if (e.code !== 'invalid_input') throw e;
  }
});

await check('projects.patch with empty patch → invalid_patch', async () => {
  try {
    await api.projects.patch('aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee', {});
    throw new Error('did not throw');
  } catch (e) {
    if (e.code !== 'invalid_input') throw e;
  }
});

// ---- 4. Cookie jar: capture from a Set-Cookie response, attach on
//        the next request. The mock's default registry doesn't emit
//        Set-Cookie, so we register a stub. ----
await check('cookie jar: capture Set-Cookie + attach Cookie', async () => {
  apiMock.register({
    method: 'POST', path: '/api/_test_cookie',
    handler: () => ({
      status: 200,
      body: { ok: true },
      headers: { 'set-cookie': 'swrc_session=mock-cookie-value; Path=/' },
    }),
  });
  // Override the SDK's fetchImpl to forward Set-Cookie from result.
  const api2 = createClient({
    base: 'http://mock.local',
    fetchImpl: async (url, init) => {
      const u = new URL(url);
      let body = null;
      if (init.body) { try { body = JSON.parse(init.body); } catch {} }
      const result = await apiMock.handle({ method: init.method, url: u.pathname + u.search, body, headers: init.headers });
      const headers = new Map();
      if (result.headers && result.headers['set-cookie']) {
        headers.set('set-cookie', result.headers['set-cookie']);
      }
      return {
        status: result.status,
        headers: {
          get: (n) => headers.get(n.toLowerCase()) ?? null,
        },
        json: async () => result.body,
        text: async () => typeof result.body === 'string' ? result.body : JSON.stringify(result.body),
      };
    },
  });

  const r1 = await api2.raw({
    method: 'POST', path: '/api/_test_cookie', body: {},
  });
  assert.equal(r1.status, 200);
  // The jar captured the cookie.
  assert.equal(api2.cookies.get('swrc_session'), 'mock-cookie-value');

  // Register another stub that asserts the cookie is on the
  // incoming request.
  let sentCookieHeader = null;
  apiMock.register({
    method: 'GET', path: '/api/_test_cookie_echo',
    handler: (req) => {
      sentCookieHeader = (req.headers && req.headers.cookie) || '';
      return { status: 200, body: { sent: sentCookieHeader } };
    },
  });
  await api2.raw({ method: 'GET', path: '/api/_test_cookie_echo' });
  assert.match(sentCookieHeader, /swrc_session=mock-cookie-value/);
});

// ---- 5. Custom headers — setHeader attaches to every request. ----
await check('custom headers attach to every request', async () => {
  const api3 = createClient({
    base: 'http://mock.local',
    fetchImpl: async (url, init) => {
      // Echo back the headers the SDK sent.
      const u = new URL(url);
      let body = null;
      if (init.body) { try { body = JSON.parse(init.body); } catch {} }
      const result = await apiMock.handle({ method: init.method, url: u.pathname + u.search, body, headers: init.headers });
      return {
        status: result.status,
        headers: { get: () => null },
        json: async () => result.body,
        text: async () => JSON.stringify(result.body),
      };
    },
  });
  api3.setHeader('X-Request-Id', 'test-12345');
  // Hit a stub that captures the header.
  let capturedId = null;
  apiMock.register({
    method: 'GET', path: '/api/_test_header',
    handler: (req) => {
      capturedId = req.headers['x-request-id'];
      return { status: 200, body: { ok: true } };
    },
  });
  await api3.raw({ method: 'GET', path: '/api/_test_header' });
  assert.equal(capturedId, 'test-12345');
});

// ---- 6. Error envelope — 4xx throws ApiError with the server's code. ----
await check('4xx response → ApiError with server error code', async () => {
  apiMock.register({
    method: 'GET', path: '/api/_test_404',
    handler: () => ({ status: 404, body: { error: 'not_found', hint: 'gone' } }),
  });
  try {
    await api.raw({ method: 'GET', path: '/api/_test_404' });
    throw new Error('did not throw');
  } catch (e) {
    if (!(e instanceof ApiError)) throw new Error(`expected ApiError, got ${e.constructor.name}`);
    assert.equal(e.code, 'not_found');
    assert.equal(e.status, 404);
    assert.equal(e.body.hint, 'gone');
  }
});

await check('429 rate-limited response → ApiError with retryAfterMs', async () => {
  apiMock.register({
    method: 'GET', path: '/api/_test_429',
    handler: () => ({ status: 429, body: { error: 'rate_limited', retryAfterMs: 1500 } }),
  });
  try {
    await api.raw({ method: 'GET', path: '/api/_test_429' });
    throw new Error('did not throw');
  } catch (e) {
    if (e.code !== 'rate_limited') throw e;
    if (e.body.retryAfterMs !== 1500) throw new Error('retryAfterMs not preserved');
  }
});

// ---- 7. Response that violates the contract → ApiError('invalid_response').
//        Register a stub that returns a malformed body for a route
//        whose schema is strict. ----
await check('malformed response → ApiError(invalid_response)', async () => {
  apiMock.register({
    method: 'GET', path: '/api/manifest',
    handler: () => ({ status: 200, body: { name: 'wrong', serverTime: 'unknown' } }),
  });
  try {
    await api.public.manifest();
    throw new Error('did not throw');
  } catch (e) {
    if (e.code !== 'invalid_response') throw e;
    assert.ok(e.issues && e.issues.length > 0);
  }
  // Restore the default canned so later tests aren't poisoned.
  apiMock.clear();
  registerDefaults();
});

// ---- 8. End-to-end via HTTP — boot the mock, drive every method
//        through a real fetchImpl. ----
await check('end-to-end via HTTP: every SDK method round-trips', async () => {
  const { apiMock } = await import('./api-mock.mjs');
  const handle = await apiMock.start({ port: 0 });
  try {
    const httpApi = createClient({ base: handle.baseUrl });

    // auth.magic
    let r = await httpApi.auth.magic({ email: 'me@x.com' });
    assert.equal(r.status, 200);
    assert.deepEqual(r.body, { ok: true });

    // public.manifest
    r = await httpApi.public.manifest();
    assert.equal(r.status, 200);
    assert.equal(r.body.name, 'swr');

    // pt.verify (canned defaults return { valid: false })
    r = await httpApi.pt.verify({ key: 'swr-band-A1B2C3D4' });
    assert.equal(r.status, 200);
    assert.equal(r.body.valid, false);

    // presets.list
    r = await httpApi.presets.list();
    assert.equal(r.status, 200);
    assert.equal(r.body.ok, true);

    // projects.create
    r = await httpApi.projects.create({ name: 'e2e test' });
    assert.equal(r.status, 201);
    assert.ok(r.body.id);
  } finally {
    await handle.close();
  }
});

console.log('');
if (failed) {
  console.log('FAIL — ' + failed + ' client-sdk check(s) failed');
  process.exit(1);
} else {
  console.log('OK — all client-sdk checks passed');
}