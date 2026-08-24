// api/auth/magic.js — request a magic-link email.
// POST { email } → { ok: true } (always, to avoid leaking which emails exist).
// The email contains a link to /auth/verify?token=...&email=... which posts
// to /api/auth/verify to consume the token and create the session.

import {
  createUser,
  createVerificationToken,
  rateLimit,
} from '../_lib/db.js';
import { readJsonBody, sendJson, setCors } from '../_lib/http.js';
import { sendMagicLink } from '../_lib/email.js';

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

  // Per-IP rate limit on auth endpoints
  const ip = (req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown').toString().split(',')[0].trim();
  const rl = rateLimit({ key: `magic:${ip}`, windowMs: 60_000, max: 10 });
  if (!rl.ok) {
    res.setHeader('Retry-After', String(Math.ceil(rl.retryAfterMs / 1000)));
    return sendJson(res, 429, { error: 'rate_limited' });
  }

  const body = await readJsonBody(req);
  const email = body && body.email && String(body.email).trim();
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return sendJson(res, 400, { error: 'invalid_email' });
  }

  // Ensure the user row exists (idempotent)
  await createUser({ email });

  // Create the verification token (24h TTL)
  const record = await createVerificationToken({ identifier: email, ttlMs: 24 * 60 * 60 * 1000 });

  // Build the verify URL. In Vercel, prefer the request's host header so
  // preview deploys work; in dev, fall back to SWRC_APP_ORIGIN or localhost.
  const proto = (req.headers['x-forwarded-proto'] || 'http').toString();
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  const fallbackOrigin = process.env.SWRC_APP_ORIGIN || `http://localhost:5174`;
  const origin = host ? `${proto}://${host}` : fallbackOrigin;
  const verifyUrl = `${origin}/auth/verify?token=${encodeURIComponent(record.token)}&email=${encodeURIComponent(email)}`;

  await sendMagicLink({ to: email, url: verifyUrl, appOrigin: origin });

  return sendJson(res, 200, { ok: true });
}
