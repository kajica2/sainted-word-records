// tests/worker-lease.test.mjs — node test for software-factory/worker-lease.mjs
//
// The swarm policy allows at most 2 active agents globally. This module is
// what enforces it, so these tests are about the cap, idempotency and crash
// recovery — the three ways a lease system leaks a slot.
//
// Zero dependencies. Run:
//   npm run test:worker-lease
// or:
//   node tests/worker-lease.test.mjs

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const { WorkerLeaseManager, createLeaseManager, DEFAULT_MAX_WORKERS, DEFAULT_LEASE_TTL_MS } = await import(
  path.join(ROOT, 'software-factory', 'worker-lease.mjs')
);

let passed = 0;
let failed = 0;
const failures = [];

function assert(cond, msg) {
  if (cond) {
    passed++;
    console.log(`  ok  ${msg}`);
  } else {
    failed++;
    failures.push(msg);
    console.log(`  FAIL ${msg}`);
  }
}

function section(title) {
  console.log('');
  console.log(`── ${title} ──`);
}

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'swr-lease-test-'));
let tmpSeq = 0;
function tmpDir() {
  const d = path.join(tmpRoot, `case-${++tmpSeq}`);
  fs.mkdirSync(d, { recursive: true });
  return d;
}

// ---------------------------------------------------------------------------
// 1. claiming
// ---------------------------------------------------------------------------
section('claiming');
{
  const dir = tmpDir();
  const m = createLeaseManager({ dir, maxWorkers: 2 });
  const a = m.claim({ workerId: 'w1', mission: 'visual' });
  assert(a.ok === true, 'the first claim succeeds');
  assert(a.active === 1, 'the first claim makes one worker active');
  assert(a.lease.mission === 'visual', 'the lease records the mission');

  const b = m.claim({ workerId: 'w2', mission: 'api' });
  assert(b.ok === true && b.active === 2, 'the second claim succeeds and makes two workers active');

  const c = m.claim({ workerId: 'w3', mission: 'security' });
  assert(c.ok === false, 'the third claim is refused');
  assert(c.reason === 'cap', 'the refusal reason is "cap"');
  assert(c.active === 2, 'the refusal reports two active workers');
  assert(c.maxWorkers === 2, 'the refusal reports the cap');
  assert(m.status().active === 2, 'the manager still sees exactly two active workers');
}

{
  const dir = tmpDir();
  const m = createLeaseManager({ dir, maxWorkers: DEFAULT_MAX_WORKERS });
  const a = m.claim({ workerId: 'default-cap-1' });
  assert(a.ok === true && a.active === 1, 'the default cap admits the first worker');
  const b = m.claim({ workerId: 'default-cap-2' });
  assert(b.ok === true && b.active === 2, 'the default cap admits the second worker');
  const c = m.claim({ workerId: 'default-cap-3' });
  assert(c.ok === false && c.reason === 'cap', 'the default cap refuses the third worker');
}

// ---------------------------------------------------------------------------
// 2. idempotency — the same worker never consumes two slots
// ---------------------------------------------------------------------------
section('idempotency');
{
  const dir = tmpDir();
  const m = createLeaseManager({ dir, maxWorkers: 2 });
  m.claim({ workerId: 'w1' });
  m.claim({ workerId: 'w2' });
  const again = m.claim({ workerId: 'w1' });
  assert(again.ok === true, 're-claiming an existing worker succeeds');
  assert(again.idempotent === true, 're-claiming an existing worker is idempotent');
  assert(again.active === 2, 're-claiming does not add a third active worker');
  assert(m.status().active === 2, 'the manager still sees two active workers');
  const w3 = m.claim({ workerId: 'w3' });
  assert(w3.ok === false && w3.reason === 'cap', 'a re-claim did not free a slot for someone else');
}

// ---------------------------------------------------------------------------
// 3. release frees the slot
// ---------------------------------------------------------------------------
section('release');
{
  const dir = tmpDir();
  const m = createLeaseManager({ dir, maxWorkers: 2 });
  m.claim({ workerId: 'w1' });
  m.claim({ workerId: 'w2' });
  const rel = m.release({ workerId: 'w1', reason: 'finished' });
  assert(rel.ok === true && rel.released === true, 'a release succeeds');
  assert(rel.active === 1, 'one worker is active after the release');
  const w3 = m.claim({ workerId: 'w3' });
  assert(w3.ok === true, 'the released slot is available to a new worker');
  const relAgain = m.release({ workerId: 'w1' });
  assert(relAgain.ok === true && relAgain.released === false, 'releasing an unknown worker is a no-op');
  assert(relAgain.reason === 'unknown-worker', 'the no-op release says why');
}

