#!/usr/bin/env node
// scripts/diag-gradient-diff.mjs — quick test: does music_video produce
// visually distinct output for different audio inputs?
//
// Approach: load music_video.html once, swap audio sources via the same
// file input, take CDP screenshots at known audio currentTimes, compare
// frame byte-identity. If the gradient engine actually synthesizes a
// distinct preset per track, frames at the same audio time will differ.
// If it's a static gradient driven only by audio features, they'll differ
// in feature-space but pixel-identical in the no-feature case.

import http from 'http';
import fs from 'fs';
import path from 'path';
import crypto from 'node:crypto';
import puppeteer from 'puppeteer';

const ROOT = process.cwd();
const PORT = 8105;
const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.css': 'text/css', '.wav': 'audio/wav', '.mp3': 'audio/mpeg',
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

const tracks = process.argv.slice(2);
if (tracks.length < 2) { console.error('need 2+ tracks to compare'); process.exit(2); }

let browser;
let client;
try
{
  browser = await puppeteer.launch({
    headless: 'new',
    args: [
      '--no-sandbox', '--disable-setuid-sandbox',
      '--autoplay-policy=no-user-gesture-required',
      '--use-gl=angle', '--use-angle=swiftshader', '--enable-webgl',
      '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader',
      '--disable-background-timer-throttling',
      '--disable-renderer-backgrounding',
      '--disable-backgrounding-occluded-windows',
      '--disable-features=IntensiveWakeUpThrottling',
    ],
    defaultViewport: { width: 640, height: 360 },
  });
  const page = await browser.newPage();
  client = await page.target().createCDPSession();
  await page.evaluateOnNewDocument(() => {
    try { localStorage.removeItem('swr.audio.armed'); } catch (_) {}
    try { localStorage.setItem('swr.recorder.worker', '0'); } catch (_) {}
  });
  await page.goto(`http://127.0.0.1:${PORT}/versions/music_video.html`, { waitUntil: 'domcontentloaded', timeout: 30000 });
  for (let i = 0; i < 30; i++) {
    const ok = await page.evaluate(() => !!(window.SWR && window.SWR.Audio && window.SWR.Layers));
    if (ok) break;
    await new Promise((r) => setTimeout(r, 250));
  }
  console.log('engine ready');

  const samples = {};
  const SAMPLE_TIMES = [0.5, 2.0, 5.0, 8.0, 12.0]; // seconds into audio
  const songDurations = [];

  for (const track of tracks) {
    const name = path.basename(track);
    console.log(`\n--- ${name} ---`);
    const fileInput = await page.$('#song-input');
    await fileInput.uploadFile(track);
    for (let i = 0; i < 80; i++) {
      const v = await page.evaluate(() => {
        const A = window.SWR.Audio;
        const el = A && (A.audioEl || A.el);
        return { el: !!el, rs: el ? el.readyState : 0, dur: el ? el.duration : 0 };
      });
      if (v.el && v.rs >= 1 && v.dur > 0) { songDurations.push(v.dur); break; }
      await new Promise((r) => setTimeout(r, 200));
    }
    await page.click('#play').catch(() => {});
    await page.evaluate(() => {
      const b = document.getElementById('play');
      if (b) b.click();
      const A = window.SWR.Audio;
      if (A && A.play) A.play();
    });
    // Wait until playback confirmed
    for (let i = 0; i < 30; i++) {
      await new Promise((r) => setTimeout(r, 200));
      const v = await page.evaluate(() => {
        const A = window.SWR.Audio;
        const el = A && (A.audioEl || A.el);
        return el && !el.paused && el.currentTime > 0.05;
      });
      if (v) break;
    }
    // Sample frames at the same audio times across all tracks.
    // Don't pause — let audio actually play so live features drive the
    // gradient. Sample at fixed wallclock offsets from play start.
    const sampleOffsets = [500, 2000, 5000, 8000, 12000]; // ms after play
    const playStart = Date.now();
    samples[name] = {};
    for (const offset of sampleOffsets) {
      const target = playStart + offset;
      const now = Date.now();
      if (target > now) await new Promise((r) => setTimeout(r, target - now));
      const shot = await client.send('Page.captureScreenshot', {
        format: 'jpeg', quality: 88,
        clip: { x: 0, y: 0, width: 640, height: 360, scale: 1 },
      });
      const buf = Buffer.from(shot.data, 'base64');
      const hash = crypto.createHash('sha256').update(buf).digest('hex').slice(0, 16);
      samples[name][offset] = { hash, size: buf.length };
      // Read live features so we can correlate
      const feat = await page.evaluate(() => {
        const A = window.SWR && window.SWR.Audio;
        return A && A.feat ? {
          bass: +A.feat.bass.toFixed(3), mid: +A.feat.mid.toFixed(3),
          rms: +A.feat.rms.toFixed(3), onset: +A.feat.onset.toFixed(3),
        } : null;
      });
      console.log(`  t=${offset}ms  sha256=${hash}  ${buf.length}b  feat=${JSON.stringify(feat)}`);
    }
    // Pause for next iteration
    await page.evaluate(() => {
      const A = window.SWR.Audio;
      if (A && A.pause) A.pause();
    });
  }

  const sampleOffsets = [500, 2000, 5000, 8000, 12000]; // ms after play
  console.log('\n=== differentiation matrix (matching frames per sample time) ===');
  for (const offset of sampleOffsets) {
    const hashes = tracks.map((trk) => samples[path.basename(trk)][offset].hash);
    const unique = new Set(hashes).size;
    const total = tracks.length;
    const verdict = unique === total ? 'DIFFERENT (good)' : unique === 1 ? 'IDENTICAL (bad)' : `PARTIAL (${unique}/${total})`;
    console.log(`  t=${offset}ms  unique=${unique}/${total}  ${verdict}`);
  }

  // Also sample what features the engine reports at each track's start
  console.log('\n=== audio features per track (what the engine sees) ===');
  for (let i = 0; i < tracks.length; i++) {
    const name = path.basename(tracks[i]);
    const dur = songDurations[i] || 0;
    console.log(`  ${name}  dur=${dur.toFixed(2)}s`);
  }
} finally
{
  if (browser) await browser.close();
  server.close();
}