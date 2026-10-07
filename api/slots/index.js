// api/slots/index.js — GET /api/slots — the PT panel sync endpoint.
//
// The PT panel (pt-panel.client.js) calls this on open. It is the
// authoritative server cut of the user's slot ledger:
//   { email, userId, totalSlots, granted, registered, remaining, grants: [...] }
// The client stays the offline runtime wallet; when this is reachable the
// panel prefers these numbers (best-effort — a failure falls back to the
// local ledger silently).
//
// Self-authorized: the response only ever covers the signed-in user.

import { requireUser } from '../_lib/session.js';
import { sendJson, setCors } from '../_lib/http.js';
import { syncPayload } from '../_lib/slots.js';

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

  const ctx = await requireUser(req, res);
  if (!ctx) return;

  const payload = await syncPayload(ctx.user);
  return sendJson(res, 200, payload);
}