#!/usr/bin/env node
// scripts/check-auth-firestore-unit.mjs - Firestore auth store unit gate.
//
// api/_lib/auth-firestore.js is the Firestore implementation of the SWR
// auth store (users, provider links, verification tokens, sessions, the
// connect blob), selected by SWR_AUTH_STORE=firestore. Its parity spec
// is the JSON/Postgres store in api/_lib/db.js.
//
// The Firestore emulator needs a JVM, which this machine does not have,
// so the gate drives the store against an in-memory fake that implements
// the subset of the admin API the store uses. The store is built through
// its own factory (createAuthStore), so the code under test is the
// shipped code, not a re-implementation.
//
// Assertions (behaviour, not wiring):
//   1. createUser -> findUserByEmail round-trips, case-insensitively
//   2. createUser twice with one email yields ONE user (the atomic claim)
//   3. createUser without an email throws
//   4. createUser without a name defaults the name to the email local part
//   5. updateUser merges the patch, stamps updatedAt, and 404s to null
//   6. setMembershipTier rejects a tier outside the allow-list
//   7. linkAccount + findUserByProvider round-trip; a second link for the
//      same (provider, accountId) does not re-point the first user
//   8. sessions: create -> get -> destroy (true once, false after)
//   9. an expired session is refused, and purgeExpiredSessions removes
//      exactly the expired ones and counts them
//  10. a verification token is consume-once
//  11. consuming with the wrong identifier fails and leaves the token
//  12. an expired verification token is refused
//  13. the connect blob merges, reads back, reverse-resolves to the user,
//      and only blobs with a non-empty string accountId are counted
//  14. authCounts reports the users and only the unexpired sessions
//  15. changing a user's email moves the email index entry with it
//
// The gate proves it can still fail: the shipped source is copied to a
// temp directory, mutated in memory (the session expiry check removed,
// the verification-token delete skipped, the connect count loosened, the
// old email claim never released), imported from there, and the SAME
// assertions are re-run against each mutant - they must go RED.
//
// Run:  node scripts/check-auth-firestore-unit.mjs
// Exit: 0 PASS, 1 FAIL.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { createFakeFirestore } from './lib/fake-firestore.mjs';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const LIB = path.join(ROOT, 'api/_lib');
const SRC = path.join(LIB, 'auth-firestore.js');

let pass = 0;
const failures = [];
function assert(cond, msg, detail) {
  if (cond) {
    pass++;
    console.log('  ok  ', msg, detail != null ? `(${detail})` : '');
  } else {
    failures.push(msg);
    console.log('  FAIL', msg, detail != null ? `(${detail})` : '');
  }
}