// ---------------------------------------------------------------------------
// 4. expiry — a dead worker's lease is recovered, not leaked
// ---------------------------------------------------------------------------
section('expiry and crash recovery');
{
  const dir = tmpDir();
  let clock = 1_000_000;
  const m = createLeaseManager({ dir, maxWorkers: 2, now: () => clock, ttlMs: 1000 });
  m.claim({ workerId: 'alive', ttlMs: 100000 });
  // A lease file left behind by a worker that crashed — no process owns it.
  fs.writeFileSync(
    path.join(dir, 'crashed.lease.json'),
    JSON.stringify({ workerId: 'crashed', mission: 'visual', pid: 999999, claimedAt: new Date(clock).toISOString(), expiresAt: clock + 1000 }),
  );
  assert(m.status().active === 2, 'a crashed worker’s lease counts until it expires');
  const blocked = m.claim({ workerId: 'third' });
  assert(blocked.ok === false && blocked.reason === 'cap', 'the crashed worker holds the cap until it expires');

  clock += 1500; // the crashed lease is now expired
  const after = m.claim({ workerId: 'third' });
  assert(after.ok === true, 'an expired lease frees its slot');
  assert(after.pruned === 1, 'the expired lease was pruned');
  assert(!fs.existsSync(path.join(dir, 'crashed.lease.json')), 'the expired lease file is removed from disk');
}

{
  const dir = tmpDir();
  let clock = 2_000_000;
  const m = createLeaseManager({ dir, maxWorkers: 1, now: () => clock, ttlMs: 500 });
  m.claim({ workerId: 'a' });
  clock += 100;
  const renewed = m.renew({ workerId: 'a', ttlMs: 500 });
  assert(renewed.ok === true, 'a lease can be renewed');
  clock += 200; // past the ORIGINAL expiry, but inside the renewed one
  const b = m.claim({ workerId: 'b' });
  assert(b.ok === false, 'a renewed lease does not expire early');
  const unknown = m.renew({ workerId: 'nobody' });
  assert(unknown.ok === false && unknown.reason === 'unknown-worker', 'renewing an unknown worker fails');
}

// ---------------------------------------------------------------------------
// 5. dry run writes nothing
// ---------------------------------------------------------------------------
section('dry run');
{
  const dir = tmpDir();
  const m = createLeaseManager({ dir, maxWorkers: 2 });
  const d = m.claim({ workerId: 'w1', dryRun: true });
  assert(d.ok === true && d.dryRun === true, 'a dry-run claim reports what it would do');
  assert(d.wouldClaim && d.wouldClaim.workerId === 'w1', 'the dry run reports the lease it would write');
  assert(m.status().active === 0, 'a dry run leaves no active worker');
  assert(fs.readdirSync(dir).filter((f) => f.endsWith('.lease.json')).length === 0, 'a dry run writes no lease file');
}

// ---------------------------------------------------------------------------
// 6. stale lock breaking
// ---------------------------------------------------------------------------
section('stale lock');
{
  const dir = tmpDir();
  const m = createLeaseManager({ dir, maxWorkers: 2, staleLockMs: 50 });
  fs.writeFileSync(m.lockPath, '9999 stale\n');
  const old = new Date(Date.now() - 5000);
  fs.utimesSync(m.lockPath, old, old);
  const r = m.claim({ workerId: 'w1' });
  assert(r.ok === true, 'a stale lock is broken so the lease manager keeps working');
  assert(!fs.existsSync(m.lockPath), 'the lock is released after the operation');
}

// ---------------------------------------------------------------------------
// 7. status shape
// ---------------------------------------------------------------------------
section('status');
{
  const dir = tmpDir();
  const m = createLeaseManager({ dir, maxWorkers: 2, ttlMs: 60000 });
  m.claim({ workerId: 'w1', mission: 'visual' });
  const st = m.status();
  assert(st.active === 1, 'status counts the active lease');
  assert(st.maxWorkers === 2, 'status reports the cap');
  assert(st.leases.length === 1, 'status lists the lease');
  assert(st.leases[0].workerId === 'w1', 'the lease names its worker');
  assert(st.leases[0].mission === 'visual', 'the lease carries its mission');
  assert(typeof st.leases[0].expiresAt === 'number', 'the lease carries an expiry');
}

