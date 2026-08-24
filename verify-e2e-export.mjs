// verify-e2e-export.mjs — full pipeline: load audio + library → play → record → verify MP4
import puppeteer from '/Users/kajicadjuric/Documents/autodashboard/magenta-dsp-procedural/node_modules/puppeteer/lib/puppeteer/puppeteer.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DL = '/tmp/swr-recordings';
fs.rmSync(DL, { recursive: true, force: true });
fs.mkdirSync(DL, { recursive: true });

const browser = await puppeteer.launch({
  headless: 'new',
  args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 900 });

// Allow downloads to disk
const client = await page.target().createCDPSession();
await client.send('Browser.setDownloadBehavior', {
  behavior: 'allow',
  downloadPath: DL,
});

const errs = [];
page.on('pageerror', e => errs.push(String(e)));
page.on('console', m => { if (m.type() === 'error') errs.push('console: ' + m.text()); });

// Helper: build a synthetic 6s WAV (120 BPM kick loop)
const wavBuffer = await page.evaluate(() => {
  const sr = 44100, dur = 6, bpm = 120, beat = 60 / bpm;
  const N = Math.floor(sr * dur);
  const buf = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    const t = i / sr;
    const phase = (t % beat) / beat;
    const env = Math.exp(-phase * 14) * (phase < 0.05 ? 1 : Math.exp(-(phase - 0.05) * 3));
    const freq = 80 * Math.exp(-phase * 6) + 30;
    buf[i] = Math.sin(2 * Math.PI * freq * t) * env * 0.6;
  }
  const audioBuf = new (window.AudioContext || window.webkitAudioContext)().createBuffer(1, N, sr);
  audioBuf.copyToChannel(buf, 0);
  const numCh = 1, len = N * numCh * 2 + 44;
  const ab = new ArrayBuffer(len);
  const view = new DataView(ab);
  const channels = [audioBuf.getChannelData(0)];
  let p = 0;
  const write = (s) => { for (let i = 0; i < s.length; i++) view.setUint8(p++, s.charCodeAt(i)); };
  write('RIFF'); view.setUint32(p, len - 8, true); p += 4;
  write('WAVE'); write('fmt '); view.setUint32(p, 16, true); p += 4;
  view.setUint16(p, 1, true); p += 2; view.setUint16(p, numCh, true); p += 2;
  view.setUint32(p, sr, true); p += 4;
  view.setUint32(p, sr * numCh * 2, true); p += 4;
  view.setUint16(p, numCh * 2, true); p += 2; view.setUint16(p, 16, true); p += 2;
  write('data'); view.setUint32(p, N * numCh * 2, true); p += 4;
  for (let i = 0; i < N; i++) for (let c = 0; c < numCh; c++) {
    const s = Math.max(-1, Math.min(1, channels[c][i]));
    view.setInt16(p, s < 0 ? s * 0x8000 : s * 0x7FFF, true); p += 2;
  }
  return Array.from(new Uint8Array(ab));
});
const wavPath = path.join(DL, 'synth.wav');
fs.writeFileSync(wavPath, Buffer.from(wavBuffer));

// 1. Load main engine
await page.goto('http://localhost:5174/', { waitUntil: 'domcontentloaded' });
await new Promise(r => setTimeout(r, 1500));
console.log('1. Engine loaded');

// 2. Upload the WAV
const songInput = await page.$('#song-input');
await songInput.uploadFile(wavPath);
await new Promise(r => setTimeout(r, 1500));
const songName = await page.$eval('#song-name', el => el.textContent);
console.log('2. Song loaded:', songName);

// 3. Wait for library to auto-load (27 items via manifest)
await new Promise(r => setTimeout(r, 6000));
const itemCount = await page.evaluate(() => window.SWR.Library.items.length);
console.log('3. Library items:', itemCount);

// 4. RE-MAP
await page.click('#re-map');
await new Promise(r => setTimeout(r, 1500));
const layerCount = await page.evaluate(() => window.SWR.Layers.list.length);
console.log('4. Layers after remap:', layerCount);

// 5. Click PLAY
await page.click('#play');
await new Promise(r => setTimeout(r, 1500));
const isPlaying = await page.evaluate(() => window.SWR.Audio.playing);
console.log('5. Audio playing:', isPlaying);

// 6. Click REC
const recButton = await page.$('#rec');
const recTextBefore = await page.$eval('#rec', el => el.textContent);
console.log('6a. REC button before:', recTextBefore);
await recButton.click();
await new Promise(r => setTimeout(r, 800));
const recTextAfter = await page.$eval('#rec', el => el.textContent);
const recClass = await page.$eval('#rec', el => el.className);
const status = await page.$eval('#status-pill', el => el.textContent);
console.log('6b. REC button after click:', recTextAfter, '| class:', recClass, '| status:', status);

// 7. Record for 4 seconds
console.log('7. Recording 4 seconds...');
await new Promise(r => setTimeout(r, 4000));

// 8. Click STOP
await page.click('#rec');
console.log('8. STOP clicked, waiting for save...');
await new Promise(r => setTimeout(r, 3000));

// 9. Find the downloaded file
const files = fs.readdirSync(DL);
const mp4 = files.find(f => f.endsWith('.mp4'));
const webm = files.find(f => f.endsWith('.webm'));
const wav = files.find(f => f.endsWith('.wav'));
console.log('9. Files in download dir:', files);

let result = { ok: false };
if (mp4) {
  const stats = fs.statSync(path.join(DL, mp4));
  const head = fs.readFileSync(path.join(DL, mp4), { encoding: null }).slice(0, 32);
  // Check for 'ftyp' box at offset 4 (MP4 signature)
  const ftypOffset = head.indexOf('ftyp');
  result = { ok: true, file: mp4, size: stats.size, ftypOffset, format: 'mp4' };
} else if (webm) {
  const stats = fs.statSync(path.join(DL, webm));
  result = { ok: true, file: webm, size: stats.size, format: 'webm' };
} else {
  result = { ok: false, errs };
}

console.log('RESULT:', JSON.stringify(result, null, 2));

// 10. Capture screenshot of the engine after recording
await page.screenshot({ path: '/Users/kajicadjuric/Documents/autodashboard/products/sainted-word-records/verify-screenshots/after-rec.png' });

await browser.close();
process.exit(result.ok && result.ftypOffset > 0 ? 0 : 1);
