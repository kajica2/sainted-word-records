// api/_lib/slots.js — server-side video-slot ledger (Stripe-wired).
//
// This is the authoritative payment-side counterpart to the client's local
// wallet (pt.client.js). The client stays the runtime wallet (offline-first);
// this ledger records, per user, the slots GRANTED and the videos REGISTERED
// against that quota. Payment wiring: a paid Stripe checkout (PT tiers via
// api/pt/checkout.js → api/webhooks/stripe.js → api/_lib/pt-keys.js) writes
// grants with `paid: true`, and registerVideos() backs registrations with
// PAID grants only — the TOGGLE is closed.
//
// Store layout. The same key space works on every backend (JSON files under
// SWRC_DATA_DIR locally, `kv` table rows with the same relative key on
// Postgres — see api/_lib/db.js):
//   slots/state/<userId>.json              { userId, email, totalSlots,
//                                            granted, registered, updatedAt }
//   slots/grants/index.json                [ grant, ... ] — queryable ledger
//   slots/grants/<userId>/<uuid>.json      audit copy of one grant
//   slots/registrations/index.json         [ registration, ... ]
//   slots/registrations/<userId>/<uuid>.json  audit copy of one registration
//
// The per-user *index rows* are the queryable ledger — a list must be readable
// on the Postgres backend, which has no readdir — and the per-grant /
// per-registration files are audit records written in the same lock. All
// writes go through withLock() from db.js, so a quota check is a read-modify-
// write under one mutex: a registration can never oversell a concurrent grant
// (or double-count against the same grant), on either backend.
//
// Idempotency: a grant is never mutated here and double-granting ACCUMULATES.
// The ledger is append-only and each grant is a distinct line item — a second
// €120 purchase is a second 10-slot grant, not a no-op. Idempotency lives at
// the payment layer: Stripe's idempotency key will map a duplicate webhook to
// the same grant record; until then the admin surface is the only writer and
// an operator double-submit is an honest top-up.

import { join } from 'node:path';
import { uuid, readJson, writeJson, withLock, DATA_ROOT } from './db.js';

export const SLOT_BATCHES = [10, 30, 50];

export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const SLOTS_ROOT = join(DATA_ROOT, 'slots');
const UUID_RE = /^[a-f0-9-]{8,40}$/i;

// ---- validation helpers (shared with the unit suite) ----

export function normalizeEmail(email) {
  if (typeof email !== 'string') return null;
  const e = email.trim().toLowerCase();
  return EMAIL_RE.test(e) ? e : null;
}

// One of the allowed registration batches (10 / 30 / 50), or null. Accepts
// numeric strings so JSON bodies written with string-typed slots still work.
export function normalizeSlots(raw) {
  const n = Number(raw);
  return Number.isInteger(n) && SLOT_BATCHES.includes(n) ? n : null;
}

function assertUserId(userId) {
  // Defensive: handlers validate before calling, but path builders never
  // trust their input — a `..` here would escape the slots store.
  if (typeof userId !== 'string' || !UUID_RE.test(userId)) {
    throw new Error('invalid userId');
  }
}

// ---- paths ----

export function slotStatePath(userId) {
  assertUserId(userId);
  return join(SLOTS_ROOT, 'state', `${userId}.json`);
}
export function grantsIndexPath() {
  return join(SLOTS_ROOT, 'grants', 'index.json');
}
export function grantRecordPath(userId, id) {
  assertUserId(userId);
  return join(SLOTS_ROOT, 'grants', userId, `${id}.json`);
}
export function registrationsIndexPath() {
  return join(SLOTS_ROOT, 'registrations', 'index.json');
}
export function registrationRecordPath(userId, id) {
  assertUserId(userId);
  return join(SLOTS_ROOT, 'registrations', userId, `${id}.json`);
}

// ---- reads (no lock: a single read is atomic per backend) ----

export async function getSlotState(userId) {
  assertUserId(userId);
  const state = await readJson(slotStatePath(userId), null);
  if (!state) {
    return { userId, email: null, totalSlots: 0, granted: 0, registered: 0, updatedAt: null };
  }
  return {
    userId,
    email: state.email || null,
    totalSlots: state.totalSlots || 0,
    granted: state.granted || 0,
    registered: state.registered || 0,
    updatedAt: state.updatedAt || null,
  };
}

async function listFromIndex(indexPath, userId) {
  const all = await readJson(indexPath, []);
  if (!Array.isArray(all)) return [];
  return all
    .filter((row) => row && row.userId === userId)
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}

export async function listGrants(userId) {
  assertUserId(userId);
  return listFromIndex(grantsIndexPath(), userId);
}

export async function listRegistrations(userId) {
  assertUserId(userId);
  return listFromIndex(registrationsIndexPath(), userId);
}

