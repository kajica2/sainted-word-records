#!/usr/bin/env node
// scripts/check-dashboard.mjs — verify the Sainted Word Records — Engine dashboard
// boots correctly + interactions work in headless Chromium.
//
// Checks:
//   1. Page loads with all 4 primary tabs (Engine, Enhance, Photo, Transitions)
//   2. Library grid renders 8 cards
//   3. Layers accordion: 5 rows, only first expanded
//   4. Canvas preview label visible
//   5. Drawer starts collapsed; clicking toggle expands it
//   6. Left sidebar collapses on click; width goes from 240 to 48
//   7. Right sidebar collapses on click; width goes from 300 to 48
//   8. Keyboard "[": left sidebar collapses
//   9. Keyboard "]": right sidebar collapses
//  10. Keyboard "a": drawer expands
//  11. Tabs: clicking Enhance shows "Coming soon" placeholder
//  12. No console errors during boot or interactions
//  13. Engine canvas + audio wired
//  14. Drop zone visible on load
//  15. Console empty state (#empty-hero) on a fresh load
//  16. BPM/KEY readouts bound (canvas HUD + header) and live after a sample
//  17. Beat flash: paints the overlay, decays within 200ms
//  18. Layer presets: read → mutate → Clear restores the shipped default
//  19. Base source: photo deck takes the slot, advances, clears
//  20. Mobile: full-height stage, bottom-sheet rails (strips + one open at a time)
//  21. prefers-reduced-motion: one static frame, no flash
//  22. Mic/Cam: module present, clicks no-op without devices
//  23. No console errors after the new interactions
//
// Set BASE_URL to run the same gate against a deployed origin
// (e.g. BASE_URL=https://sainted-word-records.vercel.app node scripts/check-dashboard.mjs).

import puppeteer from 'puppeteer';
import http from 'node:http';
import fs from 'node:fs';

const PORT = 53939;
const BASE = process.env.BASE_URL || `http://127.0.0.1:${PORT}`;

// Static server for dashboard.html + needed assets — local runs only.
const ROOT = process.cwd();
const server = process.env.BASE_URL ? null : http.createServer((req, res) => {
  const url = req.url.split('?')[0];
  let path = url === '/' ? '/dashboard.html' : url;
  const fullPath = ROOT + path;
  if (!fs.existsSync(fullPath)) {
    res.statusCode = 404;
    res.end('not found');
    return;
  }
  const ct = fullPath.endsWith('.html') ? 'text/html'
           : fullPath.endsWith('.css')  ? 'text/css'
           : fullPath.endsWith('.js')   ? 'application/javascript'
           : 'application/octet-stream';
  res.setHeader('Content-Type', ct);
  res.end(fs.readFileSync(fullPath));
});
if (server) await new Promise((r) => server.listen(PORT, r));

let pass = 0, fail = 0;
function check(name, ok, detail) {
  const m = `${ok ? '✓' : '✗'} ${name}${detail ? ' (' + detail + ')' : ''}`;
  console.log(m);
  if (ok) pass += 1; else fail += 1;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({
  headless: 'new',
  args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'],
});
const page = await browser.newPage();
const errors = [];
page.on('console', (msg) => {
  if (msg.type() === 'error') errors.push(msg.text());
});
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));

