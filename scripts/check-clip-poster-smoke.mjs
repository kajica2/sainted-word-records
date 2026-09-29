#!/usr/bin/env node
// scripts/check-clip-poster-smoke.mjs — clip posters must be a POSTER frame.
//
// Why this exists: thumbnails used to be captured at t≈0, which is black on
// any clip that fades in (and on most camera footage). The fix seeks to ~1s,
// but a "seek further in" change is invisible to every static gate — it can
// only be proven by capturing a frame and measuring it. This suite synthesises
// a clip that is BLACK for its first 0.6s and BRIGHT after it, adds it through
// the page's own file input, and asserts the thumbnail the app renders is the
// lit frame. It also measures the same clip at t=0 so a fixture that stopped
// discriminating (e.g. an all-white clip) still fails the suite instead of
// passing it vacuously.
//
// Run: node scripts/check-clip-poster-smoke.mjs

import puppeteer from 'puppeteer';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const PORT = 53971;
const ROOT = process.cwd();

const server = http.createServer((req, res) => {
  let file = path.join(ROOT, decodeURIComponent(req.url.split('?')[0]));
  if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
  if (!fs.existsSync(file) && fs.existsSync(`${file}.html`)) file += '.html';
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.statusCode = 404; res.end('not found'); return; }
  res.setHeader('Content-Type', file.endsWith('.html') ? 'text/html' : file.endsWith('.css') ? 'text/css' : 'application/javascript');
  res.end(fs.readFileSync(file));
});
await new Promise((r) => server.listen(PORT, r));

let pass = 0, fail = 0;
const check = (name, ok, detail) => {
  console.log(`${ok ? '✓' : '✗'} ${name}${detail ? ' (' + detail + ')' : ''}`);
  if (ok) pass += 1; else fail += 1;
};

const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
const page = await browser.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e.message).slice(0, 120)));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 120)); });

try {
  await page.setViewport({ width: 1440, height: 900 });
  await page.goto(`http://127.0.0.1:${PORT}/make-video`, { waitUntil: 'domcontentloaded' });
  await new Promise((r) => setTimeout(r, 1200));

  const result = await page.evaluate(async () => {
    // 1. Synthesise the fixture: 0.6s black, then a bright gradient.
    const c = document.createElement('canvas');
    c.width = 320; c.height = 180;
    const cx = c.getContext('2d');
    const stream = c.captureStream(30);
    const rec = new MediaRecorder(stream, { mimeType: 'video/webm;codecs=vp8' });
    const chunks = [];
    rec.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
    const t0 = Date.now();
    rec.start();
    await new Promise((resolve) => {
      const iv = setInterval(() => {
        const t = (Date.now() - t0) / 1000;
        if (t < 0.6) { cx.fillStyle = '#000'; }
        else {
          const g = cx.createLinearGradient(0, 0, 320, 180);
          g.addColorStop(0, '#ffffff'); g.addColorStop(1, '#cccccc');
          cx.fillStyle = g;
        }
        cx.fillRect(0, 0, 320, 180);
        if (t >= 2.5) { clearInterval(iv); resolve(); }
      }, 33);
    });
    rec.stop();
    await new Promise((r) => { rec.onstop = r; });
    const file = new File([new Blob(chunks, { type: 'video/webm' })], 'poster-fixture.webm', { type: 'video/webm' });

    // 2. Sanity: the fixture must be dark at the start and bright later.
    const url = URL.createObjectURL(file);
    const frameMean = (at) => new Promise((resolve) => {
      const v = document.createElement('video');
      v.muted = true; v.playsInline = true; v.preload = 'auto'; v.src = url;
      const done = () => {
        const cv = document.createElement('canvas');
        cv.width = v.videoWidth || 320; cv.height = v.videoHeight || 180;
        const x = cv.getContext('2d');
        x.drawImage(v, 0, 0, cv.width, cv.height);
        const d = x.getImageData(0, 0, cv.width, cv.height).data;
        let s = 0;
        for (let i = 0; i < d.length; i += 4) s += (d[i] + d[i + 1] + d[i + 2]) / 3;
        resolve(Math.round(s / (d.length / 4)));
      };
      v.addEventListener('loadeddata', () => {
        v.addEventListener('seeked', done, { once: true });
        try { v.currentTime = at; } catch (_) { done(); }
        setTimeout(done, 4000);
      }, { once: true });
      setTimeout(() => resolve(-1), 6000);
    });
    const headMean = await frameMean(0.2);
    const litMean = await frameMean(1.0);

    // 3. Drive the page's own add path.
    const input = document.getElementById('clip-input');
    const dt = new DataTransfer();
    dt.items.add(file);
    input.files = dt.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));

    const thumbSrc = await new Promise((resolve) => {
      const started = Date.now();
      const tick = () => {
        const img = document.querySelector('#clips-list .mvm-clip-thumb img');
        if (img && img.src.startsWith('data:')) return resolve(img.src);
        if (Date.now() - started > 20000) return resolve(null);
        setTimeout(tick, 250);
      };
      tick();
    });
    if (!thumbSrc) return { headMean, litMean, thumb: false };

    const thumbMean = await new Promise((resolve) => {
      const im = new Image();
      im.onload = () => {
        const cv = document.createElement('canvas');
        cv.width = im.width; cv.height = im.height;
        const x = cv.getContext('2d');
        x.drawImage(im, 0, 0);
        const d = x.getImageData(0, 0, cv.width, cv.height).data;
        let s = 0;
        for (let i = 0; i < d.length; i += 4) s += (d[i] + d[i + 1] + d[i + 2]) / 3;
        resolve(Math.round(s / (d.length / 4)));
      };
      im.onerror = () => resolve(-1);
      im.src = thumbSrc;
    });
    return { headMean, litMean, thumb: true, thumbMean, thumbIsDataUrl: thumbSrc.startsWith('data:image/') };
  });

  check('fixture is black at the head and lit later', result.headMean <= 5 && result.litMean >= 200,
    `head=${result.headMean} lit=${result.litMean}`);
  check('the clip rail renders a poster thumbnail', result.thumb === true && result.thumbIsDataUrl === true);
  // The lit 16:9 frame is letterboxed into the store's square thumb, so its
  // mean lands near 145; anything at/below the black head's level is the bug.
  check('the poster is the lit frame, not the black head', result.thumbMean >= 60,
    `thumbMean=${result.thumbMean} (head=${result.headMean}, lit=${result.litMean})`);
  check('no page errors while adding the clip', errors.length === 0, errors.slice(0, 2).join(' | '));
} finally {
  await browser.close();
  server.close();
}

console.log(`\n${pass}/${pass + fail} clip-poster checks passed`);
process.exit(fail === 0 ? 0 : 1);
