#!/usr/bin/env node
// scripts/check-subscription-econ.mjs — the subscription economics runner.
//
// Two jobs, one command:
//
//   1. METRIC. net EUR per 1,000 reachable fans per month, for every hosting
//      platform and every willingness-to-pay scenario. This is the number
//      the research loop moves: change the ladder or the platform, re-run,
//      keep or discard.
//
//   2. READINESS. What the catalogue on disk can actually hand over today,
//      per tier. A tier is a promise; this is the evidence.
//
// The metric measures RETENTION, not reach. "1,000 reachable fans" means the
// label's own audience of 1,000, so the metric says how much of each euro a
// platform leaves behind — it deliberately does NOT guess how many people
// each platform can reach, because that is unmeasurable before launch and a
// guessed reach multiplier would be a fabricated number dressed as a
// measurement. Reach is argued in prose in the plan; the fee tables are
// arithmetic.
//
// Usage: node scripts/check-subscription-econ.mjs [--platform=<id>]
//   --platform measures one named platform instead of the best eligible
//   one. The research loop uses it to price a configuration that the
//   constraint gates would otherwise exclude.
// Exit 0 when the metric has signal and the readiness census is coherent.
// Exit 1 when the metric is degenerate (the loop would be measuring noise).

import { readdirSync, existsSync, readFileSync } from 'node:fs';
import { join, extname, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  SUBSCRIPTION_TIERS,
  GRANTS,
  FREE_GRANTS,
  PLATFORMS,
  WTP_SCENARIOS,
  ONE_OFF_SALES_ROUTE,
  netEurPerThousandFans,
  ladderRevenueEur,
} from '../api/_lib/subscription-tiers.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

// ---- the catalogue census -------------------------------------------------

const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', '.vercel', '.next']);

function filesUnder(dir, filter, depth = 0) {
  const out = [];
  if (!existsSync(dir) || depth > 8) return out;
  let entries = [];
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      out.push(...filesUnder(full, filter, depth + 1));
    } else if (entry.isFile()) {
      if (!filter || filter(full)) out.push(full);
    }
  }
  return out;
}

const libraryMp3 = filesUnder(join(ROOT, 'audios'), (f) => extname(f).toLowerCase() === '.mp3');
// The repo root, minus the directories that are not the label's catalogue.
const wavMasters = filesUnder(ROOT, (f) => {
  const rel = relative(ROOT, f);
  // portfolio/portfolio-source.wav is a portfolio asset, not a track master.
  if (rel.startsWith('portfolio' + sep)) return false;
  return extname(f).toLowerCase() === '.wav';
});
const packFiles = filesUnder(join(ROOT, 'packs'));
const stills = filesUnder(join(ROOT, 'keyart'));
const artistPages = existsSync(join(ROOT, 'artists'))
  ? readdirSync(join(ROOT, 'artists')).filter((f) => f.endsWith('.html') && f !== 'index.html')
  : [];
const artistMasters = artistPages.filter((f) => {
  const html = readFileSync(join(ROOT, 'artists', f), 'utf8');
  return !html.includes('data-missing="1"');
});
const curatedTemplates = filesUnder(join(ROOT, 'marketplace', 'curated'), (f) => f.endsWith('.swr-set.json'));
const rightsDeclaration = ['docs/asset-rights.md', 'docs/media-rights.md', 'docs/asset-rights.json']
  .find((rel) => existsSync(join(ROOT, rel)));

const ASSET_COUNTS = {
  'library-mp3': libraryMp3.length,
  'artist-master': artistMasters.length,
  'wav-master': wavMasters.length,
  'pack-files': packFiles.length,
  'stills': stills.length,
  'rights-cleared': rightsDeclaration ? 1 : 0,
};

function grantReady(grantId) {
  const grant = GRANTS[grantId];
  if (!grant) return { ready: false, reason: 'unknown grant' };
  if (!grant.assetClass) return { ready: true, reason: 'a process promise' };
  const count = ASSET_COUNTS[grant.assetClass];
  return {
    ready: count > 0,
    reason: count > 0 ? count + ' ' + grant.assetClass : 'no ' + grant.assetClass + ' in the repo',
  };
}

// ---- the platform constraints ---------------------------------------------
//
// These are the gates that decide whether a platform can carry the whole
// plan Kai described: a recurring tier AND one-off track and picture sales.
// Each gate is a published fact, not a preference.

