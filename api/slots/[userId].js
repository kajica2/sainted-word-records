// api/slots/[userId].js — GET state + grants for a user, PUT to register
// videos against their quota.
//
// GET /api/slots/<userId>  → { user, state, grants, registrations, remaining }
//   Self-authorized (the session user must match) OR admin. Returns zeroed
//   state for a valid user with no grants yet — the user exists, the ledger
//   just has nothing for them.
//
// PUT /api/slots/<userId>  → { ok, registration, state, remaining }
//   body: { count } ∈ {10, 30, 50}. The quota wall (registered + count <=
//   totalSlots) is enforced SERVER-SIDE in api/_lib/slots.js under withLock —
//   a client count is never trusted. 422 on quota_exceeded, 400 on an
//   invalid count.
//
// This is the authoritative quota the client syncs from. Once Stripe lands
// and grants flip to paid, registerVideos() stops accepting trial
// registrations — see the TOGGLE marker in api/_lib/slots.js.

import { requireUser, isAdminUser } from '../_lib/session.js';
import { getUser, rateLimit } from '../_lib/db.js';
import { readJsonBody, sendJson, setCors } from '../_lib/http.js';
import {
  getSlotState,
  listGrants,
  listRegistrations,
  normalizeSlots,
  registerVideos,
  SlotQuotaError,
  SLOT_BATCHES,
} from '../_lib/slots.js';

function extractFromUrl(url) {
  const m = String(url || '').match(/\/api\/slots\/([^/?#]+)/);
  return m ? decodeURIComponent(m[1]) : null;
}

function canAccess(id, ctx) {
  if (id === ctx.user.id) return true;
  return isAdminUser(ctx.user);
}

export default async function handler(req, res) {
  setCors(res, req.headers.origin);
  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    return res.end();
  }

  const ctx = await requireUser(req, res);
  if (!ctx) return;

  const id = (req.query && req.query.id) || extractFromUrl(req.url);
  if (!id || !/^[a-f0-9-]{8,40}$/i.test(id)) {
    return sendJson(res, 400, { error: 'invalid_id' });
  }
  if (!canAccess(id, ctx)) {
    return sendJson(res, 403, { error: 'forbidden' });
  }

  if (req.method === 'GET') {
    const [state, grants, registrations, user] = await Promise.all([
      getSlotState(id),
      listGrants(id),
      listRegistrations(id),
      getUser(id),
    ]);
    return sendJson(res, 200, {
      user: user ? { id: user.id, email: user.email } : { id },
      state,
      grants: grants.slice(0, 100),
      registrations: registrations.slice(0, 100),
      remaining: (state.totalSlots || 0) - (state.registered || 0),
    });
  }

  if (req.method === 'PUT') {
    const rl = rateLimit({ key: `slots-register:${ctx.user.id}`, windowMs: 60_000, max: 60 });
    if (!rl.ok) {
      res.setHeader('Retry-After', String(Math.ceil(rl.retryAfterMs / 1000)));
      return sendJson(res, 429, { error: 'rate_limited' });
    }
    const body = await readJsonBody(req, { maxBytes: 16_000 });
    if (!body || body.__error) return sendJson(res, 400, { error: 'invalid_body' });

    const count = normalizeSlots(body.count);
    if (!count) return sendJson(res, 400, { error: 'invalid_count', allowed: SLOT_BATCHES });

    try {
      const result = await registerVideos({ userId: id, count });
      return sendJson(res, 200, {
        ok: true,
        registration: result.registration,
        state: result.state,
        remaining: (result.state.totalSlots || 0) - (result.state.registered || 0),
      });
    } catch (e) {
      if (e instanceof SlotQuotaError) {
        return sendJson(res, 422, { error: 'quota_exceeded', state: e.state });
      }
      throw e;
    }
  }

  res.setHeader('Allow', 'GET, PUT, OPTIONS');
  return sendJson(res, 405, { error: 'method_not_allowed' });
}