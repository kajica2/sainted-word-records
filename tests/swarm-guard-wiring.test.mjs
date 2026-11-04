// tests/swarm-guard-wiring.test.mjs — node test for the guard wiring in
// software-factory/swr-agent.mjs
//
// The guard is only real if the bridge actually uses it. This test drives
// the real CLI as a child process and checks the observable consequences:
//
//   * a turn whose chain cannot be priced never reaches a provider
//   * a turn whose providers all skip is reserved and then RELEASED
//   * a run that fails releases its worker slot
//   * the read-only commands (`formats`) and the dry-run preview create
//     no state at all
//
// ZERO DEPENDENCIES. NO PROVIDER IS CONTACTED: every provider key is
// blanked in the child environment, so the chain is skipped for missing
// auth and the money never moves. That is the point — the wiring is
// exercised without spending a cent.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const AGENT = join(ROOT, 'software-factory', 'swr-agent.mjs');
const LEASE_CLI = join(ROOT, 'software-factory', 'worker-lease.mjs');

let passed = 0;
let failed = 0;
const failures = [];

function assert(cond, msg) {
  if (cond) { passed++; console.log(`  ok  ${msg}`); }
  else { failed++; failures.push(msg); console.log(`  FAIL ${msg}`); }
}

const scratch = mkdtempSync(join(tmpdir(), 'swr-wiring-'));
const BUDGET_DIR = join(scratch, 'budget');
const LEASE_DIR = join(scratch, 'leases');

/**
 * Run the bridge with the provider keys blanked.
 *
 * `providerAuth()` treats an empty string as "no key", so every HTTP
 * provider is skipped and no request is made. The CLI providers are not
 * in these chains, so nothing local is executed either.
 */
function runCli(args, { budgetDir = BUDGET_DIR, leaseDir = LEASE_DIR } = {}) {
  const env = {
    ...process.env,
    MINIMAX_API_KEY: '',
    OPENCODE_API_KEY: '',
    XAI_API_KEY: '',
    GEMINI_API_KEY: '',
    SWR_BUDGET_DIR: budgetDir,
    SWR_LEASE_DIR: leaseDir,
  };
  return spawnSync(process.execPath, [AGENT, ...args], {
    cwd: ROOT,
    env,
    encoding: 'utf8',
    timeout: 60000,
  });
}

function ledgerFilesIn(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((f) => f.startsWith('ledger-') && f.endsWith('.jsonl'));
}

function ledgerRecordsIn(dir) {
  const records = [];
  for (const file of ledgerFilesIn(dir)) {
    const body = readFileSync(join(dir, file), 'utf8');
    for (const line of body.split('\n')) {
      if (!line.trim()) continue;
      try { records.push(JSON.parse(line)); } catch { /* a torn line is its own finding */ }
    }
  }
  return records;
}

function leaseFilesIn(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((f) => f.endsWith('.lease.json'));
}

// ---------------------------------------------------------------------------
console.log('\n1. the read-only commands touch no state');
// ---------------------------------------------------------------------------
{
  const res = runCli(['formats']);
  assert(res.status === 0, 'the formats command still succeeds');
  let parsed = null;
  try { parsed = JSON.parse(res.stdout); } catch { /* handled below */ }
  assert(parsed && typeof parsed === 'object', 'the formats command still prints JSON');
  assert(!existsSync(BUDGET_DIR), 'the formats command creates no budget state');
  assert(!existsSync(LEASE_DIR), 'the formats command creates no lease state');
}

// ---------------------------------------------------------------------------
console.log('\n2. the dry-run preview touches no state');
// ---------------------------------------------------------------------------
{
  const res = runCli(['run', '--agent', 'SWR-Check', '--task', 'verification', '--prompt', 'hello', '--dry-run']);
  assert(res.status === 0, 'the dry run still succeeds');
  let parsed = null;
  try { parsed = JSON.parse(res.stdout); } catch { /* handled below */ }
  assert(parsed && parsed.dryRun === true, 'the dry run still reports dryRun:true');
  assert(Array.isArray(parsed?.chain) && parsed.chain.length > 0, 'the dry run still previews the chain');
  assert(!existsSync(BUDGET_DIR), 'the dry run creates no budget state');
  assert(!existsSync(LEASE_DIR), 'the dry run creates no lease state');
}

