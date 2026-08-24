#!/usr/bin/env node
// verify-library-manager.mjs — smoke test for the Library Manager.
//
//   BASE_URL=http://localhost:5174 node verify-library-manager.mjs
//
// Asserts (added incrementally as tasks ship):
//   - Playlist contract:    add/list/remove/clear + persistence across reload
//                           + subscribe/unsubscribe.
//   - Manager render shell: SWR_LIBRARY_MANAGER.render() mounts into a target
//                           and exposes { refresh, destroy }.
//   - Search/sort/select:   row count responds to controls.
//   - Bulk operations:      remove selected; add selected to playlist.
//   - End-to-end:           seed → sort → select → remove → add → reload →
//                           playlist persists.
//
// Pattern follows verify-library-switcher.mjs: local static server over the
// project root, Puppeteer in headless: 'new'.

import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import puppeteer from 'puppeteer';

const BASE = process.env.BASE_URL || 'http://localhost:5174';
const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PORT = 8090;

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
let pending = 0;
async function step(name, fn) {
  if (!fn) { pending += 1; process.stdout.write(`  - ${name} [pending]\n`); return; }
  try { await fn(); process.stdout.write(`  \u2713 ${name}\n`); }
  catch (e) { failed += 1; process.stderr.write(`  \u2717 ${name}\n    ${e.stack || e.message}\n`); }
}
const ok = (cond, msg) => { if (!cond) throw new Error(msg || 'assertion failed'); };