const CONSTRAINTS = [
  {
    id: 'one-off-sales',
    label: 'one-off track and picture sales without an 18+ page classification',
    test: (p) => p.oneOffSales === 'allowed',
    // Only a gate while the one-off sales have to live on the same platform
    // as the membership. Split them and the gate moves off the membership.
    applies: () => ONE_OFF_SALES_ROUTE === 'same-platform',
    why: 'Patreon: Commerce (one-time purchases) is only available to Adult/18+ creators on subscription billing.',
  },
  {
    id: 'vat',
    label: 'EU VAT handled by the platform',
    test: (p) => p.vatRemittedByPlatform === true,
    applies: () => true,
    why: 'Stripe Tax does not support Serbia as a business location for digital products, so the VAT is the label\'s job.',
  },
  {
    id: 'recurring',
    label: 'native recurring tiers',
    test: (p) => p.memberships === true,
    applies: () => true,
    why: 'The plan is a subscription, so the platform has to be able to take one.',
  },
];

const platformIds = Object.keys(PLATFORMS);
const activeGates = CONSTRAINTS.filter((c) => c.applies());
const eligible = platformIds.filter((id) => activeGates.every((c) => c.test(PLATFORMS[id])));

// --platform pins the measurement to one platform, eligible or not.
const forced = (process.argv.find((a) => a.startsWith('--platform=')) || '').split('=')[1] || '';
if (forced && !PLATFORMS[forced]) {
  console.error('unknown platform: ' + forced + ' (known: ' + platformIds.join(', ') + ')');
  process.exit(1);
}

// ---- the metric -----------------------------------------------------------

const metrics = platformIds.map((id) => ({ id, ...netEurPerThousandFans(id) }));
const eligibleMetrics = metrics.filter((m) => eligible.includes(m.id));
const ranked = [...eligibleMetrics].sort((a, b) => b.mean - a.mean);
const best = forced
  ? metrics.find((m) => m.id === forced)
  : ranked[0];

// ---- the report -----------------------------------------------------------

const eur = (n) => (n < 0 ? '-' : '') + '€' + Math.abs(n).toFixed(2);
const pad = (s, n) => String(s).padEnd(n);
const padL = (s, n) => String(s).padStart(n);

console.log('SUBSCRIPTION ECONOMICS');
console.log('');
console.log('  currency EUR · USD/EUR 1.1224 (ECB reference rate, 2026-11-05)');
console.log('  VAT 20% on 35% of subscribers — an assumption, not a measurement');
console.log('');

console.log('  Net EUR per 1,000 reachable fans per month');
console.log('  ' + pad('platform', 22) + padL('fan-heavy', 12) + padL('balanced', 12) + padL('creator-heavy', 15) + padL('mean', 10) + padL('fixed/mo', 10));
for (const m of metrics) {
  const p = PLATFORMS[m.id];
  const mark = eligible.includes(m.id) ? ' ' : '·';
  console.log(
    '  ' + mark + pad(p.label, 21) +
    padL(m.runs[0].netEur.toFixed(2), 12) +
    padL(m.runs[1].netEur.toFixed(2), 12) +
    padL(m.runs[2].netEur.toFixed(2), 15) +
    padL(m.mean.toFixed(2), 10) +
    padL(eur(p.fixedMonthlyUsd ? p.fixedMonthlyUsd / 1.1224 : 0), 10),
  );
}
console.log('  · = fails at least one constraint gate');
console.log('');

console.log('  Constraint gates');
for (const c of CONSTRAINTS) {
  const passing = platformIds.filter((id) => c.test(PLATFORMS[id]));
  const state = c.applies() ? 'gate ' : 'n/a  ';
  console.log('   ' + pad(c.id, 14) + padL(state, 6) + padL(passing.length + '/' + platformIds.length, 5) + '  ' + c.label);
}
console.log('');
console.log('  one-off sales route: ' + ONE_OFF_SALES_ROUTE);
console.log('  Eligible platforms: ' + (eligible.length ? eligible.map((id) => PLATFORMS[id].label).join(', ') : 'none'));
console.log('');

if (best) {
  const forcedNote = forced ? ' (pinned with --platform)' : '';
  if (!eligible.includes(best.id)) {
    console.log('  Measured platform: ' + PLATFORMS[best.id].label + forcedNote + ' — fails a constraint gate');
  } else {
    console.log('  Best eligible: ' + PLATFORMS[best.id].label + forcedNote);
  }
  const run = ladderRevenueEur({ platformId: best.id, scenarioId: 'balanced' });
  console.log('   ' + pad('tier', 12) + padL('price', 8) + padL('subs/1k', 10) + padL('net/sub', 10) + padL('keep', 8) + padL('revenue', 10));
  for (const row of run.byTier) {
    const tier = SUBSCRIPTION_TIERS[row.tierId];
    console.log(
      '   ' + pad(tier.name, 11) +
      padL('€' + (tier.priceMinor / 100).toFixed(2), 8) +
      padL(row.subscribers.toFixed(1), 10) +
      padL('€' + row.netPerSubscriberEur.toFixed(2), 10) +
      padL((row.takeRate * 100).toFixed(1) + '%', 8) +
      padL('€' + row.revenueEur.toFixed(2), 10),
    );
  }
  console.log('   ' + pad('fixed', 11) + padL('', 8) + padL('', 10) + padL('', 10) + padL('', 8) + padL('-' + eur(run.fixedMonthlyEur), 10));
  console.log('   net, balanced scenario: ' + eur(run.netEur));
  console.log('');
}

