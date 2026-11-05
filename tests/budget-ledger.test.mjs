// tests/budget-ledger.test.mjs — node test for software-factory/budget-ledger.mjs
//
// The ledger is the thing that makes the $2/day budget real. These tests
// cover the money rules and the crash rules, because a budget that is wrong
// in the optimistic direction spends real money.
//
// Zero dependencies. Run:
//   npm run test:budget-ledger
// or:
//   node tests/budget-ledger.test.mjs

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const {
  BudgetLedger,
  createLedger,
  loadRoutingConfig,
  readLimits,
  resolvePricing,
  estimateUsd,
  utcDayKey,
  DEFAULT_MAX_DAILY_USD,
} = await import(path.join(ROOT, 'software-factory', 'budget-ledger.mjs'));

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

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'swr-ledger-test-'));
let tmpSeq = 0;
function tmpDir() {
  const d = path.join(tmpRoot, `case-${++tmpSeq}`);
  fs.mkdirSync(d, { recursive: true });
  return d;
}

/** A synthetic paid provider: $0.30 per 1M input tokens. */
function paidPricing(rates = { input: 0.3, output: 1.2, cacheRead: 0 }) {
  return { modelRef: 'test/paid', provider: 'test', known: true, free: false, reason: 'known', rates };
}
const ONE_MTOK = { input_tokens: 1_000_000, output_tokens: 0 };

// ---------------------------------------------------------------------------
// 1. day keys are UTC
// ---------------------------------------------------------------------------
section('utc day keys');
assert(utcDayKey(new Date('2026-11-04T00:00:00Z')) === '2026-11-04', 'a UTC midnight is the day itself');
assert(utcDayKey(new Date('2026-11-04T23:59:59Z')) === '2026-11-04', 'the last second of a UTC day stays on that day');
assert(utcDayKey(new Date('2026-11-04T23:30:00-05:00')) === '2026-11-05', 'a local evening in UTC-5 is already the next UTC day');
assert(utcDayKey(new Date('2026-01-01T00:30:00+02:00')) === '2025-12-31', 'a local morning in UTC+2 is still the previous UTC day');

// ---------------------------------------------------------------------------
// 2. pricing resolution — fail closed on unknown rates
// ---------------------------------------------------------------------------
section('pricing resolution');
const config = loadRoutingConfig(path.join(ROOT, 'software-factory', 'routing.config.json'));

const mm = resolvePricing(config, 'minimax/MiniMax-M3');
assert(mm.known === true, 'a priced HTTP model is known');
assert(mm.free === false, 'a priced HTTP model is not free');
assert(mm.reason === 'known', 'a priced HTTP model reasons as "known"');
assert(mm.rates.input === 0.3 && mm.rates.output === 1.2, 'the input/output rates come from the config');

const unknownRate = resolvePricing(config, 'antigravity/gemini-3.6-flash');
assert(unknownRate.known === false, 'a null-priced paid model is NOT known');
assert(unknownRate.free === false, 'a null-priced paid model is NOT free');
assert(unknownRate.reason === 'unknown-pricing', 'a null-priced paid model reasons as "unknown-pricing"');

const unknownArgon = resolvePricing(config, 'antigravity/gemini-4-argon');
assert(unknownArgon.known === false, 'the second null-priced model is also unknown');

const freeModel = resolvePricing(config, 'opencode/deepseek-v4-flash-free');
assert(freeModel.known === true && freeModel.free === false, 'a zero-priced HTTP model is known and priced (not "free by kind")');
assert(freeModel.rates.input === 0 && freeModel.rates.output === 0, 'a zero-priced HTTP model carries zero rates');

const noModel = resolvePricing(config, 'nope/nope');
assert(noModel.known === false && noModel.reason === 'unknown-model', 'an unlisted model is unknown-model');

const cliConfig = {
  providers: { 'my-cli': { wire_format: 'cli', command: 'mybinary' } },
  models: { 'my-cli/model-a': { provider: 'my-cli' } },
};
const cli = resolvePricing(cliConfig, 'my-cli/model-a');
assert(cli.known === true && cli.free === true, 'a CLI provider is known and free');
assert(cli.reason === 'local-cli', 'a CLI provider reasons as "local-cli"');

const cliByCommand = resolvePricing(
  { providers: { 'other-cli': { command: 'otherbin' } }, models: { 'other-cli/x': { provider: 'other-cli' } } },
  'other-cli/x',
);
assert(cliByCommand.free === true, 'a provider with a command is a CLI provider even without wire_format=cli');

