// scripts/check-media-input-smoke.mjs
//
// Puppeteer smoke against the built dist/ — verifies all 3 MediaInput
// foundation modules load cleanly + expose the documented globals. Does
// NOT exercise real camera/mic (CI sandbox can't grant permissions);
// HTML wiring into engine.html is a separate task.
//
//   1. Page boots without console errors (filtering the dev-control WS
//      probe to ws://localhost:8787, same FATAL_FILTER as capture-smoke).
//   2. SWR_MEDIA_INPUT defined with a `create` method.
//   3. SWR_CAMERA_PREVIEW defined with `mount` + `unmount`.
//   4. SWR_MIC_METER defined with `mount` + `unmount`.
//   5. SWR_MEDIA_INPUT.create() returns an instance with the documented
//      method surface (startCamera/stopCamera/startMic/stopMic).
//   6. Module IIFE guard works — re-loading source doesn't re-define.
//   7. All 3 modules' scripts load (200 status, no 404s).
//
// Run:  node scripts/check-media-input-smoke.mjs
// Exit: 0 = PASSED, 1 = any failure.

import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import puppeteer from 'puppeteer';
import { ensureDist } from './with-dist.mjs';

ensureDist();

// Static server for the built dist/. Port 5183 is distinct from the
// capture-smoke (5182) and automix-smoke (5181) so all three can run
// side-by-side.
const distDir = path.resolve(dirname(fileURLToPath(import.meta.url)), '../dist');
const server = http.createServer((req, res) => {
  let p = req.url.split('?')[0];
  if (p.endsWith('/')) p += 'index.html';
  let file = path.join(distDir, p);
  if (!file.startsWith(distDir)) { res.statusCode = 403; res.end(); return; }
  fs.readFile(file, (err, data) => {
    if (err) {
      // Mirrors the vercel rewrite: the flat build emits dist/engine.html /
      // dist/spit.html for the extensionless /engine and /spit paths.
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
      : 'application/octet-stream';
    res.setHeader('Content-Type', mime);
    res.end(data);
  });
});
server.listen(5183);

const browser = await puppeteer.launch({
  args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
});

const results = [];
function ok(name) { results.push('  ✓ ' + name); }
function bad(name, got) { results.push('  ✗ ' + name + ' (got: ' + got + ')'); process.exitCode = 1; }

// Same FATAL_FILTER as check-capture-smoke.mjs — the dev-control WS
// probe to ws://localhost:8787 is a known noisy failure on CI runners,
// and the static server can't serve /api/* (nav.client's boot fetch of
// /api/auth/session 404s), same convention as
// verify-automix-cross-surface.mjs.
const FATAL_FILTER = /WebSocket.*ws:\/\/localhost:8787|404/;

async function nav(page, url) {
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForFunction(() => document.readyState === 'complete', { timeout: 15000 }).catch(() => {});
}

const page = await browser.newPage();
const errors = [];
const loaded = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('response', (r) => {
  if (r.url().endsWith('.client.js')) loaded.push(r.status());
});

// Navigate to engine — it doesn't load the 3 media-input scripts, so we
// inject them dynamically in evaluate() below. This sidesteps HTML
// wiring (Task 5's job) while still asserting the modules' globals land.
await nav(page, 'http://localhost:5183/engine');

// Inject the 3 scripts. We catch 404s via the `loaded` response list.
const injectResult = await page.evaluate(async () => {
  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = src;
      s.onload = () => resolve({ src, ok: true });
      s.onerror = () => resolve({ src, ok: false });
      document.head.appendChild(s);
    });
  }
  const a = await loadScript('/client/swr-media-input.client.js');
  const b = await loadScript('/client/swr-camera-preview.client.js');
  const c = await loadScript('/client/swr-mic-meter.client.js');
  return [a, b, c];
});
if (injectResult.every((r) => r.ok)) ok('all 3 module scripts loaded (no 404s)');
else bad('all 3 module scripts loaded', JSON.stringify(injectResult));

// 1. No console errors at boot (filtering the dev-control WS probe).
const fatalErrors = errors.filter((e) => !FATAL_FILTER.test(e));
if (fatalErrors.length === 0) ok('no console errors at boot');
else bad('no console errors at boot', JSON.stringify(fatalErrors));

// 2. SWR_MEDIA_INPUT defined with `create`.
const hasMI = await page.evaluate(() => !!(window.SWR_MEDIA_INPUT && typeof window.SWR_MEDIA_INPUT.create === 'function'));
if (hasMI) ok('window.SWR_MEDIA_INPUT defined with create()');
else bad('window.SWR_MEDIA_INPUT defined with create()', 'undefined');

// 3. SWR_CAMERA_PREVIEW defined with mount + unmount.
const hasCP = await page.evaluate(() => {
  const cp = window.SWR_CAMERA_PREVIEW;
  return !!(cp && typeof cp.mount === 'function' && typeof cp.unmount === 'function');
});
if (hasCP) ok('window.SWR_CAMERA_PREVIEW defined with mount + unmount');
else bad('window.SWR_CAMERA_PREVIEW defined with mount + unmount', 'undefined');

// 4. SWR_MIC_METER defined with mount + unmount.
const hasMM = await page.evaluate(() => {
  const mm = window.SWR_MIC_METER;
  return !!(mm && typeof mm.mount === 'function' && typeof mm.unmount === 'function');
});
if (hasMM) ok('window.SWR_MIC_METER defined with mount + unmount');
else bad('window.SWR_MIC_METER defined with mount + unmount', 'undefined');

// 5. Factory call — create() returns an instance with the documented
//    method surface. We can't actually start the camera/mic (no
//    permissions in headless Chrome), but the instance + methods exist.
const factoryOk = await page.evaluate(() => {
  try {
    const inst = window.SWR_MEDIA_INPUT.create();
    return !!(inst
      && typeof inst.startCamera === 'function'
      && typeof inst.stopCamera === 'function'
      && typeof inst.startMic === 'function'
      && typeof inst.stopMic === 'function'
      && typeof inst.destroy === 'function');
  } catch (_) { return false; }
});
if (factoryOk) ok('SWR_MEDIA_INPUT.create() returns instance with startCamera/stopCamera/startMic/stopMic/destroy');
else bad('factory surface', 'missing methods or threw');

// 6. Module IIFE guard — re-injecting the same source must NOT
//    re-define window.SWR_MEDIA_INPUT (the guard short-circuits). The
//    simplest signal: after a second inject, the original factory
//    reference is unchanged (identity preserved).
const guardOk = await page.evaluate(async () => {
  const before = window.SWR_MEDIA_INPUT;
  await new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = '/client/swr-media-input.client.js';
    s.onload = resolve; s.onerror = reject;
    document.head.appendChild(s);
  });
  return window.SWR_MEDIA_INPUT === before;
});
if (guardOk) ok('module IIFE guard works (re-injecting source does not redefine global)');
else bad('module IIFE guard works', 'reference changed');

console.log(results.join('\n'));
console.log('\nMEDIA-INPUT SMOKE: ' + (process.exitCode ? 'FAILED' : 'PASSED') +
  ' (' + results.length + ' assertions)');
await browser.close();
server.close();
