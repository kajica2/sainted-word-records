// scripts/check-engine-mobile.mjs — verify the engine.html mobile layout.
//
// FIX 3 from the architecture audit. The engine's grid layout
// (240px + 1fr + 280px) collapses to a zero-width canvas on any
// phone. This test asserts:
//   1. At 390x844 (iPhone 12 viewport), section#stage has
//      non-zero client width and contains a canvas.
//   2. At 480x800 (small tablet), same.
//   3. At 1440x900 (desktop), the original layout is preserved.
//
// Exits 0 on success, 1 on failure. Run: `node scripts/check-engine-mobile.mjs`
// or `npm run check:engine-mobile`.

import puppeteer from 'puppeteer';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

const VIEWPORTS = [
  { name: '390x844 (iPhone)', width: 390, height: 844, minStage: 100 },
  { name: '480x800 (small tablet)', width: 480, height: 800, minStage: 200 },
  { name: '1440x900 (desktop)', width: 1440, height: 900, minStage: 800 },
];

const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
let failed = 0;

try {
  for (const v of VIEWPORTS) {
    const page = await browser.newPage();
    await page.setViewport({ width: v.width, height: v.height });
    await page.goto('file://' + resolve(ROOT, 'engine.html'), { waitUntil: 'domcontentloaded' });
    await sleep(800);
    const info = await page.evaluate(() => {
      const stage = document.getElementById('stage');
      const transport = document.getElementById('transport');
      const app = document.getElementById('app');
      return {
        appWidth: app ? app.getBoundingClientRect().width : null,
        stageWidth: stage ? stage.getBoundingClientRect().width : null,
        transportWidth: transport ? transport.getBoundingClientRect().width : null,
        transportScrollW: transport ? transport.scrollWidth : null,
        stageHasCanvas: !!(stage && stage.querySelector('canvas')),
      };
    });
    const ok = info.stageWidth > v.minStage && info.stageHasCanvas;
    const status = ok ? 'PASS' : 'FAIL';
    console.log(`${status}  ${v.name}: stage=${info.stageWidth?.toFixed(0)}px, transport=${info.transportWidth?.toFixed(0)}px, canvas=${info.stageHasCanvas}`);
    if (!ok) {
      failed++;
      console.log(`       expected stage width > ${v.minStage}px with a canvas, got width=${info.stageWidth} canvas=${info.stageHasCanvas}`);
    }
    await page.close();
  }
} finally {
  await browser.close();
}

if (failed) {
  console.log(`\nFAIL — ${failed} viewport(s) failed`);
  process.exit(1);
} else {
  console.log(`\nPASS — all ${VIEWPORTS.length} viewports render with non-zero stage + canvas`);
  process.exit(0);
}
