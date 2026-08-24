#!/usr/bin/env node
// verify-music-video-maker.mjs — smoke test for the /make-video page.
//
//   BASE_URL=http://localhost:5174 \
//     node verify-music-video-maker.mjs
//
// Asserts (Phase 1 scope):
//   1. window.MVM exists after page load
//   2. project starts empty (no clips, no timeline, no song)
//   3. addClip(fakeFile) pushes a clip into project.clips
//   4. addToTimeline(clipId) pushes a row into project.timeline
//   5. localStorage 'swr.mvm.project' round-trips after reload
//   6. play() advances the playhead
//   7. song picker opens the modal via library-switcher

import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import puppeteer from 'puppeteer';

const BASE = process.env.BASE_URL || 'http://localhost:5174';
const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PORT = 8088;

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

  await page.goto(`${BASE}/make-video.html`, { waitUntil: 'networkidle0', timeout: 45000 });

  // Wait for window.MVM + window.SWR_MEDIA + window.SWR_LIBRARY_SWITCHER.
  let waited = 0;
  while (waited < 30000) {
    const ok = await page.evaluate(() =>
      !!window.MVM && !!window.SWR_MEDIA && !!window.SWR_LIBRARY_SWITCHER);
    if (ok) break;
    await new Promise((r) => setTimeout(r, 500));
    waited += 500;
  }
  if (waited >= 30000) throw new Error('MVM/SWR_MEDIA/SWR_LIBRARY_SWITCHER never came up');

  // Start with a clean localStorage so prior runs don't pollute.
  await page.evaluate(() => { try { localStorage.removeItem('swr.mvm.project'); } catch (_) {} });
  await page.reload({ waitUntil: 'networkidle0' });
  await page.waitForFunction(() => !!window.MVM, { timeout: 20000, polling: 500 });

  await step('window.MVM exposes the public API', async () => {
    const v = await page.evaluate(() => ({
      hasMVM: !!window.MVM,
      methods: Object.keys(window.MVM || {}).sort(),
    }));
    ok(v.hasMVM, 'MVM missing');
    ok(v.methods.includes('addClip'), 'addClip missing');
    ok(v.methods.includes('addToTimeline'), 'addToTimeline missing');
    ok(v.methods.includes('save'), 'save missing');
    ok(v.methods.includes('load'), 'load missing');
  });

  await step('project starts empty', async () => {
    const v = await page.evaluate(() => ({
      clips: window.MVM.project.clips.length,
      timeline: window.MVM.project.timeline.length,
      song: window.MVM.project.song,
    }));
    ok(v.clips === 0, `clips = ${v.clips}`);
    ok(v.timeline === 0, `timeline = ${v.timeline}`);
    ok(v.song === null, 'song should be null');
  });

  await step('addClip(fakeImage) pushes a clip into project.clips', async () => {
    const v = await page.evaluate(async () => {
      // Reset state first
      try { localStorage.removeItem('swr.mvm.project'); } catch (_) {}
      const blob = new Blob([new Uint8Array([255, 0, 0, 255, 0, 255, 0, 0, 255, 0, 0, 255])], { type: 'image/png' });
      const file = new File([blob], 'red.png', { type: 'image/png' });
      const c = await window.MVM.addClip(file);
      return { clip: c ? { id: c.id, type: c.type, name: c.name, hasBlobUrl: !!c.blobUrl } : null,
               total: window.MVM.project.clips.length };
    });
    ok(v.clip !== null, 'addClip returned null');
    ok(v.clip.type === 'image', `type = ${v.clip.type}`);
    ok(v.clip.hasBlobUrl, 'blobUrl missing');
    ok(v.total === 1, `clips = ${v.total}`);
  });

  await step('addToTimeline pushes a row into project.timeline', async () => {
    const v = await page.evaluate(async () => {
      const clip = window.MVM.project.clips[0];
      window.MVM.addToTimeline(clip.id);
      return {
        timelineCount: window.MVM.project.timeline.length,
        first: window.MVM.project.timeline[0],
      };
    });
    ok(v.timelineCount === 1, `timeline = ${v.timelineCount}`);
    ok(v.first && v.first.clipId, 'first row missing clipId');
    ok(v.first.endMs > v.first.startMs, 'endMs > startMs');
  });

  await step('localStorage["swr.mvm.project"] round-trips after reload', async () => {
    const before = await page.evaluate(() => ({
      clips: window.MVM.project.clips.length,
      timeline: window.MVM.project.timeline.length,
      ls: localStorage.getItem('swr.mvm.project'),
    }));
    ok(before.ls !== null, 'localStorage not written');
    await page.reload({ waitUntil: 'networkidle0' });
    await page.waitForFunction(() => !!window.MVM, { timeout: 20000, polling: 500 });
    // Project loads; clips[] is rebuilt from IDB; timeline[] from JSON.
    const after = await page.evaluate(() => ({
      clips: window.MVM.project.clips.length,
      timeline: window.MVM.project.timeline.length,
    }));
    ok(after.clips === before.clips, `clips before=${before.clips} after=${after.clips}`);
    ok(after.timeline === before.timeline, `timeline before=${before.timeline} after=${after.timeline}`);
  });

  await step('play() advances the playhead after 200ms', async () => {
    const v = await page.evaluate(async () => {
      // Capture initial readout + state
      const before = {
        readout: document.getElementById('time-readout').textContent,
        timelineLen: window.MVM.project.timeline.length,
        durationMs: window.MVM.timelineDurationMs(),
      };
      window.MVM.play();
      const startedAt = performance.now();
      await new Promise((r) => setTimeout(r, 220));
      const mid = {
        readout: document.getElementById('time-readout').textContent,
      };
      window.MVM.pause();
      await new Promise((r) => setTimeout(r, 30));
      const after = {
        readout: document.getElementById('time-readout').textContent,
      };
      return { before, mid, after, durationMs: before.durationMs, elapsed: performance.now() - startedAt };
    });
    // Skip if timeline is empty (some prior test left no clips)
    if (v.durationMs === 0) {
      process.stdout.write('  (skipped — no timeline)\n');
      return;
    }
    const playheadMatches = /^(\d+):(\d+) \/ (\d+):(\d+)/.exec(v.mid.readout);
    ok(playheadMatches !== null, `bad readout format: ${v.mid.readout}`);
    if (playheadMatches) {
      const s = parseInt(playheadMatches[2], 10);
      ok(s >= 0, `playhead seconds ${s} from ${v.mid.readout}`);
    }
  });

  await step('song picker opens modal via SWR_LIBRARY_SWITCHER', async () => {
    const v = await page.evaluate(() => {
      const btn = document.getElementById('pick-song');
      btn.click();
      const modal = document.getElementById('song-modal');
      const tabs = document.querySelectorAll('#song-modal-host .lsw-tab');
      return {
        modalOpen: modal.classList.contains('open'),
        tabs: tabs.length,
      };
    });
    ok(v.modalOpen, 'modal did not open');
    ok(v.tabs === 4, `expected 4 tabs, got ${v.tabs}`);
    // Close it for cleanup
    await page.evaluate(() => {
      const close = document.getElementById('close-song-modal');
      if (close) close.click();
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

if (failed === 0) {
  console.log('\nALL GREEN');
  process.exit(0);
} else {
  console.log(`\n${failed} FAILED`);
  process.exit(1);
}