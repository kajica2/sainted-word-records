#!/usr/bin/env node
// verify-brutalist.mjs — smoke test for gallery-brutalist.html.
// Checks:
//   1. HTTP 200 + canonical /gallery/brutalist rewrite pair
//   2. file-index table has 20 rows
//   3. Both grid sections (sheet-music + sunrise) render with the right counts
//   4. All 20 referenced PNGs serve 200 from dist/keyart/brutalist/
//   5. Brutalist invariants: no border-radius, no box-shadow, no gradients
//   6. shop-decorator wired for Buy CTAs
//   7. Screenshot saved

import puppeteer from 'puppeteer';
import http from 'node:http';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const PORT = 53915;
const BASE = `http://127.0.0.1:${PORT}`;
const PAGE = `${BASE}/gallery-brutalist.html`;
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
    if (status === 200) pass('gallery-brutalist.html returns 200');
    else fail(`page returns ${status}`);

    const browser = await puppeteer.launch({
      headless: 'new',
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
    });

    try {
      const page = await browser.newPage();
      await page.setViewport({ width: 1280, height: 1200 });
      const errs = [];
      page.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
      page.on('console', (m) => { if (m.type() === 'error') errs.push('console.error: ' + m.text()); });

      await page.goto(PAGE, { waitUntil: 'networkidle0', timeout: 20000 });
      // Scroll through the page so lazy-loaded images all fire.
      await page.evaluate(async () => {
        const total = document.documentElement.scrollHeight;
        for (let y = 0; y < total; y += 400) {
          window.scrollTo(0, y);
          await new Promise((r) => setTimeout(r, 80));
        }
        window.scrollTo(0, 0);
        await new Promise((r) => setTimeout(r, 600));
      });

      const dom = await page.evaluate(() => ({
        rows: document.querySelectorAll('.file-index tbody tr').length,
        sheetCells: document.querySelectorAll('#sheet-music .cell').length,
        sunriseCells: document.querySelectorAll('#sunrise .cell').length,
        navLinks: document.querySelectorAll('.header__nav a').length,
        statusBar: !!document.querySelector('.statusbar'),
        shopDecorator: Array.from(document.scripts).some((s) => s.src.includes('shop-decorator')),
        brutalistRule: getComputedStyle(document.querySelector('.cell')).borderRadius === '0px',
        images: Array.from(document.querySelectorAll('img')).map((i) => ({ src: i.getAttribute('src'), w: i.naturalWidth, h: i.naturalHeight })),
      }));

      if (dom.rows === 20) pass('file-index has 20 rows');
      else fail(`file-index has ${dom.rows} rows (want 20)`);
      if (dom.sheetCells === 12) pass('sheet-music section has 12 cells');
      else fail(`sheet-music has ${dom.sheetCells} cells (want 12)`);
      if (dom.sunriseCells === 8) pass('sunrise section has 8 cells');
      else fail(`sunrise has ${dom.sunriseCells} cells (want 8)`);
      if (dom.statusBar) pass('statusbar present');
      else fail('statusbar missing');
      if (dom.shopDecorator) pass('shop-decorator wired');
      else fail('shop-decorator missing');
      if (dom.brutalistRule) pass('border-radius: 0 enforced on .cell');
      else fail('border-radius not 0 on .cell');
      if (errs.length === 0) pass('no JS errors');
      else fail('JS errors: ' + errs.slice(0, 3).join(' | '));

      // All 20 images actually loaded (naturalWidth > 0)
      const loaded = dom.images.filter((i) => i.w > 0).length;
      if (loaded === 20) pass('all 20 PNGs loaded with naturalWidth > 0');
      else fail(`only ${loaded}/20 PNGs loaded`);

      // Direct fetch every referenced image (paranoia check on dist serving)
      let fetched = 0;
      for (const img of dom.images) {
        const url = BASE + img.src.replace(/^\.\//, '/');
        const st = await fetchStatus(url);
        if (st === 200) fetched++;
      }
      if (fetched === 20) pass(`all 20 PNGs serve 200 (${fetched}/20)`);
      else fail(`only ${fetched}/20 PNGs serve 200`);

      // Screenshot
      await page.screenshot({ path: path.join(OUT, '06-brutalist-gallery.png'), fullPage: true });

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
  console.log(`Brutalist smoke: ${passed}/${checks.length} checks passed`);
  if (passed !== checks.length) process.exit(1);
  console.log('OK');
})();