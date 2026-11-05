// api/_lib/subscription-tiers.js — the catalogue subscription ladder.
//
// WHAT THIS FILE IS
// -----------------
// One source of truth for three things that must never drift apart:
//   1. the tier ladder (price, and what each tier grants),
//   2. what each hosting platform costs (platform fee, processing, VAT),
//   3. the net economics of a subscription month, derived from 1 and 2.
//
// WHY IT LIVES HERE
// -----------------
// The ladder is a money surface, so it sits server-side next to
// api/_lib/pt-keys.js (the PT licence tiers) and is never mirrored in the
// client. The browser renders what site-map.json says; this file decides
// what is actually sellable and what it nets.
//
// NAMING
// ------
// SUBSCRIPTION_TIERS, not MEMBERSHIP_TIERS: api/_lib/ids.js already owns
// MEMBERSHIP_TIERS = ['free','creator'] — the account tier a signed-in user
// holds, and it is read-only from the client. One repo, two meanings of
// "membership" is a bug waiting to happen.
//
// NO DEPENDENCIES
// ---------------
// Deliberately pure: no db.js, no env reads. The economics script and the
// unit gate import it directly, and an API handler can import it without
// dragging the data layer in.
//
// WHAT THIS FILE DOES NOT KNOW
// ----------------------------
// Whether a grant is actually deliverable today. That is a property of the
// catalogue on disk, and it is measured by scripts/check-subscription-econ.mjs
// — not asserted here. This file owns the PROMISE; the script owns the
// EVIDENCE. What it does carry is the grant -> asset-class mapping, because
// which file proves a grant is a product decision, not a measurement.

export const SUBSCRIPTION_CURRENCY = 'EUR';

// ECB reference rate, 2026-11-05 (data-api.ecb.europa.eu, EXR/D.USD.EUR.SP00.A).
// Every USD-denominated platform fee is converted at this rate so the whole
// ladder can be priced in the currency the rest of the store already uses
// (site-map.json, PT_TIERS, api/checkout/index.js are all EUR).
export const USD_PER_EUR = 1.1224;

// VAT on electronically supplied digital services is due in the CUSTOMER's
// member state, so a fan base spread across the EU pays a blended rate.
// ASSUMPTION — replace with the real mix once there are subscribers.
export const ASSUMED_VAT_RATE = 0.20;

// The share of subscribers living in a VAT area. ASSUMPTION.
export const ASSUMED_EU_FAN_SHARE = 0.35;

// Grants that stay free, whatever the ladder says. The 2026-10-21 store
// announcement promises "the free templates in the marketplace stay free",
// and a public promise is not worth a few euros of membership upside.
export const FREE_GRANTS = ['curated-templates'];

// The catalogue a tier can hand over. `assetClass` names the thing on disk
// that proves the grant; scripts/check-subscription-econ.mjs counts it.
export const GRANTS = {
  'audio-library-mp3': {
    label: 'The full audio library, as MP3',
    assetClass: 'library-mp3',
    note: 'The house sound-tones in /audios/ — the whole thing is usable today.',
  },
  'artist-releases-mp3': {
    label: 'Every label release, as MP3',
    assetClass: 'artist-master',
    note: 'Zero of the six artist pages point at a real master; they still play shared demo audio.',
  },
  'tracks-wav': {
    label: 'Lossless WAV masters',
    assetClass: 'wav-master',
    note: 'The repo holds one .wav and it is a portfolio asset, not a track.',
  },
  'media-packs': {
    label: 'The complete media packs',
    assetClass: 'pack-files',
    note: 'Back catalogue only. The current pack stays a one-off sale, which is also how Bandcamp scopes a subscription.',
  },
  'stills': {
    label: 'Key art and stills',
    assetClass: 'stills',
  },
  'early-access': {
    label: 'Every release, seven days early',
    assetClass: null,
    note: 'A process promise, not an asset.',
  },
  'commercial-licence': {
    label: 'Commercial use of the visual library',
    assetClass: 'rights-cleared',
    note: 'Blocked by D3 in persona-library.html: the source is MIT, the bundled footage and images are not.',
  },
};

