#!/usr/bin/env node
// verify-photo-scrolls.mjs
//
// Contract spec for /photo-scrolls. Asserts the page is generated FROM the
// packs manifest (not a hand-maintained list), that the strips actually scroll,
// and that the lightbox works — including keyboard, which is the part a visual
// check misses.
//
//   node verify-photo-scrolls.mjs            # against http://127.0.0.1:5173
//   BASE=http://sainted-word-records.vercel.app node verify-photo-scrolls.mjs
//
// Follows the repo's verify-<feature>.mjs convention: standalone, no harness.

import puppeteer from 'puppeteer';
import fs from 'node:fs';

const BASE = (process.env.BASE || 'http://127.0.0.1:5173').replace(/\/$/, '');
// The .html path on purpose. The extensionless /photo-scrolls only resolves via
// the Vercel rewrite in vercel.json, which a plain local static server does not
// implement — so hitting it here tested the routing layer, not the page. The
// rewrite is asserted separately below.
const PAGE = `${BASE}/photo-scrolls.html`;
const ARTIFACTS = 'artifacts';

let failed = 0;
const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok: !!ok, detail });
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
}

let browser;
try {
  browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });
} catch (e) {
  console.error('could not launch Chrome: ' + e.message);
  process.exit(1);
}

const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 900 });

