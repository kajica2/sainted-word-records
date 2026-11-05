// tests/swarm-guard.test.mjs — node test for software-factory/swarm-guard.mjs
//
// Zero dependencies. No browser, no provider, no API key, no network.
// The guard's job is to stop a paid call before it happens, so every
// assertion here is about a call NOT being made, or about the money
// being accounted for exactly.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  SwarmGuard,
  estimateTokens,
  resolveChainPlan,
} from '../software-factory/swarm-guard.mjs';
import { createLedger, estimateUsd, loadRoutingConfig, resolvePricing } from '../software-factory/budget-ledger.mjs';
import { createLeaseManager } from '../software-factory/worker-lease.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const ROUTING_CONFIG = join(ROOT, 'software-factory', 'routing.config.json');

let passed = 0;
let failed = 0;
const failures = [];

function assert(cond, msg) {
  if (cond) { passed++; console.log(`  ok  ${msg}`); }
  else { failed++; failures.push(msg); console.log(`  FAIL ${msg}`); }
}

function near(a, b, eps = 1e-9) {
  return Math.abs(Number(a) - Number(b)) <= eps;
}

const CONFIG = loadRoutingConfig(ROUTING_CONFIG);

// A guard with its own scratch state dirs, so a test can never touch the
// repo's real ledger or lease pool.
function makeGuard({ maxDailyUsd = 5, maxWorkers = 2, now = () => new Date(), leaseNow } = {}) {
  const base = mkdtempSync(join(tmpdir(), 'swarm-guard-'));
  const ledger = createLedger({ stateDir: join(base, 'budget'), maxDailyUsd, now });
  const leases = createLeaseManager({ dir: join(base, 'leases'), maxWorkers, now: leaseNow });
  const guard = new SwarmGuard({ config: CONFIG, ledger, leases, limits: { maxDailyUsd, maxConcurrentAgents: maxWorkers, source: 'test' } });
  guard.__base = base;
  return guard;
}

function cleanup(guard) {
  try { rmSync(guard.__base, { recursive: true, force: true }); } catch { /* best effort */ }
}

// ---------------------------------------------------------------------------
console.log('\n1. token estimation');
// ---------------------------------------------------------------------------
assert(estimateTokens('') === 0, 'empty text costs no tokens');
assert(estimateTokens('abcd') === 1, 'four characters are one token');
assert(estimateTokens('abcde') === 2, 'five characters round up to two tokens');
assert(estimateTokens('x'.repeat(400)) === 100, '400 characters are 100 tokens');
assert(estimateTokens(null) === 0, 'null is zero tokens');
assert(estimateTokens(undefined) === 0, 'undefined is zero tokens');

// ---------------------------------------------------------------------------
console.log('\n2. the chain plan picks the most expensive member');
// ---------------------------------------------------------------------------
{
  // claude-sonnet-5 is 2/10 per Mtok; M2.7 is 0.3/1.2. The expensive
  // member is the one a failover could land on, so it sets the ceiling.
  const chain = ['minimax/MiniMax-M2.7', 'opencode/claude-sonnet-5'];
  const plan = resolveChainPlan({ config: CONFIG, chain, maxTokens: 10000, inputTokens: 1000 });
  assert(plan.ok === true, 'a fully-priced chain plans cleanly');
  assert(plan.basis.modelRef === 'opencode/claude-sonnet-5', 'the ceiling is the most expensive chain member');
  assert(plan.ceilingUsd > 0, 'the ceiling costs money');
  const expected = estimateUsd(resolvePricing(CONFIG, 'opencode/claude-sonnet-5').rates, {
    input_tokens: 1000,
    output_tokens: 10000,
  }).usd;
  assert(near(plan.ceilingUsd, expected), 'the ceiling equals the basis member own price');
  assert(plan.members.length === 2, 'both members are described');
  assert(plan.members.every((m) => m.known === true), 'both members are known');
}

{
  const plan = resolveChainPlan({ config: CONFIG, chain: ['minimax/MiniMax-M2.7'], maxTokens: 1000, inputTokens: 0 });
  assert(near(plan.ceilingUsd, estimateUsd(resolvePricing(CONFIG, 'minimax/MiniMax-M2.7').rates, { input_tokens: 0, output_tokens: 1000 }).usd),
    'a single-member chain prices itself');
}

