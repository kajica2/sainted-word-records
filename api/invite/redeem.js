// api/invite/redeem.js — POST { code } → { ok: true } | 404
//
// Public endpoint, no auth required. The visitor pastes an invite code
// (admin-issued via scripts/grant-invite.mjs) and the server tells them
// if it's valid. Successful redemption flips the forced-rec watermark
// off in the visitor's browser (lib/invite-unlock.client.js owns the
// localStorage flag + SWR_WATERMARK.setEnabled(false) call).
//
// Codes are first-come/first-served and reusable: once an admin issues
// a code with `enabled: true`, every visitor who redeems it gets the
// unlock. There is no per-user ledger; this is a license, not a
// single-use token. Disabling a code means flipping enabled to false.
//
// KV env: UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN. If either is
// missing, the endpoint returns 503 with a clear error so the operator can
// fix it instead of leaking a generic 500.

import { readJsonBody, sendJson, setCors } from '../_lib/http.js';
import { rateLimit } from '../_lib/db.js';
import { normalizeCode, readInvite } from '../_lib/kv.js';

const MAX_BODY_BYTES = 1024; // a code is at most ~32 bytes

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
  if (!code) return sendJson(res, 400, { error: 'invalid_code' });

  let entry;
  try {
    entry = await readInvite(code);
  } catch (e) {
    // KV missing / misconfigured — distinct from "code not found" so the
    // operator can tell the two apart in their logs.
    const msg = String(e && e.message || e);
    if (/KV_REST_API|KV_|@vercel\/kv|@upstash/i.test(msg)) {
      return sendJson(res, 503, { error: 'invite_store_unavailable' });
    }
    return sendJson(res, 500, { error: 'internal_error' });
  }
  if (!entry || entry.enabled === false) {
    return sendJson(res, 404, { error: 'invalid_or_disabled_code' });
  }
  return sendJson(res, 200, { ok: true });
}
