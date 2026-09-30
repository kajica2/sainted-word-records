// api/_lib/connect-store.js — where the Connect pilot data lives.
//
// Backend selection (per call, so a deploy can switch by env alone):
//   Vercel Postgres / JSON (default) — db.js's own store: Vercel Postgres
//       (`kv` table rows) when DATABASE_URL is set, local JSON files in
//       dev. This is the pilot's home (owner decision: one vendor).
//   Firestore (Google) — only when SWR_CONNECT_STORE=firestore AND the
//       Firestore env vars are set. Dormant by default; activating it
//       requires `npm install firebase-admin` (see firestore.js).
//
// Collections (Firestore only):
//   connect_accounts/{userId}   { userId, email, accountId, status,
//                                 chargesEnabled, payoutsEnabled,
//                                 requirements, createdAt, updatedAt }
//   connect_events/{eventId}    { id, type, receivedAt, data }
//
// Handlers import THIS module — never db.js directly for connect data — so
// swapping the backing store later is a one-file change.
//
// The user records (auth, projects) stay in db.js's own store untouched;
// only marketplace-seller + webhook-ledger data lives here.

import { firestoreConfigured, getFirestore } from './firestore.js';
import * as db from './db.js';

const ACC_COLLECTION = 'connect_accounts';
const EVT_COLLECTION = 'connect_events';

// Explicit opt-in: the dormant Firestore path is never picked up by
// ambient env vars alone — an operator must set SWR_CONNECT_STORE=firestore.
export function connectStoreBackend() {
  return process.env.SWR_CONNECT_STORE === 'firestore' && firestoreConfigured()
    ? 'firestore'
    : 'json';
}

function useFirestore() {
  return connectStoreBackend() === 'firestore';
}

export async function getConnectAccount(userId) {
  if (!useFirestore()) return db.getConnectAccount(userId);
  if (!userId) return null;
  const snap = await getFirestore().collection(ACC_COLLECTION).doc(userId).get();
  return snap.exists ? snap.data() : null;
}

export async function saveConnectAccount(userId, patch) {
  if (!useFirestore()) return db.saveConnectAccount(userId, patch);
  const ref = getFirestore().collection(ACC_COLLECTION).doc(userId);
  const curSnap = await ref.get();
  const cur = curSnap.exists ? curSnap.data() : {};
  const next = { ...cur, ...patch, updatedAt: new Date().toISOString() };
  await ref.set(next);
  return next;
}

export async function findUserByConnectAccount(accountId) {
  if (!useFirestore()) return db.findUserByConnectAccount(accountId);
  if (!accountId) return null;
  const q = await getFirestore()
    .collection(ACC_COLLECTION)
    .where('accountId', '==', accountId)
    .limit(1)
    .get();
  if (q.empty) return null;
  const doc = q.docs[0];
  return { id: doc.id, ...doc.data() };
}

export async function countConnectAccounts() {
  if (!useFirestore()) return db.countConnectAccounts();
  const agg = await getFirestore().collection(ACC_COLLECTION).count().get();
  return (agg.data && agg.data().count) || 0;
}

export async function findConnectEvent(eventId) {
  if (!useFirestore()) return db.findConnectEvent(eventId);
  if (!eventId) return null;
  const snap = await getFirestore().collection(EVT_COLLECTION).doc(eventId).get();
  return snap.exists ? snap.data() : null;
}

export async function recordConnectEvent({ id, type, data = null }) {
  if (!useFirestore()) return db.recordConnectEvent({ id, type, data });
  if (!id || !type) throw new TypeError('id and type required');
  // Doc id = Stripe event id makes redelivery idempotent by construction:
  // a replayed set() writes the same fields over the same doc.
  const ref = getFirestore().collection(EVT_COLLECTION).doc(id);
  const row = { id, type, receivedAt: new Date().toISOString(), data };
  await ref.set(row);
  return row;
}

export async function listConnectEvents({ limit = 200 } = {}) {
  if (!useFirestore()) return db.listConnectEvents({ limit });
  const q = await getFirestore()
    .collection(EVT_COLLECTION)
    .orderBy('receivedAt', 'desc')
    .limit(limit)
    .get();
  return q.docs.map((d) => d.data());
}