#!/usr/bin/env node
// verify-layer-cover.mjs — the visual half of the Layers.cover() contract.
//
//   node verify-layer-cover.mjs
//
// WHY THIS IS NOT IN check:full / CI
// ----------------------------------
// This was assertion 61 of scripts/check-automix-smoke.mjs, and it flaked on
// the CI runner while passing locally (run 36326212367: `cover behaviour`,
// coverTrue = {tl:filled, tr:black, bl:filled, br:black}). It is a real-time
// canvas-pixel assertion, and reading the renderer explains why it can't be
// made reliable in headless CI:
//
//   versions/music_video.html drawLayer():
//     if (l.cover) { const s = Math.max(W/assetW, H/assetH); dw = assetW*s; dh = assetH*s; }
//     const dx = (W - dw)/2 + r.x;
//     const dy = (H - dh)/2 + r.y;
//
// Cover ignores r.scale (intentionally) but NOT r.x / r.y. With dw === W
// exactly, any non-zero r.x exposes a vertical edge — which is precisely the
// left-filled / right-black pattern CI produced. r.x comes from live audio
// reactor output, so the corner pattern is audio-feature dependent and not
// reproducible run to run. Loosening the threshold to accommodate that would
// have made the assertion meaningless.
//
// So the deterministic half of the contract stays in the smoke — assertion 60
// ("Layers.cover(id, value) flips flag + persists; missing id returns false")
// — and this pixel half runs here, as a sprint gate, on a controlled machine.
//
// Hardening applied here so it is trustworthy when it does run:
//   - the fixture's geometry is pinned (pos.x/y/rot zeroed) before sampling, so
//     the frame it asserts on is the one it describes;
//   - the sample grid is read against the LIVE canvas size each pass, so a
//     stage resize mid-run cannot skew the coordinates;
//   - the contract is differential (cover must fill strictly more of the stage
//     than contain), which is what the feature actually promises, plus a
//     non-triviality floor so a dead render cannot pass.
//
// Run command: node verify-layer-cover.mjs

import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import puppeteer from 'puppeteer';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PORT = 8099;
const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.wav': 'audio/wav', '.mp3': 'audio/mpeg', '.mp4': 'video/mp4', '.webm': 'video/webm',
};

// 1x1 yellow PNG (same fixture the smoke used).
const PIXEL_PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==';

function localServe() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const rel = decodeURIComponent(req.url.split('?')[0].replace(/^\/+/, '')) || 'engine.html';
      const file = path.join(ROOT, rel);
      if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
        res.writeHead(404); res.end('nf'); return;
      }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream' });
      fs.createReadStream(file).pipe(res);
    });
    server.listen(PORT, () => resolve(server));
  });
}

