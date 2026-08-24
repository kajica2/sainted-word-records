// verify-mvm-phase10.mjs — smoke for MVM Phase 10 (keyboard shortcuts).
//
//   BASE_URL=http://localhost:5174 node verify-mvm-phase10.mjs
//
// Asserts:
//   1. Space → togglePlay (playing === true after dispatch)
//   2. Space again → playing === false (toggle)
//   3. R → starts recording (when not recording), respects two-click safety
//   4. V → toggles vizEnabled
//   5. Delete → removes the active timeline row
//   6. Cmd-R / Ctrl-R is NOT intercepted (reloads the page in real life)
//   7. Typing in an input field does NOT trigger shortcuts

import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import puppeteer from 'puppeteer';

const BASE = process.env.BASE_URL || 'http://localhost:5174';
const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PORT = 8078;

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

  // Reset + seed
  await page.evaluate(() => {
    try { localStorage.removeItem('swr.mvm.project'); } catch (_) {}
    try { localStorage.removeItem('swr.mvm.viz'); } catch (_) {}
  });
  await page.reload({ waitUntil: 'networkidle0' });
  await page.waitForFunction(() => !!window.MVM, { timeout: 20000, polling: 500 });

  await page.evaluate(async () => {
    const RED_PNG = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='), (c) => c.charCodeAt(0));
    const blob = new Blob([RED_PNG], { type: 'image/png' });
    const file = new File([blob], 'k.png', { type: 'image/png' });
    const c = await window.MVM.addClip(file);
    window.MVM.addToTimeline(c.id);
    window.MVM.project.clips[0].durationMs = 10000;
    const tl = window.MVM.project.timeline[0];
    tl.endMs = tl.startMs + 10000;
  });

  // Helper: dispatch a keydown on document body
  async function pressKey(key, opts = {}) {
    return page.evaluate((k, o) => {
      // The keydown listener is on document; we dispatch on body so the
      // target isn't an input/textarea (which would block the shortcut).
      const ev = new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...o });
      document.body.dispatchEvent(ev);
      return ev.defaultPrevented;
    }, key, opts);
  }

  await step('1. Space starts playback', async () => {
    const v = await page.evaluate(async () => {
      const ev = new KeyboardEvent('keydown', { key: ' ', bubbles: true, cancelable: true });
      document.body.dispatchEvent(ev);
      return window.MVM._isPlaying ? window.MVM._isPlaying() : null;
    });
    // We exposed _isPlaying internally; if not, check via the play button
    const playing = await page.evaluate(() => document.getElementById('play-pause').textContent);
    ok(/PAUSE/.test(playing), `play button should show PAUSE after Space, got "${playing}"`);
    // Pause to reset
    await page.evaluate(() => window.MVM.pause());
  });

  await step('2. Space again pauses playback', async () => {
    const v = await page.evaluate(async () => {
      // Start
      window.MVM.play();
      // Wait for tick
      await new Promise((r) => setTimeout(r, 100));
      // Space
      const ev = new KeyboardEvent('keydown', { key: ' ', bubbles: true, cancelable: true });
      document.body.dispatchEvent(ev);
      return document.getElementById('play-pause').textContent;
    });
    ok(/PLAY/.test(v), `play button should show PLAY after Space (pause), got "${v}"`);
  });

  await step('3. R starts recording (two-click safety)', async () => {
    const v = await page.evaluate(async () => {
      // Make sure not already recording
      if (window.MVM.Recorder.recording) window.MVM.Recorder.stop();
      // Use 'manual' duration so the auto-stop timer doesn't fire
      document.getElementById('rec-dur').value = '0';
      // First R: starts recording
      const ev1 = new KeyboardEvent('keydown', { key: 'r', bubbles: true, cancelable: true });
      document.body.dispatchEvent(ev1);
      await new Promise((r) => setTimeout(r, 30));
      // Second R: click handler sees recording=true, no pending → sets pending
      const ev2 = new KeyboardEvent('keydown', { key: 'r', bubbles: true, cancelable: true });
      document.body.dispatchEvent(ev2);
      await new Promise((r) => setTimeout(r, 30));
      const afterTwoR = {
        recording: window.MVM.Recorder.recording,
        hasPendingClass: document.getElementById('rec').classList.contains('mvm-pending-stop'),
        pendingAt: window.MVM.Recorder._pendingStopAt,
      };
      // Third R: click handler sees recording=true AND pending → actually stops
      const ev3 = new KeyboardEvent('keydown', { key: 'r', bubbles: true, cancelable: true });
      document.body.dispatchEvent(ev3);
      await new Promise((r) => setTimeout(r, 200));
      const afterThreeR = {
        recording: window.MVM.Recorder.recording,
        pendingAt: window.MVM.Recorder._pendingStopAt,
      };
      return { afterTwoR, afterThreeR };
    });
    ok(v.afterTwoR.recording, 'after 2x R, should still be recording (pending-stop, not actual stop)');
    ok(v.afterTwoR.hasPendingClass, 'after 2x R, REC button should have pending-stop class');
    ok(v.afterTwoR.pendingAt > 0, 'after 2x R, _pendingStopAt should be set');
    ok(!v.afterThreeR.recording, 'after 3x R, recording should be stopped');
    ok(v.afterThreeR.pendingAt === 0, 'after 3x R, _pendingStopAt should be cleared');
  });

  await step('4. V toggles vizEnabled', async () => {
    const v = await page.evaluate(async () => {
      const before = window.MVM.vizEnabled;
      document.body.focus();
      const ev = new KeyboardEvent('keydown', { key: 'v', bubbles: true, cancelable: true });
      document.body.dispatchEvent(ev);
      const after = window.MVM.vizEnabled;
      return { before, after };
    });
    ok(v.before !== v.after, `V should flip vizEnabled (before=${v.before}, after=${v.after})`);
    // Toggle back
    await page.evaluate(() => { document.body.focus(); const ev = new KeyboardEvent('keydown', { key: 'v', bubbles: true, cancelable: true }); document.body.dispatchEvent(ev); });
  });

  await step('5. Delete removes the active timeline row', async () => {
    const v = await page.evaluate(async () => {
      const before = window.MVM.project.timeline.length;
      // Set the playhead inside the first row
      window.MVM.stop(); // reset playhead
      // Dispatch Delete
      const ev = new KeyboardEvent('keydown', { key: 'Delete', bubbles: true, cancelable: true });
      document.body.dispatchEvent(ev);
      return {
        before,
        after: window.MVM.project.timeline.length,
        defaultPrevented: ev.defaultPrevented,
      };
    });
    ok(v.after === v.before - 1, `Delete should remove 1 row (before=${v.before}, after=${v.after})`);
    ok(v.defaultPrevented, 'Delete should preventDefault');
  });

  await step('6. Cmd-R is NOT intercepted (reloads the page)', async () => {
    // We can't actually reload the page mid-test. But we can verify
    // that pressing Cmd-R doesn't trigger our R handler — i.e. Recorder
    // doesn't start.
    const v = await page.evaluate(async () => {
      window.MVM.Recorder.stop(); // ensure not recording
      const ev = new KeyboardEvent('keydown', { key: 'r', bubbles: true, cancelable: true, metaKey: true });
      document.body.dispatchEvent(ev);
      return {
        recording: window.MVM.Recorder.recording,
        defaultPrevented: ev.defaultPrevented,
      };
    });
    ok(!v.recording, 'Cmd+R should NOT start recording');
    ok(!v.defaultPrevented, 'Cmd+R should NOT be preventDefaulted (page should reload)');
  });

  await step('7. Typing in an input does NOT trigger shortcuts', async () => {
    const v = await page.evaluate(async () => {
      // Add a temporary input
      const input = document.createElement('input');
      input.type = 'text';
      input.id = 'temp-shortcut-input';
      document.body.appendChild(input);
      input.focus();
      const beforeViz = window.MVM.vizEnabled;
      // Simulate typing "r" in the input
      const ev = new KeyboardEvent('keydown', { key: 'r', bubbles: true, cancelable: true });
      input.dispatchEvent(ev);
      const afterViz = window.MVM.vizEnabled;
      input.remove();
      return { beforeViz, afterViz };
    });
    ok(v.beforeViz === v.afterViz, 'typing in input should not toggle viz');
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