#!/usr/bin/env node
// scripts/check-mv-f-smoke.mjs — Phase F (Phase 6 of plan-doc) end-to-end
// smoke for the music_video.html hologram pipeline. Boots Puppeteer against
// a static server on dist/, opens versions/music_video.html, and asserts:
//
//   1. window.SWR_HOLOGRAM_STATE is exposed with the extended shape (focus,
//      features, focusAmount, hidden, _audio, _ready) and depth defaulting
//      to 0.5.
//   2. window.__SWR_HOLOGRAM is built with 16 manifest presets
//      (SWR_HOLOGRAM.build result, presetMap.list().length === 16).
//   3. HologramState._ready is true (manifest XHR succeeded).
//   4. Synthetic WAV file drop → SWR_TRACK_ANALYZE promise resolves within
//      5s → HologramState._audio has chromagram + features populated.
//   5. Pressing ArrowRight on the page changes HologramState.focus (was null,
//      now non-null).
//   6. Pressing '0' resets depth to 0.5 and clears focus.
//   7. Pressing 'h' toggles HologramState.hidden.
//   8. The gradient canvas has rendered (non-zero non-background pixels).
//   9. SWR_HOLOGRAM_KEYS.install ran (window.SWR_HOLOGRAM_KEYS exists and
//      is callable).
//
// Run:  node scripts/check-mv-f-smoke.mjs
//
// Dist must already be built (npm run build). We boot a tiny static
// server on :5181 (one off :5180 which the existing check-mv-smoke uses).

import puppeteer from 'puppeteer';
import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'dist');
const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.gif': 'image/gif', '.wav': 'audio/wav', '.mp3': 'audio/mpeg',
  '.mp4': 'video/mp4', '.webm': 'video/webm',
};
const server = http.createServer((req, res) => {
  let rel = decodeURIComponent(req.url.split('?')[0].replace(/^\/+/, '')) || 'index.html';
  if (rel === 'app' || rel === 'app/') rel = 'swr-app.html';
  const full = path.join(ROOT, rel);
  if (!full.startsWith(ROOT)) { res.writeHead(403); return res.end('forbidden'); }
  fs.readFile(full, (err, buf) => {
    if (err) { res.writeHead(404); return res.end('not found'); }
    const ext = path.extname(full).toLowerCase();
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    res.end(buf);
  });
});

const PORT = 5181;

// Build a tiny 1-second 440Hz mono WAV (sampleRate 22050, 16-bit PCM).
// 22050 samples × 2 bytes = 44100 bytes per channel × 1 channel.
function makeTestWav(durationSec = 1, freq = 440, sampleRate = 22050) {
  const numSamples = durationSec * sampleRate;
  const dataSize = numSamples * 2; // 16-bit mono
  const buf = Buffer.alloc(44 + dataSize);
  // RIFF header
  buf.write('RIFF', 0);
  buf.writeUInt32LE(36 + dataSize, 4);
  buf.write('WAVE', 8);
  // fmt sub-chunk
  buf.write('fmt ', 12);
  buf.writeUInt32LE(16, 16);          // PCM chunk size
  buf.writeUInt16LE(1, 20);           // PCM format
  buf.writeUInt16LE(1, 22);           // mono
  buf.writeUInt32LE(sampleRate, 24);  // sample rate
  buf.writeUInt32LE(sampleRate * 2, 28); // byte rate
  buf.writeUInt16LE(2, 32);           // block align
  buf.writeUInt16LE(16, 34);          // bits per sample
  // data sub-chunk
  buf.write('data', 36);
  buf.writeUInt32LE(dataSize, 40);
  // samples
  for (let i = 0; i < numSamples; i++) {
    const v = Math.sin(2 * Math.PI * freq * i / sampleRate);
    const sample = Math.max(-1, Math.min(1, v)) * 0x7FFF;
    buf.writeInt16LE(sample | 0, 44 + i * 2);
  }
  return buf;
}

