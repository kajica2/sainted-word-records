// verify-freq-bridge.mjs — verify tools/freq-bridge.js against the
// live https://freq-lab.vercel.app/ HTML. Forks the page in headless
// Chrome, lets freq-lab's main script run, then verifies the
// FreqLab-features pattern:
//
//   1. FreqLabFeatures['swr-vc-bridge'] is registered.
//   2. Self-init via setTimeout(boot, 250) opens a WS to localhost:8787.
//   3. Mutating #carrier's value emits {type:"set",param:"carrier"}.
//   4. Inbound {type:"action",name:"play"} synthesizes a click on
//      #playBtn (instrumented via wrapper that records.
//   5. Inbound {type:"set",param:"amDepth",value:<x>} writes the slider.
//   6. disconnect() drops the WS peer cleanly.

import http from 'node:http';
import { WebSocket } from 'ws';
import puppeteer from 'puppeteer';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname);
const BRIDGE_URL = process.env.VC_WS_URL || 'ws://127.0.0.1:8787';
const FREQLAB_URL = 'https://freq-lab.vercel.app/';

let failed = 0;
let wsProc = null;
async function step(name, fn) {
  try { await fn(); process.stdout.write(`  ✓ ${name}\n`); }
  catch (e) { failed++; process.stderr.write(`  ✗ ${name}\n    ${e.stack || e.message}\n`); }
}
function ok(c, m) { if (!c) throw new Error(m || 'assertion failed'); }

function healthz(url, t = 800) {
  return new Promise((resolve) => {
    const req = http.get(url, (res) => { res.resume(); resolve(res.statusCode === 200); });
    req.on('error', () => resolve(false));
    req.setTimeout(t, () => { req.destroy(); resolve(false); });
  });
}

