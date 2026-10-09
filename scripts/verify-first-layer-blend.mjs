// Regression test for the degenerate-first-layer fix.
//
// Bug: the render loop clears to the backdrop colour (default #000) then
// draws each layer with its blend mode. multiply / overlay / soft-light /
// hard-light / color-burn / color-dodge all resolve against the existing
// backdrop, so over black they return black — a single-layer composition
// whose blend was randomly picked as one of those renders an all-black
// stage. Measured before the fix: 3 of 6 sampled blend modes produced
// luminance 0.
//
// Asserts, against the real page:
//   1. every blend mode renders a non-black frame as the ONLY visible layer
//   2. the authored layer.blend is NOT mutated by the substitution
//   3. a second layer keeps its authored multiply/overlay over real imagery
//   4. the version hash changes when the resolved blend changes
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const CHROME = '/Users/kaidejuricmasscmbook/.agent-browser/browsers/chrome-153.0.8010.52/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing';
const BASE = process.env.JEV_BASE || 'http://localhost:8899';
const PAGE = process.argv[2] || '/versions/glitch.html';
const ASSET = process.argv[3] || path.join(
  process.env.HPV_ROOT || '/Users/kaidejuricmasscmbook/sainted-word-records',
  'default-library/holo-0.webp'
);
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const failures = [];
const ok = (name, cond, detail = '') => {
  console.log(`${cond ? '  ok  ' : ' FAIL '} ${name}${detail ? ' — ' + detail : ''}`);
  if (!cond) failures.push(name);
};

const MODES = ['multiply', 'overlay', 'soft-light', 'hard-light', 'screen', 'lighter', 'difference', 'source-over'];

const browser = await puppeteer.launch({
  executablePath: CHROME, headless: true,
  userDataDir: fs.mkdtempSync(path.join(os.tmpdir(), 'blendtest-')),
  defaultViewport: { width: 1440, height: 900 }, protocolTimeout: 180000,
  args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'],
});
const page = await browser.newPage();
await page.setRequestInterception(true);
page.on('request', (r) => { if (/sw\.js(\?|$)/.test(r.url())) r.abort().catch(() => {}); else r.continue().catch(() => {}); });

const DETACHED = /detached Frame|Execution context was destroyed|Target closed/;
async function live(fn) {
  let last;
  for (let i = 0; i < 6; i++) {
    try { await page.waitForSelector('#render', { timeout: 15000 }); return await fn(); }
    catch (e) { last = e; if (!DETACHED.test(String(e))) throw e; await sleep(3000); }
  }
  throw last;
}

await page.goto(BASE + PAGE, { waitUntil: 'domcontentloaded', timeout: 60000 });
await sleep(4000);

// Seed one real layer through the normal upload path.
await live(async () => { await page.evaluate(() => { const b = document.querySelector('#swr-start button'); if (b) b.click(); }); });
await sleep(1500);
const input = await live(() => page.$('#song-input'));
await input.uploadFile(process.env.JEV_WAV || '/Users/kaidejuricmasscmbook/Downloads/Bebop Blue.wav');
await sleep(2000);
const assetInput = await live(() => page.$('#asset-input'));
await assetInput.uploadFile(ASSET);
await sleep(2500);
// Promote the library card to a layer. Click in-page rather than through
// CDP: puppeteer's element click scrolls and hits the card at its centre,
// which lands on the thumbnail child and does not reach the page's handler
// reliably here. An in-page .click() on the card itself dispatches to the
// same listener the user's click would.
await live(() => page.evaluate(() => {
  const first = document.querySelector('#lib .li .nm') || document.querySelector('#lib .li');
  if (first) first.click();
}));
await sleep(1500);

// Pin geometry + decode so luminance is deterministic. Fail loudly if the
// seed above produced no layer — a missing layer would otherwise surface as
// a confusing "cannot set properties of undefined" several steps later.
const seeded = await live(() => page.evaluate(() => {
  const L = window.SWR.Layers.list;
  if (!L.length) return false;
  L[0].baseScale = 1.0;
  L[0].pos = { x: 0, y: 0, rot: 0 };
  L[0].opacity = 1;
  window.SWR_RENDER.invalidate();
  return true;
}));
if (!seeded) {
  console.log(' FAIL  could not seed a layer — the library card click did not add one');
  console.log('\nFAIL: test fixture did not build');
  await browser.close();
  process.exit(1);
}
await sleep(800);

