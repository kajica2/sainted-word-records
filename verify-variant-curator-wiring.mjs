#!/usr/bin/env node
// verify-variant-curator-wiring.mjs — verifies the deduped curator wiring
// works the same on all 5 core variants.
//
//   node verify-variant-curator-wiring.mjs
//
// Asserts per variant:
//   1. variant loads with no console errors
//   2. the shared lib/variant-curator-wiring.client.js script is loaded
//   3. window.SWR_CURATOR_WIRED is exposed
//   4. all 5 toolbar buttons (hook/stats/mood/scenes/automix) are present
//   5. clicking Stats opens a modal (verifies the wired modal-creation
//      path works end-to-end with the new shared library)
//   6. clicking Scenes opens a modal with 4 pads
//
// Also asserts the dedup itself:
//   7. none of the 5 variants still contains the old
//      "Variant UI wiring" inline comment block

import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import puppeteer from 'puppeteer';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PORT = 8210;
const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml',
};

function localServe() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      let rel = decodeURIComponent(req.url.split('?')[0].replace(/^\/+/, '')) || 'engine.html';
      const file = path.join(ROOT, rel);
      if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) {
        res.writeHead(404); res.end('nf:' + rel); return;
      }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream' });
      fs.createReadStream(file).pipe(res);
    });
    server.listen(PORT, () => resolve(server));
  });
}

const VARIANTS = [
  ['neon.html',         'versions/neon.html'],
  ['film.html',         'versions/film.html'],
  ['grid.html',         'versions/grid.html'],
  ['smoke.html',        'versions/smoke.html'],
  ['hallucination.html', 'versions/hallucination.html'],
];

const BUTTON_IDS = ['hook-btn', 'stats-btn', 'mood-btn', 'scenes-btn', 'automix-toggle'];

function ok(label) { console.log(`  \u2713 ${label}`); }
function fail(label, msg) { console.log(`  \u2717 ${label}: ${msg}`); process.exitCode = 1; }

async function checkVariant(page, label, variantPath) {
  console.log(`\n[${label}]`);

  const errors = [];
  const onErr = (e) => errors.push(String(e));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', onErr);

  await page.goto(`http://localhost:${PORT}/${variantPath}`, { waitUntil: 'networkidle2', timeout: 30000 });
  await new Promise(r => setTimeout(r, 1500));

  const realErrors = errors.filter(e =>
    !e.includes('SWR_RENDER') &&
    !e.includes('ws://') &&
    !e.includes('404') &&
    !e.includes('QUOTA_EXCEEDED')
  );
  if (realErrors.length === 0) ok(`${label}: loads clean`);
  else fail(`${label}: console errors`, realErrors.join('; '));

  // 2. Shared library script loaded
  const sharedLoaded = await page.evaluate(() =>
    Array.from(document.querySelectorAll('script[src]')).some(s =>
      (s.getAttribute('src') || '').includes('variant-curator-wiring')
    )
  );
  if (sharedLoaded) ok(`${label}: shared library script loaded`);
  else fail(`${label}: shared library`, 'not in DOM');

  // 3. SWR_CURATOR_WIRED exposed
  const wired = await page.evaluate(() => !!window.SWR_CURATOR_WIRED);
  if (wired) ok(`${label}: window.SWR_CURATOR_WIRED exposed`);
  else fail(`${label}: SWR_CURATOR_WIRED`, 'missing');

  // 4. All 5 toolbar buttons present
  const buttons = await page.evaluate((ids) => {
    const out = {};
    for (const id of ids) out[id] = !!document.getElementById(id);
    return out;
  }, BUTTON_IDS);
  const missingBtns = Object.entries(buttons).filter(([, v]) => !v).map(([k]) => k);
  if (missingBtns.length === 0) ok(`${label}: all 5 toolbar buttons present`);
  else fail(`${label}: toolbar buttons`, `missing: ${missingBtns.join(', ')}`);

  // 5. Stats click opens a modal (verifies the shared library's
  //    makeModal() path works — modal IDs are swr-stats-modal,
  //    swr-curator-close class, etc.)
  await page.evaluate(() => document.getElementById('stats-btn').click());
  await new Promise(r => setTimeout(r, 200));
  const statsOpen = await page.evaluate(() => {
    var m = document.getElementById('swr-stats-modal');
    return m ? m.textContent.slice(0, 200) : '';
  });
  if (statsOpen.includes('Local Stats') && (statsOpen.includes('Renders') || statsOpen.includes('Total')))
    ok(`${label}: Stats click opens modal with render data`);
  else fail(`${label}: Stats modal`, statsOpen);
  await page.evaluate(() => { var m = document.getElementById('swr-stats-modal'); if (m) m.remove(); });

  // 6. Scenes click opens a modal with 4 pads
  await page.evaluate(() => document.getElementById('scenes-btn').click());
  await new Promise(r => setTimeout(r, 200));
  const scenesPadCount = await page.evaluate(() =>
    document.querySelectorAll('#swr-scenes-list button').length
  );
  if (scenesPadCount === 4) ok(`${label}: Scenes click opens modal with 4 pads`);
  else fail(`${label}: Scenes pads`, `expected 4, got ${scenesPadCount}`);
  await page.evaluate(() => { var m = document.getElementById('swr-scenes-modal'); if (m) m.remove(); });

  page.off('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  page.off('pageerror', onErr);
}

async function checkDedup() {
  // 7. None of the variants still contains the old inline block
  let leaks = 0;
  for (const [, variantPath] of VARIANTS) {
    const text = fs.readFileSync(path.join(ROOT, variantPath), 'utf8');
    if (text.includes('Variant UI wiring (Phase 2') ||
        text.includes('Variant UI wiring — see neon')) {
      console.log(`  \u2717 dedup: ${variantPath} still has inline curator block`);
      leaks++;
    }
  }
  if (leaks === 0) ok('dedup: no variant still ships the inline curator block (515 lines deleted)');
  else fail('dedup', `${leaks} variants still have inline curator wiring`);
}

async function run() {
  const server = await localServe();
  let browser;
  try {
    browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
    const page = await browser.newPage();
    for (const [label, variantPath] of VARIANTS) {
      await checkVariant(page, label, variantPath);
    }
    await checkDedup();
  } finally {
    if (browser) await browser.close();
    server.close();
  }
}

run().catch(err => {
  console.error('FATAL', err);
  process.exit(1);
});