async function main() {
  const up = await healthz('http://127.0.0.1:8799/healthz', 500);
  if (!up) {
    wsProc = spawn('node', ['scripts/dev-control-ws.mjs'], {
      cwd: ROOT, stdio: 'inherit',
      env: { ...process.env, VC_WS_PORT: '8787', VC_WS_HEALTH_PORT: '8799' },
    });
    for (let i = 0; i < 30; i++) {
      if (await healthz('http://127.0.0.1:8799/healthz', 500)) break;
      await new Promise((r) => setTimeout(r, 300));
    }
  }

  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'],
  });
  const page = await browser.newPage();
  page.on('pageerror', (e) => console.error('PE:', e.message));
  page.on('console', (m) => {
    if (m.type() === 'error' || m.type() === 'warning') {
      console.log(`[page ${m.type()}]`, m.text());
    }
  });

  await page.setViewport({ width: 1280, height: 800 });
  const bridgeSrc = fs.readFileSync(path.join(ROOT, 'tools', 'freq-bridge.js'), 'utf8');
  await page.evaluateOnNewDocument(bridgeSrc);

  await page.goto(FREQLAB_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });

  // Wait for freq-lab to expose its core controls AND for our
  // boot() setTimeout to have run.
  await page.waitForSelector('#carrier', { timeout: 30000 });
  await page.waitForFunction(() => {
    const f = window.FreqLabFeatures && window.FreqLabFeatures['swr-vc-bridge'];
    return f && typeof f.snapshot === 'function';
  }, { timeout: 10000, polling: 200 });

  // Give the WS handshake + initial poll a beat. We poll
  // /healthz from Node-side because Chrome's private-network
  // block (PSA from HTTPS origins) prevents fetch(127.0.0.1:8799)
  // from the page context.
  let bridgePeerFound = false;
  for (let i = 0; i < 30; i++) {
    const hz = await fetch('http://127.0.0.1:8799/healthz').then((r) => r.json());
    if ((hz.peers || []).some((p) => p.role === 'freq-bridge')) { bridgePeerFound = true; break; }
    await new Promise((r) => setTimeout(r, 200));
  }
  ok(bridgePeerFound, 'freq-bridge peer registered with WS server');

  ok(true, 'freq-bridge registered and connected to WS bridge');

  // Open driver socket.
  const driver = new WebSocket(BRIDGE_URL);
  await new Promise((res, rej) => { driver.once('open', res); driver.once('error', rej); });
  driver.send(JSON.stringify({ type: 'hello', role: 'verify-driver', source: 'verify-freq-bridge.mjs' }));
  await new Promise((r) => setTimeout(r, 300));

  const inbound = [];
  driver.on('message', (data) => {
    let m;
    try { m = JSON.parse(data.toString('utf8')); } catch (_) { return; }
    if (m && m.type === 'set') inbound.push(m);
  });

  await step('1. snapshot() exposes DOM-driven state', async () => {
    const s = await page.evaluate(() => window.FreqLabFeatures['swr-vc-bridge'].snapshot());
    ok(typeof s.carrier === 'number', `carrier missing: ${JSON.stringify(s)}`);
    ok(typeof s.beat === 'number', `beat missing: ${JSON.stringify(s)}`);
    ok(s.waveform && typeof s.waveform === 'string', `waveform missing: ${JSON.stringify(s)}`);
    ok(s.volume !== undefined, `volume missing: ${JSON.stringify(s)}`);
  });

  await step('2. mutation of #carrier.value emits a set:carrier message', async () => {
    inbound.length = 0;
    const target = 333 + Math.floor(Math.random() * 100);
    await page.evaluate((v) => {
      const el = document.getElementById('carrier');
      el.value = String(v);
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
    }, target);
    await new Promise((r) => setTimeout(r, 600));
    const saw = inbound.find((m) => m.param === 'carrier');
    ok(saw && Math.abs(saw.value - target) < 1e-3,
       `no carrier-set message; inbound=${JSON.stringify(inbound)} target=${target}`);
  });

  await step('3. inbound set: amDepth writes the slider value', async () => {
    driver.send(JSON.stringify({ type: 'set', param: 'amDepth', value: 0.42 }));
    await new Promise((r) => setTimeout(r, 350));
    const got = await page.evaluate(() => parseFloat(document.getElementById('amDepth').value));
    ok(Math.abs(got - 0.42) < 1e-3, `amDepth DOM not 0.42 (got ${got})`);
  });

  await step('4. inbound action: play synthesizes a #playBtn click', async () => {
    await page.evaluate(() => {
      window.__playClicks = 0;
      const btn = document.getElementById('playBtn');
      const orig = btn.click.bind(btn);
      btn.click = function (...args) { window.__playClicks++; return orig(...args); };
    });
    driver.send(JSON.stringify({ type: 'action', name: 'play' }));
    await new Promise((r) => setTimeout(r, 300));
    const n = await page.evaluate(() => window.__playClicks);
    ok(n >= 1, `expected #playBtn.click() to fire; got n=${n}`);
  });

  await step('5. inbound action: reset synthesizes a #resetBtn click', async () => {
    await page.evaluate(() => {
      window.__resetClicks = 0;
      const btn = document.getElementById('resetBtn');
      const orig = btn.click.bind(btn);
      btn.click = function (...args) { window.__resetClicks++; return orig(...args); };
    });
    driver.send(JSON.stringify({ type: 'action', name: 'reset' }));
    await new Promise((r) => setTimeout(r, 300));
    const n = await page.evaluate(() => window.__resetClicks);
    ok(n >= 1, `expected #resetBtn.click() to fire; got n=${n}`);
  });

  await step('6. disconnect() drops the freq-bridge peer from /healthz', async () => {
    await page.evaluate(() => window.FreqLabFeatures['swr-vc-bridge'].disconnect());
    await new Promise((r) => setTimeout(r, 300));
    const hz = await fetch('http://127.0.0.1:8799/healthz').then((r) => r.json());
    const peers = hz.peers || [];
    const stillThere = peers.some((p) => p.role === 'freq-bridge');
    ok(!stillThere, `freq-bridge peer still listed: ${JSON.stringify(peers)}`);
  });

  await browser.close();
  driver.close();
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
