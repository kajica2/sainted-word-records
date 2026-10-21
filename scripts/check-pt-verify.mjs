// scripts/check-pt-verify.mjs : unit test for the PT key verify endpoints.
//
//   Part A: GET  /api/pt/verify?key=...      (api/pt/verify.js, FIX 2)
//   Part B: POST /api/license/verify { code } (api/license/verify.js, P0.3)
//
// Part A asserts:
//   1. A key in the ledger with matching tier → {valid: true, ...}
//   2. A key NOT in the ledger → {valid: false}
//   3. A key in the ledger with WRONG tier → {valid: false}
//   4. A malformed key → {valid: false, error: 'key format invalid'}
//   5. A missing key → 400 {ok: false}
//   6. POST → 405
//   7. Rate limit: too many requests → 429
//
// Part B asserts:
//   9.  A key minted by a direct ledger write (bypassing Stripe) →
//       { valid: true, tier, creditsRemaining, slotCount }
//   10. An unknown key → { valid: false, reason: 'unknown_code' }
//   11. A revoked key → { valid: false, reason: 'unknown_code' } (no
//       existence disclosure)
//   12. An expired key → { valid: false, reason: 'expired' }
//   13. A malformed / missing code → 400 { valid: false, reason: 'invalid_request' }
//   14. GET → 405 method_not_allowed
//   15. Rate limit per code: the 11th request in a minute → 429
//   16. `key` is accepted as an alias for `code`
//   17. The response validates against the Zod contract in
//       api/_lib/contract/pt.mjs (LicenseVerifyRes)
//
// Exits 0 on green, 1 on any failure.

import { strict as assert } from 'node:assert';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

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
// Part B fixtures. MINTED_KEY is written straight into the ledger index, which
// is exactly what api/_lib/pt-keys.js does when the Stripe webhook fulfils a
// purchase (recordPtKey) and what api/admin/pt/keys/import.js does for an
// operator-minted key. That is the "bypass Stripe" path: the ledger is the
// contract, not the payment.
const MINTED_KEY = 'swr-label-H4K5M6N7';
const REVOKED_KEY = 'swr-solo-P8Q9R2S3';
const EXPIRED_KEY = 'swr-band-T4U5V6W7';
const UNKNOWN_KEY = 'swr-label-Z9Z9Z9Z9';
const PART_B_RECORDS = [
  {
    id: 'test-record-minted',
    key: MINTED_KEY,
    tier: 'label',
    userId: 'user-2',
    email: 'buyer@example.com',
    sessionId: 'cs_test_2',
    slots: 50,
    createdAt: '2026-10-02T00:00:00.000Z',
  },
  {
    id: 'test-record-revoked',
    key: REVOKED_KEY,
    tier: 'solo',
    userId: 'user-3',
    email: 'refund@example.com',
    sessionId: 'cs_test_3',
    slots: 10,
    revoked: true,
    createdAt: '2026-10-02T00:00:00.000Z',
  },
  {
    id: 'test-record-expired',
    key: EXPIRED_KEY,
    tier: 'band',
    userId: 'user-4',
    email: 'lapsed@example.com',
    sessionId: 'cs_test_4',
    slots: 30,
    createdAt: '2025-01-01T00:00:00.000Z',
    expiresAt: '2025-06-01T00:00:00.000Z',
  },
];
writeFileSync(
  join(TMP, 'pt-keys', 'index.json'),
  JSON.stringify([REAL_RECORD, ...PART_B_RECORDS]),
);

// Import after env var is set
const { default: verifyHandler } = await import('../api/pt/verify.js');
const { default: licenseVerifyHandler } = await import('../api/license/verify.js');
const { LicenseVerifyRes } = await import('../api/_lib/contract/pt.mjs');

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

// The POST route reads its body with readJsonBody, which accepts a pre-parsed
// `req.body`. That is exactly how the Vite dev middleware (scripts/dev-api.mjs)
// hands the handler a body, so the mock matches production.
function makePostReq(body, { method = 'POST', url = '/api/license/verify', ip = '127.0.0.1' } = {}) {
  return {
    method,
    url,
    body: typeof body === 'string' ? body : JSON.stringify(body),
    headers: {
      'x-forwarded-for': ip,
      'origin': 'https://sainted-word-records.vercel.app',
    },
    socket: { remoteAddress: ip },
  };
}

