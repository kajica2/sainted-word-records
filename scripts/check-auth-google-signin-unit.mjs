#!/usr/bin/env node
// scripts/check-auth-google-signin-unit.mjs — Google sign-in unit tests.
//
// The Google round-trip is the one part of auth that cannot be exercised
// without a real Google account, so the two Google endpoints (the token
// exchange and userinfo) are stubbed and everything else runs for real
// against the actual handlers over HTTP: the HMAC-signed state, the session
// cookie, the user record, the Drive-token branch and the open-redirect
// guard.
//
// What is asserted here is the behaviour a user depends on:
//   1. "Continue with Google" reaches Google's consent screen with the
//      identity scope only (a sign-in must not ask for Drive access).
//   2. The state cannot be forged, and the return path cannot leave the site.
//   3. A first-time visitor is signed in: a user record and a session cookie
//      exist afterwards, and signing in twice is the same person.
//   4. The Drive-link branch stores the Drive tokens; a sign-in does not.
//   5. The callback endpoint lands the visitor back where they came from.

import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 5193;

let failures = 0;
function assert(cond, label) {
  if (cond) {
    console.log(`  ok  ${label}`);
  } else {
    failures += 1;
    console.error(`FAIL  ${label}`);
  }
}

// ── environment ──────────────────────────────────────────────────────────────
// The data root has to be set before db.js is imported: it reads it once,
// at module load.
const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'swr-google-'));
process.env.SWRC_DATA_DIR = DATA_DIR;
process.env.GOOGLE_CLIENT_ID = 'test-client.apps.googleusercontent.com';
process.env.GOOGLE_CLIENT_SECRET = 'test-client-secret';
delete process.env.GOOGLE_REDIRECT_URI;

const { signState, verifyState } = await import(pathToFileURL(path.join(ROOT, 'api/_lib/google.js')).href);
const { findUserByEmail } = await import(pathToFileURL(path.join(ROOT, 'api/_lib/db.js')).href);

// ── Google stubs ─────────────────────────────────────────────────────────────
const GOOGLE_PROFILE = {
  sub: 'google-sub-0001',
  email: 'contributor@gmail.com',
  name: 'Kai Contributor',
  picture: 'https://lh3.googleusercontent.com/a/avatar',
};
let tokenCalls = 0;
let userinfoCalls = 0;

const realFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  const url = typeof input === 'string' ? input : String(input && input.url);
  if (url.startsWith('https://oauth2.googleapis.com/token')) {
    tokenCalls += 1;
    return {
      ok: true,
      status: 200,
      json: async () => ({
        access_token: 'access-token-1',
        refresh_token: 'refresh-token-1',
        expires_in: 3600,
        token_type: 'Bearer',
        scope: 'openid email profile',
      }),
    };
  }
  if (url.startsWith('https://www.googleapis.com/oauth2/v3/userinfo')) {
    userinfoCalls += 1;
    return { ok: true, status: 200, json: async () => GOOGLE_PROFILE };
  }
  // The test's own calls to the local server go through untouched; any other
  // outbound request is a bug in the handler and fails loudly.
  if (url.startsWith('http://localhost:')) return realFetch(input, init);
  throw new Error(`unexpected outbound request in test: ${url}`);
};

// ── server ───────────────────────────────────────────────────────────────────
const HANDLERS = {
  '/api/auth/google': path.join(ROOT, 'api/auth/google.js'),
  '/api/auth/google/callback': path.join(ROOT, 'api/auth/google/callback.js'),
};
const cache = new Map();
async function loadHandler(abs) {
  if (!cache.has(abs)) {
    const mod = await import(pathToFileURL(abs).href);
    cache.set(abs, mod.default || mod);
  }
  return cache.get(abs);
}

const server = http.createServer(async (req, res) => {
  const urlPath = req.url.split('?')[0];
  const abs = HANDLERS[urlPath];
  if (!abs) {
    res.statusCode = 404;
    res.end('not found');
    return;
  }
  const handler = await loadHandler(abs);
  try {
    await handler(req, res);
  } catch (e) {
    res.statusCode = 500;
    res.end(String((e && e.message) || e));
  }
});

function base() {
  return `http://localhost:${PORT}`;
}

function statePayload(overrides = {}) {
  return {
    redirect: '/engine',
    redirectUri: `${base()}/api/auth/google/callback`,
    mode: 'redirect',
    intent: 'signin',
    ts: Date.now(),
    ...overrides,
  };
}

