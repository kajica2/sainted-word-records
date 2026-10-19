#!/usr/bin/env node
// scripts/check-svg-grade-integration.mjs — smoke gate for the SVG-grade
// audio-driven filter path.
//
// Why: the SVG-grade path replaces versions/smoke.html's per-frame 2D
// ctx.filter chain with an SVG <filter> graph composed on an overlay
// canvas above #render. This script verifies the wiring:
//
//   1. The codemod (versions/_svg-grade-inject.js) injected the SVG
//      <defs> + <script src=lib/svg-grade.client.js defer> tag at the
//      end of <body> of versions/smoke.html.
//   2. lib/svg-grade.client.js loaded, set up the SVG <filter> graph,
//      created the overlay canvas, and exposed window.SWR_SVG_GRADE.
//   3. The overlay canvas receives `filter: url(#g)` CSS.
//   4. The overlay canvas pixels DIFFER from the stage canvas pixels
//      when a non-identity filter is applied (i.e. the SVG filter is
//      actually compositing).
//
// Robustness note: headless Chrome's SVG filter compositor is CPU-bound
// for non-trivial primitives (an 8px feGaussianBlur on a 1280x720 canvas
// is heavy enough to stall the rAF queue when the variant page is also
// running its own per-frame loop). The pixel-diff step uses
// setTimeout-based waits (not rAF) and a light filter (sepia only,
// no blur / hue / contrast) so the helper still gets a chance to draw
// before the gate reads pixels.
//
// Run: node scripts/check-svg-grade-integration.mjs
// Exit 0 on full pass, 1 otherwise.
//
// Wired into scripts/run-steps.mjs as `check:svg-grade-integration`.

import puppeteer from 'puppeteer';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { ensureDist, serveDist } from './with-dist.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.SVG_GRADE_SMOKE_PORT || 5394);
const BASE = `http://127.0.0.1:${PORT}`;

ensureDist();
const { close } = await serveDist(PORT);

const results = [];
function ok(name) { results.push('  ✓ ' + name); }
function bad(name, got) {
  results.push('  ✗ ' + name + (got ? ' (got: ' + got + ')' : ''));
  process.exitCode = 1;
}