// ---------------------------------------------------------------------------
// 8. worker ids are sanitised into file names
// ---------------------------------------------------------------------------
section('file naming');
{
  const dir = tmpDir();
  const m = createLeaseManager({ dir, maxWorkers: 2 });
  const r = m.claim({ workerId: 'ops/worker #1' });
  assert(r.ok === true, 'a worker id with separators still claims');
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.lease.json'));
  assert(files.length === 1, 'the sanitised id produced exactly one lease file');
  assert(!files[0].includes('/'), 'the lease file name has no path separator');
  assert(m.status().leases[0].workerId === 'ops/worker #1', 'the original worker id is preserved inside the lease');
}

// ---------------------------------------------------------------------------
// 9. default TTL
// ---------------------------------------------------------------------------
section('defaults');
{
  const dir = tmpDir();
  const m = createLeaseManager({ dir, maxWorkers: 2 });
  const r = m.claim({ workerId: 'w1' });
  assert(r.lease.ttlMs === DEFAULT_LEASE_TTL_MS, 'the default lease TTL is 15 minutes');
}

// ---------------------------------------------------------------------------
section('a corrupt lease file does not brick the pool');
{
  const dir = tmpDir();
  // A crash between the create and the write leaves a truncated file. It
  // says nothing about who holds a slot — and a pool that throws on it
  // stops every agent until an operator deletes it by hand.
  const broken = path.join(dir, 'broken.lease.json');
  fs.writeFileSync(broken, '{"workerId": "broken", "expiresA');
  // Debris is old. A file that is merely YOUNG is a writer's work in
  // progress, and deleting it would delete a LIVE lease.
  const old = new Date(Date.now() - 5 * 60 * 1000);
  fs.utimesSync(broken, old, old);
  const m = createLeaseManager({ dir, maxWorkers: 2 });

  const status = m.status();
  assert(status.active === 0, 'a corrupt lease file does not count as an active worker');
  assert(status.corruptPruned === 1, 'the corrupt lease file is pruned');
  assert(!fs.existsSync(broken), 'the corrupt file is gone');

  const claim = m.claim({ workerId: 'after-corrupt' });
  assert(claim.ok === true, 'the pool still hands out a slot after a corrupt file');
  assert(claim.active === 1, 'the pool counts the new worker');
}

// ---------------------------------------------------------------------------
section('a young unreadable lease file is NOT pruned');
{
  const dir = tmpDir();
  // A live lease caught mid-write looks exactly like a truncated file.
  // Deleting it would hand the pool's slot to somebody else while the
  // agent is still running — the cap would be broken by a reader.
  const fresh = path.join(dir, 'fresh.lease.json');
  fs.writeFileSync(fresh, '{"workerId": "fresh", "expiresA');
  const m = createLeaseManager({ dir, maxWorkers: 2 });

  const status = m.status();
  assert(status.active === 0, 'the unreadable file does not count as an active worker');
  assert(status.corruptPruned === 0, 'a young unreadable file is not counted as debris');
  assert(fs.existsSync(fresh), 'a young unreadable file is left alone');
}

// ---------------------------------------------------------------------------
section('the lock is owned, and a stale one is broken safely');
{
  const dir = tmpDir();
  const m = createLeaseManager({ dir, maxWorkers: 2, staleLockMs: 10, lockWaitMs: 2000 });
  // A lock left behind by a crashed holder is stale after staleLockMs and
  // must be breakable — otherwise one crash blocks the pool forever.
  const lock = path.join(dir, 'leases.lock');
  fs.writeFileSync(lock, 'crashed-holder\n');
  await new Promise((r) => setTimeout(r, 30));
  const claim = m.claim({ workerId: 'after-crash' });
  assert(claim.ok === true, 'a stale lock is broken and the claim proceeds');
}
{
  const dir = tmpDir();
  const m = createLeaseManager({ dir, maxWorkers: 2 });
  const lock = path.join(dir, 'leases.lock');
  // The holder must delete only its OWN lock. If the lock was taken over
  // while it was inside the critical section, the release must leave the
  // new owner's lock alone.
  m._withLock(() => {
    fs.writeFileSync(lock, 'somebody-else\n');
  });
  assert(fs.existsSync(lock), 'a holder does not delete a lock it no longer owns');
}
{
  const dir = tmpDir();
  const m = createLeaseManager({ dir, maxWorkers: 2 });
  const a = m.claim({ workerId: 'ops/one' });
  const b = m.claim({ workerId: 'ops_one' });
  assert(a.ok === true, 'the first claim succeeds');
  assert(b.ok === false && b.reason === 'race', 'a colliding worker id is refused, not allowed to steal the lease');
  assert(m.status().active === 1, 'the pool counts one worker, not two');
}

