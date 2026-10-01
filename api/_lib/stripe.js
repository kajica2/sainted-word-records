// api/_lib/stripe.js — Stripe Connect plumbing for the marketplace pilot.
//
// The /api/connect and /api/webhooks/stripe handlers share this module.
// It is deliberately small: lazy SDK client, one env-gate, and a
// dependency-free webhook signature verifier (node:crypto) so the
// verification math can be unit-tested offline without a secret key.
//
// Env:
//   STRIPE_SECRET_KEY            — required by /api/connect (account ops)
//   STRIPE_WEBHOOK_SECRET        — required by /api/webhooks/stripe
//   STRIPE_PLATFORM_FEE_PERCENT  — buyer-side service fee added at
//                                  checkout (default 10). The platform is
//                                  ALWAYS FREE for creators: sellers keep
//                                  100% of their price and the fee is never
//                                  deducted from their payout.
//   SWR_CONNECT_PILOT_LIMIT      — first-tranche cap on connected accounts
//                                  (default 20: the pilot is the first 20
//                                  joining sellers; raise the env to grow)

import { createHmac, timingSafeEqual } from 'node:crypto';
import Stripe from 'stripe';

export function stripeConfigured() {
  return !!(process.env.STRIPE_SECRET_KEY || '').trim();
}

export function webhookConfigured() {
  return !!(process.env.STRIPE_WEBHOOK_SECRET || '').trim();
}

// Platform fee %, validated to an integer 0..99. The pilot surfaces it in
// /api/connect responses; charging it is future work (see docs).
export const PLATFORM_FEE_PERCENT = (() => {
  const n = Number(process.env.STRIPE_PLATFORM_FEE_PERCENT || 10);
  return Number.isInteger(n) && n >= 0 && n <= 99 ? n : 10;
})();

// First-tranche cap (pilot). Must be a positive integer; unset/0 => 20.
export const PILOT_LIMIT = (() => {
  const n = Number(process.env.SWR_CONNECT_PILOT_LIMIT || 20);
  return Number.isInteger(n) && n > 0 ? n : 20;
})();

let _stripe = null;

export function getStripe() {
  if (!stripeConfigured()) {
    throw new Error('STRIPE_SECRET_KEY not configured');
  }
  if (!_stripe) {
    // No apiVersion pinned: the SDK defaults to its own latest-supported
    // version, and the installed SDK version travels with the lockfile.
    _stripe = new Stripe(process.env.STRIPE_SECRET_KEY.trim());
  }
  return _stripe;
}

// Verify a Stripe webhook signature header.
//   signature = 't=<ts>,v1=<hmac>[,v1=<hmac>...]'
// The payload must be the RAW request body (exact bytes) — re-stringifying a
// parsed body breaks the HMAC. Tolerates up to MAX_SKEW_SEC of clock skew.
export function verifyWebhookSignature({ payload, signature, secret = process.env.STRIPE_WEBHOOK_SECRET || '' }) {
  if (!secret) throw new Error('STRIPE_WEBHOOK_SECRET not configured');
  if (!signature) return false;
  const parts = {};
  for (const chunk of String(signature).split(',')) {
    const i = chunk.indexOf('=');
    if (i > 0) parts[chunk.slice(0, i)] = chunk.slice(i + 1);
  }
  const ts = parts.t;
  const hmac = parts.v1;
  if (!ts || !hmac) return false;
  const t = Number(ts);
  if (!Number.isFinite(t) || Math.abs(Date.now() / 1000 - t) > 300) return false;

  const expected = createHmac('sha256', secret).update(`${ts}.${payload}`).digest('hex');
  const a = Buffer.from(expected, 'hex');
  const b = Buffer.from(hmac, 'hex');
  return a.length === b.length && timingSafeEqual(a, b);
}