{
  const plan = resolveChainPlan({ config: CONFIG, chain: [], maxTokens: 1000 });
  assert(plan.ok === false, 'an empty chain is refused');
  assert(plan.reason === 'empty-chain', 'the empty chain says why');
}

// ---------------------------------------------------------------------------
console.log('\n3. unknown pricing fails the whole chain closed');
// ---------------------------------------------------------------------------
{
  // gemini-3.6-flash has null rates: a paid HTTP model whose cost is unknown.
  const plan = resolveChainPlan({
    config: CONFIG,
    chain: ['minimax/MiniMax-M2.7', 'antigravity/gemini-3.6-flash'],
    maxTokens: 1000,
    inputTokens: 100,
  });
  assert(plan.ok === false, 'a chain with an unpriced member is refused');
  assert(plan.reason === 'unknown-pricing', 'the refusal names the reason');
  assert(plan.failures.length === 1, 'the unpriced member is listed');
  assert(plan.failures[0].modelRef === 'antigravity/gemini-3.6-flash', 'the unpriced member is named');
  assert(plan.ceilingUsd === null, 'a refused chain has no ceiling');
}

{
  const guard = makeGuard();
  const res = guard.reserveTurn({
    reservationId: 'unknown-1',
    chain: ['minimax/MiniMax-M2.7', 'antigravity/gemini-4-argon'],
    maxTokens: 1000,
    inputTokens: 100,
  });
  assert(res.ok === false, 'reserveTurn refuses an unpriced chain');
  assert(res.reason === 'unknown-pricing', 'reserveTurn names the reason');
  const status = guard.ledger.status();
  assert(near(status.reservedUsd, 0), 'a refused chain reserves no money');
  assert(near(status.spentUsd, 0), 'a refused chain spends no money');
  cleanup(guard);
}

{
  const guard = makeGuard();
  const res = guard.reserveTurn({
    reservationId: 'unknown-model',
    chain: ['nobody/no-such-model'],
    maxTokens: 1000,
  });
  assert(res.ok === false, 'a chain naming an unknown model is refused');
  assert(res.reason === 'unknown-model', 'the refusal names the unknown model');
  cleanup(guard);
}

// ---------------------------------------------------------------------------
console.log('\n4. a local CLI provider is free and never blocks');
// ---------------------------------------------------------------------------
{
  const pricing = resolvePricing(CONFIG, 'antigravity-cli/anything');
  assert(pricing.known === true, 'a CLI provider is known');
  assert(pricing.free === true, 'a CLI provider is free');
  assert(pricing.reason === 'local-cli', 'the reason says local-cli');

  const plan = resolveChainPlan({ config: CONFIG, chain: ['antigravity-cli/anything'], maxTokens: 100000, inputTokens: 100000 });
  assert(plan.ok === true, 'a CLI-only chain plans cleanly');
  assert(plan.ceilingUsd !== null, 'a CLI-only chain has a ceiling');
  assert(near(plan.ceilingUsd, 0), 'a CLI-only chain costs nothing');

  const guard = makeGuard({ maxDailyUsd: 0.0001 });
  const res = guard.reserveTurn({ reservationId: 'cli-1', chain: ['antigravity-cli/anything'], maxTokens: 100000, inputTokens: 100000 });
  assert(res.ok === true, 'a free model is reserved even under a tiny cap');
  assert(near(res.reservation.usd, 0), 'the free reservation is zero dollars');
  cleanup(guard);
}

// ---------------------------------------------------------------------------
console.log('\n5. the daily cap refuses a reservation that would exceed it');
// ---------------------------------------------------------------------------
{
  const guard = makeGuard({ maxDailyUsd: 0.05 });
  // claude-sonnet-5 at 10k output tokens is about $0.10 — over the cap.
  const res = guard.reserveTurn({
    reservationId: 'cap-1',
    chain: ['opencode/claude-sonnet-5'],
    maxTokens: 10000,
    inputTokens: 1000,
  });
  assert(res.ok === false, 'a reservation over the cap is refused');
  assert(res.reason === 'cap', 'the refusal says cap');
  assert(res.requestedUsd > 0.05, 'the refusal reports what it wanted');
  const status = guard.ledger.status();
  assert(near(status.remainingUsd, 0.05), 'a refused reservation leaves the budget untouched');
  assert(near(status.spentUsd, 0), 'a refused reservation spends nothing');
  cleanup(guard);
}

