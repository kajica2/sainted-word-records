// scripts/check-automix-smoke.mjs
// Puppeteer smoke test against the live music_video.html. Verifies:
//   1. Page boots without console errors
//   2. SWR_AUTOMIX is defined
//   3. The Automix toggle button exists and starts in OFF state
//   4. Clicking it switches state to ON
//   5. After 2.5s, window.SWR._fxOverride is a non-null object with
//      all 8 fx_state fields
//   6. Pressing `A` toggles it back OFF and _fxOverride stays frozen
//
// Run command (after `npm run build`):
//   node scripts/check-automix-smoke.mjs
//
// Pass criteria: 6/6 assertions green, exit 0.

import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import puppeteer from 'puppeteer';

// Static server for the built dist/
const distDir = path.resolve(dirname(fileURLToPath(import.meta.url)), '../dist');
const server = http.createServer((req, res) => {
  let p = req.url.split('?')[0];
  if (p.endsWith('/')) p += 'index.html';
  let file = path.join(distDir, p);
  if (!file.startsWith(distDir)) { res.statusCode = 403; res.end(); return; }
  fs.readFile(file, (err, data) => {
    if (err) { res.statusCode = 404; res.end(); return; }
    const ext = path.extname(file);
    const mime = ext === '.html' ? 'text/html' : ext === '.js' ? 'text/javascript' : 'application/octet-stream';
    res.setHeader('Content-Type', mime);
    res.end(data);
  });
});
server.listen(5181);

const browser = await puppeteer.launch({ args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'] });
const page = await browser.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

await page.goto('http://localhost:5181/versions/music_video.html', { waitUntil: 'networkidle0', timeout: 30000 });

const results = [];
function ok(name) { results.push('  ✓ ' + name); }
function bad(name, got) { results.push('  ✗ ' + name + ' (got: ' + got + ')'); process.exitCode = 1; }

// 1. No console errors during boot (excluding pre-existing dev-control WS
//    probe noise — that socket is opened by the engine regardless of this
//    PR and connection-refused messages are emitted when the dev server
//    is not running, which is the case in CI).
const fatalErrors = errors.filter(e => !/WebSocket.*ws:\/\/localhost:8787/.test(e));
if (fatalErrors.length === 0) ok('no console errors at boot');
else bad('no console errors at boot', JSON.stringify(fatalErrors));

// 2. SWR_AUTOMIX defined
const hasAutomix = await page.evaluate(() => !!window.SWR_AUTOMIX);
if (hasAutomix) ok('SWR_AUTOMIX defined'); else bad('SWR_AUTOMIX defined', 'undefined');

// 3. Toggle button present, OFF by default
const state0 = await page.evaluate(() => document.getElementById('automix-state') && document.getElementById('automix-state').textContent);
if (state0 === 'OFF') ok('toggle starts OFF'); else bad('toggle starts OFF', state0);

// 4. Click → ON (use evaluate-click for reliability: puppeteer's page.click
//    scrolls into view, which on this page can land at the footer's bottom
//    edge outside the label's hit area; the label is <span>/<label>
//    semantically, so a programmatic .click() exercises the same handler.)
await page.evaluate(() => document.getElementById('automix-toggle').click());
await new Promise(r => setTimeout(r, 100));
const state1 = await page.evaluate(() => document.getElementById('automix-state').textContent);
if (state1 === 'ON') ok('click flips to ON'); else bad('click flips to ON', state1);

// 5. After 2.5s, _fxOverride populated with 8 fields
await new Promise(r => setTimeout(r, 2500));
const fx = await page.evaluate(() => {
  const o = window.SWR && window.SWR._fxOverride;
  if (!o) return null;
  return ['temp','mut','sepia','chroma','grain','glow','grayscale','posterize'].every(k => typeof o[k] === 'number');
});
if (fx) ok('_fxOverride has all 8 numeric fields'); else bad('_fxOverride has all 8 numeric fields', String(fx));

// 6. Press A → OFF, _fxOverride not cleared (frozen)
await page.keyboard.press('a');
await new Promise(r => setTimeout(r, 100));
const state2 = await page.evaluate(() => document.getElementById('automix-state').textContent);
const fxFrozen = await page.evaluate(() => !!window.SWR._fxOverride);
if (state2 === 'OFF' && fxFrozen) ok('A key toggles OFF + freezes _fxOverride');
else bad('A key toggles OFF + freezes _fxOverride', 'state=' + state2 + ' frozen=' + fxFrozen);

await browser.close();
server.close();
console.log(results.join('\n'));
console.log('AUTOMIX SMOKE: ' + (process.exitCode ? 'FAILED' : 'ALL GREEN') + ' (' + results.length + ' assertions)');