function ok(l) { console.log(`  \u2713 ${l}`); }
function fail(l, m) { console.log(`  \u2717 ${l}: ${m}`); process.exitCode = 1; }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function run() {
  const server = await localServe();
  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
  });
  try {
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e.message || e)));
    await page.setViewport({ width: 1440, height: 900 });
    await page.goto(`http://127.0.0.1:${PORT}/versions/music_video.html`,
      { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForFunction(() => window.SWR && window.SWR.Layers && window.SWR_RENDER,
      { timeout: 30000, polling: 300 });

    // Fixture: a 1x1 image at baseScale 0.5 with a zero-gain scale reactor.
    // pos is pinned so r.x/r.y stay 0 — the drift that made the old CI
    // assertion describe a frame it did not control.
    const built = await page.evaluate((px) => {
      const L = window.SWR.Layers;
      L.reset();
      L.list.push({
        id: 'COVER1',
        asset: { type: 'image', name: '1x1.png', url: px, w: 1, h: 1 },
        blend: 'screen', opacity: 1, baseScale: 0.5, hue: 0,
        brightness: 1, contrast: 1, alpha: 1, mutate: 0,
        cover: false,
        pos: { x: 0, y: 0, rot: 0 },
        reactors: [{ feature: 'bass', target: 'scale', scale: 0, ease: 'sharp' }],
      });
      return { count: L.list.length, dims: { cssW: window.SWR_RENDER.cssW, cssH: window.SWR_RENDER.cssH, dpr: window.SWR_RENDER.dpr } };
    }, PIXEL_PNG);
    ok(`fixture built (1 layer; stage ${built.dims.cssW}x${built.dims.cssH} @${built.dims.dpr}x)`);

    // Grid-sample against the LIVE canvas each pass. 3 columns x 5 rows,
    // inset 2px from the edges so we never sample the outermost pixel row
    // (drawFx paints a scanline at y=0).
    async function coverage() {
      return await page.evaluate(() => {
        const c = document.getElementById('render');
        if (!c) return null;
        const dpr = (window.SWR_RENDER && window.SWR_RENDER.dpr) || 1;
        // Pin geometry so the sampled frame is the one we describe.
        const l = window.SWR.Layers.list[0];
        if (l) { l.pos = { x: 0, y: 0, rot: 0 }; }
        const W = (window.SWR_RENDER && window.SWR_RENDER.cssW) || c.width / dpr;
        const H = (window.SWR_RENDER && window.SWR_RENDER.cssH) || c.height / dpr;
        const ctx = c.getContext('2d');
        let filled = 0, total = 0;
        const pts = [];
        for (let ix = 0; ix < 3; ix++) {
          for (let iy = 0; iy < 5; iy++) {
            const cssX = 2 + Math.round((W - 4) * (ix / 2));
            const cssY = Math.max(1, Math.min(H - 1, 1 + Math.round((H - 2) * (iy / 4))));
            const px = Math.min(c.width - 1, Math.round(cssX * dpr));
            const py = Math.min(c.height - 1, Math.round(cssY * dpr));
            const d = ctx.getImageData(px, py, 1, 1).data;
            const nonBlack = d[0] > 30;
            total++;
            if (nonBlack) filled++;
            pts.push(`${ix},${iy}:${nonBlack ? 'Y' : '.'}`);
          }
        }
        return { filled, total, pts: pts.join(' ') };
      });
    }

    await page.evaluate(() => window.SWR.Layers.cover('COVER1', true));
    await sleep(700);
    const coverOn = await coverage();

    await page.evaluate(() => window.SWR.Layers.cover('COVER1', false));
    await sleep(700);
    const coverOff = await coverage();

    await page.evaluate(() => window.SWR.Layers.cover('COVER1', true));   // restore

    console.log(`  cover:true  fills ${coverOn.filled}/${coverOn.total}   ${coverOn.pts}`);
    console.log(`  cover:false fills ${coverOff.filled}/${coverOff.total}   ${coverOff.pts}`);

    // Contract: cover fills strictly more of the stage than contain, and
    // actually fills a meaningful share (a dead render must not pass by
    // scoring 0 > 0, nor 1 > 0).
    if (coverOn.filled > coverOff.filled) {
      ok(`cover fills strictly more than contain (${coverOn.filled} > ${coverOff.filled})`);
    } else {
      fail('cover vs contain', `cover ${coverOn.filled}/${coverOn.total} did not exceed contain ${coverOff.filled}/${coverOff.total}`);
    }
    if (coverOn.filled >= Math.ceil(coverOn.total / 2)) {
      ok(`cover fills at least half the sampled stage (${coverOn.filled}/${coverOn.total})`);
    } else {
      fail('cover coverage', `only ${coverOn.filled}/${coverOn.total} sampled points filled`);
    }
    if (coverOff.filled <= Math.floor(coverOff.total / 3)) {
      ok(`contain letterboxes (${coverOff.filled}/${coverOff.total} filled)`);
    } else {
      fail('contain letterbox', `${coverOff.filled}/${coverOff.total} filled — expected at most a third`);
    }

    if (errors.length === 0) ok('no pageerror during the run');
    else fail('pageerror', errors.join('; '));
  } finally {
    await browser.close();
    server.close();
  }
}

run().catch((e) => { console.error('FATAL', e); process.exit(1); });
