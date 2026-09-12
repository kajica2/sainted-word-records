#!/usr/bin/env node
// verify-full-cycle.mjs — end-to-end full cycle test with a real song.
//
//   1. Boots a local static server rooted at the repo + an extra /songs/
//      mount so the user's MP4 can be served (Puppeteer loads it via
//      <input type="file"> after we patch the song-input directly with
//      page.locator().setInputFiles()).
//   2. Loads versions/hallucination.html (the proven WebM recorder path).
//   3. Drops the song into the engine via the file input.
//   4. Waits for the audio element to load + play.
//   5. Hits RE-MAP.
//   6. Hits REC for 5s.
//   7. Captures the produced blob, decodes the first frame with ffprobe,
//      writes it to /tmp/swr-cycle-<ts>.webm, exits 0/1.
//
//   SONG_PATH=/path/to/song.mp4 node verify-full-cycle.mjs
//
// Defaults to the user's Ian Pooley track if SONG_PATH is not set.

import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { execFileSync } from 'child_process';
import puppeteer from 'puppeteer';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PORT = 8094;
const DEFAULT_SONG = '/Users/kaidejuricmasscmbook/Movies/Downloaded by MediaHuman/Ian Pooley - Viola.mp4';
const SONG_PATH = process.env.SONG_PATH || DEFAULT_SONG;
const BASE = `http://localhost:${PORT}`;
const TARGET = `${BASE}/versions/hallucination.html`;

if (!fs.existsSync(SONG_PATH)) {
  console.error(`Song not found: ${SONG_PATH}`);
  console.error('Set SONG_PATH=/path/to/song.mp4');
  process.exit(2);
}
const songSize = fs.statSync(SONG_PATH).size;
console.log(`[init] song: ${path.basename(SONG_PATH)} (${(songSize/1048576).toFixed(1)} MB)`);

const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.gif': 'image/gif', '.wav': 'audio/wav', '.mp3': 'audio/mpeg',
  '.mp4': 'video/mp4', '.webm': 'video/webm',
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
  process.stdout.write(`  · ${name} ... `);
  try { await fn(); process.stdout.write('OK\n'); }
  catch (e) { failed += 1; process.stdout.write('FAIL\n'); process.stderr.write('    ' + (e.stack || e.message) + '\n'); }
}
const ok = (cond, msg) => { if (!cond) throw new Error(msg || 'assertion failed'); };

