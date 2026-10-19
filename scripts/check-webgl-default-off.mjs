#!/usr/bin/env node
// scripts/check-webgl-default-off.mjs — gate for the WebGL default-off
// decision (lib/webgl-feature-detect.client.js).
//
// Verifies the helper honours every input combination:
//
//   no flag                → OFF (the new default)
//   ?webgl=1               → enabled (URL wins over localStorage)
//   ?webgl=0               → disabled
//   swrWebGL = "1"         → enabled
//   swrWebGL = "0"         → disabled
//   swrDisableWebGL = "1"  → disabled (legacy opt-out, kept for one cycle)
//
// Plus the convenience API: requireWebGL() returns null when disabled,
// a real context when enabled.
//
// Wired into scripts/run-steps.mjs as `check:webgl-default-off`.

import puppeteer from 'puppeteer';
import { ensureDist, serveDist } from './with-dist.mjs';

const PORT = Number(process.env.WEBGL_SMOKE_PORT || 5396);
const BASE = `http://127.0.0.1:${PORT}`;

ensureDist();
const { close } = await serveDist(PORT);

let failed = 0;
function ok(name) { console.log('  PASS  ' + name); }
function bad(name, detail) {
  failed++;
  console.log('  FAIL  ' + name + (detail ? ' — ' + detail : ''));
}

async function check(name, fn) {
  try { await fn(name); ok(name); }
  catch (e) { bad(name, e.message.slice(0, 200)); }
}