{
  const guard = makeGuard({ maxDailyUsd: 5 });
  const first = guard.reserveTurn({ reservationId: 'cap-a', chain: ['minimax/MiniMax-M2.7'], maxTokens: 1000, inputTokens: 100 });
  assert(first.ok === true, 'a small reservation under the cap succeeds');
  const again = guard.reserveTurn({ reservationId: 'cap-a', chain: ['minimax/MiniMax-M2.7'], maxTokens: 1000, inputTokens: 100 });
  assert(again.ok === true && again.idempotent === true, 'the same reservation id is idempotent');
  const status = guard.ledger.status();
  assert(status.reservations.length === 1, 'the idempotent reserve did not add a second reservation');
  cleanup(guard);
}

// ---------------------------------------------------------------------------
console.log('\n6. settling releases the difference');
// ---------------------------------------------------------------------------
{
  const guard = makeGuard({ maxDailyUsd: 5 });
  const reserved = guard.reserveTurn({
    reservationId: 'settle-1',
    chain: ['minimax/MiniMax-M2.7'],
    maxTokens: 10000,
    inputTokens: 1000,
  });
  assert(reserved.ok === true, 'the reservation is taken');
  const reservedUsd = reserved.reservation.usd;
  assert(reservedUsd > 0, 'the reservation is worth money');

  const settled = guard.settleTurn({
    reservationId: 'settle-1',
    modelRef: 'minimax/MiniMax-M2.7',
    usage: { input_tokens: 1000, output_tokens: 100 },
  });
  assert(settled.ok === true, 'the turn settles');
  assert(settled.priced === true, 'the answering model was priced');
  const expected = estimateUsd(resolvePricing(CONFIG, 'minimax/MiniMax-M2.7').rates, { input_tokens: 1000, output_tokens: 100 }).usd;
  assert(near(settled.settledUsd, expected), 'the settled amount is the real cost');

  const status = guard.ledger.status();
  assert(near(status.spentUsd, expected), 'only the real cost is spent');
  assert(near(status.reservedUsd, 0), 'a settled reservation is no longer held');
  assert(near(status.remainingUsd, 5 - expected), 'the unused reservation is back in the budget');
  cleanup(guard);
}

{
  const guard = makeGuard({ maxDailyUsd: 5 });
  const reserved = guard.reserveTurn({ reservationId: 'settle-2', chain: ['minimax/MiniMax-M2.7'], maxTokens: 10000, inputTokens: 1000 });
  const settled = guard.settleTurn({ reservationId: 'settle-2', modelRef: 'minimax/MiniMax-M2.7', usage: { input_tokens: 1000, output_tokens: 100 } });
  const again = guard.settleTurn({ reservationId: 'settle-2', modelRef: 'minimax/MiniMax-M2.7', usage: { input_tokens: 1000, output_tokens: 100 } });
  assert(settled.ok === true, 'the first settle works');
  assert(again.ok === true && again.idempotent === true, 'settling twice is idempotent');
  const status = guard.ledger.status();
  assert(near(status.spentUsd, settled.settledUsd), 'a second settle does not spend again');
  cleanup(guard);
}

// ---------------------------------------------------------------------------
console.log('\n7. an unpriced answering model settles at the full reservation');
// ---------------------------------------------------------------------------
{
  const guard = makeGuard({ maxDailyUsd: 5 });
  const reserved = guard.reserveTurn({ reservationId: 'settle-3', chain: ['minimax/MiniMax-M2.7'], maxTokens: 10000, inputTokens: 1000 });
  const reservedUsd = reserved.reservation.usd;
  const settled = guard.settleTurn({ reservationId: 'settle-3', modelRef: 'antigravity/gemini-3.6-flash', usage: { input_tokens: 1, output_tokens: 1 } });
  assert(settled.ok === true, 'the turn still settles');
  assert(settled.priced === false, 'the answering model could not be priced');
  const status = guard.ledger.status();
  assert(near(status.spentUsd, reservedUsd), 'the pessimistic direction is taken: the full reservation is spent');
  cleanup(guard);
}

