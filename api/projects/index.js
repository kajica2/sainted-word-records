// api/projects/index.js — GET list, POST create.
// Project doc shape (matches project.js, minus blobs):
//   { id?, name, library?, layers?, fx?, preset?, persona?, scheduler?, panels?, palette?, audio?: { name, type, key, durationSec? }, settings? }

import { requireUser } from '../_lib/session.js';
import { listProjects, upsertProject, rateLimit } from '../_lib/db.js';
import { readJsonBody, sendJson, setCors } from '../_lib/http.js';

const MAX_NAME = 80;

export default async function handler(req, res) {
  setCors(res, req.headers.origin);
  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    return res.end();
  }

  const ctx = await requireUser(req, res);
  if (!ctx) return;

  if (req.method === 'GET') {
    const items = await listProjects(ctx.user.id);
    return sendJson(res, 200, { items });
  }

  if (req.method === 'POST') {
    const rl = rateLimit({ key: `proj-write:${ctx.user.id}`, windowMs: 60_000, max: 30 });
    if (!rl.ok) {
      res.setHeader('Retry-After', String(Math.ceil(rl.retryAfterMs / 1000)));
      return sendJson(res, 429, { error: 'rate_limited' });
    }
    const body = await readJsonBody(req, { maxBytes: 2_000_000 });
    if (!body || body.__error) return sendJson(res, 400, { error: 'invalid_body' });
    const id = body.id || null;
    const name = (body.name || 'Untitled').toString().slice(0, MAX_NAME);
    const doc = { ...body, name };
    const meta = await upsertProject(ctx.user.id, id, doc);
    return sendJson(res, 200, meta);
  }

  res.setHeader('Allow', 'GET, POST, OPTIONS');
  return sendJson(res, 405, { error: 'method_not_allowed' });
}