export const SUBSCRIPTION_TIERS = {
  listener: {
    id: 'listener',
    name: 'Listener',
    priceMinor: 300,
    grants: ['audio-library-mp3', 'early-access'],
    blurb: 'The full audio library, as MP3, and every release seven days early.',
  },
  collector: {
    id: 'collector',
    name: 'Collector',
    priceMinor: 500,
    grants: ['audio-library-mp3', 'early-access', 'media-packs'],
    blurb: 'The listener catalogue, plus the media packs.',
  },
  studio: {
    id: 'studio',
    name: 'Studio',
    priceMinor: 800,
    grants: ['audio-library-mp3', 'early-access', 'media-packs', 'stills'],
    blurb: 'The listener catalogue, plus the media packs and the stills.',
  },
  insider: {
    id: 'insider',
    name: 'Insider',
    priceMinor: 1200,
    grants: ['audio-library-mp3', 'early-access', 'media-packs', 'stills', 'artist-releases-mp3'],
    blurb: 'Everything above, plus every label release the day it lands.',
  },
  producer: {
    id: 'producer',
    name: 'Producer',
    priceMinor: 2000,
    grants: [
      'audio-library-mp3',
      'early-access',
      'media-packs',
      'stills',
      'artist-releases-mp3',
      'tracks-wav',
      'commercial-licence',
    ],
    blurb: 'Everything above, plus lossless masters and commercial rights on the visual library.',
  },
};

// Where the ladder can run, and what each platform costs.
//
// feeBase says what a percentage is charged on:
//   'gross'  — the price the fan pays (VAT-inclusive)
//   'payout' — what the platform actually hands over
// The distinction is worth cents: a marketplace takes its percentage from
// the gross and its processing fee from the payout it sends you.
export const PLATFORMS = {
  gumroad: {
    id: 'gumroad',
    label: 'Gumroad',
    fixedMonthlyUsd: 0,
    platformFee: { pct: 0.10, base: 'gross' },
    processorFee: { pct: 0, flatUsd: 0.50, base: 'gross' },
    vatRemittedByPlatform: true,
    oneOffSales: 'allowed',
    memberships: true,
    discovery: 'Discover (30% of revenue when a sale comes through it)',
    source: {
      url: 'https://gumroad.com/pricing',
      checkedOn: '2026-11-05',
      note: '10% + 50¢ direct; Merchant of Record since 2025-01-01, so sales tax and EU VAT are handled. $0/month.',
    },
  },
  patreon: {
    id: 'patreon',
    label: 'Patreon',
    fixedMonthlyUsd: 0,
    platformFee: { pct: 0.10, base: 'gross' },
    processorFee: { pct: 0.029, flatUsd: 0.30, base: 'payout' },
    vatRemittedByPlatform: true,
    oneOffSales: 'adult-18-plus',
    memberships: true,
    discovery: 'Creator feed and page discovery',
    source: {
      url: 'https://support.patreon.com/hc/en-us/articles/11111747095181-Creator-fees',
      checkedOn: '2026-11-05',
      note: 'Pages published after 2025-08-04 pay the standard 10% plus payout processing. The 5% + $0.10 micropayment rate is legacy-only and does not apply to a new page.',
    },
  },
  bandcamp: {
    id: 'bandcamp',
    label: 'Bandcamp',
    fixedMonthlyUsd: 20,
    platformFee: { pct: 0.15, base: 'gross' },
    processorFee: { pct: 0.029, flatUsd: 0.30, base: 'payout' },
    vatRemittedByPlatform: true,
    oneOffSales: 'allowed',
    memberships: true,
    discovery: 'Bandcamp audience; subscribers get the back catalogue automatically',
    source: {
      url: 'https://bandcamp.com/subscriptions',
      checkedOn: '2026-11-05',
      note: '15% of subscription revenue (10% above $5k/yr) plus 2.9% + 30¢ processing. A label account costs $20/month up to 15 artists.',
    },
  },
  stripe: {
    id: 'stripe',
    label: 'Stripe (SWR-native)',
    fixedMonthlyUsd: 0,
    platformFee: { pct: 0, base: 'gross' },
    processorFee: { pct: 0.035, flatEur: 0.25, base: 'gross' },
    vatRemittedByPlatform: false,
    oneOffSales: 'allowed',
    memberships: true,
    discovery: 'None of its own — the audience is whatever the site already has',
    source: {
      url: 'https://stripe.com/en-ie/pricing',
      checkedOn: '2026-11-05',
      note: '2.8% + €0.25 standard EEA card rate, plus 0.7% for Billing on PAYG. The rate is the conservative one: the account country is unconfirmed, and a domestic rate would be 1.5% + €0.25. Stripe Tax does not support Serbia as a business location for digital products.',
    },
  },
};

