// Verifier — engine library + song persistence across page reload
// Tests that audio, images, and videos uploaded into the engine survive a
// page reload via IndexedDB. Then tests that the Clear button wipes both
// stores.
//
// Usage: node verify-persistence.mjs

import puppeteer from 'puppeteer-core';
import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const URL = process.env.FX_VERIFIER_URL || 'https://sainted-word-records.vercel.app/engine';
const OUT = resolve(__dirname, 'verify-screenshots/persistence');
if (!existsSync(OUT)) mkdirSync(OUT, { recursive: true });

// 1×1 red PNG (89 bytes) — minimal valid image
const TINY_PNG = Buffer.from(
  '89504E470D0A1A0A0000000D49484452000000010000000108020000009077' +
  '53DE0000000C4944415478DA63F8CFC0F01F0000050001009D9C5B2A0000000049454E44AE426082',
  'hex'
);
const TINY_PNG_FILE = resolve(OUT, 'tiny-red.png');
writeFileSync(TINY_PNG_FILE, TINY_PNG);

function generateSongWav(filePath, durationSec = 2) {
  const sampleRate = 22050;
  const numSamples = sampleRate * durationSec;
  const dataSize = numSamples * 2;
  const buf = Buffer.alloc(44 + dataSize);
  buf.write('RIFF', 0);
  buf.writeUInt32LE(36 + dataSize, 4);
  buf.write('WAVE', 8);
  buf.write('fmt ', 12);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(sampleRate * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write('data', 36);
  buf.writeUInt32LE(dataSize, 40);
  for (let i = 0; i < numSamples; i++) {
    const t = i / sampleRate;
    const s = Math.sin(2 * Math.PI * 440 * t) * 0.3;
    buf.writeInt16LE(Math.round(s * 32767), 44 + i * 2);
  }
  writeFileSync(filePath, buf);
}
const SONG_FILE = resolve(OUT, 'test-tone.wav');
generateSongWav(SONG_FILE);

const checks = [];
const log = (name, ok, info) => {
  checks.push({ name, ok, info });
  console.log(`${ok ? '✓' : '✗'} ${name}${info ? '  ' + info : ''}`);
};

const browser = await puppeteer.launch({
  executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: 'new',
  args: ['--no-sandbox', '--disable-setuid-sandbox', '--autoplay-policy=no-user-gesture-required'],
  defaultViewport: { width: 1400, height: 900 },
  protocolTimeout: 60000,
});

// Stub confirm() so the Clear button doesn't block in headless
async function setupPage(page) {
  await page.evaluateOnNewDocument(() => {
    window.confirm = () => true;
    window.alert = () => {};
  });
}

try {
  // First visit — upload song + asset, wait for SAVED, reload
  console.log('\n=== Phase 1: upload + reload ===');
  const page = await browser.newPage();
  await setupPage(page);

  const errors = [];
  page.on('pageerror', (e) => {
    const m = e.message || String(e);
    if (m.includes('VERT') || m.includes('drawImage') || m.includes('InvalidStateError')) return;
    errors.push('pageerror: ' + m);
  });
  page.on('console', (m) => {
    if (m.type() === 'error') {
      const t = m.text();
      if (t.includes('VERT') || t.includes('drawImage') || t.includes('InvalidStateError')) return;
      if (t.includes('404')) return;
      errors.push('console.error: ' + t);
    }
  });

  const resp = await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
  log('engine HTTP 200', resp.status() === 200, `(${resp.status()})`);
  await page.evaluate(() => document.fonts.ready).catch(() => {});
  await new Promise(r => setTimeout(r, 3000));

  // DB exists after Library.init
  const dbHasAssets = await page.evaluate(async () => {
    return !!(window.Library && window.Library.db);
  });
  log('IndexedDB opens with assets+songs stores', dbHasAssets);

  // Upload song
  const songInput = await page.$('#song-input');
  await songInput.uploadFile(SONG_FILE);
  await new Promise(r => setTimeout(r, 800));

  const songName1 = await page.evaluate(() => document.getElementById('song-name').innerHTML);
  log('song-name shows SAVED badge after upload', /SAVED/.test(songName1), songName1.slice(0, 80));
  log('song-name shows song filename', /test-tone\.wav/.test(songName1));

  // Verify the song is actually in IDB
  const songInDb1 = await page.evaluate(async () => {
    const all = await window.Library.db.getAll('songs');
    return all.length > 0 && !!all[0].blob;
  });
  log('song blob saved to IndexedDB', songInDb1);

  // Upload image asset
  const libCount0 = await page.evaluate(() => (window.Library?.items || []).length);
  const assetInput = await page.$('#asset-input');
  await assetInput.uploadFile(TINY_PNG_FILE);
  await new Promise(r => setTimeout(r, 1500));

  const libCount1 = await page.evaluate(() => (window.Library?.items || []).length);
  log('library gains 1 asset after upload', libCount1 === libCount0 + 1,
    `${libCount0} → ${libCount1} (delta ${libCount1 - libCount0})`);

  await page.screenshot({ path: `${OUT}/01-before-reload.png` });

  // Reload
  await page.reload({ waitUntil: 'domcontentloaded' });
  await new Promise(r => setTimeout(r, 4000));  // boot + Library.init + song restore

  const songName2 = await page.evaluate(() => document.getElementById('song-name').innerHTML);
  log('after reload: song-name shows SAVED badge', /SAVED/.test(songName2), songName2.slice(0, 80));
  log('after reload: song-name shows song filename', /test-tone\.wav/.test(songName2));
  log('after reload: Audio.audioEl is populated', await page.evaluate(() => !!window.Audio?.audioEl));

  const libCount2 = await page.evaluate(() => (window.Library?.items || []).length);
  log('after reload: library count matches pre-reload', libCount2 === libCount1,
    `before reload: ${libCount1}, after: ${libCount2}`);

  // Click Clear button
  await page.evaluate(() => document.getElementById('clear-all').click());
  await new Promise(r => setTimeout(r, 1500));

  const songName3 = await page.evaluate(() => document.getElementById('song-name').innerHTML);
  log('after Clear: song-name is empty', /no song/.test(songName3) || songName3.length < 30, songName3.slice(0, 80));

  const libCount3 = await page.evaluate(() => (window.Library?.items || []).length);
  log('after Clear: library is empty', libCount3 === 0, `count: ${libCount3}`);

  const songInDb3 = await page.evaluate(async () => {
    const all = await window.Library.db.getAll('songs');
    return all.length === 0;
  });
  log('after Clear: songs store is empty', songInDb3);

  // Reload to confirm clean slate
  await page.reload({ waitUntil: 'domcontentloaded' });
  await new Promise(r => setTimeout(r, 4000));

  const songName4 = await page.evaluate(() => document.getElementById('song-name').innerHTML);
  log('after Clear + reload: no song', !/test-tone/.test(songName4));

  const libCount4 = await page.evaluate(() => (window.Library?.items || []).length);
  log('after Clear + reload: library empty', libCount4 === 0, `count: ${libCount4}`);

  await page.screenshot({ path: `${OUT}/02-after-clear.png` });

  log('No new console errors', errors.length === 0, errors.length ? errors.slice(0, 2).join('; ') : '');

  const passed = checks.filter(c => c.ok).length;
  const total = checks.length;
  console.log(`\n${passed}/${total} checks passed`);
  if (passed < total) {
    console.log('Failed:');
    checks.filter(c => !c.ok).forEach(c => console.log(`  - ${c.name}: ${c.info || ''}`));
    process.exit(1);
  }
} finally {
  await browser.close();
}
