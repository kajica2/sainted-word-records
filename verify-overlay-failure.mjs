#!/usr/bin/env node
// verify-overlay-failure.mjs — proves the v3 overlay's failure-path
// fix: when the auto-start fails, the overlay STAYS visible so the
// user can click to retry. Before this fix, a failed first attempt
// would hide + remove the overlay after 600ms, leaving the user
// stranded with no way to retry.
//
//   node verify-overlay-failure.mjs
//
// We force a failure by stubbing SWR_PICK_DEFAULT_SONG to return null.
// Without the fix: overlay gone after 800ms, click does nothing.
// With the fix: overlay still visible, click triggers a fresh
// attempt (which we then un-stub and let succeed), overlay goes
// away after the successful retry.

import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import puppeteer from 'puppeteer';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PORT = 8096;

const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.gif': 'image/gif', '.wav': 'audio/wav', '.mp3': 'audio/mpeg',
  '.mp4': 'video/mp4', '.webm': 'video/webm',
};

function serve() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const rel = decodeURIComponent(req.url.split('?')[0].replace(/^\/+/, '')) || 'index.html';
      const file = path.join(ROOT, rel);
      if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
        res.writeHead(404); res.end('nf'); return;
      }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream' });
      fs.createReadStream(file).pipe(res);
    });
    server.listen(PORT, () => resolve(server));
  });
}

let failed = 0;
async function step(name, fn) {
  try { await fn(); process.stdout.write(`  ✓ ${name}\n`); }
  catch (e) { failed += 1; process.stderr.write(`  ✗ ${name}\n    ${e.stack || e.message}\n`); }
}
const ok = (cond, msg) => { if (!cond) throw new Error(msg || 'assertion failed'); };

const server = await serve();
let browser;
try {
  browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'],
  });
  const page = await browser.newPage();
  const consoleErrors = [];
  page.on('pageerror', (e) => consoleErrors.push('PE: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push('CE: ' + m.text()); });
  await page.setViewport({ width: 1280, height: 720 });
  await page.goto(`http://localhost:${PORT}/versions/eclipse.html`, { waitUntil: 'domcontentloaded', timeout: 30000 });

  // Wait for engine to be ready
  let waited = 0;
  while (waited < 15000) {
    const ready = await page.evaluate(() => !!(window.SWR && window.SWR.Audio));
    if (ready) break;
    await new Promise((r) => setTimeout(r, 200));
    waited += 200;
  }
  ok(waited < 15000, 'engine never became ready');

  // Override SWR_PICK_DEFAULT_SONG to always return null (simulate a
  // failed pick: no saved song + fallback URL also unreachable).
  // Then click the overlay to fire the auto-start.
  await step('after failed auto-start: overlay still visible, can be clicked again', async () => {
    await page.evaluate(() => { window.SWR_PICK_DEFAULT_SONG = function () { return Promise.resolve(null); }; });
    await page.evaluate(() => {
      // The v3 overlay removes itself after a 600ms hide transition.
      // Re-create the overlay on demand so this test can re-fire it
      // without depending on the original IIFE (which set fired=true
      // on the first attempt).
      const existing = document.getElementById('swr-start');
      if (existing) existing.click();
    });
    // Give the failed attempt time to settle (overlay would be removed at +600ms)
    await new Promise((r) => setTimeout(r, 1500));
    // The overlay should STILL be in the DOM (this is the bug we're fixing).
    const present = await page.evaluate(() => !!document.getElementById('swr-start'));
    ok(present, 'overlay was removed from DOM after a failed auto-start — user has no way to retry');
    // The overlay should NOT have the .hide class (it's visible)
    const hidden = await page.evaluate(() => {
      const o = document.getElementById('swr-start');
      return o && o.classList.contains('hide');
    });
    ok(!hidden, 'overlay has the .hide class after a failed auto-start — user sees a hidden overlay');
    // The sub text should say "tap a song to start" (the failure hint)
    const subText = await page.evaluate(() => {
      const s = document.getElementById('swr-start-sub');
      return s ? s.textContent : null;
    });
    ok(subText && /tap/i.test(subText), `sub text should show failure hint, got: ${subText}`);
  });

  await step('after failed attempt, clicking the overlay again re-fires start()', async () => {
    // Un-stub the picker and set a flag so we can detect the second call.
    await page.evaluate(() => {
      window.__pickCalls = 0;
      window.SWR_PICK_DEFAULT_SONG = function () {
        window.__pickCalls += 1;
        return Promise.resolve(null);
      };
    });
    // Click the overlay
    await page.evaluate(() => {
      const o = document.getElementById('swr-start');
      if (o) o.click();
    });
    await new Promise((r) => setTimeout(r, 500));
    const calls = await page.evaluate(() => window.__pickCalls);
    ok(calls >= 1, `expected click to re-fire start() and call SWR_PICK_DEFAULT_SONG, got ${calls} calls`);
  });

  await step('after successful retry, overlay hides + removes', async () => {
    // Stub the picker to actually return a fake song (a real mp3 from the
    // repo, just to feed the Audio module something it can read).
    await page.evaluate(async () => {
      const resp = await fetch('../audios/eclipse.mp3');
      const blob = await resp.blob();
      const file = new File([blob], 'eclipse.mp3', { type: 'audio/mpeg' });
      window.__pickCalls = 0;
      window.SWR_PICK_DEFAULT_SONG = function () {
        window.__pickCalls += 1;
        return Promise.resolve({ blob, name: 'eclipse.mp3', type: 'audio/mpeg', source: 'bundled' });
      };
    });
    // Click the overlay
    await page.evaluate(() => {
      const o = document.getElementById('swr-start');
      if (o) o.click();
    });
    // Wait for the hide transition + remove
    await new Promise((r) => setTimeout(r, 1500));
    const present = await page.evaluate(() => !!document.getElementById('swr-start'));
    ok(!present, 'overlay should be removed after a successful retry');
    // Audio should be playing
    const audio = await page.evaluate(() => {
      const A = window.SWR.Audio;
      return { el: !!A.el, playing: A.playing, rs: A.el ? A.el.readyState : null };
    });
    ok(audio.playing === true && audio.rs >= 2, `audio should be playing after successful retry, got ${JSON.stringify(audio)}`);
  });

  if (consoleErrors.length) {
    process.stderr.write('Console errors during run:\n');
    consoleErrors.forEach((e) => process.stderr.write('  ' + e + '\n'));
  }
} finally {
  if (browser) await browser.close();
  server.close();
}

if (failed === 0) {
  console.log('\nALL GREEN');
  process.exit(0);
} else {
  console.log(`\n${failed} FAILED`);
  process.exit(1);
}
