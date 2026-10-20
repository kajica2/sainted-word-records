// api/license/verify.js : POST /api/license/verify { code } -> server-side
// Personal Tier license verification (P0.3 in
// docs/PLANS/architecture-audit-2026-10.md).
//
// The client wallet (pt.client.js) stores its PT license in localStorage, so
// "is this person a PT customer" used to be a boolean anyone could flip with
// one devtools call. The Stripe webhook (api/webhooks/stripe.js ->
// api/_lib/pt-keys.js) already mints keys server-side and records each one in
// the ledger. This route is the missing half: it answers "is this key real, and
// what does it entitle the holder to" from the ledger, so localStorage becomes
// a cache rather than the source of truth.
//
// POST /api/license/verify  { code: "swr-band-A1B2C3D4" }
//   200 { valid: true,  tier, tierName, creditsRemaining, slotCount,
//         slotsRemaining, grantedAt }
//   200 { valid: false, reason: "unknown_code" | "expired" }
//   400 { valid: false, reason: "invalid_request" }
//   405 { error: "method_not_allowed" }
//   429 { error: "rate_limited", retryAfterMs }
//
// Key format is unchanged: `swr-{tier}-{8 alnum}` where the alphabet is the
// Crockford-ish set in api/_lib/pt-keys.js (no I/O/0/1) and tier is one of
// solo / band / label. Reusing PT_KEY_RE keeps this route compatible with every
// key the webhook and the operator issuer (scripts/generate-pt-keys.mjs) have
// ever written. There is no breaking change.
//
// Deliberate non-disclosure: a revoked or malformed key answers "unknown_code"
// rather than a distinct reason, so the endpoint cannot be used to probe which
// key strings exist. "expired" is the one exception because the buyer has to be
// able to tell a dead key from a fake one.
//
// Auth: none. The license key is itself the credential. A leaked key lets a
// non-buyer into PT; that is the same trust model the paid-slot ledger already
// documents, and it is strictly better than a forgeable localStorage boolean.

import { readJsonBody, sendJson, setCors } from '../_lib/http.js';
import { rateLimit, readJson } from '../_lib/db.js';
import { PT_KEY_RE, PT_TIERS, keysIndexPath } from '../_lib/pt-keys.js';
import { getSlotState } from '../_lib/slots.js';

const MAX_BODY_BYTES = 512; // a code is at most ~20 bytes

// Per-code budget. A legitimate client verifies on load and after every
// credits-debit; the client-side 5 minute cache keeps that well under this.
const CODE_WINDOW_MS = 60_000;
const CODE_MAX = 10;
// Coarser per-IP budget so a sweep across many codes is still bounded.
const IP_WINDOW_MS = 60_000;
const IP_MAX = 60;

function clientIp(req) {
  const raw = (req.headers && req.headers['x-forwarded-for']) ||
    (req.socket && req.socket.remoteAddress) || 'unknown';
  return String(raw).split(',')[0].trim() || 'unknown';
}

// Normalise to the canonical minted form. The client's localStorage lowercases
// keys on the way in and an operator may type one in either case, so the
// lookup is case-insensitive. Note that PT_KEY_RE is anchored on a lowercase
// `swr-` prefix with an uppercase code segment, so the whole string cannot be
// uppercased before matching: the case-insensitive twin below does the match
// and each segment is then normalised individually.
const PT_KEY_RE_CI = new RegExp(PT_KEY_RE.source, 'i');

function parseCode(raw) {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (!trimmed || trimmed.length > 64) return null;
  const m = PT_KEY_RE_CI.exec(trimmed);
  if (!m) return null;
  // PT_KEY_RE captures only the tier, so the code segment is sliced out of
  // the original text rather than read from a match group.
  const tier = m[1].toLowerCase();
  const segment = trimmed.slice(trimmed.lastIndexOf('-') + 1).toUpperCase();
  return { code: `swr-${tier}-${segment}`, tier };
}

async function findRecord(code) {
  // The ledger index (pt-keys/index.json) is a flat array of
  // { id, key, tier, userId, email, sessionId, slots, createdAt }. A linear
  // scan is fine: the index is bounded by Stripe volume, and every other
  // reader of this store (api/pt/verify.js, api/admin/pt/keys/import.js) does
  // the same.
  const all = await readJson(keysIndexPath(), []);
  if (!Array.isArray(all)) return null;
  // `code` is already canonical (parseCode normalised it), so a case-
  // insensitive compare on the trimmed stored key is exact.
  const wanted = code.toLowerCase();
  for (const r of all) {
    if (r && typeof r.key === 'string' && r.key.trim().toLowerCase() === wanted) return r;
  }
  return null;
}

