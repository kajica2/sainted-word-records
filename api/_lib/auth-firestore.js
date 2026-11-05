// api/_lib/auth-firestore.js — the Firestore implementation of the SWR
// auth store.
//
// The JSON/Postgres store in api/_lib/db.js is the parity spec: same
// function names, same return shapes, same edge cases (null vs throw,
// expiry boundaries, consume-once). db.js dispatches here when
//
//   SWR_AUTH_STORE=firestore  +  FIREBASE_PROJECT_ID  +  credentials
//
// so an operator can move users and sessions off cold-start-volatile
// storage. The path is OFF by default and costs the default route nothing:
// firebase-admin is never imported at module load (getFirestore() in
// api/_lib/firestore.js imports it on demand), and this module never
// imports db.js — that would be an import cycle, because db.js dispatches
// here.
//
// Collections:
//   users/{userId}            { id, email, name, image, provider,
//                               membershipTier, joinedAt, createdAt,
//                               updatedAt }
//   user_emails/{hash(email)}  { userId, email }        — email uniqueness
//   accounts/{hash(provider:providerAccountId)}
//                             { userId, provider, providerAccountId,
//                               linkedAt }
//   sessions/{token}          { token, userId, expiresAt, expiresAtMs,
//                               createdAt }
//   verifications/{hash(identifier:token)}
//                             { identifier, token, expires }
//   user_connect_accounts/{userId}
//                             { ...the connect blob fields... }
//
// The connect blob lives in its OWN collection, `user_connect_accounts`,
// and NOT in `connect_accounts`: that collection belongs to the Connect
// pilot (api/_lib/connect-store.js), which stores a different record
// under the same name. Two writers sharing one collection with two
// shapes is a data-loss bug waiting for the day both switches are on,
// so the auth store keeps its distance.
//
// Which of the two serves the routes depends on the switches, and the
// two never cross:
//
//   SWR_CONNECT_STORE=firestore        → api/_lib/connect-store.js owns
//                                        connect data (collection
//                                        `connect_accounts`) and never
//                                        calls db.js for it.
//   otherwise + SWR_AUTH_STORE=firestore → db.js dispatches here, and
//                                        the blob lives in
//                                        `user_connect_accounts`.
//
// So a deploy has exactly ONE collection holding connect data, chosen by
// the switches — never two.
//
// Why the extra index collections: Firestore has no unique constraint on
// a field, so email uniqueness and provider-link uniqueness are enforced
// by CREATING a document whose id is derived from the value. A create()
// that loses the race fails with ALREADY_EXISTS (code 6), which is the
// only atomic test-and-set available. The document ids are sha256 hashes
// (see api/_lib/ids.js) so an email address never becomes a document
// path — Firestore ids may not contain '/'.

import { firestoreConfigured, getFirestore } from './firestore.js';
import { uuid, shortToken, hashKey, MEMBERSHIP_TIERS } from './ids.js';

const USERS = 'users';
const USER_EMAILS = 'user_emails';
const ACCOUNTS = 'accounts';
const SESSIONS = 'sessions';
const VERIFICATIONS = 'verifications';
const CONNECT_ACCOUNTS = 'user_connect_accounts';

const DEFAULT_VERIFICATION_TTL_MS = 24 * 60 * 60 * 1000;
const DEFAULT_SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

// gRPC status codes as surfaced by the Admin SDK. They are the only
// signal that a create()/delete() lost a race.
const CODE_ALREADY_EXISTS = 6;
const CODE_NOT_FOUND = 5;

// Explicit opt-in: the dormant Firestore path is never picked up by
// ambient env vars alone — an operator must set SWR_AUTH_STORE=firestore.
export function authFirestoreEnabled() {
  return process.env.SWR_AUTH_STORE === 'firestore' && firestoreConfigured();
}

function isAlreadyExists(e) {
  return !!e && e.code === CODE_ALREADY_EXISTS;
}

