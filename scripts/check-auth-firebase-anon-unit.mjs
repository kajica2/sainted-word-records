#!/usr/bin/env node
// scripts/check-auth-firebase-anon-unit.mjs — Firebase anonymous sign-in gate.
//
// api/auth/firebase-anon.js is the guest-sign-in exchange: it publishes the
// public Firebase web config and swaps a Firebase Anonymous ID token for a
// SWR session cookie.
//
// The gate drives the REAL handler over a REAL local HTTP server (a node:http
// server that dispatches /api/auth/firebase-anon to the imported handler) and
// talks to it with fetch, so the status codes, the Set-Cookie header and the
// body parsing are the shipped ones.
//
// Firebase cannot be reached from here (no network, no live project, no JVM
// for the Firestore emulator), so the Firebase Auth emulator is simulated by
// a small node:http stub that answers accounts:lookup. firebase-admin really
// runs, really decodes the token and really calls the stub.
//
// api/_lib/firebase-admin.js caches the Admin app (and any init error) in
// module scope, so ONE process can hold only ONE Firebase configuration.
// Each configuration is therefore exercised in its OWN child process: this
// file re-executes itself with SWR_ANON_GATE_CHILD=<scenario>, and the parent
// collects the child's numbered results. A child that dies is reported as a
// failed assertion, never as a crashed suite.
//
// Assertions (behaviour a user could observe break):
//   1. GET ?action=config with no web config → 503 firebase_not_configured
//   2. GET ?action=config with an API key but no project id → 503
//   3. GET ?action=config returns the configured web config
//   4. GET ?action=config falls back to FIREBASE_PROJECT_ID
//   5. GET ?action=config re-reads the env on every call
//   6. GET without action → 405 method_not_allowed
//   7. GET ?action=<other> → 405 method_not_allowed
//   8. PUT → 405 method_not_allowed
//   9. POST without a body → 400 missing_id_token
//  10. POST with an empty idToken → 400 missing_id_token
//  11. POST with a whitespace-only idToken → 400 missing_id_token
//  12. POST on a server with no Firebase project → 503 firebase_not_configured
//  13. that 503 sets no session cookie
//  14. POST with an unparseable service account (emulator off)
//      → 503 invalid_service_account
//  15. POST with a valid anonymous token → 200 { ok, user: { anonymous } }
//  16. the guest email is derived from a hash of the Firebase uid
//  17. a successful exchange sets an HttpOnly swrc_session cookie
//  18. the cookie value is the session token and resolves to the user
//  19. the cookie resolves to the same user through getCurrentUser
//  20. a second exchange with the same uid returns the SAME user, once
//  21. the guest user is linked as provider firebase-anon for that uid
//  22. the guest email is stable across exchanges of the same uid
//  23. a different uid yields a different user and a different email
//  24. a token the Admin SDK refuses → 401 invalid_id_token
//  25. a valid non-anonymous token → 400 not_anonymous
//  26. the unmutated source is still GREEN after the mutation self-tests
//
// The gate proves it can still fail: the shipped api/ tree is copied to a
// temp dir, the COPY is mutated (the not_anonymous check removed, the guest
// email made non-deterministic, the provider link skipped), and the SAME
// assertions are re-run against the mutant — the named assertions must go
// RED. The repo tree is never written to.
//
// Run:  node scripts/check-auth-firebase-anon-unit.mjs
// Exit: 0 PASS, 1 FAIL.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const SELF = fileURLToPath(import.meta.url);
const ROOT = path.dirname(path.dirname(SELF));
const API_DIR = path.join(ROOT, 'api');
const ROUTE_REL = path.join('auth', 'firebase-anon.js');

