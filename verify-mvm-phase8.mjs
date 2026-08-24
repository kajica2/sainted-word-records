// verify-mvm-phase8.mjs — smoke for MVM Phase 8 (recording countdown + REC safety).
//
//   BASE_URL=http://localhost:5174 node verify-mvm-phase8.mjs
//
// Asserts:
//   1. During recording, foot-meta shows 'REC 0:00' (or higher) and updates
//   2. When auto-stop is set, foot-meta shows 'REC 0:00 / 0:30'
//   3. First click of STOP REC does NOT stop; sets pending-stop
//   4. Second click within 1.5s of the first DOES stop
//   5. ESC stops the recording (bypasses two-click safety)
//   6. After stop, the elapsed timer is cleared and foot-meta is '—'

import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import puppeteer from 'puppeteer';

const BASE = process.env.BASE_URL || 'http://localhost:5174';
const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PORT = 8080;

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

  // Seed a clip with long duration so we have headroom to test recording.
  await page.evaluate(async () => {
    const RED_PNG = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='), (c) => c.charCodeAt(0));
    const blob = new Blob([RED_PNG], { type: 'image/png' });
    const file = new File([blob], 'rec.png', { type: 'image/png' });
    const c = await window.MVM.addClip(file);
    window.MVM.addToTimeline(c.id);
    window.MVM.project.clips[0].durationMs = 60000;
    const tl = window.MVM.project.timeline[0];
    tl.endMs = tl.startMs + 60000;
  });

  await step('1. foot-meta shows REC 0:00 immediately after start', async () => {
    const v = await page.evaluate(() => {
      const sel = document.getElementById('rec-dur');
      sel.value = '0'; // manual mode
      // Start recording
      const recBtn = document.getElementById('rec');
      recBtn.click();
      return {
        recording: window.MVM.Recorder.recording,
        meta: document.getElementById('foot-meta').textContent,
      };
    });
    ok(v.recording, 'recorder should be recording');
    ok(/^REC 0:0\d/.test(v.meta), `foot-meta should start at REC 0:00-ish, got "${v.meta}"`);
  });

  await step('2. foot-meta updates after 1.2s of recording', async () => {
    const v = await page.evaluate(async () => {
      await new Promise((r) => setTimeout(r, 1200));
      return document.getElementById('foot-meta').textContent;
    });
    // After 1.2s, the counter should read 0:01 (or 0:02 if the interval
    // started late). Anything starting with "REC 0:0" is acceptable
    // since the test depends on system timer accuracy.
    ok(/^REC 0:0[1-9]/.test(v), `foot-meta should show REC 0:01+, got "${v}"`);
  });

  await step('3. with auto-stop, foot-meta shows "REC 0:0X / 0:30"', async () => {
    // Stop the current recording
    await page.evaluate(() => window.MVM.Recorder.stop());
    await new Promise((r) => setTimeout(r, 50));
    const v = await page.evaluate(() => {
      const sel = document.getElementById('rec-dur');
      sel.value = '30'; // 30s auto-stop
      const recBtn = document.getElementById('rec');
      recBtn.click();
      return {
        meta: document.getElementById('foot-meta').textContent,
        hasTotal: / \/ 0:30$/.test(document.getElementById('foot-meta').textContent),
        autoStopAt: window.MVM.Recorder.autoStopAt,
        recording: window.MVM.Recorder.recording,
      };
    });
    ok(v.recording, 'recording should have started');
    ok(v.autoStopAt > 0, 'autoStopAt should be set');
    ok(v.hasTotal, `foot-meta should include "/ 0:30", got "${v.meta}"`);
  });

  await step('4. first click of STOP REC does NOT stop; sets pending-stop', async () => {
    // We're still recording from step 3. Click the REC button once.
    const v = await page.evaluate(() => {
      const recBtn = document.getElementById('rec');
      recBtn.click();
      return {
        stillRecording: window.MVM.Recorder.recording,
        pendingAt: window.MVM.Recorder._pendingStopAt,
        hasPendingClass: recBtn.classList.contains('mvm-pending-stop'),
      };
    });
    ok(v.stillRecording, 'first click should NOT stop');
    ok(v.pendingAt > 0, 'pending-stop should be set');
    ok(v.hasPendingClass, 'REC button should have pending-stop class');
  });

  await step('5. second click within 1.5s DOES stop', async () => {
    const v = await page.evaluate(() => {
      const recBtn = document.getElementById('rec');
      recBtn.click();
      return {
        recording: window.MVM.Recorder.recording,
        pendingAt: window.MVM.Recorder._pendingStopAt,
      };
    });
    ok(!v.recording, 'second click should stop');
    ok(v.pendingAt === 0, 'pending-stop should be cleared');
  });

  await step('6. foot-meta resets to "—" after stop', async () => {
    await new Promise((r) => setTimeout(r, 100)); // let the next _tickElapsed cycle
    const v = await page.evaluate(() => {
      return document.getElementById('foot-meta').textContent;
    });
    // After stop, the elapsed timer is cleared. The next _tickElapsed
    // call doesn't fire (interval was cleared), and stop() resets the
    // text to "—". Allow 0:00 → '—' transition.
    ok(v === '—' || v === '0:00', `foot-meta should reset to "—" or "0:00", got "${v}"`);
  });

  await step('7. ESC stops the recording (bypasses two-click safety)', async () => {
    const v = await page.evaluate(() => {
      const recBtn = document.getElementById('rec');
      recBtn.click(); // start
      const recordingAfterStart = window.MVM.Recorder.recording;
      // Dispatch a real keydown event with Escape
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      return {
        recordingAfterStart,
        recordingAfterEsc: window.MVM.Recorder.recording,
      };
    });
    ok(v.recordingAfterStart, 'should be recording after start');
    ok(!v.recordingAfterEsc, 'ESC should stop the recording');
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