// tests/swarm-guard-wiring.test.mjs — node test for the guard wiring in
// software-factory/swr-agent.mjs
//
// The guard is only real if the bridge actually uses it. This test drives
// the real CLI as a child process against a LOCAL FAKE PROVIDER, so the
// order of events is observable rather than inferred:
//
//   * a turn is RESERVED before the request is built — the fake provider
//     reads the ledger at request time and finds the reservation
//   * a turn that cannot be priced never reaches a provider at all —
//     the fake records zero requests
//   * a run that fails releases its worker slot
//   * a run that loses its slot mid-flight STOPS instead of continuing
//   * the read-only commands (`formats`) and the dry-run preview create
//     no state at all
//
// ZERO DEPENDENCIES. NO REAL PROVIDER IS CONTACTED: the fake answers on
// 127.0.0.1, and every OTHER provider key is blanked so the chain can
// only reach the fake. The money never moves.
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const AGENT = join(ROOT, 'software-factory', 'swr-agent.mjs');
const LEASE_CLI = join(ROOT, 'software-factory', 'worker-lease.mjs');
const FAKE_PROVIDER = join(ROOT, 'tests', 'helpers', 'fake-provider.mjs');

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

// ---------------------------------------------------------------- ledger ---

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

// -------------------------------------------------------- fake provider ---

/**
 * Start the fake provider in its OWN process.
 *
 * The test drives the bridge with spawnSync, which blocks the parent's
 * event loop — a server in the parent could never answer the child's
 * request, and the run would hang until the provider's ten-minute
 * timeout. The helper appends one JSON line per request to a log file;
 * the test reads that file afterwards.
 */
