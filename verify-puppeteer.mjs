// verify-puppeteer.mjs — end-to-end check for sainted-word-records
import puppeteer from '/Users/kajicadjuric/Documents/autodashboard/magenta-dsp-procedural/node_modules/puppeteer/lib/puppeteer/puppeteer.js';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const URL = 'http://localhost:5174/';

const assets = [
  '/Users/kajicadjuric/Documents/autodashboard/products/sainted-word-records/library/p01.jpg',
  '/Users/kajicadjuric/Documents/autodashboard/products/sainted-word-records/library/p02.png',
  '/Users/kajicadjuric/Documents/autodashboard/products/sainted-word-records/library/p03.jpg',
  '/Users/kajicadjuric/Documents/autodashboard/products/sainted-word-records/library/p04.jpg',
  '/Users/kajicadjuric/Documents/autodashboard/products/sainted-word-records/library/p05.jpg',
  '/Users/kajicadjuric/Documents/autodashboard/products/sainted-word-records/library/p06.jpg',
  '/Users/kajicadjuric/Documents/autodashboard/products/sainted-word-records/library/p07.jpg',
  '/Users/kajicadjuric/Documents/autodashboard/products/sainted-word-records/library/p08.jpg',
  '/Users/kajicadjuric/Documents/autodashboard/products/sainted-word-records/library/p09.jpg',
  '/Users/kajicadjuric/Documents/autodashboard/products/sainted-word-records/library/p10.jpg',
  '/Users/kajicadjuric/Documents/autodashboard/products/sainted-word-records/library/p11.jpg',
  '/Users/kajicadjuric/Documents/autodashboard/products/sainted-word-records/library/p12.jpg',
  '/Users/kajicadjuric/Documents/autodashboard/products/sainted-word-records/library/p13.jpg',
  '/Users/kajicadjuric/Documents/autodashboard/products/sainted-word-records/library/p14.jpg',
  '/Users/kajicadjuric/Documents/autodashboard/products/sainted-word-records/library/p15.jpg',
];

const consoleErrors = [];
const pageErrors = [];

