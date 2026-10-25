// api/catalogue/public.js — GET the PUBLIC browse view (no auth).
//
// Live listings across all sellers, buyer-shaped (no seller identity, no
// media keys). This is what /buy renders. Read-only + rate limited per-IP.

import { rateLimit } from '../_lib/db.js';
import { listLiveCatalog } from '../_lib/catalogue.js';
import { sendJson, setCors, clientIp } from '../_lib/http.js';

export default async function handler(req, res) {
  setCors(res, req.headers.origin);
  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    return res.end();
  }
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET, OPTIONS');
    return sendJson(res, 405, { error: 'method_not_allowed' });
  }

  // The bucket key comes from clientIp(): `x-forwarded-for` only counts when a
  // trusted proxy wrote it, so this is a per-IP limit and not a per-header one.
  const ip = clientIp(req);
  const rl = rateLimit({ key: `catalogue-public:${ip}`, windowMs: 60_000, max: 120 });
  if (!rl.ok) {
    res.setHeader('Retry-After', String(Math.ceil(rl.retryAfterMs / 1000)));
    return sendJson(res, 429, { error: 'rate_limited' });
  }

  const items = await listLiveCatalog();
  return sendJson(res, 200, { items });
}