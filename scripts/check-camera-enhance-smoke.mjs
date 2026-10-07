// scripts/check-camera-enhance-smoke.mjs
//
// Puppeteer smoke against the built dist/ — verifies the Camera Enhance page
// (/camera-enhance) boots cleanly: the four panels, the stage + transport, the
// 8 look cards, the overlay modes, the custom sliders, the export controls and
// the SWR_CAMERA_ENHANCE + SWR_CAMERA_ENHANCE_EXPORT globals.
//
//   1. Page boots without fatal console errors (same FATAL_FILTER as the
//      sibling smokes).
//   2. <swr-nav> mounted; the hero renders.
//   3. Source panel: dropzone, file input (video/*), thumbnail canvas.
//   4. Stage: preview canvas + hidden source video + transport controls.
//   5. Look panel: exactly 8 look cards; picking one moves .active.
//   6. Overlay: 4 modes; picking one moves .active; the intensity slider
//      updates its readout.
//   7. Custom sliders: hidden until the custom look, then 9 of them.
//   8. Export: 5 formats, 2 qualities, 5 burn-ins, button disabled until a
//      clip loads.
//   9. Globals expose the documented factories.
//
// Run:  node scripts/check-camera-enhance-smoke.mjs
// Exit: 0 = PASSED, 1 = any failure.

import { fileURLToPath } from 'node:url';
import { dirname, extname, join, resolve } from 'node:path';
import http from 'node:http';
import fs from 'node:fs';
import puppeteer from 'puppeteer';
import { ensureDist } from './with-dist.mjs';

ensureDist();

// Static server for the built dist/. Port 5186 is distinct from the sibling
// smokes (capture 5182, automix 5181, media-input 5183, spit-live 5184,
// tiktok 5185) so they can run side by side.
const distDir = resolve(dirname(fileURLToPath(import.meta.url)), '../dist');
const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp',
  '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.mp4': 'video/mp4',
  '.webmanifest': 'application/manifest+json', '.woff2': 'font/woff2',
};
const server = http.createServer((req, res) => {
  let p = req.url.split('?')[0];
  if (p.endsWith('/')) p += 'index.html';
  const file = join(distDir, p);
  if (!file.startsWith(distDir)) { res.statusCode = 403; res.end(); return; }
  fs.readFile(file, (err, buf) => {
    if (err) { res.statusCode = 404; res.end('not found'); return; }
    res.setHeader('content-type', MIME[extname(file)] || 'application/octet-stream');
    res.end(buf);
  });
});

const FATAL_FILTER = (line) => !/ws:\/\/localhost:8787/.test(String(line));

let failures = 0;
function check(name, ok, detail) {
  console.log(`${ok ? '✓' : '✗'} ${name}${detail ? `  ${detail}` : ''}`);
  if (!ok) failures += 1;
}

const PORT = 5186;
await new Promise((r) => server.listen(PORT, '127.0.0.1', r));

