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
//  19. Layer presets: Save downloads the live rows; Load restores them via the picker
//  20. Base source: deck composites, advances, clears; grid dims under it
//  21. VJ mode: off by default, C toggles it, copy/typing shortcuts survive
//  22. Mobile: full-height stage, bottom-sheet rails (strips + one open at a time)
//  23. prefers-reduced-motion: one static frame, no flash
//  24. Mic/Cam: module present, clicks no-op without devices
//  25. Mic/Cam success path with Chromium's fake devices (analyser, VJ-gated video)
//  26. No console errors after the new interactions
//  27. Console grade: slider 50 is neutral; the extremes stop at the rules' ceilings
//  28. Console grade: Sharpness / Denoise / Vignette move real rendered pixels (gl)
//
// Set BASE_URL to run the same gate against a deployed origin
// (e.g. BASE_URL=https://sainted-word-records.vercel.app node scripts/check-dashboard.mjs).

import puppeteer from 'puppeteer';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

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

// document.body.focus() does not blur a focused control — the keyboard checks
// need a real blur, or the key lands in whatever field was last touched.
const blurActive = (target) => target.evaluate(() => {
  if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
});

// Canvas samplers injected into a page for the base-source / VJ / grid checks:
// mean brightness and peak channel over a region of the render canvas.
const injectSamplers = (target) => target.evaluate(() => {
  const grab = () => {
    const src = document.getElementById('render-canvas');
    const c = document.createElement('canvas');
    c.width = src.width; c.height = src.height;
    const ctx = c.getContext('2d');
    ctx.drawImage(src, 0, 0);
    return ctx;
  };
  window.__regionMean = (x, y, w, h) => {
    const d = grab().getImageData(x, y, w, h).data;
    let s = 0;
    for (let i = 0; i < d.length; i += 4) s += d[i] + d[i + 1] + d[i + 2];
    return Math.round(s / (d.length / 4) / 3);
  };
  window.__regionMax = (x, y, w, h) => {
    const d = grab().getImageData(x, y, w, h).data;
    let m = 0;
    for (let i = 0; i < d.length; i += 4) m = Math.max(m, d[i], d[i + 1], d[i + 2]);
    return m;
  };
});

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

  // 19. Layer presets — the file path: Save writes the live rows to disk and
  // Load restores them through the real file picker.
  const downloadDir = fs.mkdtempSync(path.join(os.tmpdir(), 'smr-set-'));
  const cdp = await browser.target().createCDPSession();
  await cdp.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: downloadDir, eventsEnabled: true });
  await page.evaluate(() => {
    const el = document.querySelector('#layers-list > details input[type=range]');
    el.value = 37;
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await page.click('#lib-save');
  let savedPath = null;
  for (let i = 0; i < 50 && !savedPath; i += 1) {
    await sleep(100);
    const hit = fs.readdirSync(downloadDir).find((n) => n.endsWith('.smr-set.json'));
    if (hit) savedPath = path.join(downloadDir, hit);
  }
  const savedJson = savedPath ? JSON.parse(fs.readFileSync(savedPath, 'utf8')) : null;
  check('Save downloads a .smr-set.json of the live rows',
    !!savedJson && savedJson.format === 'smr-set' && savedJson.layers.length === 5 && savedJson.layers[0].opacity === 37,
    savedPath ? `${path.basename(savedPath)} opacity=${savedJson.layers[0].opacity}` : 'no file');
  await page.evaluate(() => {
    const el = document.querySelector('#layers-list > details input[type=range]');
    el.value = 90;
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
  let loadedOpacity = null;
  if (savedPath) {
    const [chooser] = await Promise.all([page.waitForFileChooser(), page.click('#lib-load')]);
    await chooser.accept([savedPath]);
    await sleep(300);
    loadedOpacity = await page.evaluate(() => window.__SWR_LAYER_PRESETS.get().layers[0].opacity);
  }
  check('Load restores the saved rows from the picked file', loadedOpacity === 37, `opacity=${loadedOpacity}`);
  await cdp.detach();
  fs.rmSync(downloadDir, { recursive: true, force: true });

  // 20. Base source — the photo deck takes the slot, advances, clears, and
  // composites with VJ mode off (only the camera is gated, checked in 24).
  await injectSamplers(page);
  const baseSource = await page.evaluate(async () => {
    const e = window.__SWR_ENGINE;
    // Wait for a sampled region to SETTLE (two identical consecutive samples)
    // instead of assuming a fixed delay is enough. On a loaded CI runner the
    // composite can miss a flat 500ms, and the sample then reads the previous
    // frame — which is how "Grid dims under a composited base" produced
    // dim=164 (brighter than full=20) on run 37570453591 while passing 70/70
    // locally. This waits for the render to stop changing; it does not wait
    // for the assertion to pass, so the check keeps its teeth.
    const settle = async (fn, timeout = 5000, step = 120) => {
      let prev = fn();
      const t0 = Date.now();
      while (Date.now() - t0 < timeout) {
        await new Promise((r) => setTimeout(r, step));
        const now = fn();
        if (now === prev) return now;
        prev = now;
      }
      return prev;
    };
    const out = { api: typeof e.setPhotos === 'function' };
    out.vjAtStart = e.vjMode();
    out.bgMean = window.__regionMean(200, 440, 140, 120);
    e.setPhotos(['/icons/apple-touch-icon-180.png', '/favicon.svg']);
    out.kind = e.baseSourceKind();
    out.index0 = e.photoIndex();
    out.advanced = e._debug.advancePhoto();
    out.index1 = e.photoIndex();
    // A bright photo must reach the canvas without VJ mode; a black one then
    // lets the same pixels measure the grid dim (full vs dimmed).
    const svg = (fill) => 'data:image/svg+xml;utf8,' + encodeURIComponent(
      `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="600"><rect width="400" height="600" fill="${fill}"/></svg>`);
    e.setPhotos([svg('#ffffff')]);
    out.photoMean = await settle(() => window.__regionMean(200, 440, 140, 120));
    e.setPhotos([]);
    out.gridFull = await settle(() => window.__regionMax(100, 180, 340, 40));
    e.setPhotos([svg('#000000')]);
    out.gridDim = await settle(() => window.__regionMax(100, 180, 340, 40));
    e.setPhotos([]);
    out.kindAfter = e.baseSourceKind();
    return out;
  });
  check('Photo deck becomes the base source',
    baseSource.api && baseSource.kind === 'photo' && baseSource.index0 === 0, JSON.stringify({ api: baseSource.api, kind: baseSource.kind, index0: baseSource.index0 }));
  check('Advance moves to the next photo',
    baseSource.advanced === true && baseSource.index1 === 1, `index=${baseSource.index1}`);
  check('Empty deck clears the base source', baseSource.kindAfter === null);
  check('Photos composite with VJ mode off',
    baseSource.vjAtStart === false && baseSource.photoMean > baseSource.bgMean + 20,
    `bg=${baseSource.bgMean} photo=${baseSource.photoMean}`);
  check('Grid dims under a composited base',
    baseSource.gridFull >= 8 && baseSource.gridDim <= baseSource.gridFull * 0.5,
    `full=${baseSource.gridFull} dim=${baseSource.gridDim}`);

  // 21. VJ mode — OFF by default, C toggles it, and the platform's copy
  // shortcut plus typing in a field are left alone.
  const vjDefault = await page.evaluate(() => ({
    mode: window.__SWR_ENGINE.vjMode(),
    chip: document.getElementById('hud-vj').textContent.trim(),
    flag: document.getElementById('vj-btn').dataset.active || null,
  }));
  check('VJ mode is off by default',
    vjDefault.mode === false && vjDefault.chip === 'OFF' && vjDefault.flag === null, JSON.stringify(vjDefault));
  await blurActive(page);
  await page.keyboard.press('c');
  await sleep(200);
  const vjOn = await page.evaluate(() => ({
    mode: window.__SWR_ENGINE.vjMode(),
    chip: document.getElementById('hud-vj').textContent.trim(),
    flag: document.getElementById('vj-btn').dataset.active || null,
    tint: document.getElementById('vj-btn').style.color,
  }));
  check('C turns VJ mode on (readout + button follow)',
    vjOn.mode === true && vjOn.chip === 'ON' && vjOn.flag === '1' && vjOn.tint === 'var(--signal)',
    JSON.stringify(vjOn));
  await page.keyboard.down('Meta');
  await page.keyboard.press('c');
  await page.keyboard.up('Meta');
  await sleep(150);
  const afterMetaC = await page.evaluate(() => window.__SWR_ENGINE.vjMode());
  check('Cmd/Ctrl+C stays with the platform', afterMetaC === true, `vj=${afterMetaC}`);
  await page.evaluate(() => { const i = document.querySelector('#layers-list input:not([type])'); if (i) i.focus(); });
  await page.keyboard.press('c');
  await sleep(150);
  const afterTyping = await page.evaluate(() => ({
    vj: window.__SWR_ENGINE.vjMode(),
    target: document.activeElement ? document.activeElement.tagName : null,
  }));
  check('C while typing in a field does not toggle VJ mode',
    afterTyping.vj === true && afterTyping.target === 'INPUT', JSON.stringify(afterTyping));
  await blurActive(page);
  await page.keyboard.press('c');
  await sleep(200);
  const vjOff = await page.evaluate(() => ({
    mode: window.__SWR_ENGINE.vjMode(),
    chip: document.getElementById('hud-vj').textContent.trim(),
  }));
  check('C turns VJ mode back off', vjOff.mode === false && vjOff.chip === 'OFF', JSON.stringify(vjOff));

  // 22. Mobile — stage fills the viewport, sidebars are bottom sheets that
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

  // 23. prefers-reduced-motion — one static frame, no animation, no flash
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
  // State changes must repaint the single static frame — with no RAF loop, a
  // photo dropped into the deck would otherwise never appear.
  await injectSamplers(rmPage);
  const rmRepaint = await rmPage.evaluate(async () => {
    const svg = 'data:image/svg+xml;utf8,' + encodeURIComponent(
      '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="600"><rect width="400" height="600" fill="#ffffff"/></svg>');
    const before = window.__regionMean(200, 440, 140, 120);
    window.__SWR_ENGINE.setPhotos([svg]);
    await new Promise((r) => setTimeout(r, 500));
    const after = window.__regionMean(200, 440, 140, 120);
    window.__SWR_ENGINE.setPhotos([]);
    return { before, after };
  });
  check('Reduced motion: a base-source change still repaints the static frame',
    rmRepaint.after > rmRepaint.before + 20, JSON.stringify(rmRepaint));
  check('Reduced motion: no page errors', rmErrors.length === 0, rmErrors.join('|'));
  await rmPage.close();

  // 24. Mic / Cam — module wired; this browser has no devices, so clicks stay inert
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

  // 25. Mic / Cam success path — a second browser that grants Chromium's fake
  // devices (the primary one above runs with none, per check 24). The camera is
  // VJ-gated, so the canvas must stay black until C composites the feed.
  const devBrowser = await puppeteer.launch({
    headless: 'new',
    args: [
      '--no-sandbox',
      '--use-fake-device-for-media-stream',
      '--use-fake-ui-for-media-stream',
      '--autoplay-policy=no-user-gesture-required',
    ],
  });
  const devPage = await devBrowser.newPage();
  const devErrors = [];
  devPage.on('pageerror', (e) => devErrors.push('pageerror: ' + e.message));
  await devPage.setViewport({ width: 1280, height: 900 });
  await devPage.goto(`${BASE}/dashboard.html`, { waitUntil: 'domcontentloaded' });
  await sleep(800);
  await injectSamplers(devPage);
  const bgMean = await devPage.evaluate(() => window.__regionMean(200, 440, 140, 120));
  await devPage.click('#mic-btn');
  await sleep(1200);
  const micLive = await devPage.evaluate(() => ({
    active: window.__SWR_ENGINE.micActive(),
    flag: document.getElementById('mic-btn').dataset.active,
    tint: document.getElementById('mic-btn').style.color,
    level: Number(window.__SWR_ENGINE.features().level.toFixed(3)),
  }));
  check('Mic with a device: the stream becomes the engine analysis source',
    micLive.active === true && micLive.flag === '1' && micLive.tint === 'var(--signal)',
    JSON.stringify(micLive));
  // Chromium's fake mic is only a tone where the host can open a capture
  // backend (a Linux CI container delivers silence), so the level itself is
  // asserted where it exists and reported as an env skip where it cannot be.
  const micLevel = await devPage
    .waitForFunction(() => window.__SWR_ENGINE.features().level > 0.02, { timeout: 5000 })
    .then(() => true).catch(() => false);
  if (micLevel) {
    check('Mic with a device: the live analyser drives features()', true, `level=${micLive.level}`);
  } else {
    console.log('  (env skip: no audio capture backend — fake mic delivered silence)');
  }
  await devPage.click('#cam-btn');
  await sleep(1500);
  const camGated = await devPage.evaluate(() => ({
    kind: window.__SWR_ENGINE.baseSourceKind(),
    flag: document.getElementById('cam-btn').dataset.active,
    videos: document.querySelectorAll('body > video').length,
    vj: window.__SWR_ENGINE.vjMode(),
    chip: document.getElementById('hud-vj').textContent.trim(),
    mean: window.__regionMean(200, 440, 140, 120),
  }));
  check('Cam with a device: feed armed but off the canvas while VJ mode is off',
    camGated.kind === 'video' && camGated.flag === '1' && camGated.videos === 1 &&
    camGated.vj === false && camGated.mean <= bgMean + 8,
    `bgMean=${bgMean} ${JSON.stringify(camGated)}`);
  await blurActive(devPage);
  await devPage.keyboard.press('c');
  await sleep(600);
  const camLive = await devPage.evaluate(() => ({
    kind: window.__SWR_ENGINE.baseSourceKind(),
    vj: window.__SWR_ENGINE.vjMode(),
    chip: document.getElementById('hud-vj').textContent.trim(),
    flag: document.getElementById('cam-btn').dataset.active,
    title: document.getElementById('cam-btn').title,
    mean: window.__regionMean(200, 440, 140, 120),
  }));
  check('C (VJ mode) composites the camera frame onto the canvas',
    camLive.vj === true && camLive.chip === 'ON' && camLive.flag === '1' && camLive.mean > bgMean + 20,
    `bgMean=${bgMean} ${JSON.stringify(camLive)}`);
  await devPage.keyboard.press('c');
  await sleep(600);
  const camReGated = await devPage.evaluate(() => ({
    vj: window.__SWR_ENGINE.vjMode(),
    videos: document.querySelectorAll('body > video').length,
    mean: window.__regionMean(200, 440, 140, 120),
  }));
  check('Leaving VJ mode returns the canvas to pure black (stream still armed)',
    camReGated.vj === false && camReGated.videos === 1 && camReGated.mean <= bgMean + 8,
    `bgMean=${bgMean} ${JSON.stringify(camReGated)}`);
  await devPage.click('#cam-btn');
  await devPage.click('#mic-btn');
  await sleep(500);
  const devOff = await devPage.evaluate(() => ({
    mic: window.__SWR_ENGINE.micActive(),
    kind: window.__SWR_ENGINE.baseSourceKind(),
    videos: document.querySelectorAll('body > video').length,
    mean: window.__regionMean(200, 440, 140, 120),
  }));
  check('Mic/Cam toggle back off cleanly',
    devOff.mic === false && devOff.kind === null && devOff.videos === 0 && devOff.mean <= bgMean + 8,
    `bgMean=${bgMean} ${JSON.stringify(devOff)}`);
  check('Fake-device run has no page errors', devErrors.length === 0, devErrors.join('|'));
  await devBrowser.close();

  // 26. No console errors after the new interactions (same filter as check 12)
  check('No console errors after new interactions',
    errors.length === 0, errors.length ? errors.slice(0, 3).join('|') : '');

  // 27. Console grade path — the Enhance sliders resolve through GRADE_RANGES:
  // 50 is neutral for the CSS chain, and the extremes hit the house rules'
  // ceilings (docs/grade-house-rules.md: ±8% saturation, +15 clarity). Check 22
  // left the page reloaded at the mobile viewport, so this block boots its own
  // desktop page and re-injects the canvas samplers.
  const near = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps;
  await page.setViewport({ width: 1280, height: 900 });
  await page.goto(`${BASE}/dashboard.html`, { waitUntil: 'domcontentloaded' });
  await sleep(800);
  const gradeBoot = await page.evaluate(() => ({
    grades: window.__SWR_ENGINE.grades(),
    filter: document.getElementById('render-canvas').style.filter,
  }));
  const bootNums = (gradeBoot.filter.match(/[\d.]+/g) || []).map(Number);
  check('Enhance: slider 50 is the neutral grade at boot',
    gradeBoot.grades.brightness === 1 && gradeBoot.grades.contrast === 1 &&
    gradeBoot.grades.saturation === 1 && gradeBoot.grades.sharp === 0 &&
    gradeBoot.grades.denoise === 0 && gradeBoot.grades.vignette === 0 &&
    bootNums.length === 3 && bootNums.every((n) => near(n, 1)),
    `filter=${gradeBoot.filter} grades=${JSON.stringify(gradeBoot.grades)}`);

  const gradeExtremes = await page.evaluate(() => {
    const ids = ['enh-sharp', 'enh-denoise', 'enh-bright', 'enh-contrast', 'enh-sat', 'enh-vignette'];
    const set = (v) => ids.forEach((id) => {
      const el = document.getElementById(id);
      el.value = String(v);
      el.dispatchEvent(new Event('input', { bubbles: true }));
    });
    const out = {};
    set(0);   out.low = window.__SWR_ENGINE.grades();
    set(100); out.high = window.__SWR_ENGINE.grades();
    out.filterHigh = document.getElementById('render-canvas').style.filter;
    set(50);
    return out;
  });
  check('Enhance: slider 0 is the floor of every mapped range',
    near(gradeExtremes.low.brightness, 0.80) && near(gradeExtremes.low.contrast, 0.80) &&
    near(gradeExtremes.low.saturation, 0.92) && near(gradeExtremes.low.sharp, 0) &&
    near(gradeExtremes.low.denoise, 0) && near(gradeExtremes.low.vignette, 0),
    JSON.stringify(gradeExtremes.low));
  check('Enhance: slider 100 stops at the rules\' ceilings (1.20 tone, 1.08 sat, 0.15 clarity)',
    near(gradeExtremes.high.brightness, 1.20) && near(gradeExtremes.high.contrast, 1.20) &&
    near(gradeExtremes.high.saturation, 1.08) && near(gradeExtremes.high.sharp, 0.15) &&
    near(gradeExtremes.high.denoise, 1) && near(gradeExtremes.high.vignette, 1),
    `${JSON.stringify(gradeExtremes.high)} filter=${gradeExtremes.filterHigh}`);

  // 28. The three footage taps move real rendered pixels. Only the GL path has
  // shader taps (the 2D fallback ignores sharp/denoise/vignette), so the pixel
  // half is asserted where a shader exists and reported as an env skip where
  // it cannot be.
  await page.waitForFunction(() => window.__SWR_ENGINE && window.__SWR_ENGINE.mode === 'gl', { timeout: 5000 })
    .catch(() => {});
  const gradeMode = await page.evaluate(() => window.__SWR_ENGINE.mode);
  if (gradeMode === 'gl') {
    await injectSamplers(page);
    const px = await page.evaluate(async () => {
      const wait = (ms) => new Promise((r) => setTimeout(r, ms));
      const set = (id, v) => {
        const el = document.getElementById(id);
        el.value = String(v);
        el.dispatchEvent(new Event('input', { bubbles: true }));
      };
      const svg = (inner) => 'data:image/svg+xml;utf8,' + encodeURIComponent(
        `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="600">${inner}</svg>`);
      // 2px vertical stripes — every texel sees the opposite colour as its
      // horizontal neighbour, so the 4-neighbour box halves the stripe contrast
      // (Denoise) and the unsharp term lifts the peaks (Sharpness). Placed at
      // y 200–240, well away from the waveform band (y≈337) and spectrum bars
      // (y>574).
      const stripes = Array.from({ length: 200 }, (_, i) =>
        `<rect x="${i * 2}" y="0" width="2" height="600" fill="${i % 2 ? '#000000' : '#c8c8c8'}"/>`).join('');
      const band = () => ({
        mean: window.__regionMean(200, 200, 120, 40),
        max: window.__regionMax(200, 200, 120, 40),
      });
      const out = {};
      set('enh-sharp', 0); set('enh-denoise', 0); set('enh-vignette', 0);
      window.__SWR_ENGINE.setPhotos([svg(stripes)]);
      await wait(400);
      out.flat = band();
      set('enh-sharp', 100);
      await wait(400);
      out.sharp = band();
      set('enh-sharp', 0); set('enh-denoise', 100);
      await wait(400);
      out.denoise = band();
      set('enh-denoise', 0);
      // Vignette needs non-black content, so it is measured on a flat white
      // photo: the corner patch vs the centre patch.
      window.__SWR_ENGINE.setPhotos([svg('<rect width="400" height="600" fill="#ffffff"/>')]);
      await wait(400);
      out.vig0 = { corner: window.__regionMean(10, 10, 60, 60), centre: window.__regionMean(240, 300, 60, 60) };
      set('enh-vignette', 100);
      await wait(400);
      out.vig100 = { corner: window.__regionMean(10, 10, 60, 60), centre: window.__regionMean(240, 300, 60, 60) };
      // Back to the shipped defaults for anything that runs after this block.
      set('enh-sharp', 0); set('enh-denoise', 0); set('enh-bright', 50);
      set('enh-contrast', 50); set('enh-sat', 50); set('enh-vignette', 0);
      window.__SWR_ENGINE.setPhotos([]);
      return out;
    });
    check('Sharpness is real: the base edge gains contrast',
      px.sharp.max > px.flat.max,
      `max flat=${px.flat.max} sharp=${px.sharp.max} (mean ${px.flat.mean} → ${px.sharp.mean})`);
    check('Denoise is real: the stripe high frequency flattens',
      (px.denoise.max - px.denoise.mean) < (px.flat.max - px.flat.mean) - 1,
      `max−mean flat=${px.flat.max - px.flat.mean} denoise=${px.denoise.max - px.denoise.mean}`);
    check('Vignette is real: the corner falls, the centre holds',
      px.vig100.corner < px.vig0.corner - 10 && Math.abs(px.vig100.centre - px.vig0.centre) <= 8,
      `corner ${px.vig0.corner} → ${px.vig100.corner}, centre ${px.vig0.centre} → ${px.vig100.centre}`);
  } else {
    console.log('  (env skip: no WebGL — 2D fallback has no shader taps)');
  }

} finally {
  await browser.close();
  if (server) server.close();
}

console.log(`\n${pass}/${pass+fail} dashboard checks passed`);
process.exit(fail === 0 ? 0 : 1);