const consoleErrors = [];
page.on('pageerror', (e) => consoleErrors.push('pageerror: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push('console.error: ' + m.text()); });
page.on('requestfailed', (r) => consoleErrors.push('reqfail: ' + r.url()));

try {
  await page.goto(PAGE, { waitUntil: 'networkidle2', timeout: 30000 });
} catch (e) {
  console.error('⚠ page load failed: ' + e.message);
  await browser.close();
  process.exit(1);
}

// Wait for the manifest-driven render to replace the loading placeholder.
await page.waitForFunction(
  () => document.querySelectorAll('.ps-collection').length > 0,
  { timeout: 20000 },
).catch(() => {});

const manifest = await fetch(`${BASE}/packs/manifest.json`).then((r) => r.json()).catch(() => null);
const stillPacks = manifest
  ? Object.entries(manifest.packs).filter(([, f]) => (f || []).some((x) => /\.(webp|png|jpe?g|avif)$/i.test(x)))
  : [];
const expectedPhotos = stillPacks.reduce((n, [, f]) => n + f.filter((x) => /\.(webp|png|jpe?g|avif)$/i.test(x)).length, 0);

check('hero <h1> is "Photo Scrolls"', await page.evaluate(() =>
  (document.querySelector('h1')?.textContent || '').replace(/\s+/g, ' ').trim() === 'Photo Scrolls'));

const collCount = await page.evaluate(() => document.querySelectorAll('.ps-collection').length);
check('one collection per still pack', manifest
  ? collCount === stillPacks.length
  : false, `${collCount} collections vs ${stillPacks.length} still packs in the manifest`);

const frameCount = await page.evaluate(() => document.querySelectorAll('.ps-frame').length);
check('every still is rendered', manifest
  ? frameCount === expectedPhotos
  : false, `${frameCount} frames vs ${expectedPhotos} stills in the manifest`);

check('no video/audio packs leaked in', await page.evaluate(() =>
  Array.from(document.querySelectorAll('.ps-frame img'))
    .every((i) => !/\.(mp4|webm|mp3|m4a)$/i.test(i.getAttribute('src') || ''))));

check('strips are horizontally scrollable', await page.evaluate(() => {
  const s = document.querySelector('.ps-strip');
  if (!s) return false;
  return s.scrollWidth > s.clientWidth + 20 && getComputedStyle(s).overflowX !== 'visible';
}), await page.evaluate(() => {
  const s = document.querySelector('.ps-strip');
  return s ? `${s.scrollWidth}px content in ${s.clientWidth}px viewport` : 'no strip';
}));

check('first strip actually scrolls when driven', await page.evaluate(async () => {
  const s = document.querySelector('.ps-strip');
  if (!s) return false;
  const before = s.scrollLeft;
  s.scrollLeft = 400;
  await new Promise((r) => requestAnimationFrame(r));
  return s.scrollLeft > before;
}));

// The extensionless URL only resolves via the rewrite, so assert it in
// vercel.json rather than relying on the host to implement it.
check('extensionless /photo-scrolls is rewritten', await (async () => {
  try {
    const v = JSON.parse(fs.readFileSync('vercel.json', 'utf8'));
    return (v.rewrites || []).some((r) => r.source === '/photo-scrolls'
      && r.destination === '/photo-scrolls.html');
  } catch { return false; }
})());

check('tally reports real numbers', await page.evaluate((n) => {
  const t = document.getElementById('ps-tally')?.textContent || '';
  return t.includes(String(n)) && /collections/.test(t);
}, expectedPhotos), await page.evaluate(() => document.getElementById('ps-tally')?.textContent || ''));

// --- lightbox -----------------------------------------------------------
check('lightbox starts closed', await page.evaluate(() =>
  !document.getElementById('ps-lb').hasAttribute('open')));

await page.click('.ps-frame');
await page.waitForFunction(() => document.getElementById('ps-lb').hasAttribute('open'), { timeout: 5000 })
  .catch(() => {});
check('clicking a frame opens the lightbox', await page.evaluate(() =>
  document.getElementById('ps-lb').hasAttribute('open')));
check('lightbox shows a real image', await page.evaluate(() => {
  const i = document.getElementById('ps-lb-img');
  return !!i.src && i.naturalWidth > 0;
}), await page.evaluate(() => {
  const i = document.getElementById('ps-lb-img');
  return i ? `${i.naturalWidth}x${i.naturalHeight}` : 'no img';
}));

const firstSrc = await page.evaluate(() => document.getElementById('ps-lb-img').src);
const meta1 = await page.evaluate(() => document.getElementById('ps-lb-meta').textContent);
await page.keyboard.press('ArrowRight');
await new Promise((r) => setTimeout(r, 300));
const secondSrc = await page.evaluate(() => document.getElementById('ps-lb-img').src);
check('ArrowRight advances the photo', firstSrc !== secondSrc, `${meta1} -> ${await page.evaluate(() => document.getElementById('ps-lb-meta').textContent)}`);

await page.keyboard.press('ArrowLeft');
await new Promise((r) => setTimeout(r, 300));
check('ArrowLeft goes back', await page.evaluate((f) =>
  document.getElementById('ps-lb-img').src === f, firstSrc));

await page.keyboard.press('Escape');
await new Promise((r) => setTimeout(r, 300));
check('Escape closes the lightbox', await page.evaluate(() =>
  !document.getElementById('ps-lb').hasAttribute('open')));

check('a photo actually decoded in a strip', await page.evaluate(() => {
  const imgs = Array.from(document.querySelectorAll('.ps-frame img'));
  return imgs.some((i) => i.complete && i.naturalWidth > 0);
}), await page.evaluate(() => {
  const imgs = Array.from(document.querySelectorAll('.ps-frame img'));
  const ok = imgs.filter((i) => i.complete && i.naturalWidth > 0).length;
  return `${ok}/${imgs.length} decoded`;
}));

check('packs page links here', await (async () => {
  try {
    await page.goto(`${BASE}/packs.html`, { waitUntil: 'domcontentloaded', timeout: 20000 });
    return await page.evaluate(() =>
      !!document.querySelector('a[href="/photo-scrolls"]'));
  } catch { return false; }
})());

check('0 console errors', consoleErrors.length === 0, consoleErrors.slice(0, 3).join(' | '));

fs.mkdirSync(ARTIFACTS, { recursive: true });
await page.goto(PAGE, { waitUntil: 'networkidle2' }).catch(() => {});
await page.screenshot({ path: `${ARTIFACTS}/photo-scrolls.png`, fullPage: false });
await browser.close();

for (const r of results) if (!r.ok) console.log(`  ✗ ${r.name}${r.detail ? ` — ${r.detail}` : ''}`);
console.log(failed === 0 ? 'OK — all photo-scrolls checks passed' : `FAILED — ${failed} check(s) failed`);
process.exit(failed === 0 ? 0 : 1);
