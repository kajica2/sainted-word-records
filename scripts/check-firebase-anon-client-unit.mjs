#!/usr/bin/env node
// scripts/check-firebase-anon-client-unit.mjs - Firebase anonymous-auth client unit gate.
//
// lib/firebase-anon.client.js is the browser half of "auth using anonymous
// firestore": the visitor signs in with Firebase Anonymous Auth, the SDK
// hands back an ID token, and the client exchanges that token for the
// swrc_session cookie through POST /api/auth/firebase-anon.
//
// The gate runs the REAL shipped client inside a node:vm sandbox with a fake
// window/document/fetch, and stubs the two dynamic SDK imports
// (https://www.gstatic.com/firebasejs/12.4.0/firebase-app.js and
// .../firebase-auth.js) through vm.Script's importModuleDynamically callback.
// So the code under test is the shipped code, not a re-implementation.
//
// Assertions (behaviour, not wiring):
//   1. the client publishes the documented window.SWR_FIREBASE_ANON surface
//   2. with NO config anywhere, loadSdk() rejects with 'firebase_not_configured'
//   3. with NO config anywhere, initializeApp() is never called
//   4. with NO config anywhere, isConfigured() resolves false
//   5. with NO config anywhere, signIn() rejects with 'firebase_not_configured'
//   6. window.SWR_FIREBASE_CONFIG is passed to initializeApp() unchanged
//   7. an explicit page config means the server is never asked for one
//   8. without a page config the client GETs /api/auth/firebase-anon?action=config
//   9. the config the server returned is the config initializeApp() receives
//  10. the server config makes isConfigured() resolve true
//  11. signIn() calls the SDK's signInAnonymously with the auth instance
//  12. signIn() resolves the anonymous user
//  13. the SDK is imported from the pinned 12.4.0 gstatic URLs
//  14. exchangeForSession() POSTs { idToken } to /api/auth/firebase-anon
//      with credentials:'include'
//  15. a successful exchange calls window.SWR_AUTH.setCachedUser(user)
//  16. a successful exchange resolves the server body
//  17. a 401 { error: 'invalid_id_token' } throws an Error with that message
//  18. no placeholder Firebase config string survives in the shipped client
//  19. the SDK handles are published on window for console use
//
// The gate proves it can still fail: the shipped source is copied to a temp
// directory, mutated in memory (a placeholder config fallback re-introduced,
// the setCachedUser call dropped), and the SAME assertions are re-run against
// each mutant - they must go RED. The unmutated copy must be GREEN.
//
// Run:  node scripts/check-firebase-anon-client-unit.mjs
// Exit: 0 PASS, 1 FAIL.
//
// NOTE: stubbing a dynamic import() inside node:vm needs vm.Module, which
// Node still ships behind --experimental-vm-modules. When the flag is
// missing the gate re-runs itself with it, so the plain
// `node scripts/check-firebase-anon-client-unit.mjs` invocation works.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const SELF = fileURLToPath(import.meta.url);

if (typeof vm.SyntheticModule !== 'function') {
  if (process.env.SWR_FB_GATE_VM_MODULES === '1') {
    console.error('FATAL: this Node build exposes no vm.SyntheticModule; ' +
      'run the gate with --experimental-vm-modules.');
    process.exit(1);
  }
  const { spawnSync } = await import('node:child_process');
  const child = spawnSync(
    process.execPath,
    ['--experimental-vm-modules', '--no-warnings', SELF],
    { stdio: 'inherit', env: { ...process.env, SWR_FB_GATE_VM_MODULES: '1' } },
  );
  process.exit(child.status === null ? 1 : child.status);
}

const ROOT = path.dirname(path.dirname(SELF));
const SRC = path.join(ROOT, 'lib/firebase-anon.client.js');

const APP_URL = 'https://www.gstatic.com/firebasejs/12.4.0/firebase-app.js';
const AUTH_URL = 'https://www.gstatic.com/firebasejs/12.4.0/firebase-auth.js';