// Credits are a client-side ledger today (pt.client.js decrements on export),
// so the server reports the tier grant and lets a record override it. An
// override is what a future server-side debit, or an operator import that
// carries a bespoke grant, writes into the record.
function creditsFor(record, tierMeta) {
  const raw = record.creditsRemaining != null ? record.creditsRemaining : record.credits;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : tierMeta.credits;
}

function isExpired(record) {
  const raw = record.expiresAt || record.expires;
  if (!raw) return false;
  const t = Date.parse(raw);
  return Number.isFinite(t) && t <= Date.now();
}

export default async function handler(req, res) {
  setCors(res, req.headers.origin);
  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    return res.end();
  }
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST, OPTIONS');
    return sendJson(res, 405, { error: 'method_not_allowed' });
  }

  let body;
  try {
    body = await readJsonBody(req, { maxBytes: MAX_BODY_BYTES });
  } catch (_) {
    return sendJson(res, 400, { valid: false, reason: 'invalid_request' });
  }
  if (!body || typeof body !== 'object' || body.__error) {
    return sendJson(res, 400, { valid: false, reason: 'invalid_request' });
  }

  // `key` is accepted as an alias for `code` so the same payload works against
  // the sibling GET /api/pt/verify route.
  const parsed = parseCode(body.code != null ? body.code : body.key);
  if (!parsed) {
    return sendJson(res, 400, { valid: false, reason: 'invalid_request' });
  }

  const ipRl = rateLimit({ key: `license-verify:ip:${clientIp(req)}`, windowMs: IP_WINDOW_MS, max: IP_MAX });
  if (!ipRl.ok) {
    res.setHeader('Retry-After', String(Math.ceil(ipRl.retryAfterMs / 1000)));
    return sendJson(res, 429, { error: 'rate_limited', retryAfterMs: ipRl.retryAfterMs });
  }
  // Rate-limited per code, not only per IP: a brute-force sweep from one IP
  // against one guessable code is the shape worth stopping.
  const codeRl = rateLimit({ key: `license-verify:code:${parsed.code}`, windowMs: CODE_WINDOW_MS, max: CODE_MAX });
  if (!codeRl.ok) {
    res.setHeader('Retry-After', String(Math.ceil(codeRl.retryAfterMs / 1000)));
    return sendJson(res, 429, { error: 'rate_limited', retryAfterMs: codeRl.retryAfterMs });
  }

  let record;
  try {
    record = await findRecord(parsed.code);
  } catch (_) {
    // A store outage must not read as "your key is fake" (that would wipe a
    // paying customer's local license), and it must not read as valid either.
    return sendJson(res, 503, { error: 'license_store_unavailable' });
  }
  if (!record || record.revoked === true) {
    return sendJson(res, 200, { valid: false, reason: 'unknown_code' });
  }
  if (isExpired(record)) {
    return sendJson(res, 200, { valid: false, reason: 'expired' });
  }

  // Tier cross-check. A key whose embedded tier disagrees with the record it
  // maps to is not a key this server issued.
  const tierMeta = PT_TIERS[record.tier];
  if (!tierMeta || record.tier !== parsed.tier) {
    return sendJson(res, 200, { valid: false, reason: 'unknown_code' });
  }

  const slotCount = Number.isFinite(Number(record.slots)) && Number(record.slots) > 0
    ? Number(record.slots)
    : tierMeta.slots;

  // Remaining video slots live in the paid grant ledger (api/_lib/slots.js).
  // The key record is a snapshot of the grant at mint time; the ledger is the
  // source of truth. It is optional data, so a miss is reported as null
  // rather than failing the verification.
  let slotsRemaining = null;
  if (record.userId) {
    try {
      const state = await getSlotState(record.userId);
      slotsRemaining = Math.max(0, (state.paidSlots != null ? state.paidSlots : slotCount) - (state.registered || 0));
    } catch (_) {
      slotsRemaining = null;
    }
  }

  return sendJson(res, 200, {
    valid: true,
    tier: record.tier,
    tierName: tierMeta.name,
    creditsRemaining: creditsFor(record, tierMeta),
    slotCount,
    slotsRemaining,
    grantedAt: record.createdAt || null,
  });
}