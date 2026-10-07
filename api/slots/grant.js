// api/slots/grant.js — POST /api/slots/grant (admin-only).
//
// Grants video slots to a user by email. Slot amounts are the same batches
// the client wallet knows (10 / 30 / 50). Grants issued here are
// payment-verified comps (`paid: true`) — the registration wall only lets
// paid grants back videos (see the TOGGLE in api/_lib/slots.js).
//
// Admin gate decision: we reuse requireAdmin() (an SWR_ADMIN_EMAILS
// allow-list over the magic-link session) instead of inventing a parallel
// ADMIN_SECRET header. It is the repo's one admin gate — fail-closed (503
// admin_disabled when the env is unset), no second secret to rotate or leak,
// and the operator logs in with the same auth every other surface uses. The
// admin page (slots-admin.html) and this handler therefore share one code
// path; a misconfiguring deploy surfaces loudly instead of silently
// accepting grants.
//
// Body: { email, slots, note? }   slots ∈ {10, 30, 50}
// Returns 200 { ok, user, grant, state }.

import { requireAdmin } from '../_lib/session.js';
import { createUser, rateLimit } from '../_lib/db.js';
import { readJsonBody, sendJson, setCors } from '../_lib/http.js';
import { normalizeEmail, normalizeSlots, grantSlots, SLOT_BATCHES } from '../_lib/slots.js';

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

  const admin = await requireAdmin(req, res);
  if (!admin) return;

  const rl = rateLimit({ key: `slots-grant:${admin.user.id}`, windowMs: 60_000, max: 60 });
  if (!rl.ok) {
    res.setHeader('Retry-After', String(Math.ceil(rl.retryAfterMs / 1000)));
    return sendJson(res, 429, { error: 'rate_limited' });
  }

  const body = await readJsonBody(req, { maxBytes: 16_000 });
  if (!body || body.__error) return sendJson(res, 400, { error: 'invalid_body' });

  const email = normalizeEmail(body.email);
  if (!email) return sendJson(res, 400, { error: 'invalid_email' });
  const slots = normalizeSlots(body.slots);
  if (!slots) return sendJson(res, 400, { error: 'invalid_slots', allowed: SLOT_BATCHES });

  // createUser is the get-or-create: it returns the existing record when the
  // email is already known (idempotent, same as auth sign-in).
  const user = await createUser({ email });
    const result = await grantSlots({
      userId: user.id,
      email,
      slots,
      source: 'admin-grant',
      paid: true,
      note: typeof body.note === 'string' ? body.note : null,
    });

  return sendJson(res, 200, {
    ok: true,
    user: { id: user.id, email: user.email },
    grant: result.grant,
    state: result.state,
  });
}