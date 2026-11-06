// software-factory/budget-ledger.mjs — durable per-UTC-day spend cap for paid model calls.
//
// WHY THIS EXISTS
// ---------------
// `swr-agent.mjs` can call paid providers, and the swarm policy caps the
// program at $2/day and 2 concurrent agents. Nothing enforced that.
//
//   * `estimateCost()` runs AFTER the call, so it reports spend, it does not
//     prevent it.
//   * `estimateCost()` coerces a missing rate with `|| 0`, so a model whose
//     pricing is `null` looked exactly like a free one. `antigravity/gemini-3.6-flash`
//     and `antigravity/gemini-4-argon` carry `null` rates and are real paid
//     models — "we do not know what this costs" is not "free".
//
// THE RULES THIS MODULE ENCODES
// -----------------------------
//   1. Fail closed on unknown pricing for a PAID provider: a `null`/missing
//      rate means the cost is unknown, so the call is refused.
//   2. Local CLI providers (`antigravity-cli`, `opencode-cli`) are free by
//      construction — no API key, no billing — and must NOT be blocked by
//      rule 1. They are recognised by `providers[p].wire_format === 'cli'`
//      or a `command` on the provider, never by a hard-coded model list.
//   3. Money is reserved BEFORE the call and settled after it. A reservation
//      that was never settled still counts against the cap: the ledger is
//      conservative, so a crash can never buy an extra call.
//   4. One append-only JSONL file per UTC day (`ledger-YYYY-MM-DD.jsonl`).
//      A settlement is written into the day its RESERVATION was made, so a
//      call that crosses midnight keeps its accounting intact on the day it
//      started.
//   5. Every mutation is serialized by an exclusive lock file (`ledger.lock`).
//      The append is the commit point: a crash before it leaves no
//      reservation (nothing was spent); a crash after it leaves an unsettled
//      reservation that keeps counting (never an overspend).
//   6. A torn line (a crash in the middle of an append) makes the day's
//      accounting untrustworthy, so the day is refused until an operator
//      runs `reconcile()`. Fail closed, with a repair path.
//
// Zero dependencies. Node >= 18.
//
// Run: `node software-factory/budget-ledger.mjs status`
//      `node software-factory/budget-ledger.mjs reserve --model minimax/MiniMax-M3 --reservation-id r1 --output-tokens 1000`

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(HERE, '..');

export const DEFAULT_MAX_DAILY_USD = 2;
export const DEFAULT_STATE_DIR = path.join(REPO_ROOT, 'data', 'swr-budget');
export const DEFAULT_ROUTING_CONFIG = path.join(HERE, 'routing.config.json');
export const DEFAULT_SWARM_CONFIG = path.join(REPO_ROOT, 'qa', 'swarm.config.json');

export const STALE_LOCK_MS = 30_000;
export const LOCK_WAIT_MS = 10_000;

// ---------------------------------------------------------------------------
// small helpers
// ---------------------------------------------------------------------------

function round6(n) {
  return Number(Number(n || 0).toFixed(6));
}

function sleepSync(ms) {
  // A synchronous sleep, so the lock wait does not turn the whole ledger
  // into an async API (swr-agent.mjs is async, but the ledger is used from
  // synchronous test harnesses too).
  const sab = new SharedArrayBuffer(4);
  const ia = new Int32Array(sab);
  Atomics.wait(ia, 0, 0, ms);
}

function readJsonFile(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    if (err && err.code === 'ENOENT') return null;
    throw err;
  }
}

export function loadRoutingConfig(configPath = DEFAULT_ROUTING_CONFIG) {
  const cfg = readJsonFile(configPath);
  if (!cfg) throw new Error(`budget-ledger: routing config not found: ${configPath}`);
  return cfg;
}

/**
 * The swarm policy lives in `qa/swarm.config.json` on the KAI SWARM branch.
 * When it is not present (this is a branch off `main`), fall back to the
 * committed defaults, which are the same numbers the program was specified
 * with: $2/day, 2 agents.
 */
