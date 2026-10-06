// api/connect/index.js — the marketplace seller's Stripe Connect surface.
//
//   GET  /api/connect                  → status: connected account (if any),
//                                        pilot seat usage + platform fee %
//   POST /api/connect?action=create    → create the seller's connected
//                                        account (idempotent; pilot-gated)
//   POST /api/connect?action=onboard   → fresh Stripe-hosted onboarding URL
//                                        so the seller can finish identity +
//                                        payout-bank verification
//
// "Auto-configured for them, we're the intermediary" is Stripe Connect
// (account type "Platforms and marketplaces"). Every seller gets their own
// connected account; buyers pay the platform; Stripe splits + pays out to
// the seller's bank. This handler only creates the account and hands the
// seller to Stripe's hosted onboarding — the ONE thing Stripe will not let
// a platform automate away.
//
// Pilot scope (first 20 sellers; SWR_CONNECT_PILOT_LIMIT):
//   - create + onboard only. Charging (Checkout with transfer_data) and
//     fee math are the next slice — see docs/stripe-connect-pilot.md.

import { requireUser } from '../_lib/session.js';
import { rateLimit } from '../_lib/db.js';
import {
  getConnectAccount,
  saveConnectAccount,
  countConnectAccounts,
} from '../_lib/connect-store.js';
import {
  getStripe,
  stripeConfigured,
  PLATFORM_FEE_PERCENT,
  PILOT_LIMIT,
} from '../_lib/stripe.js';
import { readJsonBody, sendJson, setCors } from '../_lib/http.js';

const VALID_ACTIONS = new Set(['create', 'onboard']);

function appOrigin(req) {
  const proto = (req.headers['x-forwarded-proto'] || 'http').toString();
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  if (host) return `${proto}://${host}`;
  return process.env.SWRC_APP_ORIGIN || `http://localhost:5174`;
}

export default async function handler(req, res) {
  setCors(res, req.headers.origin);
  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    return res.end();
  }

  const ctx = await requireUser(req, res);
  if (!ctx) return;

  // --- GET: status ---
  if (req.method === 'GET') {
    const account = await getConnectAccount(ctx.user.id);
    return sendJson(res, 200, {
      connect: account
        ? {
            id: account.accountId,
            status: account.status,
            chargesEnabled: !!account.chargesEnabled,
            payoutsEnabled: !!account.payoutsEnabled,
            updatedAt: account.updatedAt,
          }
        : null,
      pilot: {
        limit: PILOT_LIMIT,
        used: await countConnectAccounts(),
        feePercent: PLATFORM_FEE_PERCENT,
      },
    });
  }

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST, OPTIONS');
    return sendJson(res, 405, { error: 'method_not_allowed' });
  }

  const body = await readJsonBody(req, { maxBytes: 16_000 });
  if (!body || body.__error) return sendJson(res, 400, { error: 'invalid_body' });

  const action = typeof body.action === 'string' ? body.action : null;
  if (!action || !VALID_ACTIONS.has(action)) {
    return sendJson(res, 400, { error: 'invalid_action', allowed: [...VALID_ACTIONS] });
  }

  if (!stripeConfigured()) {
    return sendJson(res, 503, {
      error: 'stripe_not_configured',
      message: 'STRIPE_SECRET_KEY env var is not set.',
    });
  }

  const existing = await getConnectAccount(ctx.user.id);

  // --- POST ?action=create ---
  if (action === 'create') {
    const rl = rateLimit({ key: `connect-create:${ctx.user.id}`, windowMs: 60_000, max: 10 });
    if (!rl.ok) {
      res.setHeader('Retry-After', String(Math.ceil(rl.retryAfterMs / 1000)));
      return sendJson(res, 429, { error: 'rate_limited' });
    }
    if (existing && existing.accountId) {
      // Idempotent: the user already has a connected account.
      return sendJson(res, 200, {
        ok: true,
        account: { id: existing.accountId, status: existing.status },
        created: false,
      });
    }

    // Pilot gate: first SWR_CONNECT_PILOT_LIMIT sellers only.
    const used = await countConnectAccounts();
    if (used >= PILOT_LIMIT) {
      return sendJson(res, 403, {
        error: 'pilot_limit_reached',
        message: `The pilot is capped at ${PILOT_LIMIT} sellers. Raise SWR_CONNECT_PILOT_LIMIT to grow.`,
        pilot: { limit: PILOT_LIMIT, used },
      });
    }

    try {
      const account = await getStripe().accounts.create({
        type: 'express',
        email: ctx.user.email,
        capabilities: { transfers: { requested: true } },
        metadata: { swr_user_id: ctx.user.id },
      });
      await saveConnectAccount(ctx.user.id, {
        accountId: account.id,
        status: 'pending',
        chargesEnabled: false,
        payoutsEnabled: false,
        createdAt: new Date().toISOString(),
      });
      return sendJson(res, 200, {
        ok: true,
        account: { id: account.id, status: 'pending' },
        created: true,
        pilot: { limit: PILOT_LIMIT, used: used + 1 },
      });
    } catch (e) {
      return sendJson(res, 502, { error: 'stripe_api_error', message: e.message });
    }
  }

  // --- POST ?action=onboard ---
  if (!existing || !existing.accountId) {
    return sendJson(res, 400, {
      error: 'not_created',
      message: 'Call ?action=create first.',
    });
  }
  const rl = rateLimit({ key: `connect-onboard:${ctx.user.id}`, windowMs: 60_000, max: 30 });
  if (!rl.ok) {
    res.setHeader('Retry-After', String(Math.ceil(rl.retryAfterMs / 1000)));
    return sendJson(res, 429, { error: 'rate_limited' });
  }

  try {
    const origin = appOrigin(req);
    const link = await getStripe().accountLinks.create({
      account: existing.accountId,
      refresh_url: `${origin}/connect?onboarding=refresh`,
      return_url: `${origin}/connect?onboarding=done`,
      type: 'account_onboarding',
    });
    return sendJson(res, 200, { ok: true, url: link.url });
  } catch (e) {
    return sendJson(res, 502, { error: 'stripe_api_error', message: e.message });
  }
}