function isNotFound(e) {
  return !!e && e.code === CODE_NOT_FOUND;
}

function normEmail(value) {
  return String(value).toLowerCase().trim();
}

function nowIso() {
  return new Date().toISOString();
}

// Firestore rejects undefined field values outright, while the JSON store
// would happily write them (JSON.stringify drops them). Undefined fields
// are dropped here so the two stores stay interchangeable. The walk is
// recursive because a nested undefined (e.g. googleDrive.refreshToken
// when Google sends no refresh token) fails the whole write, not just
// its own field.
function clean(value) {
  if (Array.isArray(value)) {
    // JSON.stringify turns undefined array entries into null; Firestore
    // has no undefined at all, so null is the equivalent.
    return value.map((v) => (v === undefined ? null : clean(v)));
  }
  if (value && typeof value === 'object' && value.constructor === Object) {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      if (v !== undefined) out[k] = clean(v);
    }
    return out;
  }
  return value;
}

// A session is expired once its expiry has been reached (the boundary is
// inclusive: a session that expires exactly now is already dead). The
// numeric expiresAtMs is authoritative; expiresAt is the ISO mirror kept
// for parity with the JSON store and for human inspection in the console.
function sessionExpired(session, now) {
  const ms =
    typeof session.expiresAtMs === 'number'
      ? session.expiresAtMs
      : Date.parse(session.expiresAt || '');
  return !(ms > now);
}

