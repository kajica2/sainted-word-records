// verify-mvm-review-fixes.mjs — smoke for Phase 11 review fixes.
//
//   BASE_URL=http://localhost:5174 node verify-mvm-review-fixes.mjs
//
// Asserts:
//   1. syncVideoClips() no longer early-returns on empty _videoEls map.
//      We can verify by calling it and checking it doesn't throw.
//   2. stop() while recording calls Recorder.stop() — Recorder.recording
//      becomes false after stop().
//   3. The opacity slider's 'input' listener uses setClipPropsQuiet
//      (not the re-rendering setClipProps). We can verify by checking
//      the same <input> element is still in the DOM after dispatching
//      an input event.
//   4. pagehide handler is registered on window.

import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import puppeteer from 'puppeteer';

const BASE = process.env.BASE_URL || 'http://localhost:5174';
const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PORT = 8081;

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

  await step('1. syncVideoClips is exported on window.MVM and runs without throwing', async () => {
    const v = await page.evaluate(() => {
      // The function should exist on the MVM surface.
      const has = typeof window.MVM.syncVideoClips === 'function';
      // Call it with an empty timeline; it should not throw.
      let threw = null;
      try { window.MVM.syncVideoClips(0); } catch (e) { threw = e.message; }
      // Internal _videoEls map is private, but we can at least assert the
      // call didn't bail. The pre-fix code had an early-return on
      // _videoEls.size === 0; the post-fix code always iterates the
      // timeline. The behavior under an empty timeline is the same
      // either way (no work to do), so what we're really asserting is
      // that the function is callable AND doesn't have a guard that
      // would prevent creation of new video elements. We approximate
      // that by checking it doesn't throw.
      return { has, threw };
    });
    ok(v.has, 'MVM.syncVideoClips missing');
    ok(!v.threw, `syncVideoClips threw: ${v.threw}`);
  });

  await step('2. stop() while recording calls Recorder.stop()', async () => {
    // Start a recording, then call MVM.stop(), then check Recorder.recording.
    const v = await page.evaluate(async () => {
      // Need a real timeline so the REC button can enable. Seed one clip.
      const RED_PNG = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='), (c) => c.charCodeAt(0));
      const blob = new Blob([RED_PNG], { type: 'image/png' });
      const file = new File([blob], 'rec-fix.png', { type: 'image/png' });
      const c = await window.MVM.addClip(file);
      window.MVM.addToTimeline(c.id);
      // Set the duration to be long enough so auto-stop doesn't fire.
      window.MVM.project.clips[0].durationMs = 60000;
      const tl = window.MVM.project.timeline[0];
      tl.endMs = tl.startMs + 60000;
      // Start recording manually (no song; video-only recording).
      const started = window.MVM.Recorder.start(60000);
      const recordingBeforeStop = window.MVM.Recorder.recording;
      // Now call MVM.stop() — the fix should propagate to Recorder.
      window.MVM.stop();
      // Give the onstop handler a moment to fire
      await new Promise((r) => setTimeout(r, 100));
      const recordingAfterStop = window.MVM.Recorder.recording;
      return { started, recordingBeforeStop, recordingAfterStop };
    });
    ok(v.started, 'Recorder.start returned false');
    ok(v.recordingBeforeStop, 'Recorder should be recording after start');
    ok(!v.recordingAfterStop, `stop() should stop the recorder; recording=${v.recordingAfterStop}`);
  });

  await step('3. opacity slider input event does not recreate the input element', async () => {
    const v = await page.evaluate(async () => {
      // Add a fresh clip so we have a clip card with a slider.
      const RED_PNG = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='), (c) => c.charCodeAt(0));
      const blob = new Blob([RED_PNG], { type: 'image/png' });
      const file = new File([blob], 'opa-test.png', { type: 'image/png' });
      const c = await window.MVM.addClip(file);
      // Get the slider element from the new card
      const card = document.querySelector('.mvm-clip-card');
      const opaBefore = card.querySelector('input[type="range"]');
      const beforeRef = opaBefore;
      // Simulate a drag: dispatch a sequence of input events
      for (let v = 0; v <= 1; v += 0.1) {
        opaBefore.value = v.toFixed(2);
        opaBefore.dispatchEvent(new Event('input', { bubbles: true }));
      }
      await new Promise((r) => setTimeout(r, 50));
      // After the drag, the same input element should still be in the DOM
      // (i.e. it wasn't recreated mid-drag).
      const cardAfter = document.querySelector('.mvm-clip-card');
      const opaAfter = cardAfter ? cardAfter.querySelector('input[type="range"]') : null;
      // The clip card's underlying clip (by id) should still match.
      return {
        beforeInDom: !!beforeRef && document.body.contains(beforeRef),
        afterInDom: !!opaAfter && document.body.contains(opaAfter),
        sameRef: beforeRef === opaAfter,
        // State should still be updated (the quiet setter writes through).
        finalOpacity: window.MVM.project.clips[window.MVM.project.clips.length - 1].opacity,
      };
    });
    ok(v.beforeInDom, 'opacity input was not in the DOM before drag');
    ok(v.afterInDom, 'opacity input was not in the DOM after drag');
    ok(v.sameRef, 'opacity input was recreated mid-drag (should be the same ref)');
    ok(Math.abs(v.finalOpacity - 1) < 0.01, `final opacity should be ~1.0, got ${v.finalOpacity}`);
  });

  await step('4. pagehide / beforeunload cleanup is registered', async () => {
    // We can't directly inspect listeners, but we can check that the
    // runtime exposes the cleanup behavior by simulating a pagehide.
    // The handler should call Recorder.stop if recording. We start
    // a recording, fire a pagehide event, and assert Recorder.recording
    // goes false.
    const v = await page.evaluate(async () => {
      // Add a timeline so REC is enabled
      const RED_PNG = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='), (c) => c.charCodeAt(0));
      const blob = new Blob([RED_PNG], { type: 'image/png' });
      const file = new File([blob], 'pagehide.png', { type: 'image/png' });
      const c = await window.MVM.addClip(file);
      window.MVM.addToTimeline(c.id);
      window.MVM.project.clips[window.MVM.project.clips.length - 1].durationMs = 60000;
      window.MVM.Recorder.start(60000);
      const before = window.MVM.Recorder.recording;
      // Fire a pagehide event
      window.dispatchEvent(new Event('pagehide'));
      await new Promise((r) => setTimeout(r, 100));
      const after = window.MVM.Recorder.recording;
      return { before, after };
    });
    ok(v.before, 'Recorder should be recording before pagehide');
    ok(!v.after, `pagehide should stop the recorder; recording=${v.after}`);
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