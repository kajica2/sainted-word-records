#!/usr/bin/env node
// scripts/check-invite-api-smoke.mjs — HTTP-level smoke for the invite-code
// API, hermetically.
//
// Boots the same middleware that `npm run dev` uses (scripts/dev-api.mjs
// handleApi) on a plain node:http server with a temp SWRC_DATA_DIR, so the
// store resolves to JSON files under that temp dir — no Postgres, no network,
// no real credentials. Set DATABASE_URL instead and the identical suite runs
// against Postgres, which is the backend production uses; the on-disk
// assertions then skip, since the rows are in the `kv` table. Drives the
// real register → redeem → disable → delete flow over HTTP:
//   - POST /api/invite/register  INVITE_ADMIN_SECRET-gated batch registration
//   - POST /api/invite/redeem    public, per-IP rate-limited
//
// This is the only server-side coverage of api/_lib/kv.js. The client-side
// suites (check:invite-unlock-unit, check:invite-redemption-smoke) stub
// fetch, so without this the storage backend underneath the invite store has
// no gate at all — which is how a backend swap could ship untested.
//
// Exit code 0 = all green, 1 = any failure (with reasons on stderr).

import http from 'node:http';
import { strict as assert } from 'node:assert';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const TMP = mkdtempSync(join(tmpdir(), 'swrc-invite-api-'));
process.env.SWRC_DATA_DIR = TMP;
// read by api/invite/register.js at module load — set before any import that
// could reach it.
process.env.INVITE_ADMIN_SECRET = 'smoke-admin-secret';
// Keep the suite quiet: db.js only uses NODE_ENV to suppress its
// "no Blob credentials" warning.
process.env.NODE_ENV = 'test';

// db.js resolves the Postgres backend only from a real postgres(ql):// URL —
// the `prisma+postgres://` form is an Accelerate URL the pg driver cannot
// open, so it is deliberately excluded here to match. Set DATABASE_URL and
// this same suite runs the whole invite flow against Postgres, which is the
// backend production actually uses (see the note in api/_lib/kv.js).
const USING_PG = /^postgres(ql)?:\/\//i.test(
  process.env.DATABASE_URL || process.env.POSTGRES_URL || ''
);

// Import AFTER the env is set — db.js picks its root at module load.
const { handleApi } = await import('./dev-api.mjs');
const kv = await import('../api/_lib/kv.js');

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

