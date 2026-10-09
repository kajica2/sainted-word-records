// api/marketplace/index.js — GET list available items, POST claim an item.
//
//   GET  /api/marketplace           → { items } (available items for browsing)
//   GET  /api/marketplace?ticker    → { ticker } (real-time availability data)
//   POST /api/marketplace           → claim an item and add to user's library
//   POST /api/marketplace/create    → create a new marketplace item (seller)
//
// Body (claim): { itemId } — the marketplace item ID to claim.
// Body (create): { type, title, description, creatorType, media, quantity, maxQuantity, lifespanSeconds }
//
// Requires authentication via requireUser. Rate limited.

import { requireUser } from '../_lib/session.js';
import { rateLimit } from '../_lib/db.js';
import { listAvailableItems, claimItem, createClaimItem, getTickerData, getClaimedItems } from '../_lib/marketplace.js';
import { readJsonBody, sendJson, setCors } from '../_lib/http.js';

export default async function handler(req, res) {
  setCors(res, req.headers.origin);
  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    return res.end();
  }

  // Parse URL for all endpoints
  const url = new URL(req.url, 'http://localhost');

  // Handle ticker endpoint - no auth required for public ticker
  if (req.method === 'GET' && url.searchParams.get('ticker') === 'true') {
    const ticker = await getTickerData();
    return sendJson(res, 200, { ticker });
  }

  // Handle public GET without auth (list available items)
  if (req.method === 'GET') {
    const items = await listAvailableItems();
    return sendJson(res, 200, { items });
  }

  const ctx = await requireUser(req, res);
  if (!ctx) return;

  // Handle ?claimed=true to get user's claimed items (auth required)
  if (url.searchParams.get('claimed') === 'true') {
    const claimed = await getClaimedItems(ctx.user.id);
    return sendJson(res, 200, { items: claimed });
  }

  if (req.method === 'POST') {
    // Check if this is a create request
    if (url.pathname.endsWith('/create') || url.searchParams.get('action') === 'create') {
      // Rate limit creates: 10 per minute per user
      const rl = rateLimit({ key: `marketplace-create:${ctx.user.id}`, windowMs: 60_000, max: 10 });
      if (!rl.ok) {
        res.setHeader('Retry-After', String(Math.ceil(rl.retryAfterMs / 1000)));
        return sendJson(res, 429, { error: 'rate_limited' });
      }

      const body = await readJsonBody(req, { maxBytes: 64_000 });
      if (!body || body.__error) {
        return sendJson(res, 400, { error: 'invalid_body' });
      }

      const { type, title, description, creatorType, media, quantity, maxQuantity, lifespanSeconds } = body;
      if (!type || !title || !creatorType) {
        return sendJson(res, 400, { error: 'missing_required_fields' });
      }

      try {
        const item = await createClaimItem({
          type,
          title,
          description: description || '',
          creatorType,
          media: media || [],
          quantity: quantity || 1,
          maxQuantity: maxQuantity || quantity || 1,
          lifespanSeconds: lifespanSeconds || 24 * 60 * 60,
        });
        return sendJson(res, 200, { ok: true, item });
      } catch (e) {
        return sendJson(res, 500, { error: 'create_failed', message: e.message });
      }
    }

    // Rate limit claims: 30 claims per minute per user
    const rl = rateLimit({ key: `marketplace-claim:${ctx.user.id}`, windowMs: 60_000, max: 30 });
    if (!rl.ok) {
      res.setHeader('Retry-After', String(Math.ceil(rl.retryAfterMs / 1000)));
      return sendJson(res, 429, { error: 'rate_limited' });
    }

    const body = await readJsonBody(req, { maxBytes: 64_000 });
    if (!body || body.__error) {
      return sendJson(res, 400, { error: 'invalid_body' });
    }

    const { itemId } = body;
    if (!itemId || typeof itemId !== 'string') {
      return sendJson(res, 400, { error: 'missing_itemId' });
    }

    try {
      const claimedItem = await claimItem({ userId: ctx.user.id, itemId });
      return sendJson(res, 200, { ok: true, item: claimedItem });
    } catch (e) {
      if (e.message === 'item_not_found' || e.message.includes('not found')) {
        return sendJson(res, 404, { error: 'item_not_found' });
      }
      if (e.message === 'already_claimed' || e.message.includes('already claimed')) {
        return sendJson(res, 409, { error: 'already_claimed' });
      }
      if (e.message === 'no_quantity' || e.message.includes('quantity')) {
        return sendJson(res, 410, { error: 'no_quantity_available' });
      }
      if (e.message === 'expired' || e.message.includes('expired')) {
        return sendJson(res, 410, { error: 'item_expired' });
      }
      return sendJson(res, 500, { error: 'claim_failed', message: e.message });
    }
  }

  res.setHeader('Allow', 'GET, POST, OPTIONS');
  return sendJson(res, 405, { error: 'method_not_allowed' });
}
