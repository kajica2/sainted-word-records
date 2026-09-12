#!/usr/bin/env node
// scripts/render-full-song.mjs — render a full audio-reactive MP4 from one
// WAV + an optional custom library, by driving a versions/<variant>.html
// page through Puppeteer + CDP screenshots + ffmpeg image2pipe.
//
// Public API:
//   await renderVariant({
//     inputPath, outPath, variant, libraryPaths, fps, width, height, quiet,
//   }) -> { framesWritten, fpsActual, durationMs }
//
// CLI shim (default variant = hallucination, preserves the old behavior):
//   node scripts/render-full-song.mjs <input.wav> <output.mp4> [library.mp4 ...]

import http from 'http';
import fs from 'fs';
import path from 'path';
import { execFileSync, spawn } from 'node:child_process';
import puppeteer from 'puppeteer';

const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.gif': 'image/gif', '.wav': 'audio/wav', '.mp3': 'audio/mpeg',
  '.mp4': 'video/mp4', '.webm': 'video/webm',
};

function startStaticServer() {
  const server = http.createServer((req, res) => {
    const rel = decodeURIComponent(req.url.split('?')[0].replace(/^\/+/, '')) || 'index.html';
    const file = path.join(process.cwd(), rel);
    if (!file.startsWith(process.cwd()) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      res.writeHead(404); res.end('nf'); return;
    }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise((resolve) => {
    server.listen(0, () => resolve(server)); // ephemeral port
  });
}

export async function renderVariant(opts) {
  const {
    inputPath,
    outPath,
    variant = 'hallucination',
    libraryPaths = [],
    fps: FPS = 24,
    width: WIDTH = 640,
    height: HEIGHT = 360,
    quiet = false,
  } = opts;

  const inPath = path.resolve(inputPath);
  const libPaths = (libraryPaths || []).map((p) => path.resolve(p));
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  const log = quiet ? () => {} : (...a) => console.log(...a);

  const songSeconds = parseFloat(
    execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', inPath], { encoding: 'utf8' })
  );
  const totalFrames = Math.ceil(songSeconds * FPS);
  log(`render: variant=${variant} song=${songSeconds.toFixed(2)}s -> ${totalFrames} frames @ ${FPS}fps`);
  log(`library: ${libPaths.length} item(s)`);
  libPaths.forEach((p) => log(`  - ${path.basename(p)}`));

  let browser;
  let client;
  const server = await startStaticServer();
  const frameStart = Date.now();
  try {
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
      defaultViewport: { width: WIDTH, height: HEIGHT },
    });
    const page = await browser.newPage();
    client = await page.target().createCDPSession();

    await page.evaluateOnNewDocument(() => {
      try { localStorage.removeItem('swr.audio.armed'); } catch (_) {}
      try { localStorage.setItem('swr.recorder.worker', '0'); } catch (_) {}
    });

    const errs = [];
    page.on('pageerror', (e) => errs.push('PE: ' + e.message));
    page.on('console', (m) => { if (m.type() === 'error') errs.push('CE: ' + m.text()); });

    const BASE = `http://127.0.0.1:${server.address().port}`;
    await page.goto(`${BASE}/versions/${variant}.html`, { waitUntil: 'domcontentloaded', timeout: 60000 });

    // The page may keep an HMR WebSocket open, so `networkidle0` never
    // resolves. Poll for engine readiness instead.
    let waited = 0;
    while (waited < 30000) {
      const ok = await page.evaluate(() => !!(window.SWR && window.SWR.Audio && window.SWR.Layers));
      if (ok) break;
      await new Promise((r) => setTimeout(r, 250));
      waited += 250;
    }
    if (waited >= 30000) throw new Error('engine never booted');
    log('engine ready');

    if (libPaths.length > 0) {
      const assetInput = await page.$('#asset-input');
      if (!assetInput) throw new Error('no #asset-input on page');
      await assetInput.uploadFile(...libPaths);
      log(`uploaded ${libPaths.length} library files`);
      const want = libPaths.length;
      let libWaited = 0;
      while (libWaited < 60000) {
        const v = await page.evaluate(() => {
          const items = window.SWR.Library.items;
          let ready = 0;
          for (const it of items) if (it.thumb && it.w > 0 && it.h > 0) ready++;
          return { total: items.length, ready };
        });
        if (v.total >= want && v.ready >= want) break;
        await new Promise((r) => setTimeout(r, 400));
        libWaited += 400;
      }
      const final = await page.evaluate(() => window.SWR.Library.items.length);
      if (final < want) throw new Error(`library only has ${final}/${want} items after 60s`);
      log(`library ready: ${final} items`);
      await page.evaluate((want) => {
        const L = window.SWR.Layers;
        L.list.length = 0;
        L.render();
        const items = window.SWR.Library.items;
        for (let i = 0; i < items.length; i++) L.add(items[i]);
        while (L.list.length < 6 && items.length > 0) {
          L.add(items[L.list.length % items.length]);
        }
      }, want);
      await new Promise((r) => setTimeout(r, 400));
      await page.click('#remap');
      await new Promise((r) => setTimeout(r, 400));
      const lc = await page.evaluate(() => window.SWR.Layers.list.length);
      log(`layers loaded: ${lc}`);
    }

    const fileInput = await page.$('#song-input');
    if (!fileInput) throw new Error('no #song-input on page');
    await fileInput.uploadFile(inPath);

    let loadOk = false;
    for (let i = 0; i < 80; i++) {
      const v = await page.evaluate(() => {
        const A = window.SWR.Audio;
        const el = A && (A.audioEl || A.el);
        return { el: !!el, rs: el ? el.readyState : 0, dur: el ? el.duration : 0 };
      });
      if (v.el && v.rs >= 1 && v.dur > 0) { loadOk = true; break; }
      await new Promise((r) => setTimeout(r, 250));
    }
    if (!loadOk) throw new Error('audio never got metadata');
    log('audio loaded');

    await page.click('#play').catch(() => {});
    await page.evaluate(() => {
      const b = document.getElementById('play');
      if (b) { b.disabled = false; b.click(); }
      const A = window.SWR.Audio;
      if (A && A.play) A.play();
    });
    let started = false;
    for (let i = 0; i < 30; i++) {
      await new Promise((r) => setTimeout(r, 200));
      const v = await page.evaluate(() => {
        const A = window.SWR.Audio;
        const el = A && (A.audioEl || A.el);
        const ctx = A && (A.audioCtx || A.ctx);
        return { ct: el ? el.currentTime : 0, paused: el ? el.paused : true, ctx: ctx ? ctx.state : 'none' };
      });
      if (v.ct > 0.05 && !v.paused && v.ctx === 'running') { started = true; break; }
    }
    if (!started) throw new Error('audio did not start playing');
    log('audio playing');

    log(`capturing ${totalFrames} frames via CDP @ ${FPS}fps…`);

    const ff = spawn('ffmpeg', [
      '-y', '-f', 'image2pipe', '-vcodec', 'mjpeg', '-r', String(FPS), '-i', '-',
      '-i', inPath,
      '-map', '0:v:0', '-map', '1:a:0',
      '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p',
      '-c:a', 'aac', '-b:a', '192k',
      '-movflags', '+faststart', '-shortest',
      outPath,
    ], { stdio: ['pipe', 'inherit', 'inherit'] });

    let framesWritten = 0;
    for (let i = 0; i < totalFrames; i++) {
      const shot = await client.send('Page.captureScreenshot', {
        format: 'jpeg', quality: 88,
        clip: { x: 0, y: 0, width: WIDTH, height: HEIGHT, scale: 1 },
      });
      const buf = Buffer.from(shot.data, 'base64');
      if (!ff.stdin.write(buf)) {
        await new Promise((r) => ff.stdin.once('drain', r));
      }
      framesWritten++;
      if (!quiet && (framesWritten % 50 === 0 || framesWritten === totalFrames)) {
        const elapsed = (Date.now() - frameStart) / 1000;
        const fpsActual = framesWritten / elapsed;
        const remainSec = (totalFrames - framesWritten) / Math.max(fpsActual, 0.1);
        process.stdout.write(`  ${framesWritten}/${totalFrames} frames (${fpsActual.toFixed(1)}fps, ${remainSec.toFixed(0)}s remaining)\r`);
      }
      const expectedMs = (i + 1) * (1000 / FPS);
      const actualMs = Date.now() - frameStart;
      if (expectedMs > actualMs + 5) {
        await new Promise((r) => setTimeout(r, expectedMs - actualMs));
      }
    }
    if (!quiet) process.stdout.write('\n');
    ff.stdin.end();
    await new Promise((resolve, reject) => {
      ff.on('exit', (code) => code === 0 ? resolve() : reject(new Error(`ffmpeg exited ${code}`)));
    });
    log(`wrote ${framesWritten} frames`);
    const durationMs = Date.now() - frameStart;
    const fpsActual = framesWritten / (durationMs / 1000);
    return { framesWritten, fpsActual, durationMs };
  } finally {
    if (browser) await browser.close();
    server.close();
  }
}

// === CLI shim =============================================================
// Default behavior preserved: node scripts/render-full-song.mjs <in.wav> <out.mp4> [lib.mp4 ...]
if (import.meta.url === `file://${process.argv[1]}`) {
  const inPath   = path.resolve(process.argv[2]);
  const outPath  = path.resolve(process.argv[3] || './output/song.mp4');
  const libPaths = process.argv.slice(4).map((p) => path.resolve(p));
  if (!inPath || !fs.existsSync(inPath)) {
    console.error('usage: node scripts/render-full-song.mjs <input.wav> <output.mp4> [library.mp4 ...]');
    process.exit(2);
  }
  renderVariant({ inputPath: inPath, outPath, variant: 'hallucination', libraryPaths: libPaths })
    .then((r) => { console.log(`done: ${outPath} (${r.framesWritten} frames, ${r.fpsActual.toFixed(1)}fps, ${(r.durationMs/1000).toFixed(0)}s wall)`); })
    .catch((e) => { console.error(e); process.exit(1); });
}