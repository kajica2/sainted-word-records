// lib/firebase-anon.client.js — window.SWR_FIREBASE_ANON
//
// Signs the visitor in anonymously with Firebase Auth (no Google consent screen).
// The resulting ID token can be exchanged for a normal SWR session cookie via
// POST /api/auth/firebase-anon.
//
// Requires the public Firebase web config (set via window.SWR_FIREBASE_CONFIG
// or the defaults below). Enable the Anonymous provider in the Firebase console.
//
// Usage:
//   await SWR_FIREBASE_ANON.signIn();
//   const token = await SWR_FIREBASE_ANON.getIdToken();
//   await SWR_FIREBASE_ANON.exchangeForSession(); // sets swrc_session cookie

(function () {
  if (window.SWR_FIREBASE_ANON) return;

  const DEFAULT_CONFIG = {
    apiKey: 'YOUR_FIREBASE_API_KEY',
    authDomain: 'your-project.firebaseapp.com',
    projectId: 'your-project',
    appId: 'YOUR_APP_ID',
  };

  let app;
  let auth;
  let ready;

  async function loadSdk() {
    if (auth) return;
    if (ready) return ready;
    ready = (async () => {
      const { initializeApp } = await import('https://www.gstatic.com/firebasejs/12.4.0/firebase-app.js');
      const { getAuth, signInAnonymously, onAuthStateChanged } = await import('https://www.gstatic.com/firebasejs/12.4.0/firebase-auth.js');
      const cfg = window.SWR_FIREBASE_CONFIG || DEFAULT_CONFIG;
      app = initializeApp(cfg);
      auth = getAuth(app);
      window.__SWR_FB_AUTH = auth;
      window.__SWR_FB_signInAnonymously = signInAnonymously;
      window.__SWR_FB_onAuthStateChanged = onAuthStateChanged;
    })();
    return ready;
  }

  async function signIn() {
    await loadSdk();
    const { signInAnonymously } = { signInAnonymously: window.__SWR_FB_signInAnonymously };
    const cred = await signInAnonymously(auth);
    return cred.user;
  }

  function onChange(cb) {
    loadSdk().then(() => {
      window.__SWR_FB_onAuthStateChanged(auth, (user) => cb(user));
    });
  }

  async function getIdToken(force) {
    await loadSdk();
    const user = auth.currentUser;
    if (!user) return null;
    return user.getIdToken(!!force);
  }

  async function exchangeForSession() {
    const token = await getIdToken(true);
    if (!token) throw new Error('no_id_token');
    const res = await fetch('/api/auth/firebase-anon', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ idToken: token }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || 'exchange_failed');
    }
    const data = await res.json();
    if (window.SWR_AUTH && data.user) window.SWR_AUTH.setCachedUser(data.user);
    return data;
  }

  // Auto-sign-in on load if desired (comment out if you prefer explicit call)
  // loadSdk().then(() => signIn()).catch(() => {});

  window.SWR_FIREBASE_ANON = {
    signIn,
    onChange,
    getIdToken,
    exchangeForSession,
    loadSdk,
  };
})();
