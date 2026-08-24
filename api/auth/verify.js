// api/auth/verify.js — consume a magic-link token, create a session.
// POST { email, token } → { ok, user } + Set-Cookie

import {
  consumeVerificationToken,
  createSession,
  findUserByEmail,
} from '../_lib/db.js';
import { readJsonBody, sendJson, setSessionCookie, setCors } from '../_lib/http.js';

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

  const body = await readJsonBody(req);
  const email = body && body.email && String(body.email).trim();
  const token = body && body.token && String(body.token).trim();
  if (!email || !token) return sendJson(res, 400, { error: 'missing_params' });

  const record = await consumeVerificationToken({ identifier: email, token });
  if (!record) return sendJson(res, 401, { error: 'invalid_or_expired_token' });

  const user = await findUserByEmail(email);
  if (!user) return sendJson(res, 500, { error: 'user_missing' });

  const session = await createSession({ userId: user.id });
  setSessionCookie(res, session.token);

  return sendJson(res, 200, {
    ok: true,
    user: { id: user.id, email: user.email, name: user.name, image: user.image, provider: user.provider },
  });
}