function users() {
  const file = path.join(DATA_DIR, 'auth', 'users.json');
  if (!fs.existsSync(file)) return [];
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function sessions() {
  const file = path.join(DATA_DIR, 'auth', 'sessions.json');
  if (!fs.existsSync(file)) return [];
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

async function main() {
  await new Promise((r) => server.listen(PORT, r));

  // ── 1. the start endpoint ────────────────────────────────────────────────
  console.log('\n=== start: "Continue with Google" ===');
  let r = await fetch(`${base()}/api/auth/google?intent=signin&redirect=${encodeURIComponent('/engine')}`, {
    redirect: 'manual',
  });
  assert(r.status === 302, 'GET /api/auth/google redirects (302)');
  const loc = r.headers.get('location') || '';
  assert(loc.startsWith('https://accounts.google.com/o/oauth2/v2/auth'), 'redirect goes to Google');
  const q = new URL(loc).searchParams;
  assert(q.get('client_id') === process.env.GOOGLE_CLIENT_ID, 'client_id is sent');
  assert(q.get('scope') === 'openid email profile', 'sign-in asks for identity scopes only');
  assert(!String(q.get('scope')).includes('drive'), 'sign-in does not ask for Drive access');
  assert(q.get('access_type') === 'online', 'sign-in is an online (no refresh token) grant');
  const state = q.get('state') || '';
  const decoded = verifyState(state, process.env.GOOGLE_CLIENT_SECRET);
  assert(!!decoded, 'the state verifies against the client secret');
  assert(decoded && decoded.redirect === '/engine', 'the state carries the return path');
  assert(decoded && decoded.mode === 'redirect', 'the state carries the flow mode');
  assert(!verifyState(`${state}x`, process.env.GOOGLE_CLIENT_SECRET), 'a tampered state is rejected');

  // ── 2. the return path cannot leave the site ─────────────────────────────
  console.log('\n=== the return path is same-origin only ===');
  r = await fetch(`${base()}/api/auth/google?redirect=${encodeURIComponent('https://evil.example/steal')}`, {
    redirect: 'manual',
  });
  const evilState = new URL(r.headers.get('location')).searchParams.get('state');
  const evilDecoded = verifyState(evilState, process.env.GOOGLE_CLIENT_SECRET);
  assert(evilDecoded && evilDecoded.redirect === '/', 'an off-site return path falls back to /');

  // ── 3. the Drive branch asks for Drive access ────────────────────────────
  console.log('\n=== the Drive link asks for Drive access ===');
  r = await fetch(`${base()}/api/auth/google?intent=drive&redirect=%2Fengine`, { redirect: 'manual' });
  const driveQ = new URL(r.headers.get('location')).searchParams;
  assert(String(driveQ.get('scope')).includes('drive.readonly'), 'the Drive scope is requested');
  assert(driveQ.get('access_type') === 'offline', 'the Drive grant is offline (refresh token)');
  const driveState = verifyState(driveQ.get('state'), process.env.GOOGLE_CLIENT_SECRET);
  assert(driveState && driveState.mode === 'popup', 'the Drive flow runs in popup mode');

  // ── 4. missing configuration ─────────────────────────────────────────────
  console.log('\n=== missing configuration ===');
  const savedId = process.env.GOOGLE_CLIENT_ID;
  delete process.env.GOOGLE_CLIENT_ID;
  r = await fetch(`${base()}/api/auth/google`, { redirect: 'manual' });
  const cfgLoc = r.headers.get('location') || '';
  assert(r.status === 302 && cfgLoc.includes('error=google_oauth_not_configured'), 'no client id → back to the login page');
  r = await fetch(`${base()}/api/auth/google`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code: 'x', state: 'y' }),
  });
  const cfgBody = await r.json();
  assert(r.status === 503 && cfgBody.error === 'google_oauth_not_configured', 'the exchange answers 503');
  process.env.GOOGLE_CLIENT_ID = savedId;

  // ── 5. the exchange signs a first-time visitor in ────────────────────────
  console.log('\n=== exchange: first-time sign-in ===');
  const signinState = signState(statePayload(), process.env.GOOGLE_CLIENT_SECRET);
  r = await fetch(`${base()}/api/auth/google`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code: 'auth-code-1', state: signinState }),
  });
  const signinBody = await r.json();
  const setCookie = r.headers.get('set-cookie') || '';
  assert(r.status === 200 && signinBody.ok, 'the exchange returns 200');
  assert(signinBody.signedIn === true, 'the visitor is signed in');
  assert(signinBody.user && signinBody.user.email === GOOGLE_PROFILE.email, 'the Google email is the account');
  assert(/swrc_session=/.test(setCookie), 'a session cookie is set');
  assert(signinBody.user && signinBody.user.id, 'the user has an id');
  const userId = signinBody.user.id;
  const stored = users().find((u) => u.id === userId);
  assert(!!stored, 'the user record is written to the store');
  assert(stored && stored.email === GOOGLE_PROFILE.email, 'the stored email matches Google');
  assert(stored && !stored.googleDrive, 'a plain sign-in stores no Drive tokens');
  assert(sessions().some((s) => s.userId === userId), 'the session row points at the user');

  // ── 6. signing in again is the same person ──────────────────────────────
  console.log('\n=== second sign-in ===');
  r = await fetch(`${base()}/api/auth/google`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code: 'auth-code-2', state: signinState }),
  });
  const again = await r.json();
  assert(again.user && again.user.id === userId, 'the same Google identity maps to the same account');
  assert(users().filter((u) => u.email === GOOGLE_PROFILE.email).length === 1, 'no duplicate account is created');

  // ── 7. the Drive branch stores the tokens ───────────────────────────────
  console.log('\n=== the Drive link stores the tokens ===');
  const driveSigninState = signState(statePayload({ intent: 'drive', mode: 'popup' }), process.env.GOOGLE_CLIENT_SECRET);
  r = await fetch(`${base()}/api/auth/google`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code: 'auth-code-3', state: driveSigninState }),
  });
  const driveBody = await r.json();
  assert(driveBody.ok && driveBody.linkedAt, 'the Drive link reports when it happened');
  const driveUser = await findUserByEmail(GOOGLE_PROFILE.email);
  assert(driveUser && driveUser.googleDrive, 'the Drive tokens are stored on the user');
  assert(
    driveUser && driveUser.googleDrive && driveUser.googleDrive.accessToken === 'access-token-1',
    'the access token is stored',
  );

  // ── 8. bad input ─────────────────────────────────────────────────────────
  console.log('\n=== rejected input ===');
  r = await fetch(`${base()}/api/auth/google`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code: 'auth-code-4', state: `${signinState}tampered` }),
  });
  const tampered = await r.json();
  assert(r.status === 400 && tampered.error === 'invalid_state', 'a tampered state is refused');

  r = await fetch(`${base()}/api/auth/google`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ state: signinState }),
  });
  const noCode = await r.json();
  assert(r.status === 400 && noCode.error === 'missing_code', 'a missing code is refused');

  // ── 9. the callback endpoint ────────────────────────────────────────────
  console.log('\n=== the callback endpoint ===');
  r = await fetch(
    `${base()}/api/auth/google/callback?code=auth-code-5&state=${encodeURIComponent(signinState)}`,
    { redirect: 'manual' },
  );
  const cbLoc = r.headers.get('location') || '';
  assert(r.status === 302, 'the callback redirects (302)');
  assert(cbLoc.startsWith('/engine'), 'the callback returns to the requested path');
  assert(cbLoc.includes('auth=google'), 'the callback marks the sign-in');
  assert(/swrc_session=/.test(r.headers.get('set-cookie') || ''), 'the callback sets the session cookie');

  r = await fetch(`${base()}/api/auth/google/callback?error=access_denied&state=${encodeURIComponent(signinState)}`, {
    redirect: 'manual',
  });
  const denied = r.headers.get('location') || '';
  assert(denied.startsWith('/auth/login?error=access_denied'), 'a denied consent comes back to the login page');

  r = await fetch(`${base()}/api/auth/google/callback?code=auth-code-6&state=tampered`, { redirect: 'manual' });
  const badState = r.headers.get('location') || '';
  assert(badState.includes('error=invalid_state'), 'a forged callback state is refused');

  // ── 10. the popup branch answers the opener ─────────────────────────────
  console.log('\n=== the popup branch ===');
  const popupState = signState(statePayload({ intent: 'drive', mode: 'popup' }), process.env.GOOGLE_CLIENT_SECRET);
  r = await fetch(`${base()}/api/auth/google/callback?code=auth-code-7&state=${encodeURIComponent(popupState)}`, {
    redirect: 'manual',
  });
  const popupBody = await r.text();
  assert(r.status === 200, 'the popup branch answers with a page');
  assert(popupBody.includes('swr-google-oauth-callback'), 'the popup page posts the message the opener listens for');

  assert(tokenCalls > 0 && userinfoCalls > 0, 'Google was actually called');

  server.close();
  globalThis.fetch = realFetch;
  fs.rmSync(DATA_DIR, { recursive: true, force: true });
  console.log('\n' + (failures === 0
    ? 'GOOGLE SIGN-IN UNIT: ALL GREEN'
    : `GOOGLE SIGN-IN UNIT: ${failures} failure(s)`));
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  server.close();
  globalThis.fetch = realFetch;
  try { fs.rmSync(DATA_DIR, { recursive: true, force: true }); } catch (_) {}
  process.exit(2);
});