let pass = 0;
const failures = [];
function report(ok, msg, detail) {
  if (ok) {
    pass++;
    console.log('  ok  ', msg, detail != null ? `(${detail})` : '');
  } else {
    failures.push(msg + (detail != null ? ` (${detail})` : ''));
    console.log('  FAIL', msg, detail != null ? `(${detail})` : '');
  }
}

// ── the SDK stub ──────────────────────────────────────────────────────────
// A dynamic import() inside a vm script is intercepted by
// importModuleDynamically, which must hand back a Module. Two synthetic
// modules stand in for the gstatic SDK: one exports initializeApp, the other
// exports getAuth / signInAnonymously / onAuthStateChanged. Every call is
// recorded, so the assertions can check that the client really used them.
function makeSdk(state) {
  return async function importModuleDynamically(specifier) {
    state.imports.push(String(specifier));
    const mod = String(specifier).endsWith('firebase-app.js')
      ? new vm.SyntheticModule(['initializeApp'], function () {
        this.setExport('initializeApp', (config) => {
          state.initCalls.push(config);
          return { __app: 'swr-app' };
        });
      })
      : new vm.SyntheticModule(['getAuth', 'signInAnonymously', 'onAuthStateChanged'], function () {
        this.setExport('getAuth', (app) => {
          state.getAuthCalls.push(app);
          return state.auth;
        });
        this.setExport('signInAnonymously', (auth) => {
          state.signInAnonCalls.push(auth);
          return Promise.resolve({ user: state.user });
        });
        this.setExport('onAuthStateChanged', (auth, cb) => {
          state.onAuthStateChangedCalls.push([auth, cb]);
        });
      });
    await mod.link(() => {});
    await mod.evaluate();
    return mod;
  };
}

// ── the harness ───────────────────────────────────────────────────────────
// One sandbox per scenario: the client caches its SDK and its config, so
// scenarios must not share a window.
function makeHarness(source, opts = {}) {
  const state = {
    imports: [],
    initCalls: [],
    getAuthCalls: [],
    signInAnonCalls: [],
    onAuthStateChangedCalls: [],
    fetchCalls: [],
    tokenCalls: [],
  };
  const user = {
    uid: 'anon-uid-1',
    getIdToken: async (force) => {
      state.tokenCalls.push(!!force);
      return force ? 'forced-id-token' : 'cached-id-token';
    },
  };
  state.user = user;
  state.auth = { currentUser: user };

  const fetchImpl = async (url, init) => {
    state.fetchCalls.push({ url: String(url), init: init || null });
    if (opts.fetch) return opts.fetch(String(url), init || null, state);
    return { ok: true, status: 200, json: async () => ({ ok: true }) };
  };

  const win = Object.assign({}, opts.window);
  const ctx = vm.createContext({
    window: win,
    document: opts.document || {},
    fetch: fetchImpl,
    console,
  });
  const script = new vm.Script(source, {
    filename: 'firebase-anon.client.js',
    importModuleDynamically: makeSdk(state),
  });
  script.runInContext(ctx);

  return { api: win.SWR_FIREBASE_ANON, win, state, ctx };
}

function isError(err) {
  return Object.prototype.toString.call(err) === '[object Error]';
}

function sameJson(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

const WINDOW_CONFIG = {
  apiKey: 'window-key',
  authDomain: 'window.example.com',
  projectId: 'window-project',
  appId: 'window-app',
};

const SERVER_CONFIG = {
  apiKey: 'server-key',
  authDomain: 'server.example.com',
  projectId: 'server-project',
  appId: 'server-app',
};

const SERVER_USER = {
  id: 'swr-user-1',
  name: 'Guest',
  email: null,
  image: null,
  provider: 'firebase-anonymous',
  membershipTier: 'free',
  joinedAt: '2026-10-24T00:00:00.000Z',
  anonymous: true,
};

function jsonResponse(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  };
}

