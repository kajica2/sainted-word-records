#!/usr/bin/env node
// verify-grid-library-persist.mjs
//
// Confirms grid.html persists user uploads to IndexedDB and rehydrates on
// reload. Uses observable DOM (library tile count under #lib) and the
// SWR_MEDIA public API (counts only). No internal-Lib access required.
//
// Flow:
//   1. Launch grid.html, wait for boot.
//   2. Wipe any pre-existing IDB content so the test is deterministic.
//   3. Reload, drive the file input.
//   4. Wait for the IDB write (count >= 1).
//   5. Reload. Wait for hydrate.
//   6. Assert the library DOM contains the uploaded file name.
//
// Requires: dev server running at :5174, puppeteer installed.

import puppeteer from 'puppeteer';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const URL = process.env.GRID_URL || 'http://127.0.0.1:5174/versions/grid.html';
const tmp = mkdtempSync(join(tmpdir(), 'grid-persist-'));

// Tiny valid JPEG (red 1×1 pixel).
const RED_JPEG = Buffer.from(
  '/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAAEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEB' +
  'AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEB/9sAQwEBAQEBAQEBAQEBAQEBAQEB' +
  'AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEB/8AAEQgA' +
  'AAQABAwEiAAIRAQMRAf/EABUAAQEAAAAAAAAAAAAAAAAAAAAJ/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/' +
  'EAaIAAQABBQEBAQAAAAAAAAAAAAABEQMSITFBUWEicf/aAAgBAQABPwA//9k=',
  'base64'
);
const FIXTURE = join(tmp, 'persistence-test.jpg');
writeFileSync(FIXTURE, RED_JPEG);

const log = (...a) => console.log('[verify-grid-persist]', ...a);

const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--disable-gpu'] });
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 900 });

// Capture errors and warnings so failures are diagnosable.
const diagnostics = [];
page.on('console', m => {
  if (m.type() === 'error' || m.type() === 'warning') diagnostics.push(`[${m.type()}] ${m.text()}`);
});
page.on('pageerror', e => diagnostics.push(`[pageerror] ${e.message}`));

async function load() {
  await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 15000 });
  await page.waitForFunction(
    () => !!(window.SWR_MEDIA && window.SWR_MEDIA.getUserMedia && window.SWR_MEDIA.deleteAll),
    { timeout: 15000 }
  );
  // Give the inline IIFE + library-loader a beat to wire up.
  await new Promise(r => setTimeout(r, 500));
}

// Step 1 — initial load + wipe.
log('initial load + IDB wipe');
await load();
const wiped = await page.evaluate(async () => {
  await window.SWR_MEDIA.deleteAll();
  const remaining = (await window.SWR_MEDIA.getUserMedia()).length;
  return remaining;
});
if (wiped !== 0) throw new Error(`expected empty IDB after deleteAll, got ${wiped} records`);

// Step 2 — reload, drive the file input.
log('reload to clean in-memory state, then upload');
await page.reload({ waitUntil: 'domcontentloaded' });
await page.waitForFunction(
  () => !!(window.SWR_MEDIA && window.SWR_MEDIA.addMedia && document.getElementById('asset-input')),
  { timeout: 15000 }
);
const fileInput = await page.$('#asset-input');
if (!fileInput) throw new Error('#asset-input not found after reload');
await fileInput.uploadFile(FIXTURE);

// Wait for the IDB write to complete.
await page.waitForFunction(
  async () => {
    const records = await window.SWR_MEDIA.getUserMedia();
    return records.some(r => r.name === 'persistence-test.jpg');
  },
  { timeout: 10000, polling: 200 }
);
const afterUpload = await page.evaluate(async () => {
  const records = await window.SWR_MEDIA.getUserMedia();
  return { count: records.length, names: records.map(r => r.name) };
});
log('after upload IDB:', afterUpload);
if (afterUpload.count < 1) throw new Error('IDB write did not land within timeout');
// Strict: after a wipe + a single upload, exactly one user record should exist.
// Curated assets must NEVER be persisted to IDB (regression guard).
if (afterUpload.count !== 1) throw new Error(`expected exactly 1 user record after wipe+upload, got ${afterUpload.count} (curated items may be leaking into IDB)`);

// Step 3 — reload, expect hydrate to repopulate.
log('reload to test hydrate');
await page.reload({ waitUntil: 'domcontentloaded' });

// After hydrate runs, the library DOM (#lib) must contain a tile with our
// filename in its `.nm` span. We give it generous time for: IDB open +
// getUserMedia + blob URL create + DOM insert.
await page.waitForFunction(
  () => {
    const el = document.getElementById('lib');
    if (!el) return false;
    const tiles = el.querySelectorAll('.li');
    return Array.from(tiles).some(t => {
      const nm = t.querySelector('.nm');
      return nm && nm.textContent.includes('persistence-test');
    });
  },
  { timeout: 15000, polling: 250 }
);

const afterReload = await page.evaluate(() => {
  const el = document.getElementById('lib');
  const tiles = Array.from(el.querySelectorAll('.li'));
  return {
    totalTiles: tiles.length,
    persistedTile: tiles.find(t => {
      const nm = t.querySelector('.nm');
      return nm && nm.textContent.includes('persistence-test');
    }) ? {
      hasUserMarker: !!document.querySelector('.li.li-user'),
      hasDeleteButton: !!document.querySelector('.li.li-user .li-x'),
    } : null,
  };
});
log('after reload DOM:', afterReload);

if (!afterReload.persistedTile) {
  throw new Error('uploaded file did not rehydrate as a tile after reload');
}
if (!afterReload.persistedTile.hasUserMarker) {
  throw new Error('rehydrated tile missing .li-user class (curated/user distinction broken)');
}
if (!afterReload.persistedTile.hasDeleteButton) {
  throw new Error('rehydrated tile missing .li-x delete button');
}

if (diagnostics.length) {
  log('page diagnostics:', diagnostics.join('\n  '));
}
log('PASS — file persisted across reload, hydrated with user marker + delete button');
await browser.close();
process.exit(0);
