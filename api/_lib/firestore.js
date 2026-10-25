// api/_lib/firestore.js — the Google Firestore client.
//
// The Firestore-backed stores are OFF by default. They switch on with:
//   SWR_CONNECT_STORE=firestore  (the Stripe Connect pilot)
//   SWR_AUTH_STORE=firestore     (the auth store — users, sessions,
//                                 provider links, verification tokens)
// and need FIREBASE_PROJECT_ID plus credentials.
//
// Credential envs:
//   FIREBASE_SERVICE_ACCOUNT        — service-account JSON as a string
//   GOOGLE_APPLICATION_CREDENTIALS  — path to a service-account JSON file
//   FIRESTORE_EMULATOR_HOST         — "localhost:8080" for the Firebase
//                                     emulator (no credentials, projectId
//                                     defaults to "swr-local")
//
// The Admin app itself is initialised in api/_lib/firebase-admin.js, the
// single seam shared with the anonymous-auth exchange. Two features that
// each initialised their own app could disagree about the project, the
// credentials and whether the emulator was in play.

import { getAdminApp } from './firebase-admin.js';

export function firestoreConfigured() {
  if (process.env.FIRESTORE_EMULATOR_HOST) return true;
  return (
    !!(process.env.FIREBASE_PROJECT_ID || '').trim() &&
    (!!(process.env.FIREBASE_SERVICE_ACCOUNT || '').trim() ||
      !!(process.env.GOOGLE_APPLICATION_CREDENTIALS || '').trim())
  );
}

let _fs = null;
let _loadError = null;

// firebase-admin IS a dependency (see package.json), but it is imported
// on demand so the default, non-Firestore path pays zero cost. If the
// package is missing and the store is activated, the error is thrown once
// and cached instead of failing every invocation.
export async function getFirestore() {
  if (!firestoreConfigured()) {
    throw new Error('Firestore is not configured (SWR_CONNECT_STORE=firestore + FIREBASE_PROJECT_ID + credentials)');
  }
  if (_fs) return _fs;
  if (_loadError) throw _loadError;
  try {
    const app = await getAdminApp();
    const { getFirestore: adminGetFirestore } = await import('firebase-admin/firestore');
    _fs = adminGetFirestore(app);
    return _fs;
  } catch (e) {
    _loadError = new Error(
      `firebase-admin could not be loaded. Run: npm install firebase-admin (${e.message})`
    );
    throw _loadError;
  }
}
