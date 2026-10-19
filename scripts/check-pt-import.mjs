// scripts/check-pt-import.mjs — unit test for the operator-minted
// PT key import endpoint (FIX 2 part B).
//
// Imports the handler directly (no network). Sets up a scratch data
// dir, exercises the POST flow with valid and invalid bodies, and
// asserts:
//   1. Unauthorized (no secret) → 401
//   2. Wrong secret → 401
//   3. Wrong method → 405
//   4. Empty body → 400
//   5. Invalid JSON → 400
//   6. No `keys` field → 400
//   7. Valid import (dev localhost) → 200, imported=N, errors=[]
//   8. Idempotency: re-importing the same key → 200, imported=0,
//      skipped=1
//   9. Tier mismatch (record says 'band' but key is 'solo') → 400
//  10. Format-invalid key → errors[0].error === 'key format invalid'
//
// Run: node scripts/check-pt-import.mjs
// Exit 0 on green, 1 on red.

import { strict as assert } from 'node:assert';
import { mkdtempSync, rmSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const TMP = mkdtempSync(join(tmpdir(), 'swrc-pt-import-'));
process.env.SWRC_DATA_DIR = TMP;
mkdirSync(join(TMP, 'pt-keys'), { recursive: true });

// No PT_IMPORT_SECRET set in this test → dev mode (localhost allowed).
// The test makes requests from 127.0.0.1.

const { default: importHandler } = await import('../api/admin/pt/keys/import.js');

function makeReq({ method = 'POST', url = '/api/admin/pt/keys/import', ip = '127.0.0.1', secret = null, body = null, contentLength = null } = {}) {
  const headers = {
    'x-forwarded-for': ip,
    'content-type': 'application/json',
  };
  if (secret !== null) headers['x-import-secret'] = secret;
  const nodeReq = {
    method,
    url,
    headers,
    socket: { remoteAddress: ip },
  };
  // Fake the body stream
  if (body !== null) {
    const buf = Buffer.from(typeof body === 'string' ? body : JSON.stringify(body));
    let delivered = 0;
    const listeners = {};
    nodeReq.on = (event, fn) => { listeners[event] = fn; };
    nodeReq.destroy = () => {};
    nodeReq.on('data', () => {});
    // Simulate data + end immediately
    process.nextTick(() => {
      listeners.data && listeners.data(buf);
      listeners.end && listeners.end();
    });
  } else {
    nodeReq.on = () => {};
    nodeReq.destroy = () => {};
  }
  return nodeReq;
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
  try { await fn(); process.stdout.write(`  ✓ ${name}\n`); }
  catch (e) { failed += 1; process.stdout.write(`  ✗ ${name} — ${e.message}\n`); }
}

// ---- Run the cases ----

await test('1. unauthorized (localhost without secret, off-ip) → 401', async () => {
  const req = makeReq({ ip: '203.0.113.5' });
  const res = makeRes();
  await importHandler(req, res);
  assert.equal(res.statusCode, 401);
  assert.deepEqual(JSON.parse(res.body), { error: 'unauthorized' });
});

await test('2. wrong secret → 401', async () => {
  process.env.PT_IMPORT_SECRET = 'the-real-secret';
  try {
    const req = makeReq({ secret: 'wrong-secret' });
    const res = makeRes();
    await importHandler(req, res);
    assert.equal(res.statusCode, 401);
  } finally {
    delete process.env.PT_IMPORT_SECRET;
  }
});

await test('3. wrong method → 405', async () => {
  const req = makeReq({ method: 'GET' });
  const res = makeRes();
  await importHandler(req, res);
  assert.equal(res.statusCode, 405);
});

await test('4. empty body → 400', async () => {
  const req = makeReq({ body: '' });
  const res = makeRes();
  await importHandler(req, res);
  assert.equal(res.statusCode, 400);
});

await test('5. invalid JSON → 400', async () => {
  const req = makeReq({ body: 'this is not json' });
  const res = makeRes();
  await importHandler(req, res);
  assert.equal(res.statusCode, 400);
  assert.equal(JSON.parse(res.body).error, 'invalid_request');
});

await test('6. no `keys` field → 400', async () => {
  const req = makeReq({ body: { other: 'shape' } });
  const res = makeRes();
  await importHandler(req, res);
  assert.equal(res.statusCode, 400);
  assert.equal(JSON.parse(res.body).error, 'invalid_request');
});

await test('7. valid import (localhost) → 200, imported=2', async () => {
  const req = makeReq({
    body: {
      keys: [
        { key: 'swr-band-A2B3C4D5', tier: 'band' },
        'swr-solo-Z2N3K4M5', // tier parsed from key
      ],
    },
  });
  const res = makeRes();
  await importHandler(req, res);
  assert.equal(res.statusCode, 200);
  const body = JSON.parse(res.body);
  assert.equal(body.ok, true);
  assert.equal(body.imported, 2);
  assert.equal(body.skipped, 0);
  assert.deepEqual(body.errors, []);

  // The ledger file should now have 2 records.
  const ledger = JSON.parse(readFileSync(join(TMP, 'pt-keys/index.json'), 'utf8'));
  assert.equal(ledger.length, 2);
  assert.equal(ledger[0].key, 'swr-band-A2B3C4D5');
  assert.equal(ledger[0].tier, 'band');
  assert.equal(ledger[1].key, 'swr-solo-Z2N3K4M5');
  assert.equal(ledger[1].tier, 'solo');
  // operator-import source
  assert.equal(ledger[0].source, 'operator-import');
});

await test('8. idempotency: re-importing same key → imported=0, skipped=1', async () => {
  const req = makeReq({
    body: { keys: ['swr-band-A2B3C4D5'] },
  });
  const res = makeRes();
  await importHandler(req, res);
  assert.equal(res.statusCode, 200);
  const body = JSON.parse(res.body);
  assert.equal(body.imported, 0);
  assert.equal(body.skipped, 1);
  assert.deepEqual(body.skippedKeys, ['swr-band-A2B3C4D5']);
});

await test('9. declared tier is unknown / not in PT_TIERS → 400 invalid_request', async () => {
  // The ImportReq contract declares `tier` as z.enum(['solo','band','label']).
  // A request with an unknown tier fails at the Zod parse step with a 400 —
  // fail-fast is better than silently importing the valid keys and reporting
  // the bad one in the 200 errors[] array, because the operator would miss
  // the failure if they don't inspect the response.
  const req = makeReq({
    body: { keys: [{ key: 'swr-band-A2B3C4D5', tier: 'fakemade' }] },
  });
  const res = makeRes();
  await importHandler(req, res);
  assert.equal(res.statusCode, 400);
  assert.equal(JSON.parse(res.body).error, 'invalid_request');
});

await test('10. format-invalid key → errors[0].error contains "format"', async () => {
  const req = makeReq({
    body: { keys: ['not-a-real-key'] },
  });
  const res = makeRes();
  await importHandler(req, res);
  assert.equal(res.statusCode, 200);
  const body = JSON.parse(res.body);
  assert.equal(body.imported, 0);
  assert.equal(body.errors.length, 1);
  assert.equal(body.errors[0].key, 'not-a-real-key');
  assert.match(body.errors[0].error, /format/i);
});

await test('11. valid secret matches → 200 (production path)', async () => {
  process.env.PT_IMPORT_SECRET = 'production-secret';
  try {
    const req = makeReq({
      secret: 'production-secret',
      ip: '203.0.113.5',  // off-loopback — secret path requires the right secret
      body: { keys: ['swr-solo-A1B2C3D4'] },
    });
    const res = makeRes();
    await importHandler(req, res);
    assert.equal(res.statusCode, 200);
  } finally {
    delete process.env.PT_IMPORT_SECRET;
  }
});

await test('12. valid secret but wrong value → 401', async () => {
  process.env.PT_IMPORT_SECRET = 'production-secret';
  try {
    const req = makeReq({ secret: 'wrong', body: { keys: [] } });
    const res = makeRes();
    await importHandler(req, res);
    assert.equal(res.statusCode, 401);
  } finally {
    delete process.env.PT_IMPORT_SECRET;
  }
});

await test('13. local-file migration: read pt-keys.local.txt → POST each key', async () => {
  // Write a fake local-file ledger and verify a small migration
  // helper. This is the operator's workflow: open pt-keys.local.txt,
  // read each line, POST to the import endpoint. We're not
  // re-implementing the helper here (the real helper lives in
  // scripts/migrate-pt-keys-local.mjs); we just verify the data
  // shape is parseable end-to-end.
  const localFile = join(TMP, 'pt-keys.local.txt');
  const stamp = '2026-10-13T00:00:00.000Z';
  // Use keys that match PT_KEY_RE (alphabet is ABCDEFGHJKLMNPQRSTUVWXYZ23456789
  // but the regex range [A-HJ-NP-Z2-9] excludes I, K, L, M, Q, R, S, T, U, V, W, X, Y).
  // Valid 8-char codes from the allowed range:
  //   2, 3, 4, 5, 6, 7, 8, 9, A, B, C, D, E, F, G, H, J, N, O, P, Z
  const localContent = [
    'swr-label-L1A2B3C4\t' + stamp,   // L → INVALID
    'swr-band-N2A3B4C5\t' + stamp,    // N A B C → valid
    'swr-solo-J2N3P4Z5\t' + stamp,     // J N P Z → valid
    'not-a-key\t' + stamp,            // invalid → skipped
  ].join('\n') + '\n';
  writeFileSync(localFile, localContent);

  // Parse the file (the same logic the migration helper uses)
  const lines = readFileSync(localFile, 'utf8').split('\n').filter(Boolean);
  const parsed = lines.map(function (line) {
    const tab = line.indexOf('\t');
    return { key: tab >= 0 ? line.slice(0, tab) : line, ts: tab >= 0 ? line.slice(tab + 1) : null };
  });

  // POST all valid keys in one batch
  const req = makeReq({
    body: { keys: parsed.filter(function (p) { return /^swr-(solo|band|label)-[A-HJ-NP-Z2-9]{8}$/.test(p.key); }).map(function (p) { return p.key; }) },
  });
  const res = makeRes();
  await importHandler(req, res);
  assert.equal(res.statusCode, 200);
  const body = JSON.parse(res.body);
  assert.equal(body.imported, 2, 'should import the two valid keys');
  // Invalid keys are filtered out by the migration helper BEFORE the
  // POST, so the handler only sees the valid ones. body.errors is
  // about handler-rejected keys, not pre-filtered ones.
  assert.equal(body.errors.length, 0);
  // The two valid keys are now in the ledger; verify.
  const ledger = JSON.parse(readFileSync(join(TMP, 'pt-keys/index.json'), 'utf8'));
  assert.equal(ledger.length, 4, 'two new keys added to the ledger on top of the earlier two (4 total)');
  const keys = ledger.map((r) => r.key);
  assert.ok(keys.includes('swr-band-N2A3B4C5'));
  assert.ok(keys.includes('swr-solo-J2N3P4Z5'));
});

// Cleanup
rmSync(TMP, { recursive: true, force: true });

console.log('');
if (failed) {
  console.log(`FAIL — ${failed} test(s) failed`);
  process.exit(1);
} else {
  console.log('PASS — all PT import cases pass');
  process.exit(0);
}
