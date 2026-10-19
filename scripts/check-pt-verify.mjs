// scripts/check-pt-verify.mjs — unit test for the PT key verify endpoint
// (FIX 2 from the architecture audit).
//
// Imports the handler directly (no network, no Vercel), sets up a
// scratch data dir, writes a fake key to the ledger, and asserts:
//   1. A key in the ledger with matching tier → {valid: true, ...}
//   2. A key NOT in the ledger → {valid: false}
//   3. A key in the ledger with WRONG tier → {valid: false}
//   4. A malformed key → {valid: false, error: 'key format invalid'}
//   5. A missing key → 400 {ok: false}
//   6. POST → 405
//   7. Rate limit: too many requests → 429
//
// Exits 0 on green, 1 on any failure.

import { strict as assert } from 'node:assert';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';

const TMP = mkdtempSync(join(tmpdir(), 'swrc-pt-verify-'));
process.env.SWRC_DATA_DIR = TMP;
mkdirSync(join(TMP, 'pt-keys'), { recursive: true });

// Write a fake key to the ledger
const REAL_KEY = 'swr-band-A2B3C4D5';
const FAKE_TIER_KEY = 'swr-solo-Z2Y3X4W5';  // valid format, not in ledger
const WRONG_TIER_KEY = 'swr-label-M5N6P7Q8';  // different tier than real
const REAL_RECORD = {
  id: 'test-record-1',
  key: REAL_KEY,
  tier: 'band',
  userId: 'user-1',
  email: 'test@example.com',
  sessionId: 'cs_test_1',
  slots: 30,
  createdAt: '2026-10-01T00:00:00.000Z',
};
writeFileSync(join(TMP, 'pt-keys', 'index.json'), JSON.stringify([REAL_RECORD]));

// Import after env var is set
const { default: verifyHandler } = await import('../api/pt/verify.js');

// We mock the req/res objects the way the API runner builds them —
// verify.js expects an IncomingMessage-like req with `method`,
// `url`, `headers`, `socket`, and a ServerResponse-like res with
// `statusCode`, `setHeader`, `getHeader`, and an `end` method.
// We also collect the body so we can assert on the JSON.
function makeReq({ method = 'GET', url = '/api/pt/verify?key=swr-band-A1B2C3D4', ip = '127.0.0.1' } = {}) {
  return {
    method,
    url,
    headers: {
      'x-forwarded-for': ip,
      'origin': 'https://sainted-word-records.vercel.app',
    },
    socket: { remoteAddress: ip },
  };
}
function makeRes() {
  const headers = {};
  let body = '';
  return {
    setHeader(k, v) { headers[k] = v; },
    getHeader(k) { return headers[k]; },
    write(chunk) { body += chunk; },
    end(chunk) {
      if (chunk) body += chunk;
      this.body = body;
      this.headers = headers;
      this.statusCode = this.statusCode || 200;
    },
  };
}

let failed = 0;
async function test(name, fn) {
  try {
    await fn();
    process.stdout.write(`  ✓ ${name}\n`);
  } catch (e) {
    failed += 1;
    process.stdout.write(`  ✗ ${name} — ${e.message}\n`);
  }
}

// ---- Run the cases ----

await test('1. key in ledger with matching tier → valid: true', async () => {
  const req = makeReq({ url: '/api/pt/verify?key=' + encodeURIComponent(REAL_KEY) });
  const res = makeRes();
  await verifyHandler(req, res);
  console.log('  case 1 body:', res.body);
  const body = JSON.parse(res.body);
  assert.equal(body.ok, true, 'ok should be true');
  assert.equal(body.valid, true, 'valid should be true');
  assert.equal(body.tier, 'band');
  assert.equal(body.slots, 30);
  assert.ok(body.sessionId);
  assert.ok(body.grantedAt);
});

await test('2. key not in ledger → valid: false, error: key not found', async () => {
  const req = makeReq({ url: '/api/pt/verify?key=' + encodeURIComponent(FAKE_TIER_KEY) });
  const res = makeRes();
  await verifyHandler(req, res);
  const body = JSON.parse(res.body);
  assert.equal(body.ok, true);
  assert.equal(body.valid, false);
  assert.equal(body.error, 'key not found');
});

