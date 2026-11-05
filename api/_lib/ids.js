// api/_lib/ids.js — the id + token primitives shared by every store.
//
// These three functions used to live in api/_lib/db.js. They moved here
// so api/_lib/auth-firestore.js can use them WITHOUT importing db.js:
// db.js dispatches to that module when SWR_AUTH_STORE=firestore, and a
// db.js -> auth-firestore.js -> db.js cycle would be a load-order hazard
// (the auth store is imported dynamically, but the cycle would still be
// real for anyone who imported it directly).
//
// db.js re-exports every name below, so every existing
// `import { uuid } from '../_lib/db.js'` keeps working unchanged.

import { randomBytes, randomUUID, createHash } from 'node:crypto';

// A random v4 UUID. Used for user ids, project ids, kit ids, order ids.
export function uuid() {
  return randomUUID();
}

// A URL-safe random token. `bytes` is the entropy in bytes, not the
// length of the result: the base64url encoding makes the string longer.
export function shortToken(bytes = 24) {
  return randomBytes(bytes).toString('base64url');
}

// A stable, non-reversible key for a string. Used as a document id in
// the Firestore stores, so the same input always maps to the same doc.
export function hashKey(s) {
  return createHash('sha256').update(s).digest('hex').slice(0, 32);
}

// The membership tiers a user's account may hold. Validated on write so
// a caller cannot set an arbitrary string.
export const MEMBERSHIP_TIERS = ['free', 'creator'];
