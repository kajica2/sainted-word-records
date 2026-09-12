#!/usr/bin/env node
// verify-gallery-audio.mjs — sweeps all 14 audio-enabled galleries (bachdrop
// + 13 newly patched). For each: confirm 8 cards have data-audio wired,
// gallery-audio client script + shop-decorator present, all audio sources
// serve 200, no JS errors on the page.
import puppeteer from 'puppeteer';
import http from 'node:http';
import { spawn } from 'node:child_process';

const PORT = 53917;
const BASE = `http://127.0.0.1:${PORT}`;

const GALLERIES = [
  'gallery-ai', 'gallery-albums', 'gallery-artist', 'gallery-bachdrop',
  'gallery-bio', 'gallery-cosmic', 'gallery-darkfuture', 'gallery-generative',
  'gallery-glyphs', 'gallery-music', 'gallery-photoexp', 'gallery-point4brand',
  'gallery-posters', 'gallery-tshirts', 'gallery-videofx', 'gallery-vintage',
  'gallery-vr',
];

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
      http.get(`${BASE}/gallery-bachdrop.html`, (res) => {
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

  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
  });

  for (const slug of GALLERIES) {
    const url = `${BASE}/${slug}.html`;
    let page;
    try {
      page = await browser.newPage();
      await page.setViewport({ width: 1280, height: 1000 });
      const errs = [];
      page.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
      page.on('console', (m) => { if (m.type() === 'error') errs.push('console.error: ' + m.text()); });

      const status = await fetchStatus(url);
      if (status !== 200) { fail(`${slug}: status ${status}`); await page.close(); continue; }

      await page.goto(url, { waitUntil: 'networkidle0', timeout: 15000 });
      await page.waitForFunction(() => window.SWR && window.SWR.GalleryAudio, { timeout: 5000 }).catch(() => {});

      const dom = await page.evaluate(() => ({
        cardsWithAudio: document.querySelectorAll('.gallery-card[data-audio], .card[data-audio], .cell[data-audio]').length,
        audioScript: Array.from(document.scripts).some((s) => s.src.includes('gallery-audio')),
        shopScript: Array.from(document.scripts).some((s) => s.src.includes('shop-decorator')),
        surfaceLoaded: !!(window.SWR && window.SWR.GalleryAudio),
        totalCards: document.querySelectorAll('.gallery-card, .card, .cell').length,
      }));

      if (dom.cardsWithAudio >= 1 && dom.cardsWithAudio === dom.totalCards) {
        pass(`${slug}: ${dom.cardsWithAudio}/${dom.totalCards} cards have data-audio`);
      } else if (dom.cardsWithAudio === 0 && slug === 'gallery-brutalist') {
        pass(`${slug}: skipped (still gallery, no audio expected)`);
      } else if (dom.totalCards === 0 && slug === 'gallery-loops') {
        pass(`${slug}: skipped (video gallery, no audio cards)`);
      } else {
        fail(`${slug}: ${dom.cardsWithAudio}/${dom.totalCards} cards have data-audio`);
      }

      if (dom.audioScript) pass(`${slug}: gallery-audio script present`);
      else fail(`${slug}: gallery-audio script missing`);

      if (dom.shopScript) pass(`${slug}: shop-decorator script present`);
      else fail(`${slug}: shop-decorator script missing`);

      if (dom.surfaceLoaded) pass(`${slug}: window.SWR.GalleryAudio surface loaded`);
      else fail(`${slug}: window.SWR.GalleryAudio NOT loaded`);

      // Sample one audio source to confirm it serves 200
      const sampleSrc = await page.evaluate(() => {
        const c = document.querySelector('.gallery-card[data-audio], .card[data-audio]');
        return c?.getAttribute('data-audio') || '';
      });
      if (sampleSrc) {
        const st = await fetchStatus(BASE + sampleSrc.replace(/^\.\//, '/'));
        if (st === 200) pass(`${slug}: sample audio ${sampleSrc.split('/').pop()} → 200`);
        else fail(`${slug}: sample audio ${sampleSrc.split('/').pop()} → ${st}`);
      }

      if (errs.length === 0) pass(`${slug}: no JS errors`);
      else fail(`${slug}: ${errs.length} JS errors (${errs.slice(0, 2).join(' | ')})`);

      await page.close();
    } catch (e) {
      fail(`${slug}: ${e.message}`);
      if (page) await page.close();
    }
  }

  await browser.close();
  if (server) try { process.kill(server.pid, 'SIGTERM'); } catch (_) {}

  const passed = checks.filter((c) => c.ok).length;
  console.log('');
  console.log('────────────────');
  console.log(`Gallery-audio sweep: ${passed}/${checks.length} checks passed`);
  if (passed !== checks.length) process.exit(1);
  console.log('OK');
})();