const browser = await puppeteer.launch({
  headless: 'new',
  args: ['--no-sandbox', '--disable-setuid-sandbox', '--use-fake-ui-for-media-stream'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 900 });
page.on('console', m => { if (m.type() === 'error') consoleErrors.push(m.text()); });
page.on('requestfailed', r => console.log('request failed:', r.url(), r.failure().errorText));
page.on('response', r => { if (r.status() >= 400) console.log('response', r.status(), r.url()); });
page.on('pageerror', e => pageErrors.push(String(e)));

// 1. Page loads
await page.goto(URL, { waitUntil: 'networkidle0', timeout: 15000 });
await new Promise(r => setTimeout(r, 1500));

// 2. Status pill should be green ('ready' or 'audio live')
const status = await page.$eval('#status-pill', el => el.textContent);
const statusClass = await page.$eval('#status-pill', el => el.className);
console.log('status:', JSON.stringify(status), 'class:', statusClass);

// 3. Library empty hint visible
const libEmpty = await page.$('.lib-empty');
console.log('library empty placeholder present:', !!libEmpty);

// 4. Drop sample assets via the hidden file input
const input = await page.$('#asset-input');
await input.evaluate(el => { el.style.display = 'block'; });
await input.uploadFile(...assets);
await new Promise(r => setTimeout(r, 2500));

// 5. Library should have items now
const libCount = await page.$$eval('.lib-item', els => els.length);
console.log('library items after drop:', libCount);

// 6. Click RE-MAP
await page.click('#re-map');
await new Promise(r => setTimeout(r, 1500));
const layerCount = await page.$$eval('.layer', els => els.length);
console.log('layers after remap:', layerCount);

// Debug: inspect library + first asset classifications
const debug = await page.evaluate(() => {
  return {
    itemCount: window.SWR.Library.items.length,
    items: window.SWR.Library.items.map(i => ({ id: i.id, name: i.name, size: i.blob ? i.blob.size : 0, motion: i.motion, luma: i.luma, hue: i.hue, w: i.w, h: i.h })),
    layers: window.SWR.Layers.list.map(l => ({ id: l.id, asset: l.asset ? l.asset.name : null, assetId: l.asset ? l.asset.id : null, reactors: l.reactors.length })),
  };
});
console.log('debug:', JSON.stringify(debug, null, 2));

// 7. Verify canvas is rendering (non-empty pixels)
const canvasInfo = await page.evaluate(() => {
  const c = document.getElementById('render');
  const cx = c.getContext('2d');
  const d = cx.getImageData(0, 0, c.width, c.height).data;
  // Sample 200 random pixels and count non-zero
  let nonBlack = 0;
  const N = 200;
  for (let i = 0; i < N; i++) {
    const off = (Math.floor(Math.random() * (d.length / 4)) * 4);
    if (d[off] > 5 || d[off+1] > 5 || d[off+2] > 5) nonBlack++;
  }
  return { w: c.width, h: c.height, nonBlack, sampled: N };
});
console.log('canvas sample:', canvasInfo);

// 8. Verify FPS counter updates
await new Promise(r => setTimeout(r, 1500));
const fps = await page.$eval('#fps-v', el => el.textContent);
console.log('fps after 1.5s:', fps);

// 9. Take a screenshot
const out = path.join(__dirname, 'verify-screenshot.png');
await page.screenshot({ path: out, fullPage: false });
console.log('screenshot:', out);

// 10. Verify the engine actually reacts to audio by routing a synthetic
// beat (oscillator + kick) through the Web Audio analyser.
const reactTest = await page.evaluate(async () => {
  // Unlock the audio context by calling the engine's unlock
  window.SWR.Audio.unlock();
  const ctx = window.SWR.Audio.ctx;
  const analyser = window.SWR.Audio.analyser;
  if (!ctx || !analyser) return { error: 'no audio context' };
  // Build a 120 BPM kick + hi-hat + bass pattern
  const dest = ctx.createGain();
  dest.gain.value = 0.6;
  dest.connect(analyser);
  const bpm = 120;
  const beatDur = 60 / bpm;
  const start = ctx.currentTime + 0.05;
  // Schedule 16 beats
  const samples = [];
  for (let i = 0; i < 16; i++) {
    const t = start + i * beatDur;
    // kick: low sine
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = 'sine';
    o.frequency.setValueAtTime(120, t);
    o.frequency.exponentialRampToValueAtTime(40, t + 0.12);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(1.0, t + 0.005);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.2);
    o.connect(g).connect(dest);
    o.start(t); o.stop(t + 0.22);
    // hihat: high noise burst
    if (i % 2 === 0) {
      const o2 = ctx.createOscillator();
      const g2 = ctx.createGain();
      o2.type = 'square';
      o2.frequency.value = 8000;
      g2.gain.setValueAtTime(0, t + 0.25);
      g2.gain.linearRampToValueAtTime(0.2, t + 0.255);
      g2.gain.exponentialRampToValueAtTime(0.001, t + 0.3);
      o2.connect(g2).connect(dest);
      o2.start(t + 0.25); o2.stop(t + 0.32);
    }
  }
  // Sample features across the pattern
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  await sleep(200);
  // Sample for 2 seconds (should hit ~4 beats)
  const samples2 = [];
  for (let i = 0; i < 20; i++) {
    window.SWR.Audio.sample();
    samples2.push({ ...window.SWR.Audio.feat });
    await sleep(100);
  }
  // Stats
  const maxBass = Math.max(...samples2.map(s => s.bass));
  const avgBass = samples2.reduce((a, s) => a + s.bass, 0) / samples2.length;
  const maxBeat = Math.max(...samples2.map(s => s.beat));
  const beatPulses = samples2.filter(s => s.beatPulse).length;
  const onsetPulses = samples2.filter(s => s.onsetPulse).length;
  return { maxBass, avgBass, maxBeat, beatPulses, onsetPulses, sampleCount: samples2.length };
});
console.log('audio react test:', reactTest);

// 11. Verify canvas pixel change over time (reactivity proxy).
// Sample 200 random pixels from across the whole canvas.
const before = await page.evaluate(() => {
  const c = document.getElementById('render');
  const cx = c.getContext('2d');
  const d = cx.getImageData(0, 0, c.width, c.height).data;
  const out = [];
  for (let i = 0; i < 200; i++) {
    const off = (Math.floor(Math.random() * (d.length / 4)) * 4);
    out.push(d[off], d[off+1], d[off+2]);
  }
  return out;
});
await new Promise(r => setTimeout(r, 400));
const after = await page.evaluate(() => {
  const c = document.getElementById('render');
  const cx = c.getContext('2d');
  const d = cx.getImageData(0, 0, c.width, c.height).data;
  const out = [];
  for (let i = 0; i < 200; i++) {
    const off = (Math.floor(Math.random() * (d.length / 4)) * 4);
    out.push(d[off], d[off+1], d[off+2]);
  }
  return out;
});
let diff = 0;
for (let i = 0; i < before.length; i++) if (Math.abs(before[i] - after[i]) > 5) diff++;
console.log('canvas pixel diff (600 sample-bytes over 400ms):', diff, '/', before.length, `(${((diff/before.length)*100).toFixed(1)}%)`);

console.log('---');
console.log('console errors:', consoleErrors.length);
consoleErrors.forEach(e => console.log('  •', e));
console.log('page errors:', pageErrors.length);
pageErrors.forEach(e => console.log('  •', e));

await browser.close();
process.exit(consoleErrors.length || pageErrors.length ? 1 : 0);
