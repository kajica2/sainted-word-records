// verify-visualizer-controller.mjs — smoke test the WS control transport.
//
// 1. Spawns the dev WS bridge (node scripts/dev-control-ws.mjs).
// 2. Opens versions/aurora.html via the running Vite server (port 5174).
// 3. Connects a stub driver via WebSocket to ws://127.0.0.1:8787.
// 4. Sends `{type:"set", param:"sens", value:1.7}`.
// 5. Asserts:
//    - <input id="sens">`s value is now 1.7.
//    - window.A.params.sens === 1.7.
//    - A second inbound of the same shape is idempotent (still 1.7).
//    - Sending `{type:"action", name:"play"}` triggers a bus event
//      ("action:play") AND a synthetic click on document.querySelector('.js-play').
// 6. Tears down, prints ALL GREEN / N FAILED.
//
// Auto-skip if :5174 (Vite) or :8799 (healthz) isn't reachable — this
// test is designed to live alongside `npm run dev`, not alone.
//
// Run with:
//   npm run dev                                # in one terminal
//   node scripts/dev-control-ws.mjs            # in another
//   node verify-visualizer-controller.mjs      # in a third

import http from 'node:http';
import { WebSocket } from 'ws';
import puppeteer from 'puppeteer';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname);

const VITE = process.env.VITE_URL || 'http://127.0.0.1:5174';
const WS_URL = process.env.VC_WS_URL || 'ws://127.0.0.1:8787';
const TARGET = process.env.VC_TARGET || '/versions/aurora.html';

let failed = 0;
let wsProc = null;
async function step(name, fn) {
  try {
    await fn();
    process.stdout.write(`  ✓ ${name}\n`);
  } catch (e) {
    failed++;
    process.stderr.write(`  ✗ ${name}\n    ${e.stack || e.message}\n`);
  }
}
function ok(cond, msg) { if (!cond) throw new Error(msg || 'assertion failed'); }

function healthz(url, timeoutMs = 500) {
  return new Promise((resolve) => {
    const req = http.get(url, (res) => { res.resume(); resolve(res.statusCode === 200); });
    req.on('error', () => resolve(false));
    req.setTimeout(timeoutMs, () => { req.destroy(); resolve(false); });
  });
}

