// api/storage/sign-download.js — POST { key } → { downloadUrl, expiresAt }
// Used by clients to refresh expired signed URLs.

import { requireUser } from '../_lib/session.js';
import { readSignedDownload, rateLimit } from '../_lib/db.js';
import { readJsonBody, sendJson, setCors } from '../_lib/http.js';

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

  const ctx = await requireUser(req, res);
  if (!ctx) return;

  const rl = rateLimit({ key: `sign-download:${ctx.user.id}`, windowMs: 60_000, max: 120 });
  if (!rl.ok) {
    res.setHeader('Retry-After', String(Math.ceil(rl.retryAfterMs / 1000)));
    return sendJson(res, 429, { error: 'rate_limited' });
  }

  const body = await readJsonBody(req);
  const key = body && body.key && String(body.key).trim();
  if (!key) return sendJson(res, 400, { error: 'missing_key' });

  try {
    const signed = await readSignedDownload(ctx.user.id, key);
    return sendJson(res, 200, signed);
  } catch (e) {
    return sendJson(res, 400, { error: 'invalid_key', message: e.message });
  }
}