export function readLimits({ swarmConfigPath = DEFAULT_SWARM_CONFIG, fallbackUsd = DEFAULT_MAX_DAILY_USD } = {}) {
  const cfg = readJsonFile(swarmConfigPath);
  const usd = cfg && typeof cfg.maxDailyApiUsd === 'number' ? cfg.maxDailyApiUsd : fallbackUsd;
  const workers = cfg && typeof cfg.maxConcurrentAgents === 'number' ? cfg.maxConcurrentAgents : 2;
  return { maxDailyUsd: usd, maxConcurrentAgents: workers, source: cfg ? swarmConfigPath : 'defaults' };
}

// ---------------------------------------------------------------------------
// pricing
// ---------------------------------------------------------------------------

/**
 * Resolve what a model ref costs, and — more importantly — whether we know.
 *
 * Some models bill a LONG-CONTEXT TIER above an input threshold: xAI's
 * Grok 4.7 and 4.6 go from $2/$6 to $4/$12 per Mtok above 200k input
 * tokens, and MiniMax M3 doubles above 512k. Those rates used to live in
 * the model's `note` — prose the ledger could not read — so a long prompt
 * was priced at the base rate, the ledger UNDER-COUNTED what left the
 * account, and the daily cap was applied to a number that was wrong.
 *
 * The tier is now machine-readable (`pricing.long_context`) and selected by
 * the input size:
 *
 *   inputTokens   the input size to price (the estimate when reserving, the
 *                 real usage when settling)
 *   worstCase     price the long tier whenever the model HAS one, even if
 *                 the estimate is below the threshold — for a reservation,
 *                 where the estimate is the uncertain part
 *
 * @returns {{modelRef:string, provider:string|null, known:boolean, free:boolean,
 *            reason:string, tier?:string, threshold?:number,
 *            rates?:{input:number,output:number,cacheRead:number}}}
 */
export function resolvePricing(config, modelRef, { inputTokens = 0, worstCase = false } = {}) {
  const spec = config?.models?.[modelRef];
  let providerId = spec?.provider || null;
  if (!providerId && typeof modelRef === 'string' && modelRef.includes('/')) {
    providerId = modelRef.split('/')[0];
  }
  const provider = providerId ? config?.providers?.[providerId] : null;

  // A CLI provider runs a LOCAL binary: no API key, no per-token billing.
  //
  // This is checked BEFORE the model lookup on purpose. A CLI provider's
  // models are not listed in the routing config — the CLI resolves its own
  // model names — so `antigravity-cli/anything` has no `models` entry and
  // would otherwise be reported as an unknown model and BLOCKED. The
  // detection is on the provider (wire_format or command), never on a
  // hard-coded list of model names.
  if (provider && (provider.wire_format === 'cli' || provider.command)) {
    return { modelRef, provider: providerId, known: true, free: true, reason: 'local-cli', rates: null };
  }

  if (!spec) {
    return { modelRef, provider: providerId, known: false, free: false, reason: 'unknown-model', rates: null };
  }
  if (!provider) {
    return { modelRef, provider: providerId, known: false, free: false, reason: 'unknown-provider', rates: null };
  }

  const p = spec.pricing || {};
  const long = p.long_context || null;
  const threshold = Number(long?.above_input_tokens) > 0 ? Number(long.above_input_tokens) : null;
  const useLong = Boolean(long) && (worstCase || (threshold !== null && Number(inputTokens) > threshold));

  const rates = useLong
    ? {
      input: long.input_per_mtok,
      output: long.output_per_mtok,
      // A tier that does not name a cache rate inherits the base one.
      cacheRead: long.cache_read_per_mtok == null
        ? (p.cache_read_per_mtok == null ? 0 : p.cache_read_per_mtok)
        : long.cache_read_per_mtok,
    }
    : {
      input: p.input_per_mtok,
      output: p.output_per_mtok,
      // A cache-read rate is a discount, not a cost: absent means 0, and a
      // null cache rate is treated the same way. The INPUT and OUTPUT rates
      // are the ones that must be known.
      cacheRead: p.cache_read_per_mtok == null ? 0 : p.cache_read_per_mtok,
    };
  const missing = ['input', 'output'].filter((k) => rates[k] === null || rates[k] === undefined || Number.isNaN(Number(rates[k])));
  if (missing.length) {
    return { modelRef, provider: providerId, known: false, free: false, reason: 'unknown-pricing', rates, missing, tier: useLong ? 'long_context' : 'base', threshold };
  }
  return {
    modelRef,
    provider: providerId,
    known: true,
    free: false,
    reason: 'known',
    tier: useLong ? 'long_context' : 'base',
    threshold,
    rates,
  };
}

