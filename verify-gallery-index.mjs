#!/usr/bin/env node
// verify-gallery-index.mjs — smoke test for the gallery.html master index.
// - 19 gallery cards present
// - filter buttons work (audio/video/still/etc)
// - all hrefs serve 200
// - footer cross-links to landing/portfolio/engine/artists/personas
// - no JS errors
import puppeteer from 'puppeteer';
import http from 'node:http';
import { spawn } from 'node:child_process';

const PORT = 53918;
const BASE = `http://127.0.0.1:${PORT}`;
const PAGE = `${BASE}/gallery.html`;

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
    if (status === 200) pass('gallery.html returns 200');
    else { fail(`status ${status}`); process.exit(1); }

    const browser = await puppeteer.launch({
      headless: 'new',
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
    });
    try {
      const page = await browser.newPage();
      await page.setViewport({ width: 1280, height: 1200 });
      const errs = [];
      page.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
      page.on('console', (m) => { if (m.type() === 'error') errs.push('console: ' + m.text()); });

      await page.goto(PAGE, { waitUntil: 'networkidle0', timeout: 15000 });

      const dom = await page.evaluate(() => ({
        cards: document.querySelectorAll('.g-card').length,
        filterButtons: document.querySelectorAll('.filter-bar button').length,
        stampLinks: document.querySelectorAll('.stamp__links a').length,
        visibleCards: Array.from(document.querySelectorAll('.g-card')).filter((c) => c.style.display !== 'none').length,
        hrefs: Array.from(document.querySelectorAll('.g-card')).map((c) => c.getAttribute('href')),
        tags: Array.from(document.querySelectorAll('.g-card')).map((c) => c.getAttribute('data-tags')),
        statusBar: !!document.querySelector('.statusbar'),
        brutalistRule: getComputedStyle(document.querySelector('.g-card')).borderRadius === '0px',
      }));

      if (dom.cards === 19) pass(`19 gallery cards present`);
      else fail(`${dom.cards} cards (want 19)`);
      if (dom.filterButtons === 11) pass('11 filter buttons');
      else fail(`${dom.filterButtons} filter buttons (want 11)`);
      if (dom.stampLinks === 5) pass('5 footer cross-links (landing/portfolio/engine/artists/personas)');
      else fail(`${dom.stampLinks} footer links (want 5)`);
      if (dom.statusBar) pass('statusbar present');
      else fail('statusbar missing');
      if (dom.brutalistRule) pass('border-radius: 0 enforced');
      else fail('border-radius not 0');

      // All hrefs serve 200
      let ok = 0;
      for (const h of dom.hrefs) {
        const u = BASE + h.replace(/^\.\//, '/');
        const s = await fetchStatus(u);
        if (s === 200) ok++;
        else fail(`href ${h} returns ${s}`);
      }
      if (ok === 19) pass(`all 19 hrefs serve 200`);
      else fail(`only ${ok}/19 hrefs serve 200`);

      // Filter behavior
      const audioCount = dom.tags.filter((t) => (t || '').includes('audio')).length;
      const videoCount = dom.tags.filter((t) => (t || '').includes('video')).length;
      const stillCount = dom.tags.filter((t) => (t || '').includes('still')).length;

      await page.click('.filter-bar button[data-filter="video"]');
      await new Promise((r) => setTimeout(r, 200));
      const visibleVideo = await page.evaluate(() => Array.from(document.querySelectorAll('.g-card')).filter((c) => c.style.display !== 'none').length);
      if (visibleVideo === videoCount) pass(`video filter shows ${visibleVideo}/${videoCount}`);
      else fail(`video filter shows ${visibleVideo}, want ${videoCount}`);

      await page.click('.filter-bar button[data-filter="still"]');
      await new Promise((r) => setTimeout(r, 200));
      const visibleStill = await page.evaluate(() => Array.from(document.querySelectorAll('.g-card')).filter((c) => c.style.display !== 'none').length);
      if (visibleStill === stillCount) pass(`still filter shows ${visibleStill}/${stillCount}`);
      else fail(`still filter shows ${visibleStill}, want ${stillCount}`);

      await page.click('.filter-bar button[data-filter="audio"]');
      await new Promise((r) => setTimeout(r, 200));
      const visibleAudio = await page.evaluate(() => Array.from(document.querySelectorAll('.g-card')).filter((c) => c.style.display !== 'none').length);
      if (visibleAudio === audioCount) pass(`audio filter shows ${visibleAudio}/${audioCount}`);
      else fail(`audio filter shows ${visibleAudio}, want ${audioCount}`);

      await page.click('.filter-bar button[data-filter="all"]');
      await new Promise((r) => setTimeout(r, 200));
      const visibleAll = await page.evaluate(() => Array.from(document.querySelectorAll('.g-card')).filter((c) => c.style.display !== 'none').length);
      if (visibleAll === 19) pass(`all filter shows ${visibleAll}/19`);
      else fail(`all filter shows ${visibleAll}, want 19`);

      if (errs.length === 0) pass('no JS errors');
      else fail('JS errors: ' + errs.slice(0, 3).join(' | '));

      await page.screenshot({ path: '/Users/kaidejuricmasscmbook/.hermes/scratch/08-gallery-index.png', fullPage: true });

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
  console.log(`Gallery-index smoke: ${passed}/${checks.length} checks passed`);
  if (passed !== checks.length) process.exit(1);
  console.log('OK');
})();