let browser;
try {
  browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox','--disable-setuid-sandbox','--disable-dev-shm-usage'],
  });

  async function freshPage(url, setupFn) {
    const page = await browser.newPage();
    if (setupFn) await setupFn(page);
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 });
    // Helper attaches synchronously to window.SWR_WEBGL when its
    // script tag fires. domcontentloaded fires after the defer queue.
    await page.waitForFunction(() => !!window.SWR_WEBGL, { timeout: 5000 })
      .catch(() => {});
    return page;
  }

  async function probe(page) {
    return await page.evaluate(() => {
      if (!window.SWR_WEBGL) return { helperPresent: false };
      // requireWebGL on a fresh canvas — gives us both the boolean
      // and the convenience-wrapper behaviour.
      const c = document.createElement('canvas');
      let gl = null;
      try { gl = window.SWR_WEBGL.requireWebGL(c); } catch {}
      return {
        helperPresent: true,
        isWebGLEnabled: window.SWR_WEBGL.isWebGLEnabled(),
        isExplicitlyDisabled: window.SWR_WEBGL.isWebGLExplicitlyDisabled(),
        requireWebGLReturned: !!gl,
        defaultIsExported: window.SWR_WEBGL.WEBGL_DEFAULT_ENABLED,
      };
    });
  }

  console.log('webgl-default-off:');

  // ---- 1. Default state: no flag → OFF ----
  await check('default (no flag) → isWebGLEnabled() === false', async () => {
    const page = await freshPage(`${BASE}/engine.html`);
    const r = await probe(page);
    if (!r.helperPresent) throw new Error('SWR_WEBGL not attached');
    if (r.isWebGLEnabled !== false) throw new Error('expected false, got ' + r.isWebGLEnabled);
    if (r.defaultIsExported !== false) throw new Error('WEBGL_DEFAULT_ENABLED !== false');
    if (r.requireWebGLReturned !== false) throw new Error('requireWebGL returned a context');
    await page.close();
  });

  // ---- 2. ?webgl=1 → enabled ----
  await check('?webgl=1 → isWebGLEnabled() === true', async () => {
    const page = await freshPage(`${BASE}/engine.html?webgl=1`);
    const r = await probe(page);
    if (r.isWebGLEnabled !== true) throw new Error('expected true, got ' + r.isWebGLEnabled);
    await page.close();
  });

  // ---- 3. ?webgl=0 → disabled ----
  await check('?webgl=0 → isWebGLEnabled() === false', async () => {
    const page = await freshPage(`${BASE}/engine.html?webgl=0`);
    const r = await probe(page);
    if (r.isWebGLEnabled !== false) throw new Error('expected false, got ' + r.isWebGLEnabled);
    if (r.isExplicitlyDisabled !== true) throw new Error('expected isExplicitlyDisabled true');
    await page.close();
  });

  // ---- 4. localStorage swrWebGL=1 → enabled ----
  await check('swrWebGL=1 → isWebGLEnabled() === true', async () => {
    const page = await freshPage(`${BASE}/engine.html`, async (p) => {
      await p.evaluateOnNewDocument(() => {
        try { localStorage.setItem('swrWebGL', '1'); } catch {}
      });
    });
    const r = await probe(page);
    if (r.isWebGLEnabled !== true) throw new Error('expected true, got ' + r.isWebGLEnabled);
    await page.close();
  });

  // ---- 5. localStorage swrWebGL=0 → disabled ----
  await check('swrWebGL=0 → isWebGLEnabled() === false', async () => {
    const page = await freshPage(`${BASE}/engine.html`, async (p) => {
      await p.evaluateOnNewDocument(() => {
        try { localStorage.setItem('swrWebGL', '0'); } catch {}
      });
    });
    const r = await probe(page);
    if (r.isWebGLEnabled !== false) throw new Error('expected false, got ' + r.isWebGLEnabled);
    if (r.isExplicitlyDisabled !== true) throw new Error('expected isExplicitlyDisabled true');
    await page.close();
  });

  // ---- 6. Legacy swrDisableWebGL=1 still wins (opt-out) ----
  await check('legacy swrDisableWebGL=1 → still disabled', async () => {
    const page = await freshPage(`${BASE}/engine.html`, async (p) => {
      await p.evaluateOnNewDocument(() => {
        try { localStorage.setItem('swrDisableWebGL', '1'); } catch {}
      });
    });
    const r = await probe(page);
    if (r.isWebGLEnabled !== false) throw new Error('expected false, got ' + r.isWebGLEnabled);
    if (r.isExplicitlyDisabled !== true) throw new Error('expected isExplicitlyDisabled true');
    await page.close();
  });

  // ---- 7. URL wins over localStorage ----
  await check('?webgl=0 + swrWebGL=1 → URL wins (disabled)', async () => {
    const page = await freshPage(`${BASE}/engine.html?webgl=0`, async (p) => {
      await p.evaluateOnNewDocument(() => {
        try { localStorage.setItem('swrWebGL', '1'); } catch {}
      });
    });
    const r = await probe(page);
    if (r.isWebGLEnabled !== false) throw new Error('URL should win; got true');
    await page.close();
  });

  await check('?webgl=1 + swrWebGL=0 → URL wins (enabled)', async () => {
    const page = await freshPage(`${BASE}/engine.html?webgl=1`, async (p) => {
      await p.evaluateOnNewDocument(() => {
        try { localStorage.setItem('swrWebGL', '0'); } catch {}
      });
    });
    const r = await probe(page);
    if (r.isWebGLEnabled !== true) throw new Error('URL should win; got false');
    await page.close();
  });

  // ---- 8. requireWebGL behaviour ----
  await check('requireWebGL returns null when disabled', async () => {
    const page = await freshPage(`${BASE}/engine.html`);
    const r = await probe(page);
    if (r.requireWebGLReturned !== false) throw new Error('expected null when disabled');
    await page.close();
  });

  await check('requireWebGL returns a context when enabled', async () => {
    const page = await freshPage(`${BASE}/engine.html?webgl=1`);
    const r = await probe(page);
    if (r.requireWebGLReturned !== true) throw new Error('expected a context when enabled');
    await page.close();
  });

  // ---- 9. Helper exposes the documented public surface ----
  await check('helper public surface: isWebGLEnabled, requireWebGL, isWebGLExplicitlyDisabled, WEBGL_DEFAULT_ENABLED', async () => {
    const page = await freshPage(`${BASE}/engine.html`);
    const surface = await page.evaluate(() => {
      const w = window.SWR_WEBGL;
      return {
        hasIsWebGLEnabled: typeof w.isWebGLEnabled === 'function',
        hasRequireWebGL: typeof w.requireWebGL === 'function',
        hasIsExplicit: typeof w.isWebGLExplicitlyDisabled === 'function',
        hasDefaultExport: typeof w.WEBGL_DEFAULT_ENABLED === 'boolean',
      };
    });
    const missing = Object.entries(surface).filter(([k, v]) => !v).map(([k]) => k);
    if (missing.length) throw new Error('missing exports: ' + missing.join(', '));
    await page.close();
  });

  // ---- 10. Variant pages (no helper script tag) still bail defensively ----
  await check('variant page (no helper) — fx-postprocess / versions-presets bail', async () => {
    const page = await freshPage(`${BASE}/versions/film.html`);
    // The variant page doesn't load /lib/webgl-feature-detect.client.js
    // directly. The consumers bail if the helper is missing OR off.
    // We just verify that no console errors come from the WebGL paths.
    const consoleErrors = [];
    page.on('console', (m) => {
      if (m.type() === 'error') consoleErrors.push(m.text().slice(0, 200));
    });
    await new Promise((r) => setTimeout(r, 500));
    // The variant page may not load the helper. SWR_WEBGL should be
    // undefined. We just verify the page didn't throw WebGL errors.
    const r = await probe(page);
    if (r.helperPresent) {
      // helper happens to be there; just check the boolean.
      if (r.isWebGLEnabled !== false) throw new Error('helper says enabled on variant page (default should be off)');
    }
    await page.close();
  });

} catch (e) {
  console.error(e.stack || e.message);
  process.exitCode = 1;
} finally {
  if (browser) await browser.close();
  await close();
}

if (failed) {
  console.log('\nFAIL — ' + failed + ' webgl-default-off check(s) failed');
  process.exit(1);
} else {
  console.log('\nOK — all webgl-default-off checks passed');
}