// api/auth/firebase-anon.js — exchange a Firebase Anonymous ID token for a SWR session.
//
// POST { idToken } → verifies with firebase-admin, creates/links a local user,
// starts a session and sets the swrc_session cookie.
//
// Requires FIREBASE_PROJECT_ID + FIREBASE_SERVICE_ACCOUNT (or GOOGLE_APPLICATION_CREDENTIALS)
// and the Anonymous provider enabled in the Firebase console.

import { readJsonBody, sendJson, setCors, setSessionCookie } from '../_lib/http.js';
import { createSession, linkAccount, resolveFirebaseUser } from '../_lib/db.js';
import { getAuth } from 'firebase-admin/auth';
import { initializeApp, getApps, cert } from 'firebase-admin/app';

function getAdmin() {
  if (getApps().length) return getAuth();
  const projectId = process.env.FIREBASE_PROJECT_ID;
  const sa = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!projectId) throw new Error('firebase_not_configured');
  const options = { projectId };
  if (sa) {
    try {
      options.credential = cert(JSON.parse(sa));
    } catch (_) {
      throw new Error('invalid_service_account');
    }
  }
  initializeApp(options);
  return getAuth();
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

  const body = await readJsonBody(req);
  const idToken = body && String(body.idToken || '').trim();
  if (!idToken) return sendJson(res, 400, { error: 'missing_id_token' });

  let decoded;
  try {
    const admin = getAdmin();
    decoded = await admin.verifyIdToken(idToken);
  } catch (e) {
    console.error('[firebase-anon] verify failed:', e && e.message);
    return sendJson(res, 401, { error: 'invalid_id_token' });
  }

  if (!decoded.firebase || decoded.firebase.sign_in_provider !== 'anonymous') {
    return sendJson(res, 400, { error: 'not_anonymous' });
  }

  let user;
  try {
    user = await resolveFirebaseUser(decoded);
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