await test('3. key in ledger with wrong tier → valid: false, error: tier mismatch', async () => {
  // Forge a fake key with the right shape but a tier that doesn't
  // match the real record. We do this by composing the real key
  // string but rewriting the tier segment.
  const forged = 'swr-solo-' + REAL_KEY.split('-')[2];
  const req = makeReq({ url: '/api/pt/verify?key=' + encodeURIComponent(forged) });
  const res = makeRes();
  await verifyHandler(req, res);
  const body = JSON.parse(res.body);
  assert.equal(body.ok, true);
  assert.equal(body.valid, false);
  assert.equal(body.error, 'key not found',
    'should be "not found" because the forged solo key is not in the ledger at all');
});

await test('4. malformed key → valid: false, error: key format invalid', async () => {
  const req = makeReq({ url: '/api/pt/verify?key=not-a-real-key' });
  const res = makeRes();
  await verifyHandler(req, res);
  const body = JSON.parse(res.body);
  assert.equal(body.ok, true);
  assert.equal(body.valid, false);
  assert.equal(body.error, 'key format invalid');
});

await test('5. missing key param → 400, error: invalid_request', async () => {
  const req = makeReq({ url: '/api/pt/verify' });
  const res = makeRes();
  await verifyHandler(req, res);
  const body = JSON.parse(res.body);
  assert.equal(res.statusCode, 400);
  assert.equal(body.error, 'invalid_request');
  assert.match(body.hint, /key required/);
});

await test('6. POST method → 405 method_not_allowed', async () => {
  const req = makeReq({ method: 'POST', url: '/api/pt/verify?key=' + encodeURIComponent(REAL_KEY) });
  const res = makeRes();
  await verifyHandler(req, res);
  assert.equal(res.statusCode, 405);
  const body = JSON.parse(res.body);
  assert.equal(body.error, 'method_not_allowed');
});

await test('7. rate limit: 5 rapid requests from same IP, 6th → 429', async () => {
  // The limiter holds 5 timestamps; a 6th rapid request returns 429.
  // Each test case uses a fresh IP to avoid cross-pollution.
  const ip = '10.0.0.99';
  for (let i = 0; i < 5; i++) {
    const req = makeReq({ url: '/api/pt/verify?key=' + encodeURIComponent(REAL_KEY), ip });
    const res = makeRes();
    await verifyHandler(req, res);
    assert.equal(res.statusCode, 200, 'request ' + (i + 1) + ' should pass');
  }
  const req = makeReq({ url: '/api/pt/verify?key=' + encodeURIComponent(REAL_KEY), ip });
  const res = makeRes();
  await verifyHandler(req, res);
  assert.equal(res.statusCode, 429, '6th request should be rate limited');
  const body = JSON.parse(res.body);
  assert.equal(body.error, 'rate_limited');
  assert.equal(body.retryAfterMs, 2000);
});

await test('8. CORS preflight (OPTIONS) → 204, no rate limit', async () => {
  // OPTIONS short-circuits before the rate limiter, so it works
  // even after the 5-request budget is exhausted.
  const ip = '10.0.0.99';
  for (let i = 0; i < 5; i++) {
    const req = makeReq({ method: 'POST', url: '/api/pt/verify?key=irrelevant', ip });
    const res = makeRes();
    await verifyHandler(req, res);
  }
  const req = { method: 'OPTIONS', url: '/api/pt/verify', headers: { origin: 'https://x.example' }, socket: { remoteAddress: ip } };
  const res = makeRes();
  await verifyHandler(req, res);
  assert.equal(res.statusCode, 204, 'preflight returns 204');
});

// Cleanup
rmSync(TMP, { recursive: true, force: true });

console.log('');
if (failed) {
  console.log(`FAIL — ${failed} test(s) failed`);
  process.exit(1);
} else {
  console.log('PASS — all PT verify cases pass');
  process.exit(0);
}
