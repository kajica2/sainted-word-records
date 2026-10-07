// api/catalogue/[id].js — GET / PATCH / DELETE one listing (owner only).
//
//   GET    /api/catalogue/<id>  → { item } (404 when not found / not owner)
//   PATCH  /api/catalogue/<id>  → { item } partial update (whitelisted fields)
//   DELETE /api/catalogue/<id>  → { ok: true } soft delete

import { requireUser } from '../_lib/session.js';
import { rateLimit } from '../_lib/db.js';
import { getCatalogItem, updateCatalogItem, deleteCatalogItem } from '../_lib/catalogue.js';
import { readJsonBody, sendJson, setCors } from '../_lib/http.js';

const EDITABLE = new Set([
  'title',
  'description',
  'priceMinor',
  'currency',
  'media',
  'tags',
  'bundleOf',
  'status',
]);

export default async function handler(req, res) {
  setCors(res, req.headers.origin);
  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    return res.end();
  }

  const ctx = await requireUser(req, res);
  if (!ctx) return;

  const url = new URL(req.url, 'http://x');
  const id = url.pathname.split('/').filter(Boolean).pop() || '';

  if (req.method === 'GET') {
    const item = await getCatalogItem(ctx.user.id, id);
    if (!item) return sendJson(res, 404, { error: 'not_found' });
    return sendJson(res, 200, { item });
  }

  if (req.method === 'PATCH') {
    const rl = rateLimit({ key: `catalogue-update:${ctx.user.id}`, windowMs: 60_000, max: 60 });
    if (!rl.ok) {
      res.setHeader('Retry-After', String(Math.ceil(rl.retryAfterMs / 1000)));
      return sendJson(res, 429, { error: 'rate_limited' });
    }
    const body = await readJsonBody(req, { maxBytes: 64_000 });
    if (!body || body.__error) return sendJson(res, 400, { error: 'invalid_body' });
    const patch = {};
    for (const k of Object.keys(body)) if (EDITABLE.has(k)) patch[k] = body[k];

    try {
      const item = await updateCatalogItem({ userId: ctx.user.id, id, patch });
      if (!item) return sendJson(res, 404, { error: 'not_found' });
      return sendJson(res, 200, { ok: true, item });
    } catch (e) {
      const status = e instanceof TypeError ? 400 : 502;
      return sendJson(res, status, { error: 'invalid_listing', message: e.message });
    }
  }

  if (req.method === 'DELETE') {
    const rl = rateLimit({ key: `catalogue-delete:${ctx.user.id}`, windowMs: 60_000, max: 30 });
    if (!rl.ok) {
      res.setHeader('Retry-After', String(Math.ceil(rl.retryAfterMs / 1000)));
      return sendJson(res, 429, { error: 'rate_limited' });
    }
    const item = await deleteCatalogItem({ userId: ctx.user.id, id });
    if (!item) return sendJson(res, 404, { error: 'not_found' });
    return sendJson(res, 200, { ok: true, id });
  }

  res.setHeader('Allow', 'GET, PATCH, DELETE, OPTIONS');
  return sendJson(res, 405, { error: 'method_not_allowed' });
}