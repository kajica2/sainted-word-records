#!/usr/bin/env node
// scripts/check-mv-smoke.mjs — Phase A smoke for the music_video gradient page.
//
// Self-contained: ensureDist() auto-builds dist/ if missing. No need
// to remember `npm run build` first.
//
// Boots a static server on dist/, opens versions/music_video.html in
// Puppeteer, and verifies:
//   - the page loads with the MUSIC VIDEO header + no outbound nav links
//   - window.SWR_ANCHOR_MAP is exposed with 19 anchor presets
//   - the gradient canvas has cyan dot pixels (the anchor dots rendered)
//   - the synth-pill says "— no track"
//   - the depth + N sliders exist with default 0.5 and 4
//   - neighbours() returns 4 ids at the middle of the gradient

import puppeteer from 'puppeteer';
import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { ensureDist } from './with-dist.mjs';

// Auto-build dist/ if missing — no more "forgot to npm run build" 404s.
ensureDist();

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'dist');
const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.gif': 'image/gif', '.wav': 'audio/wav', '.mp3': 'audio/mpeg',
  '.mp4': 'video/mp4', '.webm': 'video/webm',
};
const server = http.createServer((req, res) => {
  let rel = decodeURIComponent(req.url.split('?')[0].replace(/^\/+/, '')) || 'index.html';
  if (rel === 'app' || rel === 'app/') rel = 'swr-app.html';
  const full = path.join(ROOT, rel);
  if (!full.startsWith(ROOT)) { res.writeHead(403); return res.end('forbidden'); }
  fs.readFile(full, (err, buf) => {
    if (err) { res.writeHead(404); return res.end('not found'); }
    const ext = path.extname(full).toLowerCase();
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    res.end(buf);
  });
});

const PORT = 5180;
let failures = 0;
function assert(cond, msg) {
  if (cond) { console.log('  ✓', msg); }
  else      { console.log('  ✗', msg); failures++; }
}