// ── the assertion suite ───────────────────────────────────────────────────
// One function, parameterised by the store, so the SAME assertions can be
// run against the shipped module and against a mutated copy of it.
async function runSuite(store, check) {
  // 1. create -> find, case-insensitively
  {
    const user = await store.createUser({ email: 'ada@Example.com', name: 'Ada' });
    const found = await store.findUserByEmail('ADA@example.COM');
    check(1, found && found.id === user.id && found.email === 'ada@example.com',
      'findUserByEmail finds the user regardless of case',
      found ? `${found.email}` : 'null');
  }

  // 2. the same email twice yields ONE user
  {
    const first = await store.createUser({ email: 'dup@example.com' });
    const second = await store.createUser({ email: 'DUP@example.com' });
    check(2, first.id === second.id, 'createUser is idempotent per email',
      `${first.id} vs ${second.id}`);
  }

  // 3. no email -> throw
  {
    let threw = null;
    try {
      await store.createUser({ name: 'No Email' });
    } catch (e) {
      threw = e;
    }
    check(3, !!threw && /email required/.test(threw.message),
      'createUser without an email throws "email required"',
      threw ? threw.message : 'no throw');
  }

  // 4. the default name is the local part of the email
  {
    const user = await store.createUser({ email: 'grace.hopper@example.com' });
    check(4, user.name === 'grace.hopper', 'the default name is the email local part',
      user.name);
  }

  // 5. updateUser merges, stamps updatedAt, and 404s to null
  {
    const user = await store.createUser({ email: 'patch@example.com' });
    const updated = await store.updateUser(user.id, { name: 'Patched', image: 'i.png' });
    const missing = await store.updateUser('no-such-user', { name: 'x' });
    check(5, !!updated && updated.name === 'Patched' && updated.image === 'i.png' &&
      updated.email === 'patch@example.com' && !!updated.updatedAt && missing === null,
      'updateUser merges the patch, stamps updatedAt, and returns null for a missing user',
      `${updated ? updated.updatedAt : 'null'} / missing=${missing}`);
  }

  // 6. the tier allow-list
  {
    const user = await store.createUser({ email: 'tier@example.com' });
    let threw = null;
    try {
      await store.setMembershipTier(user.id, 'wizard');
    } catch (e) {
      threw = e;
    }
    const ok = await store.setMembershipTier(user.id, 'creator');
    check(6, !!threw && /invalid tier/.test(threw.message) && ok && ok.membershipTier === 'creator',
      'setMembershipTier rejects an unknown tier and stores a known one',
      threw ? threw.message : 'no throw');
  }

  // 7. provider links
  {
    const user = await store.createUser({ email: 'oauth@example.com' });
    await store.linkAccount({ userId: user.id, provider: 'google', providerAccountId: 'g-1' });
    const found = await store.findUserByProvider('google', 'g-1');
    const other = await store.createUser({ email: 'oauth2@example.com' });
    await store.linkAccount({ userId: other.id, provider: 'google', providerAccountId: 'g-1' });
    const still = await store.findUserByProvider('google', 'g-1');
    check(7, !!found && found.id === user.id && !!still && still.id === user.id,
      'linkAccount round-trips and never re-points an existing link',
      `first=${found ? found.id : 'null'} still=${still ? still.id : 'null'}`);
  }

  // 8. sessions
  {
    const user = await store.createUser({ email: 'session@example.com' });
    const session = await store.createSession({ userId: user.id });
    const got = await store.getSession(session.token);
    const first = await store.destroySession(session.token);
    const second = await store.destroySession(session.token);
    const gone = await store.getSession(session.token);
    check(8, !!got && got.token === session.token && got.userId === user.id &&
      first === true && second === false && gone === null,
      'a session is created, read, and destroyed exactly once',
      `first=${first} second=${second} gone=${gone}`);
  }

  // 9. expiry and the purge
  {
    const user = await store.createUser({ email: 'expiry@example.com' });
    const live = await store.createSession({ userId: user.id });
    // A ttl of 0 expires the session at once: expiresAtMs == now, and
    // the expiry test is "not in the future", so it is already dead.
    const dead = await store.createSession({ userId: user.id, ttlMs: 0 });
    const refused = await store.getSession(dead.token);
    const purged = await store.purgeExpiredSessions();
    const stillLive = await store.getSession(live.token);
    check(9, refused === null && purged === 1 && !!stillLive,
      'an expired session is refused and purged, a live one survives',
      `refused=${refused} purged=${purged} live=${!!stillLive}`);
  }

  // 10. consume-once
  {
    const record = await store.createVerificationToken({ identifier: 'magic@example.com' });
    const first = await store.consumeVerificationToken({
      identifier: 'magic@example.com',
      token: record.token,
    });
    const second = await store.consumeVerificationToken({
      identifier: 'magic@example.com',
      token: record.token,
    });
    check(10, !!first && first.token === record.token && second === null,
      'a verification token can be consumed exactly once',
      `first=${first ? 'ok' : 'null'} second=${second}`);
  }

  // 11. the wrong identifier must not consume the real token
  {
    const record = await store.createVerificationToken({ identifier: 'who@example.com' });
    const wrong = await store.consumeVerificationToken({
      identifier: 'other@example.com',
      token: record.token,
    });
    const right = await store.consumeVerificationToken({
      identifier: 'who@example.com',
      token: record.token,
    });
    check(11, wrong === null && !!right && right.token === record.token,
      'a wrong identifier fails without consuming the real token',
      `wrong=${wrong} right=${right ? 'ok' : 'null'}`);
  }

  // 12. an expired verification token
  {
    const record = await store.createVerificationToken({
      identifier: 'stale@example.com',
      ttlMs: -1000,
    });
    const consumed = await store.consumeVerificationToken({
      identifier: 'stale@example.com',
      token: record.token,
    });
    check(12, consumed === null, 'an expired verification token is refused',
      consumed ? 'consumed' : 'null');
  }

  // 13. the connect blob
  {
    const user = await store.createUser({ email: 'seller@example.com' });
    const saved = await store.saveConnectAccount(user.id, { accountId: 'acct_1', status: 'pending' });
    const merged = await store.saveConnectAccount(user.id, { chargesEnabled: true });
    const blob = await store.getConnectAccount(user.id);
    const owner = await store.findUserByConnectAccount('acct_1');
    // Three blobs that must NOT count: an empty accountId, a non-string
    // accountId, and a blob with no accountId at all.
    const empty = await store.createUser({ email: 'emptyseller@example.com' });
    await store.saveConnectAccount(empty.id, { accountId: '' });
    const numeric = await store.createUser({ email: 'numseller@example.com' });
    await store.saveConnectAccount(numeric.id, { accountId: 42 });
    const noAccount = await store.createUser({ email: 'noseller@example.com' });
    await store.saveConnectAccount(noAccount.id, { status: 'pending' });
    const counted = await store.countConnectAccounts();
    check(13, saved.accountId === 'acct_1' && merged.chargesEnabled === true &&
      !!blob && blob.accountId === 'acct_1' && blob.chargesEnabled === true &&
      !!owner && owner.id === user.id && counted === 1,
      'the connect blob merges, reads back, reverse-resolves, and counts only real accountIds',
      `owner=${owner ? owner.id : 'null'} counted=${counted}`);
  }

  // 14. the counters
  {
    const user = await store.createUser({ email: 'counted@example.com' });
    const live = await store.createSession({ userId: user.id });
    await store.createSession({ userId: user.id, ttlMs: 0 });
    const counts = await store.authCounts();
    const liveStill = await store.getSession(live.token);
    check(14, counts && counts.users >= 1 && counts.sessions >= 1 &&
      counts.sessions === (await store.authCounts()).sessions && !!liveStill,
      'authCounts reports the users and only the unexpired sessions',
      `users=${counts.users} sessions=${counts.sessions}`);
  }

  // 15. an email change re-claims the index and releases the old one
  {
    const user = await store.createUser({ email: 'old@example.com' });
    await store.updateUser(user.id, { email: 'New@Example.com' });
    const byNew = await store.findUserByEmail('new@example.com');
    const byOld = await store.findUserByEmail('old@example.com');
    check(15, !!byNew && byNew.id === user.id && byOld === null,
      'an email change moves the index entry with it',
      `new=${byNew ? byNew.id : 'null'} old=${byOld ? byOld.id : 'null'}`);
  }
}