export async function listAllGrants() {
  const all = await readJson(grantsIndexPath(), []);
  return Array.isArray(all) ? all.slice().sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)) : [];
}

// ---- writes (every mutation is one withLock) ----

// Append a grant line item and bump the running state. Returns
// { grant, state }. A second grant for the same user ACCUMULATES (see the
// module header for why that is the intended semantic).
export async function grantSlots({ userId, email, slots, source = 'admin-grant', note = null, paid = false, orderId = null, ptKey = null }) {
  assertUserId(userId);
  const normalized = normalizeEmail(email);
  if (!normalized) throw new TypeError('invalid email');
  const n = normalizeSlots(slots);
  if (!n) throw new TypeError('invalid slots');
  return withLock(async () => {
    const state = await getSlotState(userId);
    const grant = {
      id: uuid(),
      userId,
      email: normalized,
      slots: n,
      source,
      note: typeof note === 'string' && note ? String(note).slice(0, 200) : null,
        createdAt: new Date().toISOString(),
        // paid:true grants are payment-verified (Stripe checkout + webhook
        // fulfilment) — only they back registrations (see registerVideos).
        // orderId links a webhook-fulfilled grant to its checkout session;
        // ptKey carries the license key minted for a PT purchase.
        paid: paid === true,
        orderId: typeof orderId === 'string' && orderId ? orderId : null,
        ptKey: typeof ptKey === 'string' && ptKey ? ptKey : null,
      };
    const index = await readJson(grantsIndexPath(), []);
    index.push(grant);
    await writeJson(grantsIndexPath(), index);
    // Audit copy, same lock — never read for listing on Postgres (no readdir).
    await writeJson(grantRecordPath(userId, grant.id), grant);
    const next = {
      ...state,
      userId,
      email: normalized,
      totalSlots: (state.totalSlots || 0) + n,
      granted: (state.granted || 0) + 1,
      updatedAt: grant.createdAt,
    };
    await writeJson(slotStatePath(userId), next);
    return { grant, state: next };
  });
}

// Thrown when a registration would exceed the granted quota. Carries the
// (unchanged) state so handlers can reply with the current remaining count.
export class SlotQuotaError extends Error {
  constructor(message, state) {
    super(message);
    this.name = 'SlotQuotaError';
    this.state = state;
  }
}

// Register `count` videos against the user's quota. The quota wall is
// enforced HERE, server-side, under withLock — never trust a client count.
// `count` must be one of SLOT_BATCHES. Returns { registration, state }.
export async function registerVideos({ userId, count }) {
  assertUserId(userId);
  const n = normalizeSlots(count);
  if (!n) throw new TypeError('invalid count');
      return withLock(async () => {
        const state = await getSlotState(userId);
        // TOGGLE (closed): registration is backed by PAID grants only. The
        // unpaid balance can never back a registration; unpaid grants stay on
        // the ledger for the books.
        const grants = await listGrants(userId);
        const paidSlots = grants.reduce((s, g) => s + (g && g.paid ? g.slots || 0 : 0), 0);
        const used = state.registered || 0;
        if (used + n > paidSlots) {
          throw new SlotQuotaError('no paid slots left', {
            ...state,
            paidSlots,
            remaining: Math.max(0, paidSlots - used),
          });
        }
        const registration = {
          id: uuid(),
          userId,
          count: n,
          createdAt: new Date().toISOString(),
          // Payment-verified: the wall above only lets PAID grants back a
          // registration, so this row is no longer a trial.
          trial: false,
        };
    const index = await readJson(registrationsIndexPath(), []);
    index.push(registration);
    await writeJson(registrationsIndexPath(), index);
    await writeJson(registrationRecordPath(userId, registration.id), registration);
      const next = {
        ...state,
        userId,
        paidSlots,
        registered: used + n,
        updatedAt: registration.createdAt,
      };
    await writeJson(slotStatePath(userId), next);
    return { registration, state: next };
  });
}

// The PT-panel sync payload: what the client needs when it asks "how many
// slots do I have on the server?"
export async function syncPayload(user) {
  if (!user || !user.id) throw new TypeError('user required');
  assertUserId(user.id);
    const state = await getSlotState(user.id);
    const grants = await listGrants(user.id);
    const paidSlots = grants.reduce((s, g) => s + (g && g.paid ? g.slots || 0 : 0), 0);
    return {
      email: user.email || null,
      userId: user.id,
      totalSlots: state.totalSlots || 0,
      paidSlots,
      granted: state.granted || 0,
      registered: state.registered || 0,
      remaining: Math.max(0, paidSlots - (state.registered || 0)),
      grants: grants.slice(0, 50),
    };
}