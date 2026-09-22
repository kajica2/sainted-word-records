// scripts/check-spit-live-smoke.mjs
//
// Puppeteer smoke against the built dist/ — verifies the Spit Live page
// (/spit) boots cleanly and exposes the SWR_SPIT + SWR_SPIT_FX globals
// + the 6 FX buttons + the stage canvas.
//
//   1. Page boots without console errors (filtering the dev-control WS
//      probe to ws://localhost:8787, same FATAL_FILTER as the other
//      smoke tests).
//   2. <swr-nav> mounted.
//   3. <canvas id="spit-canvas"> rendered (1080×1920).
//   4. All 6 .spit-fx-btn buttons present.
//   5. window.SWR_SPIT defined with create() method.
//   6. window.SWR_SPIT_FX defined with trigger() method.
//   7. SWR_SPIT.create(canvas) returns instance with all 10 methods.
//   8. SWR_SPIT.create(null) → runtime returns instance (forgiving;
//      the runtime tolerates a null stage canvas and will fall back
//      to the #spit-canvas DOM element via _initDOMElements).
//
// Run:  node scripts/check-spit-live-smoke.mjs
// Exit: 0 = PASSED, 1 = any failure.

import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import puppeteer from 'puppeteer';
import { ensureDist } from './with-dist.mjs';

ensureDist();

// Static server for the built dist/. Port 5184 is distinct from
// capture-smoke (5182), automix-smoke (5181), media-input-smoke (5183)
// so all four can run side-by-side.
const distDir = path.resolve(dirname(fileURLToPath(import.meta.url)), '../dist');
const server = http.createServer((req, res) => {
  let p = req.url.split('?')[0];
  if (p.endsWith('/')) p += 'index.html';
  let file = path.join(distDir, p);
  if (!file.startsWith(distDir)) { res.statusCode = 403; res.end(); return; }
  fs.readFile(file, (err, data) => {
    if (err) { res.statusCode = 404; res.end(); return; }
    const ext = path.extname(file);
    const mime = ext === '.html' ? 'text/html'
      : ext === '.js' ? 'text/javascript'
      : 'application/octet-stream';
    res.setHeader('Content-Type', mime);
    res.end(data);
  });
});
server.listen(5184);

const browser = await puppeteer.launch({
  args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
});

const results = [];
function ok(name) { results.push('  ✓ ' + name); }
function bad(name, got) { results.push('  ✗ ' + name + ' (got: ' + got + ')'); process.exitCode = 1; }

// Same FATAL_FILTER as the other smoke tests — the dev-control WS probe
// to ws://localhost:8787 is a known noisy failure on CI runners.
const FATAL_FILTER = /WebSocket.*ws:\/\/localhost:8787/;

async function nav(page, url) {
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForFunction(() => document.readyState === 'complete', { timeout: 15000 }).catch(() => {});
}

const page = await browser.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

await nav(page, 'http://localhost:5184/spit');

// 1. No console errors at boot (filtering the dev-control WS probe).
const fatalErrors = errors.filter((e) => !FATAL_FILTER.test(e));
if (fatalErrors.length === 0) ok('no console errors at boot');
else bad('no console errors at boot', JSON.stringify(fatalErrors));

// 2. <swr-nav> mounted.
const hasNav = await page.evaluate(() => !!document.querySelector('swr-nav'));
if (hasNav) ok('<swr-nav> mounted');
else bad('<swr-nav> mounted', 'not found');

// 3. <canvas id="spit-canvas"> rendered with the documented size.
const canvasInfo = await page.evaluate(() => {
  const c = document.getElementById('spit-canvas');
  if (!c) return null;
  return { tag: c.tagName, w: c.width, h: c.height };
});
if (canvasInfo && canvasInfo.tag === 'CANVAS' && canvasInfo.w === 1080 && canvasInfo.h === 1920)
  ok('spit-canvas rendered (1080×1920)');
else bad('spit-canvas rendered (1080×1920)', JSON.stringify(canvasInfo));

// 4. All 6 .spit-fx-btn buttons present.
const fxBtnCount = await page.evaluate(() => document.querySelectorAll('.spit-fx-btn').length);
if (fxBtnCount === 6) ok('6 .spit-fx-btn buttons present');
else bad('6 .spit-fx-btn buttons present', String(fxBtnCount));

// 5. window.SWR_SPIT defined with create().
const hasSpit = await page.evaluate(() => !!(window.SWR_SPIT && typeof window.SWR_SPIT.create === 'function'));
if (hasSpit) ok('window.SWR_SPIT defined with create()');
else bad('window.SWR_SPIT defined with create()', 'undefined');

// 6. window.SWR_SPIT_FX defined with trigger().
const hasFx = await page.evaluate(() => !!(window.SWR_SPIT_FX && typeof window.SWR_SPIT_FX.trigger === 'function'));
if (hasFx) ok('window.SWR_SPIT_FX defined with trigger()');
else bad('window.SWR_SPIT_FX defined with trigger()', 'undefined');

// 7. SWR_SPIT.create(canvas) returns instance with all 10 methods.
const factoryOk = await page.evaluate(() => {
  try {
    const c = document.getElementById('spit-canvas');
    const inst = window.SWR_SPIT.create(c, {});
    return inst && ['loadBeat', 'playBeat', 'pauseBeat', 'seekBeat', 'toggleMic',
      'triggerFx', 'startRecording', 'stopRecording', 'getState', 'destroy']
      .every((m) => typeof inst[m] === 'function');
  } catch (_) { return false; }
});
if (factoryOk) ok('SWR_SPIT.create(canvas) returns instance with 10 methods');
else bad('factory surface', 'missing methods or threw');

// 8. SWR_SPIT.create(null) — runtime is forgiving: it tolerates a null
//    stage canvas and falls back to the #spit-canvas DOM element via
//    _initDOMElements. Verify it returns an instance.
const nullOk = await page.evaluate(() => {
  try {
    const inst = window.SWR_SPIT.create(null, {});
    return inst && typeof inst.getState === 'function';
  } catch (_) { return false; }
});
if (nullOk) ok('SWR_SPIT.create(null) returns instance (forgiving — falls back to DOM canvas)');
else bad('SWR_SPIT.create(null)', 'threw or returned non-instance');

console.log(results.join('\n'));
console.log('\nSPIT-LIVE SMOKE: ' + (process.exitCode ? 'FAILED' : 'PASSED') +
  ' (' + results.length + ' assertions)');
await browser.close();
server.close();