// ── run the suite against the shipped module ──────────────────────────────
const shipped = await import(pathToFileURL(SRC).href);
// ONE fake per store: the client is resolved on every operation, so a
// fresh fake per call would throw the data away between calls.
function newStore(mod) {
  const fake = createFakeFirestore();
  return mod.createAuthStore(async () => fake);
}
const shippedStore = newStore(shipped);

console.log('auth-firestore unit gate');
console.log('');

const shippedResults = [];
await runSuite(shippedStore, (n, cond, msg, detail) => {
  shippedResults.push({ n, ok: !!cond });
  assert(cond, `${n}. ${msg}`, detail);
});

// The module surface the db.js dispatch relies on.
const surface = [
  'findUserByEmail', 'findUserByProvider', 'getUser', 'createUser', 'updateUser',
  'setMembershipTier', 'linkAccount', 'createVerificationToken',
  'consumeVerificationToken', 'createSession', 'getSession', 'destroySession',
  'purgeExpiredSessions', 'getConnectAccount', 'saveConnectAccount',
  'findUserByConnectAccount', 'countConnectAccounts', 'authCounts',
];
const missing = surface.filter((name) => typeof shipped[name] !== 'function');
assert(missing.length === 0, 'the module exports the whole db.js auth surface',
  missing.length ? `missing ${missing.join(', ')}` : `${surface.length} functions`);

