// scripts/check-capture-smoke.mjs
// Puppeteer smoke test against the live engine.html. Verifies the periodic
// frame capture runtime + toolbar UI:
//   1. Page boots without console errors
//   2. window.SWR_CAPTURE is defined
//   3. Toolbar mounted (getToolbarEl → #swr-capture-toolbar)
//   4. Toggle button present (getToggleBtn → <button>)
//   5. Toggle starts OFF (aria-pressed="false")
//   6. First click → ON (isEnabled + aria-pressed)
//   7. Second click → OFF
//   8. Interval input present (getIntervalInput → <input type="number">)
//   9. setIntervalSec(7) updates both state + UI input value
//  10. ?capture=12 on a fresh page → enabled + interval 12 + localStorage
//
// Self-contained: ensureDist() (from scripts/with-dist.mjs) auto-builds
// dist/ if missing.
//
// Run command:
//   node scripts/check-capture-smoke.mjs
//
// Pass criteria: 10/10 assertions green, exit 0.

import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import puppeteer from 'puppeteer';
import { ensureDist } from './with-dist.mjs';

ensureDist();

// Static server for the built dist/. Port 5182 is distinct from the
// automix smoke (5181) so the two can run side-by-side if needed.
const distDir = path.resolve(dirname(fileURLToPath(import.meta.url)), '../dist');
const server = http.createServer((req, res) => {
  let p = req.url.split('?')[0];
  if (p.endsWith('/')) p += 'index.html';
  let file = path.join(distDir, p);
  if (!file.startsWith(distDir)) { res.statusCode = 403; res.end(); return; }
  fs.readFile(file, (err, data) => {
    if (err) { res.statusCode = 404; res.end(); return; }
    const ext = path.extname(file);
    const mime = ext === '.html' ? 'text/html'
      : ext === '.js' ? 'text/javascript'
      : 'application/octet-stream';
    res.setHeader('Content-Type', mime);
    res.end(data);
  });
});
server.listen(5182);

const browser = await puppeteer.launch({
  args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
});

const results = [];
function ok(name) { results.push('  ✓ ' + name); }
function bad(name, got) {
  results.push('  ✗ ' + name + ' (got: ' + got + ')');
  process.exitCode = 1;
}

// CI runner note: networkidle0 never settles within the timeout on GitHub
// runners. Navigate on domcontentloaded, then give the page a bounded
// chance to reach the load event before checks run.
async function nav(page, url) {
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForFunction(
    () => document.readyState === 'complete',
    { timeout: 15000 }
  ).catch(() => {});
}

// ---------------------------------------------------------------------------
// Main page (no URL opt-in) — exercises toolbar + toggle + interval input
// ---------------------------------------------------------------------------

const page = await browser.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

await nav(page, 'http://localhost:5182/engine');

// 1. No console errors at boot (excluding pre-existing dev-control WS
//    probe to ws://localhost:8787, same filter as automix-smoke).
const FATAL_FILTER = /WebSocket.*ws:\/\/localhost:8787/;
const fatalErrors = errors.filter((e) => !FATAL_FILTER.test(e));
if (fatalErrors.length === 0) ok('no console errors at boot');
else bad('no console errors at boot', JSON.stringify(fatalErrors));

// 2. SWR_CAPTURE defined.
const hasCapture = await page.evaluate(() => !!window.SWR_CAPTURE);
if (hasCapture) ok('window.SWR_CAPTURE defined');
else bad('window.SWR_CAPTURE defined', 'undefined');

// 3. Toolbar mounted.
const toolbarId = await page.evaluate(() => {
  const t = window.SWR_CAPTURE.getToolbarEl();
  return t && t.id;
});
if (toolbarId === 'swr-capture-toolbar') ok('getToolbarEl() returns #swr-capture-toolbar');
else bad('getToolbarEl() returns #swr-capture-toolbar', String(toolbarId));

