// software-factory/swarm-guard.mjs
//
// The swarm's two safety rails, composed into one object the agent bridge
// can hold for the length of a run:
//
//   1. a durable per-UTC-day money ledger  (./budget-ledger.mjs)
//   2. a global worker-lease pool            (./worker-lease.mjs)
//
// Rules this module enforces, and no caller can opt out of:
//
//   * Every paid provider turn is reserved BEFORE the request goes out.
//     The reservation is sized by the WORST-CASE member of the failover
//     chain, because a failover can land on the expensive model.
//   * A chain that contains a paid model with unknown pricing is refused
//     outright. A local CLI provider is free by construction and never
//     blocks a run.
//   * The money that is actually spent is settled from the ANSWERING
//     model's own rates. The difference between the reservation and the
//     actual cost is released back to the day.
//   * At most `maxWorkers` agents may be active at once, across the whole
//     machine. A lease left behind by a crashed agent is recovered by TTL.
//
// Zero dependencies. Node >= 18. Pure where it can be: the plan helpers
// take plain objects and return plain objects, so they are testable
// without a filesystem, a browser or a provider.

import {
  BudgetLedger,
  createLedger,
  estimateUsd,
  loadRoutingConfig,
  readLimits,
  resolvePricing,
  utcDayKey,
} from './budget-ledger.mjs';
import { WorkerLeaseManager, createLeaseManager } from './worker-lease.mjs';

// A rough, deliberately pessimistic token estimate. Four characters per
// token is the rule of thumb that keeps a reservation from being smaller
// than the call that follows it.
export const GUARD_CHARS_PER_TOKEN = 4;

/** Estimate the input tokens of a blob of text. */
export function estimateTokens(text) {
  const s = typeof text === 'string' ? text : String(text ?? '');
  if (!s.length) return 0;
  return Math.ceil(s.length / GUARD_CHARS_PER_TOKEN);
}

/**
 * Estimate tokens from a character count, using the same rule.
 *
 * A turn's input is several parts (system prompt, message history, tool
 * schema) that are never concatenated in memory. This lets the caller
 * add up the sizes without building one big string.
 */
export function estimateTokensFromChars(chars) {
  const n = Number(chars);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.ceil(n / GUARD_CHARS_PER_TOKEN);
}

/**
 * Price a failover chain and pick the reservation basis.
 *
 * The chain is `[primary, ...fallbacks]`. A turn may be answered by ANY
 * of them, so the reservation must cover the most expensive one.
 *
 * Returns:
 *   {
 *     ok: true,
 *     ceilingUsd: number,          // the worst-case cost of one turn
 *     basis: { modelRef, pricing, usage, estUsd },
 *     members: [{ modelRef, known, free, reason, estUsd }],
 *     failures: [{ modelRef, reason }]   // unknown-pricing members
 *   }
 * or
 *   { ok: false, reason: 'unknown-pricing', failures: [...], members: [...] }
 *
 * Fail-closed: if ANY member of the chain is a paid model whose pricing
 * is unknown, the whole chain is refused. We cannot bound the cost of a
 * call we are unable to price.
 */
export function resolveChainPlan({ config, chain, maxTokens, inputTokens = 0 } = {}) {
  const members = [];
  const failures = [];

  for (const modelRef of chain || []) {
    const pricing = resolvePricing(config, modelRef);
    if (pricing.known !== true) {
      failures.push({ modelRef, reason: pricing.reason || 'unknown-pricing' });
      members.push({ modelRef, known: false, free: false, reason: pricing.reason, estUsd: null });
      continue;
    }
    const usage = { input_tokens: Number(inputTokens) || 0, output_tokens: Number(maxTokens) || 0 };
    const estUsd = pricing.free ? 0 : estimateUsd(pricing.rates, usage).usd;
    members.push({ modelRef, known: true, free: Boolean(pricing.free), reason: pricing.reason, estUsd, pricing, usage });
  }

  if (failures.length) {
    // The refusal names the ACTUAL cause when every failure shares one
    // ('unknown-model' for a typo, 'unknown-pricing' for null rates) and
    // falls back to the generic category when the causes differ.
    const reasons = new Set(failures.map((f) => f.reason));
    const reason = reasons.size === 1 ? failures[0].reason : 'unknown-pricing';
    return { ok: false, reason, failures, members, ceilingUsd: null, basis: null };
  }

  // The reservation basis is the most expensive member of the chain.
  let basis = null;
  for (const m of members) {
    if (!basis || m.estUsd > basis.estUsd) basis = m;
  }
  if (!basis) {
    return { ok: false, reason: 'empty-chain', failures, members, ceilingUsd: null, basis: null };
  }

  return {
    ok: true,
    reason: 'ok',
    failures: [],
    members,
    ceilingUsd: basis.estUsd,
    basis: { modelRef: basis.modelRef, pricing: basis.pricing, usage: basis.usage, estUsd: basis.estUsd },
  };
}

/**
 * The guard: a ledger, a lease pool, and the rules that bind them to a
 * run. Construct it lazily — the `formats` command must never create a
 * state directory as a side effect.
 */
export class SwarmGuard {
  constructor({ config, ledger, leases, limits = null, leaseTtlMs = undefined } = {}) {
    this.config = config;
    this.ledger = ledger;
    this.leases = leases;
    this.limits = limits || { maxDailyUsd: ledger?.maxDailyUsd ?? 2, maxConcurrentAgents: leases?.maxWorkers ?? 2, source: 'defaults' };
    this.leaseTtlMs = leaseTtlMs;
    this.turnCounter = 0;
  }