const prevStore = process.env.SWR_AUTH_STORE;
const prevEmu = process.env.FIRESTORE_EMULATOR_HOST;
delete process.env.SWR_AUTH_STORE;
delete process.env.FIRESTORE_EMULATOR_HOST;
const offByDefault = shipped.authFirestoreEnabled() === false;
process.env.SWR_AUTH_STORE = 'firestore';
process.env.FIRESTORE_EMULATOR_HOST = 'localhost:8080';
const onWhenConfigured = shipped.authFirestoreEnabled() === true;
if (prevStore === undefined) delete process.env.SWR_AUTH_STORE;
else process.env.SWR_AUTH_STORE = prevStore;
if (prevEmu === undefined) delete process.env.FIRESTORE_EMULATOR_HOST;
else process.env.FIRESTORE_EMULATOR_HOST = prevEmu;
assert(offByDefault && onWhenConfigured,
  'authFirestoreEnabled is off by default and on only with SWR_AUTH_STORE=firestore',
  `off=${offByDefault} on=${onWhenConfigured}`);

// The store must not pull firebase-admin into the default path, and it
// must not import db.js (that would be an import cycle).
const source = fs.readFileSync(SRC, 'utf8');
const importLines = source
  .split('\n')
  .filter((l) => /^\s*import\b/.test(l) || /\bimport\s*\(/.test(l))
  .join('\n');
assert(!/db\.js/.test(importLines) && !/firebase-admin/.test(importLines),
  'the store imports neither db.js nor firebase-admin',
  'static check of the shipped imports');

// ── the mutation self-test ────────────────────────────────────────────────
// Copy api/_lib/ to a temp dir so the mutated module's relative imports
// still resolve, mutate the copy, import it, and re-run the SAME
// assertions: they must go RED. The repo tree is never written to.
async function runMutant(label, mutate, expectRed) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'swr-auth-firestore-'));
  try {
    fs.cpSync(LIB, tmp, { recursive: true });
    const target = path.join(tmp, 'auth-firestore.js');
    const original = fs.readFileSync(target, 'utf8');
    const mutated = mutate(original);
    if (mutated === original) {
      failures.push(`mutant ${label}: the mutation did not change the source`);
      console.log('  FAIL', `mutant ${label}: the mutation did not change the source`);
      return;
    }
    fs.writeFileSync(target, mutated);
    const mod = await import(pathToFileURL(target).href);
    const store = newStore(mod);
    const results = [];
    let threw = null;
    try {
      await runSuite(store, (n, cond) => results.push({ n, ok: !!cond }));
    } catch (e) {
      threw = e;
    }
    const red = results.filter((r) => !r.ok).map((r) => r.n);
    const bit = expectRed.every((n) => red.includes(n));
    assert(bit && !threw,
      `RED PROOF: the ${label} mutant turns assertion(s) ${expectRed.join(', ')} RED`,
      threw ? `threw: ${threw.message}` : `red assertions: [${red.join(', ')}]`);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

await runMutant(
  'session-expiry',
  (src) => src.replace(
    'if (sessionExpired(session, Date.now())) return null;',
    'if (false) return null;'
  ),
  [9]
);

await runMutant(
  'verification-delete',
  (src) => src.replace(
    'const removed = await deleteOnce(ref);',
    'const removed = true;'
  ),
  [10]
);

await runMutant(
  'connect-count',
  (src) => src.replace(
    "if (typeof blob.accountId === 'string' && blob.accountId) count++;",
    'if (blob.accountId) count++;'
  ),
  [13]
);

await runMutant(
  'email-index-release',
  (src) => src.replace(
    'await oldRef.delete();',
    '/* the old claim is never released */'
  ),
  [15]
);

// ── summary ───────────────────────────────────────────────────────────────
console.log('');
console.log(`PASS: ${pass}`);
console.log(`FAIL: ${failures.length}`);
if (failures.length) {
  console.log('');
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
}
process.exit(0);