let failures = 0;
function assert(cond, msg) {
  if (cond) { console.log('  ✓', msg); }
  else      { console.log('  ✗', msg); failures++; }
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

(async () => {
  await new Promise(r => server.listen(PORT, r));
  console.log(`[mv-f-smoke] static server listening on :${PORT}`);

  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
  });
  const page = await browser.newPage();
  page.on('pageerror', e => console.log('  [page error]', e.message));
  page.on('console', m => { if (m.type() === 'error') console.log('  [console.error]', m.text()); });

  await page.goto(`http://localhost:${PORT}/versions/music_video.html`, { waitUntil: 'networkidle0', timeout: 30000 });
  // Let the inline IIFE finish and the sync XHR resolve.
  await sleep(500);

  page.on('pageerror', e => console.log('  [pageerror]', e.message));
  page.on('console', m => { if (m.type() === 'error') console.log('  [console.error]', m.text()); });

  console.log('\n=== boot: HologramState shape ===');
  const boot = await page.evaluate(async () => {
    const s = window.SWR_HOLOGRAM_STATE;
    const holo = window.__SWR_HOLOGRAM;
    let manifestDiag = { tried: false };
    try {
      const r = await fetch('../presets/manifest.json');
      const t = await r.text();
      manifestDiag = {
        tried: true,
        ok: r.ok,
        status: r.status,
        ct: r.headers.get('content-type'),
        textLen: t.length,
        head: t.slice(0, 80),
      };
    } catch (e) {
      manifestDiag.err = String(e);
    }
    return { manifestDiag,
      hasState: !!s,
      depth: s ? s.depth : null,
      neighbours: s ? s.neighbours : null,
      focus: s ? s.focus : null,
      features: s ? s.features : null,
      focusAmount: s ? s.focusAmount : null,
      hidden: s ? s.hidden : null,
      _audio: s ? !!s._audio : null,
      _ready: s ? s._ready : null,
      _error: s ? s._error : null,
      hologramInstalled: !!(window.SWR_HOLOGRAM && window.SWR_HOLOGRAM_INSTALL
                          && window.SWR_HOLOGRAM_KEYS),
      presetCount: holo && holo.presetMap ? holo.presetMap.list().length : 0,
      presetSample: holo && holo.presetMap ? holo.presetMap.list().slice(0, 3) : null,
      synthPillText: document.getElementById('synth-pill') ? document.getElementById('synth-pill').textContent.trim() : null,
    };
  });
  console.log('  [manifest diag]', JSON.stringify(boot.manifestDiag));

  assert(boot.hasState, 'window.SWR_HOLOGRAM_STATE is exposed');
  assert(boot.depth === 0.5, `HologramState.depth === 0.5 (got ${boot.depth})`);
  assert(boot.neighbours === 4, `HologramState.neighbours === 4 (got ${boot.neighbours})`);
  assert(boot.focus === null, `HologramState.focus starts null (got ${JSON.stringify(boot.focus)})`);
  assert(boot.features === null, `HologramState.features starts null (got ${JSON.stringify(boot.features)})`);
  assert(boot._ready === true, `HologramState._ready === true after sync XHR (got ${boot._ready} err=${boot._error})`);
  assert(boot._error === null, `HologramState._error is null (got ${boot._error})`);
  assert(boot.hologramInstalled, 'window.SWR_HOLOGRAM + INSTALL + KEYS all installed');
  assert(boot.presetCount === 16, `manifest exposes 16 presets (got ${boot.presetCount})`);
  assert(boot.presetSample && boot.presetSample.length === 3,
    `preset list returns ids (got ${JSON.stringify(boot.presetSample)})`);
  assert(boot.synthPillText && boot.synthPillText.includes('no track'),
    `synth pill says "no track" before any drop (got ${JSON.stringify(boot.synthPillText)})`);

  console.log('\n=== gradient canvas paints ===');
  const paint = await page.evaluate(() => {
    const cv = document.getElementById('gradient');
    if (!cv) return null;
    const ctx = cv.getContext('2d');
    const data = ctx.getImageData(0, 0, cv.width, cv.height).data;
    let coloured = 0, totalNonBlack = 0;
    for (let i = 0; i < data.length; i += 4) {
      const r = data[i], g = data[i+1], b = data[i+2];
      if (r || g || b) totalNonBlack++;
      // magenta from hologram dots: R>80, B>80, G<R
      if (r > 80 && b > 80 && g < r) coloured++;
    }
    return { coloured, totalNonBlack, canvasW: cv.width, canvasH: cv.height };
  });
  assert(paint && paint.totalNonBlack > 100,
    `gradient canvas has rendered pixels (got ${paint && paint.totalNonBlack} non-black)`);
  assert(paint && paint.canvasW === 216 && paint.canvasH === 216,
    `gradient canvas is 216x216 (got ${paint && paint.canvasW}x${paint && paint.canvasH})`);

  console.log('\n=== synthetic WAV drop → audio analysis ===');
  const wavPath = path.join(path.dirname(fileURLToPath(import.meta.url)), 'check-mv-f-input.wav');
  fs.writeFileSync(wavPath, makeTestWav());
  const inputHandle = await page.$('input#song-input');
  assert(!!inputHandle, 'input#song-input exists in the DOM');
  if (inputHandle) {
    await inputHandle.uploadFile(wavPath);
    // Wait up to 20s for SWR_TRACK_ANALYZE to resolve and the state
    // to populate. Headless Chromium decodeAudioData on a synthetic
    // WAV is slow (~10s+ in the swiftshader path), and we don't
    // want a CI flake.
    let audioResult = null;
    for (let i = 0; i < 200; i++) {
      audioResult = await page.evaluate(() => {
        const s = window.SWR_HOLOGRAM_STATE;
        return {
          stateError: s ? s._error : 'no-state',
          hasAudio: !!(s && s._audio),
          hasFeatures: !!(s && s.features),
          songInput: !!document.getElementById('song-input'),
          analyzeFn: typeof window.SWR_TRACK_ANALYZE,
        };
      });
      if (audioResult && audioResult.hasAudio) break;
      await sleep(100);
    }
    assert(audioResult && audioResult.hasAudio, 'SWR_TRACK_ANALYZE resolved within 20s of file drop');
    if (audioResult && audioResult.hasAudio) {
      const detail = await page.evaluate(() => {
        const a = window.SWR_HOLOGRAM_STATE._audio;
        const f = window.SWR_HOLOGRAM_STATE.features;
        return {
          duration: a.duration, bpm: a.bpm, centroid: a.centroid,
          dynamicRange: a.dynamicRange, onsetDensity: a.onsetDensity,
          mood: f && f.mood,
        };
      });
      assert(typeof detail.duration === 'number' && detail.duration > 0.5,
        `audio.duration is a positive number (got ${detail.duration})`);
      assert(typeof detail.mood === 'number',
        `HologramState.features has a mood vector (${detail.mood})`);
    }
  }

  console.log('\n=== keyboard: ArrowRight cycles focus ===');
  // ArrowRight on a fresh state focus=null. The cycleFocus code path:
  //   no current focus + direction +1 returns the lowest-mood preset.
  await page.focus('body');
  await page.keyboard.press('ArrowRight');
  await sleep(50);
  const afterArrow = await page.evaluate(() => {
    const s = window.SWR_HOLOGRAM_STATE;
    return s ? s.focus : null;
  });
  assert(typeof afterArrow === 'string' && afterArrow.length > 0,
    `ArrowRight sets HologramState.focus to a preset id (got ${JSON.stringify(afterArrow)})`);

  console.log('\n=== keyboard: "0" resets ===');
  await page.focus('body');
  await page.keyboard.press('0');
  await sleep(50);
  const after0 = await page.evaluate(() => {
    const s = window.SWR_HOLOGRAM_STATE;
    return s ? { depth: s.depth, focus: s.focus, focusAmount: s.focusAmount } : null;
  });
  assert(after0 && after0.depth === 0.5,
    `"0" resets depth to 0.5 (got ${after0 && after0.depth})`);
  assert(after0 && after0.focus === undefined,
    `"0" clears focus (got ${after0 && after0.focus})`);
  assert(after0 && after0.focusAmount === 0,
    `"0" clears focusAmount (got ${after0 && after0.focusAmount})`);

  console.log('\n=== keyboard: "h" toggles panel hidden ===');
  await page.focus('body');
  const hiddenBefore = await page.evaluate(() => window.SWR_HOLOGRAM_STATE.hidden);
  await page.keyboard.press('h');
  await sleep(50);
  const hiddenAfter1 = await page.evaluate(() => window.SWR_HOLOGRAM_STATE.hidden);
  await page.keyboard.press('h');
  await sleep(50);
  const hiddenAfter2 = await page.evaluate(() => window.SWR_HOLOGRAM_STATE.hidden);
  assert(hiddenAfter1 === !hiddenBefore,
    `"h" toggles hidden once (was ${hiddenBefore}, now ${hiddenAfter1})`);
  assert(hiddenAfter2 === hiddenBefore,
    `"h" toggles hidden back (was ${hiddenBefore}, now ${hiddenAfter2})`);

  console.log('\n=== keyboard: "3" sets depth to 0.3 ===');
  await page.focus('body');
  await page.keyboard.press('3');
  await sleep(50);
  const depth3 = await page.evaluate(() => window.SWR_HOLOGRAM_STATE.depth);
  assert(depth3 === 0.3,
    `"3" sets depth to 0.3 (got ${depth3})`);

  fs.unlinkSync(wavPath);
  await browser.close();
  server.close();

  console.log('\n' + (failures === 0
    ? 'MV F SMOKE: ALL GREEN'
    : `MV F SMOKE: ${failures} failure(s)`));
  process.exit(failures === 0 ? 0 : 1);
})().catch(e => {
  console.error(e);
  server.close();
  process.exit(2);
});