const cliNoPricing = resolvePricing(
  { providers: { 'c2': { wire_format: 'cli' } }, models: { 'c2/m': { provider: 'c2', pricing: { input_per_mtok: null, output_per_mtok: null } } } },
  'c2/m',
);
assert(cliByCommand.free === true && cliNoPricing.free === true, 'a CLI provider is free even with null pricing');

// ---------------------------------------------------------------------------
// 3. cost arithmetic
// ---------------------------------------------------------------------------
section('cost arithmetic');
const cost = estimateUsd({ input: 0.3, output: 1.2, cacheRead: 0.06 }, { input_tokens: 1_000_000, output_tokens: 1_000_000 });
assert(Math.abs(cost.usd - 1.5) < 1e-9, '1M in + 1M out at $0.3/$1.2 is $1.50');
const withCache = estimateUsd({ input: 0.3, output: 1.2, cacheRead: 0.06 }, { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 1_000_000 });
assert(Math.abs(withCache.usd - 0.06) < 1e-9, 'a cache read is billed at the cache rate');
const noUsage = estimateUsd({ input: 0.3, output: 1.2, cacheRead: 0 }, null);
assert(noUsage.usd === 0, 'no usage costs nothing');
const missingRate = estimateUsd({ input: null, output: 1.2 }, { input_tokens: 1000, output_tokens: 1000 });
assert(missingRate.usd === null, 'a missing rate is a NULL cost, not a zero — an unpriceable call must not look free');
const unknownBoth = estimateUsd({}, { input_tokens: 1000, output_tokens: 1000 });
assert(unknownBoth.usd === null, 'no rates at all is a null cost');

// ---------------------------------------------------------------------------
// 4. limits
// ---------------------------------------------------------------------------
section('limits');
const limits = readLimits({ swarmConfigPath: path.join(tmpDir(), 'absent.json') });
assert(limits.maxDailyUsd === DEFAULT_MAX_DAILY_USD, 'the fallback cap is $2/day');
assert(limits.maxConcurrentAgents === 2, 'the fallback worker cap is 2');
assert(limits.source === 'defaults', 'a missing swarm config is reported as "defaults"');

// ---------------------------------------------------------------------------
// 5. reserve / settle / release
// ---------------------------------------------------------------------------
section('reserve, settle, release');
{
  const dir = tmpDir();
  const l = createLedger({ stateDir: dir, maxDailyUsd: 1 });
  const r = l.reserve({ reservationId: 'r1', modelRef: 'test/paid', pricing: paidPricing(), usage: ONE_MTOK });
  assert(r.ok === true, 'a reservation under the cap succeeds');
  assert(Math.abs(r.status.reservedUsd - 0.3) < 1e-9, 'the reservation holds $0.30');
  assert(r.status.remainingUsd === 0.7, 'the remaining budget drops to $0.70');

  const again = l.reserve({ reservationId: 'r1', modelRef: 'test/paid', pricing: paidPricing(), usage: ONE_MTOK });
  assert(again.ok === true && again.idempotent === true, 'the same reservation id is idempotent');
  assert(Math.abs(again.status.reservedUsd - 0.3) < 1e-9, 'an idempotent reserve does not spend twice');

  const settled = l.settle({ reservationId: 'r1', usd: 0.25 });
  assert(settled.ok === true, 'a settlement succeeds');
  assert(Math.abs(settled.status.spentUsd - 0.25) < 1e-9, 'the spend is what was actually charged');
  assert(settled.status.reservedUsd === 0, 'a settled reservation no longer holds money');
  assert(Math.abs(settled.status.remainingUsd - 0.75) < 1e-9, 'the remaining budget reflects the actual spend');

  const settleAgain = l.settle({ reservationId: 'r1', usd: 0.25 });
  assert(settleAgain.ok === true && settleAgain.idempotent === true, 'settling twice is idempotent');
  assert(Math.abs(l.status().spentUsd - 0.25) < 1e-9, 'a double settle does not double the spend');
}

{
  const dir = tmpDir();
  const l = createLedger({ stateDir: dir, maxDailyUsd: 1 });
  l.reserve({ reservationId: 'r2', modelRef: 'test/paid', pricing: paidPricing(), usage: ONE_MTOK });
  const rel = l.release({ reservationId: 'r2', reason: 'provider failed' });
  assert(rel.ok === true, 'a release succeeds');
  assert(l.status().reservedUsd === 0, 'a released reservation holds no money');
  assert(l.status().spentUsd === 0, 'a released reservation costs nothing');
  const relAgain = l.release({ reservationId: 'r2' });
  assert(relAgain.ok === true && relAgain.idempotent === true, 'releasing twice is idempotent');
  const settleAfterRelease = l.settle({ reservationId: 'r2', usd: 0.5 });
  assert(settleAfterRelease.ok === false && settleAfterRelease.reason === 'released', 'a released reservation cannot be settled');
}

