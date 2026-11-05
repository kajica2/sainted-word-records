#!/usr/bin/env node
// Capture engine UI screenshots for audit / before-after.
import fs from 'node:fs';
import path from 'node:path';
import puppeteer from 'puppeteer';

const OUT = process.argv[2] || '/opt/cursor/artifacts/ui-audit-before';
const BASE = process.env.SWR_AUDIT_BASE || 'http://127.0.0.1:4173';
const pages = [
  { name: 'engine', url: '/engine.html' },
  { name: 'versions-neon', url: '/versions/neon.html' },
];
const viewports = [
  { tag: 'desktop', width: 1440, height: 900 },
  { tag: 'mobile', width: 390, height: 844 },
];

fs.mkdirSync(OUT, { recursive: true });

const browser = await puppeteer.launch({
  headless: true,
  args: ['--no-sandbox', '--disable-setuid-sandbox'],
});

for (const vp of viewports) {
  const page = await browser.newPage();
  await page.setViewport({ width: vp.width, height: vp.height, deviceScaleFactor: 1 });
  for (const p of pages) {
    const url = BASE + p.url;
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 120000 });
    await page.evaluate(() => {
      const start = document.getElementById('swr-start');
      if (start) start.remove();
    });
    await new Promise((r) => setTimeout(r, 800));
    const file = path.join(OUT, `${p.name}-${vp.tag}.png`);
    await page.screenshot({ path: file, fullPage: false });
    console.log('wrote', file);
  }
  await page.close();
}

await browser.close();
console.log('done');
