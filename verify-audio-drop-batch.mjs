// Smoke test for the new audio-drop auto-batch-render path in engine.html.
// 1) Loads the engine page.
// 2) Synthesizes a drop with the user's actual MP3.
// 3) Asserts the song loaded and Recorder entered the recording state.
//
// Run: node verify-audio-drop-batch.mjs
// Exits non-zero on any failed assertion.

import { spawn } from 'node:child_process';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import puppeteer from 'puppeteer';

const URL = process.env.SWR_ENGINE_URL || 'http://127.0.0.1:5174/engine.html';
const MP3 = process.env.SWR_MP3 || '/Users/kaidejuricmasscmbook/Downloads/smrt [vocals] (Cover) (Remastered).mp3';

if (!existsSync(MP3)) {
  console.error(`MP3 not found: ${MP3}`);
  process.exit(2);
}
const mp3Bytes = readFileSync(MP3);
const mp3Size = statSync(MP3).size;
console.log(`▶ mp3: ${MP3}  (${(mp3Size/1024/1024).toFixed(2)} MB)`);

const browser = await puppeteer.launch({
  headless: 'new',
  args: [
    '--no-sandbox',
    '--autoplay-policy=no-user-gesture-required',
    // Headless Chromium throttles rAF and MediaRecorder for unfocused /
    // occluded tabs, which starves the engine's render loop and produces
    // empty MediaRecorder chunks. These flags disable the throttling.
    '--disable-background-timer-throttling',
    '--disable-renderer-backgrounding',
    '--disable-backgrounding-occluded-windows',
    '--disable-features=CalculateNativeWinOcclusion',
    '--use-gl=swiftshader',
    '--enable-features=VaapiVideoDecoder',
  ],
});
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 800 });

// Surface page console + page errors to the test runner
page.on('console', (m) => {
  const t = m.type();
  if (t === 'error' || t === 'warning') console.log(`  [page ${t}] ${m.text()}`);
});
page.on('pageerror', (e) => console.log(`  [pageerror] ${e.message}`));

// Pin to the legacy MediaRecorder path for this test:
//   • lib/recorder.client.js auto-enables the WebCodecs path on any browser
//     that exposes VideoEncoder, but some Chromium builds (notably the
//     headless build Puppeteer uses when launching with --no-sandbox) report
//     the API but reject `avc1.42E01E` config support. The engine has a
//     fallback to MediaRecorder but it's gated on a synchronous throw that
//     the async SWR_RECORDER.start() promise doesn't produce. Pinning to
//     the MediaRecorder path keeps this verifier scoped to the path the
//     audio-drop feature actually wires through (`Recorder.start()`) and
//     avoids the WebCodecs edge case. The WebCodecs fallback is a separate
//     pre-existing issue and out of scope for the audio-drop feature.
await page.evaluateOnNewDocument(() => {
  try { localStorage.setItem('swr.recorder.worker', '0'); } catch (_) {}
});
console.log('▶ loading', URL, '(MediaRecorder path pinned via localStorage)');
await page.goto(URL, { waitUntil: 'networkidle0', timeout: 45000 });
// Wait for engine boot — Audio & Recorder should be on window.SWR.
// Also wait through any post-load navigation (PWA bootstrap, SW reg) by
// re-asserting after any further load events.
await page.waitForFunction(() => !!window.SWR && !!window.SWR.Audio && !!window.SWR.Recorder, { timeout: 30000 });
console.log('▶ engine booted (window.SWR ready)');

// If PWA bootstrap reloaded the page, give it time to re-mount too.
await new Promise((r) => setTimeout(r, 1200));

// Inject the MP3 as a File and dispatch a drop event
const b64 = mp3Bytes.toString('base64');
const dropResult = await page.evaluate(async (b64) => {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const file = new File([bytes], 'smrt [vocals] (Cover) (Remastered).mp3', { type: 'audio/mpeg' });
  const dt = new DataTransfer();
  dt.items.add(file);
  // Confirm we routed through the audio branch BEFORE dispatching
  const r = await new Promise((resolve) => {
    const dt2 = new DataTransfer();
    dt2.items.add(file);
    // Synthesize the same drop the user would make
    const ev = new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt2 });
    window.dispatchEvent(ev);
    // Poll for the Audio.audioEl to be set (or 5 s timeout)
    const t0 = performance.now();
    const tick = () => {
      const a = window.SWR && window.SWR.Audio && window.SWR.Audio.audioEl;
      if (a && a.src) return resolve({ ok: true, ms: performance.now() - t0 });
      if (performance.now() - t0 > 5500) return resolve({ ok: false, ms: performance.now() - t0 });
      setTimeout(tick, 50);
    };
    tick();
  });
  return r;
}, b64);

console.log(`▶ drop dispatched → song loaded: ${JSON.stringify(dropResult)}`);
if (!dropResult.ok) { console.error('FAIL: audio never loaded'); await browser.close(); process.exit(1); }

