// api/entrance-analytics.js — POST lightweight entrance funnel beacons.
//
//   POST /api/entrance-analytics
//   Body: { event, page?, detail?, ts? }
//   -> { ok: true }
//
// Public, no auth. Events append to a capped JSON log under DATA_ROOT.
// Rate limit: 120 requests per IP per hour (beacons are cheap; abuse is not).

import { sendJson, clientIp, readJsonBody, setCors } from './_lib/http.js';
import { readJson, writeJson, DATA_ROOT } from './_lib/db.js';

const LOG_FILE = `${DATA_ROOT}/entrance-analytics.json`;
const MAX_EVENTS = 5000;
const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000;
const RATE_LIMIT_MAX = 120;

const rateLimit = new Map();

function checkRateLimit(ip) {
  const now = Date.now();
  const record = rateLimit.get(ip);
  if (!record || now - record.ts > RATE_LIMIT_WINDOW_MS) {
    rateLimit.set(ip, { ts: now, count: 1 });
    return { ok: true };
  }
  if (record.count >= RATE_LIMIT_MAX) {
    return { ok: false, retryAfter: Math.ceil((record.ts + RATE_LIMIT_WINDOW_MS - now) / 1000) };
  }
  record.count++;
  return { ok: true };
}

function sanitizeEvent(body) {
  const event = typeof body?.event === 'string' ? body.event.slice(0, 64) : '';
  if (!event) return null;
  return {
    event,
    page: typeof body.page === 'string' ? body.page.slice(0, 32) : null,
    detail: typeof body.detail === 'string' ? body.detail.slice(0, 120) : null,
    ts: Number.isFinite(body?.ts) ? body.ts : Date.now(),
    at: new Date().toISOString(),
  };
}

export default async function handler(req, res) {
  setCors(res, req.headers?.origin);
  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    res.end();
    return;
  }
  if (req.method !== 'POST') {
    return sendJson(res, 405, { error: 'method_not_allowed' });
  }

  const ip = clientIp(req);
  const rl = checkRateLimit(ip);
  if (!rl.ok) {
    res.setHeader('Retry-After', String(rl.retryAfter));
    return sendJson(res, 429, { error: 'rate_limited' });
  }

  let body;
  try {
    body = await readJsonBody(req);
  } catch {
    return sendJson(res, 400, { error: 'invalid_json' });
  }

  const row = sanitizeEvent(body);
  if (!row) {
    return sendJson(res, 400, { error: 'missing_event' });
  }

  try {
    const log = await readJson(LOG_FILE, { events: [] });
    if (!Array.isArray(log.events)) log.events = [];
    log.events.push(row);
    if (log.events.length > MAX_EVENTS) {
      log.events = log.events.slice(-MAX_EVENTS);
    }
    await writeJson(LOG_FILE, log);
  } catch {
    // Accept the beacon even if persistence fails (offline dev, read-only FS).
  }

  return sendJson(res, 200, { ok: true });
}
