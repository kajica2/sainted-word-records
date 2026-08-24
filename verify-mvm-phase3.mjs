// verify-mvm-phase3.mjs — smoke test for MVM Phase 3 (drag reorder + resize).
//
//   BASE_URL=https://sainted-word-records-kai-djurics-projects.vercel.app \
//     node verify-mvm-phase3.mjs
//
// Asserts:
//   1. window.MVM.reorderTimeline exists and reorders + reassigns startMs
//   2. window.MVM.resizeTimelineRow exists and resizes a row
//   3. Resize clamps to next row's startMs (no overlap)
//   4. Every timeline row has draggable="true" + a .mvm-tl-grip child

import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import puppeteer from 'puppeteer';

const BASE = process.env.BASE_URL || 'http://localhost:5174';
const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PORT = 8086;

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

const RED_PNG_1x1 = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='), (c) => c.charCodeAt(0));

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

  // Reset state
  await page.evaluate(() => {
    try { localStorage.removeItem('swr.mvm.project'); } catch (_) {}
  });
  await page.reload({ waitUntil: 'networkidle0' });
  await page.waitForFunction(() => !!window.MVM, { timeout: 20000, polling: 500 });

  // Seed 3 clips with long enough durationMs so we have room to resize.
  await page.evaluate(async () => {
    const RED_PNG_1x1 = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='), (c) => c.charCodeAt(0));
    const blob = new Blob([RED_PNG_1x1], { type: 'image/png' });
    const files = ['a.png', 'b.png', 'c.png'].map((n) =>
      new File([blob], n, { type: 'image/png' }));
    window.MVM.project.clips = []; // start clean
    for (const f of files) {
      const c = await window.MVM.addClip(f);
      c.durationMs = 5000; // 5s each so resize has headroom
    }
    window.MVM.project.timeline = [];
    for (const clip of window.MVM.project.clips) {
      window.MVM.addToTimeline(clip.id);
    }
    window.MVM.save();
  });

  await step('1. reorderTimeline exists on window.MVM', async () => {
    const v = await page.evaluate(() => ({
      has: typeof window.MVM.reorderTimeline === 'function',
      hasResize: typeof window.MVM.resizeTimelineRow === 'function',
    }));
    ok(v.has, 'reorderTimeline missing');
    ok(v.hasResize, 'resizeTimelineRow missing');
  });

  await step('2. reorderTimeline moves a row + reassigns startMs', async () => {
    const v = await page.evaluate(() => {
      // Initial: 3 rows, each 5s, contiguous starting at 0
      const before = window.MVM.project.timeline.map((t) => ({
        id: t.id, startMs: t.startMs, endMs: t.endMs, dur: t.endMs - t.startMs,
      }));
      // Move the last row to index 0
      const last = before[before.length - 1];
      window.MVM.reorderTimeline(last.id, 0);
      const after = window.MVM.project.timeline.slice().sort((a, b) => a.startMs - b.startMs);
      return {
        before,
        after: after.map((t) => ({ id: t.id, startMs: t.startMs, endMs: t.endMs, dur: t.endMs - t.startMs })),
        first: after[0].id,
      };
    });
    ok(v.first === v.before[2].id, 'last row should be first after reorder');
    // Contiguity: no row should have a gap before it
    let prev = 0;
    for (const t of v.after) {
      ok(t.startMs === prev, `row should start at ${prev}, got ${t.startMs}`);
      ok(t.dur === 5000, `duration should be preserved (5000), got ${t.dur}`);
      prev = t.endMs;
    }
  });

  await step('3. resizeTimelineRow extends a row + pushes next rows', async () => {
    const v = await page.evaluate(() => {
      const sorted = window.MVM.project.timeline.slice().sort((a, b) => a.startMs - b.startMs);
      const first = sorted[0];
      const before = {
        firstStart: first.startMs, firstEnd: first.endMs,
        secondStart: sorted[1].startMs, secondEnd: sorted[1].endMs,
      };
      // Resize first to be 7s long. originalDuration caps the row's
      // max extension at the full clip length — pass 10000 to allow 7s.
      window.MVM.resizeTimelineRow(first.id, first.startMs + 7000, 10000);
      const sortedAfter = window.MVM.project.timeline.slice().sort((a, b) => a.startMs - b.startMs);
      return {
        before,
        firstStart: sortedAfter[0].startMs,
        firstEnd: sortedAfter[0].endMs,
        firstDur: sortedAfter[0].endMs - sortedAfter[0].startMs,
        secondStart: sortedAfter[1].startMs,
        secondEnd: sortedAfter[1].endMs,
        secondDur: sortedAfter[1].endMs - sortedAfter[1].startMs,
      };
    });
    ok(v.firstStart === 0, `first row should start at 0, got ${v.firstStart}`);
    ok(v.firstDur === 7000, `first row should be 7000ms, got ${v.firstDur}`);
    ok(v.secondStart === 7000, `second row should start at 7000 (pushed), got ${v.secondStart}`);
    ok(v.secondDur === 5000, `second row duration preserved (5000), got ${v.secondDur}`);
  });

  await step('4. resizeTimelineRow pushes the next row forward (no clamp)', async () => {
    // The new design: resize extends the row, and the next row shifts
    // forward by the same delta. The first row's endMs should be exactly
    // equal to the second row's new startMs (contiguous, no gap, no overlap).
    const v = await page.evaluate(() => {
      const sorted = window.MVM.project.timeline.slice().sort((a, b) => a.startMs - b.startMs);
      const first = sorted[0];
      const second = sorted[1];
      const beforeFirstEnd = first.endMs;
      const beforeSecondStart = second.startMs;
      // Resize first to 99999ms. The clamp caps at originalDuration = 10000,
      // so first.endMs becomes first.startMs + 10000. The second row's
      // startMs shifts to the new first.endMs.
      window.MVM.resizeTimelineRow(first.id, 99999, 10000);
      const sortedAfter = window.MVM.project.timeline.slice().sort((a, b) => a.startMs - b.startMs);
      return {
        beforeFirstEnd, beforeSecondStart,
        firstEnd: sortedAfter[0].endMs,
        secondStart: sortedAfter[1].startMs,
        secondDur: sortedAfter[1].endMs - sortedAfter[1].startMs,
      };
    });
    ok(v.firstEnd === v.secondStart, `firstEnd should equal secondStart (contiguous); got ${v.firstEnd} vs ${v.secondStart}`);
    ok(v.firstEnd - v.beforeFirstEnd === v.secondStart - v.beforeSecondStart, 'delta should be consistent');
    ok(v.secondDur === 5000, 'second row duration should be preserved (5000)');
  });

  await step('5. every timeline row has draggable="true" + a .mvm-tl-grip child', async () => {
    const v = await page.evaluate(() => {
      const rows = document.querySelectorAll('#timeline-list .mvm-timeline-row');
      let allDraggable = true;
      let allHaveGrip = true;
      for (const r of rows) {
        if (r.getAttribute('draggable') !== 'true') allDraggable = false;
        if (!r.querySelector('.mvm-tl-grip')) allHaveGrip = false;
      }
      return { rowCount: rows.length, allDraggable, allHaveGrip };
    });
    ok(v.rowCount === 3, `expected 3 rows, got ${v.rowCount}`);
    ok(v.allDraggable, 'all rows must be draggable');
    ok(v.allHaveGrip, 'all rows must have a .mvm-tl-grip child');
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