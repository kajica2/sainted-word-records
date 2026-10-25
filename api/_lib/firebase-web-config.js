// api/_lib/firebase-web-config.js — the PUBLIC Firebase web config.
//
// The web config (apiKey, authDomain, projectId, appId) is public data: it
// ships in the browser bundle of every Firebase web app, and it is not a
// secret. It is read here from the server's env for two reasons:
//   1. the browser and the server cannot drift onto different projects —
//      one env var names the project both sides use;
//   2. no placeholder ever reaches the SDK. A fake key looks like it
//      works and fails later against the real project.
//
// The client (lib/firebase-anon.client.js) asks for it at
// GET /api/auth/firebase-anon?action=config and refuses a config without
// a real API key, so a deployment that has not set these variables simply
// does not offer guest sign-in.
//
// Env:
//   FIREBASE_WEB_API_KEY       — required. The Firebase web API key.
//   FIREBASE_WEB_PROJECT_ID    — defaults to FIREBASE_PROJECT_ID.
//   FIREBASE_WEB_APP_ID        — optional.
//   FIREBASE_WEB_AUTH_DOMAIN   — optional; defaults to
//                                <projectId>.firebaseapp.com.
//   FIREBASE_WEB_STORAGE_BUCKET      — optional.
//   FIREBASE_WEB_MESSAGING_SENDER_ID — optional.

function env(name) {
  return (process.env[name] || '').trim();
}

// The config, or null when the deployment has not configured one. Null
// means "guest sign-in is not available" — never "here is a default".
export function getFirebaseWebConfig() {
  const apiKey = env('FIREBASE_WEB_API_KEY');
  const projectId = env('FIREBASE_WEB_PROJECT_ID') || env('FIREBASE_PROJECT_ID');
  if (!apiKey || !projectId) return null;

  const config = {
    apiKey,
    authDomain: env('FIREBASE_WEB_AUTH_DOMAIN') || `${projectId}.firebaseapp.com`,
    projectId,
  };

  const appId = env('FIREBASE_WEB_APP_ID');
  if (appId) config.appId = appId;
  const storageBucket = env('FIREBASE_WEB_STORAGE_BUCKET');
  if (storageBucket) config.storageBucket = storageBucket;
  const messagingSenderId = env('FIREBASE_WEB_MESSAGING_SENDER_ID');
  if (messagingSenderId) config.messagingSenderId = messagingSenderId;

  return config;
}
