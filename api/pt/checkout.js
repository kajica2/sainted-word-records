// api/pt/checkout.js — start a Stripe Checkout Session for a PT license tier.
//
//   POST /api/pt/checkout { tier: 'solo'|'band'|'label' } → { ok, url, tier }
//
// This is the platform's OWN product (not a marketplace listing): no Connect
// transfer — the payment goes to the platform account. The session carries
// metadata { pt_tier, user_id }; the webhook (api/webhooks/stripe.js →
// checkout.session.completed) grants paid video slots and mints the license
// key on payment.
//
// Prices live server-side in api/_lib/pt-keys.js (PT_TIERS) — the client
// never sends an amount.

import { requireUser } from '../_lib/session.js';
import { rateLimit } from '../_lib/db.js';
import { getStripe, stripeConfigured } from '../_lib/stripe.js';
import { PT_TIERS } from '../_lib/pt-keys.js';
import { readJsonBody, sendJson, setCors, appOrigin } from '../_lib/http.js';

export default async function handler(req, res) {
  setCors(res, req.headers.origin);
  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    return res.end();
  }
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST, OPTIONS');
    return sendJson(res, 405, { error: 'method_not_allowed' });
  }

  const ctx = await requireUser(req, res);
  if (!ctx) return;

  const rl = rateLimit({ key: `pt-checkout:${ctx.user.id}`, windowMs: 60_000, max: 5 });
  if (!rl.ok) {
    res.setHeader('Retry-After', String(Math.ceil(rl.retryAfterMs / 1000)));
    return sendJson(res, 429, { error: 'rate_limited' });
  }

  if (!stripeConfigured()) {
    return sendJson(res, 503, {
      error: 'stripe_not_configured',
      message: 'STRIPE_SECRET_KEY env var is not set.',
    });
  }

  const body = await readJsonBody(req, { maxBytes: 4_000 });
  if (!body || body.__error) return sendJson(res, 400, { error: 'invalid_body' });
  const tier = typeof body.tier === 'string' ? body.tier.trim().toLowerCase() : '';
  const t = PT_TIERS[tier];
  if (!t) {
    return sendJson(res, 400, { error: 'invalid_tier', allowed: Object.keys(PT_TIERS) });
  }

  try {
    const stripe = getStripe();
    const origin = appOrigin(req);
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      expires_at: Math.floor(Date.now() / 1000) + 60 * 60, // 1h (min 30m)
      customer_email: ctx.user.email,
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: 'eur',
            unit_amount: t.priceMinor,
            product_data: { name: `${t.name} — ${t.credits} render credits` },
          },
        },
      ],
      metadata: { pt_tier: tier, user_id: ctx.user.id },
      success_url: `${origin}/buy?pt=paid`,
      cancel_url: `${origin}/buy?pt=cancelled`,
    });

    return sendJson(res, 200, { ok: true, url: session.url, tier });
  } catch (e) {
    return sendJson(res, 502, { error: 'stripe_api_error', message: e.message });
  }
}
