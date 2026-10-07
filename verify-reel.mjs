#!/usr/bin/env node
// verify-reel.mjs — smoke test for the auto-advance demo-reel player
// (engine-reel.client.js / window.SWR_REEL) on engine.html.
//
//   node verify-reel.mjs        (or: npm run verify:reel)
//
// Boots a static server over the source tree (same pattern as
// verify-autoplay.mjs), loads engine.html in headless Chrome, and asserts:
//   1. Page boots with window.SWR_REEL and no fatal console errors
//   2. Toolbar reel bar mounted — select lists the curated "Slip Sets 1"
//   3. Selecting the reel loads + plays it hands-off (7 tracks, track 1 up)
//   4. Track 1 applied its set: exactly one hero layer from the set
//   5. Genuine 'ended' auto-advances to track 2 (set applied, still playing)
//   6. Manual pause() + 'ended' never advances
//   7. stop() resets to track 0 and stops playback
//
// The 'ended' event is dispatched manually (real track playback is minutes
// long); everything around it — fetch, importSet, applySet, layer reset,
// the ended-listener wiring — is the real production path.

import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import puppeteer from 'puppeteer';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PORT = 8212;

const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.webp': 'image/webp', '.wav': 'audio/wav', '.mp3': 'audio/mpeg',
  '.mp4': 'video/mp4', '.webm': 'video/webm', '.gif': 'image/gif',
};

function serve() {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const rel = decodeURIComponent(req.url.split('?')[0].replace(/^\/+/, '')) || 'index.html';
      const file = path.join(ROOT, rel);
      if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
        res.writeHead(404); res.end('nf'); return;
      }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream' });
      fs.createReadStream(file).pipe(res);
    });
    // A busy port must fail loudly — a silent hang here once hid a whole
    // suite behind an orphaned listener (see scripts/check-capture-smoke.mjs).
    server.on('error', (err) => {
      console.error('REEL SMOKE: cannot bind port ' + PORT + ' — ' + (err && err.code ? err.code : err));
      reject(err);
    });
    server.listen(PORT, () => resolve(server));
  });
}

let failed = 0;
async function step(name, fn) {
  try {
    await fn();
    process.stdout.write('  ✓ ' + name + '\n');
  } catch (e) {
    failed += 1;
    process.stderr.write('  ✗ ' + name + '\n    ' + (e.stack || e.message) + '\n');
  }
}

