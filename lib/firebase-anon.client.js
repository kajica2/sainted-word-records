// lib/firebase-anon.client.js — window.SWR_FIREBASE_ANON
//
// Signs the visitor in anonymously with Firebase Auth (no Google consent
// screen). The resulting ID token is exchanged for a normal SWR session
// cookie by POST /api/auth/firebase-anon.
//
// The Firebase web config is public data (it ships in every web bundle), but
// it is NOT hardcoded here: a fake key would look like it works and fail
// later. It is resolved, in order:
//   1. window.SWR_FIREBASE_CONFIG, when a page sets one explicitly
//   2. GET /api/auth/firebase-anon?action=config (the server reads its env)
// If neither yields a real config, the client is NOT configured: loadSdk()
// and signIn() reject with 'firebase_not_configured' and isConfigured()
// resolves false. initializeApp() is never called without a real config.
//
// Enable the Anonymous provider in the Firebase console.
//
// Usage:
//   await SWR_FIREBASE_ANON.signIn();
//   const token = await SWR_FIREBASE_ANON.getIdToken();
//   await SWR_FIREBASE_ANON.exchangeForSession(); // sets swrc_session cookie

(function () {
  if (window.SWR_FIREBASE_ANON) return;

  const SDK_VERSION = '12.4.0';
  const SDK_BASE = 'https://www.gstatic.com/firebasejs/' + SDK_VERSION + '/';
  const SDK_APP_URL = SDK_BASE + 'firebase-app.js';
  const SDK_AUTH_URL = SDK_BASE + 'firebase-auth.js';
  const CONFIG_URL = '/api/auth/firebase-anon?action=config';
  const SESSION_URL = '/api/auth/firebase-anon';
  const NOT_CONFIGURED = 'firebase_not_configured';

  let fbApp = null;
  let fbAuth = null;
  let sdkReady = null;
  let configPromise = null;
  let fbSignInAnonymously = null;
  let fbOnAuthStateChanged = null;

  // A config is only usable when it carries a real-looking API key. The
  // check is deliberately about the VALUE, not about where it came from.
  function hasApiKey(cfg) {
    return !!(cfg && typeof cfg === 'object' &&
      typeof cfg.apiKey === 'string' && cfg.apiKey.trim() !== '');
  }

  async function fetchConfig() {
    let res;
    try {
      res = await fetch(CONFIG_URL, {
        credentials: 'include',
        headers: { Accept: 'application/json' },
      });
    } catch (_) {
      return null;
    }
    if (!res || !res.ok) return null;
    let body = null;
    try {
      body = await res.json();
    } catch (_) {
      return null;
    }
    if (!body || !body.config) return null;
    return hasApiKey(body.config) ? body.config : null;
  }

  function resolveConfig() {
    const inline = window.SWR_FIREBASE_CONFIG;
    if (hasApiKey(inline)) return Promise.resolve(inline);
    if (!configPromise) {
      configPromise = fetchConfig()
        .catch(() => null)
        .then((cfg) => {
          // A failed lookup is NOT cached: one network hiccup must not
          // disable guest sign-in for the rest of the page's life.
          if (!cfg) configPromise = null;
          return cfg;
        });
    }
    return configPromise;
  }

  async function loadSdk() {
    if (fbAuth) return fbAuth;
    if (sdkReady) return sdkReady;
    const pending = (async () => {
      const cfg = await resolveConfig();
      if (!cfg) throw new Error(NOT_CONFIGURED);
      const appMod = await import(SDK_APP_URL);
      const authMod = await import(SDK_AUTH_URL);
      const initializeApp = appMod.initializeApp;
      const getAuth = authMod.getAuth;
      const signInAnonymously = authMod.signInAnonymously;
      const onAuthStateChanged = authMod.onAuthStateChanged;
      fbApp = initializeApp(cfg);
      fbAuth = getAuth(fbApp);
      fbSignInAnonymously = signInAnonymously;
      fbOnAuthStateChanged = onAuthStateChanged;
      // Kept for the browser console. The code below always calls the
      // imported functions directly, never these globals.
      window.__SWR_FB_AUTH = fbAuth;
      window.__SWR_FB_signInAnonymously = signInAnonymously;
      window.__SWR_FB_onAuthStateChanged = onAuthStateChanged;
      return fbAuth;
    })();
    sdkReady = pending;
    // A failed load must not poison the next attempt: clear the cached
    // promise so a later call can try again.
    pending.catch(() => {
      if (sdkReady === pending) sdkReady = null;
    });
    return pending;
  }

  async function signIn() {
    const auth = await loadSdk();
    const cred = await fbSignInAnonymously(auth);
    return cred && cred.user ? cred.user : null;
  }

  function onChange(cb) {
    loadSdk().then((auth) => {
      fbOnAuthStateChanged(auth, (user) => cb(user));
    }).catch(() => {
      // No config, no SDK: there is no auth state to report.
    });
  }

  async function getIdToken(force) {
    const auth = await loadSdk();
    const user = auth.currentUser;
    if (!user) return null;
    return user.getIdToken(!!force);
  }

  async function exchangeForSession() {
    const token = await getIdToken(true);
    if (!token) throw new Error('no_id_token');
    const res = await fetch(SESSION_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ idToken: token }),
    });
    if (!res || !res.ok) {
      let err = null;
      try {
        err = await res.json();
      } catch (_) {
        err = null;
      }
      throw new Error((err && err.error) || 'exchange_failed');
    }
    const data = await res.json();
    if (window.SWR_AUTH && data && data.user &&
        typeof window.SWR_AUTH.setCachedUser === 'function') {
      window.SWR_AUTH.setCachedUser(data.user);
    }
    return data;
  }

  async function isConfigured() {
    return hasApiKey(await resolveConfig());
  }

  window.SWR_FIREBASE_ANON = {
    signIn,
    onChange,
    getIdToken,
    exchangeForSession,
    loadSdk,
    isConfigured,
  };
})();