// ── the assertion registry ────────────────────────────────────────────────
// One number per assertion, shared by the parent and the children so a
// mutation can name exactly which assertions it turns RED.
const ASSERTIONS = {
  1: 'GET ?action=config without a web config → 503 firebase_not_configured',
  2: 'GET ?action=config with an API key but no project id → 503 firebase_not_configured',
  3: 'GET ?action=config returns the configured web config',
  4: 'GET ?action=config falls back to FIREBASE_PROJECT_ID',
  5: 'GET ?action=config re-reads the env on every call',
  6: 'GET without action → 405 method_not_allowed',
  7: 'GET ?action=<other> → 405 method_not_allowed',
  8: 'PUT → 405 method_not_allowed',
  9: 'POST without a body → 400 missing_id_token',
  10: 'POST with an empty idToken → 400 missing_id_token',
  11: 'POST with a whitespace-only idToken → 400 missing_id_token',
  12: 'POST on a server with no Firebase project → 503 firebase_not_configured',
  13: 'the firebase_not_configured response sets no session cookie',
  14: 'POST with an unparseable service account (emulator off) → 503 invalid_service_account',
  15: 'POST with a valid anonymous token → 200 { ok, user: { anonymous: true } }',
  16: 'the guest email is derived from a hash of the Firebase uid',
  17: 'a successful exchange sets an HttpOnly swrc_session cookie',
  18: 'the cookie value is the session token and its session resolves to the user',
  19: 'the cookie resolves to the same user through getCurrentUser',
  20: 'a second exchange with the same uid returns the SAME user and creates no second user',
  21: 'the guest user is linked as provider firebase-anon for that uid',
  22: 'the guest email is stable across exchanges of the same uid',
  23: 'a different uid yields a different user and a different guest email',
  24: 'a token the Admin SDK refuses → 401 invalid_id_token',
  25: 'a valid token whose provider is not anonymous → 400 not_anonymous',
  26: 'the unmutated source is still GREEN after the mutation self-tests',
};

// Which scenario owns which assertion numbers.
const SCENARIOS = {
  config: [1, 2, 3, 4, 5],
  methods: [6, 7, 8, 9, 10, 11],
  'not-configured': [12, 13],
  'bad-service-account': [14],
  emulator: [15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25],
};

// ── child mode ────────────────────────────────────────────────────────────
// The parent re-executes this file with SWR_ANON_GATE_CHILD set; the child
// runs ONE scenario (one Firebase configuration) and prints its numbered
// results as one JSON line. The dispatch lives at the END of the file, so
// every constant is initialised before it runs.

// ══════════════════════════════════════════════════════════════════════════
// the child: one scenario, one Firebase configuration
// ══════════════════════════════════════════════════════════════════════════

async function runChild(scenario) {
  const results = [];
  const check = (n, ok, detail) => {
    results.push({ n, ok: !!ok, detail: detail == null ? '' : String(detail) });
  };

  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'swr-anon-data-'));
  process.env.SWRC_DATA_DIR = dataDir;
  delete process.env.SWR_AUTH_STORE;
  delete process.env.DATABASE_URL;

  const routePath = process.env.SWR_ANON_GATE_ROUTE
    ? path.resolve(process.env.SWR_ANON_GATE_ROUTE)
    : path.join(API_DIR, ROUTE_REL);
  const libDir = path.join(path.dirname(path.dirname(routePath)), '_lib');

  let server = null;
  try {
    const { default: handler } = await import(pathToFileURL(routePath).href);
    server = await startRouteServer(handler);
    const base = `http://127.0.0.1:${server.port}`;

    if (scenario === 'config') await scenarioConfig(base, check);
    else if (scenario === 'methods') await scenarioMethods(base, check);
    else if (scenario === 'not-configured') await scenarioNotConfigured(base, check);
    else if (scenario === 'bad-service-account') await scenarioBadServiceAccount(base, check);
    else if (scenario === 'emulator') await scenarioEmulator(base, check, libDir, dataDir);
    else throw new Error(`unknown scenario: ${scenario}`);

    server.close();
  } catch (e) {
    // A crashed scenario is reported as a failed assertion, never as a
    // crashed suite.
    for (const n of SCENARIOS[scenario] || []) {
      results.push({ n, ok: false, detail: `scenario crashed: ${e && e.message}` });
    }
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true });
  }

  process.stdout.write(`###RESULT###${JSON.stringify(results)}\n`);
  process.exit(0);
}

