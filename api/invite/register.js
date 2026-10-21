// api/invite/register.js — admin registration of invite codes.
//
// POST { secret, code, label?, email?, tier?, dailyLimit?, preset?, emissions? } → { ok: true }
//
// Used by the GitHub Actions invite-codes workflow to register codes from
// data/invite-codes.csv. The secret must match INVITE_ADMIN_SECRET env var.
// Once registered, codes work with the normal /api/invite/redeem endpoint.
//
// New v2 fields for tiered access:
//   - email: tied to this email after first redemption
//   - tier: "free" | "basic" | "pro" | "unlimited"
//   - dailyLimit: generations per day (0 = unlimited)
//   - preset: "RAW" | "HD" | "CLEAN"
//   - emissions: 0-100 intensity
//
// Env: INVITE_ADMIN_SECRET must be set (and stored as a GitHub Secret).

import { readJsonBody, sendJson, setCors } from '../_lib/http.js';
import { normalizeCode, writeInvite, writeEmailIndex } from '../_lib/kv.js';

const ADMIN_SECRET = process.env.INVITE_ADMIN_SECRET || '';
const MAX_BODY_BYTES = 2048;

const VALID_TIERS = ['free', 'basic', 'pro', 'unlimited'];
const VALID_PRESETS = ['RAW', 'HD', 'CLEAN'];
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
  if (!ADMIN_SECRET) {
    return sendJson(res, 503, { error: 'admin_not_configured' });
  }

  let body;
  try {
    body = await readJsonBody(req, { maxBytes: MAX_BODY_BYTES });
  } catch (e) {
    return sendJson(res, 400, { error: 'invalid_body' });
  }

  const { secret, code, label, email, tier, dailyLimit, preset, emissions } = body || {};
  if (secret !== ADMIN_SECRET) {
    return sendJson(res, 401, { error: 'unauthorized' });
  }

  const normalized = normalizeCode(code);
  if (!normalized) {
    return sendJson(res, 400, { error: 'invalid_code' });
  }

  // Validate optional fields
  if (email !== undefined && email !== null && email !== '') {
    if (typeof email !== 'string' || !EMAIL_RE.test(email)) {
      return sendJson(res, 400, { error: 'invalid_email' });
    }
  }

  if (tier !== undefined && tier !== null) {
    if (typeof tier !== 'string' || !VALID_TIERS.includes(tier)) {
      return sendJson(res, 400, { error: 'invalid_tier', valid: VALID_TIERS });
    }
  }

  if (preset !== undefined && preset !== null) {
    if (typeof preset !== 'string' || !VALID_PRESETS.includes(preset)) {
      return sendJson(res, 400, { error: 'invalid_preset', valid: VALID_PRESETS });
    }
  }

  if (emissions !== undefined && emissions !== null) {
    if (typeof emissions !== 'number' || emissions < 0 || emissions > 100) {
      return sendJson(res, 400, { error: 'invalid_emissions', hint: '0-100' });
    }
  }

  // Build entry with v2 fields
  const entry = {
    enabled: true,
    createdAt: new Date().toISOString(),
    label: typeof label === 'string' ? label.slice(0, 200) : null,
    // v2 fields
    email: typeof email === 'string' ? email.toLowerCase().trim() : null,
    tier: VALID_TIERS.includes(tier) ? tier : 'free',
    dailyLimit: typeof dailyLimit === 'number' ? Math.max(0, Math.floor(dailyLimit)) : (tier === 'unlimited' ? 0 : null),
    preset: VALID_PRESETS.includes(preset) ? preset : 'RAW',
    emissions: typeof emissions === 'number' ? Math.max(0, Math.min(100, Math.floor(emissions))) : 30,
  };

  try {
    await writeInvite(normalized, entry);
    return sendJson(res, 200, { ok: true, code: normalized });
  } catch (e) {
    const msg = String((e && e.message) || e);
    // kv_unavailable is thrown by kv.js when the store (Postgres / files)
    // is unreachable — a transient outage, worth a 503 so the workflow
    // retries rather than recording a permanent failure.
    if (msg === 'kv_unavailable' || /KV_REST_API|KV_|@vercel\/kv|@upstash|upstash|ECONNREFUSED/i.test(msg)) {
      return sendJson(res, 503, { error: 'kv_unavailable' });
    }
    return sendJson(res, 500, { error: 'registration_failed', detail: msg });
  }
}
