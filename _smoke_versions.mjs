// _smoke_versions.mjs — load every versions/<engine>.html via Playwright,
// wait for the canvas to render + the FX shader to apply, and screenshot
// the result. Reports any console errors.

import { chromium } from '/Users/kajicadjuric/.local/lib/node_modules/playwright/index.mjs';
import fs from 'fs';
import path from 'path';

const ENGINES = [
  'aurora', 'baroque', 'chrome', 'eclipse', 'film', 'fractal', 'gallery',
  'glitch', 'grid', 'hallucination', 'kraft', 'mosaic', 'neon', 'phosphor',
  'pulse', 'smoke', 'tape', 'void', 'watercolor',
];

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
const page = await ctx.newPage();

const errors = [];
page.on('console', (msg) => {
  if (msg.type() === 'error') errors.push(`[console.error] ${msg.text()}`);
});
page.on('pageerror', (err) => {
  errors.push(`[pageerror] ${err.message}`);
});

const out = path.resolve('verify-screenshots', 'versions-presets');
fs.mkdirSync(out, { recursive: true });

const summary = [];
for (const name of ENGINES) {
  errors.length = 0;
  const url = `http://localhost:4173/versions/${name}.html`;
  try {
    await page.goto(url, { waitUntil: 'networkidle', timeout: 15000 });
    // Give the canvas + FX pipeline a couple of frames to settle
    await page.waitForTimeout(900);
    // Capture the FX canvas if it exists, else the render canvas
    const hasFx = await page.evaluate(() => !!document.getElementById('fx-canvas'));
    const hasRender = await page.evaluate(() => !!document.getElementById('render'));
    const screenshot = path.join(out, `${name}.png`);
    await page.screenshot({ path: screenshot, fullPage: false });
    summary.push({
      name,
      url,
      ok: errors.length === 0,
      hasFx,
      hasRender,
      errors: errors.slice(),
      shot: screenshot,
    });
  } catch (e) {
    summary.push({ name, url, ok: false, error: e.message });
  }
}

await browser.close();

const ok = summary.filter((s) => s.ok).length;
console.log(`\n${ok}/${summary.length} engine pages rendered without console errors:\n`);
for (const s of summary) {
  const flag = s.ok ? '✓' : '✗';
  const fx = s.hasFx ? 'fx-canvas' : (s.hasRender ? 'render' : '?');
  console.log(`  ${flag} ${s.name.padEnd(14)} ${fx.padEnd(10)} ${s.errors.length === 0 ? '' : s.errors.slice(0, 2).join(' | ')}`);
}
if (ok !== summary.length) process.exit(1);
