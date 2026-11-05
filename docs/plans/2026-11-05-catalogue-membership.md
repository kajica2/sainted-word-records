# Catalogue membership — 2026-11-05

## Problem

SWR needs a membership on the label's catalogue: a $3 tier that opens the
whole thing, higher tiers on top, and one-off sales of individual tracks and
pictures alongside it.

Two things are true at once and they pull in opposite directions:

- The repo has **no recurring billing anywhere**. Both checkout paths
  (`api/checkout/index.js`, `api/pt/checkout.js`) use `mode: 'payment'`,
  and `api/webhooks/stripe.js` handles no subscription or invoice events.
- The repo has **almost no catalogue to sell**. All six artist pages carry
  `data-missing="1"` and point at shared demo audio; there is one `.wav` in
  the tree and it is a portfolio asset. What exists and is real: 30 library
  MP3s, 582 media-pack files, 58 stills, 31 curated templates.

So the question is not "how do we take a subscription payment". It is what
the subscription is, what it is worth, which platform carries it, and what
has to be true before it can be sold at all.

This plan answers those four questions and implements the first slice of the
answer. It is a research document as much as an engineering one: the
economics were measured, not asserted.

## The answer

### The ladder

Five tiers, priced in EUR to match the rest of the store
(`site-map.json`, `PT_TIERS`, `api/checkout/index.js` are all EUR).
$3 is €2.67 at the ECB rate of 1.1224 on 2026-11-05; the ladder starts at
**€3.00**, which is €3.37, and the entry tier exists to be reachable rather
than to be profitable.

| Tier | Price | What it opens | Deliverable today |
| --- | --- | --- | --- |
| Listener | €3.00 | The full audio library as MP3, every release seven days early | yes |
| Collector | €5.00 | + the complete media packs | yes |
| Studio | €8.00 | + the stills and key art | yes |
| Insider | €12.00 | + every label release, the day it lands | no — no artist masters |
| Producer | €20.00 | + lossless WAV masters, + commercial rights on the visual library | no — no masters, no rights position |

The ladder is nested: every tier grants everything the tier below it grants.
That is enforced by `scripts/check-subscription-tiers-unit.mjs`, not by
convention.

### What the tiers deliberately do not do

- **The marketplace templates stay free.** The 2026-10-21 store announcement
  promises it, and a public promise is not worth a few euros of membership
  upside. The membership grants the *media packs* and the *stills*, which
  are not the templates.
- **The current pack stays a one-off sale.** The membership covers the back
  catalogue; the newest pack is still €25 on its own. This is also how
  Bandcamp scopes a subscription, and it is what keeps the one-off sale
  worth having.
- **No tier grants commercial rights before there is a rights position.**
  `persona-library.html` D3 is explicit: the source is MIT, the bundled
  footage and images are not. The grant exists in the ladder so the top
  tier has something to sell later, and it maps to an asset class
  (`rights-cleared`) that is empty until D3 is closed. The unit gate
  asserts that no tier but the top one grants it.

### One-off sales

Individual tracks and pictures sell on the same Gumroad account, at prices
above the membership's monthly rate — a single track at less than €3 would
be cheaper than a month of membership, and the subscription would have no
reason to exist. Proposed anchors, to be confirmed rather than assumed:

- one track, personal use — €4
- one still or key art — €9
- the media pack bundle — €25 (already live)

Today only the last two are sellable: there are no masters to sell singly.
The `api/catalogue/` ledger already models exactly this shape
(`CATALOGUE_TYPES = ['song','video','pack']`, `MEDIA_KINDS` covers audio and
image), and `api/kits/` already resolves a bundle to one `.zip` — so the
one-off catalogue is a data problem, not a new subsystem.

### The platform

**Gumroad, for both the membership and the one-off sales.** It is already
the store (`https://kaidjuric.gumroad.com` in `site-map.json`), it is a
merchant of record since 2025-01-01 so EU VAT is handled rather than
owed, it supports memberships natively, it costs $0/month, and it keeps
68–81% depending on tier.

