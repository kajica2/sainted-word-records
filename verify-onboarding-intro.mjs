// Smoke test for the engine's first-time onboarding + shortcuts panel.
// Verifies:
//   1. Auto-opens on first visit (localStorage absent) — after ~600ms delay
//   2. Clicking "Got it" closes the panel + persists localStorage (when
//      "don't show again" is checked)
//   3. Reload with persisted localStorage → panel does NOT auto-open
//   4. Clicking the ? button opens the panel again
//   5. Pressing Escape closes it
//
// Run: node verify-onboarding-intro.mjs
// Exit non-zero on any failed assertion.

import puppeteer from 'puppeteer';

const URL = process.env.SWR_ENGINE_URL || 'http://127.0.0.1:5174/engine.html';
const STORAGE_KEY = 'swr.onboarded.v1';

const browser = await puppeteer.launch({
  headless: 'new',
  args: [
    '--no-sandbox',
    '--autoplay-policy=no-user-gesture-required',
    '--disable-background-timer-throttling',
    '--disable-renderer-backgrounding',
    '--use-gl=swiftshader',
  ],
});
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 900 });

let pageErrors = [];
page.on('pageerror', (e) => { pageErrors.push(e.message); console.log('  [pageerror]', e.message); });
page.on('console', m => {
  if (m.type() === 'error') { pageErrors.push(m.text()); console.log(`  [page console error]`, m.text()); }
  if (m.text().startsWith('[SWR')) console.log('[page]', m.text());
});

// ---- 1. Auto-opens on first visit ----
// localStorage starts empty. Confirm the panel shows up after the delay.
await page.setBypassServiceWorker(true); // don't let the SW serve stale code
// Don't wipe swr.onboarded.v1 in evaluateOnNewDocument — that runs on
// EVERY page load including reload, which would undo the dismiss the
// test just performed. Instead, the test wipes it explicitly via
// page.evaluate() at the start of the first phase, and never again.
await page.evaluateOnNewDocument(() => {
  // Pre-set the persona key to suppress the persona modal.
  try { localStorage.setItem('swr.persona.v1', JSON.stringify({ id: 'skipped', skippedAt: new Date().toISOString() })); } catch (_) {}
  // Hook every storage mutation so we can audit if anything clears
  // the dismiss key on the second-page-load path.
  try {
    window.__lsHooks = [];
    const oSet = Storage.prototype.setItem;
    const oDel = Storage.prototype.removeItem;
    const oClr = Storage.prototype.clear;
    Storage.prototype.setItem = function(k, v) {
      window.__lsHooks.push({ op: 'set', k, t: Date.now() });
      return oSet.apply(this, arguments);
    };
    Storage.prototype.removeItem = function(k) {
      window.__lsHooks.push({ op: 'del', k, t: Date.now() });
      return oDel.apply(this, arguments);
    };
    Storage.prototype.clear = function() {
      window.__lsHooks.push({ op: 'clear', t: Date.now() });
      return oClr.apply(this, arguments);
    };
  } catch (_) {}
});
console.log(`▶ loading ${URL} (fresh localStorage)`);
await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
// Wipe the onboard key for the FIRST phase only — reloads preserve it.
await page.evaluate(() => { try { localStorage.removeItem('swr.onboarded.v1'); } catch (_) {} });
// Force a reload so the script reads the wiped state and auto-opens.
await page.reload({ waitUntil: 'domcontentloaded', timeout: 60000 });
await new Promise(r => setTimeout(r, 2000));

const personaState = await page.evaluate(() => ({
  personaStorage: localStorage.getItem('swr.persona.v1'),
  personaModal: !!document.getElementById('persona-onboarding-modal'),
  personaChoice: window.SWR_PERSONA && window.SWR_PERSONA.getChosen && window.SWR_PERSONA.getChosen(),
}));
console.log('▶ persona state:', personaState);

// Wait for the panel to be visible — it opens after a 600ms delay.
await page.waitForFunction(() => {
  const el = document.getElementById('swr-onboard');
  return el && !el.hidden && el.classList.contains('is-open');
}, { timeout: 5000 }).catch(() => null);

let state = await page.evaluate(() => {
  const el = document.getElementById('swr-onboard');
  return {
    hidden: el ? el.hidden : null,
    isOpen: el ? el.classList.contains('is-open') : null,
    storage: localStorage.getItem('swr.onboarded.v1'),
    api: !!window.SWR_ONBOARD,
  };
});
console.log('▶ after load:', JSON.stringify(state));
if (!state.isOpen) {
  console.error('FAIL: panel did not auto-open on first visit');
  await browser.close();
  process.exit(1);
}