function startFakeProvider({ ledgerDir, leaseDir, delayMs = 0, deleteLeases = false } = {}) {
  const logFile = join(scratch, `fake-provider-${Math.random().toString(36).slice(2)}.jsonl`);
  const child = spawn(process.execPath, [FAKE_PROVIDER], {
    cwd: ROOT,
    env: {
      ...process.env,
      LEDGER_DIR: ledgerDir || '',
      LEASE_DIR: leaseDir || '',
      LOG: logFile,
      DELAY_MS: String(delayMs || 0),
      DELETE_LEASES: deleteLeases ? '1' : '0',
    },
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  return new Promise((resolveReady, rejectReady) => {
    let buf = '';
    const timer = setTimeout(() => rejectReady(new Error('the fake provider never reported a port')), 15000);
    child.stdout.on('data', (chunk) => {
      buf += chunk;
      const nl = buf.indexOf('\n');
      if (nl === -1) return;
      clearTimeout(timer);
      const port = Number(buf.slice(0, nl).trim());
      resolveReady({
        url: `http://127.0.0.1:${port}`,
        requests: () => (existsSync(logFile) ? readFileSync(logFile, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []),
        close: () => {
          child.kill('SIGTERM');
        },
      });
    });
  });
}

// ------------------------------------------------------------------- cli ---

/**
 * Run the bridge with every OTHER provider key blanked.
 *
 * `providerAuth()` treats an empty string as "no key", so the chain can
 * only reach the provider this test points at the fake.
 */
function runCli(args, { budgetDir = BUDGET_DIR, leaseDir = LEASE_DIR, extraEnv = {}, input = null } = {}) {
  const env = {
    ...process.env,
    MINIMAX_API_KEY: '',
    OPENCODE_API_KEY: '',
    XAI_API_KEY: '',
    GEMINI_API_KEY: '',
    SWR_BUDGET_DIR: budgetDir,
    SWR_LEASE_DIR: leaseDir,
    ...extraEnv,
  };
  return spawnSync(process.execPath, [AGENT, ...args], {
    cwd: ROOT,
    env,
    encoding: 'utf8',
    input,
    timeout: 60000,
  });
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
console.log('\n3. a turn is RESERVED before the request is built');
// ---------------------------------------------------------------------------
{
  const provider = await startFakeProvider({ ledgerDir: BUDGET_DIR, leaseDir: LEASE_DIR });
  const res = runCli(['run', '--agent', 'SWR-Check', '--task', 'verification', '--prompt', 'hello there'], {
    extraEnv: { MINIMAX_BASE_URL: provider.url, MINIMAX_API_KEY: 'fake-key' },
  });
  provider.close();

  assert(res.status === 0, 'the run succeeds against the fake provider');
  const seen = provider.requests();
  assert(seen.length === 1, 'the fake provider received exactly one request');
  const atRequest = seen[0]?.ledgerAtRequest || [];
  assert(
    atRequest.some((r) => r.type === 'reserve'),
    'a reservation existed BEFORE the request went out',
  );
  assert(
    !atRequest.some((r) => r.type === 'settle'),
    'the turn had not been settled when the request went out',
  );

  const records = ledgerRecordsIn(BUDGET_DIR);
  const settle = records.find((r) => r.type === 'settle');
  assert(Boolean(settle), 'the turn was settled after the request');
  assert(settle && settle.usd > 0, 'the settlement is a real amount, not a zero');
  assert(
    settle && settle.usage && settle.usage.output_tokens === 567,
    'the settlement uses the provider-reported usage',
  );
  assert(leaseFilesIn(LEASE_DIR).length === 0, 'the worker slot was released when the run ended');
}

// ---------------------------------------------------------------------------
console.log('\n4. a turn that cannot be priced never reaches a provider');
// ---------------------------------------------------------------------------
{
  const provider = await startFakeProvider({ ledgerDir: BUDGET_DIR, leaseDir: LEASE_DIR });
  const res = runCli(
    ['run', '--agent', 'SWR-Check', '--task', 'verification', '--model', 'antigravity/gemini-3.6-flash', '--prompt', 'hello there'],
    { extraEnv: { MINIMAX_BASE_URL: provider.url, MINIMAX_API_KEY: 'fake-key' } },
  );
  provider.close();

  assert(res.status === 1, 'the run is refused');
  assert(/turn refused before it was sent/.test(res.stderr || ''), 'the refusal is the budget, not the provider');
  assert(/No request was made/.test(res.stderr || ''), 'the refusal says no request was made');
  assert(provider.requests().length === 0, 'the fake provider received NO request — the refusal is real, not a message');
  assert(!/is not in the catalog/.test(res.stderr || ''), 'the model is in the catalog — the guard refused it');

  const records = ledgerRecordsIn(BUDGET_DIR);
  const refuses = records.filter((r) => r.type === 'refuse');
  assert(refuses.length >= 1, 'the refusal is recorded in the ledger');
  assert(refuses.some((r) => r.reason === 'unknown-pricing'), 'the ledger names the cause');
  assert(leaseFilesIn(LEASE_DIR).length === 0, 'the refused run released its worker slot');
}

// ---------------------------------------------------------------------------
console.log('\n5. a run that loses its slot mid-flight STOPS');
// ---------------------------------------------------------------------------
{
  // The fake provider deletes the agent's lease while the request is in
  // flight. The next renewal cannot find the worker, so the run must stop
  // rather than continue outside the pool.
  const provider = await startFakeProvider({
    ledgerDir: BUDGET_DIR,
    leaseDir: LEASE_DIR,
    delayMs: 50,
    deleteLeases: true,
  });
  const res = runCli(['chat', '--agent', 'SWR-Check', '--task', 'verification', '--prompt', 'hello there'], {
    extraEnv: { MINIMAX_BASE_URL: provider.url, MINIMAX_API_KEY: 'fake-key' },
    input: 'another line\n/exit\n',
  });
  provider.close();

  assert(res.status === 1, 'the chat stops when the slot is lost');
  assert(/worker slot was lost/.test(res.stderr || ''), 'the message says the slot was lost');
  assert(/stopped rather than continue without a slot/.test(res.stderr || ''), 'the message says why it stopped');
  assert(leaseFilesIn(LEASE_DIR).length === 0, 'no slot was left behind');
}

// ---------------------------------------------------------------------------
console.log('\n6. a failed chain reserves, then releases — nothing is billed');
// ---------------------------------------------------------------------------
{
  // Its own state dirs: this run's records must be read on their own, not
  // mixed with the settled turn of the run above.
  const budgetDir = join(scratch, 'budget-failed');
  const leaseDir = join(scratch, 'leases-failed');
  const res = runCli(['run', '--agent', 'SWR-Check', '--task', 'verification', '--prompt', 'hello there'], { budgetDir, leaseDir });
  assert(res.status === 1, 'the run fails when no provider can answer');
  assert(/every model in the chain failed/.test(res.stderr || ''), 'the failure names the chain, not the budget');
  assert(!/turn refused before it was sent/.test(res.stderr || ''), 'the run was not refused by the budget');

  const records = ledgerRecordsIn(budgetDir);
  const reserve = records.find((r) => r.type === 'reserve');
  const release = records.find((r) => r.type === 'release');
  assert(Boolean(reserve), 'a reservation was written');
  assert(Boolean(release), 'the reservation was released — a failed chain is not a bill');
  assert(release && release.reservationId === reserve?.reservationId, 'the release names the reservation it frees');
  assert(records.every((r) => r.type !== 'settle'), 'nothing was settled — there was no completion');
  assert(leaseFilesIn(leaseDir).length === 0, 'the worker slot was released when the run ended');
}

// ---------------------------------------------------------------------------
console.log('\n7. the worker pool refuses a third agent');
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
console.log('\n8. the second unpriced model is refused the same way');
// ---------------------------------------------------------------------------
{
  const res = runCli(
    ['run', '--agent', 'SWR-Check', '--task', 'verification', '--model', 'antigravity/gemini-4-argon', '--prompt', 'hello there'],
  );
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
