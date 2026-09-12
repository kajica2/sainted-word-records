#!/usr/bin/env node
// verify-clear-song.mjs — smoke test for the "Clear song" button.
// Loads engine.html, uploads a fake song to IDB, asserts the button is
// visible, clicks it (with confirm auto-accept), asserts the songs store
// is empty afterwards while the assets store still has its data.
//
//   node verify-clear-song.mjs

import puppeteer from 'puppeteer';

const URL = 'http://127.0.0.1:5174/engine.html';
let failed = 0;
const ok = (msg) => console.log('  ✓', msg);
const bad = (msg) => { console.log('  ✗', msg); failed++; };

const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--disable-gpu'] });
const page = await browser.newPage();
page.on('pageerror', (e) => console.log('  [pageerror]', e.message));
page.on('console', (m) => {
  if (m.type() === 'error') {
    const t = m.text();
    if (t.includes('404') || t.includes('VERT') || t.includes('AudioContext')) return;
    console.log('  [console.error]', t);
  }
});

await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 15000 });
// Wait for SWR_RESET_STATE to be exposed AND the engine's first-paint
// phases to finish (audio init, library loader, song-name pill, etc.).
// Without the second wait, the engine can re-render the body mid-test
// and destroy the execution context.
await page.waitForFunction(() => !!window.SWR_RESET_STATE, { timeout: 10000 });
await new Promise((r) => setTimeout(r, 1500));

// 1. Confirm the "Clear song" button is present.
const hasBtn = await page.evaluate(() => {
  const btn = document.querySelector('[data-clear="songs"]');
  return !!(btn && btn.textContent.includes('Clear song'));
});
if (hasBtn) ok('Clear song button is in the DOM');
else bad('Clear song button missing');

// 2. Seed IDB with one asset + one song + one set so we can confirm
//    narrow clear preserves assets/sets but wipes songs.
const seeded = await page.evaluate(async () => {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('sainted-word-records', 4);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains('assets')) db.createObjectStore('assets', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('songs'))  db.createObjectStore('songs',  { keyPath: 'id' });
      if (!db.objectStoreNames.contains('sets'))   db.createObjectStore('sets',   { keyPath: 'id' });
    };
    req.onsuccess = () => {
      const db = req.result;
      const seedOne = (store, rec) => new Promise((res) => {
        const tx = db.transaction(store, 'readwrite');
        tx.objectStore(store).put(rec);
        tx.oncomplete = () => res(true);
        tx.onerror = () => res(false);
      });
      Promise.all([
        seedOne('assets', { id: 'a1', name: 'test.png', blob: new Blob(['x']), mime: 'image/png', createdAt: Date.now() }),
        seedOne('songs',  { id: 'current', blob: new Blob(['x']), name: 'test.mp3', type: 'audio/mpeg', savedAt: Date.now() }),
        seedOne('sets',   { id: 's1', name: 'test-set', createdAt: Date.now() }),
      ]).then(() => {
        db.close();
        resolve(true);
      });
    };
    req.onerror = () => reject(req.error);
  });
});
if (seeded) ok('seeded IDB with 1 asset / 1 song / 1 set');
else bad('seed failed');

// 3. Confirm the counts before clearing.
const before = await page.evaluate(async () => {
  return new Promise((resolve) => {
    const req = indexedDB.open('sainted-word-records', 4);
    req.onsuccess = () => {
      const db = req.result;
      const counts = {};
      let done = 0;
      ['assets', 'songs', 'sets'].forEach((s) => {
        const tx = db.transaction(s, 'readonly');
        const r = tx.objectStore(s).count();
        r.onsuccess = () => {
          counts[s] = r.result;
          done++;
          if (done === 3) { db.close(); resolve(counts); }
        };
      });
    };
  });
});
console.log('  before:', JSON.stringify(before));
if (before.songs >= 1 && before.assets >= 1 && before.sets >= 1) {
  ok('pre-clear counts: assets>=1 songs>=1 sets>=1');
} else {
  bad('pre-clear counts too low: ' + JSON.stringify(before));
}

// 4. Stub confirm() to auto-accept, then click "Clear song".
await page.evaluate(() => { window.confirm = () => true; });
await page.evaluate(() => {
  const btn = document.querySelector('[data-clear="songs"]');
  btn.click();
});
// wipeOnly awaits the IDB clear and then calls location.reload() to
// re-mount the UI. Wait for the navigation to complete, then check
// counts again on the reloaded page.
try {
  await page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 5000 });
} catch (_) { /* no nav (unlikely) */ }
await new Promise((r) => setTimeout(r, 500));

const after = await page.evaluate(async () => {
  return new Promise((resolve) => {
    const req = indexedDB.open('sainted-word-records', 4);
    req.onsuccess = () => {
      const db = req.result;
      const counts = {};
      let done = 0;
      ['assets', 'songs', 'sets'].forEach((s) => {
        const tx = db.transaction(s, 'readonly');
        const r = tx.objectStore(s).count();
        r.onsuccess = () => {
          counts[s] = r.result;
          done++;
          if (done === 3) { db.close(); resolve(counts); }
        };
      });
    };
  });
});
console.log('  after:', JSON.stringify(after));
if (after.songs === 0 && after.assets >= 1 && after.sets >= 1) {
  ok('post-clear counts: assets>=1 songs=0 sets>=1 (narrow clear preserved assets/sets)');
} else {
  bad('post-clear counts unexpected: ' + JSON.stringify(after));
}

await browser.close();

if (failed) {
  console.log(`\n${failed} check(s) failed`);
  process.exit(1);
} else {
  console.log('\nAll checks passed.');
}