// ---- 2. Dismiss closes the panel + writes localStorage when checkbox checked ----
await page.evaluate(() => {
  const cb = document.getElementById('swr-onboard-hide');
  cb.checked = true;
});
// Real mouse click on the Got-it button — page.evaluate-based .click() was
// bypassing event capture on some engines, leading to the close handler
// never firing. Use coordinates so we exercise the real bubble path.
// Scroll the footer into view first — on 900px-tall viewports the panel
// content can push the footer below the fold.
await page.evaluate(() => {
  const btn = document.querySelector('#swr-onboard [data-onboard-close].tbtn.primary');
  btn.scrollIntoView({ block: 'center', behavior: 'instant' });
});
// Re-measure after scroll
const gotItBox = await page.$eval('#swr-onboard [data-onboard-close].tbtn.primary', (el) => {
  const r = el.getBoundingClientRect();
  return { x: r.x + r.width / 2, y: r.y + r.height / 2, w: r.width, h: r.height };
});
console.log('▶ Got-it box:', gotItBox);
const what = await page.evaluate((x, y) => {
  const el = document.elementFromPoint(x, y);
  return el ? { tag: el.tagName, cls: typeof el.className === 'string' ? el.className.slice(0, 50) : '', id: el.id } : null;
}, gotItBox.x, gotItBox.y);
console.log('▶ elementFromPoint at center:', what);
await page.mouse.click(gotItBox.x, gotItBox.y);
// Wait for the close transition + storage write
await new Promise(r => setTimeout(r, 400));

state = await page.evaluate(() => {
  const el = document.getElementById('swr-onboard');
  return {
    hidden: el ? el.hidden : null,
    isOpen: el ? el.classList.contains('is-open') : null,
    storage: localStorage.getItem('swr.onboarded.v1'),
  };
});
console.log('▶ after dismiss:', JSON.stringify(state));
if (!state.hidden) {
  console.error('FAIL: panel did not close on Got-it click');
  await browser.close();
  process.exit(1);
}
if (!state.storage) {
  console.error('FAIL: localStorage was not written after dismiss with checkbox checked');
  await browser.close();
  process.exit(1);
}

// ---- 3. Reload with persisted localStorage → panel does NOT auto-open ----
console.log('▶ reloading with persisted localStorage');
// Verify storage before reload
const preReload = await page.evaluate(() => localStorage.getItem('swr.onboarded.v1'));
console.log('▶ storage pre-reload:', preReload);
await page.reload({ waitUntil: 'domcontentloaded', timeout: 60000 });
await new Promise(r => setTimeout(r, 2000));
const lsHooks = await page.evaluate(() => window.__lsHooks || []);
const onboardHooks = lsHooks.filter(h => (h.k || '').includes('onboard'));
console.log('▶ storage hooks touching onboard key (post-reload):', JSON.stringify(onboardHooks));
state = await page.evaluate(() => {
  const el = document.getElementById('swr-onboard');
  return {
    hidden: el ? el.hidden : null,
    isOpen: el ? el.classList.contains('is-open') : null,
    storage: localStorage.getItem('swr.onboarded.v1'),
    onboardApi: !!(window.SWR_ONBOARD),
  };
});
console.log('▶ after reload:', JSON.stringify(state));
if (!state.hidden || state.isOpen) {
  console.error('FAIL: panel auto-opened on a previously-dismissed browser');
  await browser.close();
  process.exit(1);
}

// ---- 4. Click the ? button → panel opens ----
const helpBox = await page.$eval('#swr-keys-help-btn', (el) => {
  const r = el.getBoundingClientRect();
  return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
});
await page.mouse.click(helpBox.x, helpBox.y);
await page.waitForFunction(() => {
  const el = document.getElementById('swr-onboard');
  return el && !el.hidden && el.classList.contains('is-open');
}, { timeout: 3000 }).catch(() => null);
state = await page.evaluate(() => {
  const el = document.getElementById('swr-onboard');
  return { hidden: el ? el.hidden : null, isOpen: el ? el.classList.contains('is-open') : null };
});
console.log('▶ after ? click:', JSON.stringify(state));
if (!state.isOpen) {
  console.error('FAIL: ? button did not open the panel');
  await browser.close();
  process.exit(1);
}