const server = await serve();
let browser;
try {
  browser = await puppeteer.launch({
    headless: 'new',
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--autoplay-policy=no-user-gesture-required',
    ],
  });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push('PE: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push('CE: ' + m.text()); });

  await page.goto('http://localhost:' + PORT + '/engine.html', { waitUntil: 'domcontentloaded', timeout: 45000 });
  await page.waitForFunction(
    () => !!(window.SWR_REEL && window.SWR && window.SWR_SETS && window.Layers),
    { timeout: 30000, polling: 500 }
  );

  // Same filter as scripts/check-capture-smoke.mjs: the dev-control WS probe
  // to ws://localhost:8787 and the static server's /api/* 404s are pre-existing
  // noise on every suite that serves the tree without the swrc API middleware.
  const FATAL_FILTER = /WebSocket.*ws:\/\/localhost:8787|404/;
  const fatal = () => errors.filter((e) => !FATAL_FILTER.test(e));

  await step('engine boots with window.SWR_REEL and no fatal console errors', async () => {
    const defined = await page.evaluate(() => !!window.SWR_REEL);
    if (!defined) throw new Error('window.SWR_REEL undefined');
    const f = fatal();
    if (f.length) throw new Error(f.join(' | '));
  });

  await step('reel bar mounted — select lists the curated "Slip Sets 1"', async () => {
    const ui = await page.evaluate(() => {
      const sel = document.getElementById('reel-select');
      return {
        hasSelect: !!sel,
        options: sel ? Array.from(sel.options).map((o) => o.textContent) : [],
        hasButtons: !!document.getElementById('reel-play') &&
                    !!document.getElementById('reel-prev') &&
                    !!document.getElementById('reel-next'),
        label: (document.getElementById('reel-status') || {}).textContent,
      };
    });
    if (!ui.hasSelect) throw new Error('#reel-select missing');
    if (!ui.hasButtons) throw new Error('prev/play/next buttons missing');
    if (!ui.options.includes('Slip Sets 1')) throw new Error('catalog not listed: ' + JSON.stringify(ui.options));
    if (ui.label !== 'no reel') throw new Error('idle label: ' + ui.label);
  });

  await step('selecting the reel loads + plays it hands-off (7 tracks, track 1 up)', async () => {
    await page.evaluate(() => {
      const sel = document.getElementById('reel-select');
      sel.value = window.SWR_REEL.CATALOG[0].url;
      sel.dispatchEvent(new Event('change'));
    });
    await page.waitForFunction(
      () => window.SWR_REEL.state.playing === true && window.SWR_REEL.state.total === 7 &&
            window.SWR_REEL.state.index === 0,
      { timeout: 25000, polling: 250 }
    );
    const s = await page.evaluate(() => ({
      name: window.SWR_REEL.state.current.name,
      label: document.getElementById('reel-status').textContent,
    }));
    if (s.name !== 'Bebop Blue') throw new Error('track 1 name: ' + s.name);
    if (s.label !== '1/7 · Bebop Blue') throw new Error('label: ' + s.label);
  });

  await step('track 1 applied its set — exactly one hero layer', async () => {
    await page.waitForFunction(
      () => window.Layers.list.length === 1,
      { timeout: 15000, polling: 250 }
    );
    const layer = await page.evaluate(() => ({
      count: window.Layers.list.length,
      asset: window.Layers.list[0].asset && window.Layers.list[0].asset.name,
    }));
    if (layer.count !== 1) throw new Error('layer count ' + layer.count);
    if (!/^holo-/.i.test(layer.asset || '')) throw new Error('hero asset: ' + layer.asset);
  });

  await step('genuine \'ended\' auto-advances to track 2 (set applied, still playing)', async () => {
    await page.evaluate(() => {
      window.SWR.Audio.audioEl.dispatchEvent(new Event('ended'));
    });
    await page.waitForFunction(
      () => window.SWR_REEL.state.index === 1 && window.SWR_REEL.state.playing === true,
      { timeout: 25000, polling: 250 }
    );
    const s = await page.evaluate(() => ({
      name: window.SWR_REEL.state.current.name,
      label: document.getElementById('reel-status').textContent,
      layers: window.Layers.list.length,
      asset: window.Layers.list[0] && window.Layers.list[0].asset && window.Layers.list[0].asset.name,
    }));
    if (s.name !== 'Bebop Blue · Take 2') throw new Error('track 2 name: ' + s.name);
    if (s.label !== '2/7 · Bebop Blue · Take 2') throw new Error('label: ' + s.label);
    if (s.layers !== 1) throw new Error('layer stack grew: ' + s.layers);
    if (!/^holo-1\./i.test(s.asset || '')) throw new Error('hero asset not swapped: ' + s.asset);
  });

  await step('manual pause() + \'ended\' never advances', async () => {
    await page.evaluate(() => {
      window.SWR_REEL.pause();
      window.SWR.Audio.audioEl.dispatchEvent(new Event('ended'));
    });
    await new Promise((r) => setTimeout(r, 1500));
    const s = await page.evaluate(() => ({
      index: window.SWR_REEL.state.index,
      playing: window.SWR_REEL.state.playing,
    }));
    if (s.index !== 1) throw new Error('advanced while paused: index ' + s.index);
    if (s.playing !== false) throw new Error('playing flag set while paused');
  });

  await step('stop() resets to track 0 and stops playback', async () => {
    const s = await page.evaluate(() => {
      window.SWR_REEL.stop();
      return { index: window.SWR_REEL.state.index, playing: window.SWR_REEL.state.playing };
    });
    if (s.index !== 0) throw new Error('index ' + s.index);
    if (s.playing !== false) throw new Error('playing ' + s.playing);
    const f = fatal();
    if (f.length) throw new Error(f.join(' | '));
  });
} finally {
  if (browser) await browser.close();
  server.close();
}

console.log(failed === 0 ? '\nREEL SMOKE: all steps passed' : '\nREEL SMOKE: ' + failed + ' step(s) failed');
process.exit(failed === 0 ? 0 : 1);