// ── scenario: the public web config ───────────────────────────────────────
// getFirebaseWebConfig() reads the env on every call, so the config
// scenarios must not depend on the Auth emulator being on: this scenario
// runs with NO Firebase env at all.
async function scenarioConfig(base, check) {
  delete process.env.FIREBASE_WEB_API_KEY;
  delete process.env.FIREBASE_WEB_PROJECT_ID;
  delete process.env.FIREBASE_PROJECT_ID;

  let r = await req(base, '/api/auth/firebase-anon?action=config');
  check(1, r.status === 503 && r.json && r.json.error === 'firebase_not_configured',
    `status=${r.status} body=${JSON.stringify(r.json)}`);

  process.env.FIREBASE_WEB_API_KEY = 'web-key';
  r = await req(base, '/api/auth/firebase-anon?action=config');
  check(2, r.status === 503 && r.json && r.json.error === 'firebase_not_configured',
    `status=${r.status} body=${JSON.stringify(r.json)}`);

  process.env.FIREBASE_WEB_PROJECT_ID = 'web-proj';
  r = await req(base, '/api/auth/firebase-anon?action=config');
  const cfg = (r.json && r.json.config) || {};
  check(3, r.status === 200 && r.json && r.json.ok === true &&
    cfg.apiKey === 'web-key' && cfg.projectId === 'web-proj' &&
    cfg.authDomain === 'web-proj.firebaseapp.com',
    `status=${r.status} config=${JSON.stringify(cfg)}`);

  delete process.env.FIREBASE_WEB_PROJECT_ID;
  process.env.FIREBASE_PROJECT_ID = 'fallback-proj';
  r = await req(base, '/api/auth/firebase-anon?action=config');
  const cfg2 = (r.json && r.json.config) || {};
  check(4, r.status === 200 && cfg2.projectId === 'fallback-proj' &&
    cfg2.authDomain === 'fallback-proj.firebaseapp.com',
    `status=${r.status} config=${JSON.stringify(cfg2)}`);

  delete process.env.FIREBASE_WEB_API_KEY;
  r = await req(base, '/api/auth/firebase-anon?action=config');
  check(5, r.status === 503 && r.json && r.json.error === 'firebase_not_configured',
    `status=${r.status} body=${JSON.stringify(r.json)}`);
}

// ── scenario: methods and the missing token ───────────────────────────────
async function scenarioMethods(base, check) {
  let r = await req(base, '/api/auth/firebase-anon');
  check(6, r.status === 405 && r.json && r.json.error === 'method_not_allowed',
    `status=${r.status} body=${JSON.stringify(r.json)}`);

  r = await req(base, '/api/auth/firebase-anon?action=nope');
  check(7, r.status === 405 && r.json && r.json.error === 'method_not_allowed',
    `status=${r.status} body=${JSON.stringify(r.json)}`);

  r = await req(base, '/api/auth/firebase-anon', { method: 'PUT' });
  check(8, r.status === 405 && r.json && r.json.error === 'method_not_allowed',
    `status=${r.status} body=${JSON.stringify(r.json)}`);

  r = await req(base, '/api/auth/firebase-anon', { method: 'POST' });
  check(9, r.status === 400 && r.json && r.json.error === 'missing_id_token',
    `status=${r.status} body=${JSON.stringify(r.json)}`);

  r = await req(base, '/api/auth/firebase-anon', { method: 'POST', body: { idToken: '' } });
  check(10, r.status === 400 && r.json && r.json.error === 'missing_id_token',
    `status=${r.status} body=${JSON.stringify(r.json)}`);

  r = await req(base, '/api/auth/firebase-anon', { method: 'POST', body: { idToken: '   ' } });
  check(11, r.status === 400 && r.json && r.json.error === 'missing_id_token',
    `status=${r.status} body=${JSON.stringify(r.json)}`);
}

