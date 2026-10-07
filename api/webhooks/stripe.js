// api/webhooks/stripe.js — POST webhook receiver for the Connect pilot.
//
// Stripe signs every webhook; the signature covers the RAW payload bytes,
// so this handler reads the raw body (readRawBody) and verifies the HMAC
// before parsing. Every handled event is appended to the idempotent event
// ledger (db.recordConnectEvent) so a Stripe redelivery — which happens
// hours later when our 200 is missed — never processes an event twice.
//
// Pilot handlers:
//   account.updated                  → flip the seller's status (pending →
//                                      active when details_submitted), plus
//                                      charges/payouts capability flags
//   checkout.session.completed      → record the sale (reconciliation) +
//                                      fulfil PT purchases (grant paid slots,
//                                      mint the license key)
//   payment_intent.succeeded        → record the payment (reconciliation)
//   payout.paid / payout.failed     → record the payout (reconciliation)
//   account.application.deauthorized→ mark the seller revoked
//
// Dashboard setup (Settings → Webhooks → Add endpoint):
//   URL: https://<host>/api/webhooks/stripe
//   Events: account.updated, checkout.session.completed,
//           payment_intent.succeeded, payout.paid, payout.failed,
//           account.application.deauthorized
//   Then copy the signing secret to STRIPE_WEBHOOK_SECRET.

import { readRawBody, sendJson, setCors } from '../_lib/http.js';
import { verifyWebhookSignature, webhookConfigured } from '../_lib/stripe.js';
import {
  findConnectEvent,
  recordConnectEvent,
  findUserByConnectAccount,
  saveConnectAccount,
} from '../_lib/connect-store.js';
import { markOrderPaidBySession } from '../_lib/orders.js';
import { fulfillPtPurchase } from '../_lib/pt-keys.js';

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

  if (!webhookConfigured()) {
    return sendJson(res, 503, {
      error: 'stripe_not_configured',
      message: 'STRIPE_WEBHOOK_SECRET env var is not set.',
    });
  }

  const raw = await readRawBody(req, { maxBytes: 2_000_000 });
  const payload = raw.toString('utf8');
  const signature = (req.headers['stripe-signature'] || '').toString();
  if (!verifyWebhookSignature({ payload, signature })) {
    return sendJson(res, 400, { error: 'invalid_signature' });
  }

  let event;
  try {
    event = JSON.parse(payload);
  } catch {
    return sendJson(res, 400, { error: 'invalid_json' });
  }
  if (!event || typeof event.id !== 'string' || typeof event.type !== 'string') {
    return sendJson(res, 400, { error: 'invalid_event' });
  }

  // Idempotency: a redelivered event is acknowledged, not re-processed.
  if (await findConnectEvent(event.id)) {
    return sendJson(res, 200, { received: true, duplicate: true });
  }

  const obj = (event.data && event.data.object) || null;
  let summary = null;

  if (event.type === 'account.updated' && obj && obj.id) {
    // Route the event back to the owning seller and persist capability state.
    const owner = await findUserByConnectAccount(obj.id);
    if (owner) {
      await saveConnectAccount(owner.id, {
        status: obj.details_submitted ? 'active' : 'pending',
        chargesEnabled: !!obj.charges_enabled,
        payoutsEnabled: !!obj.payouts_enabled,
        requirements: obj.requirements
          ? { currently_due: obj.requirements.currently_due || [] }
          : null,
      });
    }
    summary = {
      account: obj.id,
      details_submitted: !!obj.details_submitted,
      charges_enabled: !!obj.charges_enabled,
      payouts_enabled: !!obj.payouts_enabled,
    };
  } else if (event.type === 'checkout.session.completed' && obj) {
    // Pilot reconciliation row — the owner watches this ledger instead of
    // building a payouts UI. Fee math + transfer_data land in the next slice.
    summary = {
      session: obj.id,
      customer_email: obj.customer_email || null,
      amount_total: obj.amount_total,
      currency: obj.currency,
      payment_intent: obj.payment_intent || null,
    };
    // Fulfilment: flip the platform-side order to 'paid' (idempotent).
      const orderId = (obj.metadata && obj.metadata.order_id) || null;
      if (orderId) {
        const paid = await markOrderPaidBySession(obj.id, {
          paymentIntentId: obj.payment_intent || null,
        });
        summary.order_id = (paid && paid.id) || orderId;
      }
      // PT tier purchase: the session carries { pt_tier, user_id } instead of
      // an order_id (api/pt/checkout.js). Fulfilment grants paid video slots
      // and mints the license key — idempotent by session, so a redelivery
      // is a no-op.
      const ptTier = (obj.metadata && obj.metadata.pt_tier) || null;
      const ptUserId = (obj.metadata && obj.metadata.user_id) || null;
      if (ptTier && ptUserId) {
        const pt = await fulfillPtPurchase({
          tier: ptTier,
          userId: ptUserId,
          email: obj.customer_email || null,
          sessionId: obj.id,
        });
        if (pt && pt.key) {
          summary.pt_tier = ptTier;
          summary.pt_key = pt.key;
          summary.pt_slots = pt.slots;
        }
      }
  } else if (event.type === 'payment_intent.succeeded' && obj) {
    summary = {
      payment_intent: obj.id,
      amount: obj.amount,
      currency: obj.currency,
      status: obj.status,
      transfer: (obj.transfer_data && obj.transfer_data.destination) || null,
    };
  } else if ((event.type === 'payout.paid' || event.type === 'payout.failed') && obj) {
    summary = {
      payout: obj.id,
      amount: obj.amount,
      currency: obj.currency,
      status: obj.status,
      account: obj.destination,
    };
  } else if (event.type === 'account.application.deauthorized' && obj) {
    const owner = await findUserByConnectAccount(obj.id);
    if (owner) {
      await saveConnectAccount(owner.id, { status: 'revoked' });
    }
    summary = { account: obj.id, revoked: true };
  }

  await recordConnectEvent({ id: event.id, type: event.type, data: summary });
  return sendJson(res, 200, { received: true });
}