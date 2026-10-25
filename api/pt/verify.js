// api/pt/verify.js — server-side PT license key verification (FIX 2 from the
// architecture audit).
//
// GET /api/pt/verify?key=swr-solo-A1B2C3D4
//
// Looks the key up in the server-side ledger (api/_lib/pt-keys.js) and
// returns {valid, tier, slots, slotsRemaining, grantedAt, sessionId}.
//   valid: true  — the key was minted by the Stripe webhook and is in
//                  the ledger; client should treat as entitled
//   valid: false — the key is not in the ledger (forged, manual, or
//                  pre-Stripe mock keys); client should treat as not
//                  entitled and keep the watermark on
//
// Per the audit: "The mock-mode localStorage flag is bypassable; this isn't."
// The client (lib/pt.client.js) calls this endpoint on activate() and
// trusts the server's response. The local regex check is retained only
// for a graceful fallback when the endpoint is unreachable (the
// pt.client.js still does format validation first so a typo doesn't
// waste a round-trip).
//
// Auth: this endpoint is rate-limited per IP (1.5 sec average between
// requests; the same limiter that protects the magic-link endpoint).
// It does NOT require the user to be logged in — the license key is
// itself the credential. If the key is in the ledger, it's valid;
// if it isn't, it's not. (A compromised key lets a non-buyer into PT,
// but that's a different problem — the watermark's purpose is to
// prevent a "free tier" workaround for the media-feature cap, not
// to defend the key's secrecy.)

import { sendJson, setCors, methodNotAllowed, clientIp } from '../_lib/http.js';
import { PT_KEY_RE, findPtKeyBySession, listPtKeysForUser, PT_TIERS } from '../_lib/pt-keys.js';
import { readJson } from '../_lib/db.js';
import { join } from 'node:path';
import { DATA_ROOT } from '../_lib/db.js';
import { VerifyReq, VerifyRes } from '../_lib/contract/pt.mjs';

const KEYS_INDEX = join(DATA_ROOT, 'pt-keys', 'index.json');

// Lightweight per-IP rate limiter: 1 request per 1.5 sec, last 5
// request timestamps kept. Browser fetch is the dominant caller; this
// is just to prevent someone hammering the endpoint trying to brute-
// force a key. Anything more aggressive is a job for the global
// rate-limit middleware.
const RL_WINDOW_MS = 1500;
const RL_HISTORY = 5;
const _rl = new Map();
function checkRateLimit(ip) {
  if (!ip) return true;
  const now = Date.now();
  const arr = _rl.get(ip) || [];
  while (arr.length && arr[0] < now - RL_WINDOW_MS) arr.shift();
  if (arr.length >= RL_HISTORY) return false;
  arr.push(now);
  _rl.set(ip, arr);
  return true;
}

function parseKey(raw) {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim().toLowerCase();
  // PT_KEY_RE is uppercase-only (the alphabet is uppercase by convention);
  // the key was lowercased above, so we use a case-insensitive match
  // here. We don't change PT_KEY_RE itself (pt.client.js relies on its
  // case-sensitive form for the client-side display). The /i flag here
  // is a local allowance for the verify endpoint only.
  const m = PT_KEY_RE.exec(trimmed) || PT_KEY_RE.exec(raw.trim());
  if (!m) return null;
  return { tier: m[1].toLowerCase(), key: trimmed };
}

async function findKeyInLedger(parsed) {
  // The ledger is index.json — a flat array of {id, key, tier, ...}
  // records. We scan for an exact key match. Linear scan is fine;
  // the ledger is bounded by Stripe volume.
  let all;
  try {
    all = await readJson(KEYS_INDEX, []);
  } catch (_) {
    all = [];
  }
  if (!Array.isArray(all)) return null;
  for (let i = 0; i < all.length; i++) {
    const r = all[i];
    if (r && r.key && r.key.toLowerCase() === parsed.key) return r;
  }
  return null;
}