// ---------------------------------------------------------------------------
section('a reader must not refresh a crashed holder’s lock');
{
  const dir = tmpDir();
  const m = createLeaseManager({ dir, maxWorkers: 2, staleLockMs: 10, lockWaitMs: 2000 });
  const lock = path.join(dir, 'leases.lock');
  // A lock left behind by a holder that CRASHED.
  fs.writeFileSync(lock, 'crashed-holder\n');
  await new Promise((r) => setTimeout(r, 30));

  // A READER looks at the pool. It holds no lock, so it must not make the
  // dead lock look alive: only the HOLDER may refresh a lock.
  //
  // If a reader refreshes it, the lock never ages past `staleLockMs`, the
  // crash-recovery path never fires, and a pool with a monitor attached
  // wedges: `claim()` waits the full `lockWaitMs` and throws
  // "could not acquire the lease lock", forever.
  m.status();
  const ageAfterRead = Date.now() - fs.statSync(lock).mtimeMs;
  assert(ageAfterRead > 10, 'a reader does not refresh a crashed holder’s lock');

  // And so the crash is still recoverable.
  const claim = m.claim({ workerId: 'after-crash' });
  assert(claim.ok === true, 'the crashed holder’s lock is still broken after a reader looked');
}
{
  const dir = tmpDir();
  const m = createLeaseManager({ dir, maxWorkers: 2, staleLockMs: 60_000 });
  const lock = path.join(dir, 'leases.lock');
  // The HOLDER refreshes its own lock — the other half of the rule. If
  // `_touchLock` were simply deleted, a reader and a holder would be
  // indistinguishable and this would regress.
  m._withLock(() => {
    const touched = Date.now() - fs.statSync(lock).mtimeMs;
    assert(touched < 1000, 'the holder refreshes its own lock');
  });
}

// ---------------------------------------------------------------------------
section('a leaked temp file is pruned');
{
  const dir = tmpDir();
  const tmp = path.join(dir, 'x.lease.json.tmp-1-abc');
  fs.writeFileSync(tmp, 'x');
  const old = new Date(Date.now() - 5 * 60 * 1000);
  fs.utimesSync(tmp, old, old);
  const m = createLeaseManager({ dir, maxWorkers: 2 });
  m.status();
  assert(!fs.existsSync(tmp), 'a temp file left by a crashed write is pruned');
}

// ---------------------------------------------------------------------------
section('the pruner never mistakes a live lease for litter');
{
  const dir = tmpDir();
  // A worker id may legally contain ".tmp-" or ".stale-". The pruner
  // matches a PATTERN, so it must not delete this live lease — deleting
  // it would hand the slot to somebody else while the agent is running.
  const m = createLeaseManager({ dir, maxWorkers: 2 });
  const claim = m.claim({ workerId: 'SWR-Ops.tmp-x-1234' });
  assert(claim.ok === true, 'the claim succeeds');
  const file = path.join(dir, 'SWR-Ops.tmp-x-1234.lease.json');
  assert(fs.existsSync(file), 'the lease file is there');
  const old = new Date(Date.now() - 5 * 60 * 1000);
  fs.utimesSync(file, old, old);
  const status = m.status();
  assert(status.active === 1, 'the pool still counts the worker');
  assert(fs.existsSync(file), 'the live lease file was NOT deleted as litter');
}

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------
console.log('');
console.log(`${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.log('failures:');
  failures.forEach((m) => console.log('  - ' + m));
  process.exit(1);
}
try {
  fs.rmSync(tmpRoot, { recursive: true, force: true });
} catch {
  /* best effort */
}
process.exit(0);