console.log('  READINESS — what the catalogue can hand over today');
console.log('   ' + pad('artist pages with a real master', 34) + artistMasters.length + ' / ' + artistPages.length);
console.log('   ' + pad('library MP3s', 34) + libraryMp3.length);
console.log('   ' + pad('WAV track masters', 34) + wavMasters.length);
console.log('   ' + pad('media pack files', 34) + packFiles.length);
console.log('   ' + pad('stills and key art', 34) + stills.length);
console.log('   ' + pad('curated templates (stay free)', 34) + curatedTemplates.length);
console.log('   ' + pad('asset-rights declaration', 34) + (rightsDeclaration || 'none'));
console.log('');

const tiers = Object.values(SUBSCRIPTION_TIERS).sort((a, b) => a.priceMinor - b.priceMinor);
console.log('   ' + pad('tier', 12) + pad('ready', 10) + 'blocked grants');
for (const tier of tiers) {
  const blocked = tier.grants.map((g) => ({ g, ...grantReady(g) })).filter((r) => !r.ready);
  console.log(
    '   ' + pad(tier.name, 11) +
    pad((tier.grants.length - blocked.length) + '/' + tier.grants.length, 10) +
    (blocked.length ? blocked.map((b) => b.g + ' (' + b.reason + ')').join(', ') : '—'),
  );
}
console.log('');

// ---- the deliverable metric -----------------------------------------------
//
// The economic metric assumes every tier can be sold. The catalogue cannot
// honour that yet, so the second metric counts only the revenue a tier can
// actually deliver today. A tier with one blocked grant is not sellable:
// the subscriber would be paying for something that does not exist.

const sellableTiers = tiers.filter((tier) => tier.grants.every((g) => grantReady(g).ready));

function deliverableNetEur(platformId) {
  const values = WTP_SCENARIOS.map((s) => {
    const run = ladderRevenueEur({ platformId, scenarioId: s.id, perFans: 1000 });
    const byId = new Map(run.byTier.map((r) => [r.tierId, r]));
    const revenue = sellableTiers.reduce((sum, t) => sum + (byId.get(t.id)?.revenueEur || 0), 0);
    return revenue - run.fixedMonthlyEur;
  });
  return {
    mean: values.reduce((a, b) => a + b, 0) / values.length,
    min: Math.min(...values),
    max: Math.max(...values),
  };
}

const deliverable = best ? deliverableNetEur(best.id) : null;
if (deliverable) {
  const share = best.mean > 0 ? deliverable.mean / best.mean : 0;
  console.log('  Sellable tiers today: ' + (sellableTiers.length ? sellableTiers.map((t) => t.name).join(', ') : 'none'));
  console.log('  Deliverable share of the ladder: ' + (share * 100).toFixed(1) + '%');
  console.log('METRIC-DELIVERABLE netEurPerThousandFans=' + deliverable.mean.toFixed(2) + ' platform=' + best.id);
  console.log('');
}

console.log('METRIC netEurPerThousandFans=' + (best ? best.mean.toFixed(2) : '0.00') + ' platform=' + (best ? best.id : 'none'));
console.log('');

// ---- the loop's own health -------------------------------------------------
//
// A research loop on a metric that never moves is a loop that burns budget
// and ships nothing. Fail loudly instead.

const problems = [];
if (!best) problems.push('no platform passes the constraint gates');
if (best && !(best.max - best.min > 1)) problems.push('the willingness-to-pay scenarios do not disagree — the metric has no variance');
const eligibleSpread = eligibleMetrics.length > 1
  ? Math.max(...eligibleMetrics.map((m) => m.mean)) - Math.min(...eligibleMetrics.map((m) => m.mean))
  : 0;
if (eligibleSpread < 1) problems.push('the eligible platforms do not differ — the metric cannot rank them');

if (problems.length) {
  console.log('SUBSCRIPTION ECON: the metric is degenerate');
  for (const p of problems) console.log('  - ' + p);
  process.exit(1);
}
console.log('SUBSCRIPTION ECON: the metric has signal');
