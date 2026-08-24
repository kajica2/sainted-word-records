// api/health.js — readiness probe; verifies the db is reachable.

import { health } from './_lib/db.js';
import { sendJson, setCors } from './_lib/http.js';

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
  const h = await health();
  return sendJson(res, 200, h);
}
