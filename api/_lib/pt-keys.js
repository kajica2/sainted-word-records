// api/_lib/pt-keys.js — server-side PT license issuance (the Stripe wiring).
//
// The client wallet (pt.client.js) accepts `swr-{tier}-{8 alnum}` keys with
// no signature check — the format is deliberately opaque, and minting is a
// format-only job (scripts/generate-pt-keys.mjs is the operator's manual
// issuer). This module is the server-side issuer the Stripe webhook calls
// when a PT tier is paid: same alphabet, same format, plus a ledger that
// records which key went to which checkout session.
//
// It also owns the tier table — ONE source of truth for name / credits /
// price / video slots. The video-slot count per tier mirrors SLOT_BATCHES
// (10 / 30 / 50): a paid tier grants that many registerable video slots on
// the server ledger (api/_lib/slots.js), which is what the closed TOGGLE
// enforces.
//
// Ledger layout (same key space on every backend — see db.js):
//   pt-keys/index.json     [ keyRecord, ... ] — queryable
//   pt-keys/<id>.json      audit copy of one record
//
// A key record:
//   { id, key, tier, userId, email, sessionId, slots, createdAt }

import { join } from 'node:path';
import { randomInt } from 'node:crypto';
import { uuid, readJson, writeJson, withLock, DATA_ROOT, getUser } from './db.js';
import { normalizeEmail, grantSlots, listGrants } from './slots.js';

export const PT_TIERS = {
  solo:  { name: 'PT Solo',  credits: 50,  priceMinor: 12000, slots: 10 },
  band:  { name: 'PT Band',  credits: 150, priceMinor: 28000, slots: 30 },
  label: { name: 'PT Label', credits: 500, priceMinor: 60000, slots: 50 },
};

// Same alphabet/format as scripts/generate-pt-keys.mjs — keep in sync.
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const CODE_LEN = 8;
export const PT_KEY_RE = /^swr-(solo|band|label)-[A-HJ-NP-Z2-9]{8}$/;

const KEYS_ROOT = join(DATA_ROOT, 'pt-keys');
const UUID_RE = /^[a-f0-9-]{8,40}$/i;

export function keysIndexPath() {
  return join(KEYS_ROOT, 'index.json');
}

export function keyRecordPath(id) {
  if (typeof id !== 'string' || !UUID_RE.test(id)) throw new Error('invalid key id');
  return join(KEYS_ROOT, `${id}.json`);
}

export function mintPtKey(tier) {
  if (!PT_TIERS[tier]) throw new TypeError(`unknown tier: ${tier}`);
  let code = '';
  for (let i = 0; i < CODE_LEN; i++) code += ALPHABET[randomInt(ALPHABET.length)];
  return `swr-${tier}-${code}`;
}

export async function findPtKeyBySession(sessionId) {
  if (!sessionId) return null;
  const all = await readJson(keysIndexPath(), []);
  return Array.isArray(all)
    ? all.find((k) => k && k.sessionId === sessionId) || null
    : null;
}

export async function listPtKeysForUser(userId) {
  const all = await readJson(keysIndexPath(), []);
  return Array.isArray(all) ? all.filter((k) => k && k.userId === userId) : [];
}

async function recordPtKey(record) {
  return withLock(async () => {
    const index = await readJson(keysIndexPath(), []);
    // Idempotent by session — a retry never appends a second record.
    if (index.some((k) => k && k.sessionId === record.sessionId)) return;
    index.push(record);
    await writeJson(keysIndexPath(), index);
    await writeJson(keyRecordPath(record.id), record);
  });
}

// Fulfil a paid PT checkout session: grant the tier's video slots as PAID on
// the user's ledger and mint the license key. Idempotent by session id in
// both directions (key ledger + grant.orderId), so a webhook redelivery — or
// a retry after a partial failure — converges on exactly one grant + one key.
//
// Returns { key, tier, slots } or null when the tier is unknown / the buyer
// has no resolvable email (the webhook records whatever summary it got).
export async function fulfillPtPurchase({ tier, userId, email = null, sessionId }) {
  const t = PT_TIERS[tier];
  if (!t || !userId || !sessionId) return null;

  const existingKey = await findPtKeyBySession(sessionId);
  if (existingKey) {
    return { key: existingKey.key, tier, slots: existingKey.slots, already: true };
  }

  const user = await getUser(userId).catch(() => null);
  const normalized = normalizeEmail(email || '') || normalizeEmail((user && user.email) || '');
  if (!normalized) return null;

  // Grant side: reuse the grant a previous partial attempt wrote (matched by
  // the session id), otherwise create it — carrying the key so a retry can
  // recover the same key instead of minting a second one.
  const grants = await listGrants(userId).catch(() => []);
  let grant = grants.find((g) => g && g.orderId === sessionId) || null;
  const key = grant && grant.ptKey ? grant.ptKey : mintPtKey(tier);
  if (!grant) {
    const res = await grantSlots({
      userId,
      email: normalized,
      slots: t.slots,
      source: 'stripe-pt',
      note: `${t.name} · ${sessionId}`,
      paid: true,
      orderId: sessionId,
      ptKey: key,
    });
    grant = res.grant;
  }

  await recordPtKey({
    id: uuid(),
    key,
    tier,
    userId,
    email: normalized,
    sessionId,
    slots: t.slots,
    createdAt: new Date().toISOString(),
  });

  return { key, tier, slots: t.slots };
}
