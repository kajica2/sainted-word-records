// api/invite/register.js — admin registration of invite codes.
//
// POST { secret, code, label? } → { ok: true }
//
// Used by the GitHub Actions invite-codes workflow to register codes from
// data/invite-codes.csv. The secret must match INVITE_ADMIN_SECRET env var.
// Once registered, codes work with the normal /api/invite/redeem endpoint.
//
// Env: INVITE_ADMIN_SECRET must be set (and stored as a GitHub Secret).

import { readJsonBody, sendJson, setCors } from '../_lib/http.js';
import { normalizeCode, writeInvite, writeEmailIndex } from '../_lib/kv.js';

const ADMIN_SECRET = process.env.INVITE_ADMIN_SECRET || '';
const MAX_BODY_BYTES = 2048;

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

  const { secret, code, label } = body || {};
  if (secret !== ADMIN_SECRET) {
    return sendJson(res, 401, { error: 'unauthorized' });
  }

  const normalized = normalizeCode(code);
  if (!normalized) {
    return sendJson(res, 400, { error: 'invalid_code' });
  }

  const entry = {
    enabled: true,
    createdAt: new Date().toISOString(),
    label: typeof label === 'string' ? label.slice(0, 200) : null,
  };

  try {
    await writeInvite(normalized, entry);
    return sendJson(res, 200, { ok: true, code: normalized });
  } catch (e) {
    const msg = String(e && e.message || e);
    // kv_unavailable is thrown directly by kv.js when Upstash is unreachable.
    if (msg === 'kv_unavailable' || /KV_REST_API|KV_|@vercel\/kv|@upstash|upstash|ECONNREFUSED/i.test(msg)) {
      return sendJson(res, 503, { error: 'kv_unavailable' });
    }
    return sendJson(res, 500, { error: 'registration_failed', detail: msg });
  }
}
