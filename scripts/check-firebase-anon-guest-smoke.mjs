// scripts/check-firebase-anon-guest-smoke.mjs
// Puppeteer smoke test for the "Continue as guest" sign-in. It drives the
// REAL user path on the built dist/ login page:
//
//   1. The guest button ships HIDDEN, so a deployment with no Firebase
//      web config never shows a dead button
//   2. With the server serving a config (GET /api/auth/firebase-anon
//      ?action=config → 200), the button is REVEALED
//   3. With the server refusing (503 firebase_not_configured), the button
//      stays hidden
//   4. Clicking it signs in with the Firebase Web SDK and POSTs the ID
//      token to /api/auth/firebase-anon
//   5. A successful exchange redirects to the return path
//   6. A refused exchange (401 invalid_id_token) leaves the visitor on the
//      page with a message and a RE-ENABLED button — never a dead end
//
// The Firebase Web SDK is stubbed in the BROWSER: the page's two dynamic
// imports of www.gstatic.com are intercepted and served a tiny module
// that exports initializeApp / getAuth / signInAnonymously /
// onAuthStateChanged. The page's own code (lib/firebase-anon.client.js,
// auth/login.client.js) is the shipped code, unmodified.
//
// Self-contained: ensureDist() (from scripts/with-dist.mjs) auto-builds
// dist/ if missing.
//
// Run command:
//   node scripts/check-firebase-anon-guest-smoke.mjs
//
// Pass criteria: every assertion green, exit 0.

import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import puppeteer from 'puppeteer';
import { ensureDist } from './with-dist.mjs';

ensureDist();

const distDir = path.resolve(dirname(fileURLToPath(import.meta.url)), '../dist');

// ---- the fake API ---------------------------------------------------------
// The gate controls what the API answers, so both the "configured" and the
// "not configured" deployment can be exercised against the same build.
const api = {
  configStatus: 200,
  config: { apiKey: 'smoke-api-key', authDomain: 'smoke.firebaseapp.com', projectId: 'smoke-project' },
  exchangeStatus: 200,
  exchangeBody: null,
  exchanges: [],
  signedIn: 0,
};

