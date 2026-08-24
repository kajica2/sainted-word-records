// api/storage/object.js — PUT/GET/HEAD/DELETE backed by the local file store.
// In production with R2/S3, this endpoint would not exist; clients would
// PUT/GET directly to the signed bucket URL. In the dev slice, we route
// through here so the client code is identical.

import { requireUser } from '../_lib/session.js';
import { storagePut, storageGet, storageHead, storageDelete, rateLimit, safeKey } from '../_lib/db.js';
import { setCors, send } from '../_lib/http.js';

function parseKey(req) {
  // key may come via ?key=... query string
  let key = req.query && req.query.key;
  if (!key && req.url) {
    try {
      const u = new URL(req.url, 'http://x');
      key = u.searchParams.get('key');
    } catch {}
  }
  return key ? String(key) : null;
}

export const config = {
  api: {
    // Allow larger bodies for audio uploads (up to 50 MB)
    bodyParser: false,
  },
};

export default async function handler(req, res) {
  setCors(res, req.headers.origin);
  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    return res.end();
  }

  const ctx = await requireUser(req, res);
  if (!ctx) return;

  const rl = rateLimit({ key: `storage:${ctx.user.id}`, windowMs: 60_000, max: 60 });
  if (!rl.ok && req.method !== 'HEAD' && req.method !== 'GET') {
    res.setHeader('Retry-After', String(Math.ceil(rl.retryAfterMs / 1000)));
    res.statusCode = 429;
    res.setHeader('Content-Type', 'application/json');
    return res.end(JSON.stringify({ error: 'rate_limited' }));
  }

  const fullKey = parseKey(req);
  if (!fullKey) {
    return send(res, 400, { error: 'missing_key' });
  }

  // Enforce user scoping: the signed-URL builder always prefixes userId.
  // We re-check here to defend against tampered queries.
  if (!fullKey.startsWith(ctx.user.id + '/')) {
    return send(res, 403, { error: 'key_outside_user_scope' });
  }
  try {
    safeKey(fullKey.slice(ctx.user.id.length + 1));
  } catch (e) {
    return send(res, 400, { error: 'invalid_key', message: e.message });
  }

  if (req.method === 'PUT') {
    // Read raw body, cap at 50 MB (audio + clips)
    const MAX = 50 * 1024 * 1024;
    const chunks = [];
    let total = 0;
    let aborted = false;
    await new Promise((resolve) => {
      req.on('data', (c) => {
        if (aborted) return;
        total += c.length;
        if (total > MAX) {
          aborted = true;
          req.destroy();
          resolve();
          return;
        }
        chunks.push(c);
      });
      req.on('end', resolve);
      req.on('error', resolve);
    });
    if (aborted) {
      return send(res, 413, { error: 'payload_too_large', max: MAX });
    }
    const buf = Buffer.concat(chunks);
    const contentType = req.headers['content-type'] || 'application/octet-stream';
    const result = await storagePut(ctx.user.id, fullKey, buf, contentType);
    return send(res, 200, result);
  }

  if (req.method === 'GET') {
    const obj = await storageGet(ctx.user.id, fullKey);
    if (!obj) return send(res, 404, { error: 'not_found' });
    res.setHeader('Content-Length', String(obj.size));
    res.setHeader('Content-Type', guessMime(fullKey));
    res.setHeader('Cache-Control', 'private, max-age=300');
    res.statusCode = 200;
    return res.end(obj.body);
  }

  if (req.method === 'HEAD') {
    const meta = await storageHead(ctx.user.id, fullKey);
    if (!meta) return send(res, 404, '');
    res.setHeader('Content-Length', String(meta.size));
    res.setHeader('Content-Type', guessMime(fullKey));
    res.statusCode = 200;
    return res.end();
  }

  if (req.method === 'DELETE') {
    const ok = await storageDelete(ctx.user.id, fullKey);
    return send(res, 200, { ok });
  }

  res.setHeader('Allow', 'GET, HEAD, PUT, DELETE, OPTIONS');
  return send(res, 405, { error: 'method_not_allowed' });
}

function guessMime(key) {
  const k = key.toLowerCase();
  if (k.endsWith('.mp3')) return 'audio/mpeg';
  if (k.endsWith('.wav')) return 'audio/wav';
  if (k.endsWith('.m4a')) return 'audio/mp4';
  if (k.endsWith('.ogg')) return 'audio/ogg';
  if (k.endsWith('.flac')) return 'audio/flac';
  if (k.endsWith('.mp4')) return 'video/mp4';
  if (k.endsWith('.webm')) return 'video/webm';
  if (k.endsWith('.mov')) return 'video/quicktime';
  if (k.endsWith('.jpg') || k.endsWith('.jpeg')) return 'image/jpeg';
  if (k.endsWith('.png')) return 'image/png';
  if (k.endsWith('.webp')) return 'image/webp';
  if (k.endsWith('.gif')) return 'image/gif';
  if (k.endsWith('.json')) return 'application/json; charset=utf-8';
  return 'application/octet-stream';
}
