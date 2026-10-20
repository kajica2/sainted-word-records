// api/kits/index.js — GET list, POST create a kit.
//
// A kit is a named bundle that resolves to a single .zip download URL.
// POST creates a new kit by reading the items manifest the client
// supplies (kind, name, url-or-storageKey, size) and either storing them
// in object storage OR — when SWR_PROJECTS_STORE=firestore — recording
// them in the kits/ Firestore collection with the zip URL hosted in
// Cloud Storage.
//
// The kit list endpoint mirrors projects — same auth, same soft-delete
// filter (deleted rows are still in IDB but hidden until includeDeleted).
//
// Project shape (POST body):
//   {
//     name: 'My Sound Pack',
//     items: [
//       { kind: 'audio',  name: 'song.mp3',    storageKey: 'u123/songs/song.mp3' },
//       { kind: 'image',  name: 'holo-0.webp', storageKey: 'u123/lib/holo-0.webp' },
//       { kind: 'project',name: 'mix.swr-project', inlineBase64: '...' },
//     ],
//   }

import { requireUser } from '../_lib/session.js';
import { listKits, upsertKit, rateLimit } from '../_lib/db.js';
import { projectsBackend } from '../_lib/projects-store.js';
import { readJsonBody, sendJson, setCors } from '../_lib/http.js';

const MAX_NAME = 80;
const MAX_ITEMS = 256;
const MAX_ITEM_NAME = 120;

export default async function handler(req, res) {
  setCors(res, req.headers.origin);
  if (req.method === 'OPTIONS') { res.statusCode = 204; return res.end(); }

  const ctx = await requireUser(req, res);
  if (!ctx) return;

  if (req.method === 'GET') {
    const items = await listKits(ctx.user.id);
    return sendJson(res, 200, { items });
  }

  if (req.method === 'POST') {
    const rl = rateLimit({ key: `kit-write:${ctx.user.id}`, windowMs: 60_000, max: 30 });
    if (!rl.ok) {
      res.setHeader('Retry-After', String(Math.ceil(rl.retryAfterMs / 1000)));
      return sendJson(res, 429, { error: 'rate_limited' });
    }
    const body = await readJsonBody(req, { maxBytes: 4_000_000 });
    if (!body || body.__error) return sendJson(res, 400, { error: 'invalid_body' });
    const name = (body.name || 'Untitled kit').toString().slice(0, MAX_NAME);
    const items = Array.isArray(body.items) ? body.items.slice(0, MAX_ITEMS).map(sanitizeItem) : [];
    const doc = { ...body, name, items };
    const meta = await upsertKit(ctx.user.id, body.id || null, doc);
    if (!meta) return sendJson(res, 409, { error: 'ownership_conflict' });
    return sendJson(res, 200, { meta, backend: projectsBackend() });
  }

  res.setHeader('Allow', 'GET, POST, OPTIONS');
  return sendJson(res, 405, { error: 'method_not_allowed' });
}

// Drop unknown fields, enforce name length, and make sure no base64 is
// bulk-loaded — project items are allowed inline at the POST layer for
// the engine to round-trip a single mix, but we cap their decoded size.
function sanitizeItem(it) {
  if (!it || typeof it !== 'object') return null;
  const kind = String(it.kind || '').toLowerCase();
  if (kind !== 'audio' && kind !== 'image' && kind !== 'video' && kind !== 'project') return null;
  const out = { kind };
  out.name = String(it.name || '').slice(0, MAX_ITEM_NAME);
  if (it.storageKey) out.storageKey = String(it.storageKey).slice(0, 256);
  if (kind === 'project' && it.inlineBase64) {
    // Cap the inline project payload at 1 MiB decoded.
    const b64Len = String(it.inlineBase64).length;
    if (b64Len > 1_400_000) return null;
    out.inlineBase64 = String(it.inlineBase64);
  }
  if (Number.isFinite(it.size)) out.size = it.size;
  return out;
}
