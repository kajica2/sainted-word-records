// api/invite/redeem.js — POST { code, email? } → { ok: true, tier?, preset?, emissions? } | 404 | 429
//
// Public endpoint, no auth required. The visitor pastes an invite code
// (admin-issued via scripts/grant-invite.mjs) and the server tells them
// if it's valid. Successful redemption flips the forced-rec watermark
// off in the visitor's browser (lib/invite-unlock.client.js owns the
// localStorage flag + SWR_WATERMARK.setEnabled(false) call).
//
// New v2 behavior:
// - First redemption ties the email to the code (if email provided)
// - Daily usage is tracked per email
// - Returns tier/preset/emissions for the client to use
// - Respects dailyLimit (0 = unlimited)
//
// Store backend: the same durable JSON store as auth/projects (Postgres in
// production when DATABASE_URL is set, local files otherwise — see
// api/_lib/kv.js). A store-level outage returns 503 with a clear error so
// the operator can fix it instead of leaking a generic 500, and is kept
// distinct from the 404 that means "no such code".

import { readJsonBody, sendJson, setCors } from '../_lib/http.js';
import { rateLimit } from '../_lib/db.js';
import { normalizeCode, readInvite, writeInvite, getUsage, incrementUsage, setUsageTier } from '../_lib/kv.js';

const MAX_BODY_BYTES = 1024; // a code is at most ~32 bytes
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

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

  // Per-IP rate limit. Codes are short and pasteable, so a single IP
  // can guess freely without this; the limit is the cheap safety net
  // against a script hammering the endpoint.
  const ip = (req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown').split(',')[0].trim();
  const rl = rateLimit({ key: `invite-redeem:${ip}`, windowMs: 60_000, max: 30 });
  if (!rl.ok) {
    res.setHeader('Retry-After', String(Math.ceil(rl.retryAfterMs / 1000)));
    return sendJson(res, 429, { error: 'rate_limited' });
  }

  let body;
  try {
    body = await readJsonBody(req, { maxBytes: MAX_BODY_BYTES });
  } catch (e) {
    return sendJson(res, 400, { error: 'invalid_body', detail: e.message });
  }

  const code = normalizeCode(body && body.code);
  const email = body && body.email;

  if (!code) return sendJson(res, 400, { error: 'invalid_code' });
  if (email && !EMAIL_RE.test(email)) {
    return sendJson(res, 400, { error: 'invalid_email' });
  }

  let entry;
  try {
    entry = await readInvite(code);
  } catch (e) {
    // Store missing / misconfigured / unreachable — distinct from "code not
    // found" so the operator can tell the two apart in their logs. kv.js
    // throws Error('kv_unavailable'); older builds threw the raw client
    // error, so both are matched.
    const msg = String((e && e.message) || e);
    const cause = String((e && e.cause && (e.cause.message || e.cause)) || '');
    if (msg === 'kv_unavailable' ||
        /KV_REST_API|KV_|@vercel\/kv|@upstash/i.test(msg) ||
        /ECONNREFUSED|ETIMEDOUT|ENOTFOUND|fetch failed/i.test(cause)) {
      return sendJson(res, 503, { error: 'invite_store_unavailable' });
    }
    return sendJson(res, 500, { error: 'internal_error' });
  }

  if (!entry || entry.enabled === false) {
    return sendJson(res, 404, { error: 'invalid_or_disabled_code' });
  }

  // Get tier/preset/emissions from entry
  const tier = entry.tier || 'free';
  const preset = entry.preset || 'RAW';
  const emissions = entry.emissions || 30;
  const dailyLimit = entry.dailyLimit;

  // If email provided and code doesn't have one yet, tie them together
  let boundEmail = entry.email;
  if (email && !boundEmail) {
    boundEmail = email.toLowerCase().trim();
    try {
      await writeInvite(code, { ...entry, email: boundEmail });
    } catch (e) {
      // Non-fatal: continue even if write fails
      console.error('Failed to bind email to code:', e);
    }
  }

  // If we have a bound email, check daily usage
  if (boundEmail) {
    // Update tier/preset/emissions if changed
    try {
      await setUsageTier(boundEmail, tier, preset, emissions);
    } catch (e) {
      // Non-fatal: continue even if update fails
    }

    // Check daily limit (0 = unlimited)
    if (dailyLimit !== 0 && dailyLimit !== null && dailyLimit !== undefined) {
      try {
        const usage = await getUsage(boundEmail);
        if (usage.count >= dailyLimit) {
          return sendJson(res, 429, {
            error: 'daily_limit_exceeded',
            limit: dailyLimit,
            used: usage.count,
            resetAt: usage.date + 'T00:00:00Z',
            tier,
            preset,
            emissions,
          });
        }
        // Increment usage
        await incrementUsage(boundEmail, tier, preset, emissions);
      } catch (e) {
        // Non-fatal: allow through if tracking fails
        console.error('Usage tracking failed:', e);
      }
    }
  }

  return sendJson(res, 200, {
    ok: true,
    tier,
    preset,
    emissions,
    dailyLimit: dailyLimit || 'unlimited',
  });
}
