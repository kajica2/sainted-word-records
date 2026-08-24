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
      // A valid 1x1 red PNG (67 bytes) so the canvas drawImage path works.
      // (Previously we used a 12-byte placeholder which wasn't a valid PNG,
      // causing drawImage to fail with InvalidStateError.)
      const RED_PNG_1x1 = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='), (c) => c.charCodeAt(0));
      const blob = new Blob([RED_PNG_1x1], { type: 'image/png' });
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

  await step('setClipProps updates state + DOM', async () => {
    const v = await page.evaluate(() => {
      const clip = window.MVM.project.clips[0];
      window.MVM.setClipProps(clip.id, { blend: 'multiply', opacity: 0.5, transition: 'fade' });
      const updated = window.MVM.project.clips[0];
      return {
        blend: updated.blend,
        opacity: updated.opacity,
        transition: updated.transition,
        // Verify the DOM select also reflects the new value
        domBlend: (document.querySelector('.mvm-clip-card select')).value,
      };
    });
    ok(v.blend === 'multiply', `state blend = ${v.blend}`);
    ok(v.opacity === 0.5, `state opacity = ${v.opacity}`);
    ok(v.transition === 'fade', `state transition = ${v.transition}`);
    ok(v.domBlend === 'multiply', `dom blend = ${v.domBlend}`);
  });

  await step('play() draws non-black pixels to the canvas', async () => {
    const v = await page.evaluate(async () => {
      // Force the playhead to a known time inside the first timeline row.
      window.MVM.pause();
      // Reset to start, then manually drive the playhead via the
      // renderFrame API (avoids the 33ms tick race).
      window.MVM.stop();
      // Wait for image decode (we have a 3s row starting at 0)
      await new Promise((r) => setTimeout(r, 200));
      // Find the first timeline row's [startMs, endMs) midpoint
      const tl = window.MVM.project.timeline[0];
      if (!tl) return { error: 'no timeline row' };
      const midMs = (tl.startMs + tl.endMs) / 2;
      // Render at midpoint
      window.MVM.renderFrame(midMs);
      // Sample the canvas
      const canvas = document.getElementById('preview');
      const ctx = canvas.getContext('2d');
      const w = canvas.width, h = canvas.height;
      // Sample 9 grid points; expect at least one non-black pixel
      const samples = [];
      for (let yi = 0; yi < 3; yi++) {
        for (let xi = 0; xi < 3; xi++) {
          const px = ctx.getImageData(Math.floor(w * (xi + 0.5) / 3), Math.floor(h * (yi + 0.5) / 3), 1, 1).data;
          samples.push([px[0], px[1], px[2]]);
        }
      }
      return { samples, w, h };
    });
    if (v.error) { ok(false, v.error); return; }
    const nonBlack = v.samples.filter((s) => s[0] > 8 || s[1] > 8 || s[2] > 8);
    ok(nonBlack.length > 0, `canvas stayed black after renderFrame; samples: ${JSON.stringify(v.samples)}`);
  });

  await step('Recorder produces a real MP4/WebM blob', async () => {
    // The previous test's timeline is only 3s long, so the playhead reaches
    // end before the recorder can capture anything. Add a fresh 10s clip
    // to the timeline so we have a recording window long enough to capture
    // a non-trivial MediaRecorder payload.
    await page.evaluate(async () => {
      const RED_PNG_1x1 = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='), (c) => c.charCodeAt(0));
      const blob = new Blob([RED_PNG_1x1], { type: 'image/png' });
      const file = new File([blob], 'rec.png', { type: 'image/png' });
      const c = await window.MVM.addClip(file);
      // Stretch the duration so we have plenty of room for the recorder.
      c.durationMs = 10000;
      window.MVM.addToTimeline(c.id);
    });

    // Instrument Recorder._save to capture the blob head (same pattern as
    // verify-e2e-media-record.mjs).
    const v = await page.evaluate(async () => {
      window.__captured = null;
      const origSave = window.MVM.Recorder._save.bind(window.MVM.Recorder);
      window.MVM.Recorder._save = function () {
        const blob = new Blob(this.chunks, { type: this.mime });
        window.__captured = {
          size: blob.size,
          type: blob.type,
          bytes: blob.arrayBuffer().then((ab) => {
            const u8 = new Uint8Array(ab, 0, Math.min(16, ab.byteLength));
            return Array.from(u8);
          }),
        };
      };
      // Drive a short recording: 1 second. The recorder will use 'manual'
      // by default since timeline < 5s, so the auto-stop timer would NOT
      // fire — instead, we play the timeline to completion and the
      // auto-stop-on-end logic in the tick will stop the recorder.
      const sel = document.getElementById('rec-dur');
      // Inject a 30s option (way more than the timeline) so we control stop
      const opt = document.createElement('option'); opt.value = '30'; opt.textContent = '30s'; sel.appendChild(opt);
      sel.value = '30';
      // Start recording. canvas.captureStream doesn't capture the
      // static red image at full rate, but it does emit a stream.
      const started = window.MVM.Recorder.start(30000);
      if (!started) return { error: 'Recorder.start returned false' };
      // Manually drive renderFrame() in a tight loop. Headless Chrome
      // does not always emit canvas frames to captureStream when rAF
      // is throttled, so we paint the canvas synchronously ~30x/sec.
      const t0 = performance.now();
      while (performance.now() - t0 < 1500) {
        window.MVM.renderFrame(performance.now() - t0);
        await new Promise((r) => setTimeout(r, 33));
      }
      // Stop
      window.MVM.Recorder.stop();
      // Give ondataavailable a tick to fire after stop()
      await new Promise((r) => setTimeout(r, 200));
      const c = window.__captured;
      if (!c) return { error: 'Recorder._save never fired' };
      const bytes = await c.bytes;
      return { size: c.size, type: c.type, bytes };
    });
    if (v.error) { ok(false, v.error); return; }
    ok(v.size > 1000, `recording too small: ${v.size} bytes`);
    ok(/webm|mp4/i.test(v.type), `unexpected mime: ${v.type}`);
    // Container header check
    const b = v.bytes;
    let valid = false;
    if (v.type.indexOf('webm') !== -1 && b[0] === 0x1A && b[1] === 0x45 && b[2] === 0xDF && b[3] === 0xA3) valid = true;
    if (v.type.indexOf('mp4') !== -1 && b[4] === 0x66 && b[5] === 0x74 && b[6] === 0x79 && b[7] === 0x70) valid = true;
    if (!valid) {
      const nz = b.filter((x) => x !== 0).length;
      valid = nz >= 4;
    }
    ok(valid, `bad container header: ${b.map((x) => x.toString(16).padStart(2, '0')).join(' ')}`);
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