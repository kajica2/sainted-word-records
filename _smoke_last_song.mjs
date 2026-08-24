// _smoke_last_song.mjs — verify the SWR_PICK_DEFAULT_SONG integration
// across all 18 versions/<engine>.html pages.
//
// For each page:
//   1. Load the page, wait for the FX canvas.
//   2. Capture any console errors / page errors.
//   3. Probe window.SWR_PICK_DEFAULT_SONG — is it defined + callable?
//   4. Probe its return value with a fresh IDB context — should resolve
//      to null (no last song) OR a blob object.
//   5. Probe what happens when called with a known-good fallback URL
//      (the per-page bundled audios/<engine>.mp3).
//   6. Confirm the audio element ends up with a non-empty src (or at least
//      a valid playhead) — i.e. the audio-load path didn't get stuck.
//
// Then a deeper test on ONE page (film): seed IDB with a fake "last song"
// blob before navigation, reload, and confirm the picked result comes
// from IDB instead of the fallback URL.

import { chromium } from '/Users/kajicadjuric/.local/lib/node_modules/playwright/index.mjs';
import fs from 'fs';
import path from 'path';

const ENGINES = [
  'aurora', 'baroque', 'chrome', 'eclipse', 'film', 'fractal', 'gallery',
  'glitch', 'grid', 'hallucination', 'kraft', 'mosaic', 'neon', 'phosphor',
  'pulse', 'smoke', 'tape', 'void', 'watercolor',
];

const BASE = 'https://sainted-word-records-kai-djurics-projects.vercel.app';
const DB_VERSION = 3; // bumped from 2 after the onupgradeneeded fix

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });

const results = [];

for (const name of ENGINES) {
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));

  let probed = { hasPicker: null, pickerCall: null, audioSrc: null, audioReadyState: null };

  try {
    await page.goto(`${BASE}/versions/${name}.html`, { waitUntil: 'networkidle', timeout: 15000 });
    // Wait briefly for the auto-load block to settle
    await page.waitForTimeout(800);

    probed = await page.evaluate(async (eng) => {
      const out = {};
      out.hasPicker = typeof window.SWR_PICK_DEFAULT_SONG === 'function';
      if (out.hasPicker) {
        try {
          // Call with a sentinel fallback. The picker will return either
          // { blob, name, type } (from IDB) or null (and load the fallback
          // URL itself — we don't observe that here, but no-throw is the
          // sanity check).
          const r = await window.SWR_PICK_DEFAULT_SONG('../audios/' + eng + '.mp3');
          out.pickerReturns = r === null ? 'null'
                            : (r && r.blob ? 'blob' : 'other:' + typeof r);
        } catch (e) {
          out.pickerReturns = 'throw:' + e.message;
        }
      }
      // Check audio state
      const audio = document.querySelector('audio');
      if (audio) {
        out.audioSrc = audio.src || '(empty)';
        out.audioReadyState = audio.readyState;
        out.audioDuration = isFinite(audio.duration) ? audio.duration : null;
      } else {
        out.audioSrc = 'no <audio>';
      }
      // Confirm the FX canvas is alive
      out.hasFx = !!document.getElementById('fx-canvas');
      out.hasRender = !!document.getElementById('render');
      return out;
    }, name);

    await page.screenshot({
      path: path.resolve('verify-screenshots', 'last-song', `${name}.png`),
      fullPage: false,
    });
    await page.close();

    results.push({ name, ok: errors.length === 0, errors, probed });
  } catch (e) {
    results.push({ name, ok: false, errors: [e.message], probed });
    await page.close();
  }
}

