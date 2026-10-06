#!/usr/bin/env node
// scripts/check-slots-unit.mjs — unit coverage for the server-side video-slot
// ledger (api/_lib/slots.js) against the real JSON store, hermetically.
//
// The slot ledger is backend-transparent (same calls on files or Postgres); a
// temp SWRC_DATA_DIR forces the JSON backend so the tests exercise the actual
// read-modify-write + withLock paths without any external service.
//
// Covers:
//   - grant flow: user creation, ledger record, audit file, state bump
//   - register flow against the quota, with the trial marker
//   - quota wall: registerVideos rejects over-quota counts, state unchanged
//   - validation: bad email / bad slots / bad count all fail before writes
//   - state bumps: totalSlots accumulates, granted counts grant records
//   - double grant ACCUMULATES (documented semantic — see the module header)
//   - listGrants / syncPayload shapes
//
// Exit code 0 = all green, 1 = any failure (with reasons on stderr).

import { strict as assert } from 'node:assert';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const TMP = mkdtempSync(join(tmpdir(), 'swrc-slots-unit-'));
process.env.SWRC_DATA_DIR = TMP;

const db = await import('../api/_lib/db.js');
const slots = await import('../api/_lib/slots.js');

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

const A_EMAIL = 'alice@example.com';

console.log('slots unit:');

// --- validation helpers ---
await test('normalizeEmail accepts + normalizes, rejects junk', () => {
  assert.equal(slots.normalizeEmail('  Alice@EXAMPLE.com '), 'alice@example.com');
  assert.equal(slots.normalizeEmail('not-an-email'), null);
  assert.equal(slots.normalizeEmail('a@b'), null); // no TLD
  assert.equal(slots.normalizeEmail(null), null);
  assert.equal(slots.normalizeEmail(42), null);
});

await test('normalizeSlots only accepts 10 / 30 / 50 (numbers or numeric strings)', () => {
  assert.equal(slots.normalizeSlots(10), 10);
  assert.equal(slots.normalizeSlots('30'), 30);
  assert.equal(slots.normalizeSlots(50), 50);
  assert.equal(slots.normalizeSlots(7), null);
  assert.equal(slots.normalizeSlots(100), null);
  assert.equal(slots.normalizeSlots('10.5'), null);
  assert.equal(slots.normalizeSlots(null), null);
  assert.equal(slots.normalizeSlots(undefined), null);
});

// --- grant flow ---
await test('grant flow: ledger record + audit file + state bump', async () => {
  const user = await db.createUser({ email: A_EMAIL });
  const { grant, state } = await slots.grantSlots({ userId: user.id, email: A_EMAIL, slots: 30, note: 'invoice 42' });

  assert.equal(state.totalSlots, 30);
  assert.equal(state.granted, 1);
  assert.equal(state.registered, 0);
  assert.equal(state.email, A_EMAIL);
  // grant record shape (the eventual Stripe line item)
  assert.equal(grant.slots, 30);
  assert.equal(grant.email, A_EMAIL);
  assert.equal(grant.userId, user.id);
  assert.equal(grant.source, 'admin-grant');
  assert.equal(grant.paid, false);
  assert.equal(grant.note, 'invoice 42');
  assert.ok(grant.createdAt && !Number.isNaN(Date.parse(grant.createdAt)));
  // audit copy exists on disk (JSON backend)
  const audit = join(TMP, 'slots', 'grants', user.id, `${grant.id}.json`);
  assert.ok(existsSync(audit), 'audit grant file should exist');
  const onDisk = JSON.parse(readFileSync(audit, 'utf8'));
  assert.equal(onDisk.id, grant.id);
  assert.equal(onDisk.slots, 30);
});

