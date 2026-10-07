// api/catalogue/index.js — GET list my listings, POST create one.
//
//   GET  /api/catalogue    → { items } (my listings, newest first)
//   POST /api/catalogue    → create a listing (song / video / pack)
//
// Body: { type, title, description?, priceMinor, currency?, media?,
//         tags?, bundleOf?, status? } — validated in api/_lib/catalogue.js.
// `media[].key` values come from /api/storage/sign-upload (userId-scoped).
// `bundleOf` groups this seller's listings so they can be sold together.

import { requireUser } from '../_lib/session.js';
import { rateLimit } from '../_lib/db.js';
import { createCatalogItem, listCatalog } from '../_lib/catalogue.js';
import { readJsonBody, sendJson, setCors } from '../_lib/http.js';

export default async function handler(req, res) {
  setCors(res, req.headers.origin);
  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    return res.end();
  }

  const ctx = await requireUser(req, res);
  if (!ctx) return;

  if (req.method === 'GET') {
    const items = await listCatalog(ctx.user.id);
    return sendJson(res, 200, { items });
  }

  if (req.method === 'POST') {
    const rl = rateLimit({ key: `catalogue-write:${ctx.user.id}`, windowMs: 60_000, max: 30 });
    if (!rl.ok) {
      res.setHeader('Retry-After', String(Math.ceil(rl.retryAfterMs / 1000)));
      return sendJson(res, 429, { error: 'rate_limited' });
    }
    const body = await readJsonBody(req, { maxBytes: 64_000 });
    if (!body || body.__error) return sendJson(res, 400, { error: 'invalid_body' });

    try {
      const item = await createCatalogItem({ userId: ctx.user.id, input: body });
      return sendJson(res, 200, { ok: true, item });
    } catch (e) {
      const status = e instanceof TypeError ? 400 : 502;
      return sendJson(res, status, { error: 'invalid_listing', message: e.message });
    }
  }

  res.setHeader('Allow', 'GET, POST, OPTIONS');
  return sendJson(res, 405, { error: 'method_not_allowed' });
}