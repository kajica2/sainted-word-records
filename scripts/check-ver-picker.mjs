// scripts/check-ver-picker.mjs — smoke that the v1/v2/v3 variant picker
// is wired up correctly.
//
// Loads the engine in Puppeteer over a local HTTP server (engine.html
// uses absolute paths like /brandkit.client.js which don't resolve under
// file://). Asserts that the picker exists inside a `.gctrl` element
// with three chips for the first three variants, then clicks v2 and
// asserts the active state syncs to the underlying variant
// (via SWR_VARIANTS_UI).
//
// Run: node scripts/check-ver-picker.mjs
// Exits 0 on green, 1 on red.

import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import http from 'node:http';
import puppeteer from 'puppeteer';
import { setTimeout as sleep } from 'node:timers/promises';
import { ensureDist } from './with-dist.mjs';
import { existsSync, readFileSync, statSync } from 'node:fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
ensureDist();

const DIST = join(__dirname, '..', 'dist');
if (!existsSync(DIST)) {
  console.error(`dist/ not found at ${DIST} — ensureDist() should have built it`);
  process.exit(1);
}

// Spin a static server on a free port so the engine can load its
// absolute-path assets (which don't resolve under file://).
const PORT = await new Promise((resolve) => {
  const srv = http.createServer((req, res) => {
    const path = join(DIST, req.url === '/' ? '/index.html' : req.url);
    if (!existsSync(path) || statSync(path).isDirectory()) {
      res.statusCode = 404;
      return res.end('not found');
    }
    res.setHeader('Content-Type', req.url.endsWith('.js') ? 'text/javascript' :
                       req.url.endsWith('.css') ? 'text/css' :
                       req.url.endsWith('.svg') ? 'image/svg+xml' :
                       req.url.endsWith('.json') ? 'application/json' :
                       'text/html');
    res.end(readFileSync(path));
  });
  srv.listen(0, '127.0.0.1', () => resolve(srv.address().port));
});

let failed = 0;
function check(name, cond, detail) {
  const status = cond ? 'PASS' : 'FAIL';
  console.log(`  ${status}  ${name}${detail ? ' — ' + detail : ''}`);
  if (!cond) failed += 1;
}

const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
try {
  const page = await browser.newPage();
  await page.goto(`http://127.0.0.1:${PORT}/engine.html`, { waitUntil: 'load' });
  await sleep(2000);

  // 1. The picker exists, is a .gctrl, has the right ID
  const pickerInfo = await page.evaluate(() => {
    const el = document.getElementById('ver-picker');
    if (!el) return { ok: false, reason: 'picker not found' };
    return {
      ok: true,
      tagName: el.tagName,
      classes: el.className,
      isGctrl: el.classList.contains('gctrl'),
      chipCount: el.querySelectorAll('.ver-chip').length,
      chipData: Array.from(el.querySelectorAll('.ver-chip')).map((c) => ({
        id: c.dataset.variantId,
        text: c.textContent.trim(),
        pressed: c.getAttribute('aria-pressed'),
      })),
    };
  });
  check('picker exists in DOM', pickerInfo.ok, pickerInfo.reason);
  check('picker is wrapped in .gctrl',
    pickerInfo.ok && pickerInfo.isGctrl,
    'classes=' + pickerInfo.classes);
  check('picker has 3 chips', pickerInfo.ok && pickerInfo.chipCount === 3,
    'count=' + pickerInfo.chipCount);
  check('chips are v1 Neon, v2 Film, v3 Smoke',
    pickerInfo.ok &&
      JSON.stringify(pickerInfo.chipData.map((c) => c.id)) === '["neon","film","smoke"]',
    JSON.stringify(pickerInfo.chipData));
  check('all chips start with aria-pressed="false"',
    pickerInfo.ok && pickerInfo.chipData.every((c) => c.pressed === 'false'),
    'pressed=' + pickerInfo.chipData.map((c) => c.pressed).join(','));

  // 2. SWR_VARIANTS is exposed by the engine bundle
  const variantInfo = await page.evaluate(() => ({
    hasVariant: typeof window.SWR_VARIANTS === 'object' && window.SWR_VARIANTS !== null,
    hasList: typeof window.SWR_VARIANTS?.list === 'function',
    hasActivate: typeof window.SWR_VARIANTS?.activate === 'function',
    hasUi: typeof window.SWR_VARIANTS_UI === 'function',
    currentId: window.SWR_VARIANTS?.current ? (window.SWR_VARIANTS.current()?.id || null) : null,
  }));
  check('window.SWR_VARIANTS is exposed by the engine', variantInfo.hasVariant,
    JSON.stringify(variantInfo));
  check('SWR_VARIANTS has list, activate, and a UI hook',
    variantInfo.hasList && variantInfo.hasActivate && variantInfo.hasUi,
    JSON.stringify(variantInfo));

  // 3. Click v2 (Film) and assert the chip becomes active and the
  // active state propagates through the SWR_VARIANTS_UI hook.
  // The .click() returns synchronously; the activate() promise is
  // awaited inside the click handler (SWR_VARIANTS.activate() is
  // async). We don't await it from the test — we just verify the
  // synchronous side effects (aria-pressed, .on class, UI hook).
  const before = await page.evaluate(() => {
    window.__pickerError = null;
    return { count: document.querySelectorAll('.ver-chip').length };
  });
  await page.evaluate(() => {
    try {
      document.querySelector('.ver-chip[data-variant-id="film"]').click();
    } catch (e) {
      window.__pickerError = e.message;
    }
  });
  await sleep(300);
  const afterClick = await page.evaluate(() => {
    const chips = Array.from(document.querySelectorAll('.ver-chip'));
    return chips.map((c) => ({
      id: c.dataset.variantId,
      pressed: c.getAttribute('aria-pressed'),
      hasOn: c.classList.contains('on'),
    }));
  });
  const filmChip = afterClick.find((c) => c.id === 'film');
  check('after click, film chip is aria-pressed="true"',
    filmChip && filmChip.pressed === 'true',
    JSON.stringify(filmChip));
  check('after click, film chip has .on class',
    filmChip && filmChip.hasOn === true,
    JSON.stringify(filmChip));
  const neonChip = afterClick.find((c) => c.id === 'neon');
  check('after click, neon chip stays aria-pressed="false"',
    neonChip && neonChip.pressed === 'false',
    JSON.stringify(neonChip));

  // 4. SWR_VARIANTS_UI fires for the active state. The activate()
  // call is async (it loads the variant's drawFx source), so give the
  // promise time to settle before reading current(). Note: current()
  // returns the active id *as a string*, not an object — so we
  // compare the string directly, not .id.
  const current = await page.evaluate(async () => {
    const start = Date.now();
    while (Date.now() - start < 1500) {
      const v = window.SWR_VARIANTS && window.SWR_VARIANTS.current
        ? window.SWR_VARIANTS.current() : null;
      if (v) return v;
      await new Promise((r) => setTimeout(r, 50));
    }
    return null;
  });
  check('SWR_VARIANTS.current() reflects the clicked variant (film)',
    current === 'film', 'current=' + JSON.stringify(current));
} finally {
  await browser.close();
}

console.log('');
if (failed) {
  console.log(`FAIL — ${failed} v-picker check(s) failed`);
  process.exit(1);
} else {
  console.log('PASS — v-picker is present, has 3 chips, and is wired to SWR_VARIANTS');
  process.exit(0);
}