// ---------------------------------------------------------------------------
// 6. the cap
// ---------------------------------------------------------------------------
section('the daily cap');
{
  const dir = tmpDir();
  const l = createLedger({ stateDir: dir, maxDailyUsd: 0.5 });
  const a = l.reserve({ reservationId: 'c1', modelRef: 'test/paid', pricing: paidPricing(), usage: ONE_MTOK });
  assert(a.ok === true, 'the first $0.30 reservation is inside a $0.50 cap');
  const b = l.reserve({ reservationId: 'c2', modelRef: 'test/paid', pricing: paidPricing(), usage: ONE_MTOK });
  assert(b.ok === false, 'the second $0.30 reservation does not fit in the remaining $0.20');
  assert(b.reason === 'cap', 'the refusal reason is "cap"');
  assert(Math.abs(b.remainingUsd - 0.2) < 1e-9, 'the refusal reports the remaining budget');
  assert(l.status().reservedUsd === 0.3, 'the refused reservation reserved nothing');
}

{
  const dir = tmpDir();
  const l = createLedger({ stateDir: dir, maxDailyUsd: 0.3 });
  const r = l.reserve({ reservationId: 'exact', modelRef: 'test/paid', pricing: paidPricing(), usage: ONE_MTOK });
  assert(r.ok === true, 'a reservation exactly equal to the remaining budget is allowed');
  assert(r.status.remainingUsd === 0, 'the budget lands exactly on zero');
  const next = l.reserve({ reservationId: 'over', modelRef: 'test/paid', pricing: paidPricing(), usage: ONE_MTOK });
  assert(next.ok === false && next.reason === 'cap', 'the next reservation is refused once the budget is gone');
}

// ---------------------------------------------------------------------------
// 7. fail closed on unknown pricing
// ---------------------------------------------------------------------------
section('unknown pricing refuses');
{
  const dir = tmpDir();
  const l = createLedger({ stateDir: dir, maxDailyUsd: 1 });
  const r = l.reserve({
    reservationId: 'u1',
    modelRef: 'antigravity/gemini-3.6-flash',
    pricing: resolvePricing(config, 'antigravity/gemini-3.6-flash'),
    usage: ONE_MTOK,
  });
  assert(r.ok === false, 'a null-priced paid model is refused');
  assert(r.reason === 'unknown-pricing', 'the refusal reason is "unknown-pricing"');
  assert(r.status.reservedUsd === 0, 'a refused call reserves nothing');
  assert(l.status().spentUsd === 0, 'a refused call spends nothing');
  const raw = fs.readFileSync(l.ledgerPath(l.day), 'utf8');
  assert(raw.includes('"type":"refuse"'), 'the refusal is recorded in the ledger');
}

{
  const dir = tmpDir();
  const l = createLedger({ stateDir: dir, maxDailyUsd: 1 });
  const r = l.reserve({ reservationId: 'u2', modelRef: 'my-cli/model-a', pricing: cli, usage: ONE_MTOK });
  assert(r.ok === true, 'a CLI provider is allowed through');
  assert(r.status.reservedUsd === 0, 'a CLI provider reserves no money');
  assert(r.reservation.free === true, 'the CLI reservation is recorded as free');
  const s = l.settle({ reservationId: 'u2', usd: 0 });
  assert(s.ok === true, 'a free reservation settles');
  assert(l.status().spentUsd === 0, 'a free call never costs money');
}

// ---------------------------------------------------------------------------
// 8. UTC rollover — a settlement stays on the reservation's day
// ---------------------------------------------------------------------------
section('UTC rollover');
{
  const dir = tmpDir();
  let clock = new Date('2026-11-04T23:50:00Z');
  const l = createLedger({ stateDir: dir, maxDailyUsd: 1, now: () => clock });
  l.reserve({ reservationId: 'mid', modelRef: 'test/paid', pricing: paidPricing(), usage: ONE_MTOK });
  assert(fs.existsSync(l.ledgerPath('2026-11-04')), 'the reservation is written to its own UTC day file');
  clock = new Date('2026-11-05T00:20:00Z');
  const s = l.settle({ reservationId: 'mid', usd: 0.3 });
  assert(s.ok === true, 'a settlement after midnight still finds the reservation');
  const day4 = fs.readFileSync(l.ledgerPath('2026-11-04'), 'utf8');
  const day5 = fs.existsSync(l.ledgerPath('2026-11-05')) ? fs.readFileSync(l.ledgerPath('2026-11-05'), 'utf8') : '';
  assert(day4.includes('"type":"settle"'), 'the settlement lands in the reservation day file');
  assert(!day5.includes('"type":"settle"'), 'the settlement does NOT spill into the next day file');
}

