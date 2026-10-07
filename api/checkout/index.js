// api/checkout/index.js — start a Stripe Checkout Session for a buyer.
//
//   POST /api/checkout { listingId } → { ok, url, orderId }
//
// The money path for the marketplace:
//   - The buyer signs in (this repo's magic-link account).
//   - Server-side: resolve the listing (plus its same-seller bundle refs)
//     to live items, require the seller's connected account to be active,
//     compute totals from the REAL catalogue prices.
//   - A pending ORDER is recorded (api/_lib/orders.js).
//   - A Stripe Checkout Session charges the buyer price + buyer-side
//     service fee; payment_intent_data transfers the full price to the
//     seller's connected account with application_fee_amount = the fee
//     (sellers keep 100% — the platform is free for creators).
//   - checkout.session.completed webhook flips the order to 'paid'.

import { requireUser } from '../_lib/session.js';
import { rateLimit } from '../_lib/db.js';
import { getConnectAccount } from '../_lib/connect-store.js';
import { resolveSellableItems, findCatalogItemById } from '../_lib/catalogue.js';
import { createOrder, updateOrder } from '../_lib/orders.js';
import { getStripe, stripeConfigured, PLATFORM_FEE_PERCENT } from '../_lib/stripe.js';
import { readJsonBody, sendJson, setCors, appOrigin } from '../_lib/http.js';

const LISTING_RE = /^[a-f0-9-]{8,40}$/i;

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

  const rl = rateLimit({ key: `checkout-create:${ctx.user.id}`, windowMs: 60_000, max: 10 });
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

  const body = await readJsonBody(req, { maxBytes: 16_000 });
  if (!body || body.__error) return sendJson(res, 400, { error: 'invalid_body' });
  const listingId = typeof body.listingId === 'string' ? body.listingId.trim() : '';
  if (!LISTING_RE.test(listingId)) {
    return sendJson(res, 400, { error: 'invalid_listing' });
  }

  // Resolve the sellable items server-side (never trust client totals).
  const items = await resolveSellableItems(listingId);
  if (!items.length) {
    return sendJson(res, 404, { error: 'listing_not_live' });
  }

  // The listing's OWNER is the seller; every item must share that seller.
  const root = await findCatalogItemById(listingId);

  // The seller must have an ACTIVE connected account to receive money.
  const sellerConnect = await getConnectAccount(root.sellerUserId);
  if (!sellerConnect || !sellerConnect.accountId || sellerConnect.status !== 'active') {
    return sendJson(res, 400, { error: 'seller_not_active' });
  }

  const feePercent = PLATFORM_FEE_PERCENT;
  const order = await createOrder({
    buyerUserId: ctx.user.id,
    buyerEmail: ctx.user.email,
    sellerUserId: root.sellerUserId,
    sellerAccountId: sellerConnect.accountId,
    items,
    currency: 'EUR',
    feePercent,
  });

  try {
    const stripe = getStripe();
    const origin = appOrigin(req);
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      expires_at: Math.floor(Date.now() / 1000) + 60 * 60, // 1h (min 30m)
      customer_email: ctx.user.email,
      payment_intent_data: {
        transfer_data: { destination: sellerConnect.accountId },
        application_fee_amount: order.feeMinor,
        metadata: { order_id: order.id },
      },
      line_items: [
        ...order.items.map((it) => ({
          quantity: 1,
          price_data: {
            currency: order.currency.toLowerCase(),
            unit_amount: it.priceMinor,
            product_data: { name: it.title },
          },
        })),
        // Buyer-side service fee — always free for creators, the buyer
        // pays the surcharge, the seller keeps 100% of their price.
        {
          quantity: 1,
          price_data: {
            currency: order.currency.toLowerCase(),
            unit_amount: order.feeMinor,
            product_data: { name: `Platform service fee (${feePercent}%)` },
          },
        },
      ],
      metadata: { order_id: order.id },
      success_url: `${origin}/buy?order=${order.id}&status=paid`,
      cancel_url: `${origin}/buy?order=${order.id}&status=cancelled`,
    });

    await updateOrder(order.id, { sessionId: session.id });
    return sendJson(res, 200, { ok: true, url: session.url, orderId: order.id });
  } catch (e) {
    return sendJson(res, 502, { error: 'stripe_api_error', message: e.message });
  }
}