// ---------------------------------------------------------------------------
console.log('\n8. releasing a reservation spends nothing');
// ---------------------------------------------------------------------------
{
  const guard = makeGuard({ maxDailyUsd: 5 });
  guard.reserveTurn({ reservationId: 'release-1', chain: ['minimax/MiniMax-M2.7'], maxTokens: 10000, inputTokens: 1000 });
  const released = guard.releaseTurn({ reservationId: 'release-1', reason: 'every model failed' });
  assert(released.ok === true, 'the reservation is released');
  const status = guard.ledger.status();
  assert(near(status.spentUsd, 0), 'a released reservation spends nothing');
  assert(near(status.reservedUsd, 0), 'a released reservation is no longer held');
  assert(near(status.remainingUsd, 5), 'the whole budget is back');
  cleanup(guard);
}

// ---------------------------------------------------------------------------
console.log('\n9. the worker pool allows two agents and no more');
// ---------------------------------------------------------------------------
{
  const guard = makeGuard({ maxWorkers: 2 });
  const a = guard.claimWorker({ workerId: 'SWR-Ops-1' });
  assert(a.ok === true, 'the first worker claims a slot');
  const b = guard.claimWorker({ workerId: 'SWR-Twin-2' });
  assert(b.ok === true, 'the second worker claims a slot');
  const c = guard.claimWorker({ workerId: 'SWR-Check-3' });
  assert(c.ok === false, 'the third worker is refused');
  assert(c.reason === 'cap', 'the refusal says cap');
  assert(c.active === 2, 'the refusal reports the active count');
  assert(c.maxWorkers === 2, 'the refusal reports the limit');
  cleanup(guard);
}

{
  const guard = makeGuard({ maxWorkers: 2 });
  const a = guard.claimWorker({ workerId: 'SWR-Ops-1' });
  const again = guard.claimWorker({ workerId: 'SWR-Ops-1' });
  assert(again.ok === true, 'the same worker may re-claim');
  assert(again.idempotent === true, 'the re-claim is idempotent');
  const b = guard.claimWorker({ workerId: 'SWR-Twin-2' });
  assert(b.ok === true, 'a second worker still fits');
  const c = guard.claimWorker({ workerId: 'SWR-Check-3' });
  assert(c.ok === false && c.reason === 'cap', 'the slot count is not inflated by a re-claim');
  cleanup(guard);
}

{
  const guard = makeGuard({ maxWorkers: 2 });
  const released = guard.releaseWorker({ workerId: 'SWR-Ops-1', reason: 'done' });
  assert(released.ok === true, 'the worker releases its slot');
  const c = guard.claimWorker({ workerId: 'SWR-Check-3' });
  assert(c.ok === true, 'a released slot is reusable');
  cleanup(guard);
}

{
  const guard = makeGuard({ maxWorkers: 2 });
  guard.releaseWorker({ workerId: 'never-claimed' });
  assert(true, 'releasing an unknown worker is harmless');
  cleanup(guard);
}

// ---------------------------------------------------------------------------
console.log('\n10. a crashed worker is recovered by TTL');
// ---------------------------------------------------------------------------
{
  let clock = 1_000_000;
  const guard = makeGuard({ maxWorkers: 2, leaseNow: () => clock });
  guard.claimWorker({ workerId: 'crashed-1', ttlMs: 1000 });
  guard.claimWorker({ workerId: 'alive-2', ttlMs: 100000 });
  clock += 5000; // the crashed lease is now older than its TTL
  const third = guard.claimWorker({ workerId: 'SWR-Check-3' });
  assert(third.ok === true, 'the expired lease is reclaimed');
  assert(third.pruned >= 1, 'the expired lease was pruned');
  cleanup(guard);
}

