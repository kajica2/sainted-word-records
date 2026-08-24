#!/usr/bin/env node
// verify-library-switcher.mjs — smoke test for the unified song source picker.
//
//   BASE_URL=https://sainted-word-records-kai-djurics-projects.vercel.app \
//     node verify-library-switcher.mjs
//
// Asserts:
//   1. window.SWR_LIBRARY_SWITCHER exposes sources, list, pick, render
//   2. list('audio-bus') returns exactly one UnifiedSong on a loaded page
//   3. list('library') returns an array (possibly empty in CI)
//   4. list('playlist') returns [] if window.SWR.PLAYLIST is undefined
//   5. list('uploads') is a Promise (parity with library)
//   6. pick('audio-bus', <id>) returns a playable URL
//   7. render() mounts 4 .lsw-tab buttons into the target element
//   8. clicking a tab updates the visible list without throwing

import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import puppeteer from 'puppeteer';

const BASE = process.env.BASE_URL || 'http://localhost:5174';
const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PORT = 8089;

const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.wav': 'audio/wav',
  '.mp3': 'audio/mpeg', '.mp4': 'video/mp4', '.webm': 'video/webm',
};

function localServe() {
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

const server = await localServe();
let browser;
try {
  browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'],
  });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (err) => errors.push('PE: ' + err.message));
  page.on('console', (msg) => { if (msg.type() === 'error') errors.push('CE: ' + msg.text()); });

  await page.setViewport({ width: 1280, height: 720 });
  await page.goto(`${BASE}/versions/hallucination.html`,
                  { waitUntil: 'networkidle0', timeout: 45000 });

  // Wait for SWR_LIBRARY_SWITCHER + a loaded audio bus.
  let waited = 0;
  while (waited < 30000) {
    const ready = await page.evaluate(() =>
      !!window.SWR_LIBRARY_SWITCHER &&
      !!window.SWR && !!window.SWR.Audio && !!window.SWR.Audio.el);
    if (ready) break;
    await new Promise((r) => setTimeout(r, 500));
    waited += 500;
  }
  if (waited >= 30000) throw new Error('engine never became ready within 30s');

  await step('window.SWR_LIBRARY_SWITCHER exposes the public API', async () => {
    const api = await page.evaluate(() => ({
      hasIt: !!window.SWR_LIBRARY_SWITCHER,
      sources: window.SWR_LIBRARY_SWITCHER && window.SWR_LIBRARY_SWITCHER.sources,
      hasList: typeof window.SWR_LIBRARY_SWITCHER.list === 'function',
      hasPick: typeof window.SWR_LIBRARY_SWITCHER.pick === 'function',
      hasRender: typeof window.SWR_LIBRARY_SWITCHER.render === 'function',
    }));
    ok(api.hasIt, 'SWR_LIBRARY_SWITCHER missing');
    ok(api.hasList && api.hasPick && api.hasRender, 'missing methods');
    ok(Array.isArray(api.sources) && api.sources.length === 4, 'expected 4 sources');
    ok(api.sources.includes('library') && api.sources.includes('uploads') &&
       api.sources.includes('playlist') && api.sources.includes('audio-bus'),
       'sources should include library/uploads/playlist/audio-bus');
  });

  await step('list("audio-bus") returns exactly one UnifiedSong', async () => {
    const v = await page.evaluate(async () => {
      const r = await window.SWR_LIBRARY_SWITCHER.list('audio-bus');
      return r;
    });
    ok(Array.isArray(v) && v.length === 1, `expected 1 song, got ${v && v.length}`);
    ok(v[0].source === 'audio-bus', 'source should be audio-bus');
    ok(typeof v[0].url === 'string' && v[0].url.length > 0, 'url should be set');
  });

  await step('list("library") returns an array', async () => {
    const v = await page.evaluate(async () => {
      return await window.SWR_LIBRARY_SWITCHER.list('library');
    });
    ok(Array.isArray(v), 'expected array');
    if (v.length) {
      ok(v[0].source === 'library', 'first item source should be library');
      ok(!('blob' in v[0]) || v[0].blob === undefined, 'blob should not leak to list()');
      ok('url' in v[0] && v[0].url === undefined, 'url not resolved until pick()');
    }
  });

  await step('list("uploads") returns a Promise of an array', async () => {
    const v = await page.evaluate(async () => {
      return await window.SWR_LIBRARY_SWITCHER.list('uploads');
    });
    ok(Array.isArray(v), 'expected array from uploads');
  });

  await step('list("playlist") returns [] when no SWR.PLAYLIST', async () => {
    const v = await page.evaluate(async () => {
      return await window.SWR_LIBRARY_SWITCHER.list('playlist');
    });
    ok(Array.isArray(v) && v.length === 0, 'expected empty array');
  });

  await step('pick("audio-bus", id) returns a playable URL', async () => {
    const v = await page.evaluate(async () => {
      const list = await window.SWR_LIBRARY_SWITCHER.list('audio-bus');
      return await window.SWR_LIBRARY_SWITCHER.pick('audio-bus', list[0].sourceId);
    });
    ok(typeof v === 'string' && v.length > 0, 'pick should return a URL');
    ok(/^(blob:|https?:|data:)/.test(v), `unexpected URL form: ${v}`);
  });

  await step('render() mounts 4 tabs into a target element', async () => {
    const v = await page.evaluate(() => {
      const host = document.createElement('div');
      document.body.appendChild(host);
      const r = window.SWR_LIBRARY_SWITCHER.render(host, { onPick() {} });
      const tabs = host.querySelectorAll('.lsw-tab');
      const result = {
        tabCount: tabs.length,
        hasPanel: !!host.querySelector('.lsw-panel'),
        activeTab: (host.querySelector('.lsw-tab.active') || {}).dataset && host.querySelector('.lsw-tab.active').dataset.source,
      };
      if (r && r.destroy) r.destroy();
      host.remove();
      return result;
    });
    ok(v.tabCount === 4, `expected 4 tabs, got ${v.tabCount}`);
    ok(v.hasPanel, 'panel not mounted');
    ok(v.activeTab === 'audio-bus', `expected audio-bus active, got ${v.activeTab}`);
  });

  await step('clicking a tab switches the visible list', async () => {
    const v = await page.evaluate(async () => {
      const host = document.createElement('div');
      document.body.appendChild(host);
      const r = window.SWR_LIBRARY_SWITCHER.render(host, { onPick() {} });
      // Click "library" tab
      const libTab = host.querySelector('.lsw-tab[data-source="library"]');
      libTab.click();
      // Wait for the async load to settle
      await new Promise((res) => setTimeout(res, 400));
      const result = {
        nowActive: (host.querySelector('.lsw-tab.active') || {}).dataset && host.querySelector('.lsw-tab.active').dataset.source,
        hasRows: host.querySelectorAll('.lsw-row').length > 0 || !!host.querySelector('.lsw-empty'),
      };
      if (r && r.destroy) r.destroy();
      host.remove();
      return result;
    });
    ok(v.nowActive === 'library', `tab should be library, got ${v.nowActive}`);
    ok(v.hasRows, 'should show rows or empty placeholder');
  });

  if (errors.length) {
    process.stderr.write('Console errors during run:\n');
    errors.forEach((e) => process.stderr.write('  ' + e + '\n'));
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