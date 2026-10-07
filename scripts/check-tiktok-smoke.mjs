// scripts/check-tiktok-smoke.mjs
//
// Puppeteer smoke against the built dist/ — verifies the TikTok Studio page
// (/tiktok) boots cleanly and exposes the SWR_TIKTOK + SWR_TIKTOK_EXPORT
// globals, the 3 vibe tabs, the 4 vibe buttons of the default tab, the four
// export buttons and the 1080x1920 stage canvas.
//
//   1. Page boots without console errors (filtering the dev-control WS probe
//      to ws://localhost:8787, same FATAL_FILTER as the other smoke tests).
//   2. <swr-nav> mounted.
//   3. <canvas id="tt-stage"> rendered at 1080x1920.
//   4. #tt-tabs has 3 tab buttons; #tt-vibes has 4 buttons for the default tab.
//   5. The 4 export buttons exist and start disabled.
//   6. window.SWR_TIKTOK.create is a function; window.SWR_TIKTOK_EXPORT.export is a function.
//   7. SWR_TIKTOK.create(canvas, null) returns an instance exposing the 8 methods.
//   8. SWR_TIKTOK.VIBES lists all 12 presets.
//
// Run:  node scripts/check-tiktok-smoke.mjs
// Exit: 0 = PASSED, 1 = any failure.

import { fileURLToPath } from 'node:url';
import { dirname, extname, join, resolve } from 'node:path';
import http from 'node:http';
import fs from 'node:fs';
import puppeteer from 'puppeteer';
import { ensureDist } from './with-dist.mjs';

ensureDist();

// Static server for the built dist/. Port 5185 is distinct from
// capture-smoke (5182), automix-smoke (5181), media-input-smoke (5183) and
// spit-live-smoke (5184) so all five can run side-by-side.
const distDir = resolve(dirname(fileURLToPath(import.meta.url)), '../dist');
const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp',
  '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.mp4': 'video/mp4',
  '.webmanifest': 'application/manifest+json', '.woff2': 'font/woff2',
};
const server = http.createServer((req, res) => {
  let p = req.url.split('?')[0];
  if (p.endsWith('/')) p += 'index.html';
  const file = join(distDir, p);
  if (!file.startsWith(distDir)) { res.statusCode = 403; res.end(); return; }
  fs.readFile(file, (err, buf) => {
    if (err) { res.statusCode = 404; res.end('not found'); return; }
    res.setHeader('content-type', MIME[extname(file)] || 'application/octet-stream');
    res.end(buf);
  });
});

const FATAL_FILTER = (line) => !/ws:\/\/localhost:8787/.test(String(line));

let failures = 0;
function check(name, ok, detail) {
  console.log(`${ok ? '✓' : '✗'} ${name}${detail ? `  ${detail}` : ''}`);
  if (!ok) failures += 1;
}

const PORT = 5185;
await new Promise((r) => server.listen(PORT, '127.0.0.1', r));

let browser;
try {
  browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--autoplay-policy=no-user-gesture-required'],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 1000 });

  const consoleErrors = [];
  page.on('console', (m) => { if (m.type() === 'error' && FATAL_FILTER(m.text())) consoleErrors.push(m.text()); });
  page.on('pageerror', (e) => consoleErrors.push('pageerror: ' + e.message));

  // domcontentloaded + an explicit wait for the stage, not networkidle0:
  // networkidle0 needs zero in-flight requests for 500ms, and this page's
  // media work keeps the network busy past the timeout on CI runners (the
  // condition that made verify-automix / check:automix-smoke flaky).
  const resp = await page.goto(`http://127.0.0.1:${PORT}/tiktok.html`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForSelector('#tt-stage', { timeout: 10000 }).catch(() => {});
  check('page loads', resp.status() === 200, `(${resp.status()})`);
  await new Promise((r) => setTimeout(r, 1200));

  check('<swr-nav> mounted', await page.evaluate(() => !!document.querySelector('swr-nav')));

  const stage = await page.evaluate(() => {
    const c = document.getElementById('tt-stage');
    return c ? { w: c.width, h: c.height } : null;
  });
  check('stage canvas is 1080x1920', !!stage && stage.w === 1080 && stage.h === 1920, stage ? `${stage.w}x${stage.h}` : 'missing');

  const picker = await page.evaluate(() => ({
    tabs: document.querySelectorAll('#tt-tabs .tt-tab').length,
    vibes: document.querySelectorAll('#tt-vibes .tt-vibe').length,
  }));
  check('3 vibe tabs', picker.tabs === 3, `(${picker.tabs})`);
  check('4 vibe buttons on the default tab', picker.vibes === 4, `(${picker.vibes})`);

  const exportsState = await page.evaluate(() => ['teaser', 'hook', 'clip', 'behind'].map((t) => {
    const b = document.getElementById('tt-export-' + t);
    return b ? b.disabled : null;
  }));
  check('4 export buttons present', exportsState.every((v) => v !== null), JSON.stringify(exportsState));
  check('export buttons start disabled', exportsState.every((v) => v === true));

  const globals = await page.evaluate(() => ({
    runtime: typeof (window.SWR_TIKTOK && window.SWR_TIKTOK.create),
    exporter: typeof (window.SWR_TIKTOK_EXPORT && window.SWR_TIKTOK_EXPORT.export),
    vibes: window.SWR_TIKTOK ? Object.keys(window.SWR_TIKTOK.VIBES || {}).length : 0,
  }));
  check('SWR_TIKTOK.create is a function', globals.runtime === 'function', globals.runtime);
  check('SWR_TIKTOK_EXPORT.export is a function', globals.exporter === 'function', globals.exporter);
  check('12 vibe presets', globals.vibes === 12, `(${globals.vibes})`);

  const api = await page.evaluate(() => {
    try {
      const c = document.getElementById('tt-stage');
      const inst = window.SWR_TIKTOK.create(c, null);
      const methods = ['loadAudio', 'pickVibe', 'setTrim', 'play', 'pause', 'seek', 'getState', 'destroy'];
      return { ok: true, missing: methods.filter((m) => typeof inst[m] !== 'function'), state: inst.getState() };
    } catch (e) { return { ok: false, error: String(e) }; }
  });
  check('create(canvas, null) returns the full API', api.ok && api.missing.length === 0, api.ok ? `missing: ${api.missing.join(',') || 'none'}` : api.error);
  check('getState() reads idle before any audio', api.ok && api.state && api.state.state === 'idle', api.ok ? api.state.state : '');

  const fatal = consoleErrors.filter((e) => FATAL_FILTER(e));
  check('no console errors', fatal.length === 0, fatal.length ? fatal.slice(0, 2).join(' | ') : `(${consoleErrors.length} filtered)`);

  console.log(failures === 0 ? '\nTikTok smoke: PASSED' : `\nTikTok smoke: ${failures} failure(s)`);
} finally {
  if (browser) await browser.close().catch(() => {});
  server.close();
}
process.exit(failures === 0 ? 0 : 1);
