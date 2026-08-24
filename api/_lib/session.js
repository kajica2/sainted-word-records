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