// ── scenario: the server has no Firebase project ──────────────────────────
// No FIREBASE_PROJECT_ID, no emulator host, no credentials: firebase-admin
// is not configured at all, so the exchange is a server fault (503), not a
// bad token (401).
async function scenarioNotConfigured(base, check) {
  delete process.env.FIREBASE_PROJECT_ID;
  delete process.env.FIREBASE_AUTH_EMULATOR_HOST;
  delete process.env.FIRESTORE_EMULATOR_HOST;
  delete process.env.FIREBASE_SERVICE_ACCOUNT;
  delete process.env.GOOGLE_APPLICATION_CREDENTIALS;

  const r = await req(base, '/api/auth/firebase-anon', {
    method: 'POST',
    body: { idToken: 'some-token' },
  });
  check(12, r.status === 503 && r.json && r.json.error === 'firebase_not_configured',
    `status=${r.status} body=${JSON.stringify(r.json)}`);
  check(13, r.setCookie.length === 0, `set-cookie=${JSON.stringify(r.setCookie)}`);
}

// ── scenario: the service account is unparseable ──────────────────────────
// The emulator is OFF, so firebase-admin parses FIREBASE_SERVICE_ACCOUNT —
// and the unparseable JSON must surface as 503 invalid_service_account, not
// as a 401 blaming the visitor's token.
async function scenarioBadServiceAccount(base, check) {
  process.env.FIREBASE_PROJECT_ID = 'swr-test';
  delete process.env.FIREBASE_AUTH_EMULATOR_HOST;
  delete process.env.FIRESTORE_EMULATOR_HOST;
  process.env.FIREBASE_SERVICE_ACCOUNT = '{not json';

  const r = await req(base, '/api/auth/firebase-anon', {
    method: 'POST',
    body: { idToken: 'some-token' },
  });
  check(14, r.status === 503 && r.json && r.json.error === 'invalid_service_account',
    `status=${r.status} body=${JSON.stringify(r.json)}`);
}

