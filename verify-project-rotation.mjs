// Verify: when SWR_ROT_MASTER.enabled is false, layers pushed by
// SWR_PROJECT.apply() inherit rotationEnabled=false (not undefined).
//
// Reproduces the original bug: project.client.js pushed layers directly
// to SWR.Layers.list, bypassing the engine-keys Layers.add wrapper that
// copies the master value. After this fix, apply() reads the live
// master and seeds each layer's rotationEnabled accordingly.

import puppeteer from 'puppeteer';

const browser = await puppeteer.launch({
  headless: 'new',
  args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 800 });

const errs = [];
page.on('pageerror', e => errs.push('PE: ' + e.message));
page.on('console', m => { if (m.type() === 'error') errs.push('CE: ' + m.text()); });

await page.goto('http://localhost:5174/engine.html?t=' + Date.now(), { waitUntil: 'networkidle0', timeout: 60000 });
await new Promise(r => setTimeout(r, 1500));

// Wait for SWR_PROJECT + SWR.Layers to mount
let waited = 0;
while (waited < 30000) {
  const ok = await page.evaluate(() => !!window.SWR_PROJECT && !!window.SWR && !!window.SWR.Layers);
  if (ok) break;
  await new Promise(r => setTimeout(r, 200));
  waited += 200;
}
if (waited >= 30000) {
  console.log('FAIL: SWR_PROJECT / SWR.Layers never mounted');
  process.exit(1);
}

// 1. Flip master OFF
const offResult = await page.evaluate(() => {
  window.SWR_ROT_MASTER.enabled = false;
  // Seed two layers with no rotationEnabled set (simulates a layer
  // added before the wrapper was installed, or hand-edited localStorage)
  window.SWR.Layers.list.length = 0;
  window.SWR.Layers.list.push({ id: 'L1', asset: null, blend: 'screen', opacity: 1, baseScale: 1, hue: 0, brightness: 1, contrast: 1, alpha: 1, mutate: 0, reactors: [] });
  window.SWR.Layers.list.push({ id: 'L2', asset: null, blend: 'screen', opacity: 1, baseScale: 1, hue: 0, brightness: 1, contrast: 1, alpha: 1, mutate: 0, reactors: [] });
  // Serialize and re-apply
  const proj = window.SWR_PROJECT.serialize();
  const r = window.SWR_PROJECT.apply(proj);
  return {
    master: window.SWR_ROT_MASTER.enabled,
    layers: window.SWR.Layers.list.map(l => ({ id: l.id, rotationEnabled: l.rotationEnabled })),
    applyResult: r,
    projHasRotationEnabled: proj.layers.map(l => ('rotationEnabled' in l) ? l.rotationEnabled : 'ABSENT'),
  };
});
console.log('CASE A — master OFF, serialize+apply round-trip:');
console.log(JSON.stringify(offResult, null, 2));

// 2. Flip master ON
const onResult = await page.evaluate(() => {
  window.SWR_ROT_MASTER.enabled = true;
  // Reset layers (no rotationEnabled)
  window.SWR.Layers.list.length = 0;
  window.SWR.Layers.list.push({ id: 'L1', asset: null, blend: 'screen', opacity: 1, baseScale: 1, hue: 0, brightness: 1, contrast: 1, alpha: 1, mutate: 0, reactors: [] });
  const proj = window.SWR_PROJECT.serialize();
  window.SWR_PROJECT.apply(proj);
  return {
    master: window.SWR_ROT_MASTER.enabled,
    layers: window.SWR.Layers.list.map(l => ({ id: l.id, rotationEnabled: l.rotationEnabled })),
    projHasRotationEnabled: proj.layers.map(l => ('rotationEnabled' in l) ? l.rotationEnabled : 'ABSENT'),
  };
});
console.log('CASE B — master ON:');
console.log(JSON.stringify(onResult, null, 2));

// 3. Existing project with rotationEnabled=true in JSON → respected on apply (even if master is OFF)
const overrideResult = await page.evaluate(() => {
  window.SWR_ROT_MASTER.enabled = false;
  window.SWR.Layers.list.length = 0;
  const proj = {
    __type: 'swr-project',
    version: 1,
    layers: [
      { id: 'L1', assetId: null, blend: 'screen', opacity: 1, baseScale: 1, hue: 0, brightness: 1, contrast: 1, alpha: 1, mutate: 0, reactors: [], rotationEnabled: true },
      { id: 'L2', assetId: null, blend: 'screen', opacity: 1, baseScale: 1, hue: 0, brightness: 1, contrast: 1, alpha: 1, mutate: 0, reactors: [], rotationEnabled: false },
    ],
    library: [],
  };
  window.SWR_PROJECT.apply(proj);
  return {
    master: window.SWR_ROT_MASTER.enabled,
    layers: window.SWR.Layers.list.map(l => ({ id: l.id, rotationEnabled: l.rotationEnabled })),
  };
});
console.log('CASE C — master OFF, project has per-layer rotationEnabled:');
console.log(JSON.stringify(overrideResult, null, 2));

await browser.close();

// Verdicts
const A_ok = offResult.layers.every(l => l.rotationEnabled === false);
const B_ok = onResult.layers.every(l => l.rotationEnabled === true);
const C_ok = overrideResult.layers[0].rotationEnabled === true && overrideResult.layers[1].rotationEnabled === false;
console.log('CASE A:', A_ok ? 'PASS' : 'FAIL', '(master OFF → all layers rotationEnabled=false)');
console.log('CASE B:', B_ok ? 'PASS' : 'FAIL', '(master ON → all layers rotationEnabled=true)');
console.log('CASE C:', C_ok ? 'PASS' : 'FAIL', '(explicit per-layer value in JSON is respected)');
console.log('ERR_COUNT:', errs.length);
if (errs.length) errs.forEach(e => console.log(e));
if (!A_ok || !B_ok || !C_ok || errs.length) process.exitCode = 1;
