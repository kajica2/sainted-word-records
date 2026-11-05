// scripts/check-subscription-tiers-unit.mjs — unit coverage for the
// catalogue subscription ladder (api/_lib/subscription-tiers.js).
//
// Contract under test:
//   - the ladder is sorted, and every tier is a strict superset of the one
//     below it (a subscriber never loses something by paying more)
//   - the free marketplace templates stay free: no tier grants them
//   - commercial rights are granted by the top tier only, so a fan is
//     never sold rights the catalogue does not have
//   - the fee arithmetic matches the published platform fee tables, to the
//     cent, at the entry tier
//   - VAT is remitted, never counted as revenue
//   - every platform has a citable source and a date it was checked
//   - the metric has signal: the willingness-to-pay scenarios disagree, so
//     the research loop is measuring something that can move
//
// No dependencies. Runs offline.

import {
  SUBSCRIPTION_TIERS,
  GRANTS,
  FREE_GRANTS,
  PLATFORMS,
  WTP_SCENARIOS,
  USD_PER_EUR,
  netMonthlyEur,
  netEurPerThousandFans,
  ladderRevenueEur,
  breakEvenSubscribers,
  eurMinorToUsdMinor,
} from '../api/_lib/subscription-tiers.js';

const results = [];

async function check(name, fn) {
  let ok = false;
  let detail = '';
  try {
    const r = await fn();
    ok = r === true;
    detail = typeof r === 'string' ? r : '';
  } catch (e) {
    detail = e.message + (e.stack ? '\n' + e.stack.split('\n').slice(1, 3).join('\n') : '');
  }
  results.push({ name, ok, detail });
  console.log((ok ? '  PASS  ' : '  FAIL  ') + name + (detail ? ' — ' + detail : ''));
}

const tiers = Object.values(SUBSCRIPTION_TIERS).sort((a, b) => a.priceMinor - b.priceMinor);
const PLATFORM_IDS = Object.keys(PLATFORMS);

await check('the ladder is sorted and every price is a positive integer of minor units', () => {
  for (let i = 1; i < tiers.length; i++) {
    if (!(tiers[i].priceMinor > tiers[i - 1].priceMinor)) {
      return 'tier ' + tiers[i].id + ' (' + tiers[i].priceMinor + ') does not cost more than ' + tiers[i - 1].id;
    }
  }
  for (const t of tiers) {
    if (!Number.isInteger(t.priceMinor) || t.priceMinor <= 0) return 'bad price on ' + t.id;
  }
  return true;
});

await check('every tier grants everything the tier below it grants', () => {
  for (let i = 1; i < tiers.length; i++) {
    const higher = new Set(tiers[i].grants);
    const missing = tiers[i - 1].grants.filter((g) => !higher.has(g));
    if (missing.length) return tiers[i].id + ' does not include ' + missing.join(', ') + ' from ' + tiers[i - 1].id;
  }
  return true;
});

await check('every granted id exists in the grant catalogue', () => {
  for (const t of tiers) {
    for (const g of t.grants) {
      if (!GRANTS[g]) return t.id + ' grants unknown grant ' + g;
    }
  }
  return true;
});

await check('the free marketplace templates are not gated behind a tier', () => {
  for (const t of tiers) {
    for (const g of FREE_GRANTS) {
      if (t.grants.includes(g)) return t.id + ' grants ' + g + ', which the store announcement promises stays free';
    }
  }
  return true;
});

await check('commercial rights are granted by the top tier only', () => {
  const granting = tiers.filter((t) => t.grants.includes('commercial-licence'));
  if (granting.length !== 1) return granting.length + ' tiers grant commercial rights';
  if (granting[0].id !== tiers[tiers.length - 1].id) return 'rights are granted by ' + granting[0].id + ', not the top tier';
  if (GRANTS['commercial-licence'].assetClass !== 'rights-cleared') return 'the licence grant does not map to the rights asset class';
  return true;
});