/**
 * The money function. Prices are per million tokens.
 *
 * Mirrors `estimateCost()` in swr-agent.mjs, but WITHOUT the `|| 0`
 * coercion on the input/output rates — that coercion is the bug this
 * module exists to make impossible. A missing rate is not a zero rate:
 * it yields a **null** cost and the caller must treat that as "unknown",
 * not as "free".
 */
export function estimateUsd(rates, usage) {
  const inTok = Number(usage?.input_tokens) || 0;
  const outTok = Number(usage?.output_tokens) || 0;
  const cacheTok = Number(usage?.cache_read_input_tokens) || 0;
  const r = rates || {};
  const known = (v) => v !== null && v !== undefined && v !== '' && Number.isFinite(Number(v));
  const inputRate = known(r.input) ? Number(r.input) : null;
  const outputRate = known(r.output) ? Number(r.output) : null;
  const cacheRate = r.cacheRead === null || r.cacheRead === undefined ? 0 : (known(r.cacheRead) ? Number(r.cacheRead) : null);
  if (inputRate === null || outputRate === null || cacheRate === null) {
    return {
      usd: null,
      input_tokens: inTok,
      output_tokens: outTok,
      cache_read_input_tokens: cacheTok,
      unknownRates: true,
    };
  }
  const usd = (inTok * inputRate + outTok * outputRate + cacheTok * cacheRate) / 1e6;
  return {
    usd: round6(usd),
    input_tokens: inTok,
    output_tokens: outTok,
    cache_read_input_tokens: cacheTok,
  };
}

// ---------------------------------------------------------------------------
// the ledger
// ---------------------------------------------------------------------------

export class BudgetLedger {
  constructor({
    stateDir = DEFAULT_STATE_DIR,
    maxDailyUsd = DEFAULT_MAX_DAILY_USD,
    now = () => new Date(),
    staleLockMs = STALE_LOCK_MS,
    lockWaitMs = LOCK_WAIT_MS,
  } = {}) {
    this.stateDir = stateDir;
    this.maxDailyUsd = maxDailyUsd;
    this.now = now;
    this.staleLockMs = staleLockMs;
    this.lockWaitMs = lockWaitMs;
    fs.mkdirSync(this.stateDir, { recursive: true });
  }

  get day() {
    return utcDayKey(this.now());
  }

  ledgerPath(day) {
    return path.join(this.stateDir, `ledger-${day}.jsonl`);
  }

  get lockPath() {
    return path.join(this.stateDir, 'ledger.lock');
  }

  _ts() {
    return new Date(this.now()).toISOString();
  }