// Builds the store over an injected client. The module-level functions
// below are this factory bound to getFirestore(); the unit gate injects
// an in-memory fake through the same seam, so the gate exercises the
// shipped code rather than a re-implementation of it.
export function createAuthStore(getClient) {
  const client = async () => await getClient();

  // Delete that only succeeds when the document was really there. The
  // NOT_FOUND failure is what makes consume-once atomic: two concurrent
  // consumers of the same token cannot both win.
  async function deleteOnce(ref) {
    try {
      await ref.delete({ exists: true });
      return true;
    } catch (e) {
      if (isNotFound(e)) return false;
      throw e;
    }
  }

  async function findUserByEmail(email) {
    if (!email) return null;
    const fs = await client();
    const snap = await fs.collection(USER_EMAILS).doc(hashKey(normEmail(email))).get();
    if (!snap.exists) return null;
    const index = snap.data() || {};
    if (!index.userId) return null;
    const user = await fs.collection(USERS).doc(index.userId).get();
    return user.exists ? user.data() : null;
  }

  async function findUserByProvider(provider, providerAccountId) {
    if (!provider || !providerAccountId) return null;
    const fs = await client();
    const snap = await fs
      .collection(ACCOUNTS)
      .doc(hashKey(`${provider}:${providerAccountId}`))
      .get();
    if (!snap.exists) return null;
    const link = snap.data() || {};
    if (!link.userId) return null;
    const user = await fs.collection(USERS).doc(link.userId).get();
    return user.exists ? user.data() : null;
  }

  async function getUser(id) {
    if (!id) return null;
    const fs = await client();
    const snap = await fs.collection(USERS).doc(id).get();
    return snap.exists ? snap.data() : null;
  }

  async function createUser({ email, name = null, image = null, provider = 'email' } = {}) {
    if (!email) throw new Error('email required');
    const existing = await findUserByEmail(email);
    if (existing) {
      // Legacy users pre-date membershipTier: backfill the free tier
      // rather than handing out a user with no tier at all.
      if (!existing.membershipTier) {
        return updateUser(existing.id, { membershipTier: 'free' });
      }
      return existing;
    }
    const fs = await client();
    const id = uuid();
    const normalised = normEmail(email);
    const user = {
      id,
      email: normalised,
      // The local part of the ORIGINAL email argument, exactly like the
      // JSON store: it is the display name a user gets for free.
      name: name || email.split('@')[0],
      image,
      provider,
      membershipTier: 'free',
      joinedAt: nowIso(),
      createdAt: nowIso(),
    };
    await fs.collection(USERS).doc(id).set(clean(user));
    try {
      // The atomic uniqueness claim. Losing this race means another
      // request created the same email first.
      await fs.collection(USER_EMAILS).doc(hashKey(normalised)).create({
        userId: id,
        email: normalised,
      });
    } catch (e) {
      if (!isAlreadyExists(e)) {
        // A real failure: drop the half-written user so no orphan is
        // left behind, then let the error out.
        await fs.collection(USERS).doc(id).delete();
        throw e;
      }
      // Another request claimed this email first. That user wins.
      const claim = await fs.collection(USER_EMAILS).doc(hashKey(normalised)).get();
      const winnerId = claim.exists ? (claim.data() || {}).userId : null;
      if (winnerId && winnerId !== id) {
        const winner = await getUser(winnerId);
        if (winner) {
          // The user document we wrote must not survive as an orphan.
          await fs.collection(USERS).doc(id).delete();
          if (!winner.membershipTier) {
            return updateUser(winner.id, { membershipTier: 'free' });
          }
          return winner;
        }
      }
      // The claim points at a user document that no longer exists: a
      // stale index. Take the claim over instead of returning nobody.
      await fs.collection(USER_EMAILS).doc(hashKey(normalised)).set({
        userId: id,
        email: normalised,
      });
      return user;
    }
    return user;
  }

  async function updateUser(id, patch = {}) {
    if (!id) return null;
    const fs = await client();
    const ref = fs.collection(USERS).doc(id);
    const snap = await ref.get();
    if (!snap.exists) return null;
    const current = snap.data() || {};
    const next = { ...current, ...patch, updatedAt: nowIso() };

    // The connect blob is NOT a user field in this store: it lives in
    // connect_accounts so the reverse lookup can query it directly.
    const hasConnect = Object.prototype.hasOwnProperty.call(patch, 'connect');
    if (hasConnect) delete next.connect;

    if (Object.prototype.hasOwnProperty.call(patch, 'email') && patch.email) {
      // The user document keeps the email as patched (db.js stores it
      // verbatim); only the INDEX is normalised, because that is what
      // the lookup hashes.
      const normalised = normEmail(patch.email);
      const claimRef = fs.collection(USER_EMAILS).doc(hashKey(normalised));
      let claimed = false;
      try {
        await claimRef.create({ userId: id, email: normalised });
        claimed = true;
      } catch (e) {
        if (!isAlreadyExists(e)) throw e;
        const claim = await claimRef.get();
        const ownerId = claim.exists ? (claim.data() || {}).userId : null;
        if (ownerId === id) {
          claimed = true;
        } else if (!ownerId) {
          await claimRef.set({ userId: id, email: normalised });
          claimed = true;
        } else {
          throw new Error('email already in use');
        }
      }
      if (claimed) {
        // Release the old claim only AFTER the new one is held, so the
        // address is never unowned in between.
        const old = normEmail(current.email || '');
        if (old && old !== normalised) {
          const oldRef = fs.collection(USER_EMAILS).doc(hashKey(old));
          const oldSnap = await oldRef.get();
          if (oldSnap.exists && (oldSnap.data() || {}).userId === id) {
            await oldRef.delete();
          }
        }
      }
    }

    await ref.set(clean(next));
    if (hasConnect) {
      // db.js replaces user.connect wholesale on a patch; here the blob
      // lives in its own collection, so it is replaced there. A falsy
      // patch clears the blob.
      if (patch.connect) {
        await fs.collection(CONNECT_ACCOUNTS).doc(id).set(clean(patch.connect));
      } else {
        await fs.collection(CONNECT_ACCOUNTS).doc(id).delete();
      }
      // The blob is NOT a field of the user document, but db.js's
      // returned user carries it, so the returned object does too.
      next.connect = patch.connect;
    }
    return next;
  }

  async function setMembershipTier(userId, tier) {
    if (!MEMBERSHIP_TIERS.includes(tier)) {
      throw new Error(`invalid tier: ${tier}`);
    }
    return updateUser(userId, { membershipTier: tier });
  }

  async function linkAccount({ userId, provider, providerAccountId } = {}) {
    if (!userId || !provider || !providerAccountId) return null;
    const fs = await client();
    const link = { userId, provider, providerAccountId, linkedAt: nowIso() };
    try {
      // The link id is derived from (provider, providerAccountId), so the
      // create() IS the uniqueness test: an existing link is never
      // re-pointed at a different user.
      await fs
        .collection(ACCOUNTS)
        .doc(hashKey(`${provider}:${providerAccountId}`))
        .create(link);
      return link;
    } catch (e) {
      if (isAlreadyExists(e)) return null;
      throw e;
    }
  }

  async function createVerificationToken({
    identifier,
    ttlMs = DEFAULT_VERIFICATION_TTL_MS,
  } = {}) {
    if (!identifier) throw new Error('identifier required');
    const fs = await client();
    const normalised = normEmail(identifier);
    const token = shortToken(32);
    const record = {
      identifier: normalised,
      token,
      expires: new Date(Date.now() + ttlMs).toISOString(),
    };
    await fs.collection(VERIFICATIONS).doc(hashKey(`${normalised}:${token}`)).set(record);
    return record;
  }

  async function consumeVerificationToken({ identifier, token } = {}) {
    if (!identifier || !token) return null;
    const fs = await client();
    const normalised = normEmail(identifier);
    const ref = fs.collection(VERIFICATIONS).doc(hashKey(`${normalised}:${token}`));
    const snap = await ref.get();
    if (!snap.exists) return null;
    const record = snap.data() || {};
    if (record.token !== token || normEmail(record.identifier || '') !== normalised) {
      return null;
    }
    // Consume-once: the delete is the atomic step, so a second consumer
    // finds nothing left and gets null.
    const removed = await deleteOnce(ref);
    if (!removed) return null;
    if (!(Date.parse(record.expires) > Date.now())) return null;
    return { identifier: record.identifier, token: record.token, expires: record.expires };
  }

  async function createSession({ userId, ttlMs = DEFAULT_SESSION_TTL_MS } = {}) {
    const fs = await client();
    const token = shortToken(32);
    const expiresAtMs = Date.now() + ttlMs;
    const session = {
      token,
      userId,
      expiresAt: new Date(expiresAtMs).toISOString(),
      createdAt: nowIso(),
    };
    await fs.collection(SESSIONS).doc(token).set({ ...session, expiresAtMs });
    return session;
  }

  async function getSession(token) {
    if (!token) return null;
    const fs = await client();
    const snap = await fs.collection(SESSIONS).doc(token).get();
    if (!snap.exists) return null;
    const session = snap.data() || {};
    if (sessionExpired(session, Date.now())) return null;
    return {
      token: session.token,
      userId: session.userId,
      expiresAt: session.expiresAt,
      createdAt: session.createdAt,
    };
  }

  async function destroySession(token) {
    if (!token) return false;
    const fs = await client();
    return deleteOnce(fs.collection(SESSIONS).doc(token));
  }

  async function purgeExpiredSessions() {
    const fs = await client();
    // The session list is read whole and filtered here, exactly like the
    // JSON store does with its sessions file. A range query would need a
    // composite index and the expired set is small.
    const query = await fs.collection(SESSIONS).get();
    const now = Date.now();
    let removed = 0;
    for (const doc of query.docs) {
      const session = doc.data() || {};
      if (!sessionExpired(session, now)) continue;
      if (await deleteOnce(fs.collection(SESSIONS).doc(doc.id))) removed++;
    }
    return removed;
  }

  async function getConnectAccount(userId) {
    if (!userId) return null;
    const fs = await client();
    const snap = await fs.collection(CONNECT_ACCOUNTS).doc(userId).get();
    return snap.exists ? snap.data() : null;
  }

  async function saveConnectAccount(userId, patch = {}) {
    if (!userId) return null;
    const fs = await client();
    const current = (await getConnectAccount(userId)) || {};
    const next = { ...current, ...patch, updatedAt: nowIso() };
    await fs.collection(CONNECT_ACCOUNTS).doc(userId).set(clean(next));
    // db.js stores the blob on the user record, so saving it also
    // stamps the user's updatedAt. The blob lives in its own collection
    // here, so the stamp is applied to the user document directly.
    const userRef = fs.collection(USERS).doc(userId);
    const userSnap = await userRef.get();
    if (userSnap.exists) {
      const user = userSnap.data() || {};
      await userRef.set(clean({ ...user, updatedAt: next.updatedAt }));
    }
    return next;
  }

  async function findUserByConnectAccount(accountId) {
    if (!accountId) return null;
    const fs = await client();
    const query = await fs
      .collection(CONNECT_ACCOUNTS)
      .where('accountId', '==', accountId)
      .limit(1)
      .get();
    if (query.empty) return null;
    const doc = query.docs[0];
    // The connect document id IS the user id.
    const user = await getUser(doc.id);
    if (!user) return null;
    // db.js returns the user record with the connect blob on it; the
    // Firestore layout keeps the blob in its own collection, so it is
    // grafted back on here to keep the caller-facing shape identical.
    return { ...user, connect: doc.data() || {} };
  }

  async function countConnectAccounts() {
    const fs = await client();
    // '!=' does not match documents that lack the field, so this query
    // only sees blobs that actually carry an accountId. The string check
    // below is what makes the count match db.js exactly: a numeric
    // accountId is not a connected account.
    const query = await fs.collection(CONNECT_ACCOUNTS).where('accountId', '!=', '').get();
    let count = 0;
    for (const doc of query.docs) {
      const blob = doc.data() || {};
      if (typeof blob.accountId === 'string' && blob.accountId) count++;
    }
    return count;
  }

  async function authCounts() {
    const fs = await client();
    const usersAgg = await fs.collection(USERS).count().get();
    const users = (usersAgg.data() && usersAgg.data().count) || 0;
    // Sessions are counted from the list, filtered on expiresAtMs: an
    // aggregate count over a range filter would need a composite index,
    // and the live session set is small.
    const query = await fs.collection(SESSIONS).get();
    const now = Date.now();
    let sessions = 0;
    for (const doc of query.docs) {
      const session = doc.data() || {};
      if (!sessionExpired(session, now)) sessions++;
    }
    return { users, sessions };
  }

  return {
    findUserByEmail,
    findUserByProvider,
    getUser,
    createUser,
    updateUser,
    setMembershipTier,
    linkAccount,
    createVerificationToken,
    consumeVerificationToken,
    createSession,
    getSession,
    destroySession,
    purgeExpiredSessions,
    getConnectAccount,
    saveConnectAccount,
    findUserByConnectAccount,
    countConnectAccounts,
    authCounts,
  };
}

// The shipped store. Every module-level function below is this one
// implementation, bound to the real Firestore client.
const store = createAuthStore(() => getFirestore());

export const findUserByEmail = store.findUserByEmail;
export const findUserByProvider = store.findUserByProvider;
export const getUser = store.getUser;
export const createUser = store.createUser;
export const updateUser = store.updateUser;
export const setMembershipTier = store.setMembershipTier;
export const linkAccount = store.linkAccount;
export const createVerificationToken = store.createVerificationToken;
export const consumeVerificationToken = store.consumeVerificationToken;
export const createSession = store.createSession;
export const getSession = store.getSession;
export const destroySession = store.destroySession;
export const purgeExpiredSessions = store.purgeExpiredSessions;
export const getConnectAccount = store.getConnectAccount;
export const saveConnectAccount = store.saveConnectAccount;
export const findUserByConnectAccount = store.findUserByConnectAccount;
export const countConnectAccounts = store.countConnectAccounts;
export const authCounts = store.authCounts;
