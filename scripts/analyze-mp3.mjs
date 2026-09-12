// scripts/analyze-mp3.mjs — load an MP3/WAV in a headless browser, run the
// in-repo audio-analysis-v2.js over the decoded buffer, print JSON.
//
// Usage:
//   node scripts/analyze-mp3.mjs <input.mp3|wav> [input2.mp3 ...]
//
// Each input prints one JSON line to stdout.

import http from 'http';
import fs from 'fs';
import path from 'path';
import puppeteer from 'puppeteer';

const ROOT = process.cwd();
const PORT = 8103;
const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.css': 'text/css', '.json': 'application/json',
  '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.flac': 'audio/flac',
  '.m4a': 'audio/mp4', '.ogg': 'audio/ogg',
};
const server = http.createServer((req, res) => {
  const rel = decodeURIComponent(req.url.split('?')[0].replace(/^\/+/, '')) || 'index.html';
  const file = path.join(ROOT, rel);
  if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404); res.end('nf'); return;
  }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
});
await new Promise((r) => server.listen(PORT, r));

const inputs = process.argv.slice(2);
if (inputs.length === 0) {
  console.error('usage: node scripts/analyze-mp3.mjs <input.mp3|wav> ...');
  process.exit(2);
}

let browser;
try {
  browser = await puppeteer.launch({
    headless: 'new',
    args: [
      '--no-sandbox', '--disable-setuid-sandbox',
      '--autoplay-policy=no-user-gesture-required',
      '--use-gl=angle', '--use-angle=swiftshader', '--enable-webgl',
      '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader',
    ],
    defaultViewport: { width: 640, height: 360 },
  });
  const page = await browser.newPage();
  await page.goto(`http://127.0.0.1:${PORT}/scripts/_analyze-stub.html`, { waitUntil: 'networkidle0', timeout: 30000 });
  await page.waitForFunction(() => typeof window.__analyzeBlob === 'function', { timeout: 15000 });

  for (const arg of inputs) {
    const abs = path.resolve(arg);
    if (!fs.existsSync(abs)) { console.error(`skip: ${arg} not found`); continue; }
    const buf = fs.readFileSync(abs);
    // CDP serializes typed arrays as ArrayBuffer views; decodeAudioData
    // is strict about receiving a plain ArrayBuffer. Read the file into
    // a Uint8Array then copy into a fresh ArrayBuffer so the type is
    // exactly what the browser API expects.
    const u8 = new Uint8Array(buf);
    const ab = u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength);
    try {
      const analysis = await page.evaluate(async (b64) => {
        // Decode base64 -> Uint8Array -> fresh ArrayBuffer.
        // decodeAudioData rejects transferred ArrayBuffer views; using
        // base64 sidesteps the CDP type-marshalling entirely.
        const bin = atob(b64);
        const u8 = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
        return await window.__analyzeBlob(u8.buffer);
      }, buf.toString('base64'));
      const feat = deriveFeatures(analysis);
      const out = { input: path.basename(abs), ...analysis, features: feat };
      process.stdout.write(JSON.stringify(out) + '\n');
    } catch (e) {
      console.error(`fail: ${arg}: ${e.message}`);
    }
  }
} finally {
  if (browser) await browser.close();
  server.close();
}

// Mirror the bucketing the variant picker uses, exposed in the JSON so
// downstream consumers can see which buckets fired without re-running the
// picker.
function deriveFeatures(a) {
  const bpm = a.bpm || 0;
  const dur = Math.max(0.01, a.duration || 0);
  const onsetRate = (a.onsetCount || 0) / dur;
  const chroma = a.chromagram || [];
  let mean = 0;
  for (const v of chroma) mean += v;
  mean /= 12;
  let variance = 0;
  for (const v of chroma) variance += (v - mean) ** 2;
  variance /= 12;
  // Sharp keys: C, G, D, A, E, B (major often; minor variants too).
  const KEY_TO_IDX = { C:0, 'C#':1, D:2, 'D#':3, E:4, F:5, 'F#':6, G:7, 'G#':8, A:9, 'A#':10, B:11 };
  const synthChroma = (chroma[KEY_TO_IDX.A] || 0) + (chroma[KEY_TO_IDX.E] || 0) + (chroma[KEY_TO_IDX.D] || 0);
  return {
    bpmBucket: bpm === 0 ? 'unknown' : (bpm < 90 ? 'lo' : bpm <= 140 ? 'mid' : 'hi'),
    scale: a.scale,
    energyBucket: onsetRate < 0.5 ? 'lo' : onsetRate <= 2 ? 'mid' : 'hi',
    onsetRate,
    chromaVariance: variance,
    synthChroma,
    beatStrength: a.confidence * Math.min(onsetRate / 2, 1),
  };
}