let browser;
try {
  browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--autoplay-policy=no-user-gesture-required'],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 1000 });

  const consoleErrors = [];
  page.on('console', (m) => { if (m.type() === 'error' && FATAL_FILTER(m.text())) consoleErrors.push(m.text()); });
  page.on('pageerror', (e) => consoleErrors.push('pageerror: ' + e.message));

  // See check-tiktok-smoke.mjs: domcontentloaded + an explicit wait for the
  // stage, not networkidle0.
  const resp = await page.goto(`http://127.0.0.1:${PORT}/camera-enhance.html`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForSelector('#ceStage', { timeout: 10000 }).catch(() => {});
  check('page loads', resp.status() === 200, `(${resp.status()})`);
  await new Promise((r) => setTimeout(r, 1200));

  check('title names the page', (await page.title()) === 'Camera Enhance · SWR', await page.title());
  check('<swr-nav> mounted', await page.evaluate(() => !!document.querySelector('swr-nav')));
  check('hero h1 renders', await page.evaluate(() => !!document.querySelector('.ce-head h1')));

  const source = await page.evaluate(() => ({
    drop: !!document.getElementById('ceDrop'),
    accept: (document.getElementById('ceFile') || {}).accept || '',
    thumb: !!document.getElementById('ceThumb'),
  }));
  check('source dropzone present', source.drop);
  check('file input accepts video', source.accept.includes('video'), source.accept);
  check('thumbnail canvas present', source.thumb);

  const stage = await page.evaluate(() => ({
    canvas: !!document.getElementById('ceStage'),
    video: !!document.getElementById('ceVideo'),
    transport: ['cePlay', 'ceBack', 'ceFwd', 'ceScrub'].every((id) => !!document.getElementById(id)),
  }));
  check('preview canvas + source video', stage.canvas && stage.video);
  check('transport controls present', stage.transport);

  const looks = await page.evaluate(() => [...document.querySelectorAll('.ce-look')].map((b) => b.dataset.look));
  check('8 look cards', looks.length === 8, `(${looks.length})`);
  check('the 8 PRD look ids', ['clean', 'film', 'warm', 'cool', 'mono', 'vintage', 'neon', 'custom'].every((id) => looks.includes(id)), looks.join(','));
  const lookSwitch = await page.evaluate(() => {
    document.querySelector('.ce-look[data-look="film"]').click();
    return {
      active: [...document.querySelectorAll('.ce-look.active')].map((b) => b.dataset.look),
      desc: (document.getElementById('ceLookDesc') || {}).textContent || '',
    };
  });
  check('picking a look moves .active', lookSwitch.active.length === 1 && lookSwitch.active[0] === 'film', lookSwitch.active.join(','));
  check('look description follows the pick', /portra|warmth/i.test(lookSwitch.desc), lookSwitch.desc.slice(0, 40));

  const customHidden = await page.evaluate(() => document.getElementById('ceCustom').classList.contains('hidden'));
  const customShown = await page.evaluate(() => {
    document.querySelector('.ce-look[data-look="custom"]').click();
    return {
      hidden: document.getElementById('ceCustom').classList.contains('hidden'),
      sliders: document.querySelectorAll('#ceCustom input[data-param]').length,
    };
  });
  check('custom sliders hidden by default', customHidden);
  check('custom sliders appear for the custom look', !customShown.hidden && customShown.sliders === 9, `${customShown.sliders} sliders`);

  const overlay = await page.evaluate(() => {
    const modes = [...document.querySelectorAll('.ce-ov')].map((b) => b.dataset.mode);
    document.querySelector('.ce-ov[data-mode="mood"]').click();
    const active = [...document.querySelectorAll('.ce-ov.active')].map((b) => b.dataset.mode);
    const slider = document.getElementById('ceOverlayIntensity');
    slider.value = '55';
    slider.dispatchEvent(new Event('input', { bubbles: true }));
    return { modes, active, readout: (document.getElementById('ceOverlayValue') || {}).textContent };
  });
  check('4 overlay modes', overlay.modes.length === 4, overlay.modes.join(','));
  check('picking an overlay mode moves .active', overlay.active.length === 1 && overlay.active[0] === 'mood', overlay.active.join(','));
  check('intensity slider updates its readout', overlay.readout === '55', overlay.readout);

  const exporter = await page.evaluate(() => ({
    formats: [...(document.getElementById('ceFormat') || {}).options || []].map((o) => o.value),
    qualities: [...(document.getElementById('ceQuality') || {}).options || []].length,
    burns: document.querySelectorAll('[data-burn]').length,
    disabled: (document.getElementById('ceExport') || {}).disabled,
  }));
  check('5 export formats', exporter.formats.length === 5, exporter.formats.join(','));
  check('2 quality options', exporter.qualities === 2, String(exporter.qualities));
  check('5 burn-in toggles', exporter.burns === 5, String(exporter.burns));
  check('export starts disabled', exporter.disabled === true);

  const globals = await page.evaluate(() => ({
    runtime: typeof (window.SWR_CAMERA_ENHANCE && window.SWR_CAMERA_ENHANCE.create),
    exporter: typeof (window.SWR_CAMERA_ENHANCE_EXPORT && window.SWR_CAMERA_ENHANCE_EXPORT.export),
    looks: window.SWR_CAMERA_ENHANCE ? Object.keys(window.SWR_CAMERA_ENHANCE.LOOKS || {}).length : 0,
  }));
  check('SWR_CAMERA_ENHANCE.create is a function', globals.runtime === 'function', globals.runtime);
  check('SWR_CAMERA_ENHANCE_EXPORT.export is a function', globals.exporter === 'function', globals.exporter);
  check('runtime ships the 8 looks', globals.looks === 8, `(${globals.looks})`);

  const boot = await page.evaluate(() => {
    const rt = window.SWR_CAMERA_ENHANCE_PAGE && window.SWR_CAMERA_ENHANCE_PAGE.rt;
    if (!rt) return null;
    const s = rt.getState();
    return { title: s.burnIns.title, subtitle: s.burnIns.subtitle, expose: s.fixList.expose, stabilize: s.fixList.stabilize, denoise: s.fixList.denoise, textKeys: Object.keys(s.burnText).sort().join(',') };
  });
  check('runtime adopts the DOM defaults at boot', !!boot && boot.title === true && boot.expose === true && boot.stabilize === true && boot.denoise === false, boot ? JSON.stringify(boot) : 'no runtime handle');
  check('burn-text carries every burnable field', !!boot && boot.textKeys === 'date,location,subtitle,title', boot ? boot.textKeys : '');

  const fatal = consoleErrors.filter((e) => FATAL_FILTER(e));
  check('no console errors', fatal.length === 0, fatal.length ? fatal.slice(0, 2).join(' | ') : `(${consoleErrors.length} filtered)`);

  console.log(failures === 0 ? '\nCamera Enhance smoke: PASSED' : `\nCamera Enhance smoke: ${failures} failure(s)`);
} finally {
  if (browser) await browser.close().catch(() => {});
  server.close();
}
process.exit(failures === 0 ? 0 : 1);