try {
  // Desktop viewport for checks 1–19 (the mobile layout takes over ≤860px).
  await page.setViewport({ width: 1280, height: 900 });
  await page.goto(`${BASE}/dashboard.html`, { waitUntil: 'domcontentloaded' });
  await new Promise((r) => setTimeout(r, 800));

  // 1. Tabs: Console nav = version selector (6 links) + 3 transport toggles
  const versions = await page.$$eval('.versions a[data-v]', (els) => els.map(e => e.dataset.v));
  const toggles = await page.$$eval('[data-toggle-tab]', (els) => els.map(e => e.dataset.toggleTab));
  check('version selector has 6 versions', versions.length === 6 && versions.includes('console'), versions.join(','));
  check('console is aria-current', (await page.$$eval('.versions a[aria-current="page"]', (els) => els.length)) === 1);
  check('3 transport panel toggles', toggles.length === 3 && toggles.includes('enhance'), toggles.join(','));

  // 2. Library grid (rendered by JS)
  const libCount = await page.$$eval('#library-grid > div', (els) => els.length);
  check('Library has 8 cards', libCount === 8, `count=${libCount}`);

  // 3. Layers accordion
  const layerRows = await page.$$eval('#layers-list > details', (els) => els.length);
  const openCount = await page.$$eval('#layers-list > details[open]', (els) => els.length);
  check('5 layer rows', layerRows === 5, `count=${layerRows}`);
  check('only 1 layer expanded (accordion)', openCount === 1, `open=${openCount}`);

  // 4. Preview label
  const preview = await page.$eval('#canvas', (el) => el.textContent.includes('Preview'));
  check('Canvas preview label visible', preview);

  // 5. Drawer initial state + toggle
  const drawerCollapsedBefore = await page.$eval('#advanced-drawer', (el) => el.classList.contains('collapsed'));
  check('Drawer starts collapsed', drawerCollapsedBefore);
  await page.click('#drawer-toggle');
  await new Promise((r) => setTimeout(r, 400));
  const drawerCollapsedAfter = await page.$eval('#advanced-drawer', (el) => el.classList.contains('collapsed'));
  check('Drawer expands on click', !drawerCollapsedAfter);

  // 6. Left sidebar collapse
  const lWidthBefore = await page.$eval('#sidebar-l', (el) => parseInt(el.style.width));
  await page.click('#toggle-l');
  await new Promise((r) => setTimeout(r, 400));
  const lWidthAfter = await page.$eval('#sidebar-l', (el) => parseInt(el.style.width));
  check('Left sidebar collapses', lWidthAfter < lWidthBefore, `${lWidthBefore} -> ${lWidthAfter}`);

  // Reset left
  await page.click('#toggle-l');
  await new Promise((r) => setTimeout(r, 400));

  // 7. Right sidebar collapse
  const rWidthBefore = await page.$eval('#sidebar-r', (el) => parseInt(el.style.width));
  await page.click('#toggle-r');
  await new Promise((r) => setTimeout(r, 400));
  const rWidthAfter = await page.$eval('#sidebar-r', (el) => parseInt(el.style.width));
  check('Right sidebar collapses', rWidthAfter < rWidthBefore, `${rWidthBefore} -> ${rWidthAfter}`);

  // Reset right
  await page.evaluate(() => document.getElementById('toggle-r').click());
  await new Promise((r) => setTimeout(r, 400));

  // Reset drawer
  await page.evaluate(() => document.getElementById('drawer-toggle').click());
  await new Promise((r) => setTimeout(r, 400));

  // 8-10. Keyboard shortcuts (focus the document; we don't need to click anywhere)
  await page.evaluate(() => document.body.focus());
  await page.keyboard.press('[');
  await new Promise((r) => setTimeout(r, 400));
  const lKbd = await page.$eval('#sidebar-l', (el) => parseInt(el.style.width));
  check('Keyboard "[" collapses left', lKbd < 240, `width=${lKbd}`);

  await page.evaluate(() => document.body.focus());
  await page.keyboard.press(']');
  await new Promise((r) => setTimeout(r, 400));
  const rKbd = await page.$eval('#sidebar-r', (el) => parseInt(el.style.width));
  check('Keyboard "]" collapses right', rKbd < 300, `width=${rKbd}`);

  await page.evaluate(() => document.body.focus());
  await page.keyboard.press('a');
  await new Promise((r) => setTimeout(r, 400));
  const drawerKbd = await page.$eval('#advanced-drawer', (el) => el.classList.contains('collapsed'));
  check('Keyboard "a" expands drawer', !drawerKbd);

  // 11. Tabs switch (Engine -> Enhance shows the filter panel, hides canvas)
  await page.click('[data-toggle-tab="enhance"]');
  await new Promise((r) => setTimeout(r, 200));
  const enhVisible = await page.$eval('#tab-enhance', (el) => !el.classList.contains('hidden'));
  const canvasHidden = await page.$eval('#render-canvas', (el) => el.style.display === 'none');
  check('Tab switch shows Enhance panel', enhVisible && canvasHidden);

  // 12. No console errors
  check('No console errors', errors.length === 0, errors.length ? errors.slice(0,3).join('|') : '');

  // 13. Engine: canvas + audio element wired
  await page.evaluate(() => document.body.focus());
  await new Promise((r) => setTimeout(r, 300));
  const engineReady = await page.evaluate(() => !!window.__SWR_ENGINE);
  check('Engine global installed', engineReady);
  const canvasOK = await page.evaluate(() => {
    const c = document.getElementById('render-canvas');
    return c && c.width === 540 && c.height === 675;
  });
  check('Render canvas 540x675', canvasOK);
  const audioOK = await page.evaluate(() => !!window.__SWR_ENGINE && !!window.__SWR_ENGINE.audio);
  check('Engine has audio element', audioOK);
  const featuresOK = await page.evaluate(() => {
    const e = window.__SWR_ENGINE;
    if (!e) return false;
    const f = e.features();
    return f && typeof f.bass === 'number';
  });
  check('Engine features accessible', featuresOK);

  // 14. Drop zone visible
  const dropZoneOK = await page.$eval('#drop-zone', (el) => !el.classList.contains('hidden'));
  check('Drop zone visible on load', dropZoneOK);

  // 15. Console HUD — canvas HUD + header metrics must both be bound by id
  const hudTargets = await page.evaluate(() => window.__SWR_ENGINE.hudTargets());
  check('HUD + header readouts bound',
    hudTargets.bpm && hudTargets.key && hudTargets.headerBpm && hudTargets.headerKey,
    JSON.stringify(hudTargets));

  // 16. Empty state + live HUD — fresh load, still nothing loaded
  await page.goto(`${BASE}/dashboard.html`, { waitUntil: 'domcontentloaded' });
  await sleep(600);
  const emptyState = await page.evaluate(() => {
    const hero = document.getElementById('empty-hero');
    const dz = document.getElementById('drop-zone');
    return !!hero && getComputedStyle(hero).display !== 'none' &&
      !!dz && getComputedStyle(dz).display !== 'none' && !dz.classList.contains('hidden');
  });
  check('Empty state shows the Console hero + drop zone', emptyState);

  await page.click('#try-sample');
  const sampleLoaded = await page
    .waitForFunction(() => document.getElementById('drop-zone').classList.contains('hidden'), { timeout: 15000 })
    .then(() => true).catch(() => false);
  check('Sample audio loads into the engine', sampleLoaded);
  await page.click('#play-btn');
  await sleep(3000);
  const readouts = await page.evaluate(() => ({
    hudKey: document.getElementById('hud-key').textContent,
    hdrKey: document.getElementById('hdr-key').textContent,
    hudBpm: document.getElementById('hud-bpm').textContent,
    hdrBpm: document.getElementById('hdr-bpm').textContent,
  }));
  check('KEY readout is a pitch class', /^([A-G][#b]?|—)$/.test(readouts.hudKey), readouts.hudKey);
  check('Canvas HUD and header agree',
    readouts.hudKey === readouts.hdrKey && readouts.hudBpm === readouts.hdrBpm,
    `key ${readouts.hudKey}/${readouts.hdrKey} · bpm ${readouts.hudBpm}/${readouts.hdrBpm}`);

  // 17. Beat flash — one hard full-frame flash, painted on the overlay canvas.
  // The auto-beat gate is disabled first so only the injected pulse is measured.
  await page.evaluate(() => window.__SWR_ENGINE.setBeatGate(1.5));
  const flashPaint = await page.evaluate(() => new Promise((resolve) => {
    const overlay = Array.from(document.querySelectorAll('#canvas canvas'))
      .find((c) => c.id !== 'render-canvas');
    if (!overlay) return resolve(-1);
    const octx = overlay.getContext('2d');
    let ticks = 0;
    const sample = () => {
      window.__SWR_ENGINE._debug.pulseBeat();   // hold the flash at 1 while we read
      const alpha = octx.getImageData(4, 4, 1, 1).data[3];
      if (alpha > 0 || ++ticks >= 8) return resolve(alpha);
      requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  }));
  check('Beat flash paints the overlay canvas', flashPaint > 0, `alpha=${flashPaint}`);
  await sleep(400);
  const flashAfter = await page.evaluate(() => window.__SWR_ENGINE.flashLevel());
  check('Beat flash decays back to 0', flashAfter === 0, `level=${flashAfter}`);

  // 18. Layer presets — Save/Load/Clear round-trip the live accordion
  const presetCount = await page.evaluate(() => window.__SWR_LAYER_PRESETS.get().layers.length);
  check('Layer presets expose 5 rows', presetCount === 5, `rows=${presetCount}`);
  const presetMutated = await page.evaluate(() => {
    const el = document.querySelector('#layers-list > details input[type=range]');
    el.value = 42;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    return window.__SWR_LAYER_PRESETS.get().layers[0].opacity;
  });
  check('Preset read reflects a slider change', presetMutated === 42, `opacity=${presetMutated}`);
  await page.click('#lib-clear');
  await sleep(150);
  const presetCleared = await page.evaluate(() => window.__SWR_LAYER_PRESETS.get().layers[0]);
  check('Clear restores the shipped default',
    presetCleared.opacity === 100 && presetCleared.base === 50 && presetCleared.scale === 100,
    JSON.stringify(presetCleared));

  // 19. Base source — the photo deck takes the slot, advances, clears
  const baseSource = await page.evaluate(() => {
    const e = window.__SWR_ENGINE;
    const out = { api: typeof e.setPhotos === 'function' };
    e.setPhotos(['/icons/apple-touch-icon-180.png', '/favicon.svg']);
    out.kind = e.baseSourceKind();
    out.index0 = e.photoIndex();
    out.advanced = e._debug.advancePhoto();
    out.index1 = e.photoIndex();
    e.setPhotos([]);
    out.kindAfter = e.baseSourceKind();
    return out;
  });
  check('Photo deck becomes the base source',
    baseSource.api && baseSource.kind === 'photo' && baseSource.index0 === 0, JSON.stringify(baseSource));
  check('Advance moves to the next photo',
    baseSource.advanced === true && baseSource.index1 === 1, `index=${baseSource.index1}`);
  check('Empty deck clears the base source', baseSource.kindAfter === null);

  // 20. Mobile — stage fills the viewport, sidebars are bottom sheets that
  // boot as 32px strips (both toggles must stay hittable) and open one at a time.
  await page.setViewport({ width: 390, height: 844 });
  await page.goto(`${BASE}/dashboard.html`, { waitUntil: 'domcontentloaded' });
  await sleep(800);
  const mobile = await page.evaluate(() => {
    const vw = window.innerWidth;
    const isSheet = (id) => {
      const s = getComputedStyle(document.getElementById(id));
      // full-width, fixed to the bottom edge (the collapsed layers strip
      // parks 32px up so the two strips don't overlap)
      return s.position === 'fixed' && s.left === '0px' && s.right === '0px' &&
        parseFloat(s.bottom) <= 32 && Math.round(parseFloat(s.width)) === vw;
    };
    const hittable = (id) => {
      const t = document.getElementById(id);
      const rect = t.getBoundingClientRect();
      const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
      return !!hit && (hit === t || t.contains(hit));
    };
    return {
      left: isSheet('sidebar-l'),
      right: isSheet('sidebar-r'),
      stage: document.getElementById('canvas-wrap').clientHeight,
      strips: document.getElementById('sidebar-l').dataset.collapsed === '1' &&
              document.getElementById('sidebar-r').dataset.collapsed === '1',
      hittableL: hittable('toggle-l'),
      hittableR: hittable('toggle-r'),
    };
  });
  check('Mobile: both sidebars are bottom sheets', mobile.left && mobile.right, JSON.stringify(mobile));
  check('Mobile: stage takes the viewport', mobile.stage >= 700, `height=${mobile.stage}`);
  check('Mobile: both rails boot as collapsed strips', mobile.strips);
  check('Mobile: both sheet toggles stay reachable', mobile.hittableL && mobile.hittableR,
    `left=${mobile.hittableL} right=${mobile.hittableR}`);
  await page.click('#toggle-l');
  await sleep(300);
  const mobileOpen = await page.evaluate(() => ({
    left: document.getElementById('sidebar-l').dataset.collapsed,
    right: document.getElementById('sidebar-r').dataset.collapsed,
    height: parseFloat(getComputedStyle(document.getElementById('sidebar-l')).height),
  }));
  check('Mobile: tapping the strip opens that sheet',
    mobileOpen.left === '0' && mobileOpen.height > 100, JSON.stringify(mobileOpen));
  await page.click('#toggle-r');
  await sleep(300);
  const mobileSwap = await page.evaluate(() => ({
    left: document.getElementById('sidebar-l').dataset.collapsed,
    right: document.getElementById('sidebar-r').dataset.collapsed,
  }));
  check('Mobile: only one sheet is open at a time',
    mobileSwap.right === '0' && mobileSwap.left === '1', JSON.stringify(mobileSwap));

  // 21. prefers-reduced-motion — one static frame, no animation, no flash
  const rmPage = await browser.newPage();
  const rmErrors = [];
  rmPage.on('pageerror', (e) => rmErrors.push('pageerror: ' + e.message));
  await rmPage.setViewport({ width: 1280, height: 900 });
  await rmPage.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
  await rmPage.goto(`${BASE}/dashboard.html`, { waitUntil: 'domcontentloaded' });
  await sleep(800);
  const reduced = await rmPage.evaluate(() => {
    const c = document.getElementById('render-canvas');
    return { flag: window.__SWR_ENGINE.reducedMotion(), canvas: c.width + 'x' + c.height };
  });
  check('Reduced motion is detected', reduced.flag === true);
  check('Reduced motion still sizes the render canvas', reduced.canvas === '540x675', reduced.canvas);
  const rmFlash = await rmPage.evaluate(async () => {
    const e = window.__SWR_ENGINE;
    e._debug.pulseBeat();
    await new Promise((r) => setTimeout(r, 400));
    const overlay = Array.from(document.querySelectorAll('#canvas canvas'))
      .find((c) => c.id !== 'render-canvas');
    return { level: e.flashLevel(), alpha: overlay ? overlay.getContext('2d').getImageData(4, 4, 1, 1).data[3] : 255 };
  });
  check('Reduced motion: the flash never paints', rmFlash.level === 0 && rmFlash.alpha === 0, JSON.stringify(rmFlash));
  check('Reduced motion: no page errors', rmErrors.length === 0, rmErrors.join('|'));
  await rmPage.close();

  // 22. Mic / Cam — module wired; headless has no devices, so clicks stay inert
  await page.setViewport({ width: 1280, height: 900 });
  await page.goto(`${BASE}/dashboard.html`, { waitUntil: 'domcontentloaded' });
  await sleep(800);
  const mediaInputReady = await page.evaluate(() =>
    !!(window.SWR_MEDIA_INPUT && typeof window.SWR_MEDIA_INPUT.create === 'function' && window.SWR_MEDIA_INPUT.create()));
  check('Media input module present', mediaInputReady);
  await page.click('#mic-btn');
  await page.click('#cam-btn');
  await sleep(600);
  const mediaState = await page.evaluate(() => ({
    mic: document.getElementById('mic-btn').dataset.active || null,
    cam: document.getElementById('cam-btn').dataset.active || null,
    micTitle: document.getElementById('mic-btn').title,
    camTitle: document.getElementById('cam-btn').title,
  }));
  check('Mic/Cam clicks stay inert without devices',
    mediaState.mic === null && mediaState.cam === null,
    `mic=${mediaState.mic}·${mediaState.micTitle} cam=${mediaState.cam}·${mediaState.camTitle}`);

  // 23. No console errors after the new interactions (same filter as check 12)
  check('No console errors after new interactions',
    errors.length === 0, errors.length ? errors.slice(0, 3).join('|') : '');

} finally {
  await browser.close();
  if (server) server.close();
}

console.log(`\n${pass}/${pass+fail} dashboard checks passed`);
process.exit(fail === 0 ? 0 : 1);
