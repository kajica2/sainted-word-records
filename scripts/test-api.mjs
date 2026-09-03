#!/usr/bin/env node
// scripts/test-api.mjs — unit-test the db + handlers in-process (no network).
//
// Verifies the same code paths that Vercel and the Vite dev middleware
// exercise, without booting a server. Catches: bad SQL-ish logic in the
// JSON store, broken cookie paths, schema mismatches.
//
// Exit code 0 = all green, 1 = any failure (with reasons on stderr).

import { strict as assert } from 'node:assert';
import { mkdtempSync, rmSync, existsSync, statSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const TMP = mkdtempSync(join(tmpdir(), 'swrc-test-'));
process.env.SWRC_DATA_DIR = TMP;

// Dynamic import so the env var takes effect.
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