await test('grant flow: state file written with running totals', async () => {
  const user = await db.createUser({ email: 'bob@example.com' });
  await slots.grantSlots({ userId: user.id, email: 'bob@example.com', slots: 10 });
  const stateFile = join(TMP, 'slots', 'state', `${user.id}.json`);
  assert.ok(existsSync(stateFile), 'state file should exist');
  const state = JSON.parse(readFileSync(stateFile, 'utf8'));
  assert.equal(state.totalSlots, 10);
  assert.equal(state.granted, 1);
  assert.equal(state.registered, 0);
});

await test('double grant ACCUMULATES (append-only ledger, documented)', async () => {
  const user = await db.createUser({ email: 'carol@example.com' });
  const first = await slots.grantSlots({ userId: user.id, email: 'carol@example.com', slots: 30 });
  const second = await slots.grantSlots({ userId: user.id, email: 'carol@example.com', slots: 10 });
  assert.equal(second.state.totalSlots, 40, '30 + 10 should accumulate to 40');
  assert.equal(second.state.granted, 2, 'two grant records');
  assert.notEqual(first.grant.id, second.grant.id, 'each grant is its own line item');
  const list = await slots.listGrants(user.id);
  assert.equal(list.length, 2);
});

await test('grant validation: bad email and bad slots reject before any write', async () => {
  const user = await db.createUser({ email: 'dave@example.com' });
  await assert.rejects(
    () => slots.grantSlots({ userId: user.id, email: 'nope', slots: 30 }),
    /invalid email/
  );
  await assert.rejects(
    () => slots.grantSlots({ userId: user.id, email: 'dave@example.com', slots: 7 }),
    /invalid slots/
  );
  const state = await slots.getSlotState(user.id);
  assert.equal(state.totalSlots, 0, 'no partial grant on validation failure');
  assert.equal((await slots.listGrants(user.id)).length, 0);
});

await test('userId guard: path builders reject traversal-shaped ids', async () => {
  assert.throws(() => slots.slotStatePath('../etc/passwd'), /invalid userId/);
  assert.throws(() => slots.grantRecordPath('../../x', 'id'), /invalid userId/);
  await assert.rejects(() => slots.listGrants('../../x'), /invalid userId/);
});

// --- register flow ---
await test('register flow: 30-slot grant registers 30, registration is trial:true', async () => {
  const user = await db.createUser({ email: 'erin@example.com' });
  await slots.grantSlots({ userId: user.id, email: 'erin@example.com', slots: 30 });
  const { registration, state } = await slots.registerVideos({ userId: user.id, count: 30 });

  assert.equal(state.registered, 30);
  assert.equal(state.totalSlots, 30);
  assert.equal(state.granted, 1);
  assert.equal(registration.count, 30);
  assert.equal(registration.trial, true, 'registrations are trial-marked until Stripe lands');
  const audit = join(TMP, 'slots', 'registrations', user.id, `${registration.id}.json`);
  assert.ok(existsSync(audit), 'audit registration file should exist');
});

await test('register flow: two batches accumulate in registered', async () => {
  const user = await db.createUser({ email: 'frank@example.com' });
  await slots.grantSlots({ userId: user.id, email: 'frank@example.com', slots: 50 });
  await slots.registerVideos({ userId: user.id, count: 10 });
  const { state } = await slots.registerVideos({ userId: user.id, count: 30 });
  assert.equal(state.registered, 40, '10 + 30 registered');
  assert.equal(state.totalSlots, 50);
});

await test('quota wall: over-quota registration is rejected and state is untouched', async () => {
  const user = await db.createUser({ email: 'grace@example.com' });
  await slots.grantSlots({ userId: user.id, email: 'grace@example.com', slots: 30 });
  await slots.registerVideos({ userId: user.id, count: 10 });
  await assert.rejects(
    () => slots.registerVideos({ userId: user.id, count: 30 }),
    (e) => {
      assert.ok(e instanceof slots.SlotQuotaError, 'expected SlotQuotaError');
      assert.equal(e.state.registered, 10, 'state on the error is unchanged');
      assert.equal(e.state.remaining, 20, 'remaining reported as 20');
      return true;
    }
  );
  const state = await slots.getSlotState(user.id);
  assert.equal(state.registered, 10, 'failed registration wrote nothing');
  assert.equal((await slots.listRegistrations(user.id)).length, 1, 'only the first registration recorded');
});

