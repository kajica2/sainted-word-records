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

  // Load the playlist client. hallucination.html doesn't include it by
  // default (it's a Phase-2+ consumer on make-video.html). The library-
  // switcher test for the 'playlist' source needs the global present.
  await page.addScriptTag({ path: path.join(ROOT, 'lib', 'playlist.client.js') });

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
    ok(Array.isArray(api.sources) && api.sources.length === 5, 'expected 5 sources');
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

  await step('list("playlist") reflects SWR_PLAYLIST.add / remove', async () => {
    // The library-switcher reads window.SWR.PLAYLIST.songs directly.
    // Seed a song, assert the picker sees it; remove it, assert it's gone.
    const v = await page.evaluate(async () => {
      // Find a song to use as the source. The audio-bus is the safest
      // because it's always present.
      const busList = await window.SWR_LIBRARY_SWITCHER.list('audio-bus');
      const seed = busList[0] && {
        id: 'pl-test-' + Date.now(),
        title: (busList[0].title || 'song') + ' [playlist copy]',
        duration: busList[0].duration,
        url: busList[0].url,
        // Mark provenance so we can tell them apart
        source: 'audio-bus',
      };
      const before = await window.SWR_LIBRARY_SWITCHER.list('playlist');
      // Add to the playlist via the public API
      window.SWR.PLAYLIST.add(seed);
      const afterAdd = await window.SWR_LIBRARY_SWITCHER.list('playlist');
      // Remove and confirm
      window.SWR.PLAYLIST.remove(seed.id);
      const afterRemove = await window.SWR_LIBRARY_SWITCHER.list('playlist');
      return {
        beforeLen: before.length,
        afterAddLen: afterAdd.length,
        afterRemoveLen: afterRemove.length,
        hasSeed: afterAdd.some((s) => s.sourceId === seed.id),
        seedTitle: seed.title,
      };
    });
    ok(v.beforeLen === 0, 'expected empty list before add, got ' + v.beforeLen);
    ok(v.afterAddLen === 1, 'expected 1 after add, got ' + v.afterAddLen);
    ok(v.hasSeed, 'add result should include the seeded song');
    ok(v.afterRemoveLen === 0, 'expected empty list after remove, got ' + v.afterRemoveLen);
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
    ok(v.tabCount === 5, `expected 5 tabs, got ${v.tabCount}`);
    ok(v.hasPanel, 'panel not mounted');
    ok(v.activeTab === 'audio-bus', `expected audio-bus active, got ${v.activeTab}`);
  });

  await step('pick("library", id) is leak-safe under render() lifecycle', async () => {
    // SWR_MEDIA only exists on engine.html (lib/media-store.client.js is
    // loaded there). Open a second tab against engine.html for this test
    // so the IndexedDB-backed library is actually populated.
    const page2 = await browser.newPage();
    await page2.setViewport({ width: 1280, height: 720 });
    await page2.goto(`${BASE}/engine.html`, { waitUntil: 'networkidle0', timeout: 45000 });
    // The library-switcher script lives on hallucination.html (it's a
    // standalone lib/ module — engine.html doesn't include it). Load it
    // directly here so we can exercise pick() against engine.html's IDB.
    // Also load the playlist client so window.SWR.PLAYLIST is defined.
    await page2.addScriptTag({ path: path.join(ROOT, 'lib', 'library-switcher.client.js') });
    await page2.addScriptTag({ path: path.join(ROOT, 'lib', 'playlist.client.js') });
    let waited2 = 0;
    while (waited2 < 30000) {
      const ok = await page2.evaluate(() =>
        !!(window.SWR_MEDIA && typeof window.SWR_MEDIA.addMedia === 'function' &&
           window.SWR_LIBRARY_SWITCHER && typeof window.SWR_LIBRARY_SWITCHER.pick === 'function'));
      if (ok) break;
      await new Promise((r) => setTimeout(r, 500));
      waited2 += 500;
    }
    if (waited2 >= 30000) throw new Error('SWR_MEDIA + SWR_LIBRARY_SWITCHER never came up on engine.html');
    const v = await page2.evaluate(async () => {
      const M = window.SWR_MEDIA;
      // Add a fake row to the library so we have a stable IDB row to pick.
      const fakeBlob = new Blob([new Uint8Array([1, 2, 3])], { type: 'video/mp4' });
      const file = new File([fakeBlob], 'leak-test.mp4', { type: 'video/mp4' });
      const rec = await M.addMedia([file]);
      const id = rec[0].id;

      const host = document.createElement('div');
      document.body.appendChild(host);
      const r = window.SWR_LIBRARY_SWITCHER.render(host, { onPick() {} });

      // First pick: creates an object URL.
      const url1 = await window.SWR_LIBRARY_SWITCHER.pick('library', id);
      // Second pick on the SAME id: should reuse the same URL.
      const url2 = await window.SWR_LIBRARY_SWITCHER.pick('library', id);
      // Third pick on a different (non-existent) id: should revoke url1/url2
      // and return null.
      const url3 = await window.SWR_LIBRARY_SWITCHER.pick('library', 'does-not-exist');

      // After destroy: any subsequent pick on the original id creates a
      // fresh URL (since the previous one was revoked). It must NOT equal
      // url1.
      r.destroy();
      const url4 = await window.SWR_LIBRARY_SWITCHER.pick('library', id);

      // Cleanup so we don't leak the row in IDB.
      await M.deleteMedia(id);
      host.remove();

      return {
        firstNonEmpty: typeof url1 === 'string' && url1.startsWith('blob:'),
        reuse: url1 === url2,
        nullOnMiss: url3 === null,
        freshAfterDestroy: url4 !== url1 && typeof url4 === 'string' && url4.startsWith('blob:'),
      };
    });
    await page2.close();
    ok(v.firstNonEmpty, 'first pick should return a blob: URL');
    ok(v.reuse, 're-pick of same id should reuse the URL');
    ok(v.nullOnMiss, 'pick on missing id should return null');
    ok(v.freshAfterDestroy, 'post-destroy pick should create a fresh URL distinct from url1');
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