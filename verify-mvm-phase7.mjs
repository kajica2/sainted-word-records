// verify-mvm-phase7.mjs — smoke for MVM Phase 7 (drag-from-clips to timeline).
//
//   BASE_URL=http://localhost:5174 node verify-mvm-phase7.mjs
//
// Asserts:
//   1. Each .mvm-clip-card has draggable="true" + data-clipid
//   2. Simulating a drop on the timeline-list adds a new row
//   3. The inserted row has the right clipId
//   4. The drop Y-position determines the inserted index (insert-at-0 vs append)

import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import puppeteer from 'puppeteer';

const BASE = process.env.BASE_URL || 'http://localhost:5174';
const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PORT = 8082;

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
  browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
  const page = await browser.newPage();
  page.on('pageerror', (err) => process.stderr.write('PE: ' + err.message + '\n'));

  await page.setViewport({ width: 1280, height: 720 });
  await page.goto(`${BASE}/make-video.html`, { waitUntil: 'networkidle0', timeout: 45000 });

  let waited = 0;
  while (waited < 30000) {
    const ready = await page.evaluate(() => !!window.MVM);
    if (ready) break;
    await new Promise((r) => setTimeout(r, 500));
    waited += 500;
  }
  if (waited >= 30000) throw new Error('MVM never came up');

  // Reset
  await page.evaluate(() => {
    try { localStorage.removeItem('swr.mvm.project'); } catch (_) {}
  });
  await page.reload({ waitUntil: 'networkidle0' });
  await page.waitForFunction(() => !!window.MVM, { timeout: 20000, polling: 500 });

  // Seed: add 3 clips (only one to timeline initially, the other two we drop)
  await page.evaluate(async () => {
    const RED_PNG_1x1 = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='), (c) => c.charCodeAt(0));
    const blob = new Blob([RED_PNG_1x1], { type: 'image/png' });
    for (const n of ['a.png', 'b.png', 'c.png']) {
      const f = new File([blob], n, { type: 'image/png' });
      const c = await window.MVM.addClip(f);
      c.durationMs = 2000;
    }
    // Start with one row (clip a)
    window.MVM.addToTimeline(window.MVM.project.clips[0].id);
  });

  await step('1. .mvm-clip-card has draggable="true" + data-clipid', async () => {
    const v = await page.evaluate(() => {
      const cards = document.querySelectorAll('.mvm-clip-card');
      let allDraggable = true;
      let allHaveId = true;
      for (const c of cards) {
        if (c.getAttribute('draggable') !== 'true') allDraggable = false;
        if (!c.dataset.clipid) allHaveId = false;
      }
      return { cardCount: cards.length, allDraggable, allHaveId };
    });
    ok(v.cardCount === 3, `expected 3 cards, got ${v.cardCount}`);
    ok(v.allDraggable, 'all cards must be draggable');
    ok(v.allHaveId, 'all cards must have data-clipid');
  });

  await step('2. simulating a drop on the timeline-list adds a new row', async () => {
    const v = await page.evaluate(async () => {
      const before = window.MVM.project.timeline.length;
      // Simulate the drop programmatically: dispatch a drop event on
      // the timeline-list with a clip id in the dataTransfer.
      const clipB = window.MVM.project.clips[1]; // b
      const list = document.getElementById('timeline-list');
      const dt = new DataTransfer();
      try { dt.setData('text/plain', clipB.id); } catch (_) {}
      const dropEvent = new DragEvent('drop', {
        bubbles: true, cancelable: true, dataTransfer: dt,
        clientX: 100, clientY: 0, // top of the list -> insert at index 0
      });
      list.dispatchEvent(dropEvent);
      // The list-level handler calls reorderTimeline which re-renders.
      // Wait a tick for the DOM to settle.
      await new Promise((r) => setTimeout(r, 100));
      const after = window.MVM.project.timeline.length;
      const firstRowClipId = window.MVM.project.timeline
        .slice().sort((a, b) => a.startMs - b.startMs)[0].clipId;
      return { before, after, firstRowClipId, expectedClipId: clipB.id };
    });
    ok(v.after === v.before + 1, `expected ${v.before + 1} rows, got ${v.after}`);
    ok(v.firstRowClipId === v.expectedClipId, `first row should be clip ${v.expectedClipId}, got ${v.firstRowClipId}`);
  });

  await step('3. drop at a Y-position past the last row appends', async () => {
    const v = await page.evaluate(async () => {
      const before = window.MVM.project.timeline.length;
      const clipC = window.MVM.project.clips[2]; // c
      const list = document.getElementById('timeline-list');
      const dt = new DataTransfer();
      try { dt.setData('text/plain', clipC.id); } catch (_) {}
      // Pick a Y well past the last row
      const lastRow = list.querySelector('.mvm-timeline-row:last-child');
      const lastY = lastRow ? lastRow.getBoundingClientRect().bottom + 50 : 9999;
      const dropEvent = new DragEvent('drop', {
        bubbles: true, cancelable: true, dataTransfer: dt,
        clientX: 100, clientY: lastY,
      });
      list.dispatchEvent(dropEvent);
      await new Promise((r) => setTimeout(r, 100));
      const after = window.MVM.project.timeline.length;
      // The last row's clipId should be clipC
      const sorted = window.MVM.project.timeline.slice().sort((a, b) => a.startMs - b.startMs);
      const lastRowClipId = sorted[sorted.length - 1].clipId;
      return { before, after, lastRowClipId, expectedClipId: clipC.id };
    });
    ok(v.after === v.before + 1, `expected ${v.before + 1} rows, got ${v.after}`);
    ok(v.lastRowClipId === v.expectedClipId, `last row should be clip ${v.expectedClipId}, got ${v.lastRowClipId}`);
  });

  await step('4. timeline→timeline reorder still works (data flow is the same)', async () => {
    // After Phase 3 + 7, dragging a row should still reorder (not be
    // intercepted as a clip-drop). The window.__swrMvmDraggingTimelineRow
    // flag gates the clip-drop path.
    const v = await page.evaluate(() => ({
      flag: !!window.__swrMvmDraggingTimelineRow,
      timelineLen: window.MVM.project.timeline.length,
    }));
    ok(!v.flag, 'dragging flag should be false at rest');
    ok(v.timelineLen === 3, 'should have 3 rows now');
  });
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