// ── scenario: the Auth emulator ───────────────────────────────────────────
// The stub answers accounts:lookup, so the REAL firebase-admin path
// verifies an unsigned token and returns the decoded claims.
async function scenarioEmulator(base, check, libDir, dataDir) {
  const stub = await startAuthStub();
  process.env.FIREBASE_AUTH_EMULATOR_HOST = `127.0.0.1:${stub.port}`;
  process.env.FIREBASE_PROJECT_ID = 'swr-test';
  delete process.env.FIREBASE_SERVICE_ACCOUNT;
  delete process.env.GOOGLE_APPLICATION_CREDENTIALS;

  const uid = 'uid-123';
  const otherUid = 'uid-456';
  const token = makeToken(uid, 'anonymous');
  const otherToken = makeToken(otherUid, 'anonymous');
  const passwordToken = makeToken('uid-pass', 'password');

  // 15. the happy path
  let r = await req(base, '/api/auth/firebase-anon', { method: 'POST', body: { idToken: token } });
  const user = (r.json && r.json.user) || {};
  check(15, r.status === 200 && r.json && r.json.ok === true &&
    user.anonymous === true && user.name === 'Guest' && !!user.id,
    `status=${r.status} body=${JSON.stringify(r.json)}`);

  // 16. the guest email is derived from a HASH of the uid
  const expectedEmail = `anon-${crypto.createHash('sha256').update(uid).digest('hex').slice(0, 24)}@guest.swr.local`;
  check(16, user.email === expectedEmail,
    `email=${user.email} expected=${expectedEmail}`);

  // 17. the session cookie
  const cookieHeader = r.setCookie.find((c) => c.startsWith('swrc_session='));
  const cookieValue = cookieHeader ? cookieHeader.split(';')[0].split('=')[1] : null;
  check(17, !!cookieHeader && /HttpOnly/i.test(cookieHeader) &&
    /Path=\//.test(cookieHeader) && /SameSite=Lax/i.test(cookieHeader) && /Secure/i.test(cookieHeader),
    `set-cookie=${JSON.stringify(r.setCookie)}`);

  // 18. the cookie value is the session token and resolves to the user
  const db = await import(pathToFileURL(path.join(libDir, 'db.js')).href);
  const session = cookieValue ? await db.getSession(cookieValue) : null;
  check(18, !!session && session.userId === user.id && session.token === cookieValue,
    `session=${JSON.stringify(session)} userId=${user.id}`);

  // 19. and it resolves through the shipped session helper
  const sessionLib = await import(pathToFileURL(path.join(libDir, 'session.js')).href);
  const current = await sessionLib.getCurrentUser({ headers: { cookie: `swrc_session=${cookieValue}` } });
  check(19, !!current.user && current.user.id === user.id,
    `current=${current.user ? current.user.id : 'null'}`);

  // 20. the same uid again → the SAME user, and only ONE user in the store
  const second = await req(base, '/api/auth/firebase-anon', { method: 'POST', body: { idToken: token } });
  const secondUser = (second.json && second.json.user) || {};
  const users = readUsers(dataDir);
  check(20, second.status === 200 && secondUser.id === user.id && users.length === 1,
    `second=${secondUser.id} first=${user.id} users=${users.length}`);

  // 21. the provider link
  const linked = await db.findUserByProvider('firebase-anon', uid);
  check(21, !!linked && linked.id === user.id,
    `linked=${linked ? linked.id : 'null'}`);

  // 22. the email is stable
  check(22, secondUser.email === user.email && !!user.email,
    `first=${user.email} second=${secondUser.email}`);

  // 23. a different uid → a different user and a different email
  const third = await req(base, '/api/auth/firebase-anon', { method: 'POST', body: { idToken: otherToken } });
  const thirdUser = (third.json && third.json.user) || {};
  check(23, third.status === 200 && thirdUser.id !== user.id && thirdUser.email !== user.email,
    `third=${thirdUser.id}/${thirdUser.email} first=${user.id}/${user.email}`);

  // 24. a token the Admin SDK refuses
  const bad = await req(base, '/api/auth/firebase-anon', { method: 'POST', body: { idToken: 'not-a-jwt' } });
  check(24, bad.status === 401 && bad.json && bad.json.error === 'invalid_id_token',
    `status=${bad.status} body=${JSON.stringify(bad.json)}`);

  // 25. a valid token that is not anonymous
  const nonAnon = await req(base, '/api/auth/firebase-anon', { method: 'POST', body: { idToken: passwordToken } });
  check(25, nonAnon.status === 400 && nonAnon.json && nonAnon.json.error === 'not_anonymous',
    `status=${nonAnon.status} body=${JSON.stringify(nonAnon.json)}`);

  stub.close();
}

// ── helpers ───────────────────────────────────────────────────────────────

// An unsigned alg:none JWT, exactly what the Auth emulator accepts.
function makeToken(uid, provider) {
  const b64 = (obj) => Buffer.from(JSON.stringify(obj)).toString('base64url');
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    aud: 'swr-test',
    iss: 'https://securetoken.google.com/swr-test',
    sub: uid,
    iat: now,
    exp: now + 3600,
    auth_time: now,
    firebase: { sign_in_provider: provider },
  };
  return `${b64({ alg: 'none', typ: 'JWT' })}.${b64(payload)}.`;
}

// The Firebase Auth emulator, reduced to the one endpoint firebase-admin
// calls while verifying an ID token.
function startAuthStub() {
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      let localIds = [];
      try {
        const parsed = JSON.parse(body || '{}');
        if (Array.isArray(parsed.localId)) localIds = parsed.localId;
      } catch (_) { /* an unparseable lookup is answered with no users */ }
      const users = localIds.map((uid) => ({
        localId: uid,
        email: '',
        emailVerified: false,
        displayName: '',
        disabled: false,
        createdAt: 0,
        lastLoginAt: 0,
        providerUserInfo: [{ providerId: 'anonymous', rawId: uid }],
      }));
      res.statusCode = 200;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ users }));
    });
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      resolve({ port: server.address().port, close: () => server.close() });
    });
  });
}

