// api/_lib/firebase-admin.js — the ONE place the Firebase Admin app is
// initialised.
//
// Two features need the Admin SDK: the Firestore-backed stores
// (api/_lib/firestore.js) and the anonymous-auth exchange
// (api/auth/firebase-anon.js). When each had its own initialisation
// they could disagree about the project, the credentials and whether the
// emulator was in play — the classic "it works in one place" bug. This
// module is the single seam both go through.
//
// Configuration, in the order it is preferred:
//   FIREBASE_PROJECT_ID              — the project. Required: a Firebase
//                                     ID token's audience must match it,
//                                     so a projectless verification is
//                                     a verification that cannot succeed.
//   FIREBASE_SERVICE_ACCOUNT         — service-account JSON as a string.
//   GOOGLE_APPLICATION_CREDENTIALS   — path to a service-account JSON file
//                                     (Application Default Credentials).
//   FIREBASE_AUTH_EMULATOR_HOST      — the Auth emulator ("host:port").
//                                     No credentials needed; tokens are
//                                     unsigned and the emulator verifies
//                                     them.
//   FIRESTORE_EMULATOR_HOST          — the Firestore emulator. Also needs
//                                     no credentials.
//
// firebase-admin is a real dependency (see package.json). It is imported
// on demand so the default, non-Firebase path pays nothing for it.

let _app = null;
let _loadError = null;

// The pinned project id. Never inferred from the ambient environment:
// doc paths and token audiences must not depend on where the code runs.
export function firebaseAdminProjectId() {
  return (process.env.FIREBASE_PROJECT_ID || '').trim();
}

// Whether the Admin SDK can be initialised with the current environment.
export function firebaseAdminConfigured() {
  if (!firebaseAdminProjectId()) return false;
  if ((process.env.FIREBASE_AUTH_EMULATOR_HOST || '').trim()) return true;
  if ((process.env.FIRESTORE_EMULATOR_HOST || '').trim()) return true;
  return (
    !!(process.env.FIREBASE_SERVICE_ACCOUNT || '').trim() ||
    !!(process.env.GOOGLE_APPLICATION_CREDENTIALS || '').trim()
  );
}

// The initialised Admin app, or an Error describing why it cannot be
// initialised. The app is created once per process.
export async function getAdminApp() {
  if (_app) return _app;
  if (_loadError) throw _loadError;
  try {
    const { getApps, initializeApp, cert, applicationDefault } = await import('firebase-admin/app');
    if (getApps().length) {
      _app = getApps()[0];
      return _app;
    }
    const projectId = firebaseAdminProjectId();
    const sa = (process.env.FIREBASE_SERVICE_ACCOUNT || '').trim();
    const emulator = !!(
      (process.env.FIREBASE_AUTH_EMULATOR_HOST || '').trim() ||
      (process.env.FIRESTORE_EMULATOR_HOST || '').trim()
    );
    if (emulator) {
      // The emulators need no credentials, and the emulator verifies
      // unsigned tokens itself.
      _app = initializeApp({ projectId: projectId || 'swr-local' });
    } else if (sa) {
      let credential;
      try {
        credential = cert(JSON.parse(sa));
      } catch (_) {
        throw new Error('invalid_service_account');
      }
      _app = initializeApp({ credential, projectId });
    } else {
      // GOOGLE_APPLICATION_CREDENTIALS via ADC; the project stays pinned.
      _app = initializeApp({ credential: applicationDefault(), projectId });
    }
    return _app;
  } catch (e) {
    _loadError = e;
    throw e;
  }
}

// The Admin Auth instance, used to verify a Firebase ID token.
export async function getAdminAuth() {
  const app = await getAdminApp();
  const { getAuth } = await import('firebase-admin/auth');
  return getAuth(app);
}
