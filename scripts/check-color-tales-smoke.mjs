#!/usr/bin/env node
import puppeteer from 'puppeteer';
import { ensureDist, serveDist } from './with-dist.mjs';

async function main() {
  ensureDist();
  const { url: base, close } = await serveDist(5197);
  const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
  const page = await browser.newPage();
  let failures = 0;
  const assert = (c, m) => { if (c) console.log('  ✓', m); else { console.log('  ✗', m); failures++; } };

  try {
    await page.goto(`${base}/color-tales.html`, { waitUntil: 'networkidle2', timeout: 60000 });
    await page.waitForSelector('#ct-canvas', { timeout: 15000 });
    assert(await page.$('swr-nav'), 'shared nav mounts');
    assert(await page.$('swr-footer'), 'shared footer mounts');
    const title = await page.title();
    assert(title.includes('Color Tales'), 'page title');
    const globals = await page.evaluate(() => ({
      c: !!window.SWR_COLOR_TALES_CONSTANTS,
      r: !!window.SWR_COLOR_TALES,
      e: !!window.SWR_COLOR_TALES_EXPORT,
    }));
    assert(globals.c && globals.r && globals.e, 'Color Tales globals loaded');
    const hasArt = await page.$eval('#ct-canvas', (el) => el.innerHTML.length > 20);
    assert(hasArt, 'canvas paints on boot');
  } finally {
    await browser.close();
    await close();
  }

  if (failures) process.exit(1);
  console.log('Color Tales smoke passed.');
}

main().catch((e) => {
  console.error(e);
  process.exit(2);
});
