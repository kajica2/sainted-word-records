// api/projects/share/[shareId].js — P3.4 anonymous public-share endpoint.
// GET /api/projects/share/<shareId> — returns the project doc for a
// publicly-shared project. No auth required. Returns 404 if the share
// isn't found or has been revoked (share:false).
//
// This file is registered via Vercel's directory-based routing: any path
// matching /api/projects/share/[shareId].js maps to /api/projects/share/<id>.
// On local Vite dev, the dev-api.mjs middleware handles the same paths
// via filesystem matching.

import { getSharedProject } from '../../../_lib/db.js';
import { sendJson, setCors } from '../../../_lib/http.js';

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

  // shareId can come from query (?id=...) or the URL path. Vercel's
  // directory routing gives us the segment in the second match.
  const shareId =
    (req.query && req.query.id) ||
    extractFromUrl(req.url) ||
    '';
  if (!shareId || !/^[a-z0-9_-]{4,24}$/i.test(shareId)) {
    return sendJson(res, 400, { error: 'invalid_share_id' });
  }

  const proj = await getSharedProject(shareId);
  if (!proj) return sendJson(res, 404, { error: 'not_found' });

  // Cache-Control: shared projects are immutable once published, so
  // 5-minute cache is safe and saves bandwidth for popular shares.
  res.setHeader('Cache-Control', 'public, max-age=300');
  return sendJson(res, 200, proj);
}

function extractFromUrl(url) {
  if (!url) return null;
  // /api/projects/share/<id> → <id>
  const m = url.match(/\/api\/projects\/share\/([^/?#]+)/);
  return m ? m[1] : null;
}