// ---------------------------------------------------------------------------
console.log('\n11. renewal keeps a long run alive');
// ---------------------------------------------------------------------------
{
  let clock = 2_000_000;
  const guard = makeGuard({ maxWorkers: 2, leaseNow: () => clock });
  guard.claimWorker({ workerId: 'SWR-Ops-1', ttlMs: 1000 });
  clock += 800;
  const renewed = guard.renewWorker({ workerId: 'SWR-Ops-1', ttlMs: 1000 });
  assert(renewed.ok === true, 'the lease renews');
  clock += 800;
  const other = guard.claimWorker({ workerId: 'SWR-Twin-2' });
  assert(other.ok === true, 'the renewed lease still holds its slot');
  cleanup(guard);
}

// ---------------------------------------------------------------------------
console.log('\n12. the guard reports its own state');
// ---------------------------------------------------------------------------
{
  const guard = makeGuard({ maxDailyUsd: 2, maxWorkers: 2 });
  guard.claimWorker({ workerId: 'SWR-Ops-1' });
  const status = guard.status();
  assert(status.budget.capUsd === 2, 'the status reports the daily cap');
  assert(status.workers.active === 1, 'the status reports the active workers');
  assert(status.workers.maxWorkers === 2, 'the status reports the worker limit');
  assert(status.limits.maxDailyUsd === 2, 'the status reports the limits');
  cleanup(guard);
}

// ---------------------------------------------------------------------------
console.log('\n13. reservation ids do not collide inside one run');
// ---------------------------------------------------------------------------
{
  const guard = makeGuard({ maxDailyUsd: 5 });
  const a = guard.nextReservationId({ runId: 'run-1' });
  const b = guard.nextReservationId({ runId: 'run-1' });
  assert(a !== b, 'two turns of one run get different reservation ids');
  assert(a.startsWith('run-1-'), 'the reservation id carries the run');
  assert(a.endsWith('-t1') && b.endsWith('-t2'), 'the reservation id carries the turn number');
  cleanup(guard);
}

{
  // A pid is NOT unique: it is reused, it is 1 in most containers, and two
  // machines can share a state directory. A collision would make the second
  // run's reservation look idempotent — the call would go out with no money
  // reserved and its settlement would be dropped.
  const a = makeGuard({ maxDailyUsd: 5 });
  const b = makeGuard({ maxDailyUsd: 5 });
  const idA = a.nextReservationId({ runId: 'run-1' });
  const idB = b.nextReservationId({ runId: 'run-1' });
  assert(idA !== idB, 'two runs with the same run id do not collide');
  cleanup(a);
  cleanup(b);
}

// ---------------------------------------------------------------------------
console.log('\n14. the heartbeat keeps a long turn alive');
// ---------------------------------------------------------------------------
{
  const guard = makeGuard({ maxWorkers: 2 });
  guard.claimWorker({ workerId: 'hb-1' });
  const before = guard.leases.status().leases[0].expiresAt;
  const heartbeat = guard.startHeartbeat('hb-1', { intervalMs: 10 });
  await new Promise((r) => setTimeout(r, 60));
  heartbeat.stop();
  const after = guard.leases.status().leases[0].expiresAt;
  assert(after > before, 'the heartbeat renewed the lease while the turn was in flight');
  assert(heartbeat.lost === null, 'the heartbeat did not report a lost lease');
  cleanup(guard);
}

{
  // A lease that vanishes under a running agent is a lost slot: the pool
  // may now be running someone else in it, so the run has to stop.
  const guard = makeGuard({ maxWorkers: 2 });
  guard.claimWorker({ workerId: 'hb-2' });
  const heartbeat = guard.startHeartbeat('hb-2', { intervalMs: 10 });
  rmSync(join(guard.leases.dir, 'hb-2.lease.json'), { force: true });
  await new Promise((r) => setTimeout(r, 60));
  heartbeat.stop();
  assert(heartbeat.lost !== null, 'the heartbeat reports a lost lease');
  cleanup(guard);
}