// Willingness to pay, as scenarios rather than a point estimate.
//
// There is no measured fan WTP in this repo. What the repo does have is a
// measured TOOL WTP: $8-12/month for unlimited exports, from a Van
// Westendorp PSM over 312 indie creators (persona-library.html, May 2026).
// That is a different product — a subscription to a music catalogue is not a
// subscription to a render farm — so it bounds the ladder from above rather
// than setting it.
//
// The three scenarios below bracket the fan case. The headline metric is the
// mean across them, and every report prints all three, because a ladder that
// only wins under one assumption is not a decision.
//
// Where the one-off sales (an individual track, a picture) have to live.
//
// 'same-platform'  — the membership and the one-off sales share one platform.
//                    Patreon drops out: Commerce is only available to
//                    Adult/18+ creators on subscription billing, and an
//                    18+ classification on a label's music page is a brand
//                    decision, not a default.
//
// 'separate-platform' — the membership runs where the fans are and the
//                    one-off sales run on Gumroad, which already sells the
//                    label's packs and handles the tax. Two platforms means
//                    two member databases to reconcile; the metric says
//                    what it is worth, the plan says what it costs.
export const ONE_OFF_SALES_ROUTE = 'same-platform';

// A fan with a willingness to pay of w buys the HIGHEST tier they can
// afford, so the ladder's revenue depends on where the tiers sit relative
// to the distribution, not on any single price.
export const WTP_SCENARIOS = [
  {
    id: 'fan-heavy',
    label: 'Fans pay little',
    medianMonthlyEur: 4.0,
    sigma: 0.55,
    note: 'Listeners who want the tracks, not the tooling.',
  },
  {
    id: 'balanced',
    label: 'Balanced',
    medianMonthlyEur: 6.0,
    sigma: 0.55,
    note: 'The middle case between the fan and the creator.',
  },
  {
    id: 'creator-heavy',
    label: 'Creators pay for tooling',
    medianMonthlyEur: 10.0,
    sigma: 0.55,
    note: 'The repo\'s measured $8-12 indie band, in euros.',
  },
];

// Abramowitz & Stegun 26.2.17 — the standard normal CDF, good to 7e-8.
// No dependency, and it is only ever asked for four numbers.
function normalCdf(x) {
  const t = 1 / (1 + 0.2316419 * Math.abs(x));
  const d = 0.3989422804014327 * Math.exp(-(x * x) / 2);
  const p = d * t * (0.319381530 + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))));
  return x > 0 ? 1 - p : p;
}

export function eurMinorToUsdMinor(eurMinor) {
  return Math.round((eurMinor / 100) * USD_PER_EUR * 100);
}

export function usdToEur(usd) {
  return usd / USD_PER_EUR;
}

/**
 * What one subscription month actually leaves the label, after the platform
 * fee, the payment processing and the VAT that has to be remitted.
 *
 * VAT is revenue the label never owns: it is collected from the fan and
 * handed to the tax authority, so it comes out of the top and is never
 * counted as money earned.
 */
export function netMonthlyEur({
  priceMinor,
  platformId,
  vatRate = ASSUMED_VAT_RATE,
  euShare = ASSUMED_EU_FAN_SHARE,
}) {
  const platform = PLATFORMS[platformId];
  if (!platform) throw new TypeError(`unknown platform: ${platformId}`);
  if (!Number.isInteger(priceMinor) || priceMinor <= 0) {
    throw new TypeError(`price must be a positive integer of minor units: ${priceMinor}`);
  }

  const gross = priceMinor / 100;
  const vat = gross * vatRate * euShare;
  const revenue = gross - vat;

  const platformFee = platform.platformFee.pct * (platform.platformFee.base === 'gross' ? gross : revenue);
  const payoutBase = platform.platformFee.base === 'gross' ? revenue - platformFee : revenue;

  const processorBase = platform.processorFee.base === 'gross' ? gross : payoutBase;
  const processorFee =
    platform.processorFee.pct * processorBase +
    (platform.processorFee.flatUsd ? usdToEur(platform.processorFee.flatUsd) : 0) +
    (platform.processorFee.flatEur || 0);

  const net = payoutBase - processorFee;
  const fixedMonthlyEur = usdToEur(platform.fixedMonthlyUsd);

  return {
    gross,
    vat,
    revenue,
    platformFee,
    processorFee,
    net,
    fixedMonthlyEur,
    takeRate: net / gross,
  };
}

