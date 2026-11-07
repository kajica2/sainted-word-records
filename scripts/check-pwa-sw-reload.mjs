#!/usr/bin/env node
// scripts/check-pwa-sw-reload.mjs
//
//   npm run check:pwa-sw-reload
//   node scripts/check-pwa-sw-reload.mjs
//
// THE BUG
// -------
// pwa-bootstrap.js registered the service worker and then reloaded the page
// on EVERY controllerchange — including the FIRST one.
//
// sw.js calls clients.claim() on activate, so the first registration takes
// over the client immediately and fires controllerchange once. On a cold
// Chrome profile that happens DURING the page's first load, and the reload
// tore the page down underneath whatever was reading it:
//
//   · check:webgl-default-off lost its first read:
//     "Execution context was destroyed, most likely because of a navigation"
//   · check:live-input lost the camera it had just started
//
// Both are the same root cause: a reload where there was nothing to reload.
//
// THE CONTRACT
// ------------
//   1. The FIRST takeover must NOT reload. The page was fetched from the
//      network with the current assets; there is nothing to refresh.
//   2. An UPDATE must still reload. That is the update toast's flow:
//      SKIP_WAITING -> the waiting worker activates -> controllerchange ->
//      reload, so a deployed change is picked up without a manual refresh.
//
// This gate pins BOTH. It counts page loads in sessionStorage (which
// survives a reload), so a reload is observable rather than inferred.
//
//   1. a cold profile loads the page once, the worker claims it, and the
//      load count stays at 1;
//   2. once the page IS controlled, a controllerchange DOES reload it —
//      the load count goes to 2.
//
// No npm dependencies: headless Chrome over the DevTools Protocol, with
// Node's WebSocket doing the work — the global one where the runtime has
// it (Node 22+), and a minimal client of our own where it does not.

import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { serveDist } from './with-dist.mjs';
import { pickWebSocket } from './lib/ws-client.mjs';

const CHROME_CANDIDATES = [
  process.env.CHROME_BIN,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/usr/bin/google-chrome-stable',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/usr/local/bin/google-chrome',
].filter(Boolean);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

class Cdp {
  constructor(url) { this.url = url; this.id = 0; this.pending = new Map(); this.ws = null; }
  async connect() {
    this.ws = new (pickWebSocket())(this.url);
    await new Promise((res, rej) => {
      this.ws.onopen = res;
      this.ws.onerror = () => rej(new Error('CDP websocket error'));
    });
    this.ws.onmessage = (ev) => {
      let m; try { m = JSON.parse(ev.data); } catch { return; }
      if (m.id && this.pending.has(m.id)) {
        const { resolve, reject } = this.pending.get(m.id);
        this.pending.delete(m.id);
        if (m.error) reject(new Error(m.error.message)); else resolve(m.result);
      }
    };
  }
  send(method, params = {}, sessionId) {
    const id = ++this.id;
    const payload = { id, method, params };
    if (sessionId) payload.sessionId = sessionId;
    return new Promise((res, rej) => {
      this.pending.set(id, { resolve: res, reject: rej });
      this.ws.send(JSON.stringify(payload));
      setTimeout(() => {
        if (this.pending.has(id)) { this.pending.delete(id); rej(new Error('CDP timeout: ' + method)); }
      }, 60000);
    });
  }
  close() { try { this.ws.close(); } catch { /* closed */ } }
}

async function launchChrome() {
  const bin = CHROME_CANDIDATES.find((p) => p && existsSync(p));
  if (!bin) throw new Error('No Chrome binary found. Set CHROME_BIN.');
  const profile = mkdtempSync(join(tmpdir(), 'swr-swreload-'));
  const args = [
    `--user-data-dir=${profile}`,
    '--remote-debugging-port=0',
    '--no-first-run', '--no-default-browser-check',
    '--autoplay-policy=no-user-gesture-required',
    '--enable-unsafe-swiftshader',
    '--headless=new',
    'about:blank',
  ];
  const proc = spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'], detached: true });
  let stderr = '';
  const wsUrl = await new Promise((res, rej) => {
    const timer = setTimeout(() => rej(new Error('Chrome did not expose a DevTools endpoint.\n' + stderr)), 30000);
    proc.stderr.on('data', (d) => {
      stderr += d.toString();
      const m = stderr.match(/DevTools listening on (ws:\/\/\S+)/);
      if (m) { clearTimeout(timer); res(m[1]); }
    });
    proc.on('exit', (c) => { clearTimeout(timer); rej(new Error('Chrome exited early (' + c + ')')); });
  });
  return { proc, wsUrl, profile };
}