The three alternatives and why they are not the answer yet:

- **Patreon** — the best fan feed for a label that releases music, and it
  edges the metric by 0.27% (€4,501 vs €4,489 per 1,000 fans). But
  Commerce — one-time purchases — is only available to Adult/18+ creators
  on subscription billing, so selling tracks and pictures from Patreon
  means classifying the page 18+. That is a brand decision, not a default.
  A page published after 2025-08-04 also pays the standard 10% platform
  fee, not the legacy micropayment rate.
- **Bandcamp** — the closest native fit for "share all the tracks":
  subscribers get the back catalogue automatically. But 15% of subscription
  revenue plus a $20/month label account. It needs about 9 subscribers to
  cover that fee, which is fine, and it still nets less than Gumroad
  (€4,199 vs €4,489).
- **Stripe, SWR-native** — the best margin by a wide margin (€5,039 vs
  €4,489 per 1,000 fans, +12%) and it keeps the customer relationship on
  Kai's own domain. It is a build, not a switch: subscription mode does not
  exist, the webhook handles no subscription events, Stripe Tax does not
  support Serbia as a business location for digital products so EU VAT
  would be Kai's problem through the non-Union OSS scheme, and it has no
  discovery of its own. Worth revisiting once the catalogue is real.

## The measurement

`scripts/check-subscription-econ.mjs` prints two numbers.

**METRIC** — net EUR per 1,000 reachable fans per month, averaged across
three willingness-to-pay scenarios (median €4, €6, €10; lognormal,
σ 0.55). A fan buys the highest tier they can afford, so the ladder's
revenue depends on where the tiers sit relative to the distribution, not
on any single price.

| Platform | fan-heavy | balanced | creator-heavy | mean | fixed/mo |
| --- | --- | --- | --- | --- | --- |
| Gumroad | 2,344.53 | 4,065.57 | 7,058.24 | **4,489.45** | €0 |
| Patreon | 2,392.15 | 4,095.79 | 7,016.46 | 4,501.46 | €0 |
| Bandcamp | 2,218.96 | 3,816.80 | 6,560.09 | 4,198.62 | €17.82 |
| Stripe (SWR-native) | 2,689.28 | 4,590.41 | 7,838.06 | 5,039.25 | €0 |

**METRIC-DELIVERABLE** — the same number, counting only revenue a tier can
actually honour today: **2,648.66**, or **59.0%** of the ladder.

The gap between those two numbers is the real finding: **41% of the modelled
membership revenue depends on assets the repo does not have.** That is a
content problem, not a code problem, and it is why this plan stops at the
model.

### What the metric does not measure

It measures **retention**, not reach. "1,000 reachable fans" means the
label's own audience of 1,000, so the metric says how much of each euro a
platform leaves behind. It does not guess how many people each platform
can reach, because that is unmeasurable before launch and a guessed reach
multiplier would be a fabricated number wearing a measurement's clothes.
Reach is argued in prose above.

The willingness-to-pay scenarios are assumptions, not measurements. The one
measured willingness to pay in the repo is a *tool* willingness to pay —
$8–12/month for unlimited exports, from a Van Westendorp PSM over 312
indie creators (`persona-library.html`, May 2026). A subscription to a
music catalogue is not a subscription to a render farm, so that number
bounds the ladder from above rather than setting it.

## The research log

The loop ran seven experiments on the metric above. The journal is
committed next to this plan
(`2026-11-05-catalogue-membership-results.tsv`); the readable version:

| # | Experiment | Metric | Kept |
| --- | --- | --- | --- |
| 0 | baseline: three tiers at €3 / €8 / €20, Gumroad | 3,625.80 | — |
| 1 | one tier at €3 with every grant in it | 1,759.28 | no |
| 2 | a €5 tier between the library and the studio | 4,072.22 | **yes** (+12.3%) |
| 3 | split the one-off sales onto Gumroad, membership on Patreon | 4,096.34 | no (+0.27%) |
| 4 | raise the entry tier to €5, drop the €3 floor | 3,586.38 | no (−11.9%) |
| 5 | split the release tier out at €12 | 4,489.45 | **yes** (+10.3%) |
| 6 | price the release tier at €10 instead of €12 | 4,406.75 | no (−1.8%) |
| 7 | drop the €20 tier | 4,224.29 | no (−5.9%) |

