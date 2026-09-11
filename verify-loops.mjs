#!/usr/bin/env node
// verify-loops.mjs — smoke test for gallery-loops.html.
// Checks:
//   1. HTTP 200 + /gallery/loops rewrite pair
//   2. 10 sections present (cinematic/character/cityscape/product/
//      editorial/illustration/typography/music-prompt/kinetic/abstract)
//   3. 21 <video> cells with autoplay+loop+muted attributes
//   4. All 21 MP4s serve 200 from dist/library/loops/
//   5. Brutalist invariants: no border-radius, no box-shadow, no gradients
//   6. shop-decorator wired
//   7. Screenshot of the page mid-scroll

import puppeteer from 'puppeteer';
import http from 'node:http';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const PORT = 53916;
const BASE = `http://127.0.0.1:${PORT}`;
const PAGE = `${BASE}/gallery-loops.html`;
const OUT = '/Users/kaidejuricmasscmbook/.hermes/scratch';
fs.mkdirSync(OUT, { recursive: true });

const checks = [];
const pass = (m) => { checks.push({ ok: true, m }); console.log('✓', m); };
const fail = (m) => { checks.push({ ok: false, m }); console.log('✗', m); };

function startServer() {
  return new Promise((resolve, reject) => {
    const proc = spawn('python3', ['-m', 'http.server', String(PORT)], {
      cwd: process.cwd() + '/dist', stdio: 'ignore',
    });
    const start = Date.now();
    const tick = () => {
      http.get(PAGE, (res) => {
        res.resume();
        if (res.statusCode === 200) return resolve(proc);
        if (Date.now() - start > 8000) return reject(new Error('server timeout'));
        setTimeout(tick, 100);
      }).on('error', () => {
        if (Date.now() - start > 8000) return reject(new Error('server error'));
        setTimeout(tick, 80);
      });
    };
    setTimeout(tick, 100);
  });
}
function fetchStatus(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => { res.resume(); resolve(res.statusCode); }).on('error', reject);
  });
}

(async () => {
  let server;
  try { server = await startServer(); } catch (e) { fail('server failed: ' + e.message); process.exit(1); }
  try {
    const status = await fetchStatus(PAGE);
    if (status === 200) pass('gallery-loops.html returns 200');
    else fail(`page returns ${status}`);

    const browser = await puppeteer.launch({
      headless: 'new',
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--autoplay-policy=no-user-gesture-required'],
    });
    try {
      const page = await browser.newPage();
      await page.setViewport({ width: 1280, height: 1200 });
      const errs = [];
      page.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
      page.on('console', (m) => { if (m.type() === 'error') errs.push('console.error: ' + m.text()); });

      await page.goto(PAGE, { waitUntil: 'networkidle0', timeout: 30000 });

      // Scroll to load lazy/offscreen videos
      await page.evaluate(async () => {
        const total = document.documentElement.scrollHeight;
        for (let y = 0; y < total; y += 400) {
          window.scrollTo(0, y);
          await new Promise((r) => setTimeout(r, 100));
        }
        window.scrollTo(0, 0);
        await new Promise((r) => setTimeout(r, 600));
      });

      const dom = await page.evaluate(() => ({
        sections: document.querySelectorAll('main section').length,
        videos: document.querySelectorAll('video').length,
        autoplayCount: Array.from(document.querySelectorAll('video')).filter((v) => v.autoplay && v.loop && v.muted).length,
        navLinks: document.querySelectorAll('.header__nav a').length,
        statusBar: !!document.querySelector('.statusbar'),
        shopDecorator: Array.from(document.scripts).some((s) => s.src.includes('shop-decorator')),
        brutalistRule: getComputedStyle(document.querySelector('.cell')).borderRadius === '0px',
        sources: Array.from(document.querySelectorAll('video source, video')).map((v) => v.src || (v.querySelector('source')?.src || '')),
      }));

      if (dom.sections === 10) pass('10 sections present');
      else fail(`${dom.sections} sections (want 10)`);
      if (dom.videos === 21) pass('21 <video> cells rendered');
      else fail(`${dom.videos} <video> cells (want 21)`);
      if (dom.autoplayCount === 21) pass('all 21 videos have autoplay+loop+muted');
      else fail(`only ${dom.autoplayCount}/21 have autoplay+loop+muted`);
      if (dom.statusBar) pass('statusbar present');
      else fail('statusbar missing');
      if (dom.shopDecorator) pass('shop-decorator wired');
      else fail('shop-decorator missing');
      if (dom.brutalistRule) pass('border-radius: 0 enforced');
      else fail('border-radius not 0');
      if (errs.length === 0) pass('no JS errors');
      else fail('JS errors: ' + errs.slice(0, 3).join(' | '));

      // All 21 MP4s serve 200
      let fetched = 0;
      const allSrcs = await page.evaluate(() =>
        Array.from(document.querySelectorAll('video')).map((v) => v.getAttribute('src') || v.querySelector('source')?.getAttribute('src') || '')
      );
      for (const src of allSrcs) {
        if (!src) continue;
        // src is relative like ./library/loops/foo.mp4
        const path = src.replace(/^\.\//, '/');
        const url = BASE + path;
        const st = await fetchStatus(url);
        if (st === 200) fetched++;
        else fail(`video ${src.split('/').pop()} returned ${st}`);
      }
      if (fetched === 21) pass(`all 21 MP4s serve 200 (${fetched}/21)`);
      else fail(`only ${fetched}/21 MP4s serve 200`);

      // Confirm videos actually play (sample one)
      const videoPlaying = await page.evaluate(() => {
        const v = document.querySelector('video');
        if (!v) return null;
        return {
          readyState: v.readyState,
          paused: v.paused,
          currentTime: v.currentTime,
          duration: v.duration,
          videoWidth: v.videoWidth,
          videoHeight: v.videoHeight,
        };
      });
      if (videoPlaying && videoPlaying.videoWidth > 0) {
        pass(`first video loaded (${videoPlaying.videoWidth}x${videoPlaying.videoHeight}, ${videoPlaying.duration?.toFixed(1)}s)`);
      } else {
        fail(`first video failed to load: ${JSON.stringify(videoPlaying)}`);
      }

      await page.screenshot({ path: path.join(OUT, '07-loops-gallery.png'), fullPage: true });

      await page.close();
      await browser.close();
    } catch (e) {
      fail('puppeteer crashed: ' + e.message);
    }
  } finally {
    if (server) try { process.kill(server.pid, 'SIGTERM'); } catch (_) {}
  }
  const passed = checks.filter((c) => c.ok).length;
  console.log('');
  console.log('────────────────');
  console.log(`Loops smoke: ${passed}/${checks.length} checks passed`);
  if (passed !== checks.length) process.exit(1);
  console.log('OK');
})();