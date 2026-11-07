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

    const shellList = await page.evaluate(async () => {
      const res = await fetch('/color-tales/sw-color-tales.js');
      const text = await res.text();
      const m = text.match(/const SHELL = \[([\s\S]*?)\];/);
      return m ? m[1] : '';
    });
    assert(shellList.includes('color-tales-record.client.js'), 'SW shell lists recorder module');
    assert(shellList.includes('color-tales.css'), 'SW shell lists stylesheet');

    await page.evaluate(() => {
      const svg = (id, fill) =>
        `<svg xmlns="http://www.w3.org/2000/svg"><g id="${id}"><rect width="10" height="10" fill="${fill}"/></g></svg>`;
      window.SWR_COLOR_TALES.setPageData([
        ['One', 'a', { svg: svg('p1', 'red') }],
        ['Two', 'b', { svg: svg('p2', 'blue') }],
      ], [[{ filled: true, areaPx: 400000 }], []]);
      window.SWR_COLOR_TALES.turn(1);
    });
    const pageArt = await page.$eval('#ct-art', (el) => el.innerHTML);
    assert(pageArt.includes('p2') && pageArt.includes('blue'), 'turn() restores per-page refined SVG');

    await page.evaluate(() => {
      const PAINT = window.SWR_COLOR_TALES_PAINT;
      const needs = PAINT?.needsStrokeCap('M1 2');
      const seg = !PAINT?.needsStrokeCap('M1 2 L9 9');
      if (!needs || !seg) throw new Error('stroke cap helpers missing');
    });
    assert(true, 'stroke cap helpers on page');
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