/**
 * The ladder's revenue against one willingness-to-pay scenario.
 *
 * `perFans` is a reachable fan base, not a subscriber count: the result is
 * "what would 1,000 reachable fans be worth per month".
 */
export function ladderRevenueEur({ platformId, scenarioId, perFans = 1000 }) {
  const scenario = WTP_SCENARIOS.find((s) => s.id === scenarioId);
  if (!scenario) throw new TypeError(`unknown wtp scenario: ${scenarioId}`);

  const tiers = Object.values(SUBSCRIPTION_TIERS).sort((a, b) => a.priceMinor - b.priceMinor);
  const mu = Math.log(scenario.medianMonthlyEur);

  const byTier = tiers.map((tier, i) => {
    const price = tier.priceMinor / 100;
    const lower = normalCdf((Math.log(price) - mu) / scenario.sigma);
    const upper = i + 1 < tiers.length
      ? normalCdf((Math.log(tiers[i + 1].priceMinor / 100) - mu) / scenario.sigma)
      : 1;
    // A fan buys the highest tier they can afford, so tier i serves the
    // band [price_i, price_{i+1}).
    const share = Math.max(0, upper - lower);
    const econ = netMonthlyEur({ priceMinor: tier.priceMinor, platformId });
    return {
      tierId: tier.id,
      name: tier.name,
      priceMinor: tier.priceMinor,
      subscribers: perFans * share,
      netPerSubscriberEur: econ.net,
      takeRate: econ.takeRate,
      revenueEur: perFans * share * econ.net,
    };
  });

  const revenueEur = byTier.reduce((sum, row) => sum + row.revenueEur, 0);
  const fixedMonthlyEur = usdToEur(PLATFORMS[platformId].fixedMonthlyUsd);
  const entry = tiers[0];

  return {
    scenarioId: scenario.id,
    platformId,
    perFans,
    byTier,
    revenueEur,
    fixedMonthlyEur,
    netEur: revenueEur - fixedMonthlyEur,
    // Fans who can afford the entry tier at all.
    conversion: 1 - normalCdf((Math.log(entry.priceMinor / 100) - mu) / scenario.sigma),
    subscribers: byTier.reduce((sum, row) => sum + row.subscribers, 0),
  };
}

/**
 * The headline metric: expected net euros per 1,000 reachable fans per
 * month, averaged across the willingness-to-pay scenarios.
 *
 * This is the number the research loop moves. It is deliberately per fan
 * rather than per subscriber, so a platform that reaches more people and a
 * platform that keeps more per subscriber are traded off inside one number.
 */
export function netEurPerThousandFans(platformId, perFans = 1000) {
  const runs = WTP_SCENARIOS.map((s) => ladderRevenueEur({ platformId, scenarioId: s.id, perFans }));
  const mean = runs.reduce((sum, r) => sum + r.netEur, 0) / runs.length;
  return {
    platformId,
    mean,
    min: Math.min(...runs.map((r) => r.netEur)),
    max: Math.max(...runs.map((r) => r.netEur)),
    runs,
  };
}

/**
 * How many subscribers a platform's fixed monthly fee needs before it pays
 * for itself, at the entry tier.
 */
export function breakEvenSubscribers(platformId) {
  const platform = PLATFORMS[platformId];
  const fixed = usdToEur(platform.fixedMonthlyUsd);
  if (fixed <= 0) return 0;
  const entry = Object.values(SUBSCRIPTION_TIERS).sort((a, b) => a.priceMinor - b.priceMinor)[0];
  const net = netMonthlyEur({ priceMinor: entry.priceMinor, platformId }).net;
  if (net <= 0) return Infinity;
  return Math.ceil(fixed / net);
}
