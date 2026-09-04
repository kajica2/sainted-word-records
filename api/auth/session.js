// api/auth/session.js — GET current session. Always 200 with { user } or { user: null }.
// POST { action: 'signout' } destroys the session cookie.

import { getCurrentUser } from '../_lib/session.js';
import { destroySession } from '../_lib/db.js';
import { readSessionCookie, clearSessionCookie, setCors, sendJson } from '../_lib/http.js';

export default async function handler(req, res) {
  setCors(res, req.headers.origin);
  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    return res.end();
  }

  if (req.method === 'GET') {
    const { user } = await getCurrentUser(req);
    if (!user) return sendJson(res, 200, { user: null });
    return sendJson(res, 200, {
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        image: user.image,
        provider: user.provider,
        // Auth & membership (Stage 2): include tier + joinedAt on the
        // session payload so the client can render UI immediately on
        // boot without a follow-up /api/users/[id] round-trip.
        membershipTier: user.membershipTier || 'free',
        joinedAt: user.joinedAt || user.createdAt || null,
      },
    });
  }

  if (req.method === 'POST') {
    // Sign out: clear cookie + destroy session row
    const token = readSessionCookie(req);
    if (token) await destroySession(token);
    clearSessionCookie(res);
    return sendJson(res, 200, { ok: true });
  }

  res.setHeader('Allow', 'GET, POST, OPTIONS');
  return sendJson(res, 405, { error: 'method_not_allowed' });
}
