#!/usr/bin/env node
'use strict';
// scripts/upload-youtube.mjs
//
// Upload a video to YouTube Studio by driving a real Chrome over CDP.
//
// WHY BROWSER AUTOMATION AND NOT THE DATA API: the API needs a Google Cloud
// project + OAuth client secret + one consent flow before it can write, and
// nothing on this machine has those. Chrome already has a signed-in Google
// session pattern we know works (see lib/mj-web.js in digital_twin), so this
// reuses it: headed Chrome, dedicated profile, CDP over the built-in
// WebSocket (Node >= 22 — no npm deps, matching the repo's "no extra deps").
//
// Usage:
//   node scripts/upload-youtube.mjs --preflight
//   node scripts/upload-youtube.mjs --file out/clip.mp4 \
//        --title "..." --description "..." --visibility unlisted|private|public
//
// The profile lives OUTSIDE the repo, under Application Support. It was first
// placed at .yt-profile/ and gitignored, but scripts/check-syntax.mjs walks the
// tree and died with ENOENT on Chrome's transient RunningChromeVersion file —
// a live browser profile simply does not belong in a source tree. First run:
// sign in to Google in the window that opens, then re-run --preflight.

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PROFILE = process.env.YT_PROFILE
  || path.join(os.homedir(), 'Library', 'Application Support', 'swr-yt-profile');
const PORT = 9333;
const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/Applications/Comet.app/Contents/MacOS/Comet',
].filter(Boolean);

const log = (...a) => console.log('[yt]', ...a);

// --- arg parsing -----------------------------------------------------------
const argv = process.argv.slice(2);
const has = (f) => argv.includes(f);
const arg = (f, d = null) => {
  const i = argv.indexOf(f);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : d;
};

const OPTS = {
  preflight: has('--preflight'),
  file: arg('--file'),
  title: arg('--title', 'Untitled'),
  description: arg('--description', ''),
  visibility: arg('--visibility', 'unlisted'),
};

// --- CDP client ------------------------------------------------------------
class CDP {
  constructor(wsUrl) {
    this.wsUrl = wsUrl;
    this.id = 0;
    this.pending = new Map();
  }
  async connect() {
    this.ws = new WebSocket(this.wsUrl);
    await new Promise((res, rej) => {
      this.ws.addEventListener('open', res, { once: true });
      this.ws.addEventListener('error', rej, { once: true });
    });
    this.ws.addEventListener('message', (ev) => {
      let m;
      try { m = JSON.parse(ev.data); } catch { return; }
      const p = m.id && this.pending.get(m.id);
      if (!p) return;
      this.pending.delete(m.id);
      m.error ? p.reject(new Error(`${m.error.message} (${JSON.stringify(m.error.data ?? '')})`))
              : p.resolve(m.result);
    });
    return this;
  }
  send(method, params = {}) {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }
  async eval(expression, awaitPromise = false) {
    const r = await this.send('Runtime.evaluate', {
      expression, returnByValue: true, awaitPromise,
    });
    if (r.exceptionDetails) {
      throw new Error(`eval failed: ${r.exceptionDetails.exception?.description ?? r.exceptionDetails.text}`);
    }
    return r.result?.value;
  }
  close() { try { this.ws.close(); } catch {} }
}

// --- chrome lifecycle ------------------------------------------------------
let chrome = null;

function findChrome() {
  for (const c of CHROME_CANDIDATES) if (fs.existsSync(c)) return c;
  throw new Error(`No Chrome found. Tried:\n  ${CHROME_CANDIDATES.join('\n  ')}`);
}

async function waitFor(fn, { timeout = 30000, every = 500, label = 'condition' } = {}) {
  const t0 = Date.now();
  for (;;) {
    try {
      const v = await fn();
      if (v) return v;
    } catch { /* keep polling */ }
    if (Date.now() - t0 > timeout) throw new Error(`timeout waiting for ${label}`);
    await new Promise((r) => setTimeout(r, every));
  }
}

async function launchChrome() {
  const bin = findChrome();
  fs.mkdirSync(PROFILE, { recursive: true });
  log('launching headed Chrome', { bin, profile: PROFILE, port: PORT });
  chrome = spawn(bin, [
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${PROFILE}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--start-maximized',
    'about:blank',
  ], { stdio: 'ignore', detached: false });
  chrome.on('error', (e) => log('chrome error', e.message));
  return chrome;
}

async function newPage() {
  const list = await waitFor(async () => {
    const r = await fetch(`http://127.0.0.1:${PORT}/json/list`).then((r) => r.json());
    return r.length ? r : null;
  }, { label: 'chrome devtools endpoint' });

  const target = list.find((t) => t.type === 'page') ?? list[0];
  const cdp = await new CDP(target.webSocketDebuggerUrl).connect();
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  await cdp.send('DOM.enable');
  return cdp;
}

async function goto(cdp, url) {
  log('navigate', url);
  await cdp.send('Page.navigate', { url });
  await waitFor(async () => {
    const state = await cdp.eval('document.readyState');
    return state === 'complete';
  }, { timeout: 60000, label: `load ${url}` });
}

