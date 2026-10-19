#!/usr/bin/env node
// scripts/check-webgl-no-invalid-op.mjs — runtime gate for the WebGL
// uniform null-guard fix.
//
// Source-level checks (check-webgl-uniform-guard.mjs) prove the call
// sites use the safe wrappers. This gate proves the runtime behaviour:
// a variant page that loads in headless Chrome with ?webgl=1 emits
// ZERO "WebGL: INVALID_OPERATION: ... location is not from the
// associated program" messages — the exact class of errors the
// fix targets.
//
// Pipeline: spin up dist on an ephemeral port, load /versions/film.html
// + ?webgl=1 (a variant whose preset doesn't declare every uniform),
// wait ~1.5s for the render loop to fire a few times, then inspect
// the page's console errors.
//
// Run: node scripts/check-webgl-no-invalid-op.mjs
// Exit 0 on full pass, 1 otherwise.

import puppeteer from 'puppeteer';
import { ensureDist, serveDist } from './with-dist.mjs';

const PORT = Number(process.env.WEBGL_RUNTIME_PORT || 5398);
const BASE = `http://127.0.0.1:${PORT}`;

ensureDist();
const { close } = await serveDist();

let failed = 0;
function ok(name) { console.log('  PASS  ' + name); }
function bad(name, detail) {
  failed++;
  console.log('  FAIL  ' + name + (detail ? ' — ' + detail : ''));
}
async function check(name, fn) {
  try { await fn(); ok(name); }
  catch (e) { bad(name, e.message.slice(0, 200)); }
}

let browser;
try {
  browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox','--disable-setuid-sandbox','--disable-dev-shm-usage'],
  });

  // The bug-class signature: "WebGL: INVALID_OPERATION: uniform1f:
  // location is not from the associated program" (also 1i / 3f).
  // Some variants post "too many errors, no more errors will be reported"
  // after the rate-limit kicks in.
  const BUG_RE = /INVALID_OPERATION.*location is not from the associated program/i;
  const TOO_MANY_RE = /too many errors.*no more errors will be reported/i;

  async function loadAndProbe(url, expectError) {
    const page = await browser.newPage();
    await page.setViewport({ width: 800, height: 600 });
    const errs = [];
    page.on('console', (m) => {
      if (m.type() === 'error') errs.push(m.text().slice(0, 200));
    });
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 });
    } catch (e) {
      // Some browsers raise page errors when WebGL isn't supported
      // in headless; we want console errors, not page errors. The
      // headless SwiftShader path is a known degradation.
    }
    // Let the render loop fire several frames.
    await new Promise((r) => setTimeout(r, 1500));
    await page.close();
    const bugErrs = errs.filter((e) => BUG_RE.test(e));
    const tooManyErrs = errs.filter((e) => TOO_MANY_RE.test(e));
    return { total: errs.length, bugErrs, tooManyErrs };
  }

  console.log('webgl-no-invalid-op:');

  // ---- 1. Default (?webgl unset): WebGL is OFF, so the broken path
  //        is unreachable — should see zero WebGL errors. This is a
  //        regression guard against accidentally re-enabling default-on.
  await check('default: zero WebGL errors on /versions/film.html', async () => {
    const r = await loadAndProbe(`${BASE}/versions/film.html`);
    if (r.bugErrs.length !== 0) {
      throw new Error(`${r.bugErrs.length} bug-class errors; first: ${r.bugErrs[0]}`);
    }
    if (r.tooManyErrs.length !== 0) {
      throw new Error('rate-limit hit: ' + r.tooManyErrs[0]);
    }
  });

  // ---- 2. Opt-in (?webgl=1): the fix is for THIS path. A variant
  //        whose preset omits some uniforms must NOT emit
  //        INVALID_OPERATION now that the safe setters are wired.
  await check('?webgl=1: zero WebGL errors on /versions/film.html', async () => {
    const r = await loadAndProbe(`${BASE}/versions/film.html?webgl=1`);
    if (r.bugErrs.length !== 0) {
      throw new Error(`${r.bugErrs.length} bug-class errors; first: ${r.bugErrs[0]}`);
    }
    if (r.tooManyErrs.length !== 0) {
      throw new Error('rate-limit hit: ' + r.tooManyErrs[0]);
    }
  });

  // ---- 3. Opt-in + minimal preset: hallucination is the most
  //        uniform-sparse preset (3 chains — see
  //        versions-presets.js). This is the worst-case before the
  //        fix. After the fix, also zero errors.
  await check('?webgl=1: zero WebGL errors on /versions/hallucination.html', async () => {
    const r = await loadAndProbe(`${BASE}/versions/hallucination.html?webgl=1`);
    if (r.bugErrs.length !== 0) {
      throw new Error(`${r.bugErrs.length} bug-class errors; first: ${r.bugErrs[0]}`);
    }
    if (r.tooManyErrs.length !== 0) {
      throw new Error('rate-limit hit: ' + r.tooManyErrs[0]);
    }
  });

  // ---- 4. Opt-in + an additional preset: smoke has 3 chains,
  //        watercolor has a sparse uniform set. This catches
  //        uniform-set coverage.
  await check('?webgl=1: zero WebGL errors on /versions/watercolor.html', async () => {
    const r = await loadAndProbe(`${BASE}/versions/watercolor.html?webgl=1`);
    if (r.bugErrs.length !== 0) {
      throw new Error(`${r.bugErrs.length} bug-class errors; first: ${r.bugErrs[0]}`);
    }
    if (r.tooManyErrs.length !== 0) {
      throw new Error('rate-limit hit: ' + r.tooManyErrs[0]);
    }
  });

} catch (e) {
  console.error(e.stack || e.message);
  process.exitCode = 1;
} finally {
  if (browser) await browser.close();
  await close();
}

if (failed) {
  console.log('\nFAIL — ' + failed + ' webgl-no-invalid-op check(s) failed');
  process.exit(1);
} else {
  console.log('\nOK — all webgl-no-invalid-op checks passed');
}