function sendJson(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(body));
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1');
  const p = url.pathname;

  if (p === '/__smoke/signed-in' && req.method === 'POST') {
    api.signedIn++;
    res.statusCode = 204;
    return res.end();
  }

  if (p === '/api/auth/firebase-anon' && req.method === 'GET') {
    if (api.configStatus !== 200) {
      return sendJson(res, api.configStatus, { error: 'firebase_not_configured' });
    }
    return sendJson(res, 200, { ok: true, config: api.config });
  }

  if (p === '/api/auth/firebase-anon' && req.method === 'POST') {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      let body = null;
      try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch (_) { body = null; }
      api.exchanges.push(body);
      if (api.exchangeStatus !== 200) {
        return sendJson(res, api.exchangeStatus, { error: 'invalid_id_token' });
      }
      res.setHeader('Set-Cookie', 'swrc_session=smoke-token; Path=/; HttpOnly; SameSite=Lax');
      return sendJson(res, 200, {
        ok: true,
        user: { id: 'smoke-user-id', name: 'Guest', email: 'anon-smoke@guest.swr.local', anonymous: true },
      });
    });
    return;
  }

  // Static files from dist/.
  let file = path.join(distDir, p);
  if (!file.startsWith(distDir)) { res.statusCode = 403; res.end(); return; }
  fs.readFile(file, (err, data) => {
    if (err) {
      if (!path.extname(file)) {
        return fs.readFile(file + '.html', (err2, data2) => {
          if (err2) { res.statusCode = 404; res.end(); return; }
          res.setHeader('Content-Type', 'text/html');
          res.end(data2);
        });
      }
      res.statusCode = 404; res.end(); return;
    }
    const ext = path.extname(file);
    const mime = ext === '.html' ? 'text/html'
      : ext === '.js' ? 'text/javascript'
      : ext === '.css' ? 'text/css'
      : ext === '.json' ? 'application/json'
      : 'application/octet-stream';
    res.setHeader('Content-Type', mime);
    res.end(data);
  });
});
server.on('error', (err) => {
  console.error('FIREBASE ANON GUEST SMOKE: the server failed — ' + (err && err.code ? err.code : err));
  process.exit(1);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const PORT = server.address().port;

// ---- the browser ----------------------------------------------------------
const browser = await puppeteer.launch({
  args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
});

const results = [];
function ok(name) { results.push('  ✓ ' + name); }
function bad(name, got) {
  results.push('  ✗ ' + name + (got !== undefined ? ' — got: ' + got : ''));
  process.exitCode = 1;
}

// The Firebase Web SDK, stubbed. The page imports it by absolute URL, so
// the two module URLs are intercepted and answered with this module.
const SDK_APP_MODULE = `
export function initializeApp(config) {
  window.__SWR_SMOKE_SDK_CONFIG = config;
  return { name: 'smoke', options: config };
}
`;
const SDK_AUTH_MODULE = `
export function getAuth(app) {
  return {
    app,
    currentUser: {
      getIdToken: async (force) => 'smoke-id-token-' + (force ? 'forced' : 'plain'),
    },
  };
}
export async function signInAnonymously(auth) {
  // The sign-in happens on the login page and the page then navigates
  // away, so the signal is reported to the server rather than left in a
  // window global that navigation would destroy.
  try {
    await fetch('/__smoke/signed-in', { method: 'POST', keepalive: true });
  } catch (_) {}
  return { user: auth.currentUser };
}
export function onAuthStateChanged(auth, cb) {
  cb(auth.currentUser);
  return () => {};
}
`;

async function newPage() {
  const page = await browser.newPage();
  await page.setRequestInterception(true);
  page.on('request', (req) => {
    const url = req.url();
    // A module script loaded cross-origin needs CORS, exactly as the real
    // CDN sends it — without the header the browser refuses the import.
    const cors = { 'Access-Control-Allow-Origin': '*' };
    if (url.includes('/firebasejs/12.4.0/firebase-app.js')) {
      return req.respond({ status: 200, contentType: 'text/javascript', headers: cors, body: SDK_APP_MODULE }).catch(() => {});
    }
    if (url.includes('/firebasejs/12.4.0/firebase-auth.js')) {
      return req.respond({ status: 200, contentType: 'text/javascript', headers: cors, body: SDK_AUTH_MODULE }).catch(() => {});
    }
    if (/sw\.js(\?|$)/.test(url)) return req.abort().catch(() => {});
    return req.continue().catch(() => {});
  });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.__errors = errors;
  return page;
}

async function nav(page, pathname) {
  // networkidle0 never settles when the login page keeps long-lived fetches
  // or service-worker registration attempts alive; domcontentloaded + complete
  // is enough for the guest-button flow this gate exercises.
  await page.goto('http://127.0.0.1:' + PORT + pathname, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForFunction(() => document.readyState === 'complete', { timeout: 30000 }).catch(() => {});
}

// ---- 1 & 2: the button is revealed only when the server has a config ------
{
  const page = await newPage();
  await nav(page, '/auth/login.html?next=/engine');

  // The button must ship hidden — the HTML SOURCE is what the visitor
  // gets before any script runs, so the source is asserted, not the DOM
  // after the client had a chance to reveal it.
  const source = await (await fetch('http://127.0.0.1:' + PORT + '/auth/login.html')).text();
  const sourceHidden = /id="guest-btn"[^>]*\shidden/.test(source) || /hidden[^>]*id="guest-btn"/.test(source);
  if (sourceHidden) ok('the guest button ships hidden in the HTML');
  else bad('the guest button ships hidden in the HTML', String(sourceHidden));

  // The client asks the server for the config, so the button appears only
  // after that answer comes back.
  await page.waitForFunction(
    () => { const b = document.getElementById('guest-btn'); return b && !b.hasAttribute('hidden'); },
    { timeout: 10000 }
  ).catch(() => {});
  const revealed = await page.evaluate(() => {
    const b = document.getElementById('guest-btn');
    return !!b && !b.hasAttribute('hidden') && b.offsetParent !== null;
  });
  if (revealed) ok('the guest button is revealed when the server serves a config');
  else bad('the guest button is revealed when the server serves a config', String(revealed));

  await page.close();
}

// ---- 3: a deployment with no config keeps the button hidden ---------------
{
  api.configStatus = 503;
  const page = await newPage();
  await nav(page, '/auth/login.html');
  await new Promise((r) => setTimeout(r, 800));
  const stillHidden = await page.evaluate(() => {
    const b = document.getElementById('guest-btn');
    return !!b && b.hasAttribute('hidden');
  });
  if (stillHidden) ok('with no config the guest button stays hidden');
  else bad('with no config the guest button stays hidden', String(stillHidden));
  api.configStatus = 200;
  await page.close();
}

// ---- 4 & 5: the successful path -------------------------------------------
{
  api.exchangeStatus = 200;
  api.exchanges = [];
  api.signedIn = 0;
  const page = await newPage();
  await nav(page, '/auth/login.html?next=/engine');
  await page.waitForFunction(
    () => { const b = document.getElementById('guest-btn'); return b && !b.hasAttribute('hidden'); },
    { timeout: 10000 }
  ).catch(() => {});

  await page.click('#guest-btn');
  await page.waitForNavigation({ timeout: 15000 }).catch(() => {});

  const signedIn = api.signedIn;
  if (signedIn === 1) ok('clicking the button signs in with the Firebase SDK');
  else bad('clicking the button signs in with the Firebase SDK', String(signedIn));

  if (api.exchanges.length === 1) ok('the client POSTs exactly one exchange to /api/auth/firebase-anon');
  else bad('the client POSTs exactly one exchange to /api/auth/firebase-anon', String(api.exchanges.length));

  const sent = api.exchanges[0];
  if (sent && typeof sent.idToken === 'string' && sent.idToken.includes('forced')) {
    ok('the exchange carries a FORCED (fresh) ID token');
  } else {
    bad('the exchange carries a FORCED (fresh) ID token', JSON.stringify(sent));
  }

  const landed = await page.evaluate(() => location.pathname);
  if (landed === '/engine') ok('a successful exchange lands on the return path (/engine)');
  else bad('a successful exchange lands on the return path (/engine)', landed);

  await page.close();
}

// ---- 6: a refused exchange leaves the visitor with a way forward ----------
{
  api.exchangeStatus = 401;
  api.exchanges = [];
  const page = await newPage();
  await nav(page, '/auth/login.html?next=/engine');
  await page.waitForFunction(
    () => { const b = document.getElementById('guest-btn'); return b && !b.hasAttribute('hidden'); },
    { timeout: 10000 }
  ).catch(() => {});

  await page.click('#guest-btn');
  await new Promise((r) => setTimeout(r, 1500));

  const state = await page.evaluate(() => {
    const b = document.getElementById('guest-btn');
    const err = document.getElementById('err');
    return {
      stillOnLogin: location.pathname === '/auth/login.html',
      disabled: b ? b.disabled : null,
      message: err ? err.textContent.trim() : '',
    };
  });
  if (state.stillOnLogin) ok('a refused exchange leaves the visitor on the login page');
  else bad('a refused exchange leaves the visitor on the login page', String(state.stillOnLogin));
  if (state.disabled === false) ok('a refused exchange re-enables the guest button');
  else bad('a refused exchange re-enables the guest button', String(state.disabled));
  if (state.message) ok('a refused exchange shows a message (' + state.message + ')');
  else bad('a refused exchange shows a message', '(empty)');

  api.exchangeStatus = 200;
  await page.close();
}

await browser.close();
server.close();

console.log('');
console.log(results.join('\n'));
console.log('');
if (process.exitCode) {
  console.log('FIREBASE ANON GUEST SMOKE: FAILURES ABOVE');
} else {
  console.log('FIREBASE ANON GUEST SMOKE: OK (' + results.length + '/' + results.length + ' checks passed)');
}
process.exit(process.exitCode || 0);