await check('every platform fee has a citable source and a date it was checked', () => {
  for (const id of PLATFORM_IDS) {
    const p = PLATFORMS[id];
    if (!p.source || !p.source.url) return id + ' has no source url';
    if (!/^https:\/\//.test(p.source.url)) return id + ' has a malformed source url';
    if (!/^\d{4}-\d{2}-\d{2}$/.test(p.source.checkedOn)) return id + ' has no checkedOn date';
  }
  return true;
});

await check('an unknown platform is rejected', () => {
  let threw = false;
  try {
    netMonthlyEur({ priceMinor: 300, platformId: 'myspace' });
  } catch (e) {
    threw = e instanceof TypeError;
  }
  return threw === true || 'the unknown platform did not raise a TypeError';
});

await check('a non-integer or non-positive price is rejected', () => {
  for (const price of [0, -100, 3.5, '300']) {
    let threw = false;
    try {
      netMonthlyEur({ priceMinor: price, platformId: 'gumroad' });
    } catch (e) {
      threw = e instanceof TypeError;
    }
    if (!threw) return 'price ' + JSON.stringify(price) + ' was accepted';
  }
  return true;
});

await check('VAT comes out of the top and is never counted as revenue', () => {
  for (const id of PLATFORM_IDS) {
    for (const t of tiers) {
      const e = netMonthlyEur({ priceMinor: t.priceMinor, platformId: id });
      if (!(e.net <= e.revenue && e.revenue <= e.gross)) {
        return id + '/' + t.id + ': net ' + e.net + ' revenue ' + e.revenue + ' gross ' + e.gross;
      }
      if (!(e.vat > 0)) return id + '/' + t.id + ' booked no VAT at all';
    }
  }
  return true;
});

await check('the take rate is a sane fraction of the gross on every tier', () => {
  for (const id of PLATFORM_IDS) {
    for (const t of tiers) {
      const e = netMonthlyEur({ priceMinor: t.priceMinor, platformId: id });
      if (!(e.takeRate > 0 && e.takeRate < 1)) return id + '/' + t.id + ' take rate is ' + e.takeRate;
    }
  }
  return true;
});

await check('the entry tier keeps more than half the gross on every platform', () => {
  for (const id of PLATFORM_IDS) {
    const e = netMonthlyEur({ priceMinor: tiers[0].priceMinor, platformId: id });
    if (!(e.takeRate > 0.5)) return id + ' keeps only ' + (e.takeRate * 100).toFixed(1) + '% of the entry price';
  }
  return true;
});

await check('the Patreon fee arithmetic matches the published table to the cent', () => {
  // 10% platform fee on the gross, 2.9% + $0.30 payout processing, VAT out
  // of the top. The numbers below are the hand arithmetic, not a re-run of
  // the function under test.
  const expected = 3 - 0.21 - 0.30 - (0.029 * 2.49 + 0.30 / USD_PER_EUR);
  const e = netMonthlyEur({ priceMinor: 300, platformId: 'patreon' });
  if (Math.abs(e.net - expected) > 1e-9) return 'net ' + e.net + ' != expected ' + expected;
  if (Math.abs(e.net - 2.1505056) > 1e-6) return 'net ' + e.net + ' != the locked regression value 2.1505056';
  return true;
});

await check('the Stripe fee arithmetic matches the published table to the cent', () => {
  const expected = 3 - 0.21 - (0.035 * 3 + 0.25);
  const e = netMonthlyEur({ priceMinor: 300, platformId: 'stripe' });
  if (Math.abs(e.net - expected) > 1e-9) return 'net ' + e.net + ' != expected ' + expected;
  if (Math.abs(e.net - 2.435) > 1e-9) return 'net ' + e.net + ' != 2.435';
  return true;
});

await check('the Bandcamp label fee is separated from the per-subscriber fee', () => {
  const e = netMonthlyEur({ priceMinor: 300, platformId: 'bandcamp' });
  if (Math.abs(e.fixedMonthlyEur - 20 / USD_PER_EUR) > 1e-9) return 'fixed ' + e.fixedMonthlyEur;
  const run = ladderRevenueEur({ platformId: 'bandcamp', scenarioId: 'balanced' });
  if (Math.abs(run.netEur - (run.revenueEur - run.fixedMonthlyEur)) > 1e-9) return 'the fixed fee was not deducted once';
  return true;
});

await check('a fan buys exactly one tier, so the subscriber shares never exceed one', () => {
  for (const id of PLATFORM_IDS) {
    for (const s of WTP_SCENARIOS) {
      const run = ladderRevenueEur({ platformId: id, scenarioId: s.id, perFans: 1000 });
      const total = run.byTier.reduce((sum, row) => sum + row.subscribers, 0);
      if (total > 1000 + 1e-9) return id + '/' + s.id + ' sold ' + total + ' of 1,000 fans';
      for (const row of run.byTier) {
        if (row.subscribers < -1e-9) return id + '/' + s.id + ' has a negative band';
      }
    }
  }
  return true;
});

await check('a fan who cannot afford the entry tier never becomes a subscriber', () => {
  const run = ladderRevenueEur({ platformId: 'gumroad', scenarioId: 'fan-heavy', perFans: 1000 });
  const cheapest = run.byTier[0];
  // fan-heavy: median EUR 4, sigma 0.55 -> the entry tier at EUR 3 sits
  // below the median, so the entry band must be a strict majority.
  if (!(cheapest.subscribers > 500)) return 'only ' + cheapest.subscribers + ' of 1,000 fans bought the entry tier';
  if (!(run.conversion > 0 && run.conversion <= 1)) return 'conversion is ' + run.conversion;
  return true;
});

await check('break-even only bites where there is a fixed monthly fee', () => {
  if (breakEvenSubscribers('gumroad') !== 0) return 'gumroad has no fixed fee';
  if (breakEvenSubscribers('stripe') !== 0) return 'stripe has no fixed fee';
  const be = breakEvenSubscribers('bandcamp');
  if (!(be > 0 && Number.isFinite(be))) return 'bandcamp break-even is ' + be;
  const entry = netMonthlyEur({ priceMinor: tiers[0].priceMinor, platformId: 'bandcamp' });
  const expected = Math.ceil((20 / USD_PER_EUR) / entry.net);
  if (be !== expected) return 'break-even ' + be + ' != ' + expected;
  return true;
});

await check('the euro to dollar conversion is the published ECB rate', () => {
  if (eurMinorToUsdMinor(300) !== 337) return 'EUR 3.00 converted to ' + eurMinorToUsdMinor(300) + ' cents';
  if (eurMinorToUsdMinor(100) !== 112) return 'EUR 1.00 converted to ' + eurMinorToUsdMinor(100) + ' cents';
  return true;
});

await check('the metric has signal: the willingness-to-pay scenarios disagree', () => {
  const run = netEurPerThousandFans('gumroad');
  if (run.max - run.min < 1) return 'the scenarios only differ by ' + (run.max - run.min) + ' EUR';
  if (!(run.mean > 0)) return 'the mean metric is ' + run.mean;
  const platforms = PLATFORM_IDS.map((id) => netEurPerThousandFans(id).mean);
  const spread = Math.max(...platforms) - Math.min(...platforms);
  if (spread < 1) return 'the platforms only differ by ' + spread + ' EUR';
  return true;
});

const failed = results.filter((r) => !r.ok);
console.log('');
if (failed.length) {
  console.log(`SUBSCRIPTION TIERS UNIT: ${failed.length} of ${results.length} checks FAILED`);
  process.exit(1);
}
console.log(`SUBSCRIPTION TIERS UNIT: all ${results.length} checks passed`);