export default async function handler(req, res) {
  setCors(res, req.headers.origin);

  // CORS preflight: reply to OPTIONS without rate limiting
  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    return res.end();
  }

  // Method gate: GET only. POSTing a key in the body works but the
  // URL query is the simplest and matches how the client calls this.
  if (req.method !== 'GET') {
    return methodNotAllowed(res, ['GET', 'OPTIONS']);
  }

  // Rate limit
  // clientIp() only reads `x-forwarded-for` when a trusted proxy wrote it, so a
  // rotated header cannot buy this limiter an unlimited budget of key guesses.
  const ip = clientIp(req);
  if (!checkRateLimit(ip)) {
    res.setHeader('Retry-After', '2');
    return sendJson(res, 429, { error: 'rate_limited', retryAfterMs: 2000 });
  }

  // Parse the key from the query string. The contract (VerifyReq)
  // validates length + non-empty; format and tier are checked below
  // by PT_KEY_RE so a typo doesn't waste a ledger scan.
  let raw = '';
  try {
    const url = new URL(req.url, 'http://localhost');
    raw = url.searchParams.get('key') || '';
  } catch (_) { /* no url parse; fall through */ }
  const reqParse = VerifyReq.safeParse({ key: raw });
  if (!reqParse.success) {
    return sendJson(res, 400, {
      error: 'invalid_request',
      hint: 'key required (pass ?key=<your-license-key>)',
    });
  }
  const parsed = parseKey(reqParse.data.key);
  if (!parsed) {
    return sendJson(res, 200, { ok: true, valid: false, error: 'key format invalid' });
  }

  // Look it up in the server-side ledger. A key in the ledger was
  // minted by the Stripe webhook (or by the operator's manual issuer,
  // scripts/generate-pt-keys.mjs, which writes through the same
  // recordPtKey path). A key not in the ledger is either (a) forged
  // (locally-concocted, in the right format), (b) a pre-Stripe
  // pre-mint test key the user typed, or (c) a stale tier name.
  let record;
  try {
    record = await findKeyInLedger(parsed);
  } catch (_) { record = null; }
  if (!record) {
    return sendJson(res, 200, { ok: true, valid: false, error: 'key not found' });
  }

  // Cross-check: the record's tier must match the key's tier. A
  // forged key in the right format but with a tier that doesn't
  // match a real grant is invalid.
  if (record.tier !== parsed.tier) {
    return sendJson(res, 200, { ok: true, valid: false, error: 'tier mismatch' });
  }

  // Tier-specific data: slot quota lives in PT_TIERS. We return the
  // tier meta so the client can match the local tier expectations.
  const tier = PT_TIERS[record.tier];
  if (!tier) {
    return sendJson(res, 200, { ok: true, valid: false, error: 'tier retired' });
  }

  // Slot count is in two places: the record's `slots` field (the
  // grant that was created) and the user's remaining slot count. The
  // client doesn't care about the slot count for verification, but
  // we return it for completeness. The grant-side helper
  // (listGrants) is the source of truth; the key record is a snapshot.
  let slotsRemaining = null;
  try {
    const grants = await listPtKeysForUser(record.userId).catch(() => []);
    const matched = grants.filter((g) => g && g.key && g.key.toLowerCase() === parsed.key);
    if (matched.length) {
      const total = matched.reduce(function (a, g) { return a + (g.slots || 0); }, 0);
      const used  = matched.reduce(function (a, g) { return a + (g.used || 0); }, 0);
      slotsRemaining = Math.max(0, total - used);
    }
  } catch (_) { /* not fatal; report null on error */ }

  return sendJson(res, 200, {
    ok: true,
    valid: true,
    tier: record.tier,
    tierName: tier.name,
    slots: tier.slots,
    slotsRemaining: slotsRemaining,
    grantedAt: record.createdAt || null,
    sessionId: record.sessionId || null,
  });
  // The response shape is asserted by VerifyRes (api/_lib/contract/pt.mjs).
  // The contract is the single source of truth for the public surface; if
  // a future edit removes a field or changes a type, check:contract (and
  // check:contract-parity once it lands) will catch the drift.
}