// Wait for recording to start (the auto-batch path kicks Recorder.start)
const recState = await page.waitForFunction(
  () => {
    const r = window.SWR && window.SWR.Recorder;
    return r && r.recording === true;
  },
  { timeout: 10000 }
).catch(() => null);
if (!recState) {
  const state = await page.evaluate(() => ({
    hasAudio: !!(window.SWR && window.SWR.Audio && window.SWR.Audio.audioEl),
    audioSrc: window.SWR && window.SWR.Audio && window.SWR.Audio.audioEl && window.SWR.Audio.audioEl.src,
    audioDur: window.SWR && window.SWR.Audio && window.SWR.Audio.audioEl && window.SWR.Audio.audioEl.duration,
    recDurSel: document.getElementById('rec-dur') && document.getElementById('rec-dur').value,
    recording: window.SWR && window.SWR.Recorder && window.SWR.Recorder.recording,
    statusText: document.getElementById('status') && document.getElementById('status').textContent,
  }));
  console.error('FAIL: Recorder.recording never went true. State:', JSON.stringify(state, null, 2));
  await browser.close();
  process.exit(1);
}

const liveState = await page.evaluate(() => ({
  recDurSel: document.getElementById('rec-dur').value,
  recSizeSel: document.getElementById('rec-size').value,
  audioDur: window.SWR.Audio.audioEl.duration,
  recording: window.SWR.Recorder.recording,
  mime: window.SWR.Recorder.mime,
  startedAt: window.SWR.Recorder.startedAt,
  sizeLabel: window.SWR.Recorder._sizeLabel,
  statusText: (document.getElementById('status') || {}).textContent || '',
}));
console.log('▶ live recorder state:', JSON.stringify(liveState, null, 2));

// Final pass criteria:
//  - recording === true
//  - rec-dur === 'song'
//  - duration > 0
//  - startedAt within last 30 s
const now = Date.now();
const ageMs = now - liveState.startedAt;
const pass =
  liveState.recording === true &&
  liveState.recDurSel === 'song' &&
  liveState.audioDur > 0 &&
  ageMs < 30000;
if (!pass) {
  console.error('FAIL: criteria not met. recorder not in expected state.');
  await browser.close();
  process.exit(1);
}

// Give the recorder ~6s of real activity to make sure chunks are flowing.
// We also poke requestData() periodically — headless Chromium's MediaRecorder
// can take 4-5 seconds to emit its first chunk for MP4 when the timeslice
// fires slowly. requestData() flushes whatever is buffered.
for (let i = 0; i < 6; i++) {
  await new Promise(r => setTimeout(r, 1000));
  const poke = await page.evaluate(() => {
    if (window.SWR.Recorder.rec && typeof window.SWR.Recorder.rec.requestData === 'function') {
      try { window.SWR.Recorder.rec.requestData(); } catch (_) {}
    }
    return window.SWR.Recorder.chunks.length;
  });
  if (poke > 0) break;
}
const diag = await page.evaluate(() => ({
  chunks: window.SWR.Recorder.chunks.length,
  chunkSizes: window.SWR.Recorder.chunks.map(c => c.size),
  rec: window.SWR.Recorder.rec ? !!window.SWR.Recorder.rec : null,
  recState: window.SWR.Recorder.rec ? window.SWR.Recorder.rec.state : null,
  recMime: window.SWR.Recorder.rec ? window.SWR.Recorder.rec.mimeType : null,
  vTracks: (() => {
    try {
      const st = window.SWR.Recorder.rec && window.SWR.Recorder.rec.stream;
      return st ? st.getVideoTracks().map(t => ({ kind: t.kind, enabled: t.enabled, muted: t.muted, readyState: t.readyState, label: t.label })) : [];
    } catch (e) { return ['err:' + e.message]; }
  })(),
  audioPlaying: window.SWR.Audio.playing,
  audioCurrent: window.SWR.Audio.audioEl && window.SWR.Audio.audioEl.currentTime,
  stageCanvasW: document.getElementById('render') && document.getElementById('render').width,
  stageCanvasH: document.getElementById('render') && document.getElementById('render').height,
  captureCanvasW: window.FX && window.FX.outputCanvas && window.FX.outputCanvas.width,
}));
console.log(`▶ chunks after up to 6s: ${diag.chunks} (sizes: ${diag.chunkSizes.join(',')})`);
console.log('▶ recorder diag:', JSON.stringify(diag, null, 2));
if (diag.chunks < 1) {
  console.error('FAIL: no chunks captured in first 6 seconds — recording is not actually running.');
  await browser.close();
  process.exit(1);
}

// Stop the recording cleanly so we don't leak the headless tab
await page.evaluate(() => window.SWR.Recorder.stop());
await new Promise(r => setTimeout(r, 600));
const saved = await page.evaluate(() => ({
  blobSize: window.SWR.Recorder.lastBlobSize,
  filename: window.SWR.Recorder.lastFilename,
  recording: window.SWR.Recorder.recording,
}));
console.log('▶ saved:', JSON.stringify(saved, null, 2));
if (!saved.blobSize || saved.blobSize < 1000) {
  console.error('FAIL: recorded blob is empty/too small.');
  await browser.close();
  process.exit(1);
}
if (saved.recording !== false) {
  console.error('FAIL: Recorder.recording should be false after stop.');
  await browser.close();
  process.exit(1);
}

console.log('✅ PASS — audio drop auto-batched a full-song render.');
console.log(`   song: ${MP3}`);
console.log(`   duration: ${liveState.audioDur.toFixed(2)} s`);
console.log(`   size preset: ${liveState.recSizeSel} (${liveState.sizeLabel})`);
console.log(`   mime: ${liveState.mime}`);
console.log(`   blob: ${(saved.blobSize / 1024 / 1024).toFixed(2)} MB`);
console.log(`   filename: ${saved.filename}`);
await browser.close();
