#!/usr/bin/env node
// scripts/test-api.mjs — unit-test the db + handlers in-process (no network).
//
// Verifies the same code paths that Vercel and the Vite dev middleware
// exercise, without booting a server. Catches: bad SQL-ish logic in the
// JSON store, broken cookie paths, schema mismatches.
//
// Exit code 0 = all green, 1 = any failure (with reasons on stderr).

import { strict as assert } from 'node:assert';
import { createHmac } from 'node:crypto';
import { mkdtempSync, rmSync, existsSync, statSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const TMP = mkdtempSync(join(tmpdir(), 'swrc-test-'));
process.env.SWRC_DATA_DIR = TMP;

// Dynamic import so the env var takes effect.
const db = await import('../api/_lib/db.js');
const cat = await import('../api/_lib/catalogue.js');

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

console.log('db:');

// --- users ---
await test('createUser + findUserByEmail roundtrip', async () => {
  const u = await db.createUser({ email: 'kai@saintedwordrecords.com', name: 'Kai' });
  assert.equal(u.email, 'kai@saintedwordrecords.com');
  assert.equal(u.name, 'Kai');
  const fetched = await db.findUserByEmail('KAI@saintedwordrecords.com');
  assert.equal(fetched.id, u.id);
});

await test('createUser is idempotent', async () => {
  const a = await db.createUser({ email: 'dup@x.com' });
  const b = await db.createUser({ email: 'dup@x.com' });
  assert.equal(a.id, b.id);
});

// --- sessions ---
let sessionToken;
await test('createSession + getSession', async () => {
  const u = await db.createUser({ email: 'sess@x.com' });
  const s = await db.createSession({ userId: u.id });
  assert.ok(s.token && s.token.length >= 20);
  sessionToken = s.token;
  const got = await db.getSession(s.token);
  assert.equal(got.userId, u.id);
});

await test('getSession rejects expired tokens', async () => {
  const u = await db.createUser({ email: 'expired@x.com' });
  const s = await db.createSession({ userId: u.id, ttlMs: -1000 });
  const got = await db.getSession(s.token);
  assert.equal(got, null);
});

await test('destroySession', async () => {
  const ok = await db.destroySession(sessionToken);
  assert.equal(ok, true);
  const got = await db.getSession(sessionToken);
  assert.equal(got, null);
});

// --- verifications ---
await test('createVerificationToken + consumeVerificationToken', async () => {
  const v = await db.createVerificationToken({ identifier: 'verify@x.com' });
  assert.ok(v.token.length >= 20);
  const consumed = await db.consumeVerificationToken({ identifier: 'verify@x.com', token: v.token });
  assert.equal(consumed.identifier, 'verify@x.com');
  // Second consume returns null (one-shot)
  const again = await db.consumeVerificationToken({ identifier: 'verify@x.com', token: v.token });
  assert.equal(again, null);
});

await test('consumeVerificationToken rejects mismatched email', async () => {
  const v = await db.createVerificationToken({ identifier: 'a@x.com' });
  const consumed = await db.consumeVerificationToken({ identifier: 'b@x.com', token: v.token });
  assert.equal(consumed, null);
});

// --- projects ---
await test('upsertProject + listProjects + getProject', async () => {
  const u = await db.createUser({ email: 'proj@x.com' });
  const meta = await db.upsertProject(u.id, null, { name: 'My first project', library: [], layers: [] });
  assert.ok(meta.id);
  const list = await db.listProjects(u.id);
  assert.equal(list.length, 1);
  assert.equal(list[0].id, meta.id);
  const got = await db.getProject(u.id, meta.id);
  assert.equal(got.doc.name, 'My first project');
});

await test('upsertProject on existing id is idempotent', async () => {
  const u = await db.createUser({ email: 'idem@x.com' });
  const a = await db.upsertProject(u.id, null, { name: 'A', library: [], layers: [] });
  const b = await db.upsertProject(u.id, a.id, { name: 'B', library: [], layers: [] });
  assert.equal(a.id, b.id);
  assert.equal(b.name, 'B');
  const list = await db.listProjects(u.id);
  assert.equal(list.length, 1);
});

await test('upsertProject enforces ownership on getProject', async () => {
  const alice = await db.createUser({ email: 'alice@x.com' });
  const bob = await db.createUser({ email: 'bob@x.com' });
  const meta = await db.upsertProject(alice.id, null, { name: 'secret', library: [], layers: [] });
  const bobView = await db.getProject(bob.id, meta.id);
  assert.equal(bobView, null);
});

await test('softDeleteProject hides from default list', async () => {
  const u = await db.createUser({ email: 'del@x.com' });
  const meta = await db.upsertProject(u.id, null, { name: 'gone', library: [], layers: [] });
  await db.softDeleteProject(u.id, meta.id);
  const list = await db.listProjects(u.id);
  assert.equal(list.length, 0);
  const all = await db.listProjects(u.id, { includeDeleted: true });
  assert.equal(all.length, 1);
});

// --- storage ---
await test('storagePut + storageGet', async () => {
  const u = await db.createUser({ email: 'storage@x.com' });
  const result = await db.storagePut(u.id, 'songs/test.mp3', Buffer.from('XX'), 'audio/mpeg');
  assert.equal(result.size, 2);
  const got = await db.storageGet(u.id, 'songs/test.mp3');
  assert.equal(got.body.toString(), 'XX');
});

await test('storageGet rejects keys outside user scope', async () => {
  const u = await db.createUser({ email: 'scope@x.com' });
  await db.storagePut(u.id, 'songs/a.mp3', Buffer.from('a'), 'audio/mpeg');
  // Should not find a key with a different prefix:
  const got = await db.storageGet('00000000-0000-0000-0000-000000000000', 'songs/a.mp3');
  assert.equal(got, null);
});

await test('safeKey rejects path traversal', () => {
  assert.throws(() => db.safeKey('../etc/passwd'));
  assert.throws(() => db.safeKey('/absolute'));
  assert.throws(() => db.safeKey('with\\backslash'));
  assert.doesNotThrow(() => db.safeKey('relative/path.mp3'));
});

// --- rate limit ---
await test('rateLimit caps and recovers', () => {
  const k = 'rl-test-' + Date.now();
  for (let i = 0; i < 5; i++) {
    assert.equal(db.rateLimit({ key: k, windowMs: 60_000, max: 5 }).ok, true);
  }
  const blocked = db.rateLimit({ key: k, windowMs: 60_000, max: 5 });
  assert.equal(blocked.ok, false);
});

// --- P3.4: getSharedProject ---
await test('getSharedProject returns null for unknown shareId', async () => {
  const r = await db.getSharedProject('zzz_nope_' + Date.now());
  assert.equal(r, null);
});
await test('getSharedProject rejects malformed shareId', async () => {
  assert.equal(await db.getSharedProject(''), null);
  assert.equal(await db.getSharedProject(null), null);
  // Path traversal: must be rejected by the shareId regex.
  assert.equal(await db.getSharedProject('../etc/passwd'), null);
  assert.equal(await db.getSharedProject('has spaces'), null);
});
await test('getSharedProject returns the doc when share:true + shareId match', async () => {
  // Need a user to create the project. Reuse the project-save path from
  // earlier tests — create a user, upsert a project with share:true +
  // shareId, then look it up.
  const user = await db.createUser({ email: `share-${Date.now()}@example.com`, name: 'Share User' });
  const shareId = 'sh_' + Math.random().toString(36).slice(2, 10);
  const meta = await db.upsertProject(user.id, null, {
    name: 'Shared Project',
    doc: { foo: 'bar' },
    share: true,
    shareId,
  });
  const got = await db.getSharedProject(shareId);
  assert.ok(got, 'expected shared project to be returned');
  assert.equal(got.share, true);
  assert.equal(got.shareId, shareId);
  // The user-provided fields live under .doc (project doc nesting)
  assert.equal(got.doc.doc.foo, 'bar');
  // Privacy: userId must NOT be in the public payload
  assert.equal(got.userId, undefined, 'userId must be stripped from public doc');
});
await test('getSharedProject returns null for share:false projects', async () => {
  const user = await db.createUser({ email: `noshare-${Date.now()}@example.com`, name: 'No Share' });
  await db.upsertProject(user.id, null, {
    name: 'Private Project',
    doc: { foo: 'bar' },
    share: false,
    shareId: 'private123',
  });
  const got = await db.getSharedProject('private123');
  assert.equal(got, null, 'private projects must not be retrievable via shareId');
});

// --- Stripe Connect (pilot) ---
await test('getConnectAccount/saveConnectAccount roundtrip', async () => {
  const u = await db.createUser({ email: 'connect@x.com' });
  assert.equal(await db.getConnectAccount(u.id), null);
  const saved = await db.saveConnectAccount(u.id, { accountId: 'acct_test_1', status: 'pending' });
  assert.equal(saved.accountId, 'acct_test_1');
  const got = await db.getConnectAccount(u.id);
  assert.equal(got.status, 'pending');
});

await test('countConnectAccounts counts only accounts with accountId', async () => {
  const before = await db.countConnectAccounts();
  const u = await db.createUser({ email: `ca-${Date.now()}@x.com` });
  await db.saveConnectAccount(u.id, { accountId: 'acct_test_2' });
  const after = await db.countConnectAccounts();
  assert.equal(after, before + 1);
});

await test('findUserByConnectAccount reverse lookup', async () => {
  const u = await db.createUser({ email: `rev-${Date.now()}@x.com` });
  await db.saveConnectAccount(u.id, { accountId: 'acct_test_rev' });
  const found = await db.findUserByConnectAccount('acct_test_rev');
  assert.equal(found.id, u.id);
  assert.equal(await db.findUserByConnectAccount('acct_test_nope'), null);
});

await test('recordConnectEvent is idempotent', async () => {
  const ev = { id: 'evt_test_1', type: 'checkout.session.completed', data: { amount: 2500 } };
  await db.recordConnectEvent(ev);
  const dup = await db.recordConnectEvent(ev);
  assert.equal(dup.id, ev.id);
  const all = await db.listConnectEvents();
  assert.equal(all.filter((e) => e.id === ev.id).length, 1);
});

// Connect data abstraction: without SWR_CONNECT_STORE=firestore the store
// must delegate to the JSON/Postgres-backed db.js helpers.
const cs = await import('../api/_lib/connect-store.js');
await test('connect-store uses JSON backend when Firestore is dormant', async () => {
  assert.equal(cs.connectStoreBackend(), 'json');
  const u = await db.createUser({ email: `cs-${Date.now()}@x.com` });
  assert.equal(await cs.getConnectAccount(u.id), null);
  await cs.saveConnectAccount(u.id, { accountId: 'acct_cs_1', status: 'pending' });
  assert.equal((await cs.getConnectAccount(u.id)).accountId, 'acct_cs_1');
  const found = await cs.findUserByConnectAccount('acct_cs_1');
  assert.equal(found.id, u.id);
});

// Stripe webhook signature verification (pure crypto, no keys needed).
const { verifyWebhookSignature } = await import('../api/_lib/stripe.js');
await test('verifyWebhookSignature accepts a valid signed payload', async () => {
  const secret = 'whsec_test_secret';
  const payload = JSON.stringify({ id: 'evt_x', type: 'account.updated' });
  const t = Math.floor(Date.now() / 1000);
  const v1 = createHmac('sha256', secret).update(`${t}.${payload}`).digest('hex');
  assert.equal(verifyWebhookSignature({ payload, signature: `t=${t},v1=${v1}`, secret }), true);
});
await test('verifyWebhookSignature rejects a tampered payload', async () => {
  const secret = 'whsec_test_secret';
  const t = Math.floor(Date.now() / 1000);
  const v1 = createHmac('sha256', secret).update(`${t}.{"id":"evt_x"}`).digest('hex');
  assert.equal(verifyWebhookSignature({ payload: '{"id":"evt_y"}', signature: `t=${t},v1=${v1}`, secret }), false);
});
await test('verifyWebhookSignature rejects a stale signature', async () => {
  const secret = 'whsec_test_secret';
  const payload = '{}';
  const t = Math.floor(Date.now() / 1000) - 400;
  const v1 = createHmac('sha256', secret).update(`${t}.${payload}`).digest('hex');
  assert.equal(verifyWebhookSignature({ payload, signature: `t=${t},v1=${v1}`, secret }), false);
});

// --- Seller catalogue (pilot) ---
await test('createCatalogItem + listCatalog + getCatalogItem', async () => {
  const u = await db.createUser({ email: `cat-${Date.now()}@x.com` });
  const item = await cat.createCatalogItem({
    userId: u.id,
    input: {
      type: 'song',
      title: 'Midnight Drive',
      priceMinor: 500,
      media: [{ kind: 'audio', key: `${u.id}/catalogue/a.mp3`, name: 'a.mp3', size: 10 }],
      tags: ['jazz', '120bpm'],
    },
  });
  assert.equal(item.type, 'song');
  assert.equal(item.priceMinor, 500);
  const list = await cat.listCatalog(u.id);
  assert.equal(list.length, 1);
  const got = await cat.getCatalogItem(u.id, item.id);
  assert.equal(got.title, 'Midnight Drive');
});

await test('catalogue ownership is enforced', async () => {
  const alice = await db.createUser({ email: `cat-a-${Date.now()}@x.com` });
  const bob = await db.createUser({ email: `cat-b-${Date.now()}@x.com` });
  const item = await cat.createCatalogItem({ userId: alice.id, input: { type: 'video', title: 'Secret clips', priceMinor: 1000 } });
  assert.equal(await cat.getCatalogItem(bob.id, item.id), null);
  assert.equal(await cat.updateCatalogItem({ userId: bob.id, id: item.id, patch: { title: 'hijack' } }), null);
  assert.equal(await cat.deleteCatalogItem({ userId: bob.id, id: item.id }), null);
  assert.equal((await cat.getCatalogItem(alice.id, item.id)).title, 'Secret clips');
});

await test('catalogue validation rejects bad input', async () => {
  const u = await db.createUser({ email: `cat-v-${Date.now()}@x.com` });
  await assert.rejects(() => cat.createCatalogItem({ userId: u.id, input: { type: 'nope', title: 'x', priceMinor: 100 } }), /invalid type/);
  await assert.rejects(() => cat.createCatalogItem({ userId: u.id, input: { type: 'song', title: '', priceMinor: 100 } }), /title/);
  await assert.rejects(() => cat.createCatalogItem({ userId: u.id, input: { type: 'song', title: 'x', priceMinor: -5 } }), /priceMinor/);
  // Media keys must belong to the seller.
  await assert.rejects(
    () => cat.createCatalogItem({ userId: u.id, input: { type: 'song', title: 'x', priceMinor: 100, media: [{ kind: 'audio', key: 'someone-else/a.mp3' }] } }),
    /scope/
  );
});

await test('catalogue bundles only same-seller items', async () => {
  const u = await db.createUser({ email: `cat-bu-${Date.now()}@x.com` });
  const song = await cat.createCatalogItem({ userId: u.id, input: { type: 'song', title: 'S', priceMinor: 300 } });
  const pack = await cat.createCatalogItem({ userId: u.id, input: { type: 'pack', title: 'P', priceMinor: 900, bundleOf: [song.id] } });
  assert.equal(pack.bundleOf.length, 1);
  assert.equal(pack.bundleOf[0], song.id);
  // Foreign + unknown refs are dropped silently.
  const other = await db.createUser({ email: `cat-bu2-${Date.now()}@x.com` });
  const foreign = await cat.createCatalogItem({ userId: other.id, input: { type: 'video', title: 'F', priceMinor: 100 } });
  const p2 = await cat.createCatalogItem({ userId: u.id, input: { type: 'pack', title: 'P2', priceMinor: 900, bundleOf: [foreign.id, 'zzz-not-real'] } });
  assert.deepEqual(p2.bundleOf, []);
});

await test('catalogue delete soft-hides the item', async () => {
  const u = await db.createUser({ email: `cat-d-${Date.now()}@x.com` });
  const item = await cat.createCatalogItem({ userId: u.id, input: { type: 'song', title: 'gone', priceMinor: 100 } });
  await cat.deleteCatalogItem({ userId: u.id, id: item.id });
  assert.equal(await cat.getCatalogItem(u.id, item.id), null);
  assert.equal((await cat.listCatalog(u.id)).length, 0);
});

await test('catalogue update is a whitelist patch', async () => {
  const u = await db.createUser({ email: `cat-p-${Date.now()}@x.com` });
  const item = await cat.createCatalogItem({ userId: u.id, input: { type: 'song', title: 'A', priceMinor: 100 } });
  const upd = await cat.updateCatalogItem({ userId: u.id, id: item.id, patch: { title: 'B', sneaky: true } });
  assert.equal(upd.title, 'B');
  assert.equal(upd.sneaky, undefined);
});

await test('featured media — at most one, video-only, survives roundtrip', async () => {
  const u = await db.createUser({ email: `cat-f-${Date.now()}@x.com` });
  const star = { kind: 'video', key: `${u.id}/catalogue/star.webm`, name: 'star.webm', size: 12, featured: true };
  const alt = { kind: 'video', key: `${u.id}/catalogue/alt.webm`, name: 'alt.webm', size: 12, featured: true };
  const song = { kind: 'audio', key: `${u.id}/catalogue/song.mp3`, name: 'song.mp3', size: 12, featured: true };
  const jpg = { kind: 'image', key: `${u.id}/catalogue/cover.jpg`, name: 'cover.jpg', size: 12 };
  const item = await cat.createCatalogItem({
    userId: u.id,
    input: { type: 'pack', title: 'Webm pack', priceMinor: 500, media: [alt, star, song, jpg] },
  });
  const media = item.media || [];
  // Two videos claim featured -> only the FIRST survives; audio cannot claim it.
  const featured = media.filter((m) => m.featured);
  assert.equal(featured.length, 1, 'exactly one featured entry');
  assert.equal(featured[0].key, alt.key, 'first video keeps the featured flag');
  assert.equal(media.find((m) => m.key === song.key).featured, false, 'audio cannot be featured');
  assert.equal(media.find((m) => m.key === jpg.key).featured, false, 'image not featured');
  // Roundtrip through a fresh read keeps the flag.
  const got = await cat.getCatalogItem(u.id, item.id);
  assert.equal((got.media || []).filter((m) => m.featured).length, 1);
});

// --- health ---
await test('health reports user/session/project counts', async () => {
  const h = await db.health();
  assert.equal(h.ok, true);
  assert.ok(typeof h.users === 'number' && h.users >= 6);
  assert.ok(typeof h.projects === 'number' && h.projects >= 3);
});

// Cleanup
rmSync(TMP, { recursive: true, force: true });

console.log(failed === 0 ? '\nALL GREEN' : `\n${failed} FAILED`);
process.exit(failed === 0 ? 0 : 1);