const server = await localServe();
let browser;
const outDir = '/tmp/swr-cycle-out';
fs.mkdirSync(outDir, { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const outPath = path.join(outDir, `cycle-${stamp}.webm`);
let recordedBytes = 0;
let recordedType = '';

try {
  browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required', '--use-fake-ui-for-media-stream'],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 720 });

  const consoleErrors = [];
  page.on('pageerror', (err) => consoleErrors.push('PE: ' + err.message));
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push('CE: ' + msg.text());
  });

  await step('load hallucination engine', async () => {
    await page.goto(TARGET, { waitUntil: 'networkidle0', timeout: 45000 });
  });

  await step('engine becomes ready (window.SWR.* populated)', async () => {
    let waited = 0;
    while (waited < 30000) {
      const r = await page.evaluate(() =>
        !!(window.SWR && window.SWR.Audio && window.SWR.Library && window.SWR.Layers && window.SWR.Recorder));
      if (r) return;
      await new Promise((r) => setTimeout(r, 500));
      waited += 500;
    }
    throw new Error('window.SWR.* not populated within 30s');
  });

  await step('find the song file input', async () => {
    const id = await page.evaluate(() => {
      const song = document.getElementById('song-input');
      if (!song) return null;
      return song.id;
    });
    ok(id, 'no #song-input in DOM');
  });

  await step('drop song via file input', async () => {
    const input = await page.$('#song-input');
    if (!input) throw new Error('#song-input not found');
    await input.uploadFile(SONG_PATH);
    // Wait for the engine's change handler to bind the audio element.
    // Hallucination version uses `A.el` (not `A.audioEl`).
    let waited = 0;
    while (waited < 20000) {
      const has = await page.evaluate(() => {
        const el = window.SWR && window.SWR.Audio && window.SWR.Audio.el;
        return !!(el && (el.currentSrc || el.src));
      });
      if (has) return;
      await new Promise((r) => setTimeout(r, 500));
      waited += 500;
    }
    throw new Error('Audio.el.src never set after upload');
  });

  await step('audio reaches HAVE_ENOUGH_DATA', async () => {
    let waited = 0;
    while (waited < 30000) {
      const r = await page.evaluate(() => {
        const el = window.SWR.Audio.el;
        return { rs: el ? el.readyState : 0, dur: el ? el.duration : 0, has: !!el };
      });
      if (r.has && r.rs >= 3 && r.dur > 1) return;
      await new Promise((r) => setTimeout(r, 500));
      waited += 500;
    }
    const r = await page.evaluate(() => {
      const el = window.SWR.Audio.el;
      return {
        rs: el ? el.readyState : 0,
        dur: el ? el.duration : 0,
        src: el ? (el.currentSrc || el.src) : '',
      };
    });
    throw new Error(`audio never reached HAVE_ENOUGH_DATA. readyState=${r.rs}, duration=${r.dur}, src=${r.src.slice(0,60)}`);
  });

  await step('audio context unlocked + analyser flowing', async () => {
    // Puppeteer's uploadFile counts as a user gesture, which should
    // unlock the AudioContext. Force-resume to be safe across browser
    // quirks.
    await page.evaluate(() => {
      const A = window.SWR.Audio;
      if (A.ctx && A.ctx.state !== 'running') A.ctx.resume();
    });
    await new Promise((r) => setTimeout(r, 300));
    const r = await page.evaluate(() => {
      const A = window.SWR.Audio;
      return {
        ctx: !!A.ctx,
        ctxState: A.ctx ? A.ctx.state : 'none',
        analyser: !!A.an,
      };
    });
    ok(r.ctx, 'AudioContext missing');
    ok(r.ctxState === 'running', `AudioContext state: ${r.ctxState}`);
    ok(r.analyser, 'analyser node missing');
  });

  await step('start playback', async () => {
    const playing = await page.evaluate(async () => {
      const A = window.SWR.Audio;
      try {
        await A.play();
      } catch (_) { /* autoplay race; ignore */ }
      // Wait for the audio to actually start moving
      let waited = 0;
      while (waited < 3000) {
        if (A.playing && A.el && A.el.currentTime > 0.05) return A.el.currentTime;
        await new Promise((r) => setTimeout(r, 100));
        waited += 100;
      }
      return A.playing ? (A.el ? A.el.currentTime : -1) : 0;
    });
    ok(playing > 0.05, `audio did not start. currentTime=${playing}`);
    console.log(`\n    [play] currentTime=${playing.toFixed(2)}s`);
  });

  await step('RE-MAP the composition', async () => {
    const clicked = await page.evaluate(() => {
      const btn = document.getElementById('remap');
      if (btn) { btn.click(); return 'remap'; }
      // Fallback: text search
      const btns = Array.from(document.querySelectorAll('button, a, [role="button"]'));
      const remap = btns.find((b) => /re-?map/i.test(b.textContent || ''));
      if (remap) { remap.click(); return 'by-text'; }
      return null;
    });
    ok(clicked, 'no remap button found');
    await new Promise((r) => setTimeout(r, 600));
  });

  await step('features are alive (bass > 0 over a 2s sample)', async () => {
    // Sample feature.bass for 2s; if the audio is playing + analyser is
    // wired, we should see non-trivial values.
    const samples = await page.evaluate(async () => {
      const out = [];
      for (let i = 0; i < 20; i++) {
        await new Promise((r) => setTimeout(r, 100));
        const A = window.SWR.Audio;
        if (!A || !A.feat) { out.push(0); continue; }
        out.push(A.feat.bass || 0);
      }
      return out;
    });
    const peak = Math.max(...samples);
    ok(peak > 0.001, `no audio features detected over 2s window (peak=${peak.toFixed(4)})`);
    console.log(`\n    [bass peak] ${peak.toFixed(3)}`);
  });

  await step('instrument Recorder._save to capture blob', async () => {
    await page.evaluate(() => {
      const R = window.SWR.Recorder;
      window.__capturedRecording = null;
      window.__capturedRecordingBytes = null;
      window.__capturedRecordingMeta = null;
      window.__capturedRecordingError = null;
      R._save = async function () {
        try {
          const blob = new Blob(this.chunks, { type: this.mime });
          window.__capturedRecordingMeta = { size: blob.size, type: blob.type, chunks: this.chunks.length };
          // Snapshot into a fresh Uint8Array and ship it back as a plain
          // array of numbers. JSON-serializable, so it survives the CDP
          // round-trip. We tried readAsDataURL first but the resulting
          // ~5MB string was being truncated somewhere downstream.
          const ab = await blob.arrayBuffer();
          window.__capturedRecordingBytes = Array.from(new Uint8Array(ab));
        } catch (e) {
          window.__capturedRecordingError = String(e);
        }
      };
    });
  });

  await step('record 5 seconds (canvas + audio mux)', async () => {
    await page.evaluate(() => {
      const R = window.SWR.Recorder;
      // Force the proven WebM path; WebCodecs/MP4 is flaky in headless.
      const fmtSel = document.getElementById('rec-format');
      if (fmtSel) fmtSel.value = 'webm';
      const dur = document.getElementById('rec-dur');
      let opt = dur && Array.from(dur.options).find((o) => o.value === '5');
      if (dur && !opt) { opt = document.createElement('option'); opt.value='5'; opt.textContent='5s'; dur.appendChild(opt); }
      if (dur) dur.value = '5';
      R.start();
    });
    // 5.5s = 5s record + a beat for the auto-stop + save
    await new Promise((r) => setTimeout(r, 6000));
  });

  await step('capture blob metadata', async () => {
    const meta = await page.evaluate(() => window.__capturedRecordingMeta);
    ok(meta, 'Recorder._save never fired');
    ok(meta.size > 10000, `recording too small: ${meta.size} bytes (expected > 10 KB)`);
    ok(/webm|mp4/i.test(meta.type), `unexpected mime: ${meta.type}`);
    recordedType = meta.type;
    recordedBytes = meta.size;
    console.log(`\n    [recording] ${(meta.size/1024).toFixed(1)} KB · ${meta.type}`);
  });

  await step('extract bytes array', async () => {
    // The bytes array is huge (4+ MB); pulling it through page.evaluate
    // returns a plain Array which serializes cleanly over CDP.
    const bytes = await page.evaluate(() => window.__capturedRecordingBytes);
    const err = await page.evaluate(() => window.__capturedRecordingError);
    ok(!err, `FileReader/arrayBuffer failed: ${err}`);
    ok(Array.isArray(bytes), 'bytes is not an array');
    ok(bytes.length === recordedBytes, `bytes length mismatch: ${bytes.length} vs ${recordedBytes}`);
    console.log(`\n    [bytes] ${bytes.length} numbers extracted`);
  });

  await step('extract blob to disk + ffprobe it', async () => {
    const bytes = await page.evaluate(() => window.__capturedRecordingBytes);
    ok(Array.isArray(bytes) && bytes.length === recordedBytes, 'no bytes captured');
    const buf = Buffer.from(Uint8Array.from(bytes));
    fs.writeFileSync(outPath, buf);
    const actualSize = fs.statSync(outPath).size;
    ok(actualSize === recordedBytes, `disk size mismatch: ${actualSize} vs ${recordedBytes}`);
    // ffprobe the result
    const probe = execFileSync('ffprobe', [
      '-v', 'error',
      '-show_format', '-show_streams',
      '-of', 'json',
      outPath,
    ], { encoding: 'utf8' });
    const info = JSON.parse(probe);
    const streams = info.streams || [];
    const v = streams.find((s) => s.codec_type === 'video');
    const a = streams.find((s) => s.codec_type === 'audio');
    ok(v, 'no video stream in recording');
    ok(a, 'no audio stream in recording');
    console.log(`\n    [video] ${v.codec_name} ${v.width}x${v.height} ${v.duration ? v.duration.toFixed(2) + 's' : '?'}`);
    console.log(`    [audio] ${a.codec_name} ${a.sample_rate || '?'}Hz`);
  });

  if (consoleErrors.length) {
    console.log('\n  Console errors during run:');
    consoleErrors.forEach((e) => console.log('    ' + e));
  }
} finally {
  if (browser) await browser.close();
  server.close();
}

console.log(`\n  artifact: ${outPath}`);
console.log(`  size:     ${(recordedBytes/1024).toFixed(1)} KB`);
console.log(`  type:     ${recordedType}`);
if (failed === 0) {
  console.log('\nFULL CYCLE GREEN');
  process.exit(0);
} else {
  console.log(`\n${failed} STEP(S) FAILED`);
  process.exit(1);
}