// ── the assertion suite ───────────────────────────────────────────────────
// One function, parameterised by the client source, so the SAME assertions
// run against the shipped file and against a mutated copy of it.
async function runSuite(source) {
  const results = [];
  const check = (id, cond, msg, detail) => {
    results.push({ id, ok: !!cond, msg, detail: detail == null ? '' : String(detail) });
    return !!cond;
  };

  // 1. the published surface
  const probe = makeHarness(source);
  const api = probe.api;
  const surface = ['signIn', 'onChange', 'getIdToken', 'exchangeForSession', 'loadSdk', 'isConfigured'];
  const missing = surface.filter((n) => !api || typeof api[n] !== 'function');
  check(1, !!api && missing.length === 0,
    'window.SWR_FIREBASE_ANON publishes the documented surface',
    missing.length ? `missing ${missing.join(', ')}` : `${surface.length} members`);

  // 2-5. no config anywhere
  {
    const h = makeHarness(source, {
      fetch: async (url) => (url.includes('action=config')
        ? jsonResponse(404, { ok: false, error: 'not_configured' })
        : jsonResponse(200, { ok: true })),
    });
    let loadErr = null;
    try { await h.api.loadSdk(); } catch (e) { loadErr = e; }
    check(2, isError(loadErr) && loadErr.message === 'firebase_not_configured',
      'with no config anywhere, loadSdk() rejects with firebase_not_configured',
      loadErr ? loadErr.message : 'no rejection');

    check(3, h.state.initCalls.length === 0,
      'with no config anywhere, initializeApp() is never called',
      `${h.state.initCalls.length} call(s)`);

    const configured = await h.api.isConfigured();
    check(4, configured === false,
      'with no config anywhere, isConfigured() resolves false',
      String(configured));

    let signErr = null;
    try { await h.api.signIn(); } catch (e) { signErr = e; }
    check(5, isError(signErr) && signErr.message === 'firebase_not_configured',
      'with no config anywhere, signIn() rejects with firebase_not_configured',
      signErr ? signErr.message : 'no rejection');
  }

  // 6, 7, 13, 19. an explicit page config wins
  {
    const h = makeHarness(source, {
      window: { SWR_FIREBASE_CONFIG: WINDOW_CONFIG },
      fetch: async () => { throw new Error('the server must not be asked for a config'); },
    });
    await h.api.loadSdk();
    const init = h.state.initCalls[0];
    check(6, h.state.initCalls.length === 1 && init === WINDOW_CONFIG && sameJson(init, WINDOW_CONFIG),
      'window.SWR_FIREBASE_CONFIG is handed to initializeApp() unchanged',
      init ? JSON.stringify(init) : 'initializeApp not called');
    check(7, h.state.fetchCalls.length === 0,
      'an explicit page config means the server is never asked for one',
      `${h.state.fetchCalls.length} fetch call(s)`);
    check(13, h.state.imports.length === 2 &&
      h.state.imports.includes(APP_URL) && h.state.imports.includes(AUTH_URL),
      'the SDK is imported from the pinned 12.4.0 gstatic URLs',
      h.state.imports.join(' '));
    check(19, h.win.__SWR_FB_AUTH === h.state.auth &&
      typeof h.win.__SWR_FB_signInAnonymously === 'function' &&
      typeof h.win.__SWR_FB_onAuthStateChanged === 'function',
      'the SDK handles are published on window for console use');
  }

  // 8, 9, 10. the server is the source of the config
  {
    const h = makeHarness(source, {
      fetch: async (url) => (url.includes('action=config')
        ? jsonResponse(200, { ok: true, config: SERVER_CONFIG })
        : jsonResponse(200, { ok: true })),
    });
    await h.api.loadSdk();
    const configCall = h.state.fetchCalls.find((c) => c.url.includes('action=config'));
    check(8, !!configCall && configCall.url === '/api/auth/firebase-anon?action=config',
      'without a page config the client GETs /api/auth/firebase-anon?action=config',
      configCall ? configCall.url : 'no config request');
    const init = h.state.initCalls[0];
    check(9, h.state.initCalls.length === 1 && sameJson(init, SERVER_CONFIG),
      'the config the server returned is the config initializeApp() receives',
      init ? JSON.stringify(init) : 'initializeApp not called');
    const configured = await h.api.isConfigured();
    check(10, configured === true,
      'the server config makes isConfigured() resolve true',
      String(configured));
  }

  // 11, 12. signIn
  {
    const h = makeHarness(source, {
      window: { SWR_FIREBASE_CONFIG: WINDOW_CONFIG },
    });
    const user = await h.api.signIn();
    check(11, h.state.signInAnonCalls.length === 1 && h.state.signInAnonCalls[0] === h.state.auth,
      "signIn() calls the SDK's signInAnonymously with the auth instance",
      `${h.state.signInAnonCalls.length} call(s)`);
    check(12, user === h.state.user,
      'signIn() resolves the anonymous user',
      user && user.uid ? user.uid : String(user));
  }

  // 14, 15, 16. a successful exchange
  {
    const cached = [];
    const h = makeHarness(source, {
      window: {
        SWR_FIREBASE_CONFIG: WINDOW_CONFIG,
        SWR_AUTH: { setCachedUser: (u) => { cached.push(u); } },
      },
      fetch: async (url, init) => (init && init.method === 'POST'
        ? jsonResponse(200, { ok: true, user: SERVER_USER })
        : jsonResponse(200, { ok: true })),
    });
    const result = await h.api.exchangeForSession();
    const post = h.state.fetchCalls.find((c) => c.init && c.init.method === 'POST');
    let body = null;
    try { body = post ? JSON.parse(post.init.body) : null; } catch (_) { body = null; }
    check(14, !!post && post.url === '/api/auth/firebase-anon' &&
      post.init.credentials === 'include' && sameJson(body, { idToken: 'forced-id-token' }),
      "exchangeForSession() POSTs { idToken } to /api/auth/firebase-anon with credentials:'include'",
      post ? `${post.url} creds=${post.init.credentials} body=${post.init.body}` : 'no POST');
    check(15, cached.length === 1 && cached[0] === SERVER_USER,
      'a successful exchange calls window.SWR_AUTH.setCachedUser(user)',
      `${cached.length} call(s)`);
    check(16, !!result && result.ok === true && result.user === SERVER_USER,
      'a successful exchange resolves the server body',
      result ? JSON.stringify(result) : 'no result');
  }

  // 17. the server refuses the token
  {
    const h = makeHarness(source, {
      window: { SWR_FIREBASE_CONFIG: WINDOW_CONFIG },
      fetch: async (url, init) => (init && init.method === 'POST'
        ? jsonResponse(401, { error: 'invalid_id_token' })
        : jsonResponse(200, { ok: true })),
    });
    let err = null;
    try { await h.api.exchangeForSession(); } catch (e) { err = e; }
    check(17, isError(err) && err.message === 'invalid_id_token',
      "a 401 { error: 'invalid_id_token' } throws an Error with that message",
      err ? err.message : 'no rejection');
  }

  // 18. no placeholder config survives in the shipped client
  {
    // Matched loosely (case-insensitive, tolerant of the separator) so a
    // placeholder in ANY casing is caught - and so this gate file itself
    // does not have to carry the literal placeholder strings.
    const placeholders = [
      /your[-_ ]?firebase/i,
      /your[-_ ]?app[-_ ]?id/i,
      /your[-_ ]?project/i,
      /default[-_ ]?config/i,
    ];
    const found = placeholders.filter((re) => re.test(source)).map((re) => re.source);
    check(18, found.length === 0,
      'no placeholder Firebase config string survives in the client',
      found.length ? found.join(', ') : 'none');
  }

  return results;
}