// Pendable: a step gets a `ready` boolean from a setup call; if false, we
// skip the step rather than fail. Lets us land tasks incrementally without
// breaking the runner.
async function gate(name, ready, fn) {
  if (!ready) { pending += 1; process.stdout.write(`  - ${name} [pending]\n`); return; }
  return step(name, fn);
}
function joinPath(...p) { return p.join(path.sep); }

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
  await page.goto(`${BASE}/make-video.html`, { waitUntil: 'networkidle0', timeout: 45000 });

  // Load the playlist + manager scripts directly into make-video.html's
  // context (verification harness only — make-video.html itself ships them
  // via <script src> tags once T13 commits).
  await page.addScriptTag({ path: joinPath(ROOT, 'lib', 'playlist.client.js') });
  await page.addScriptTag({ path: joinPath(ROOT, 'lib', 'media-store.client.js') });
  await page.addScriptTag({ path: joinPath(ROOT, 'lib', 'library-switcher.client.js') });
  // Manager script may not exist yet — gate all manager steps on its presence.
  const managerSrc = joinPath(ROOT, 'lib', 'library-manager.client.js');
  const managerReady = fs.existsSync(managerSrc);
  if (managerReady) {
    await page.addScriptTag({ path: managerSrc });
  }

  // Wait for playlist to come up (always shipped).
  let waited = 0;
  while (waited < 15000) {
    const ready = await page.evaluate(() => !!window.SWR_PLAYLIST);
    if (ready) break;
    await new Promise((r) => setTimeout(r, 200));
    waited += 200;
  }
  if (waited >= 15000) throw new Error('playlist never came up');

  // ==================================================================
  // PLAYLIST CONTRACT  (Tasks 2)
  // ==================================================================

  await step('SWR_PLAYLIST.add/list/remove/clear work in memory', async () => {
    const r = await page.evaluate(() => {
      const P = window.SWR_PLAYLIST;
      const len0 = P.list().length;
      P.clear();
      P.add({ id: 'a', title: 'A' });
      P.add({ id: 'b', title: 'B' });
      const dupLen = P.list().length;
      P.add({ id: 'a', title: 'A again' }); // dedupe
      const dupStill = P.list().length;
      const removed = P.remove('a');
      const finalList = P.list();
      const finalLen = finalList.length;
      const swr = window.SWR && window.SWR.PLAYLIST && window.SWR.PLAYLIST.list();
      return { len0, dupLen, dupStill, removed, finalLen, swrLen: swr.length };
    });
    ok(r.dupLen === 2, `expected 2 after add a+b, got ${r.dupLen}`);
    ok(r.dupStill === 2, 'duplicate add should be a no-op');
    ok(r.removed === true, 'remove should return true');
    ok(r.finalLen === 1, `expected 1 after remove a, got ${r.finalLen}`);
    ok(r.swrLen === 1, 'SW.PLAYLIST should mirror SWR_PLAYLIST (same list)');
  });

  await step('playlist persists across page reload', async () => {
    await page.evaluate(() => {
      const P = window.SWR_PLAYLIST;
      P.clear();
      P.add({ id: 'persist-1', title: 'Persist One' });
    });
    await page.reload({ waitUntil: 'networkidle0' });
    await page.addScriptTag({ path: joinPath(ROOT, 'lib', 'playlist.client.js') });
    if (managerReady) {
      await page.addScriptTag({ path: joinPath(ROOT, 'lib', 'library-manager.client.js') });
    }
    const r = await page.evaluate(() => {
      const list = window.SWR_PLAYLIST.list();
      return { n: list.length, first: list[0] && list[0].title };
    });
    ok(r.n === 1, `expected 1 row after reload, got ${r.n}`);
    ok(r.first === 'Persist One', `expected 'Persist One', got ${r.first}`);
  });

  await step('playlist subscribe fires on add/remove/clear', async () => {
    const r = await page.evaluate(async () => {
      const P = window.SWR_PLAYLIST;
      P.clear();
      const seen = [];
      const off = P.subscribe((list, reason) => seen.push({ n: list.length, reason }));
      P.add({ id: 'sub-1', title: 'Sub One' });
      P.add({ id: 'sub-2', title: 'Sub Two' });
      P.remove('sub-1');
      P.clear();
      off();
      P.add({ id: 'sub-3', title: 'Sub Three (ignored by unsubbed)' });
      return { seen, finalN: P.list().length };
    });
    ok(r.seen.length === 4, `expected 4 events, got ${r.seen.length}`);
    ok(r.seen[0].reason === 'add' && r.seen[1].reason === 'add', 'first two events should be add');
    ok(r.seen[2].reason === 'remove', 'third event should be remove');
    ok(r.seen[3].reason === 'clear', 'fourth event should be clear');
    ok(r.finalN === 1, 'post-unsubscribe add should not have been emitted to seen');
  });

  // ==================================================================
  // MANAGER RENDER SHELL  (Task 4)
  // ==================================================================

  await gate('SWR_LIBRARY_MANAGER.render() mounts and exposes API', managerReady, async () => {
    const r = await page.evaluate(() => {
      const host = document.createElement('div');
      document.body.appendChild(host);
      const api = window.SWR_LIBRARY_MANAGER.render(host, { onAddToPlaylist() {}, onRemove() {} });
      const result = {
        hasApi: !!api,
        hasRefresh: typeof api.refresh === 'function',
        hasDestroy: typeof api.destroy === 'function',
        tabs: host.querySelectorAll('.lmp-tab').length,
        toolbar: !!host.querySelector('.lmp-toolbar'),
      };
      api.destroy();
      host.remove();
      return result;
    });
    ok(r.hasApi && r.hasRefresh && r.hasDestroy, 'manager API missing');
    ok(r.tabs >= 1, `expected at least 1 tab, got ${r.tabs}`);
  });

  // (subsequent tasks will append their gate() blocks here.)

  if (errors.length) {
    process.stderr.write('Console errors during run:\n');
    errors.forEach((e) => process.stderr.write('  ' + e + '\n'));
  }
} finally {
  if (browser) await browser.close();
  server.close();
}

if (failed === 0 && pending === 0) {
  console.log('\nALL GREEN');
  process.exit(0);
} else if (failed === 0) {
  console.log(`\nPENDING ${pending} (tasks not yet shipped — expected)`);
  process.exit(0);
} else {
  console.log(`\n${failed} FAILED`);
  process.exit(1);
}