// Deep test on film.html with seeded IDB (run BEFORE main loop closes browser)
console.log('\n--- Deep test: seed IDB then reload film.html ---');
{
  const deepBrowser = await chromium.launch();
  const ctx2 = await deepBrowser.newContext({ viewport: { width: 1280, height: 720 } });
  const page = await ctx2.newPage();
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));

  // First load just to establish origin (needed for IDB)
  await page.goto(`${BASE}/versions/film.html`, { waitUntil: 'networkidle', timeout: 15000 });
  await page.waitForTimeout(400);

  // First wait a beat for the page's last-song.js to finish its initial
  // IDB open (it kicks off async, doesn't block script eval). If we open
  // concurrently, the second open can race the first's upgrade transaction.
  await page.waitForTimeout(1500);

  // Seed IDB with a fake "last song" — 4-byte RIFF blob.
  // We pass DB_VERSION as an arg because page.evaluate runs in browser
  // scope (no Node closure access).
  const seedResult = await page.evaluate(async (dbVer) => {
    window.__seedPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open('sainted-word-records', dbVer);
      req.onerror = () => reject(req.error?.message || 'idb-open-failed');
      req.onblocked = () => reject('idb-blocked');
      req.onsuccess = (e) => {
        const db = e.target.result;
        const stores = Array.from(db.objectStoreNames);
        if (!stores.includes('songs')) {
          // DB exists at v2 but no songs store — last-song.js didn't create it
          // (e.g. older DB version from a different deployment).
          db.close();
          reject('no-songs-store: ' + stores.join(','));
          return;
        }
        try {
          const tx = db.transaction('songs', 'readwrite');
          const store = tx.objectStore('songs');
          const fakeBlob = new Blob([new Uint8Array([0x52, 0x49, 0x46, 0x46])], { type: 'audio/mpeg' });
          store.put({ id: 'current', blob: fakeBlob, name: 'test-song.mp3', type: 'audio/mpeg', savedAt: Date.now() });
          tx.oncomplete = () => { db.close(); resolve('seeded'); };
          tx.onerror = () => { db.close(); reject(tx.error?.message || 'tx-failed'); };
          tx.onabort = () => { db.close(); reject('tx-aborted'); };
        } catch (err) {
          db.close();
          reject(err.message || 'inner-throw');
        }
      };
    });
    return await window.__seedPromise;
  }, DB_VERSION);
  console.log('IDB seed:', seedResult);

  // Reload — the picker should pick from IDB instead of fallback
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(800);
  const probed2 = await page.evaluate(async () => {
    const r = await window.SWR_PICK_DEFAULT_SONG('/test-fallback.mp3');
    return {
      pickerReturns: r === null ? 'null'
                   : (r && r.blob ? `blob(name=${r.name || '?'})` : 'other'),
      pickerHasBlob: !!(r && r.blob),
      pickerName: r && r.name,
    };
  });
  console.log('after-seed picker:', probed2);
  console.log('errors after seed:', errors.length === 0 ? '(none)' : errors.slice(0, 3));
  await deepBrowser.close();
}

await browser.close();

const ok = results.filter((r) => r.ok).length;
console.log(`\n${ok}/${results.length} engine pages clean (no console errors)\n`);
console.log('picker'.padEnd(8), 'audio'.padEnd(14), 'fx'.padEnd(4), 'page');
console.log('-------  ------------  --  ----');
for (const r of results) {
  const flag = r.ok ? '✓' : '✗';
  const p = r.probed.hasPicker ? 'yes' : 'NO';
  const a = r.probed.audioSrc === 'no <audio>'
    ? 'no-audio'
    : (r.probed.audioSrc && r.probed.audioSrc.includes(name)
       ? 'fallback'
       : (r.probed.audioSrc && r.probed.audioSrc.length > 40
          ? r.probed.audioSrc.slice(0, 40) + '…'
          : (r.probed.audioSrc || '(empty)')));
  const fx = r.probed.hasFx ? 'fx' : (r.probed.hasRender ? 'rd' : '—');
  console.log(`${flag} ${p.padEnd(7)} ${a.padEnd(14)} ${fx.padEnd(4)} ${r.name}`);
  if (!r.ok) {
    for (const e of r.errors.slice(0, 3)) console.log(`      ! ${e.slice(0, 120)}`);
  }
}

process.exit(ok === results.length ? 0 : 1);