  /** Records of one day. A line that does not parse is a torn append. */
  _readRecords(day) {
    let text;
    try {
      text = fs.readFileSync(this.ledgerPath(day), 'utf8');
    } catch (err) {
      if (err && err.code === 'ENOENT') return { records: [], torn: false };
      throw err;
    }
    const records = [];
    let torn = false;
    for (const line of text.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        records.push(JSON.parse(trimmed));
      } catch {
        torn = true;
      }
    }
    return { records, torn };
  }

  /** One atomic-ish append: O_APPEND + a single write() of one line. */
  _append(day, record) {
    const line = JSON.stringify(record) + '\n';
    const fd = fs.openSync(this.ledgerPath(day), 'a');
    try {
      fs.writeSync(fd, line);
    } finally {
      fs.closeSync(fd);
    }
  }

  /**
   * Exclusive lock. `open(..., 'wx')` is atomic: exactly one process can
   * create the file. A lock left behind by a crashed process is broken once
   * it is older than `staleLockMs`.
   */
  _withLock(fn) {
    const lockPath = this.lockPath;
    const deadline = Date.now() + this.lockWaitMs;
    for (;;) {
      let fd;
      try {
        fd = fs.openSync(lockPath, 'wx');
      } catch (err) {
        if (!err || err.code !== 'EEXIST') throw err;
        // A lock that outlived its holder is dead weight — break it.
        try {
          const st = fs.statSync(lockPath);
          if (Date.now() - st.mtimeMs > this.staleLockMs) {
            fs.unlinkSync(lockPath);
            continue;
          }
        } catch {
          continue; // the lock vanished under us — try again immediately
        }
        if (Date.now() >= deadline) {
          throw new Error('budget-ledger: could not acquire the ledger lock');
        }
        sleepSync(3 + Math.floor(Math.random() * 7));
        continue;
      }
      try {
        fs.writeSync(fd, `${process.pid} ${new Date().toISOString()}\n`);
      } finally {
        fs.closeSync(fd);
      }
      try {
        return fn();
      } finally {
        try {
          fs.unlinkSync(lockPath);
        } catch {
          /* already gone */
        }
      }
    }
  }

  /** Money summary of one day's records. Never takes the lock (reads are line-atomic). */
  _summarize(records, day) {
    const reserves = records.filter((r) => r.type === 'reserve');
    const settles = new Map();
    for (const r of records) if (r.type === 'settle') settles.set(r.reservationId, r);
    const releases = new Set();
    for (const r of records) if (r.type === 'release') releases.add(r.reservationId);

    let spent = 0;
    let reserved = 0;
    const reservations = [];
    for (const r of reserves) {
      const settled = settles.get(r.reservationId) || null;
      const released = releases.has(r.reservationId);
      const entry = {
        reservationId: r.reservationId,
        ts: r.ts || null,
        model: r.model || null,
        reservedUsd: round6(r.usd),
        free: Boolean(r.free),
        settled: Boolean(settled),
        released,
        settledUsd: settled ? round6(settled.usd) : null,
        overageUsd: settled ? round6(Math.max(0, (Number(settled.usd) || 0) - (Number(r.usd) || 0))) : 0,
        note: r.note || null,
      };
      if (settled) spent += Number(settled.usd) || 0;
      else if (!released) reserved += Number(r.usd) || 0;
      reservations.push(entry);
    }
    const committed = spent + reserved;
    return {
      day,
      capUsd: round6(this.maxDailyUsd),
      spentUsd: round6(spent),
      reservedUsd: round6(reserved),
      committedUsd: round6(committed),
      remainingUsd: round6(this.maxDailyUsd - committed),
      reservations,
    };
  }

  /** Find the day a reservation was made (today, or up to `lookback` days back). */
  _findReservation(records, reservationId) {
    for (const r of records) {
      if (r.type === 'reserve' && r.reservationId === reservationId) return r;
    }
    return null;
  }

  _locate(reservationId, lookback = 3) {
    const base = new Date(this.now());
    for (let back = 0; back <= lookback; back++) {
      const d = new Date(base.getTime() - back * 86400000);
      const day = utcDayKey(d);
      const { records, torn } = this._readRecords(day);
      if (torn) return { day, records, torn: true, reservation: null };
      const reservation = this._findReservation(records, reservationId);
      if (reservation) return { day, records, torn: false, reservation };
    }
    return { day: this.day, records: [], torn: false, reservation: null };
  }

  /**
   * Reserve money for a call that is about to happen.
   *
   * @param {object} o
   * @param {string} o.reservationId  idempotency key
   * @param {string} [o.modelRef]
   * @param {object} o.pricing         the result of `resolvePricing()`
   * @param {object} [o.usage]         the estimated token usage
   * @param {string} [o.note]
   */
  reserve({ reservationId, modelRef = null, pricing, usage = null, note = null } = {}) {
    if (!reservationId) throw new Error('budget-ledger: reserve() needs a reservationId');
    return this._withLock(() => {
      const day = this.day;
      const { records, torn } = this._readRecords(day);
      if (torn) {
        return { ok: false, reason: 'ledger-torn', day, reservedUsd: 0, status: this._summarize(records, day) };
      }

      // Idempotent: the same reservation id never spends twice.
      const existing = this._findReservation(records, reservationId);
      if (existing) {
        const status = this._summarize(records, day);
        return { ok: true, idempotent: true, reservation: existing, status };
      }

      // Fail closed: unknown pricing for a paid provider is a refusal, not a
      // free call. A CLI provider is free by construction and is allowed.
      if (!pricing || pricing.known !== true) {
        this._append(day, {
          type: 'refuse',
          reservationId,
          ts: this._ts(),
          day,
          reason: pricing?.reason || 'unknown-pricing',
          model: modelRef,
          note,
        });
        return {
          ok: false,
          reason: pricing?.reason || 'unknown-pricing',
          reservedUsd: 0,
          status: this._summarize(records, day),
        };
      }

      if (pricing.free) {
        const rec = {
          type: 'reserve',
          reservationId,
          ts: this._ts(),
          day,
          usd: 0,
          model: modelRef,
          free: true,
          usage,
          note,
        };
        this._append(day, rec);
        return { ok: true, reservation: rec, status: this._summarize(records.concat([rec]), day) };
      }

      const est = estimateUsd(pricing.rates, usage);
      if (est.usd === null) {
        // The pricing claimed to be known but the arithmetic cannot price
        // it. Refuse rather than reserve a number nobody can justify.
        this._append(day, {
          type: 'refuse',
          reservationId,
          ts: this._ts(),
          day,
          reason: 'unknown-pricing',
          model: modelRef,
          note,
        });
        return {
          ok: false,
          reason: 'unknown-pricing',
          reservedUsd: 0,
          status: this._summarize(records, day),
        };
      }
      const before = this._summarize(records, day);
      if (before.remainingUsd + 1e-9 < est.usd) {
        this._append(day, {
          type: 'refuse',
          reservationId,
          ts: this._ts(),
          day,
          reason: 'cap',
          usd: est.usd,
          model: modelRef,
          note,
        });
        return {
          ok: false,
          reason: 'cap',
          requestedUsd: est.usd,
          remainingUsd: before.remainingUsd,
          status: before,
        };
      }

      const rec = {
        type: 'reserve',
        reservationId,
        ts: this._ts(),
        day,
        usd: est.usd,
        model: modelRef,
        usage,
        note,
      };
      this._append(day, rec);
      return { ok: true, reservation: rec, status: this._summarize(records.concat([rec]), day) };
    });
  }

  /** Settle a reservation with what the call actually cost. */
  settle({ reservationId, usd = null, usage = null, note = null, model = null } = {}) {
    if (!reservationId) throw new Error('budget-ledger: settle() needs a reservationId');
    return this._withLock(() => {
      const found = this._locate(reservationId);
      if (found.torn) {
        return { ok: false, reason: 'ledger-torn', day: found.day, status: this._summarize(found.records, found.day) };
      }
      if (!found.reservation) {
        return { ok: false, reason: 'unknown-reservation', day: found.day, status: this._summarize(found.records, found.day) };
      }
      const already = found.records.find((r) => r.type === 'settle' && r.reservationId === reservationId);
      if (already) {
        return { ok: true, idempotent: true, settlement: already, status: this._summarize(found.records, found.day) };
      }
      const released = found.records.find((r) => r.type === 'release' && r.reservationId === reservationId);
      if (released) {
        return { ok: false, reason: 'released', day: found.day, status: this._summarize(found.records, found.day) };
      }

      const reservedUsd = Number(found.reservation.usd) || 0;
      const actual = usd === null || usd === undefined ? reservedUsd : Number(usd) || 0;
      const rec = {
        type: 'settle',
        reservationId,
        ts: this._ts(),
        day: found.day,
        usd: round6(actual),
        usage,
        note,
        /* The model that ACTUALLY answered — not the reservation's basis.
           The reservation is priced at the chain's most expensive member
           (so a chain that lands on MiniMax still holds Grok's rate), so
           without this field the day's file cannot say which provider
           served which call, and a spend cannot be attributed to a model.
           null means "not reported by the caller". */
        model: model || null,
        overageUsd: round6(Math.max(0, actual - reservedUsd)),
      };
      // Written into the RESERVATION's day, so a call that crosses midnight
      // keeps its accounting on the day it started.
      this._append(found.day, rec);
      return { ok: true, settlement: rec, status: this._summarize(found.records.concat([rec]), found.day) };
    });
  }

  /** Release a reservation — the call failed, or was abandoned before it billed. */
  release({ reservationId, reason = null } = {}) {
    if (!reservationId) throw new Error('budget-ledger: release() needs a reservationId');
    return this._withLock(() => {
      const found = this._locate(reservationId);
      if (found.torn) {
        return { ok: false, reason: 'ledger-torn', day: found.day, status: this._summarize(found.records, found.day) };
      }
      if (!found.reservation) {
        return { ok: false, reason: 'unknown-reservation', day: found.day, status: this._summarize(found.records, found.day) };
      }
      const already = found.records.find((r) => r.type === 'release' && r.reservationId === reservationId);
      if (already) {
        return { ok: true, idempotent: true, release: already, status: this._summarize(found.records, found.day) };
      }
      const settled = found.records.find((r) => r.type === 'settle' && r.reservationId === reservationId);
      if (settled) {
        return { ok: false, reason: 'already-settled', day: found.day, status: this._summarize(found.records, found.day) };
      }
      const rec = {
        type: 'release',
        reservationId,
        ts: this._ts(),
        day: found.day,
        usd: 0,
        reason,
      };
      this._append(found.day, rec);
      return { ok: true, release: rec, status: this._summarize(found.records.concat([rec]), found.day) };
    });
  }

  status(day = this.day) {
    const { records, torn } = this._readRecords(day);
    const summary = this._summarize(records, day);
    summary.torn = torn;
    if (torn) summary.remainingUsd = 0;
    return summary;
  }

  /** Remove repair temp files left behind by a crashed repair. */
  _pruneRepairTemps(maxAgeMs = 3600_000) {
    let names = [];
    try {
      names = fs.readdirSync(this.stateDir);
    } catch {
      return 0;
    }
    let removed = 0;
    for (const name of names) {
      if (!name.includes('.repair-')) continue;
      const file = path.join(this.stateDir, name);
      try {
        if (Date.now() - fs.statSync(file).mtimeMs < maxAgeMs) continue;
        fs.unlinkSync(file);
        removed++;
      } catch {
        /* already gone */
      }
    }
    return removed;
  }

  /**
   * Repair a day whose ledger has a torn line: keep the parsable records,
   * drop the fragment, and record the repair. This is an explicit operator
   * action — until it runs, the day refuses new reservations.
   *
   * The rewrite goes through a TEMP FILE and a rename. Truncating the day
   * in place and then writing it is exactly the failure this method exists
   * to repair: a crash between the two leaves an EMPTY day file, and the
   * spent money is gone. The rename is atomic, so a reader sees either the
   * old day or the repaired one — never a half-written one.
   */
  reconcile(day = this.day) {
    return this._withLock(() => {
      // A crashed repair leaves its temp file behind. The day file is the
      // important part and it is intact; the fragment is just litter.
      this._pruneRepairTemps();
      const { records, torn } = this._readRecords(day);
      if (!torn) return { ok: true, repaired: false, day };
      const kept = records.map((r) => JSON.stringify(r)).join('\n');
      const file = this.ledgerPath(day);
      const body = kept ? kept + '\n' : '';
      const tmp = `${file}.repair-${process.pid}-${Date.now()}`;
      const fd = fs.openSync(tmp, 'w');
      try {
        fs.writeSync(fd, body);
        fs.fsyncSync(fd);
      } finally {
        fs.closeSync(fd);
      }
      fs.renameSync(tmp, file);
      this._append(day, { type: 'repair', ts: this._ts(), day, note: 'torn append removed' });
      return { ok: true, repaired: true, day };
    });
  }
}