await test('register validation: invalid count rejects before any write', async () => {
  const user = await db.createUser({ email: 'hank@example.com' });
  await slots.grantSlots({ userId: user.id, email: 'hank@example.com', slots: 30 });
  await assert.rejects(() => slots.registerVideos({ userId: user.id, count: 5 }), /invalid count/);
  await assert.rejects(() => slots.registerVideos({ userId: user.id, count: 100 }), /invalid count/);
  await assert.rejects(() => slots.registerVideos({ userId: user.id, count: null }), /invalid count/);
  const state = await slots.getSlotState(user.id);
  assert.equal(state.registered, 0);
});

await test('register only enforces quota server-side (a client count is never trusted)', async () => {
  // A hostile caller could send any count — validation is on the server.
  const user = await db.createUser({ email: 'iris@example.com' });
  await assert.rejects(() => slots.registerVideos({ userId: user.id, count: 999 }), /invalid count/);
  const user2 = await db.createUser({ email: 'iris2@example.com' });
  await slots.grantSlots({ userId: user2.id, email: 'iris2@example.com', slots: 10 });
  await assert.rejects(() => slots.registerVideos({ userId: user2.id, count: 50 }), slots.SlotQuotaError);
});

// --- listing + sync payload ---
await test('listGrants / listRegistrations return newest-first per user', async () => {
  const user = await db.createUser({ email: 'jane@example.com' });
  await slots.grantSlots({ userId: user.id, email: 'jane@example.com', slots: 10 });
  await new Promise((r) => setTimeout(r, 5)); // distinct createdAt ordering
  await slots.grantSlots({ userId: user.id, email: 'jane@example.com', slots: 30 });
  await slots.registerVideos({ userId: user.id, count: 10 });
  await new Promise((r) => setTimeout(r, 5));
  await slots.registerVideos({ userId: user.id, count: 10 });

  const grants = await slots.listGrants(user.id);
  assert.equal(grants.length, 2);
  assert.equal(grants[0].slots, 30, 'newest grant first');
  const regs = await slots.listRegistrations(user.id);
  assert.equal(regs.length, 2);

  // other users are isolated
  const other = await db.createUser({ email: 'jane-other@example.com' });
  assert.equal((await slots.listGrants(other.id)).length, 0);
});

await test('syncPayload returns the PT-panel contract', async () => {
  const user = await db.createUser({ email: 'kai@example.com' });
  await slots.grantSlots({ userId: user.id, email: 'kai@example.com', slots: 30 });
  await slots.registerVideos({ userId: user.id, count: 10 });
  const payload = await slots.syncPayload(user);
  assert.deepEqual(
    {
      email: payload.email,
      totalSlots: payload.totalSlots,
      granted: payload.granted,
      registered: payload.registered,
      remaining: payload.remaining,
      grantsLen: payload.grants.length,
    },
    { email: 'kai@example.com', totalSlots: 30, granted: 1, registered: 10, remaining: 20, grantsLen: 1 },
    'sync payload shape'
  );
  assert.equal(payload.grants[0].paid, false, 'grants carry paid:false until Stripe');
});

await test('state defaults to zeros for a user with no grants', async () => {
  const user = await db.createUser({ email: 'zero@example.com' });
  const state = await slots.getSlotState(user.id);
  assert.deepEqual(
    { totalSlots: state.totalSlots, granted: state.granted, registered: state.registered },
    { totalSlots: 0, granted: 0, registered: 0 }
  );
  const payload = await slots.syncPayload(user);
  assert.equal(payload.remaining, 0);
  assert.deepEqual(payload.grants, []);
});

// Cleanup
rmSync(TMP, { recursive: true, force: true });

console.log(failed === 0 ? '\nALL GREEN' : `\n${failed} FAILED`);
process.exit(failed === 0 ? 0 : 1);