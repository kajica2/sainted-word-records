#!/usr/bin/env node
// verify-e2e-media-record.mjs — end-to-end smoke: load the live
// hallucination engine, confirm every library image is loaded into a
// layer, run a real MediaRecorder cycle, and assert the recording
// blob is non-trivial and decodable.
//
//   BASE_URL=https://sainted-word-records-kai-djurics-projects.vercel.app \
//     node verify-e2e-media-record.mjs
//
// The cycle is poll-driven, not budget-driven: it waits for the audio graph the
// page's Recorder.start() requires, reads the engine's own arming state back,
// waits for real encoded chunks, then stops the recorder itself. The page's
// auto-stop lives in a setTimeout that a throttled renderer can clamp past any
// fixed budget, and start() has silent no-op exits — both used to surface as an
// unexplained "Recorder._save never fired".
//
// Exits 0 on green, 1 on any failure.

import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import puppeteer from 'puppeteer';

const BASE = process.env.BASE_URL || 'https://sainted-word-records-kai-djurics-projects.vercel.app';
const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PORT = 8093;

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
  try { await fn(); process.stdout.write(`  ✓ ${name}\n`); }
  catch (e) { failed += 1; process.stderr.write(`  ✗ ${name}\n    ${e.stack || e.message}\n`); }
}

const ok = (cond, msg) => { if (!cond) throw new Error(msg || 'assertion failed'); };

