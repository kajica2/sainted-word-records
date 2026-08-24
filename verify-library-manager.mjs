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

  await step('SWR.PLAYLIST.songs = […] triggers hydrate event (3rd-party writer)', async () => {
    // Plan risk #2: external code writing through the proxy-mirrored songs
    // setter should fire subscribers with reason='hydrate'. Also proves
    // the persistence still round-trips through localStorage when set via
    // the setter path (not just add()).
    const r = await page.evaluate(async () => {
      const P = window.SWR_PLAYLIST;
      P.clear();
      const seen = [];
      const off = P.subscribe((list, reason) => seen.push({ reason, n: list.length }));
      window.SWR.PLAYLIST.songs = [{ id: 'ext-1', title: 'External One' }, { id: 'ext-2', title: 'External Two' }];
      // Clear subscribers list and re-check persistence.
      const finalList = P.list();
      off();
      return { seen, finalLen: finalList.length, firstTitle: finalList[0] && finalList[0].title };
    });
    ok(r.seen.length === 1, `expected 1 hydrate event from the setter, got ${r.seen.length}`);
    ok(r.seen[0].reason === 'hydrate', `expected reason 'hydrate', got '${r.seen[0].reason}'`);
    ok(r.finalLen === 2, `expected 2 rows after assignment, got ${r.finalLen}`);
    ok(r.firstTitle === 'External One', `expected first row 'External One', got '${r.firstTitle}'`);
    // Persistence should also have caught the assignment (localStorage write).
    const stored = await page.evaluate(() => {
      try { return JSON.parse(localStorage.getItem('swr.playlist.v1')); } catch { return null; }
    });
    ok(Array.isArray(stored) && stored.length === 2, `expected localStorage to hold 2 rows, got ${stored && stored.length}`);
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

  // ==================================================================
  // MANAGER FEATURE TESTS  (Tasks 5-12)
  //
  // We use setData() to inject rows directly (instead of seeding IndexedDB
  // via fake File blobs) and exercise each control. Rows keep the UnifiedSong
  // shape so the manager treats them the same as IDB-sourced rows.
  // ==================================================================

  await gate('search box filters rows by title/artist (Task 5)', managerReady, async () => {
    const r = await page.evaluate(async () => {
      const host = document.createElement('div');
      document.body.appendChild(host);
      const api = window.SWR_LIBRARY_MANAGER.render(host, {});
      api.setData([
        { id: 'a', source: 'library', sourceId: 'a', title: 'Coltrane Like Sonny', artist: 'Sonny',  duration: 200 },
        { id: 'b', source: 'library', sourceId: 'b', title: 'Giant Steps',         artist: 'Coltrane', duration: 300 },
        { id: 'c', source: 'library', sourceId: 'c', title: 'So What',             artist: 'Miles', duration: 540 },
      ]);
      const inp = host.querySelector('.lmp-search');
      const fireInput = (v) => { inp.value = v; inp.dispatchEvent(new Event('input')); };
      fireInput('coltrane');
      const c1 = host.querySelectorAll('.lmp-row').length;
      fireInput('so what');
      const c2 = host.querySelectorAll('.lmp-row').length;
      fireInput('nope');
      const c3 = host.querySelectorAll('.lmp-row').length;
      const emptyText = (host.querySelector('.lmp-empty') || {}).textContent || '';
      fireInput('');
      const c4 = host.querySelectorAll('.lmp-row').length;
      api.destroy(); host.remove();
      return { c1, c2, c3, emptyText, c4 };
    });
    ok(r.c1 === 2, `search "coltrane" should match 2 rows, got ${r.c1}`);
    ok(r.c2 === 1, `search "so what" should match 1 row, got ${r.c2}`);
    ok(r.c3 === 0, `search "nope" should match 0 rows, got ${r.c3}`);
    ok(/No songs match/i.test(r.emptyText), `expected empty-state copy, got "${r.emptyText}"`);
    ok(r.c4 === 3, 'clearing search should restore all 3');
  });

  await gate('sort dropdown reorders by title/artist/date (Task 6)', managerReady, async () => {
    const r = await page.evaluate(async () => {
      const host = document.createElement('div');
      document.body.appendChild(host);
      const api = window.SWR_LIBRARY_MANAGER.render(host, {});
      api.setData([
        { id: 't', source: 'library', sourceId: 't', title: 'Banana', artist: 'Zelda', createdAt: 100 },
        { id: 'a', source: 'library', sourceId: 'a', title: 'Apple',  artist: 'Mario', createdAt: 300 },
        { id: 'm', source: 'library', sourceId: 'm', title: 'Mango',  artist: 'Yoshi', createdAt: 200 },
      ]);
      const sel = host.querySelector('.lmp-sort');
      const fire = (v) => { sel.value = v; sel.dispatchEvent(new Event('change')); };
      const titles = () => Array.from(host.querySelectorAll('.lmp-row .lmp-title')).map(n => n.textContent);
      fire('title'); const titlesAZ = titles();
      fire('artist'); const titlesByArtist = titles();
      fire('date');   const titlesByDate = titles();
      api.destroy(); host.remove();
      return { titlesAZ, titlesByArtist, titlesByDate };
    });
    ok(JSON.stringify(r.titlesAZ) === JSON.stringify(['Apple','Banana','Mango']), `title sort: ${r.titlesAZ}`);
    // artist sort: Mario→Yoshi→Zelda, with title as tiebreaker (Apple, Mango, Banana)
    ok(JSON.stringify(r.titlesByArtist) === JSON.stringify(['Apple','Mango','Banana']), `artist sort: ${r.titlesByArtist}`);
    // date sort: newest first by createdAt → Apple(300), Mango(200), Banana(100)
    ok(JSON.stringify(r.titlesByDate) === JSON.stringify(['Apple','Mango','Banana']), `date sort: ${r.titlesByDate}`);
  });

  await gate('multi-select checkboxes + Select All (Task 7)', managerReady, async () => {
    const r = await page.evaluate(async () => {
      const host = document.createElement('div');
      document.body.appendChild(host);
      const api = window.SWR_LIBRARY_MANAGER.render(host, {});
      api.setData([
        { id: '1', source: 'library', sourceId: '1', title: 'One' },
        { id: '2', source: 'library', sourceId: '2', title: 'Two' },
        { id: '3', source: 'library', sourceId: '3', title: 'Three' },
      ]);
      const checks = () => Array.from(host.querySelectorAll('.lmp-check'));
      const counter = () => (host.querySelector('.lmp-counter') || {}).textContent || '';
      checks()[0].click();
      checks()[2].click();
      const after2 = counter();
      const sa = host.querySelector('.lmp-select-all');
      sa.click();
      const afterAll = counter();
      const saText = sa.textContent;
      sa.click(); // toggle off
      const afterNone = counter();
      const saTextBack = sa.textContent;
      api.destroy(); host.remove();
      return { after2, afterAll, saText, afterNone, saTextBack };
    });
    ok(/2 selected/.test(r.after2), `expected 2 selected, got "${r.after2}"`);
    ok(/3 selected/.test(r.afterAll), `expected 3 selected, got "${r.afterAll}"`);
    ok(/deselect all/i.test(r.saText), `select-all should toggle to "deselect all", got "${r.saText}"`);
    ok(/0 selected/.test(r.afterNone), `expected 0 selected, got "${r.afterNone}"`);
    ok(/select all/i.test(r.saTextBack), `should toggle back to "select all", got "${r.saTextBack}"`);
  });

  await gate('bulk Remove Selected deletes from SWR_MEDIA (Task 8)', managerReady, async () => {
    const r = await page.evaluate(async () => {
      const M = window.SWR_MEDIA;
      const mk = (name) => {
        const b = new Blob([new Uint8Array([1,2,3])], { type: 'video/mp4' });
        return new File([b], name, { type: 'video/mp4' });
      };
      await M.addMedia([mk('bulk-a.mp3'), mk('bulk-b.mp3')]);
      const host = document.createElement('div');
      document.body.appendChild(host);
      const api = window.SWR_LIBRARY_MANAGER.render(host, {});
      await api.refresh();
      const checks = host.querySelectorAll('.lmp-check');
      if (checks.length !== 2) {
        const remaining = await M.getUserMedia();
        await Promise.all(remaining.map(x => M.deleteMedia(x.id)));
        api.destroy(); host.remove();
        return { seeded: false, rowCount: checks.length };
      }
      checks[0].click();
      checks[1].click();
      const removeBtn = host.querySelector('.lmp-remove');
      removeBtn.click();
      // Wait for deleteMedia + refresh to land.
      await new Promise(res => setTimeout(res, 400));
      const remaining = await M.getUserMedia();
      const rowCount = host.querySelectorAll('.lmp-row').length;
      api.destroy(); host.remove();
      return { seeded: true, idbLeft: remaining.length, rowCount };
    });
    ok(r.seeded, `expected 2 rows after seeding, got ${r.rowCount}`);
    ok(r.idbLeft === 0, `expected 0 rows in IDB after remove, got ${r.idbLeft}`);
    ok(r.rowCount === 0, `expected 0 rendered rows after remove, got ${r.rowCount}`);
  });

  await gate('per-row Remove button (Task 9)', managerReady, async () => {
    const r = await page.evaluate(async () => {
      const M = window.SWR_MEDIA;
      const mk = (name) => {
        const b = new Blob([new Uint8Array([1,2,3])], { type: 'video/mp4' });
        return new File([b], name, { type: 'video/mp4' });
      };
      await M.addMedia([mk('row-a.mp3'), mk('row-b.mp3')]);
      const host = document.createElement('div');
      document.body.appendChild(host);
      const api = window.SWR_LIBRARY_MANAGER.render(host, {});
      await api.refresh();
      const rowsBefore = host.querySelectorAll('.lmp-row').length;
      const firstDel = host.querySelector('.lmp-row .lmp-row-del');
      if (!firstDel) {
        const left = await M.getUserMedia();
        await Promise.all(left.map(x => M.deleteMedia(x.id)));
        api.destroy(); host.remove();
        return { rowsBefore, rowsAfter: -1, idbLeft: left.length };
      }
      firstDel.click();
      await new Promise(res => setTimeout(res, 400));
      const rowsAfter = host.querySelectorAll('.lmp-row').length;
      const left = await M.getUserMedia();
      await Promise.all(left.map(x => M.deleteMedia(x.id)));
      api.destroy(); host.remove();
      return { rowsBefore, rowsAfter, idbLeft: left.length };
    });
    ok(r.rowsBefore === 2, `expected 2 rows, got ${r.rowsBefore}`);
    ok(r.rowsAfter === 1, `expected 1 row after per-row remove, got ${r.rowsAfter}`);
    ok(r.idbLeft === 1, `expected 1 row in IDB, got ${r.idbLeft}`);
  });

  await gate('Add Selected to Playlist pushes to SWR_PLAYLIST (Task 10)', managerReady, async () => {
    const r = await page.evaluate(async () => {
      const M = window.SWR_MEDIA;
      const P = window.SWR_PLAYLIST;
      P.clear();
      const mk = (name) => {
        const b = new Blob([new Uint8Array([1,2,3])], { type: 'video/mp4' });
        return new File([b], name, { type: 'video/mp4' });
      };
      await M.addMedia([mk('pl-a.mp3'), mk('pl-b.mp3')]);
      const host = document.createElement('div');
      document.body.appendChild(host);
      const api = window.SWR_LIBRARY_MANAGER.render(host, {});
      await api.refresh();
      const checks = host.querySelectorAll('.lmp-check');
      if (checks.length !== 2) {
        const left = await M.getUserMedia();
        await Promise.all(left.map(x => M.deleteMedia(x.id)));
        api.destroy(); host.remove();
        return { playlistLen: 0, firstTitle: '', firstSource: '', firstHasUrl: false, rowCount: checks.length };
      }
      checks[0].click();
      checks[1].click();
      const btn = host.querySelector('.lmp-add-pl');
      btn.click();
      await new Promise(res => setTimeout(res, 50));
      const plist = P.list();
      const left = await M.getUserMedia();
      await Promise.all(left.map(x => M.deleteMedia(x.id)));
      api.destroy(); host.remove();
      return {
        playlistLen: plist.length,
        firstTitle: plist[0] && plist[0].title,
        firstSource: plist[0] && plist[0].source,
        firstHasUrl: plist[0] && 'url' in plist[0],
      };
    });
    ok(r.playlistLen === 2, `expected 2 in playlist, got ${r.playlistLen}`);
    ok(/pl-[ab]\.mp3/.test(r.firstTitle || ''), `unexpected playlist row title: "${r.firstTitle}"`);
    ok(r.firstSource === 'library', `source should be 'library', got "${r.firstSource}"`);
    ok(r.firstHasUrl === false, 'playlist row should not carry a url field');
  });

  await gate('Clear Library prompts confirm + deleteAll (Task 11)', managerReady, async () => {
    const r = await page.evaluate(async () => {
      const M = window.SWR_MEDIA;
      const mk = (name) => {
        const b = new Blob([new Uint8Array([1,2,3])], { type: 'video/mp4' });
        return new File([b], name, { type: 'video/mp4' });
      };
      await M.addMedia([mk('cl-a.mp3'), mk('cl-b.mp3'), mk('cl-c.mp3')]);
      const host = document.createElement('div');
      document.body.appendChild(host);
      const api = window.SWR_LIBRARY_MANAGER.render(host, {});
      await api.refresh();
      const rowCount = host.querySelectorAll('.lmp-row').length;
      const origConfirm = window.confirm;
      let promptText = '';
      window.confirm = (m) => { promptText = m; return true; };
      const clearBtn = host.querySelector('.lmp-clear');
      if (clearBtn) clearBtn.click();
      await new Promise(res => setTimeout(res, 400));
      window.confirm = origConfirm;
      const remaining = await M.getUserMedia();
      const rowsAfter = host.querySelectorAll('.lmp-row').length;
      api.destroy(); host.remove();
      return { rowCount, promptText, idbLeft: remaining.length, rowsAfter };
    });
    ok(r.rowCount === 3, `expected 3 rows before clear, got ${r.rowCount}`);
    ok(/remove every song/i.test(r.promptText || ''), `confirm copy: "${r.promptText}"`);
    ok(r.idbLeft === 0, `expected 0 after clear, got ${r.idbLeft}`);
    ok(r.rowsAfter === 0, `expected 0 rendered rows, got ${r.rowsAfter}`);
  });

  await gate('empty-state UI hides toolbar when library is empty (Task 12)', managerReady, async () => {
    const r = await page.evaluate(async () => {
      const host = document.createElement('div');
      document.body.appendChild(host);
      const api = window.SWR_LIBRARY_MANAGER.render(host, {});
      api.setData([]); // empty library
      const emptyVisible = host.querySelector('.lmp-empty').style.display !== 'none';
      const toolbarVisible = host.querySelector('.lmp-toolbar').style.display !== 'none';
      const emptyText = host.querySelector('.lmp-empty').textContent;
      api.setData([{ id: 'x', source: 'library', sourceId: 'x', title: 'After' }]);
      const toolbarAfterVisible = host.querySelector('.lmp-toolbar').style.display !== 'none';
      const rowCount = host.querySelectorAll('.lmp-row').length;
      api.destroy(); host.remove();
      return { emptyVisible, toolbarVisible, emptyText, toolbarAfterVisible, rowCount };
    });
    ok(r.emptyVisible, 'empty placeholder should be visible when library is empty');
    ok(!r.toolbarVisible, 'toolbar should be hidden when library is empty');
    ok(/empty/i.test(r.emptyText), `empty copy: "${r.emptyText}"`);
    ok(r.toolbarAfterVisible, 'toolbar should appear after a row is added');
    ok(r.rowCount === 1, `expected 1 row, got ${r.rowCount}`);
  });

  await gate('auto-refresh on visibilitychange (Review I-2)', managerReady, async () => {
    const r = await page.evaluate(async () => {
      const M = window.SWR_MEDIA;
      await M.deleteAll().catch(() => {});
      const host = document.createElement('div');
      document.body.appendChild(host);
      const api = window.SWR_LIBRARY_MANAGER.render(host, {});
      // Wait for the render's initial load to settle (empty).
      await api.refresh();
      const rowsBefore = host.querySelectorAll('.lmp-row').length;
      // External mutator: add a row in IDB WITHOUT calling api.refresh().
      const b = new Blob([new Uint8Array([9,9,9])], { type: 'video/mp4' });
      const f = new File([b], 'vischange.mp4', { type: 'video/mp4' });
      await M.addMedia([f]);
      // Manager should still see 0 rows (it doesn't auto-poll by itself).
      const stillBefore = host.querySelectorAll('.lmp-row').length;
      // Now simulate the tab becoming visible again — the manager's
      // visibilitychange listener should fire loadFromMedia.
      Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
      document.dispatchEvent(new Event('visibilitychange'));
      await new Promise(res => setTimeout(res, 200));
      const rowsAfter = host.querySelectorAll('.lmp-row').length;
      // Cleanup.
      const leftover = await M.getUserMedia();
      await Promise.all(leftover.map(x => M.deleteMedia(x.id)));
      api.destroy(); host.remove();
      return { rowsBefore, stillBefore, rowsAfter };
    });
    ok(r.rowsBefore === 0, `should start empty, got ${r.rowsBefore}`);
    ok(r.stillBefore === 0, `should not auto-observe external writes without the visibility trigger, got ${r.stillBefore}`);
    ok(r.rowsAfter === 1, `after visibilitychange→visible should pick up the external row, got ${r.rowsAfter}`);
  });

  // ==================================================================
  // END-TO-END  (Task 15)
  //
  // Seed 3 rows → render manager → sort by artist → multi-select 2 →
  // remove 1 of them → add the remaining to playlist → reload page →
  // confirm playlist persists → cleanup.
  // ==================================================================

  await gate('end-to-end: seed → sort → select → remove → add → reload → persist', managerReady, async () => {
    const r = await page.evaluate(async () => {
      const M = window.SWR_MEDIA;
      const P = window.SWR_PLAYLIST;
      P.clear();
      await M.deleteAll().catch(() => {});
      const mk = (name, artist, createdAt) => {
        const b = new Blob([new Uint8Array([1,2,3])], { type: 'video/mp4' });
        return new File([b], name, { type: 'video/mp4', lastModified: createdAt });
      };
      await M.addMedia([
        mk('zzz.mp4', 'Ziggy', 1000),
        mk('aaa.mp4', 'Alice', 2000),
        mk('mmm.mp4', 'Marvin', 3000),
      ]);
      const host = document.createElement('div');
      document.body.appendChild(host);
      const api = window.SWR_LIBRARY_MANAGER.render(host, {});
      await api.refresh();
      const sortSel = host.querySelector('.lmp-sort');
      sortSel.value = 'artist';
      sortSel.dispatchEvent(new Event('change'));
      // After sort by artist A→Z, the visible order should be: aaa (Alice),
      // mmm (Marvin), zzz (Ziggy). Tick the first two (Alice + Marvin).
      const checks = host.querySelectorAll('.lmp-check');
      checks[0].click();
      checks[1].click();
      // Bulk remove the two selected.
      const removeBtn = host.querySelector('.lmp-remove');
      removeBtn.click();
      // After remove, ONE row remains (Ziggy).
      await new Promise(res => setTimeout(res, 500));
      const remaining = host.querySelectorAll('.lmp-row').length;
      const titlesAfterRemove = Array.from(host.querySelectorAll('.lmp-row .lmp-title')).map(n => n.textContent);
      // Tick the remaining row and add to playlist.
      const lastCheck = host.querySelector('.lmp-check');
      if (!lastCheck) {
        api.destroy(); host.remove();
        return { remaining: 0, titlesAfterRemove, playlistBeforeReload: [], playlistAfterReload: [] };
      }
      lastCheck.click();
      host.querySelector('.lmp-add-pl').click();
      await new Promise(res => setTimeout(res, 100));
      const playlistBeforeReload = P.list().map(s => ({ id: s.id, title: s.title, source: s.source }));
      api.destroy(); host.remove();
      return { remaining, titlesAfterRemove, playlistBeforeReload };
    });
    ok(r.remaining === 1, `expected 1 row after bulk remove, got ${r.remaining}`);
    ok(/zzz/i.test(r.titlesAfterRemove[0] || ''), `expected 'zzz.mp4' as the survivor, got ${r.titlesAfterRemove[0]}`);
    ok(r.playlistBeforeReload.length === 1, `expected 1 in playlist before reload, got ${r.playlistBeforeReload.length}`);
    ok(/zzz/i.test(r.playlistBeforeReload[0].title || ''), `playlist row title should be zzz.mp4, got ${r.playlistBeforeReload[0].title}`);
    ok(r.playlistBeforeReload[0].source === 'library', `playlist source should be library, got ${r.playlistBeforeReload[0].source}`);

    // Now reload and confirm the playlist is still there.
    await page.reload({ waitUntil: 'networkidle0' });
    await page.addScriptTag({ path: joinPath(ROOT, 'lib', 'playlist.client.js') });
    if (managerReady) {
      await page.addScriptTag({ path: joinPath(ROOT, 'lib', 'library-manager.client.js') });
    }
    const persisted = await page.evaluate(() => {
      const list = window.SWR_PLAYLIST.list();
      return { n: list.length, first: list[0] && list[0].title, firstSource: list[0] && list[0].source };
    });
    ok(persisted.n === 1, `expected 1 playlist row after reload, got ${persisted.n}`);
    ok(/zzz/i.test(persisted.first || ''), `expected 'zzz.mp4' to persist in playlist, got ${persisted.first}`);
    ok(persisted.firstSource === 'library', `source should remain library, got ${persisted.firstSource}`);

    // Cleanup: nuke IDB + playlist.
    await page.evaluate(async () => {
      const M = window.SWR_MEDIA;
      window.SWR_PLAYLIST.clear();
      await M.deleteAll().catch(() => {});
    });
  });

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