(async () => {
  await new Promise(r => server.listen(PORT, r));
  console.log(`[mv-smoke] static server listening on :${PORT}`);

  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
  });
  const page = await browser.newPage();
  page.on('pageerror', e => console.log('  [page error]', e.message));
  page.on('console', m => { if (m.type() === 'error') console.log('  [console.error]', m.text()); });

  await page.goto(`http://localhost:${PORT}/versions/music_video.html`, { waitUntil: 'networkidle0', timeout: 30000 });

  console.log('\n=== page boot ===');
  const boot = await page.evaluate(() => {
    const map = window.SWR_ANCHOR_MAP;
    return {
      title: document.title,
      headerV: document.querySelector('.v')?.textContent?.trim() || '',
      synthPill: document.getElementById('synth-pill')?.textContent?.trim() || '',
      gradientCanvas: !!document.getElementById('gradient'),
      depthSlider: document.getElementById('depth')?.value,
      nSlider: document.getElementById('neighbour-count')?.value,
      depthLabel: document.getElementById('depth-v')?.textContent,
      nLabel: document.getElementById('neighbour-count-v')?.textContent,
      anchorCount: map ? map.list().length : 0,
      anchorSample: map ? map.list().slice(0, 5) : null,
      neighboursAtMiddle: map ? map.neighbours({warmth: 0.5, intensity: 0.5}, 4).map(n => n.id) : null,
      swrKeys: Object.keys(window.SWR || {}),
      hasGradient: !!window.SWR_GRADIENT,
      hologramState: window.SWR?.HologramState || null,
      outboundLinks: Array.from(document.querySelectorAll('a'))
        .map(a => a.getAttribute('href'))
        .filter(h => h && (h.endsWith('.html') || h.startsWith('/versions/') || h.startsWith('../'))),
    };
  });

  assert(boot.title === 'MUSIC VIDEO · SWR engine v1', `title is "MUSIC VIDEO" (got: "${boot.title}")`);
  assert(boot.headerV.startsWith('MUSIC VIDEO'), `header version pill says MUSIC VIDEO (got: "${boot.headerV}")`);
  assert(boot.synthPill.includes('no track'), `synth pill says "no track" before a track loads (got: "${boot.synthPill}")`);
  assert(boot.gradientCanvas, 'gradient canvas exists in the DOM');
  assert(boot.depthSlider === '0.5', `depth slider default is 0.5 (got: ${boot.depthSlider})`);
  assert(boot.nSlider === '4', `N slider default is 4 (got: ${boot.nSlider})`);
  assert(boot.depthLabel === '0.50', `depth label reads 0.50 (got: ${boot.depthLabel})`);
  assert(boot.nLabel === '4', `N label reads 4 (got: ${boot.nLabel})`);
  assert(boot.anchorCount === 19, `SWR_ANCHOR_MAP exposes 19 anchor presets (got: ${boot.anchorCount})`);
  assert(boot.anchorSample && boot.anchorSample.includes('neon'), 'neon is one of the anchor presets');
  assert(boot.neighboursAtMiddle && boot.neighboursAtMiddle.length === 4, 'neighbours() returns 4 ids at middle');
  assert(boot.hasGradient, 'window.SWR_GRADIENT is exposed');
  assert(boot.hologramState && boot.hologramState.depth === 0.5 && boot.hologramState.neighbours === 4,
    `window.SWR.HologramState is { depth: 0.5, neighbours: 4 } (got: ${JSON.stringify(boot.hologramState)})`);
  assert(boot.outboundLinks.length === 0,
    `no outbound cross-page nav links (got: ${JSON.stringify(boot.outboundLinks)})`);

  console.log('\n=== gradient canvas pixels ===');
  const pixels = await page.evaluate(() => {
    const cv = document.getElementById('gradient');
    const ctx = cv.getContext('2d');
    const data = ctx.getImageData(0, 0, cv.width, cv.height).data;
    let cyanPixels = 0, labelPixels = 0, totalNonBlack = 0;
    for (let i = 0; i < data.length; i += 4) {
      const r = data[i], g = data[i+1], b = data[i+2], a = data[i+3];
      if (r || g || b) totalNonBlack++;
      // cyan dot: G+B > 80, R < 100, alpha high
      if (g > 80 && b > 80 && r < 100) cyanPixels++;
      // label: alpha-blended over the dark bg (rgb 10,6,18) at 55%
      // alpha produces rgb ≈ (138, 130, 147) — distinguish from the
      // anchor dots (cyan) by requiring R > G (label leans pink/white,
      // cyan dots have G > R by a wide margin).
      if (r > 100 && r > g + 5 && b > 100) labelPixels++;
    }
    return { cyanPixels, labelPixels, totalNonBlack, canvasW: cv.width, canvasH: cv.height };
  });
  assert(pixels.cyanPixels > 50, `gradient has >50 cyan pixels (anchor dots — got: ${pixels.cyanPixels})`);
  assert(pixels.labelPixels > 100, `gradient has >100 light label pixels (got: ${pixels.labelPixels})`);

  console.log('\n=== depth slider movement ===');
  // Set depth to 1 via the slider, verify the label updates
  await page.evaluate(() => {
    const s = document.getElementById('depth');
    s.value = '1';
    s.dispatchEvent(new Event('input', { bubbles: true }));
  });
  const afterDepth = await page.evaluate(() => ({
    label: document.getElementById('depth-v').textContent,
    state: window.SWR.HologramState.depth,
  }));
  assert(afterDepth.label === '1.00', `depth label updates to 1.00 after slider input (got: ${afterDepth.label})`);
  assert(afterDepth.state === 1, `HologramState.depth reflects 1.0 (got: ${afterDepth.state})`);

  // Verify the make-video.html format selector.
  await page.goto(`http://localhost:${PORT}/make-video.html`, {
    waitUntil: 'domcontentloaded',
  });
  const fmtShape = await page.evaluate(async () => {
    const sel = document.getElementById('format-select');
    if (!sel) return { ok: false, reason: 'no #format-select' };
    const initial = {
      sel: sel.value,
      mvm: window.MVM_FORMAT,
      canvasW: document.getElementById('preview').width,
      canvasH: document.getElementById('preview').height,
    };
    sel.value = '9:16';
    sel.dispatchEvent(new Event('change'));
    await new Promise(r => setTimeout(r, 50));
    const after9x16 = {
      sel: sel.value,
      mvm: window.MVM_FORMAT,
      canvasW: document.getElementById('preview').width,
      canvasH: document.getElementById('preview').height,
    };
    sel.value = '1:1';
    sel.dispatchEvent(new Event('change'));
    await new Promise(r => setTimeout(r, 50));
    const after1x1 = {
      mvm: window.MVM_FORMAT,
      canvasW: document.getElementById('preview').width,
      canvasH: document.getElementById('preview').height,
    };
    return { ok: true, initial, after9x16, after1x1 };
  });
  assert(fmtShape.ok
      && fmtShape.initial.mvm === '16:9'
      && fmtShape.initial.canvasW === 640 && fmtShape.initial.canvasH === 360
      && fmtShape.after9x16.mvm === '9:16'
      && fmtShape.after9x16.canvasW === 360 && fmtShape.after9x16.canvasH === 640
      && fmtShape.after1x1.mvm === '1:1'
      && fmtShape.after1x1.canvasW === 720 && fmtShape.after1x1.canvasH === 720,
    'make-video format selector: 16:9, 9:16, 1:1 sizes match FORMATS table '
      + JSON.stringify(fmtShape));

  // Verify /photo.html — Photo Studio MVP: stage canvas + inputs + export
  // button + 1080×1080 default format.
  await page.goto(`http://localhost:${PORT}/photo.html`, {
    waitUntil: 'domcontentloaded',
  });
  const photoShape = await page.evaluate(() => ({
    title: document.title,
    hasStage: !!document.getElementById('stage'),
    hasImageInput: !!document.getElementById('image-input'),
    hasAudioInput: !!document.getElementById('audio-input'),
    hasFormat: !!document.getElementById('format-select'),
    hasExportBtn: !!document.getElementById('export-btn'),
    hasPlayBtn: !!document.getElementById('play-btn'),
    formatValue: document.getElementById('format-select')
      ? document.getElementById('format-select').value : null,
    stageSize: document.getElementById('stage')
      ? [document.getElementById('stage').width, document.getElementById('stage').height]
      : null,
    hasRecorder: !!window.SWR_RECORDER,
  }));
  assert(
    photoShape.title === 'Photo Studio · Sainted Word Records'
      && photoShape.hasStage
      && photoShape.hasImageInput
      && photoShape.hasAudioInput
      && photoShape.hasFormat
      && photoShape.hasExportBtn
      && photoShape.hasPlayBtn
      && photoShape.formatValue === '1080x1080'
      && photoShape.stageSize
      && photoShape.stageSize[0] === 1080
      && photoShape.stageSize[1] === 1080
      && photoShape.hasRecorder,
    `/photo loads with stage canvas + image/audio/format inputs + export button + 1080×1080 default (got: ${JSON.stringify(photoShape)})`);

  await browser.close();
  server.close();

  console.log('\n' + (failures === 0
    ? 'MV SMOKE: ALL GREEN'
    : `MV SMOKE: ${failures} failure(s)`));
  process.exit(failures === 0 ? 0 : 1);
})().catch(e => {
  console.error(e);
  server.close();
  process.exit(2);
});
