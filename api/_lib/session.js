// api/_lib/session.js — get the current session + user from a request.
// Returns { user, session } or { user: null, session: null }.

import { readSessionCookie } from './http.js';
import { getSession, getUser } from './db.js';

export async function getCurrentUser(req) {
  const token = readSessionCookie(req);
  if (!token) return { user: null, session: null };
  const session = await getSession(token);
  if (!session) return { user: null, session: null };
  const user = await getUser(session.userId);
  if (!user) return { user: null, session: null };
  return { user, session };
}

// For handlers that REQUIRE auth. Calls sendJson(res, 401, ...) and returns
// null if missing. Otherwise returns { user, session }.
export async function requireUser(req, res) {
  const { user, session } = await getCurrentUser(req);
  if (!user) {
    res.statusCode = 401;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(JSON.stringify({ error: 'unauthorized' }));
    return null;
  }
  return { user, session };
}

// Admin gate: same auth as requireUser, plus the user's email must appear in
// the SWR_ADMIN_EMAILS allow-list (comma-separated, server-side env).
//
// Env:
//   SWR_ADMIN_EMAILS — comma-separated, case-insensitive, e.g.
//                       "kai.djuric@gmail.com,ops@example.com"
//                      Unset / empty => no one is admin (fail-closed).
//
// Behaviour:
//   - Missing env:  503 { error: 'admin_disabled' }
//   - Unknown user: 401 { error: 'unauthorized' }
//   - Allow-listed: returns { user, session }
//   - Not on list:  403 { error: 'forbidden' }
export async function requireAdmin(req, res) {
  const auth = await requireUser(req, res);
  if (!auth) return null;
  const allow = (process.env.SWR_ADMIN_EMAILS || '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  if (allow.length === 0) {
    res.statusCode = 503;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(JSON.stringify({ error: 'admin_disabled', hint: 'SWR_ADMIN_EMAILS env not configured' }));
    return null;
  }
  const email = (auth.user && auth.user.email ? String(auth.user.email) : '').toLowerCase();
  if (!email || !allow.includes(email)) {
    res.statusCode = 403;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(JSON.stringify({ error: 'forbidden' }));
    return null;
  }
  return auth;
}