// ---- 5. Press Escape → panel closes ----
await page.keyboard.press('Escape');
await new Promise(r => setTimeout(r, 400));
state = await page.evaluate(() => {
  const el = document.getElementById('swr-onboard');
  return { hidden: el ? el.hidden : null, isOpen: el ? el.classList.contains('is-open') : null };
});
console.log('▶ after Escape:', JSON.stringify(state));
if (!state.hidden || state.isOpen) {
  console.error('FAIL: Escape did not close the panel');
  await browser.close();
  process.exit(1);
}

// ---- 6. Background color picker: click a swatch → applies + persists ----
// Reset bg storage so we test from a known state
await page.evaluate(() => { localStorage.removeItem('swr.stage-bg.v1'); });
await page.reload({ waitUntil: 'networkidle0', timeout: 45000 });
await page.waitForFunction(() => {
  const el = document.getElementById('swr-onboard');
  return el && !el.hidden && el.classList.contains('is-open');
}, { timeout: 5000 }).catch(() => null);

// Click the "cream" swatch (3rd preset, index 2)
const creamClicked = await page.evaluate(() => {
  const sw = document.querySelector('.swr-bg__swatch[data-bg="#f5ead8"]');
  if (!sw) return false;
  sw.click();
  return true;
});
if (!creamClicked) { console.error('FAIL: cream swatch not found'); await browser.close(); process.exit(1); }
await new Promise(r => setTimeout(r, 200));
const bgState1 = await page.evaluate(() => {
  const swatches = Array.from(document.querySelectorAll('.swr-bg__swatch'));
  return {
    stageBg: getComputedStyle(document.getElementById('stage')).backgroundColor,
    stageInline: document.getElementById('stage').style.background,
    storage: localStorage.getItem('swr.stage-bg.v1'),
    activeIdx: swatches.findIndex(s => s.getAttribute('aria-checked') === 'true'),
    activeDataBg: (swatches.find(s => s.getAttribute('aria-checked') === 'true') || {}).getAttribute && swatches.find(s => s.getAttribute('aria-checked') === 'true').getAttribute('data-bg'),
  };
});
console.log('▶ after cream click:', JSON.stringify(bgState1));
if (bgState1.storage !== '#f5ead8') {
  console.error('FAIL: cream swatch did not persist to localStorage');
  await browser.close();
  process.exit(1);
}
if (bgState1.stageInline !== 'rgb(245, 234, 216)' && bgState1.stageInline !== '#f5ead8') {
  console.error('FAIL: cream swatch did not set #stage.style.background');
  await browser.close();
  process.exit(1);
}
if (bgState1.activeDataBg !== '#f5ead8') {
  console.error('FAIL: cream swatch is not aria-checked=true after click');
  await browser.close();
  process.exit(1);
}

// ---- 7. Reload → persisted bg restores before stage paints ----
await page.reload({ waitUntil: 'domcontentloaded', timeout: 60000 });
await new Promise(r => setTimeout(r, 2000));
const bgState2 = await page.evaluate(() => {
  // Diagnostic: what does the boot script see?
  return {
    stageInline: document.getElementById('stage').style.background,
    stageHasComputedBg: getComputedStyle(document.getElementById('stage')).backgroundColor,
    storage: localStorage.getItem('swr.stage-bg.v1'),
    stagePresent: !!document.getElementById('stage'),
    api: !!window.SWR_ONBOARD,
    // Try calling apply manually via SWR_ONBOARD.reset? no. Just re-apply.
    reapply: (function() {
      const c = localStorage.getItem('swr.stage-bg.v1');
      if (c) document.getElementById('stage').style.background = c;
      return document.getElementById('stage').style.background;
    })(),
  };
});
console.log('▶ after reload:', JSON.stringify(bgState2));
if (bgState2.stageInline !== 'rgb(245, 234, 216)' && bgState2.stageInline !== '#f5ead8') {
  console.error('FAIL: stage bg did not restore from localStorage on reload');
  await browser.close();
  process.exit(1);
}

if (pageErrors.length) {
  console.error('FAIL: page errors:', pageErrors.join('; '));
  await browser.close();
  process.exit(1);
}

console.log('\n✅ PASS — onboarding intro + shortcuts panel + bg color picker works end-to-end.');
console.log('   1. Auto-opens on first visit ✓');
console.log('   2. Got-it dismisses + persists when checkbox is checked ✓');
console.log('   3. Reload with persisted state does NOT re-show ✓');
console.log('   4. ? button re-opens the panel ✓');
console.log('   5. Escape closes the panel ✓');
console.log('   6. Swatch click applies color + persists to localStorage ✓');
console.log('   7. Persisted bg restores on reload ✓');
await browser.close();
