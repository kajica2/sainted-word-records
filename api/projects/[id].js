// api/projects/[id].js — GET/PUT/DELETE a single project.
// Uses Vercel's [id] segment. On local Vite dev, the path is /api/projects/<id>.

import { requireUser } from '../_lib/session.js';
import { getProject, upsertProject, softDeleteProject, rateLimit } from '../_lib/db.js';
import { readJsonBody, sendJson, setCors } from '../_lib/http.js';

export default async function handler(req, res) {
  setCors(res, req.headers.origin);
  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    return res.end();
  }

  const ctx = await requireUser(req, res);
  if (!ctx) return;

  const id = (req.query && req.query.id) || extractFromUrl(req.url);
  if (!id || !/^[a-z0-9-]{8,40}$/i.test(id)) {
    return sendJson(res, 400, { error: 'invalid_id' });
  }

  if (req.method === 'GET') {
    const proj = await getProject(ctx.user.id, id);
    if (!proj) return sendJson(res, 404, { error: 'not_found' });
    return sendJson(res, 200, proj);
  }

  if (req.method === 'PUT') {
    const rl = rateLimit({ key: `proj-write:${ctx.user.id}`, windowMs: 60_000, max: 30 });
    if (!rl.ok) {
      res.setHeader('Retry-After', String(Math.ceil(rl.retryAfterMs / 1000)));
      return sendJson(res, 429, { error: 'rate_limited' });
    }
    const body = await readJsonBody(req, { maxBytes: 2_000_000 });
    if (!body || body.__error) return sendJson(res, 400, { error: 'invalid_body' });
    const meta = await upsertProject(ctx.user.id, id, body);
    return sendJson(res, 200, meta);
  }

  if (req.method === 'DELETE') {
    const rl = rateLimit({ key: `proj-write:${ctx.user.id}`, windowMs: 60_000, max: 30 });
    if (!rl.ok) {
      res.setHeader('Retry-After', String(Math.ceil(rl.retryAfterMs / 1000)));
      return sendJson(res, 429, { error: 'rate_limited' });
    }
    const ok = await softDeleteProject(ctx.user.id, id);
    return sendJson(res, 200, { ok });
  }

  res.setHeader('Allow', 'GET, PUT, DELETE, OPTIONS');
  return sendJson(res, 405, { error: 'method_not_allowed' });
}

function extractFromUrl(url) {
  if (!url) return null;
  // /api/projects/<id> → <id>
  const m = url.match(/\/api\/projects\/([^/?#]+)/);
  return m ? m[1] : null;
}
