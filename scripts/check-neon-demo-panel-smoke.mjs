#!/usr/bin/env node
// Puppeteer smoke: /versions/neon mounts SWR_NEON_DEMO and preset buttons work.

import puppeteer from 'puppeteer';
import { ensureDist, serveDist } from './with-dist.mjs';

ensureDist();
const served = await serveDist(0);
const BASE = served.url;

const browser = await puppeteer.launch({
  args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 720 });

let fails = 0;
function ok(msg) { console.log('  ✓ ' + msg); }
function bad(msg, detail) {
  console.log('  ✗ ' + msg + (detail != null ? ' (' + detail + ')' : ''));
  fails++;
}

try {
  await page.goto(BASE + '/versions/neon.html', { waitUntil: 'networkidle2', timeout: 120000 });
  await page.waitForFunction(function () {
    return window.SWR_NEON_DEMO && document.getElementById('swr-neon-demo');
  }, { timeout: 30000 });

  const hasPanel = await page.evaluate(function () {
    var el = document.getElementById('swr-neon-demo');
    return !!(el && window.SWR_NEON_DEMO && typeof window.SWR_LOOK_FILTER_CYCLER !== 'undefined');
  });
  if (hasPanel) ok('panel + look-filter cycler loaded');
  else bad('panel mount');

  await page.evaluate(function () {
    var t = document.querySelector('#swr-neon-demo .swr-neon-demo-toggle');
    if (t) t.click();
  });

  const before = await page.evaluate(function () {
    return window.SWR_NEON_DEMO.getState().activePreset;
  });
  await page.evaluate(function () {
    var b = document.querySelector('[data-demo-preset="pulse"]');
    if (b) b.click();
  });
  const after = await page.evaluate(function () {
    return window.SWR_NEON_DEMO.getState().activePreset;
  });
  if (after === 'pulse') ok('preset button applies pulse');
  else bad('preset apply', 'before=' + before + ' after=' + after);

  try {
    await page.screenshot({
      path: '/opt/cursor/artifacts/screenshots/neon-demo-panel.png',
      fullPage: false,
    });
    ok('screenshot saved');
  } catch (shotErr) {
    bad('screenshot', shotErr && shotErr.message);
  }
} catch (e) {
  bad('smoke exception', e && e.message);
} finally {
  await browser.close();
  served.close();
}

if (fails) {
  console.log('NEON DEMO PANEL SMOKE: FAIL (' + fails + ')');
  process.exit(1);
}
console.log('NEON DEMO PANEL SMOKE: ALL GREEN');
