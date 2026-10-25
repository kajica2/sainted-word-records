// api/auth/firebase-anon.js — exchange a Firebase Anonymous ID token for a
// SWR session, and publish the public Firebase web config.
//
//   GET  ?action=config → { ok: true, config: { apiKey, … } }
//     The Firebase WEB config is public data (it ships in every web bundle),
//     but it must never be a placeholder: the client refuses a config with
//     no API key rather than failing later against the real project. The
//     values come from the server's env (see api/_lib/firebase-web-config.js).
//
//   POST { idToken } → { ok: true, user: { id, name, email, anonymous } }
//     Verifies the ID token with firebase-admin, creates/links a local user,
//     starts a session and sets the swrc_session cookie.
//
// Requires FIREBASE_PROJECT_ID plus credentials (FIREBASE_SERVICE_ACCOUNT,
// GOOGLE_APPLICATION_CREDENTIALS) or the Auth emulator, and the Anonymous
// provider enabled in the Firebase console.

import { readJsonBody, sendJson, setCors, setSessionCookie } from '../_lib/http.js';
import { createSession, createUser, findUserByProvider, linkAccount, hashKey } from '../_lib/db.js';
import { firebaseAdminConfigured, getAdminAuth } from '../_lib/firebase-admin.js';
import { getFirebaseWebConfig } from '../_lib/firebase-web-config.js';

// The guest account's email is derived from a HASH of the Firebase uid, not
// from the uid itself. Two reasons:
//   1. db.js lowercases every email, and Firebase uids are case-sensitive:
//      'anon-ABCdefgh@…' and 'anon-abcdefgh@…' would collapse onto one
//      account and hand a visitor somebody else's session.
//   2. The uid is the visitor's only identifier; the address never leaves
//      the server, but there is no reason to make it readable.
function guestEmail(uid) {
  return `anon-${hashKey(String(uid)).slice(0, 24)}@guest.swr.local`;
}

async function resolveAnonymousUser(decoded) {
  const uid = decoded.uid;
  let user = await findUserByProvider('firebase-anon', uid);
  if (user) return user;

  // Create a guest user. The email is synthetic so it doesn't collide with
  // real accounts.
  user = await createUser({
    email: guestEmail(uid),
    name: 'Guest',
    provider: 'firebase-anon',
  });
  await linkAccount({ userId: user.id, provider: 'firebase-anon', providerAccountId: uid });
  return user;
}

export default async function handler(req, res) {
  setCors(res, req.headers.origin);
  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    return res.end();
  }

  if (req.method === 'GET') {
    const action = new URL(req.url, 'http://localhost').searchParams.get('action');
    if (action !== 'config') {
      res.setHeader('Allow', 'GET, POST, OPTIONS');
      return sendJson(res, 405, { error: 'method_not_allowed' });
    }
    const config = getFirebaseWebConfig();
    if (!config) {
      // The client treats a non-2xx as "not configured" and hides the
      // guest button, so a missing web config never reaches the SDK.
      return sendJson(res, 503, { error: 'firebase_not_configured' });
    }
    return sendJson(res, 200, { ok: true, config });
  }

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST, OPTIONS');
    return sendJson(res, 405, { error: 'method_not_allowed' });
  }

  const body = await readJsonBody(req);
  const idToken = body && String(body.idToken || '').trim();
  if (!idToken) return sendJson(res, 400, { error: 'missing_id_token' });

  // A server that cannot verify anything is a SERVER fault, not a bad
  // token: 503 with a distinct code, so the operator sees the difference
  // between "the visitor sent junk" and "the deployment is broken".
  if (!firebaseAdminConfigured()) {
    return sendJson(res, 503, { error: 'firebase_not_configured' });
  }

  let decoded;
  try {
    const auth = await getAdminAuth();
    decoded = await auth.verifyIdToken(idToken);
  } catch (e) {
    const code = e && e.message === 'invalid_service_account' ? 'invalid_service_account' : null;
    if (code) {
      console.error('[firebase-anon] admin init failed:', e.message);
      return sendJson(res, 503, { error: code });
    }
    console.error('[firebase-anon] verify failed:', e && e.message);
    return sendJson(res, 401, { error: 'invalid_id_token' });
  }

  if (!decoded || !decoded.firebase || decoded.firebase.sign_in_provider !== 'anonymous') {
    return sendJson(res, 400, { error: 'not_anonymous' });
  }

  let user;
  try {
    user = await resolveAnonymousUser(decoded);
  } catch (e) {
    return sendJson(res, e && e.status ? e.status : 400, { error: e && e.message ? e.message : 'resolve_failed' });
  }

  const session = await createSession({ userId: user.id });
  setSessionCookie(res, session.token);

  return sendJson(res, 200, {
    ok: true,
    user: {
      id: user.id,
      name: user.name || 'Guest',
      email: user.email || null,
      anonymous: true,
    },
  });
}