  /** Build a guard from the repo's own config files and state dirs. */
  static create({
    routingConfigPath,
    stateDir,
    leaseDir,
    maxDailyUsd,
    maxWorkers,
    now,
    leaseTtlMs,
  } = {}) {
    const config = loadRoutingConfig(routingConfigPath);
    const limits = readLimits();
    const ledger = createLedger({
      stateDir,
      maxDailyUsd: maxDailyUsd ?? limits.maxDailyUsd,
      now,
    });
    const leases = createLeaseManager({
      dir: leaseDir,
      maxWorkers: maxWorkers ?? limits.maxConcurrentAgents,
      now: now ? () => Number(now()) : undefined,
      ttlMs: leaseTtlMs,
    });
    return new SwarmGuard({ config, ledger, leases, limits, leaseTtlMs });
  }

  // ------------------------------------------------------------- workers ---

  /**
   * Claim one of the global worker slots.
   *
   * Returns the lease manager's result verbatim. `reason: 'cap'` means
   * two agents are already running and this one must not start.
   */
  claimWorker({ workerId, mission = null, ttlMs = this.leaseTtlMs } = {}) {
    if (!workerId) return { ok: false, reason: 'no-worker-id' };
    return this.leases.claim({ workerId, mission, ttlMs });
  }

  /** Extend the lease. Keeps a long run alive without holding a slot forever. */
  renewWorker({ workerId, ttlMs = this.leaseTtlMs } = {}) {
    return this.leases.renew({ workerId, ttlMs });
  }

  /** Give the slot back. Safe to call twice. */
  releaseWorker({ workerId, reason = 'done' } = {}) {
    return this.leases.release({ workerId, reason });
  }

  // --------------------------------------------------------------- turns ---

  /** A fresh, collision-resistant reservation id for one turn of one run. */
  nextReservationId({ runId = 'run' } = {}) {
    this.turnCounter += 1;
    return `${runId}-t${this.turnCounter}`;
  }

  /**
   * Reserve the money for one turn.
   *
   * The reservation is sized by the worst-case member of the chain, so a
   * failover to an expensive model is already paid for. Nothing is
   * reserved (and nothing is spent) when the chain cannot be priced.
   */
  reserveTurn({ reservationId, chain, maxTokens, inputTokens = 0, note = null } = {}) {
    if (!reservationId) throw new Error('swarm-guard: reserveTurn() needs a reservationId');
    const plan = resolveChainPlan({ config: this.config, chain, maxTokens, inputTokens });
    if (!plan.ok) {
      // A refusal is an audit event. The operator has to be able to see
      // that a turn was turned away, and why, long after the run is over
      // — so the refusal is written to the ledger rather than only to
      // stderr. Nothing is reserved and nothing is spent.
      if (plan.failures.length) {
        const first = plan.failures[0];
        this.ledger.reserve({
          reservationId,
          modelRef: first.modelRef,
          pricing: resolvePricing(this.config, first.modelRef),
          usage: { input_tokens: Number(inputTokens) || 0, output_tokens: Number(maxTokens) || 0 },
          note,
        });
      }
      return {
        ok: false,
        reason: plan.reason,
        failures: plan.failures,
        members: plan.members,
        reservedUsd: 0,
        status: this.ledger.status(),
      };
    }
    const result = this.ledger.reserve({
      reservationId,
      modelRef: plan.basis.modelRef,
      pricing: plan.basis.pricing,
      usage: plan.basis.usage,
      note,
    });
    if (!result.ok) {
      return { ...result, ceilingUsd: plan.ceilingUsd, members: plan.members };
    }
    return { ...result, ceilingUsd: plan.ceilingUsd, members: plan.members, plan };
  }

  /**
   * Settle a turn with what it actually cost.
   *
   * The actual cost is computed here from the ANSWERING model's own
   * rates and the provider's reported usage — never from the bridge's
   * `estimateCost()`, which coerces a missing rate to zero and would
   * silently under-count a real spend.
   *
   * If the answering model cannot be priced (should be impossible: the
   * chain was priced before the call), the reservation is settled at its
   * full reserved amount — the pessimistic direction.
   */
  settleTurn({ reservationId, modelRef, usage = null, note = null } = {}) {
    if (!reservationId) throw new Error('swarm-guard: settleTurn() needs a reservationId');
    let usd = null;
    let priced = false;
    if (modelRef) {
      const pricing = resolvePricing(this.config, modelRef);
      if (pricing.known === true) {
        priced = true;
        usd = pricing.free ? 0 : estimateUsd(pricing.rates, usage || {}).usd;
      }
    }
    const result = this.ledger.settle({
      reservationId,
      usd: priced ? usd : null,
      usage,
      note: priced ? note : note || 'actual model unpriced — settled at reservation',
    });
    return { ...result, priced, settledUsd: priced ? usd : null };
  }

  /**
   * Give a reservation back without spending it.
   *
   * Used when a turn definitely produced nothing (every model in the
   * chain failed, so there is no completion to bill). An indeterminate
   * outcome must NOT release — the money may still have been spent.
   */
  releaseTurn({ reservationId, reason = 'turn-failed' } = {}) {
    if (!reservationId) throw new Error('swarm-guard: releaseTurn() needs a reservationId');
    return this.ledger.release({ reservationId, reason });
  }

  /** A combined view: money for today, workers right now. */
  status() {
    return {
      day: utcDayKey(),
      budget: this.ledger.status(),
      workers: this.leases.status(),
      limits: this.limits,
    };
  }
}

export { BudgetLedger, WorkerLeaseManager, estimateUsd, resolvePricing, utcDayKey };