// A real HTTP server that dispatches the route to the shipped handler.
function startRouteServer(handler) {
  const server = http.createServer((req, res) => {
    const pathname = (req.url || '').split('?')[0];
    if (pathname === '/api/auth/firebase-anon') {
      Promise.resolve(handler(req, res)).catch((e) => {
        if (!res.headersSent) {
          res.statusCode = 500;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ error: 'handler_failed', detail: String(e && e.message) }));
        }
      });
      return;
    }
    res.statusCode = 404;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ error: 'not_found' }));
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      resolve({ port: server.address().port, close: () => server.close() });
    });
  });
}

async function req(base, pathname, { method = 'GET', body } = {}) {
  const init = { method, headers: {} };
  if (body !== undefined) {
    init.headers['content-type'] = 'application/json';
    init.body = JSON.stringify(body);
  }
  const res = await fetch(`${base}${pathname}`, init);
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch (_) { json = null; }
  const setCookie = typeof res.headers.getSetCookie === 'function'
    ? res.headers.getSetCookie()
    : [res.headers.get('set-cookie')].filter(Boolean);
  return { status: res.status, json, text, setCookie };
}

function readUsers(dataDir) {
  try {
    const raw = fs.readFileSync(path.join(dataDir, 'auth', 'users.json'), 'utf8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (_) {
    return [];
  }
}

// ══════════════════════════════════════════════════════════════════════════
// the parent: run every scenario in its own process, then the mutations
// ══════════════════════════════════════════════════════════════════════════

let pass = 0;
const failures = [];
function assert(cond, msg, detail) {
  if (cond) {
    pass++;
    console.log('  ok  ', msg, detail != null && detail !== '' ? `(${detail})` : '');
  } else {
    failures.push(msg);
    console.log('  FAIL', msg, detail != null && detail !== '' ? `(${detail})` : '');
  }
}

const BASE_ENV = {
  PATH: process.env.PATH || '',
  HOME: process.env.HOME || '',
  TMPDIR: process.env.TMPDIR || os.tmpdir(),
  NODE_ENV: 'test',
};

// Run one scenario in a child process and return { n: { ok, detail } }.
function runScenario(scenario, extraEnv = {}) {
  const res = spawnSync(process.execPath, [SELF], {
    cwd: ROOT,
    env: { ...BASE_ENV, ...extraEnv, SWR_ANON_GATE_CHILD: scenario },
    encoding: 'utf8',
    timeout: 60_000,
  });
  const out = res.stdout || '';
  const line = out.split('\n').find((l) => l.startsWith('###RESULT###'));
  const byNumber = {};
  if (!line) {
    const detail = `child exited ${res.status} signal=${res.signal} ` +
      `stderr=${(res.stderr || '').trim().split('\n').slice(-3).join(' | ')}`;
    for (const n of SCENARIOS[scenario] || []) byNumber[n] = { ok: false, detail };
    return byNumber;
  }
  let parsed = [];
  try {
    parsed = JSON.parse(line.slice('###RESULT###'.length));
  } catch (e) {
    for (const n of SCENARIOS[scenario] || []) {
      byNumber[n] = { ok: false, detail: `unparseable child result: ${line.slice(0, 200)}` };
    }
    return byNumber;
  }
  for (const r of parsed) byNumber[r.n] = { ok: r.ok, detail: r.detail };
  return byNumber;
}

async function runParent() {
  console.log('auth firebase-anon unit gate');
  console.log('');

  // ── the shipped source ──────────────────────────────────────────────────
  const scenarioEnv = {
    config: {},
    methods: {},
    'not-configured': {},
    'bad-service-account': {
      FIREBASE_PROJECT_ID: 'swr-test',
      FIREBASE_SERVICE_ACCOUNT: '{not json',
    },
    emulator: { FIREBASE_PROJECT_ID: 'swr-test' },
  };

  const shipped = {};
  for (const scenario of Object.keys(SCENARIOS)) {
    console.log(`  -- scenario: ${scenario}`);
    const results = runScenario(scenario, scenarioEnv[scenario] || {});
    for (const n of SCENARIOS[scenario]) {
      const r = results[n] || { ok: false, detail: 'the scenario reported nothing for this assertion' };
      shipped[n] = r;
      assert(r.ok, `${n}. ${ASSERTIONS[n]}`, r.detail);
    }
  }

  // ── the mutation self-test ──────────────────────────────────────────────
  // The shipped api/ tree is copied to a temp dir (with a node_modules
  // symlink so the copy's own imports resolve), the COPY is mutated, and
  // the SAME assertions are re-run against it.
  console.log('');
  console.log('  -- mutation self-tests');

  const mutants = [
    {
      label: 'not-anonymous-check-removed',
      from: "decoded.firebase.sign_in_provider !== 'anonymous'",
      to: 'false',
      expectRed: [25],
    },
    {
      label: 'guest-email-non-deterministic',
      from: "hashKey(String(uid)).slice(0, 24)",
      to: "hashKey(String(uid) + ':' + Math.random()).slice(0, 24)",
      expectRed: [16],
    },
    {
      label: 'provider-link-skipped',
      from: "  await linkAccount({ userId: user.id, provider: 'firebase-anon', providerAccountId: uid });",
      to: '  /* mutant: the provider link is never written */',
      expectRed: [21],
    },
  ];

  for (const m of mutants) {
    await runMutant(m);
  }

  // ── the unmutated source is still GREEN ─────────────────────────────────
  const after = runScenario('emulator', scenarioEnv.emulator);
  const redAfter = Object.keys(after).filter((n) => !after[n].ok).map(Number);
  assert(redAfter.length === 0,
    `26. ${ASSERTIONS[26]}`,
    redAfter.length ? `red assertions: [${redAfter.join(', ')}]` : 'all emulator assertions green');

  // ── summary ─────────────────────────────────────────────────────────────
  console.log('');
  console.log(`PASS: ${pass}`);
  console.log(`FAIL: ${failures.length}`);
  if (failures.length) {
    console.log('');
    for (const f of failures) console.log(`  - ${f}`);
    process.exit(1);
  }
  process.exit(0);
}

async function runMutant(m) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'swr-anon-mutant-'));
  try {
    fs.cpSync(API_DIR, path.join(tmp, 'api'), { recursive: true });
    // The copy's own imports (firebase-admin, @vercel/blob) must resolve.
    fs.symlinkSync(path.join(ROOT, 'node_modules'), path.join(tmp, 'node_modules'), 'dir');

    const target = path.join(tmp, 'api', ROUTE_REL);
    const original = fs.readFileSync(target, 'utf8');
    if (!original.includes(m.from)) {
      assert(false, `RED PROOF: the ${m.label} mutant turns assertion(s) ${m.expectRed.join(', ')} RED`,
        `the mutation target was not found in the source: ${m.from}`);
      return;
    }
    const mutated = original.replace(m.from, m.to);
    if (mutated === original) {
      assert(false, `RED PROOF: the ${m.label} mutant turns assertion(s) ${m.expectRed.join(', ')} RED`,
        'the mutation did not change the source');
      return;
    }
    fs.writeFileSync(target, mutated);

    const results = runScenario('emulator', {
      FIREBASE_PROJECT_ID: 'swr-test',
      SWR_ANON_GATE_ROUTE: target,
    });
    const red = Object.keys(results).filter((n) => !results[n].ok).map(Number).sort((a, b) => a - b);
    const bit = m.expectRed.every((n) => red.includes(n));
    assert(bit,
      `RED PROOF: the ${m.label} mutant turns assertion(s) ${m.expectRed.join(', ')} RED`,
      red.length ? `red assertions: [${red.join(', ')}]` : 'the mutant stayed green');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

// ── dispatch ──────────────────────────────────────────────────────────────
if (process.env.SWR_ANON_GATE_CHILD) {
  await runChild(process.env.SWR_ANON_GATE_CHILD);
} else {
  await runParent();
}