async function req(method, path, body) {
  const headers = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const res = await fetch(BASE + path, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch (_) { /* non-JSON */ }
  return { status: res.status, json, text, headers: res.headers };
}

const SECRET = 'smoke-admin-secret';
const CODE = 'SMOKE5-TEST5-CODE5'; // canonical XXXXX-XXXXX-XXXXX shape
const UNKNOWN = 'UNKNOW-XXXXX-XXXXX';

console.log(`invite API smoke (store: ${USING_PG ? 'postgres' : 'filesystem'}):`);

// --- admin wall on register ---
await test('register without a secret → 401', async () => {
  const r = await req('POST', '/api/invite/register', { code: CODE });
  assert.equal(r.status, 401, r.text);
  assert.equal(r.json.error, 'unauthorized');
});

await test('register with the wrong secret → 401', async () => {
  const r = await req('POST', '/api/invite/register', { secret: 'nope', code: CODE });
  assert.equal(r.status, 401, r.text);
  assert.equal(r.json.error, 'unauthorized');
});

await test('register a malformed code → 400 invalid_code', async () => {
  const r = await req('POST', '/api/invite/register', { secret: SECRET, code: 'not a code' });
  assert.equal(r.status, 400, r.text);
  assert.equal(r.json.error, 'invalid_code');
});

// --- the happy path, i.e. exactly what the workflow does ---
await test('register a valid code → 200', async () => {
  const r = await req('POST', '/api/invite/register', { secret: SECRET, code: CODE, label: 'smoke batch' });
  assert.equal(r.status, 200, r.text);
  assert.equal(r.json.ok, true);
  assert.equal(r.json.code, CODE);
});

await test('the code landed in the store', async () => {
  const entry = await kv.readInvite(CODE);
  assert.equal(entry.enabled, true);
  assert.equal(entry.label, 'smoke batch');
  assert.ok(!Number.isNaN(Date.parse(entry.createdAt)), 'createdAt is an ISO timestamp');
  // The on-disk half of the contract only holds on the filesystem backend;
  // under Postgres the row lives in the `kv` table, not at TMP.
  if (!USING_PG) {
    const path = join(TMP, 'invite-store', 'codes', `${CODE}.json`);
    assert.ok(existsSync(path), `expected ${path} to exist`);
  }
});

await test('redeem the registered code → 200', async () => {
  const r = await req('POST', '/api/invite/redeem', { code: CODE });
  assert.equal(r.status, 200, r.text);
  assert.equal(r.json.ok, true);
});

await test('re-registering the same code is idempotent → 200', async () => {
  const r = await req('POST', '/api/invite/register', { secret: SECRET, code: CODE, label: 'smoke batch' });
  assert.equal(r.status, 200, r.text);
  const entry = await kv.readInvite(CODE);
  assert.equal(entry.enabled, true, 'still enabled after a re-run');
});

// --- the 404 / 400 split an operator reads in the logs ---
await test('redeem an unknown-but-well-formed code → 404', async () => {
  const r = await req('POST', '/api/invite/redeem', { code: UNKNOWN });
  assert.equal(r.status, 404, r.text);
  assert.equal(r.json.error, 'invalid_or_disabled_code');
});

await test('redeem a malformed code → 400 invalid_code', async () => {
  const r = await req('POST', '/api/invite/redeem', { code: 'nope' });
  assert.equal(r.status, 400, r.text);
  assert.equal(r.json.error, 'invalid_code');
});

// --- revoke / restore, the grant-invite.mjs disable+enable path ---
await test('disable → 404, re-enable → 200', async () => {
  const entry = await kv.readInvite(CODE);
  await kv.writeInvite(CODE, { ...entry, enabled: false });
  const off = await req('POST', '/api/invite/redeem', { code: CODE });
  assert.equal(off.status, 404, off.text);

  await kv.writeInvite(CODE, { ...entry, enabled: true });
  const on = await req('POST', '/api/invite/redeem', { code: CODE });
  assert.equal(on.status, 200, on.text);
});

await test('delete → gone from the store and from redeem', async () => {
  assert.equal(await kv.deleteInvite(CODE), true, 'deleteInvite reports a removal');
  assert.equal(await kv.readInvite(CODE), null);
  assert.equal(await kv.deleteInvite(CODE), false, 'a second delete is a no-op, not an error');
  if (!USING_PG) {
    const path = join(TMP, 'invite-store', 'codes', `${CODE}.json`);
    assert.ok(!existsSync(path), `expected ${path} to be removed`);
  }
  const r = await req('POST', '/api/invite/redeem', { code: CODE });
  assert.equal(r.status, 404, r.text);
});

// --- method walls + CORS preflight ---
await test('GET on both endpoints → 405 + Allow', async () => {
  const a = await req('GET', '/api/invite/register');
  assert.equal(a.status, 405, a.text);
  assert.ok(a.headers.get('allow'), 'Allow header present');
  const b = await req('GET', '/api/invite/redeem');
  assert.equal(b.status, 405, b.text);
});

await test('OPTIONS preflight → 204', async () => {
  assert.equal((await req('OPTIONS', '/api/invite/redeem')).status, 204);
  assert.equal((await req('OPTIONS', '/api/invite/register')).status, 204);
});

await test('an unrouted /api path → 404 no_handler', async () => {
  const r = await req('POST', '/api/invite/nonsense', {});
  assert.equal(r.status, 404, r.text);
  assert.equal(r.json.error, 'no_handler');
});

// --- rate limit (LAST: it shares one 30/min bucket with every redeem above) ---
await test('redeem rate limit: >30 requests/min from one IP → 429', async () => {
  let saw429 = null;
  for (let i = 0; i < 40; i++) {
    const r = await req('POST', '/api/invite/redeem', { code: UNKNOWN });
    if (r.status === 429) { saw429 = r; break; }
    assert.ok(r.status === 400 || r.status === 404, `unexpected ${r.status} mid-flood`);
  }
  assert.ok(saw429, 'expected the limiter to trip within 40 requests');
  assert.equal(saw429.json.error, 'rate_limited');
  assert.ok(saw429.headers.get('retry-after'), 'Retry-After header present');
});

server.close();
rmSync(TMP, { recursive: true, force: true });

console.log(failed === 0 ? '\nALL GREEN' : `\n${failed} FAILED`);
process.exit(failed === 0 ? 0 : 1);