Three findings worth keeping:

1. **A single price halves the revenue.** Experiment 1 is Kai's first
   instinct — one €3 tier with everything in it — and it yields 1,759
   against 4,489. A ladder is not a pricing nicety; it is most of the
   value.
2. **The €3 floor earns its keep by being reachable.** Raising the entry to
   €5 costs 11.9%. The entry tier is not a revenue decision, it is an
   audience decision, and it should be priced to be bought.
3. **Splitting the platforms is not worth it.** Moving the one-off sales to
   Gumroad so the membership can sit on Patreon is worth 0.27%. The
   ordering does not flip under a different VAT assumption (at 25% instead
   of 20%, Patreon is ahead by 0.34%), so the edge is real but tiny — and
   it costs a second member database to reconcile. One platform wins.

A price sweep on the €12 tier (€10 through €18) confirms €12 is a local
maximum, with the curve flat within 0.3% either side.

### What it would take to earn money

The repo's licence page already carries a $1.5k MRR target. In euro, at
the same rate of exchange, that is about **370 reachable fans**; against the
fan-heavy scenario, about 640; against the creator-heavy one, about 213.
On today's catalogue only the first three tiers are sellable, which is
59% of the modelled revenue — so the honest version of that target is 370
fans on three tiers, and a catalogue that can fill the top two.

## Milestones

| Order | Scope | Acceptance evidence |
|---|---|---|
| 1 | The ladder, the fee tables and the economics model | `check:subscription-tiers-unit` and `check:subscription-econ` in the `check` group; the research log above |
| 2 | A real first release | one label master with a WAV, one artist page without `data-missing="1"`, the artist point at real audio |
| 3 | A rights position | a written asset-rights declaration, so the Producer tier has something to grant |
| 4 | The membership on Gumroad | a live membership tier set, prices matching `SUBSCRIPTION_TIERS`, delivery through `api/kits/` zips into `library-store` |
| 5 | One-off sales | the catalogue ledger carries the sellable tracks and pictures; checkout is first-party, not the marketplace path |
| 6 | Stripe-native, only if the membership proves out | subscription mode, `invoice.paid` and `customer.subscription.*` webhooks, an OSS VAT registration |

## Initial implementation

This branch ships milestone 1 and nothing else.

- `api/_lib/subscription-tiers.js` — the ladder, the grant catalogue, the
  platform fee tables with their sources and check dates, the willingness
  to pay scenarios, and the economics functions. Pure, no dependencies, so
  a handler can import it without dragging the data layer in.
- `scripts/check-subscription-tiers-unit.mjs` — 19 checks: the ladder is
  sorted and nested, the free templates stay free, rights are top-tier
  only, the fee arithmetic matches the published tables to the cent, VAT is
  never counted as revenue, the entry tier keeps more than half the gross
  on every platform, and the metric has variance.
- `scripts/check-subscription-econ.mjs` — the metric command, plus the
  catalogue census that measures what can be handed over today.
- `package.json`, `scripts/run-steps.mjs` — both wired into the `check`
  group.

### Naming

`SUBSCRIPTION_TIERS`, not `MEMBERSHIP_TIERS`: `api/_lib/ids.js` already owns
`MEMBERSHIP_TIERS = ['free','creator']`, the account tier a signed-in user
holds, and it is read-only from the client. Two meanings of "membership" in
one repo is a bug waiting to happen.

## Existing work and dependencies

- The delivery primitives already exist: `api/kits/` resolves a bundle to
  one `.zip`, `api/_lib/library-store.js` holds the per-user library
  manifest, `api/_lib/slots.js` holds the entitlement ledger. Milestone 4
  is wiring, not invention.
- The `api/catalogue/` ledger already models songs, videos and packs with
  audio, video and image media kinds. Milestone 5 is a data job.