// ---------------------------------------------------------------------------
console.log('\n3. a live run reserves before it calls and releases what it did not spend');
// ---------------------------------------------------------------------------
{
  const res = runCli(['run', '--agent', 'SWR-Check', '--task', 'verification', '--prompt', 'hello there']);
  assert(res.status === 1, 'the run fails when no provider can answer');
  assert(/every model in the chain failed/.test(res.stderr || ''), 'the failure names the chain, not the budget');
  assert(!/turn refused before it was sent/.test(res.stderr || ''), 'the run was not refused by the budget');

  const records = ledgerRecordsIn(BUDGET_DIR);
  assert(records.length >= 2, 'the run left a reservation and a release in the ledger');
  const reserve = records.find((r) => r.type === 'reserve');
  const release = records.find((r) => r.type === 'release');
  assert(Boolean(reserve), 'a reservation was written');
  assert(Boolean(release), 'the reservation was released — a failed chain is not a bill');
  assert(release && release.reservationId === reserve?.reservationId, 'the release names the reservation it frees');
  assert(records.every((r) => r.type !== 'settle'), 'nothing was settled — there was no completion');

  assert(leaseFilesIn(LEASE_DIR).length === 0, 'the worker slot was released when the run ended');
}

// ---------------------------------------------------------------------------
console.log('\n4. the worker pool refuses a third agent');
// ---------------------------------------------------------------------------
{
  const leaseDir = join(scratch, 'leases-full');
  const budgetDir = join(scratch, 'budget-full');
  for (const id of ['SWR-Ops-a', 'SWR-Twin-b']) {
    const claim = spawnSync(
      process.execPath,
      [LEASE_CLI, 'claim', '--worker-id', id, '--state-dir', leaseDir, '--max-workers', '2'],
      { encoding: 'utf8', timeout: 30000 },
    );
    assert(claim.status === 0, `the lease for ${id} is taken`);
  }
  assert(leaseFilesIn(leaseDir).length === 2, 'two leases are held');

  const busy = runCli(['run', '--agent', 'SWR-Check', '--task', 'verification', '--prompt', 'hello'], { budgetDir, leaseDir });
  assert(busy.status === 1, 'the third agent is refused');
  assert(/worker pool is full/.test(busy.stderr || ''), 'the refusal names the worker pool');
  assert(/Nothing was sent/.test(busy.stderr || ''), 'the refusal says nothing was sent');
  assert(ledgerFilesIn(budgetDir).length === 0, 'the refused agent reserved no money');
  assert(leaseFilesIn(leaseDir).length === 2, 'the refusal did not disturb the two live leases');
}

// ---------------------------------------------------------------------------
console.log('\n5. a chain with an unpriced model is refused before any request');
// ---------------------------------------------------------------------------
{
  const res = runCli([
    'run',
    '--agent',
    'SWR-Check',
    '--task',
    'verification',
    '--model',
    'antigravity/gemini-3.6-flash',
    '--prompt',
    'hello there',
  ]);
  assert(res.status === 1, 'the run is refused');
  assert(/turn refused before it was sent/.test(res.stderr || ''), 'the refusal is the budget, not the provider');
  assert(/No request was made/.test(res.stderr || ''), 'the refusal says no request was made');
  assert(!/is not in the catalog/.test(res.stderr || ''), 'the model is in the catalog — the guard refused it');

  const records = ledgerRecordsIn(BUDGET_DIR);
  const refuses = records.filter((r) => r.type === 'refuse');
  assert(refuses.length >= 1, 'the refusal is recorded in the ledger');
  assert(refuses.some((r) => r.reason === 'unknown-pricing'), 'the ledger names the cause');
  assert(leaseFilesIn(LEASE_DIR).length === 0, 'the refused run released its worker slot');
}

// ---------------------------------------------------------------------------
console.log('\n6. the second unpriced model is refused the same way');
// ---------------------------------------------------------------------------
{
  const res = runCli([
    'run',
    '--agent',
    'SWR-Check',
    '--task',
    'verification',
    '--model',
    'antigravity/gemini-4-argon',
    '--prompt',
    'hello there',
  ]);
  assert(res.status === 1, 'the run is refused');
  assert(/turn refused before it was sent/.test(res.stderr || ''), 'the refusal comes from the guard');
  assert(!/is not in the catalog/.test(res.stderr || ''), 'the model is in the catalog');
}

rmSync(scratch, { recursive: true, force: true });

console.log('');
console.log(`${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.log('failures:');
  failures.forEach((m) => console.log('  - ' + m));
  process.exit(1);
}
process.exit(0);