// --- flow ------------------------------------------------------------------
async function signedIn(cdp) {
  const r = await cdp.eval(`(() => {
    const t = document.title || '';
    const u = location.href;
    // Studio's account chip, not any avatar-ish node: the Google sign-in page
    // carries its own img elements that a loose selector happily matches.
    const acct = document.querySelector('#avatar, yt-avatar-shape[aria-label], [aria-label^="Account"]');
    return JSON.stringify({ title: t, url: u, hasAccountChip: !!acct });
  })()`);
  return JSON.parse(r);
}

async function main() {
  await launchChrome();
  const cdp = await newPage();
  await goto(cdp, 'https://studio.youtube.com/');

  const s = await signedIn(cdp);
  log('studio:', s);

  const onSignIn = /accounts\.google\.com|ServiceLogin/i.test(s.url);
  const authed = !onSignIn && s.hasAccountChip;

  if (OPTS.preflight) {
    log(authed ? 'PREFLIGHT OK — signed in' : 'PREFLIGHT FAIL — sign in to Google in the open window, then re-run');
    cdp.close();
    process.exit(authed ? 0 : 2);
  }

  if (!authed) {
    // Without this guard the flow used to click around on Google's sign-in
    // page for 30s and then die with a misleading "Upload videos" timeout.
    log('NOT SIGNED IN — Chrome is open on the Google sign-in page.');
    log('Sign in there, then re-run this exact command.');
    cdp.close();
    process.exit(2);
  }

  if (!OPTS.file) throw new Error('--file <video> is required');
  const file = path.resolve(OPTS.file);
  if (!fs.existsSync(file)) throw new Error(`no such file: ${file}`);
  log('uploading', file, `(${(fs.statSync(file).size / 1e6).toFixed(1)} MB)`);

  // Create -> Upload videos
  log('open Create menu');
  await waitFor(async () => cdp.eval(
    `!![...document.querySelectorAll('button,[role="button"]')]
        .find(b => /create/i.test(b.getAttribute('aria-label') || b.textContent))`
  ), { label: 'Create button' });
  await cdp.eval(`[...document.querySelectorAll('button,[role="button"]')]
      .find(b => /create/i.test(b.getAttribute('aria-label') || b.textContent)).click()`);

  await waitFor(async () => cdp.eval(
    `!![...document.querySelectorAll('[role="menuitem"],a,button')]
        .find(e => /upload videos/i.test(e.textContent))`
  ), { label: 'Upload videos item' });
  await cdp.eval(`[...document.querySelectorAll('[role="menuitem"],a,button')]
      .find(e => /upload videos/i.test(e.textContent)).click()`);

  // Attach the file through the real <input type=file>, not a synthetic drop.
  log('attach file to <input type=file>');
  await waitFor(async () => cdp.eval(`!!document.querySelector('input[type="file"]')`),
    { label: 'file input' });
  const { root } = await cdp.send('DOM.getDocument', { depth: -1 });
  const { nodeId } = await cdp.send('DOM.querySelector', {
    nodeId: root.nodeId, selector: 'input[type="file"]',
  });
  if (!nodeId) throw new Error('file input found in JS but DOM.querySelector returned no node');
  await cdp.send('DOM.setFileInputFiles', { files: [file], nodeId });

  log('waiting for the details pane');
  await waitFor(async () => cdp.eval(`!!document.querySelector('#title, input[name="title"], ytcp-title-editor')`),
    { timeout: 180000, label: 'title field' });

  await cdp.eval(`(() => {
    const el = document.querySelector('#title') || document.querySelector('input[name="title"]');
    el.focus();
    const setter = Object.getOwnPropertyDescriptor(el.constructor.prototype, 'value').set;
    setter.call(el, ${JSON.stringify(OPTS.title)});
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    return el.value;
  })()`);
  log('title set');

  if (OPTS.description) {
    await cdp.eval(`(() => {
      const el = document.querySelector('#description, textarea[name="description"]');
      if (!el) return 'no description field';
      el.focus();
      const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLDivElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(proto, 'textContent').set;
      setter.call(el, ${JSON.stringify(OPTS.description)});
      el.dispatchEvent(new Event('input', { bubbles: true }));
      return 'ok';
    })()`);
    log('description set');
  }

  await cdp.send('Page.captureScreenshot', { format: 'png' })
    .then((r) => fs.writeFileSync(path.join(ROOT, 'out', 'yt-details.png'), Buffer.from(r.data, 'base64')))
    .catch(() => {});
  log('screenshot -> out/yt-details.png');
  log('STOPPING before visibility/Publish. Open Chrome and confirm the details look right.');
  cdp.close();
}

main().catch((e) => {
  log('ERROR:', e.message);
  console.error(e);
  cdp_closeAll();
  process.exit(1);
});

function cdp_closeAll() { /* chrome stays open for inspection */ }
