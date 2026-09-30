# Stripe Connect marketplace — pilot plan (20 → 100 users, Q1)

Status: **scaffolded** (M2). Owner decision recorded: connect data lives on
**Vercel Postgres** (via `db.js`); Google Firestore is dormant (opt-in via
`SWR_CONNECT_STORE=firestore`).

## Model

- **Stripe account type:** *Platforms and marketplaces* (Connect). Keep
  *Both* if direct sales (PT licenses, €25 render service, €5 market
  studies) stay live — selecting it at onboarding is the only friction-free
  time to add the Payments capability.
- **Seller onboarding:** each joining seller gets a Stripe **express**
  connected account; `POST /api/connect` creates it, `?action=onboard`
  returns a fresh Stripe-hosted onboarding URL. Identity + payout-bank
  verification is the one part Stripe requires the seller to do.
- **Money flow (next slice):** buyer pays the platform via Checkout with
  `transfer_data`. **The platform is always free for creators**: sellers
  keep 100% of their price; the buyer adds a small service fee
  (`STRIPE_PLATFORM_FEE_PERCENT`) at checkout, and Stripe pays the seller
  their full amount minus only processing costs.

## What is scaffolded now

| Piece | Location |
|---|---|
| Connect account + onboarding handler | `api/connect/index.js` (`GET`, `POST ?action=create\|onboard`) |
| Signed webhook receiver (idempotent event ledger) | `api/webhooks/stripe.js` |
| Seller catalogue (listings + CRUD + bundles) | `api/catalogue/index.js`, `api/catalogue/[id].js`, `api/_lib/catalogue.js` |
| Catalogue UI (unlocks when onboarding is active) | `seller.client.js` (rendered by `connect.html`) |
| Store abstraction (Vercel Postgres / JSON default; Firestore dormant) | `api/_lib/connect-store.js` |
| DB helpers (accounts + ledger) | `api/_lib/db.js` (CONNECT section) |
| Stripe client + HMAC verifier | `api/_lib/stripe.js` |
| Dev routes | `scripts/dev-api.mjs` |
| Unit coverage (store + signature) | `scripts/test-api.mjs` (in `check`) |

Env: `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PLATFORM_FEE_PERCENT` (10),
`SWR_CONNECT_PILOT_LIMIT` (20) — see `.env.example`.

## Q1 plan: 20 → 100 sellers

- **Phase 0 (this scaffold, ~day 1–2).** Account type on stripe.com
  corrected to *Platforms and marketplaces* (or *Both*). Test-mode keys in
  `.env`. Webhook endpoint registered in the Stripe dashboard with events:
  `account.updated`, `checkout.session.completed`, `payment_intent.succeeded`,
  `payout.paid`, `payout.failed`, `account.application.deauthorized`.
- **Phase 1 (pilot 20 sellers).** Wire `dashboard.html` (or a `/connect`
  route) to: create → onboard → show status (GET `/api/connect`). Seller
  completes onboarding; webhook flips status to `active`. Owner reconciles
  via `connect/events.json` (or `listConnectEvents()`).
- **Phase 2 (charging).** Buyer Checkout with `transfer_data.destination` +
  `application_fee_amount`. Charge creation is the one Stripe call not yet
  scaffolded — decide fixed-price (one product per listing) vs amount-based
  at onboarding.
- **Phase 3 (scale to 100).** Raise `SWR_CONNECT_PILOT_LIMIT`; add an admin
  reconciliation view; revisit the Firestore option only if Google
  integration becomes a product requirement. Watch Vercel Postgres usage;
  the pilots store is human-scale.

## Operational notes

- **Prod must not run the JSON store.** Without `DATABASE_URL` the JSON
  fallback lives in `/tmp` and is wiped on cold start. Connect data rides
  the same store as auth; `DATABASE_URL` (Vercel Postgres) is required.
- **Rate limits (SECURITY.md):** `/api/connect` create 10/min/user,
  onboard-link 30/min/user; all return 429 + `Retry-After`.
- **Webhook idempotency:** event id is the ledger key; redelivery is
  acknowledged, never re-processed.
- **Firestore, if ever activated:** `SWR_CONNECT_STORE=firestore` +
  `FIREBASE_PROJECT_ID` + service account, and `npm install firebase-admin`
  (removed until then — it pulled a vulnerable `uuid` transitive dep).
- **Next slice checklist** (from `api/_lib/slots.js`): when charges land,
  the slots ledger flips `paid: false` grants via the `checkout.session.completed`
  webhook for *direct* sales; marketplace payouts get their own transfer
  records.