// Counts page loads. sessionStorage survives a reload, so a reload shows
// up as a higher count.
const COUNT_LOADS = `
try {
  sessionStorage.setItem('__swrLoads', String((+sessionStorage.getItem('__swrLoads') || 0) + 1));
} catch (e) { /* opaque origin */ }
`;

async function main() {
  const server = await serveDist(0);
  const TARGET = server.url + '/engine.html';
  const { proc, wsUrl, profile } = await launchChrome();
  const cdp = new Cdp(wsUrl);
  let exitCode = 0;
  const results = [];
  const ok = (step, good, extra) => results.push({ step, ok: good, ...extra });

  try {
    await cdp.connect();
    const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' });
    const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
    await cdp.send('Runtime.enable', {}, sessionId);
    await cdp.send('Page.enable', {}, sessionId);
    await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: COUNT_LOADS }, sessionId);

    const evaluate = async (expression) => {
      const res = await cdp.send('Runtime.evaluate', {
        expression, returnByValue: true, awaitPromise: true, timeout: 30000,
      }, sessionId);
      if (res.exceptionDetails) {
        throw new Error('page eval threw: ' +
          (res.exceptionDetails.exception?.description || res.exceptionDetails.text));
      }
      return res.result?.value;
    };

    await cdp.send('Page.navigate', { url: TARGET }, sessionId);

    // Wait for the worker to take over the page. On a cold profile that is
    // the FIRST takeover — the one that must not reload.
    let controlled = false;
    for (let i = 0; i < 120; i++) {
      try {
        controlled = await evaluate('!!navigator.serviceWorker && !!navigator.serviceWorker.controller');
      } catch { /* navigating */ }
      if (controlled) break;
      await sleep(250);
    }
    ok('worker-claims', controlled, { controlled });

    // Give any reload the first takeover might have caused time to land.
    await sleep(3000);

    const loads1 = await evaluate("+(sessionStorage.getItem('__swrLoads') || 0)");
    ok('first-takeover-no-reload', loads1 === 1, { loads: loads1 });

    // The page is controlled now. Reload it ONCE: that load finds a
    // controller already in place, which is the situation an UPDATE
    // creates — and the only situation in which a controllerchange has to
    // reload the page.
    await evaluate('location.reload()');
    await sleep(2500);
    let loads2 = loads1;
    for (let i = 0; i < 40; i++) {
      try { loads2 = await evaluate("+(sessionStorage.getItem('__swrLoads') || 0)"); } catch { /* navigating */ }
      if (loads2 > loads1) break;
      await sleep(250);
    }
    ok('controlled-load', loads2 === loads1 + 1, { loads: loads2 });

    // Now an UPDATE takes over: controllerchange MUST reload, or a
    // deployed change is never picked up without a manual refresh.
    await evaluate(
      "navigator.serviceWorker.dispatchEvent(new Event('controllerchange'))"
    );
    let loads3 = loads2;
    for (let i = 0; i < 40; i++) {
      await sleep(250);
      try { loads3 = await evaluate("+(sessionStorage.getItem('__swrLoads') || 0)"); } catch { /* navigating */ }
      if (loads3 > loads2) break;
    }
    ok('update-reloads', loads3 > loads2, { loads: loads3 });
  } catch (err) {
    console.error('ERROR: ' + (err && err.message ? err.message : err));
    exitCode = 1;
  } finally {
    try { cdp.close(); } catch { /* ignore */ }
    try { process.kill(-proc.pid, 'SIGKILL'); } catch { /* already gone */ }
    try { proc.kill('SIGKILL'); } catch { /* already gone */ }
    try { rmSync(profile, { recursive: true, force: true }); } catch { /* ignore */ }
    try { await server.close(); } catch { /* ignore */ }
  }

  if (exitCode !== 0 && results.length === 0) {
    console.log('\nFAIL — the gate did not reach its assertions');
    process.exit(exitCode);
  }
  console.log('TARGET  ' + (server.url || '') + '/engine.html');
  for (const r of results) {
    const extra = Object.keys(r).filter((k) => k !== 'step' && k !== 'ok')
      .map((k) => k + '=' + JSON.stringify(r[k])).join(' ');
    console.log('  ' + (r.ok ? 'ok  ' : 'FAIL') + ' ' + r.step.padEnd(26) + extra);
  }
  const failed = results.filter((r) => !r.ok);
  if (failed.length) {
    console.log('\nFAIL — ' + failed.length + ' of ' + results.length + ' checks failed');
    exitCode = 1;
  } else {
    console.log('\nPASS — the first takeover does not reload, and an update still does');
  }
  process.exit(exitCode);
}

main();