{
  // A renewal that THROWS (the lock could not be acquired) must not take
  // the process down: an exception inside a timer callback is uncaught,
  // and the process would die before the settlement is written — the
  // reservation would burn the day's budget with no spend record. And it
  // must not latch: a lock timeout says nothing about whether the lease
  // is still there, so the heartbeat keeps trying.
  const guard = makeGuard({ maxWorkers: 2 });
  guard.claimWorker({ workerId: 'hb-3' });
  let attempts = 0;
  guard.renewWorker = () => {
    attempts++;
    throw new Error('worker-lease: could not acquire the lease lock');
  };
  const heartbeat = guard.startHeartbeat('hb-3', { intervalMs: 10 });
  await new Promise((r) => setTimeout(r, 60));
  heartbeat.stop();
  assert(typeof heartbeat.lastError === 'string', 'a throwing renewal is recorded, not thrown');
  assert(String(heartbeat.lastError).includes('could not acquire'), 'the recorded failure says what happened');
  assert(attempts > 1, 'the heartbeat keeps trying after a transient failure');
  assert(heartbeat.lost === null, 'a transient failure does not claim the lease is gone');
  cleanup(guard);
}

{
  // A renewal that works again clears the failure.
  const guard = makeGuard({ maxWorkers: 2 });
  guard.claimWorker({ workerId: 'hb-4' });
  let fail = true;
  const real = guard.renewWorker.bind(guard);
  guard.renewWorker = (id) => {
    if (fail) throw new Error('worker-lease: could not acquire the lease lock');
    return real(id);
  };
  const heartbeat = guard.startHeartbeat('hb-4', { intervalMs: 10 });
  await new Promise((r) => setTimeout(r, 40));
  fail = false;
  await new Promise((r) => setTimeout(r, 40));
  heartbeat.stop();
  assert(heartbeat.lastError === null, 'a successful renewal clears the recorded failure');
  cleanup(guard);
}

// ---------------------------------------------------------------------------
console.log('\n14b. an expired slot is re-claimed; a full pool is not');
// ---------------------------------------------------------------------------
{
  const guard = makeGuard({ maxWorkers: 2 });
  guard.claimWorker({ workerId: 're-1' });
  // The lease file vanishes (an operator cleaned it, or it was pruned).
  rmSync(join(guard.leases.dir, 're-1.lease.json'), { force: true });
  const slot = guard.ensureWorkerSlot('re-1');
  assert(slot.ok === true, 'an expired slot is re-claimed');
  assert(slot.reclaimed === true, 'the re-claim is reported as a re-claim');
  cleanup(guard);
}

{
  const guard = makeGuard({ maxWorkers: 2 });
  guard.claimWorker({ workerId: 're-2' });
  guard.claimWorker({ workerId: 'other' });
  // The slot's file vanishes, and somebody else takes the free slot before
  // this worker comes back for it.
  rmSync(join(guard.leases.dir, 're-2.lease.json'), { force: true });
  const taken = guard.claimWorker({ workerId: 'third' });
  assert(taken.ok === true, 'the freed slot is taken by another worker');
  const slot = guard.ensureWorkerSlot('re-2');
  assert(slot.ok === false, 'a slot is NOT re-claimed when the pool is full');
  assert(slot.reason === 'cap', 'the refusal says the pool is full');
  cleanup(guard);
}

// ---------------------------------------------------------------------------
console.log('\n15. an overage stops the NEXT reservation');
// ---------------------------------------------------------------------------
{
  const guard = makeGuard({ maxDailyUsd: 0.05 });
  guard.reserveTurn({ reservationId: 'ov-1', chain: ['minimax/MiniMax-M2.7'], maxTokens: 1000, inputTokens: 100 });
  // The provider bills far more than the reservation asked for.
  guard.settleTurn({
    reservationId: 'ov-1',
    modelRef: 'minimax/MiniMax-M2.7',
    usage: { input_tokens: 1_000_000, output_tokens: 1_000_000 },
  });
  const status = guard.ledger.status();
  assert(status.spentUsd > status.capUsd, 'a provider that bills more than reserved can exceed the day');
  assert(status.remainingUsd < 0, 'the remaining budget goes negative');
  const next = guard.reserveTurn({ reservationId: 'ov-2', chain: ['minimax/MiniMax-M2.7'], maxTokens: 1000, inputTokens: 100 });
  assert(next.ok === false && next.reason === 'cap', 'the next reservation is refused after an overage');
  cleanup(guard);
}

console.log('');
console.log(`${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.log('failures:');
  failures.forEach((m) => console.log('  - ' + m));
  process.exit(1);
}
process.exit(0);