- The store manifest (`site-map.json` → `store`) is the single storefront
  source of truth and every payment link is currently `unset`. The
  membership tiers have to land there too, and `lib/store.client.js` has to
  render them — but only once the tiers are real.
- `persona-library.html` D8 says a hosted tier must be additive storage and
  never a gate. Nothing in this ladder gates a share link, an export or the
  free templates, which is the constraint it was written for.

## Verification

```
node scripts/check-subscription-tiers-unit.mjs   # 19 checks, the ladder and the fee tables
node scripts/check-subscription-econ.mjs         # the metric and the catalogue census
npm run check                                    # the whole quick gate, 132 steps
```

The econ run prints `METRIC netEurPerThousandFans=…` and
`METRIC-DELIVERABLE netEurPerThousandFans=…` on single lines, and exits
non-zero if the metric goes degenerate — if the scenarios stop disagreeing,
or if the eligible platforms stop differing, the loop would be measuring
noise and the gate says so.

## Boundaries

No billing code in this slice. No Patreon, Bandcamp or Stripe account is
created, configured or contacted. No price is live. No artist, release or
track is invented — the catalogue census counts what is in the tree, and
the six artist pages stay placeholders until they are not.

## Rejected approaches

- **Building Stripe subscription mode first.** The best margin, and the
  wrong first move: the tier economics are not settled, the catalogue is a
  placeholder, and the VAT obligation is unresolved. Billing plumbing
  before the tier model would be speculative.
- **Patreon as the primary.** Its fan feed is the best fit for a music
  label, but one-off sales need an 18+ classification, and its advantage
  over Gumroad on the metric is 0.27%.
- **Splitting the membership and the one-off sales across two platforms.**
  Worth 0.27% and costs a second member database.
- **Putting the free templates behind a tier.** The announcement promised
  they stay free. It is worth less than the promise.
- **Selling lossless WAVs in the entry tier.** There is no WAV to sell.

## Open decisions for Kai

1. **The 18+ question.** Keep the one-off sales on Gumroad and stay
   general-audience, or classify the Patreon page 18+ and take the better
   fan feed. The metric says it is worth 0.27% — the feed is the argument,
   not the money.
2. **The €3 floor.** Kept at €3.00 because it is reachable, not because it
   is profitable. If it reads as too cheap for the label, the €5 entry
   costs 11.9% of the modelled revenue.
3. **The one-off prices.** €4 for a track and €9 for a still are proposals
   anchored on the "a one-off must cost more than a month of membership"
   rule and the €25 pack, not on measured willingness to pay.
4. **Stripe-native.** The +12% margin is real and the build is a day of
   work once the catalogue is. Worth revisiting at the point where the
   membership has subscribers, not before.

## Sources

- Patreon creator fees — <https://support.patreon.com/hc/en-us/articles/11111747095181-Creator-fees> (checked 2026-11-05)
- Patreon Commerce eligibility for Adult/18+ creators — <https://support.patreon.com/hc/en-us/articles/31714988741645-Access-to-Patreon's-features-and-products-for-Adult-18-creators> (updated 2026-11-02)
- Bandcamp subscriptions and label accounts — <https://bandcamp.com/subscriptions>, <https://bandcamp.com/labels>
- Gumroad pricing — <https://gumroad.com/pricing>
- Stripe pricing and Billing — <https://stripe.com/en-ie/pricing>, <https://stripe.com/billing/pricing>
- Stripe Tax supported countries — <https://stripe.com/docs/tax/supported-countries>
- ECB reference rate — <https://data-api.ecb.europa.eu/service/data/EXR/D.USD.EUR.SP00.A> (2026-11-05, 1 EUR = 1.1224 USD)
- EU VAT one-stop shop for non-EU sellers — <https://europa.eu/youreurope/business/finance-and-tax/vat/one-stop-shop/index_en.htm>
- The repo's own willingness to pay and persona constraints — `persona-library.html` (May 2026 research, D3 / D7 / D8 memos)