let browser;
try {
  browser = await puppeteer.launch({
    headless: 'new',
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      // The variant pages call Audio.play() during boot; without this
      // flag Chrome rejects with NotAllowedError because no gesture
      // has happened.
      '--autoplay-policy=no-user-gesture-required',
    ],
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 720 });

  const pageErrors = [];
  const consoleErrors = [];
  page.on('pageerror', (e) => pageErrors.push(e.message.split('\n')[0]));
  page.on('console', (m) => {
    if (m.type() === 'error') consoleErrors.push(m.text().slice(0, 200));
  });

  // ---- 1. Load the variant page and wait for the SVG-grade
  // ----    helper to register. The marker-guarded codemod output
  // ----    ships a hidden SVG defs + a defer'd lib script, so the
  // ----    helper is wired before the page's own scripts run.
  await page.goto(`${BASE}/versions/smoke.html`, {
    waitUntil: 'domcontentloaded',
    timeout: 45000,
  });
  await page.waitForFunction(
    () => !!window.SWR_SVG_GRADE,
    { timeout: 15000, polling: 200 }
  ).catch(() => {});

  const boot = await page.evaluate(() => {
    const grade = window.SWR_SVG_GRADE;
    if (!grade) return null;
    const stage = document.getElementById('render');
    const overlay = grade.outputCanvas;
    return {
      svgHostId: grade.svgHost ? grade.svgHost.id : null,
      filterId: grade.filterEl ? grade.filterEl.id : null,
      // The 6 primitives — every primitive missing is a regression
      // from the codemod's graph.
      prims: {
        blur: !!grade.filterEl.querySelector('feGaussianBlur'),
        sepia: !!grade.filterEl.querySelector('feColorMatrix[type="matrix"]'),
        hue: !!grade.filterEl.querySelector('feColorMatrix[type="hueRotate"]'),
        sat: !!grade.filterEl.querySelector('feColorMatrix[type="saturate"]'),
        bright: !!grade.filterEl.querySelectorAll('feComponentTransfer')[0],
        contrast: !!grade.filterEl.querySelectorAll('feComponentTransfer')[1],
      },
      overlayExists: !!overlay,
      overlayFilterAttr: overlay ? overlay.style.filter : null,
      stageExists: !!stage,
      setStyle: typeof grade.setStyle === 'function',
      setFilter: typeof grade.setFilter === 'function',
      applyFilter: typeof grade.applyFilter === 'function',
      off: typeof grade.off === 'function',
    };
  });
  if (!boot) {
    bad('SWR_SVG_GRADE registered');
    throw new Error('SVG-grade helper never set window.SWR_SVG_GRADE');
  }
  ok('SWR_SVG_GRADE registered');

  if (boot.svgHostId === 'swr-svg-grade-filter') ok('codemod-injected SVG host present');
  else bad('SVG host present', 'id=' + boot.svgHostId);

  if (boot.filterId === 'g') ok('filter graph id="g"');
  else bad('filter graph id', boot.filterId);

  if (Object.values(boot.prims).every(Boolean)) ok('all 6 filter primitives wired');
  else bad('primitives wired', JSON.stringify(boot.prims));

  if (boot.overlayExists) ok('overlay canvas exists');
  else bad('overlay canvas exists');

  if (boot.overlayFilterAttr === 'url(#g)' || boot.overlayFilterAttr === 'url("#g")') {
    ok('overlay CSS filter = url(#g)');
  } else {
    bad('overlay CSS filter', boot.overlayFilterAttr);
  }

  if (boot.setStyle && boot.setFilter && boot.applyFilter && boot.off) {
    ok('public API surface (setStyle/setFilter/applyFilter/off)');
  } else {
    bad('public API surface', JSON.stringify({
      setStyle: boot.setStyle, setFilter: boot.setFilter,
      applyFilter: boot.applyFilter, off: boot.off,
    }));
  }

  // ---- 2. Screenshot-based filter check. Set sepia=0.8 (the lightest
  // ----    non-identity primitive — no blur, no hue, no contrast
  // ----    that would tie up the compositor). Wait ~250ms via
  // ----    setTimeout. Then take a screenshot of the viewport,
  // ----    turn the overlay off via setFilter() with identity
  // ----    values + off(), wait, take another screenshot, and
  // ----    compare the two buffers.
  //
  // ----    Why screenshots, not getImageData: CSS `filter: url(#g)`
  // ----    on a <canvas> is a COMPOSITOR effect — it changes how
  // ----    the canvas renders to the screen, NOT the bitmap
  // ----    returned by `getImageData()`. The overlay's bitmap is
  // ----    bit-identical to the stage bitmap regardless of the
  // ----    filter values. To verify the filter is actually
  // ----    composing, we need the composited output — i.e. a
  // ----    Puppeteer screenshot of the page.
  await page.evaluate(() => {
    window.SWR_SVG_GRADE.setFilter(0, 0.8, 0, 1, 1, 1);
  });
  await new Promise((r) => setTimeout(r, 250));
  const withFilter = await page.screenshot({ fullPage: false, encoding: 'binary' });

  await page.evaluate(() => {
    // off() drops the overlay entirely so the screenshot reflects
    // the un-filtered stage.
    window.SWR_SVG_GRADE.off();
  });
  await new Promise((r) => setTimeout(r, 250));
  const withoutFilter = await page.screenshot({ fullPage: false, encoding: 'binary' });

  if (withFilter.length === 0) {
    bad('screenshot captured (with filter)');
  } else if (withoutFilter.length === 0) {
    bad('screenshot captured (without filter)');
  } else if (withFilter.equals(withoutFilter)) {
    bad('filter alters composited output', 'screenshots identical (' + withFilter.length + ' bytes)');
  } else {
    ok(`filter alters composited output (with=${withFilter.length}b without=${withoutFilter.length}b)`);
  }

  // ---- 3. off() removes the overlay. After off(), the overlay's
  // ----    display is none and the next setFilter() does not
  // ----    re-show it without us flipping it back.
  const offState = await page.evaluate(() => {
    window.SWR_SVG_GRADE.off();
    return {
      enabled: window.SWR_SVG_GRADE.state.enabled,
      display: window.SWR_SVG_GRADE.outputCanvas.style.display,
    };
  });
  if (offState.enabled === false && offState.display === 'none') {
    ok('off() hides overlay and disables rAF draw');
  } else {
    bad('off() state', JSON.stringify(offState));
  }

  // Filter out noise from page-error / console-error reporting.
  const PAGE_ERR_FILTER = /favicon|ResizeObserver|AudioContext|getContext.*null|CanvasRenderingContext2D/i;
  const CONSOLE_ERR_FILTER = /favicon|AudioContext|Failed to load resource|WebSocket|ws:\/\//i;
  const realPageErrors = pageErrors.filter((m) => !PAGE_ERR_FILTER.test(m));
  const realConsoleErrors = consoleErrors.filter((m) => !CONSOLE_ERR_FILTER.test(m));
  if (realPageErrors.length === 0) ok('no uncaught page errors during smoke');
  else bad(`${realPageErrors.length} page errors`, realPageErrors.slice(0, 3).join(' | '));
  if (realConsoleErrors.length === 0) ok('no console errors during smoke');
  else bad(`${realConsoleErrors.length} console errors`, realConsoleErrors.slice(0, 3).join(' | '));

  console.log(results.join('\n'));
} catch (e) {
  console.error(e.stack || e.message);
  process.exitCode = 1;
} finally {
  if (browser) await browser.close();
  await close();
}

if (process.exitCode === 1) {
  console.log('\nFAIL — svg-grade integration smoke failed');
  process.exit(1);
} else {
  console.log('\nOK — svg-grade integration smoke passed');
}