// api/storage/sign-upload.js — POST { key, contentType } → { uploadUrl, key, ... }
// The uploadUrl is a signed URL the client PUTs to. In the local-fs
// backing, that's just /api/storage/object?key=<userId>/<key>. In a real
// R2/S3 backing, the client PUTs directly to the bucket.

import { requireUser } from '../_lib/session.js';
import { createSignedUpload, rateLimit } from '../_lib/db.js';
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

  const rl = rateLimit({ key: `sign-upload:${ctx.user.id}`, windowMs: 60_000, max: 60 });
  if (!rl.ok) {
    res.setHeader('Retry-After', String(Math.ceil(rl.retryAfterMs / 1000)));
    return sendJson(res, 429, { error: 'rate_limited' });
  }

  const body = await readJsonBody(req);
  const key = body && body.key && String(body.key).trim();
  const contentType = (body && body.contentType) || 'application/octet-stream';
  if (!key) return sendJson(res, 400, { error: 'missing_key' });
  if (key.length > 256) return sendJson(res, 400, { error: 'key_too_long' });

  try {
    const signed = await createSignedUpload(ctx.user.id, key, contentType);
    return sendJson(res, 200, signed);
  } catch (e) {
    return sendJson(res, 400, { error: 'invalid_key', message: e.message });
  }
}
