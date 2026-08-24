// _probe_idb.mjs — direct probe of IDB state after a fresh page load.
import { chromium } from '/Users/kajicadjuric/.local/lib/node_modules/playwright/index.mjs';

const BASE = 'https://sainted-word-records-kai-djurics-projects.vercel.app';
const DB = 'sainted-word-records';
const DB_VERSION = 3; // bumped from 2 after the onupgradeneeded fix
const browser = await chromium.launch();
const ctx = await browser.newContext();
const page = await ctx.newPage();

// Test 1: fresh, just load film.html (which runs last-song.js)
await page.goto(`${BASE}/versions/film.html`, { waitUntil: 'networkidle' });
await page.waitForTimeout(2000);
const state1 = await page.evaluate(async ([dbName, dbVer]) => {
  const stores = await new Promise((resolve, reject) => {
    const req = indexedDB.open(dbName, dbVer);
    req.onsuccess = () => {
      const db = req.result;
      const s = Array.from(db.objectStoreNames);
      db.close();
      resolve(s);
    };
    req.onerror = () => reject(req.error?.message || 'err');
  });
  return { stores };
}, [DB, DB_VERSION]);
console.log('After film.html load (last-song.js runs):', state1);

// Test 2: probe SWR_PICK_DEFAULT_SONG behavior directly
const probe = await page.evaluate(async () => {
  const r1 = await window.SWR_PICK_DEFAULT_SONG('/test-fallback.mp3');
  return {
    pickerType: typeof window.SWR_PICK_DEFAULT_SONG,
    firstResult: r1 === null ? 'null' : `blob(name=${r1?.name},source=${r1?.source})`,
  };
});
console.log('Picker probe:', probe);

// Test 3: now load engine.html to see if IT creates the stores
await page.goto(`${BASE}/engine.html`, { waitUntil: 'networkidle' });
await page.waitForTimeout(2000);
const state2 = await page.evaluate(async ([dbName, dbVer]) => {
  const stores = await new Promise((resolve, reject) => {
    const req = indexedDB.open(dbName, dbVer);
    req.onsuccess = () => {
      const db = req.result;
      const s = Array.from(db.objectStoreNames);
      db.close();
      resolve(s);
    };
    req.onerror = () => reject(req.error?.message || 'err');
  });
  return { stores };
}, [DB, DB_VERSION]);
console.log('After engine.html load:', state2);

await browser.close();
