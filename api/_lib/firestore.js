// api/_lib/firestore.js — DORMANT Google Firestore client for the Connect
// pilot.
//
// The pilot stores connect data in db.js's own store (Vercel Postgres in
// production, JSON files in dev) — see api/_lib/connect-store.js. This
// module is the optional Google path, OFF by default:
//
//   SWR_CONNECT_STORE=firestore  +  FIREBASE_PROJECT_ID  +  credentials
//
// To activate (then uninstall nothing — the SDK is loaded on demand):
//   npm install firebase-admin
//   SWR_CONNECT_STORE=firestore FIREBASE_PROJECT_ID=<id> \
//     FIREBASE_SERVICE_ACCOUNT='{...}' npm run dev
//
// Credential envs:
//   FIREBASE_SERVICE_ACCOUNT        — service-account JSON as a string
//   GOOGLE_APPLICATION_CREDENTIALS  — path to a service-account JSON file
//   FIRESTORE_EMULATOR_HOST         — "localhost:8080" for the Firebase
//                                     emulator (no credentials, projectId
//                                     defaults to "swr-local")

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

// firebase-admin is intentionally NOT a dependency (dormant path): it is
// imported on demand so the JSON/Postgres default pays zero cost. If the
// package is missing and the store is activated, the error is thrown once
// and cached instead of failing every invocation.
export async function getFirestore() {
  if (!firestoreConfigured()) {
    throw new Error('Firestore is not configured (SWR_CONNECT_STORE=firestore + FIREBASE_PROJECT_ID + credentials)');
  }
  if (_fs) return _fs;
  if (_loadError) throw _loadError;
  try {
    const { getApps, initializeApp, cert, applicationDefault } = await import('firebase-admin/app');
    const { getFirestore: adminGetFirestore } = await import('firebase-admin/firestore');
    if (!getApps().length) {
      const projectId = (process.env.FIREBASE_PROJECT_ID || '').trim();
      const sa = (process.env.FIREBASE_SERVICE_ACCOUNT || '').trim();
      if (process.env.FIRESTORE_EMULATOR_HOST) {
        initializeApp({ projectId: projectId || 'swr-local' });
      } else if (sa) {
        initializeApp({ credential: cert(JSON.parse(sa)), projectId });
      } else {
        // GOOGLE_APPLICATION_CREDENTIALS via ADC; projectId pinned so doc
        // paths never depend on ambient environment.
        initializeApp({ credential: applicationDefault(), projectId });
      }
    }
    _fs = adminGetFirestore();
    return _fs;
  } catch (e) {
    _loadError = new Error(
      `firebase-admin is not installed. Run: npm install firebase-admin (${e.message})`
    );
    throw _loadError;
  }
}