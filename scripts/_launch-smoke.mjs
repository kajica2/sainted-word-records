// scripts/_launch-smoke.mjs
// Launch smoke against the LIVE site: does the engine actually render?
// A 200 tells you the URL resolves; it says nothing about whether the product
// works. This drives the deployed engine for real.
//
//   node scripts/_launch-smoke.mjs
//   SWR_BASE=https://staging.example.com node scripts/_launch-smoke.mjs
//
// Checks, on <BASE>/engine :
//   1. loads with HTTP 200 and boots with no fatal page/console errors
//   2. window.SWR exposes Audio / Library / Layers / Renderer / Story
//   3. an image asset added as a layer draws non-blank pixels on #render
//   4. a visual preset applies without throwing
//
// Underscore-prefixed like the other standalone scripts/_*.mjs tools: nothing
// loads it and no gate runs it, deliberately — it needs the network and a
// deployed site, which would make CI flaky.
//
// Note: Renderer is a property of window.SWR, NOT a global. Waiting on
// window.Renderer silently never resolves; that mistake cost a debugging
// round here, so it is called out.
//
// Prints a JSON report and exits non-zero if any hard check fails.
import puppeteer from 'puppeteer';

const BASE = process.env.SWR_BASE || 'https://sainted-word-records.vercel.app';
const ENGINE = process.env.SWR_ENGINE || '/engine';

const browser = await puppeteer.launch({
  args: ['--no-sandbox', '--disable-setuid-sandbox', '--autoplay-policy=no-user-gesture-required'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 800 });

const errs = [];
page.on('pageerror', (e) => errs.push('PAGEERR: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error') errs.push('CONSOLE: ' + m.text()); });

let status = null;
try {
  const resp = await page.goto(BASE + ENGINE, { waitUntil: 'domcontentloaded', timeout: 60000 });
  status = resp ? resp.status() : null;
  await page.waitForFunction('!!window.SWR && !!window.SWR.Renderer && !!window.Layers', { timeout: 30000 });
} catch (e) {
  console.log(JSON.stringify({
    ok: false,
    stage: 'boot',
    status,
    error: e.message,
    errors: errs.slice(0, 8),
  }, null, 2));
  await browser.close();
  process.exit(1);
}

// Let the render loop settle.
await new Promise((r) => setTimeout(r, 1500));

const api = await page.evaluate(() => {
  const S = window.SWR || {};
  return {
    keys: ['Audio', 'Library', 'Layers', 'Renderer', 'Story'].filter((k) => !!S[k]),
    hasApplyPreset: typeof window.applyVisualPreset === 'function' || typeof S.applyPreset === 'function',
    canvasCount: document.querySelectorAll('canvas').length,
  };
});

// Add a real asset from the seed library and confirm it paints.
const draw = await page.evaluate(async () => {
  const L = window.Layers;
  if (!L || !L.add) return { err: 'no Layers.add' };
  const img = new Image();
  img.src = '/default-library/holo-0.webp';
  const loaded = await new Promise((r) => {
    img.onload = () => r(true);
    img.onerror = () => r(false);
    setTimeout(() => r(false), 10000);
  });
  if (!loaded) return { err: 'seed asset failed to load' };
  const asset = {
    id: 'launch-probe', type: 'image', name: 'launch-probe',
    url: img.src, w: img.naturalWidth, h: img.naturalHeight, _el: img, rotation: 0,
  };
  L.add(asset);
  const layer = L.list && L.list[L.list.length - 1];
  if (layer) { layer.opacity = 1; layer.reactors = []; layer.modulators = []; layer.baseScale = 1; }
  await new Promise((r) => setTimeout(r, 900));
  const stage = document.getElementById('render');
  if (!stage) {
    return { err: 'no #render canvas', canvases: [...document.querySelectorAll('canvas')].map((c) => c.id || '(anon)') };
  }
  const g = stage.getContext('2d');
  const d = g.getImageData(0, 0, stage.width, stage.height).data;
  let min = 255, max = 0;
  const seen = new Set();
  for (let i = 0; i < d.length; i += 4) { const l = d[i]; if (l < min) min = l; if (l > max) max = l; seen.add(l); }
  return { stageW: stage.width, stageH: stage.height, min, max, spread: max - min, distinct: seen.size, layers: L.list ? L.list.length : 0 };
});

// Apply a visual preset and confirm nothing throws.
const preset = await page.evaluate(() => {
  try {
    const fn = typeof window.applyVisualPreset === 'function' ? window.applyVisualPreset
      : (window.SWR && typeof window.SWR.applyPreset === 'function' ? window.SWR.applyPreset : null);
    if (!fn) return { err: 'no preset API' };
    const before = window._activePreset ? (window._activePreset.id || window._activePreset.name) : null;
    fn('pulse');
    return { ok: true, before, after: window._activePreset ? (window._activePreset.id || window._activePreset.name) : null };
  } catch (e) { return { err: e.message }; }
});

await browser.close();

const fatal = errs.filter((e) => !/WebSocket|ws:\/\/localhost|ERR_CONNECTION_REFUSED|Failed to load resource.*40[34]/i.test(e));
const checks = {
  httpStatus: status === 200,
  noFatalErrors: fatal.length === 0,
  apiComplete: api.keys.length === 5,
  canvasPresent: api.canvasCount > 0,
  renderedNonBlank: !draw.err && draw.spread > 20 && draw.distinct > 20,
  presetApplies: !preset.err,
};
const ok = Object.values(checks).every(Boolean);

console.log(JSON.stringify({
  ok, url: BASE + ENGINE, checks,
  api,
  draw,
  preset,
  fatalErrors: fatal.slice(0, 6),
}, null, 2));
console.log(ok ? 'LIVE ENGINE SMOKE: PASS' : 'LIVE ENGINE SMOKE: FAIL');
process.exit(ok ? 0 : 1);