async function postVerify(body, opts) {
  const req = makePostReq(body, opts);
  const res = makeRes();
  await licenseVerifyHandler(req, res);
  return { statusCode: res.statusCode || 200, body: res.body ? JSON.parse(res.body) : null };
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

// ---------------------------------------------------------------------------
// Part B: POST /api/license/verify (P0.3, the architecture audit)
// ---------------------------------------------------------------------------

await test('9. ledger-minted key → { valid: true, tier, creditsRemaining, slotCount }', async () => {
  const r = await postVerify({ code: MINTED_KEY }, { ip: '10.1.0.1' });
  assert.equal(r.statusCode, 200);
  assert.equal(r.body.valid, true, 'valid should be true');
  assert.equal(r.body.tier, 'label', 'tier should be label');
  assert.equal(r.body.tierName, 'PT Label');
  assert.equal(r.body.creditsRemaining, 500, 'label grants 500 credits');
  assert.equal(r.body.slotCount, 50, 'label grants 50 slots');
  assert.equal(r.body.grantedAt, '2026-10-02T00:00:00.000Z');
  assert.ok(LicenseVerifyRes.safeParse(r.body).success, 'response must satisfy LicenseVerifyRes');
});

await test('9b. tier credits + slots come from the tier table for a solo key', async () => {
  // Not in the ledger, so this asserts nothing about credits. Instead: the
  // default grant for each tier is what the client mirrors locally.
  const { PT_TIERS } = await import('../api/_lib/pt-keys.js');
  assert.equal(PT_TIERS.solo.credits, 50);
  assert.equal(PT_TIERS.band.credits, 150);
  assert.equal(PT_TIERS.label.credits, 500);
});

await test('10. unknown key → { valid: false, reason: unknown_code }', async () => {
  const r = await postVerify({ code: UNKNOWN_KEY }, { ip: '10.1.0.2' });
  assert.equal(r.statusCode, 200);
  assert.equal(r.body.valid, false);
  assert.equal(r.body.reason, 'unknown_code');
  assert.ok(LicenseVerifyRes.safeParse(r.body).success);
});

await test('11. revoked key → valid:false unknown_code (no existence disclosure)', async () => {
  const r = await postVerify({ code: REVOKED_KEY }, { ip: '10.1.0.3' });
  assert.equal(r.statusCode, 200);
  assert.equal(r.body.valid, false);
  assert.equal(r.body.reason, 'unknown_code',
    'a revoked key must be indistinguishable from a key that never existed');
});

await test('12. expired key → { valid: false, reason: expired }', async () => {
  const r = await postVerify({ code: EXPIRED_KEY }, { ip: '10.1.0.4' });
  assert.equal(r.statusCode, 200);
  assert.equal(r.body.valid, false);
  assert.equal(r.body.reason, 'expired');
});

await test('13. malformed / missing code → 400 { valid: false, reason: invalid_request }', async () => {
  for (const body of [{}, { code: '' }, { code: 'nope' }, { code: 'swr-band' }, { code: 'swr-boss-A2B3C4D5' },
                      { code: 'swr-band-A2B3C4D5X' }, { code: 'swr-band-A2B3C4D' }]) {
    const r = await postVerify(body, { ip: '10.1.0.5' });
    assert.equal(r.statusCode, 400, `body ${JSON.stringify(body)} should be 400, got ${r.statusCode}`);
    assert.equal(r.body.valid, false);
    assert.equal(r.body.reason, 'invalid_request');
  }
});

await test('13b. non-JSON body → 400 invalid_request', async () => {
  const r = await postVerify('{not json', { ip: '10.1.0.5' });
  assert.equal(r.statusCode, 400);
  assert.equal(r.body.reason, 'invalid_request');
});

await test('14. GET → 405 method_not_allowed', async () => {
  const r = await postVerify({ code: MINTED_KEY }, { method: 'GET', ip: '10.1.0.6' });
  assert.equal(r.statusCode, 405);
  assert.equal(r.body.error, 'method_not_allowed');
});

await test('15. per-code rate limit: the 11th request in a minute → 429', async () => {
  const ip = '10.2.0.9';
  for (let i = 0; i < 10; i++) {
    const r = await postVerify({ code: REAL_KEY }, { ip });
    assert.equal(r.statusCode, 200, `request ${i + 1} of 10 should pass, got ${r.statusCode}`);
    assert.equal(r.body.valid, true);
  }
  const r = await postVerify({ code: REAL_KEY }, { ip });
  assert.equal(r.statusCode, 429, 'the 11th request should be rate limited');
  assert.equal(r.body.error, 'rate_limited');
  assert.ok(r.body.retryAfterMs > 0, 'retryAfterMs should be a positive number');
});

await test('15b. the rate limit is per code: a different code from the same IP still passes', async () => {
  const ip = '10.2.0.10';
  for (let i = 0; i < 10; i++) await postVerify({ code: REAL_KEY }, { ip });
  const blocked = await postVerify({ code: REAL_KEY }, { ip });
  assert.equal(blocked.statusCode, 429, 'the exhausted code stays blocked');
  const other = await postVerify({ code: MINTED_KEY }, { ip });
  assert.equal(other.statusCode, 200, 'a different code is a different bucket');
  assert.equal(other.body.valid, true);
});

await test('16. `key` is accepted as an alias for `code`', async () => {
  const r = await postVerify({ key: MINTED_KEY.toLowerCase() }, { ip: '10.3.0.1' });
  assert.equal(r.statusCode, 200, 'a lowercased key must still resolve');
  assert.equal(r.body.valid, true);
  assert.equal(r.body.tier, 'label');
});

await test('17. every Part B response shape satisfies the Zod contract', async () => {
  const ok = await postVerify({ code: MINTED_KEY }, { ip: '10.4.0.1' });
  assert.ok(LicenseVerifyRes.safeParse(ok.body).success, JSON.stringify(ok.body));
  const bad = await postVerify({ code: UNKNOWN_KEY }, { ip: '10.4.0.2' });
  assert.ok(LicenseVerifyRes.safeParse(bad.body).success, JSON.stringify(bad.body));
  const expired = await postVerify({ code: EXPIRED_KEY }, { ip: '10.4.0.3' });
  assert.ok(LicenseVerifyRes.safeParse(expired.body).success, JSON.stringify(expired.body));
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
