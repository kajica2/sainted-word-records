// api/auth/verify.js — consume a magic-link token, create a session.
// POST { email, token } → { ok, user } + Set-Cookie

import {
  consumeVerificationToken,
  createSession,
  findUserByEmail,
  updateUser,
} from '../_lib/db.js';
import { readJsonBody, sendJson, setSessionCookie, setCors } from '../_lib/http.js';
import { sendWelcomeEmail } from '../_lib/email.js';

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

  // Welcome email — first successful verification only.
  //
  // Awaited rather than fire-and-forget: a floating promise can be killed
  // the moment a serverless function returns, so the send would be lost
  // silently. The Resend call carries its own 5s abort, so this cannot
  // stall sign-in indefinitely (typical latency is well under 1s).
  //
  // `welcomedAt` is written only after a definitive outcome. On timeout
  // it stays unset, so a later sign-in retries instead of the message
  // being lost — and on a hard failure we mark anyway, because a
  // persistent provider error should not re-send on every visit.
  if (!user.welcomedAt) {
    const proto = (req.headers['x-forwarded-proto'] || 'http').toString();
    const host = req.headers['x-forwarded-host'] || req.headers.host;
    const appOrigin = host ? `${proto}://${host}` : undefined;
    try {
      const r = await sendWelcomeEmail({ to: user.email, name: user.name, appOrigin });
      if (!r.ok) console.warn('[welcome] send failed', r.transport, r.error);
      await updateUser(user.id, { welcomedAt: new Date().toISOString() });
    } catch (e) {
      console.warn('[welcome] deferred (will retry on next sign-in)', e && e.message);
    }
  }

  return sendJson(res, 200, {
    ok: true,
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      image: user.image,
      provider: user.provider,
      // Auth & membership (Stage 2): include the tier so the client
      // can render tier-aware UI without a second round-trip.
      membershipTier: user.membershipTier || 'free',
      joinedAt: user.joinedAt || user.createdAt || null,
    },
  });
}