// ---------------------------------------------------------------------------
// 9. a torn ledger line fails the day closed
// ---------------------------------------------------------------------------
section('torn ledger');
{
  const dir = tmpDir();
  const l = createLedger({ stateDir: dir, maxDailyUsd: 1 });
  l.reserve({ reservationId: 't1', modelRef: 'test/paid', pricing: paidPricing(), usage: ONE_MTOK });
  fs.appendFileSync(l.ledgerPath(l.day), '{"type":"reserve","reservationId":"tor');
  const r = l.reserve({ reservationId: 't2', modelRef: 'test/paid', pricing: paidPricing(), usage: ONE_MTOK });
  assert(r.ok === false, 'a torn ledger refuses new reservations');
  assert(r.reason === 'ledger-torn', 'the refusal reason is "ledger-torn"');
  assert(l.status().torn === true, 'status reports the torn day');
  assert(l.status().remainingUsd === 0, 'a torn day reports no remaining budget');
  const rec = l.reconcile();
  assert(rec.ok === true && rec.repaired === true, 'reconcile repairs the day');
  assert(l.status().torn === false, 'the repaired day is no longer torn');
  const after = l.reserve({ reservationId: 't3', modelRef: 'test/paid', pricing: paidPricing(), usage: ONE_MTOK });
  assert(after.ok === true, 'reservations work again after the repair');
}

// ---------------------------------------------------------------------------
// 9b. the repair never truncates the day
// ---------------------------------------------------------------------------
section('atomic repair');
{
  const dir = tmpDir();
  const l = createLedger({ stateDir: dir, maxDailyUsd: 1 });
  l.reserve({ reservationId: 'a1', modelRef: 'test/paid', pricing: paidPricing(), usage: ONE_MTOK });
  l.settle({ reservationId: 'a1', usd: 0.25 });
  fs.appendFileSync(l.ledgerPath(l.day), '{"type":"reserve","reservationId":"tor');
  const before = l.status();
  assert(before.torn === true, 'the day is torn before the repair');
  l.reconcile();
  const after = l.status();
  assert(after.torn === false, 'the day is whole after the repair');
  assert(after.spentUsd === before.spentUsd, 'the repair kept the money that was already spent');
  assert(after.reservations.length === before.reservations.length, 'the repair kept every reservation');
  const leftovers = fs.readdirSync(dir).filter((f) => f.includes('.repair-'));
  assert(leftovers.length === 0, 'the repair leaves no temp file behind');
  // The rewrite goes through a rename, so a reader never sees an empty day.
  const body = fs.readFileSync(l.ledgerPath(l.day), 'utf8');
  assert(body.includes('"type":"settle"'), 'the settled record survived the repair');
}

{
  // A crash DURING the repair must not erase the day. Truncating the file
  // in place and then writing it is the failure this repair exists to fix:
  // a crash between the two leaves an empty day, and the spent money with it.
  const dir = tmpDir();
  const l = createLedger({ stateDir: dir, maxDailyUsd: 1 });
  l.reserve({ reservationId: 'c1', modelRef: 'test/paid', pricing: paidPricing(), usage: ONE_MTOK });
  l.settle({ reservationId: 'c1', usd: 0.25 });
  fs.appendFileSync(l.ledgerPath(l.day), '{"type":"reserve","reservationId":"tor');
  const spentBefore = l.status().spentUsd;

  const realRename = fs.renameSync;
  fs.renameSync = () => {
    throw new Error('simulated crash during the repair');
  };
  let crashed = false;
  try {
    l.reconcile();
  } catch {
    crashed = true;
  } finally {
    fs.renameSync = realRename;
  }
  assert(crashed === true, 'the repair did crash, as simulated');
  const after = l.status();
  assert(after.spentUsd === spentBefore, 'the money that was already spent survived the crashed repair');
  // The crashed repair left a temp file. The next repair prunes it — once
  // it is old enough to be litter rather than a repair in flight.
  const litter = fs.readdirSync(dir).filter((f) => f.includes('.repair-'));
  assert(litter.length >= 1, 'the crashed repair left its temp file behind');
  const old = new Date(Date.now() - 2 * 60 * 60 * 1000);
  for (const name of litter) fs.utimesSync(path.join(dir, name), old, old);
  l.reconcile();
  const litterAfter = fs.readdirSync(dir).filter((f) => f.includes('.repair-'));
  assert(litterAfter.length === 0, 'the next repair prunes the litter');
}