// 4. Toggle button present.
const btnTag = await page.evaluate(() => {
  const b = window.SWR_CAPTURE.getToggleBtn();
  return b && b.tagName;
});
if (btnTag === 'BUTTON') ok('getToggleBtn() returns <button>');
else bad('getToggleBtn() returns <button>', String(btnTag));

// 5. Toggle starts OFF (aria-pressed="false").
const pressed0 = await page.evaluate(() =>
  window.SWR_CAPTURE.getToggleBtn().getAttribute('aria-pressed')
);
if (pressed0 === 'false') ok('toggle aria-pressed starts "false"');
else bad('toggle aria-pressed starts "false"', String(pressed0));

// 6. First click → ON.
await page.evaluate(() => window.SWR_CAPTURE.getToggleBtn().click());
const onState = await page.evaluate(() => ({
  enabled: window.SWR_CAPTURE.isEnabled(),
  pressed: window.SWR_CAPTURE.getToggleBtn().getAttribute('aria-pressed'),
}));
if (onState.enabled === true && onState.pressed === 'true')
  ok('click toggles to ON (isEnabled + aria-pressed)');
else bad('click toggles to ON', JSON.stringify(onState));

// 7. Second click → OFF.
await page.evaluate(() => window.SWR_CAPTURE.getToggleBtn().click());
const offState = await page.evaluate(() => ({
  enabled: window.SWR_CAPTURE.isEnabled(),
  pressed: window.SWR_CAPTURE.getToggleBtn().getAttribute('aria-pressed'),
}));
if (offState.enabled === false && offState.pressed === 'false')
  ok('click toggles back to OFF');
else bad('click toggles back to OFF', JSON.stringify(offState));

// 8. Interval input present.
const inputType = await page.evaluate(() => {
  const i = window.SWR_CAPTURE.getIntervalInput();
  return i && i.type;
});
if (inputType === 'number') ok('getIntervalInput() returns <input type="number">');
else bad('getIntervalInput() returns <input type="number">', String(inputType));

// 9. setIntervalSec(7) → state 7 AND UI input value '7'.
const ivState = await page.evaluate(() => {
  window.SWR_CAPTURE.setIntervalSec(7);
  return {
    iv: window.SWR_CAPTURE.getIntervalSec(),
    inputVal: window.SWR_CAPTURE.getIntervalInput().value,
  };
});
if (ivState.iv === 7 && ivState.inputVal === '7')
  ok("setIntervalSec(7) updates state + UI input value '7'");
else bad('setIntervalSec(7) updates state + UI input value', JSON.stringify(ivState));

// ---------------------------------------------------------------------------
// Fresh page with ?capture=12 — exercises URL opt-in round-trip
// ---------------------------------------------------------------------------

const page2 = await browser.newPage();
const errors2 = [];
page2.on('pageerror', (e) => errors2.push(e.message));
page2.on('console', (m) => { if (m.type() === 'error') errors2.push(m.text()); });
await nav(page2, 'http://localhost:5182/engine?capture=12');

const optInState = await page2.evaluate(() => ({
  enabled: window.SWR_CAPTURE.isEnabled(),
  iv: window.SWR_CAPTURE.getIntervalSec(),
  lsEnabled: localStorage.getItem('swr.capture.enabled'),
  lsInterval: localStorage.getItem('swr.capture.intervalSec'),
}));
if (
  optInState.enabled === true &&
  optInState.iv === 12 &&
  optInState.lsEnabled === '1'
) ok('?capture=12 enables + sets interval 12 + persists to localStorage');
else bad('?capture=12 enables + sets interval 12 + persists to localStorage',
  JSON.stringify(optInState));

await page2.close();
await page.close();

console.log(results.join('\n'));
console.log('\nCAPTURE SMOKE: ' + (process.exitCode ? 'FAILED' : 'PASSED') +
  ' (' + results.length + ' assertions)');
await browser.close();
server.close();