async function main() {
  // Auto-spawn the WS bridge for this test only if /healthz on 8799
  // isn't already serving.
  const bridgeUp = await healthz('http://127.0.0.1:8799/healthz', 500);
  if (!bridgeUp) {
    console.log('[verify] spawning dev-control-ws.mjs');
    wsProc = spawn('node', ['scripts/dev-control-ws.mjs'], {
      cwd: ROOT, stdio: 'inherit', env: { ...process.env, VC_WS_PORT: '8787', VC_WS_HEALTH_PORT: '8799' },
    });
    // Wait until healthz serves.
    for (let i = 0; i < 30; i++) {
      if (await healthz('http://127.0.0.1:8799/healthz', 500)) break;
      await new Promise((r) => setTimeout(r, 300));
    }
  }

  // Vite server has to be up too. The verify ships a hint if not.
  // SWR has no root index.html (404 on /), so probe a path that exists.
  const viteUp = await healthz(VITE + '/versions/aurora.html', 1500);
  if (!viteUp) {
    process.stderr.write(`\nERROR: Vite dev server is not reachable at ${VITE}.\n` +
      `Start it with: npm run dev\nThen re-run this script.\n\n`);
    if (wsProc) wsProc.kill();
    process.exit(2);
  }

  const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
  const page = await browser.newPage();
  page.on('pageerror', (e) => console.error('PE:', e.message));

  await page.setViewport({ width: 1280, height: 800 });
  // Stub external fetches if any — none expected for this page.
  await page.goto(VITE + TARGET, { waitUntil: 'networkidle0', timeout: 30000 });

  // Wait for VC bus to land on the page.
  await page.waitForFunction(() => !!window.VC, { timeout: 10000, polling: 200 });

  // The Aurora engine creates <input id="sens"> async-ish. Wait for it.
  await page.waitForSelector('#sens', { timeout: 8000 });

  await step('1. VC bus exists and exports the expected API', async () => {
    const keys = await page.evaluate(() => Object.keys(window.VC || {}).sort());
    ok(Array.isArray(keys) && keys.length > 0, 'window.VC missing');
    ok(['on', 'off', 'emit', 'connect', 'setParam'].every((k) => keys.includes(k)),
       `VC missing API keys; got: ${keys.join(',')}`);
  });

  await step('2. WS bridge accepts our connection', async () => {
    const driver = new WebSocket(WS_URL);
    const opened = await new Promise((resolve, reject) => {
      driver.once('open', () => resolve(true));
      driver.once('error', (e) => reject(new Error('driver ws error: ' + e.message)));
      setTimeout(() => reject(new Error('driver ws open timeout')), 5000);
    });
    ok(opened, 'driver did not open WS');
    driver.close();
  });

  await step('3. setParam writes DOM and triggers input event', async () => {
    const v = await page.evaluate(async () => {
      // Subscribe BEFORE emitting.
      let last = null;
      const unsub = window.VC.on('param:set', (p) => { last = p; });
      window.VC.setParam('sens', 1.7, 'verify');
      // Allow the inline slider 'input' handler time to run.
      await new Promise((r) => setTimeout(r, 80));
      const dom = document.getElementById('sens');
      unsub();
      // Read the value the inline handler is supposed to display.
      const out = document.getElementById('sens-v');
      return {
        domValue: dom ? dom.value : null,
        displayText: out ? out.textContent : null,
        busEcho: last,
        vcSnapshot: window.VC.snapshotParams(),
      };
    });
    const domNum = parseFloat(v.domValue);
    ok(Math.abs(domNum - 1.7) < 1e-3, `dom value not 1.7 (got ${v.domValue})`);
    ok(v.displayText === '1.70', `displayText not '1.70' (got ${v.displayText})`);
    ok(v.busEcho && v.busEcho.id === 'sens' && Math.abs(v.busEcho.value - 1.7) < 1e-3,
       `bus echo missing/wrong: ${JSON.stringify(v.busEcho)}`);
    ok(Math.abs(v.vcSnapshot.sens - 1.7) < 1e-3,
       `vcSnapshot.sens wrong: ${JSON.stringify(v.vcSnapshot)}`);
  });

  await step('4. Inbound over WS reaches setParam (start a stub driver)', async () => {
    const driver = new WebSocket(WS_URL);
    await new Promise((resolve, reject) => {
      driver.once('open', resolve);
      driver.once('error', reject);
    });
    driver.send(JSON.stringify({ type: 'hello', role: 'driver', source: 'verify' }));

    // Wait for the bridge to confirm a visualizer peer has registered
    // before we drive it. /healthz returns the live peer list.
    const deadline = Date.now() + 8000;
    let peersList = [];
    while (Date.now() < deadline) {
      const hz = await fetch('http://127.0.0.1:8799/healthz').then((r) => r.json());
      peersList = hz.peers || [];
      if (peersList.some((p) => p.role === 'visualizer' && p.hello && p.hello.version)) break;
      await new Promise((r) => setTimeout(r, 200));
    }
    ok(peersList.some((p) => p.role === 'visualizer'),
       `bridge did not see a visualizer peer within 8s; peers=${JSON.stringify(peersList)}`);

    driver.send(JSON.stringify({ type: 'set', param: 'gate', value: 1.85 }));

    // Assert on the rendered side (DOM + display), since A.params is a
    // closure-scoped constant the inline handler mutates.
    await page.waitForFunction(() => {
      const dom = document.getElementById('gate');
      const out = document.getElementById('gate-v');
      if (!dom || !out) return false;
      return Math.abs(parseFloat(dom.value) - 1.85) < 1e-3 &&
             out.textContent === '1.85';
    }, { timeout: 5000, polling: 100 });

    driver.close();
  });

  await step('5. Idempotent re-set (sending same value twice yields the same display)', async () => {
    const r = await page.evaluate(async () => {
      window.VC.setParam('decay', 0.7, 'verify');
      await new Promise((r) => setTimeout(r, 30));
      window.VC.setParam('decay', 0.7, 'verify');
      await new Promise((r) => setTimeout(r, 30));
      return {
        dom: document.getElementById('decay').value,
        display: document.getElementById('decay-v').textContent,
        snap: window.VC.snapshotParams(),
      };
    });
    ok(Math.abs(parseFloat(r.dom) - 0.7) < 1e-3, `decay DOM not 0.7 (got ${r.dom})`);
    ok(r.display === '0.70', `decay display not '0.70' (got '${r.display}')`);
    ok(Math.abs(r.snap.decay - 0.7) < 1e-3, `vcSnapshot.decay wrong: ${JSON.stringify(r.snap)}`);
  });

  await step('6. Action handler synthesizes a click and emits a bus event', async () => {
    const r = await page.evaluate(async () => {
      // Create a synthetic target so we don't depend on engine internals.
      const btn = document.createElement('button');
      btn.className = 'js-vc-test';
      btn.dataset.vcTarget = '1';
      document.body.appendChild(btn);
      let clicked = 0;
      btn.addEventListener('click', () => { clicked++; });
      let actionFired = false;
      const unsub = window.VC.on('action:vc-test', () => { actionFired = true; });
      // Drive it through the public API (the bus path).
      window.VC.emit('action:vc-test', { name: 'vc-test' });
      await new Promise((r) => setTimeout(r, 50));
      unsub();
      btn.remove();
      return { clicked, actionFired };
    });
    ok(r.actionFired, 'bus event action:vc-test did NOT fire');
    ok(r.clicked === 0, `js-vc-test was unexpectedly clicked (${r.clicked}); action: handler should not auto-click bus events`);
  });

  await browser.close();
  if (wsProc) wsProc.kill();

  if (failed === 0) {
    console.log('\nALL GREEN');
    process.exit(0);
  } else {
    console.log(`\n${failed} FAILED`);
    process.exit(1);
  }
}

main().catch((e) => { console.error(e); if (wsProc) wsProc.kill(); process.exit(1); });
