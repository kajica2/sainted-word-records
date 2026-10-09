// api/early-access.js — POST { email } → { ok: true }
//
// Public endpoint for requesting early access. Stores email in a simple
// list that admins can review. Uses the existing kv store.
//
// Rate limit: 5 requests per IP per hour to prevent abuse.

import { sendJson } from './_lib/http.js';
import { readJson, writeJson } from './_lib/db.js';
import { join, DATA_ROOT } from './_lib/paths.js';

const EARLY_ACCESS_FILE = join(DATA_ROOT, 'early-access-requests.json');

// Simple rate limiter (in-memory, per-instance)
const rateLimit = new Map();
const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000; // 1 hour
const RATE_LIMIT_MAX = 5;

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

function isValidEmail(email) {
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email);
}

export default async function handler(req, res) {
  // Only POST allowed
  if (req.method !== 'POST') {
    return sendJson(res, 405, { error: 'method_not_allowed' });
  }

  // Rate limit
  const ip = (req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown').split(',')[0].trim();
  const rl = checkRateLimit(ip);
  if (!rl.ok) {
    res.setHeader('Retry-After', String(rl.retryAfter));
    return sendJson(res, 429, { error: 'rate_limited' });
  }

  // Parse body
  let body;
  try {
    body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
  } catch {
    return sendJson(res, 400, { error: 'invalid_json' });
  }

  const { email } = body || {};
  
  // Validate email
  if (!email || typeof email !== 'string') {
    return sendJson(res, 400, { error: 'email_required' });
  }

  const normalizedEmail = email.trim().toLowerCase();
  if (!isValidEmail(normalizedEmail)) {
    return sendJson(res, 400, { error: 'invalid_email' });
  }

  // Read existing requests
  let requests = [];
  try {
    requests = await readJson(EARLY_ACCESS_FILE, []);
  } catch {
    requests = [];
  }

  // Check if already exists
  const exists = requests.some(r => r.email === normalizedEmail);
  if (exists) {
    // Don't reveal that the email already exists (security)
    return sendJson(res, 200, { ok: true, message: 'You\'re on the list!' });
  }

  // Add new request
  requests.push({
    email: normalizedEmail,
    requestedAt: new Date().toISOString(),
    source: req.headers.referer || 'unknown'
  });

  // Save
  try {
    await writeJson(EARLY_ACCESS_FILE, requests);
  } catch (e) {
    console.error('[early-access] write failed:', e);
    return sendJson(res, 500, { error: 'internal_error' });
  }

  return sendJson(res, 200, { ok: true, message: 'You\'re on the list!' });
}