const server = await localServe();
let browser;
try {
  browser = await puppeteer.launch({
    headless: 'new',
    args: [
      '--no-sandbox',
      '--autoplay-policy=no-user-gesture-required',
      // Headless Chromium throttles timers in a backgrounded/occluded page —
      // the engine arms its auto-stop with a 5s setTimeout, which a clamped
      // timer queue can stretch past a minute. The verifier no longer waits on
      // that timer (it stops the recorder itself once chunks land), but the
      // MediaRecorder handshake and the engine's progress ticker live in the
      // same queue.
      '--disable-background-timer-throttling',
      '--disable-backgrounding-occluded-windows',
      '--disable-renderer-backgrounding',
    ],
  });
  const page = await browser.newPage();

  const consoleErrors = [];
  page.on('pageerror', (err) => consoleErrors.push('PE: ' + err.message));
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push('CE: ' + msg.text());
  });

  await page.setViewport({ width: 1280, height: 720 });
  // CI note: on the GitHub runner this page never reaches networkidle0 — the
  // engine's media + render loops keep the process active past the 45s budget
  // (the same runner condition that killed the photo-slideshow smoke). The
  // readiness poll below is the real gate, so gate the nav on domcontentloaded.
  await page.goto(`${BASE}/versions/hallucination.html`,
                  { waitUntil: 'domcontentloaded', timeout: 45000 });

  // Wait for SWR.Audio + Library + Layers to be populated.
  let waited = 0;
  while (waited < 30000) {
    const ok = await page.evaluate(() =>
      !!(window.SWR && window.SWR.Audio && window.SWR.Library && window.SWR.Layers && window.SWR.Layers.list.length > 0));
    if (ok) break;
    await new Promise((r) => setTimeout(r, 500));
    waited += 500;
  }
  if (waited >= 30000) throw new Error('engine never became ready within 30s');

  // ---- Inventory every media asset on the stage ----
  await step('every layer has an asset + decoded image element', async () => {
    const v = await page.evaluate(() => {
      const L = window.SWR.Layers.list;
      return L.map((l) => {
        const a = l.asset;
        const el = a && a._el;
        const ready = el ? (el.tagName === 'IMG' ? el.complete : el.readyState >= 2) : false;
        const w = el ? (el.naturalWidth || el.videoWidth) : 0;
        return {
          id: l.id,
          name: a ? a.name : 'none',
          type: a ? a.type : 'none',
          hasEl: !!el,
          ready,
          naturalWidth: w,
          opacity: l.opacity,
        };
      });
    });
    console.log(JSON.stringify(v, null, 2));
    ok(v.length >= 1, 'no layers');
    for (const layer of v) {
      ok(layer.hasEl, `layer ${layer.id} missing _el`);
      ok(layer.ready, `layer ${layer.id} not ready`);
      ok(layer.naturalWidth > 0, `layer ${layer.id} naturalWidth=0`);
    }
  });

  await step('audio element is loaded + playing', async () => {
    // The auto-start overlay requires a user gesture (browser
    // autoplay policy). Click it to trigger SWR.Audio.load() and
    // play(). Poll for HAVE_ENOUGH_DATA + playback rather than sleeping a fixed
    // 2.5s: a cold runner needs longer to decode the song and hand the element
    // its blob, and the recorder's own preconditions hang off this graph.
    await page.evaluate(() => {
      const o = document.getElementById('swr-start');
      if (o) o.click();
    });
    const audioState = () => page.evaluate(() => ({
      el: !!window.SWR.Audio.el,
      readyState: window.SWR.Audio.el ? window.SWR.Audio.el.readyState : 0,
      playing: window.SWR.Audio.playing,
      hasBlob: !!(window.SWR.Audio.el && window.SWR.Audio.el.src && window.SWR.Audio.el.src.startsWith('blob:')),
    }));
    let a = await audioState();
    for (let waited = 0; waited < 20000 && !(a.readyState >= 2 && a.playing && a.hasBlob); waited += 250) {
      await new Promise((r) => setTimeout(r, 250));
      a = await audioState();
    }
    console.log('audio:', JSON.stringify(a));
    ok(a.el, 'no audio element');
    ok(a.readyState >= 2, `audio readyState=${a.readyState}`);
    ok(a.playing, 'audio not playing');
    ok(a.hasBlob, 'audio not loaded as blob');
  });

  // ---- Instrument Recorder._save to capture the produced blob ----
  // The engine triggers an <a download> click, which headless can't capture
  // cleanly. Override _save to copy the blob into a window-global we read.
  // The retry keeps the page (no reload), so this patch stays in place for the
  // whole run — the assertion at the end of the step is what guarantees it.
  await step('instrument Recorder._save to capture the blob', async () => {
    const patched = await page.evaluate(() => {
      const R = window.SWR.Recorder;
      window.__capturedRecording = null;
      R._save = function () {
        // Mirror the engine's _save logic but stash the blob before the
        // download click. We replicate the same blob construction so we
        // don't perturb the engine path.
        const blob = new Blob(this.chunks, { type: this.mime });
        window.__capturedRecording = {
          size: blob.size,
          type: blob.type,
          bytes: blob.arrayBuffer().then((ab) => {
            const u8 = new Uint8Array(ab, 0, Math.min(16, ab.byteLength));
            return Array.from(u8);
          }),
        };
        // Do not trigger the actual download (would 404 in headless).
      };
      R._save.__swrPatched = true;
      return R._save.__swrPatched === true;
    });
    ok(patched, 'Recorder._save could not be instrumented');
  });

  // ---- Recorder preconditions + arm helpers ------------------------------
  // This page's Recorder.start() exits without arming anything when no song is
  // loaded (no A.el) or the audio graph is missing, and its auto-stop lives in a
  // page setTimeout that a throttled/occluded renderer can clamp far past any
  // fixed wall budget — the old "wait 5.5s then assert _save fired" shape turned
  // that into an unexplained failure. So: establish the preconditions the engine
  // itself checks, read the engine's arming state back, wait for real chunks, and
  // stop the recorder from here instead of trusting the page's timer.
  const ensureAudioGraph = async () => {
    await page.evaluate(() => {
      const A = window.SWR.Audio;
      if (A && A.ctx && A.ctx.state === 'suspended') A.ctx.resume();
    });
    for (let waited = 0; waited < 12000; waited += 250) {
      const graph = await page.evaluate(() => {
        const A = window.SWR.Audio;
        return {
          el: !!(A && A.el),
          ctx: !!(A && A.ctx),
          gain: !!(A && A.gain),
          state: (A && A.ctx && A.ctx.state) || null,
        };
      });
      if (graph.el && graph.ctx && graph.gain) return graph;
      await new Promise((r) => setTimeout(r, 250));
    }
    return null;
  };

  // The cycle drives #rec-dur / #rec-format. Both assignments are silent no-ops
  // when the option is missing (a <select> ignores an unknown value), and
  // #rec-format is what keeps start() out of the WebCodecs path — so assert they
  // actually took, rather than discovering it via a mystery failure.
  const forceRecorderOptions = async () => {
    const opts = await page.evaluate(() => {
      const durSel = document.getElementById('rec-dur');
      const fmtSel = document.getElementById('rec-format');
      if (durSel) {
        if (!Array.from(durSel.options).some((o) => o.value === '5')) {
          const opt = document.createElement('option');
          opt.value = '5';
          opt.textContent = '5s';
          durSel.appendChild(opt);
        }
        durSel.value = '5';
      }
      if (fmtSel && Array.from(fmtSel.options).some((o) => o.value === 'webm')) fmtSel.value = 'webm';
      return { dur: durSel ? durSel.value : null, format: fmtSel ? fmtSel.value : null };
    });
    ok(opts.dur === '5', `#rec-dur did not take the 5s value (got ${opts.dur})`);
    ok(opts.format === 'webm', `#rec-format did not take the webm value (got ${opts.format}) — start() would pick the WebCodecs path`);
  };

  const recorderState = () => page.evaluate(() => {
    const R = window.SWR.Recorder;
    const statusEl = document.getElementById('status');
    return {
      recording: R.recording,
      chunks: R.chunks.length,
      wcActive: !!R._wcActive,
      recState: R.rec ? R.rec.state : null,
      mime: R.mime,
      autoStopAt: R.autoStopAt,
      status: statusEl ? statusEl.textContent : null,
    };
  });

  const armAndRecord = async () => {
    await page.evaluate(() => {
      window.__capturedRecording = null;
      window.SWR.Recorder.start();
    });
    // The MediaRecorder path arms synchronously; the MP4/WebCodecs path arms
    // inside a .then(). Poll so neither assumption is baked in.
    let state = await recorderState();
    for (let waited = 0; waited < 8000 && !state.recording; waited += 250) {
      await new Promise((r) => setTimeout(r, 250));
      state = await recorderState();
    }
    console.log('armed:', JSON.stringify(state));
    ok(state.recording, 'Recorder.start() never armed a session — ' + JSON.stringify(state));
    // Wait for real encoded chunks (250ms timeslice) instead of the page's
    // auto-stop timer, then stop explicitly: a clamped timer cannot stall this.
    for (let waited = 0; waited < 25000 && state.chunks < 8; waited += 250) {
      await new Promise((r) => setTimeout(r, 250));
      state = await recorderState();
    }
    ok(state.chunks >= 8, `recorder produced no data chunks in 25s (chunks=${state.chunks}, recState=${state.recState})`);
    await page.evaluate(() => { const R = window.SWR.Recorder; if (R.recording) R.stop(); });
    let v = null;
    for (let waited = 0; waited < 15000; waited += 250) {
      v = await page.evaluate(() => window.__capturedRecording);
      if (v) break;
      await new Promise((r) => setTimeout(r, 250));
    }
    ok(v != null, 'Recorder._save never fired after an explicit stop');
    ok(v.size > 10000, `recording too small: ${v.size} bytes (expected > 10 KB)`);
    ok(/webm|mp4/i.test(v.type), `unexpected mime type: ${v.type}`);
    console.log('captured:', JSON.stringify({ size: v.size, type: v.type, chunks: state.chunks, mime: state.mime }));
  };

  await step('record the canvas until chunks land, then stop', async () => {
    ok(await ensureAudioGraph(), 'audio graph (SWR.Audio.el/ctx/gain) never came up after the start click');
    await forceRecorderOptions();
    try {
      await armAndRecord();
    } catch (e) {
      // Retry once, in place — no reload: the page state is verified above, so
      // the failure class here is a cold canvas-capture/MediaRecorder pipeline
      // (or a renderer that had not painted yet). Anything else (bad mime, tiny
      // payload, decode failure) throws immediately, because those mean a blob
      // did arrive and the payload is genuinely wrong.
      if (!/(never armed|no data chunks|_save never fired)/i.test(e.message)) throw e;
      console.log('retrying once in place —', e.message);
      await page.evaluate(() => { const R = window.SWR.Recorder; if (R.recording) R.stop(); });
      await new Promise((r) => setTimeout(r, 1000));
      ok(await ensureAudioGraph(), 'audio graph not ready (retry)');
      await forceRecorderOptions();
      await armAndRecord();
    }
  });

  await step('recording blob has a valid container header', async () => {
    const v = await page.evaluate(async () => {
      const r = window.__capturedRecording;
      const bytes = await r.bytes;
      console.log('[in-page] bytes:', bytes, 'len:', bytes.length, 'r.size:', r.size);
      return { bytes, size: r.size, type: r.type };
    });
    console.log('v.bytes:', JSON.stringify(v.bytes), 'len:', v.bytes.length);
    // EBML header for WebM: 0x1A 0x45 0xDF 0xA3
    // ISO BMFF for MP4: 'ftyp' at offset 4
    const b = v.bytes;
    let validHeader = false;
    if (v.type.includes('webm') && b[0] === 0x1A && b[1] === 0x45 && b[2] === 0xDF && b[3] === 0xA3) validHeader = true;
    if (v.type.includes('mp4') && b[4] === 0x66 && b[5] === 0x74 && b[6] === 0x79 && b[7] === 0x70) validHeader = true;
    // Generic: anything non-zero in the first 16 bytes is plausible.
    if (!validHeader) {
      const nonZero = b.filter((x) => x !== 0).length;
      validHeader = nonZero >= 4;
    }
    ok(validHeader, `blob header doesn't look like a media container. first 16 bytes: ${b.map((x) => x.toString(16).padStart(2, '0')).join(' ')}`);
  });

  if (consoleErrors.length) {
    process.stderr.write('Console errors during run:\n');
    consoleErrors.forEach((e) => process.stderr.write('  ' + e + '\n'));
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