// ---------------------------------------------------------------------------
// 10. stale lock breaking
// ---------------------------------------------------------------------------
section('stale lock');
{
  const dir = tmpDir();
  const l = createLedger({ stateDir: dir, maxDailyUsd: 1, staleLockMs: 50 });
  fs.writeFileSync(l.lockPath, '9999 stale\n');
  const old = new Date(Date.now() - 5000);
  fs.utimesSync(l.lockPath, old, old);
  const r = l.reserve({ reservationId: 'sl1', modelRef: 'test/paid', pricing: paidPricing(), usage: ONE_MTOK });
  assert(r.ok === true, 'a stale lock is broken so the ledger keeps working');
  assert(!fs.existsSync(l.lockPath), 'the lock is released after the operation');
}

// ---------------------------------------------------------------------------
// 11. concurrency — N processes, one cap
// ---------------------------------------------------------------------------
section('concurrency');
{
  const dir = tmpDir();
  const cap = 1;
  const modulePath = path.join(ROOT, 'software-factory', 'budget-ledger.mjs');
  const childPath = path.join(dir, 'child-reserve.mjs');
  fs.writeFileSync(
    childPath,
    `import { createLedger } from ${JSON.stringify('file://' + modulePath)};
const id = process.argv[2];
const l = createLedger({ stateDir: ${JSON.stringify(dir)}, maxDailyUsd: ${cap} });
const res = l.reserve({
  reservationId: id,
  modelRef: 'test/paid',
  pricing: { known: true, free: false, reason: 'known', rates: { input: 0.3, output: 1.2, cacheRead: 0 } },
  usage: { input_tokens: 1000000, output_tokens: 0 },
});
process.stdout.write(JSON.stringify({ ok: res.ok, reason: res.reason || null }));
`,
  );
  const n = 6;
  const kids = [];
  for (let i = 0; i < n; i++) {
    kids.push(
      new Promise((resolve) => {
        const c = spawn(process.execPath, [childPath, `conc-${i}`], { stdio: ['ignore', 'pipe', 'ignore'] });
        let out = '';
        c.stdout.on('data', (d) => (out += d));
        c.on('close', () => {
          try {
            resolve(JSON.parse(out));
          } catch {
            resolve({ ok: false, reason: 'no-output' });
          }
        });
      }),
    );
  }
  const results = await Promise.all(kids);
  const okCount = results.filter((r) => r.ok).length;
  const capCount = results.filter((r) => r.reason === 'cap').length;
  assert(okCount <= 3, `at most 3 of ${n} concurrent $0.30 reservations fit under a $1.00 cap (got ${okCount})`);
  assert(okCount + capCount === n, `every concurrent child either reserved or was refused for the cap (got ${okCount}+${capCount} of ${n})`);
  const status = createLedger({ stateDir: dir, maxDailyUsd: cap }).status();
  assert(status.reservedUsd <= cap + 1e-9, `the ledger total never exceeds the cap (reserved ${status.reservedUsd})`);
  assert(Math.abs(status.reservedUsd - okCount * 0.3) < 1e-9, 'the reserved total equals the number of successful reservations');
}

// ---------------------------------------------------------------------------
// 12. the ledger file is the record
// ---------------------------------------------------------------------------
section('the ledger file');
{
  const dir = tmpDir();
  const l = createLedger({ stateDir: dir, maxDailyUsd: 1 });
  l.reserve({ reservationId: 'f1', modelRef: 'test/paid', pricing: paidPricing(), usage: ONE_MTOK });
  l.settle({ reservationId: 'f1', usd: 0.3 });
  const raw = fs.readFileSync(l.ledgerPath(l.day), 'utf8');
  const lines = raw.split('\n').filter((x) => x.trim());
  assert(lines.length === 2, 'the day file holds one line per event');
  let parsed = true;
  for (const line of lines) {
    try {
      JSON.parse(line);
    } catch {
      parsed = false;
    }
  }
  assert(parsed, 'every line in the day file is valid JSON');
  assert(!raw.includes(process.env.HOME || '/root'), 'the ledger file carries no absolute home path');
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
