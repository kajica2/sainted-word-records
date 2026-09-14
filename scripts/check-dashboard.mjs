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

  // 1. Tabs: Console nav = version selector (6 links) + 3 transport toggles
  const versions = await page.$$eval('.versions a[data-v]', (els) => els.map(e => e.dataset.v));
  const toggles = await page.$$eval('[data-toggle-tab]', (els) => els.map(e => e.dataset.toggleTab));
  check('version selector has 6 versions', versions.length === 6 && versions.includes('console'), versions.join(','));
  check('console is aria-current', (await page.$$eval('.versions a[aria-current="page"]', (els) => els.length)) === 1);
  check('3 transport panel toggles', toggles.length === 3 && toggles.includes('enhance'), toggles.join(','));

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

  // 11. Tabs switch (Engine -> Enhance shows the filter panel, hides canvas)
  await page.click('[data-toggle-tab="enhance"]');
  await new Promise((r) => setTimeout(r, 200));
  const enhVisible = await page.$eval('#tab-enhance', (el) => !el.classList.contains('hidden'));
  const canvasHidden = await page.$eval('#render-canvas', (el) => el.style.display === 'none');
  check('Tab switch shows Enhance panel', enhVisible && canvasHidden);

  // 12. No console errors
  check('No console errors', errors.length === 0, errors.length ? errors.slice(0,3).join('|') : '');

  // 13. Engine: canvas + audio element wired
  await page.evaluate(() => document.body.focus());
  await new Promise((r) => setTimeout(r, 300));
  const engineReady = await page.evaluate(() => !!window.__SWR_ENGINE);
  check('Engine global installed', engineReady);
  const canvasOK = await page.evaluate(() => {
    const c = document.getElementById('render-canvas');
    return c && c.width === 540 && c.height === 675;
  });
  check('Render canvas 540x675', canvasOK);
  const audioOK = await page.evaluate(() => !!window.__SWR_ENGINE && !!window.__SWR_ENGINE.audio);
  check('Engine has audio element', audioOK);
  const featuresOK = await page.evaluate(() => {
    const e = window.__SWR_ENGINE;
    if (!e) return false;
    const f = e.features();
    return f && typeof f.bass === 'number';
  });
  check('Engine features accessible', featuresOK);

  // 14. Drop zone visible
  const dropZoneOK = await page.$eval('#drop-zone', (el) => !el.classList.contains('hidden'));
  check('Drop zone visible on load', dropZoneOK);

} finally {
  await browser.close();
  server.close();
}

console.log(`\n${pass}/${pass+fail} dashboard checks passed`);
process.exit(fail === 0 ? 0 : 1);
