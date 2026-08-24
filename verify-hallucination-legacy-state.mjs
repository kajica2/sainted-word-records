// Verify the fix for hallucination.html crash on legacy persisted state.
// Reproduces the real-world bug: a layer persisted by an older build
// (no `reactors`, no `opacity` fields in localStorage) is loaded back
// and crashes Layers.render() / applyR() on every frame.
//
// Seeds a stale snapshot BEFORE page load, then asserts:
//   - 0 page errors / console errors during cold load
//   - 0 errors after a synthetic pointer gesture
//   - SWR.Audio.ctx.state === 'running', playing === true
//   - Layers restored with valid reactors + opacity

import puppeteer from 'puppeteer';

const PAGE_ID = 'hallucination';

const STALE_SNAPSHOT = {
  pageId: PAGE_ID,
  version: 1,
  savedAt: Date.now() - 86_400_000,
  selectedLayerId: null,
  layers: [
    { id: 'L1', assetId: null, blend: 'lighter',
      baseScale: 1.0, contrast: 1.6, brightness: 1.4, alpha: 1, mutate: 0, hue: 0,
      cell: null },
    { id: 'L2', assetId: null, blend: 'difference',
      baseScale: 1.3, contrast: 1.6, brightness: 1.4, alpha: 1, mutate: 0, hue: 0,
      cell: null },
    { id: 'L3', assetId: null, blend: 'screen',
      baseScale: 0.8, contrast: 1.6, brightness: 1.4, alpha: 1, mutate: 0, hue: 0,
      cell: null },
  ],
  global: { sens: 1.0, gate: 0.1, decay: 0.15, autoCycle: false },
  presets: [],
};

async function run(label, launchArgs) {
  const browser = await puppeteer.launch({ headless: 'new', args: launchArgs });
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 800 });

  const errs = [];
  const warns = [];
  page.on('pageerror', e => errs.push('PE: ' + e.message));
  page.on('console', m => {
    const t = m.type();
    const txt = m.text();
    if (t === 'error') errs.push('CE: ' + txt);
    else if (t === 'warning') warns.push('CW: ' + txt);
  });

  await page.evaluateOnNewDocument((snap) => {
    localStorage.setItem('swr.engineState.' + snap.pageId, JSON.stringify(snap));
  }, STALE_SNAPSHOT);

  await page.goto('http://localhost:5174/versions/hallucination.html?nocache=' + Date.now(), { waitUntil: 'networkidle0', timeout: 30000 });
  await new Promise(r => setTimeout(r, 2000));

  const coldErr = errs.slice();
  console.log(label + ' COLD_ERR_COUNT=' + coldErr.length);
  if (coldErr.length) console.log(label + ' COLD_ERR=' + JSON.stringify(coldErr, null, 2));

  const layerReport = await page.evaluate(() => {
    const L = window.SWR && window.SWR.Layers;
    if (!L) return null;
    return {
      count: (L.list || []).length,
      hasReactors: (L.list || []).every(l => Array.isArray(l.reactors) && l.reactors.length > 0),
      hasOpacity:  (L.list || []).every(l => Number.isFinite(l.opacity)),
      sample: (L.list || []).slice(0, 2).map(l => ({ id: l.id, opacity: l.opacity, reactors: l.reactors && l.reactors.length })),
    };
  });
  console.log(label + ' LAYER_REPORT=' + JSON.stringify(layerReport));

  await page.evaluate(() => {
    window.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true }));
    document.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true }));
  });
  await new Promise(r => setTimeout(r, 1500));

  const warmErr = errs.slice(coldErr.length);
  console.log(label + ' AFTER_GESTURE_NEW_ERR=' + warmErr.length);
  if (warmErr.length) console.log(label + ' WARM_ERR=' + JSON.stringify(warmErr, null, 2));

  const playState = await page.evaluate(() => {
    const A = window.SWR && window.SWR.Audio;
    const btn = document.getElementById('play');
    return { ctxState: A && A.ctx && A.ctx.state, playing: A && A.playing, btn: btn ? btn.textContent.trim() : null };
  });
  console.log(label + ' PLAY_STATE=' + JSON.stringify(playState));

  await browser.close();

  if (coldErr.length || warmErr.length || !layerReport || !layerReport.hasReactors || !layerReport.hasOpacity) {
    console.log(label + ' VERDICT=FAIL');
    process.exitCode = 1;
  } else {
    console.log(label + ' VERDICT=PASS');
  }
}

await run('BYPASS', ['--no-sandbox', '--autoplay-policy=no-user-gesture-required']);
await run('STRICT', ['--no-sandbox']);
