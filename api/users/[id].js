// api/users/[id].js — GET/PATCH a user's profile (auth-gated).
//
// Auth & membership (Stage 2): the membership primitive. Today this
// is just `{ id, email, name, image, membershipTier, joinedAt }`. Future
// stages will add pack-slot counts, sales history, etc. The endpoint is
// already shaped to absorb them without a schema migration.
//
// GET /api/users/[id]          → public-safe profile view of the user
//                                (only id, name, image, membershipTier,
//                                joinedAt — never email or auth info).
//                                Any signed-in user can read any other
//                                user's public profile; required for
//                                future pack-author pages.
//
// PATCH /api/users/[id]        → owner-only. Today only `membershipTier`
//                                can be patched, and only by the user
//                                themselves. Future: name, image.
//
// Rate-limited: 30 PATCH per minute per user.

import { requireUser } from '../_lib/session.js';
import {
  getUser,
  setMembershipTier,
  updateUser,
  rateLimit,
  MEMBERSHIP_TIERS,
} from '../_lib/db.js';
import { readJsonBody, sendJson, setCors } from '../_lib/http.js';

function extractFromUrl(url) {
  const m = String(url || '').match(/\/api\/users\/([^/?#]+)/);
  return m ? decodeURIComponent(m[1]) : null;
}

function publicProfile(user) {
  if (!user) return null;
  return {
    id: user.id,
    name: user.name,
    image: user.image,
    membershipTier: user.membershipTier || 'free',
    joinedAt: user.joinedAt || user.createdAt || null,
  };
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

  if (req.method === 'GET') {
    const user = await getUser(id);
    if (!user) return sendJson(res, 404, { error: 'not_found' });
    return sendJson(res, 200, { user: publicProfile(user) });
  }

  if (req.method === 'PATCH') {
    // Only the owner can patch their own profile.
    if (id !== ctx.user.id) {
      return sendJson(res, 403, { error: 'not_owner' });
    }
    const rl = rateLimit({ key: `user-patch:${ctx.user.id}`, windowMs: 60_000, max: 30 });
    if (!rl.ok) {
      res.setHeader('Retry-After', String(Math.ceil(rl.retryAfterMs / 1000)));
      return sendJson(res, 429, { error: 'rate_limited' });
    }
    const body = await readJsonBody(req, { maxBytes: 32_000 });
    if (!body || body.__error) return sendJson(res, 400, { error: 'invalid_body' });

    const patch = {};
    // membershipTier: validated against the allow-list
    if (body.membershipTier != null) {
      if (!MEMBERSHIP_TIERS.includes(body.membershipTier)) {
        return sendJson(res, 400, { error: 'invalid_tier', allowed: MEMBERSHIP_TIERS });
      }
      // Re-use the dedicated helper so validation lives in one place.
      const updated = await setMembershipTier(id, body.membershipTier);
      if (!updated) return sendJson(res, 404, { error: 'not_found' });
      return sendJson(res, 200, { user: publicProfile(updated) });
    }
    // name / image: trimmed; rejects empty strings
    if (typeof body.name === 'string') {
      const t = body.name.trim().slice(0, 80);
      if (t) patch.name = t;
    }
    if (typeof body.image === 'string' || body.image === null) {
      patch.image = body.image;
    }
    if (Object.keys(patch).length === 0) {
      return sendJson(res, 400, { error: 'no_fields_to_update' });
    }
    const updated = await updateUser(id, patch);
    if (!updated) return sendJson(res, 404, { error: 'not_found' });
    return sendJson(res, 200, { user: publicProfile(updated) });
  }

  res.setHeader('Allow', 'GET, PATCH, OPTIONS');
  return sendJson(res, 405, { error: 'method_not_allowed' });
}