// ── run the suite against the shipped module ──────────────────────────────
console.log('firebase-anon client unit gate');
console.log('');

const shippedSource = fs.readFileSync(SRC, 'utf8');
const shippedResults = await runSuite(shippedSource);
for (const r of shippedResults) report(r.ok, r.msg, r.detail);

// ── the mutation self-test ────────────────────────────────────────────────
// Copy the shipped client to a temp dir, mutate the copy, and re-run the
// SAME assertions against it: they must go RED. The repo tree is never
// written to.
async function runMutant(label, mutate, expectRed) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'swr-fb-anon-'));
  try {
    const target = path.join(tmp, 'firebase-anon.client.js');
    const original = fs.readFileSync(SRC, 'utf8');
    const mutated = mutate(original);
    if (mutated === original) {
      report(false, `RED PROOF: the ${label} mutant turns assertion(s) ${expectRed.join(', ')} RED`,
        'the mutation did not change the source');
      return;
    }
    fs.writeFileSync(target, mutated);
    const results = await runSuite(mutated);
    const red = results.filter((r) => !r.ok).map((r) => r.id);
    const bit = expectRed.every((n) => red.includes(n));
    report(bit && red.length > 0,
      `RED PROOF: the ${label} mutant turns assertion(s) ${expectRed.join(', ')} RED`,
      red.length ? `red assertions: [${red.join(', ')}]` : 'the mutant stayed green');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

// The pre-fix state: a placeholder config fallback, so a deployment with no
// Firebase web config quietly boots the SDK with a fake key instead of
// refusing. Assertions 2, 3 and 5 must go red.
await runMutant(
  'placeholder-config-fallback',
  (src) => src.replace(
    'const cfg = await resolveConfig();\n      if (!cfg) throw new Error(NOT_CONFIGURED);',
    "const cfg = await resolveConfig() || { apiKey: 'mutant-placeholder-key', " +
    "authDomain: 'mutant.example.com', projectId: 'mutant-project', appId: 'mutant-app' };",
  ),
  [2, 3, 5],
);

// The cached-user refresh dropped: the exchange still succeeds, but the page
// keeps showing the signed-out state. Assertion 15 must go red.
await runMutant(
  'drop-set-cached-user',
  (src) => src.replace(
    "if (window.SWR_AUTH && data && data.user &&\n" +
    "        typeof window.SWR_AUTH.setCachedUser === 'function') {\n" +
    '      window.SWR_AUTH.setCachedUser(data.user);\n    }',
    '/* mutant: setCachedUser dropped */',
  ),
  [15],
);

// The session cookie is the whole point of the exchange: dropping
// credentials:'include' means the swrc_session cookie never reaches the
// browser. Assertion 14 must go red.
await runMutant(
  'drop-credentials',
  (src) => src.replace("      credentials: 'include',\n      body: JSON.stringify({ idToken: token }),",
    '      body: JSON.stringify({ idToken: token }),'),
  [14],
);

// The unmutated copy must be GREEN again - the mutations are what turned the
// gate red, not the harness.
{
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'swr-fb-anon-'));
  try {
    const target = path.join(tmp, 'firebase-anon.client.js');
    fs.writeFileSync(target, shippedSource);
    const results = await runSuite(shippedSource);
    const red = results.filter((r) => !r.ok).map((r) => r.id);
    report(red.length === 0,
      'the unmutated copy of the client is GREEN again',
      red.length ? `red assertions: [${red.join(', ')}]` : `${results.length} assertions`);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

// ── summary ───────────────────────────────────────────────────────────────
console.log('');
console.log(`PASS: ${pass} / FAIL: ${failures.length}`);
if (failures.length) {
  console.log('');
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
}
process.exit(0);
