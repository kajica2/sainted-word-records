#!/usr/bin/env node
// scripts/check-dashboard.mjs — verify the Sainted Word Records — Engine dashboard
// boots correctly + interactions work in headless Chromium.
//
// Checks:
//   1. Page loads with all 4 primary tabs (Engine, Enhance, Photo, Transitions)
//   2. Library grid renders 8 cards
//   3. Layers accordion: 5 rows, only first expanded
//   4. Canvas preview label visible
//   5. Drawer starts collapsed; clicking toggle expands it
//   6. Left sidebar collapses on click; width goes from 240 to 48
//   7. Right sidebar collapses on click; width goes from 300 to 48
//   8. Keyboard "[": left sidebar collapses
//   9. Keyboard "]": right sidebar collapses
//  10. Keyboard "a": drawer expands
//  11. Tabs: clicking Enhance shows "Coming soon" placeholder
//  12. No console errors during boot or interactions

import puppeteer from 'puppeteer';
import http from 'node:http';
import fs from 'node:fs';

const PORT = 53939;
const BASE = `http://127.0.0.1:${PORT}`;

// Static server for dashboard.html + needed assets
const ROOT = process.cwd();
const server = http.createServer((req, res) => {
  const url = req.url.split('?')[0];
  let path = url === '/' ? '/dashboard.html' : url;
  const fullPath = ROOT + path;
  if (!fs.existsSync(fullPath)) {
    res.statusCode = 404;
    res.end('not found');
    return;
  }
  const ct = fullPath.endsWith('.html') ? 'text/html'
           : fullPath.endsWith('.css')  ? 'text/css'
           : fullPath.endsWith('.js')   ? 'application/javascript'
           : 'application/octet-stream';
  res.setHeader('Content-Type', ct);
  res.end(fs.readFileSync(fullPath));
});
await new Promise((r) => server.listen(PORT, r));

let pass = 0, fail = 0;
function check(name, ok, detail) {
  const m = `${ok ? '✓' : '✗'} ${name}${detail ? ' (' + detail + ')' : ''}`;
  console.log(m);
  if (ok) pass += 1; else fail += 1;
}

const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
const page = await browser.newPage();
const errors = [];
page.on('console', (msg) => {
  if (msg.type() === 'error') errors.push(msg.text());
});
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));

try {
  await page.goto(`${BASE}/dashboard.html`, { waitUntil: 'domcontentloaded' });
  await new Promise((r) => setTimeout(r, 800));

  // 1. Tabs
  const tabs = await page.$$eval('[data-tab]', (els) => els.map(e => e.dataset.tab));
  check('4 primary tabs', tabs.length === 4 && tabs.includes('engine'), tabs.join(','));

  // 2. Library grid (rendered by JS)
  const libCount = await page.$$eval('#library-grid > div', (els) => els.length);
  check('Library has 8 cards', libCount === 8, `count=${libCount}`);

  // 3. Layers accordion
  const layerRows = await page.$$eval('#layers-list > details', (els) => els.length);
  const openCount = await page.$$eval('#layers-list > details[open]', (els) => els.length);
  check('5 layer rows', layerRows === 5, `count=${layerRows}`);
  check('only 1 layer expanded (accordion)', openCount === 1, `open=${openCount}`);

  // 4. Preview label
  const preview = await page.$eval('#canvas', (el) => el.textContent.includes('Preview'));
  check('Canvas preview label visible', preview);

  // 5. Drawer initial state + toggle
  const drawerCollapsedBefore = await page.$eval('#advanced-drawer', (el) => el.classList.contains('collapsed'));
  check('Drawer starts collapsed', drawerCollapsedBefore);
  await page.click('#drawer-toggle');
  await new Promise((r) => setTimeout(r, 400));
  const drawerCollapsedAfter = await page.$eval('#advanced-drawer', (el) => el.classList.contains('collapsed'));
  check('Drawer expands on click', !drawerCollapsedAfter);

  // 6. Left sidebar collapse
  const lWidthBefore = await page.$eval('#sidebar-l', (el) => parseInt(el.style.width));
  await page.click('#toggle-l');
  await new Promise((r) => setTimeout(r, 400));
  const lWidthAfter = await page.$eval('#sidebar-l', (el) => parseInt(el.style.width));
  check('Left sidebar collapses', lWidthAfter < lWidthBefore, `${lWidthBefore} -> ${lWidthAfter}`);

  // Reset left
  await page.click('#toggle-l');
  await new Promise((r) => setTimeout(r, 400));

  // 7. Right sidebar collapse
  const rWidthBefore = await page.$eval('#sidebar-r', (el) => parseInt(el.style.width));
  await page.click('#toggle-r');
  await new Promise((r) => setTimeout(r, 400));
  const rWidthAfter = await page.$eval('#sidebar-r', (el) => parseInt(el.style.width));
  check('Right sidebar collapses', rWidthAfter < rWidthBefore, `${rWidthBefore} -> ${rWidthAfter}`);

  // Reset right
  await page.evaluate(() => document.getElementById('toggle-r').click());
  await new Promise((r) => setTimeout(r, 400));

  // Reset drawer
  await page.evaluate(() => document.getElementById('drawer-toggle').click());
  await new Promise((r) => setTimeout(r, 400));

  // 8-10. Keyboard shortcuts (focus the document; we don't need to click anywhere)
  await page.evaluate(() => document.body.focus());
  await page.keyboard.press('[');
  await new Promise((r) => setTimeout(r, 400));
  const lKbd = await page.$eval('#sidebar-l', (el) => parseInt(el.style.width));
  check('Keyboard "[" collapses left', lKbd < 240, `width=${lKbd}`);

  await page.evaluate(() => document.body.focus());
  await page.keyboard.press(']');
  await new Promise((r) => setTimeout(r, 400));
  const rKbd = await page.$eval('#sidebar-r', (el) => parseInt(el.style.width));
  check('Keyboard "]" collapses right', rKbd < 300, `width=${rKbd}`);

  await page.evaluate(() => document.body.focus());
  await page.keyboard.press('a');
  await new Promise((r) => setTimeout(r, 400));
  const drawerKbd = await page.$eval('#advanced-drawer', (el) => el.classList.contains('collapsed'));
  check('Keyboard "a" expands drawer', !drawerKbd);

  // 11. Tabs switch (Engine -> Enhance shows placeholder)
  await page.click('[data-tab="enhance"]');
  await new Promise((r) => setTimeout(r, 200));
  const placeholderVisible = await page.$eval('#placeholder', (el) => !el.classList.contains('hidden'));
  check('Tab switch shows placeholder', placeholderVisible);

  // 12. No console errors
  check('No console errors', errors.length === 0, errors.length ? errors.slice(0,3).join('|') : '');

} finally {
  await browser.close();
  server.close();
}

console.log(`\n${pass}/${pass+fail} dashboard checks passed`);
process.exit(fail === 0 ? 0 : 1);