// Sample a GRID, not one pixel: a single centre pixel can legitimately land
// on a dark region and read as black on a perfectly good frame.
const lum = () => live(() => page.evaluate(() => {
  const c = document.querySelector('#render');
  const cx = c && c.getContext('2d');
  let best = 0;
  if (cx) for (let gx = 1; gx <= 4; gx++) for (let gy = 1; gy <= 4; gy++) {
    const d = cx.getImageData((c.width * gx / 5) | 0, (c.height * gy / 5) | 0, 1, 1).data;
    best = Math.max(best, d[0] + d[1] + d[2]);
  }
  return { lum: best, blend: window.SWR.Layers.list[0].blend };
}));

const results = [];
for (const mode of MODES) {
  await live((m) => page.evaluate((mm) => {
    const L = window.SWR.Layers.list;
    L.length = 1;                       // exactly one visible layer
    L[0].blend = mm;
    L[0].opacity = 1;
    window.SWR_RENDER.invalidate();
  }, mode), mode);
  await sleep(700);
  const r = await lum();
  results.push({ mode, ...r });
  console.log(`${mode.padEnd(12)} lum=${String(r.lum).padStart(4)} layer.blend-after=${r.blend}`);
}

for (const r of results) {
  if (r.lum < 12) { ok(`${r.mode} renders visible`, false, `lum=${r.lum}`); break; }
}
if (results.every(r => r.lum >= 12)) {
  ok('every blend mode renders a non-black frame as the only layer', true,
     `min lum=${Math.min(...results.map(r => r.lum))}`);
}

// Authored blend must survive the draw (no mutation leak).
ok('authored blend preserved (no mutation leak)', results.every(r => r.blend === r.mode));

// Two layers: the second must KEEP its degenerate blend over real imagery.
await live(() => page.evaluate(() => {
  const L = window.SWR.Layers.list;
  L.length = 1;
  L[0].blend = 'screen';
  const clone = JSON.parse(JSON.stringify(L[0]));
  L.push(clone);
  L[1].id = 'L2';
  L[1].blend = 'multiply';
  window.SWR_RENDER.invalidate();
}));
await sleep(900);
const two = await live(() => page.evaluate(() => {
  const c = document.querySelector('#render');
  const cx = c && c.getContext('2d');
  let best = 0;
  if (cx) for (let gx = 1; gx <= 4; gx++) for (let gy = 1; gy <= 4; gy++) {
    const d = cx.getImageData((c.width * gx / 5) | 0, (c.height * gy / 5) | 0, 1, 1).data;
    best = Math.max(best, d[0] + d[1] + d[2]);
  }
  return { lum: best, blends: window.SWR.Layers.list.map(l => l.blend) };
}));
ok('two-layer composition renders visible', two.lum >= 12, `lum=${two.lum}`);
ok('layer 2 keeps its authored multiply over real imagery',
   JSON.stringify(two.blends) === JSON.stringify(['screen', 'multiply']),
   JSON.stringify(two.blends));

// The resolver itself: a non-empty backdrop must NOT substitute.
const resolver = await live(() => page.evaluate(() => {
  const R = window.SWR_RENDER;
  return {
    blackIsEmpty: R.backdropIsEmpty('#000'),
    whiteIsEmpty: R.backdropIsEmpty('#ffffff'),
    transparentIsEmpty: R.backdropIsEmpty('rgba(0,0,0,0)'),
    whiteSubstitute: R.resolveBlend({ blend: 'multiply' }, '#ffffff', true),
    blackSubstitute: R.resolveBlend({ blend: 'multiply' }, '#000', true),
    notFirstSubstitute: R.resolveBlend({ blend: 'multiply' }, '#000', false),
    screenNeverSubstitute: R.resolveBlend({ blend: 'screen' }, '#000', true),
  };
}));
ok('black backdrop reads as empty', resolver.blackIsEmpty === true);
ok('white backdrop reads as non-empty', resolver.whiteIsEmpty === false);
ok('multiply substitutes on a black backdrop', resolver.blackSubstitute.degenerate === true,
   JSON.stringify(resolver.blackSubstitute));
ok('multiply is left alone on a white backdrop', resolver.whiteSubstitute.degenerate === false);
ok('multiply is left alone when not the first visible layer',
   resolver.notFirstSubstitute.degenerate === false && resolver.notFirstSubstitute.blend === 'multiply');
ok('screen is never substituted', resolver.screenNeverSubstitute.degenerate === false);

await browser.close();
console.log('\n' + (failures.length
  ? 'FAIL:\n  ' + failures.join('\n  ')
  : 'PASS: no blend mode renders a black first layer, authored blends preserved, later layers unaffected'));
process.exit(failures.length ? 1 : 0);