export function utcDayKey(date = new Date()) {
  return new Date(date).toISOString().slice(0, 10);
}

export function createLedger(opts = {}) {
  return new BudgetLedger(opts);
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

const USAGE = `budget-ledger — durable per-UTC-day spend cap for paid model calls

usage:
  node software-factory/budget-ledger.mjs status [--state-dir DIR] [--max-daily-usd N]
  node software-factory/budget-ledger.mjs reserve --reservation-id ID --model REF
      [--input-tokens N] [--output-tokens N] [--cache-read-tokens N] [--note TEXT]
  node software-factory/budget-ledger.mjs settle --reservation-id ID [--usd N] [--note TEXT]
  node software-factory/budget-ledger.mjs release --reservation-id ID [--reason TEXT]
  node software-factory/budget-ledger.mjs reconcile [--day YYYY-MM-DD]

The cap comes from qa/swarm.config.json when it exists, else $2/day.
Unknown pricing for a paid provider is REFUSED. CLI providers are free.
`;

function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('--')) {
        out[key] = true;
      } else {
        out[key] = next;
        i++;
      }
    } else {
      out._.push(a);
    }
  }
  return out;
}

export function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  const cmd = args._[0];
  if (!cmd || args.help || args.h) {
    process.stdout.write(USAGE);
    return cmd ? 0 : 2;
  }
  const limits = readLimits();
  const ledger = new BudgetLedger({
    stateDir: args['state-dir'] || DEFAULT_STATE_DIR,
    maxDailyUsd: args['max-daily-usd'] !== undefined ? Number(args['max-daily-usd']) : limits.maxDailyUsd,
  });

  if (cmd === 'status') {
    process.stdout.write(JSON.stringify(ledger.status(args.day), null, 2) + '\n');
    return 0;
  }
  if (cmd === 'reconcile') {
    const res = ledger.reconcile(args.day);
    process.stdout.write(JSON.stringify(res, null, 2) + '\n');
    return res.ok ? 0 : 1;
  }
  if (cmd === 'reserve') {
    const modelRef = args.model;
    if (!args['reservation-id'] || !modelRef) {
      process.stderr.write('budget-ledger: reserve needs --reservation-id and --model\n');
      return 2;
    }
    const config = loadRoutingConfig();
    const pricing = resolvePricing(config, modelRef);
    const usage = {
      input_tokens: Number(args['input-tokens']) || 0,
      output_tokens: Number(args['output-tokens']) || 0,
      cache_read_input_tokens: Number(args['cache-read-tokens']) || 0,
    };
    const res = ledger.reserve({
      reservationId: args['reservation-id'],
      modelRef,
      pricing,
      usage,
      note: args.note || null,
    });
    process.stdout.write(JSON.stringify(res, null, 2) + '\n');
    return res.ok ? 0 : 1;
  }
  if (cmd === 'settle' || cmd === 'release') {
    if (!args['reservation-id']) {
      process.stderr.write(`budget-ledger: ${cmd} needs --reservation-id\n`);
      return 2;
    }
    const res =
      cmd === 'settle'
        ? ledger.settle({
            reservationId: args['reservation-id'],
            usd: args.usd !== undefined ? Number(args.usd) : null,
            note: args.note || null,
          })
        : ledger.release({ reservationId: args['reservation-id'], reason: args.reason || null });
    process.stdout.write(JSON.stringify(res, null, 2) + '\n');
    return res.ok ? 0 : 1;
  }
  process.stderr.write(`budget-ledger: unknown command "${cmd}"\n${USAGE}`);
  return 2;
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  process.exit(main());
}
