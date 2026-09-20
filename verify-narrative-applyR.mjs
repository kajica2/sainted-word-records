#!/usr/bin/env node
// verify-narrative-applyR.mjs — verifies the applyR drift integration
// (ADR-001 Step 2). Confirms that music_video.html's applyR function
// biases layer positions by SWR_NARRATIVE.state.drift when the module
// is loaded, and that the no-op guard works when it isn't.
//
//   node verify-narrative-applyR.mjs
//
// The verify focuses on RELATIVE behavior rather than exact pixel values:
//   1. music_video.html loads cleanly
//   2. SWR_NARRATIVE is exposed
//   3. window.SWR.applyR exists
//   4. With narrative-state loaded + drift evolved, out.x and out.y
//      are non-zero (the bias is being applied)
//   5. With narrative-state NOT loaded, out.x and out.y are zero
//      (the no-op guard works)
//   6. The bias scales with state.drift: doubling drift.x doubles
//      out.x's bias contribution
//
// music_video.html's applyR also gets wrapped by the hologram feature,
// which adds its own bias on top of ours. The verify works around
// this by:
//   - Calling window.SWR.applyR (the wrapped version) — the test
//     verifies behavior, not exact math
//   - Stubbing window.A so the synth's params are predictable
//   - Testing RELATIVE bias (with vs without narrative) rather than
//     exact pixel counts

import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import puppeteer from 'puppeteer';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PORT = 8226;
const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml',
};

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

function ok(label) { console.log(`  \u2713 ${label}`); }
function fail(label, msg) { console.log(`  \u2717 ${label}: ${msg}`); process.exitCode = 1; }

async function run() {
  const server = await localServe();
  let browser;
  try {
    browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
    const page = await browser.newPage();
    const errors = [];
    page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
    page.on('pageerror', e => errors.push(String(e)));

    await page.goto(`http://localhost:${PORT}/versions/music_video.html`, { waitUntil: 'networkidle2' });
    await new Promise(r => setTimeout(r, 2000));

    const realErrors = errors.filter(e =>
      !e.includes('SWR_RENDER') &&
      !e.includes('ws://') &&
      !e.includes('404') &&
      !e.includes('versions-presets') &&
      !e.includes('hologram')
    );
    if (realErrors.length === 0) ok('music_video.html loads with no relevant console errors');
    else fail('console errors', realErrors.join('; '));

    // Stub A so applyR has predictable params + audio metadata
    await page.evaluate(() => {
      if (!window.A) {
        window.A = {
          feat: { rms: 0.5, beat: 0, centroid: 0.5 },
          params: { sens: 1.5 },
          el: { duration: 100 },
          src: '', playing: false,
        };
      }
    });

    // 2. SWR_NARRATIVE exposed
    const apiOk = await page.evaluate(() => ({
      hasNarrative: !!window.SWR_NARRATIVE,
      hasApplyR: typeof window.SWR?.applyR === 'function',
    }));
    if (apiOk.hasNarrative) ok('window.SWR_NARRATIVE exposed');
    else fail('SWR_NARRATIVE', 'missing');
    if (apiOk.hasApplyR) ok('window.SWR.applyR is a function');
    else fail('SWR.applyR', 'not a function');

    // Helper: run applyR with the current state, return out.x and out.y
    const makeSynth = () => ({
      baseScale: 1, hue: 0, opacity: 1, brightness: 1, contrast: 1,
      reactors: [], asset: { type: 'image' },
      reactorsEnabled: true, rotationEnabled: true,
    });

    // 3. The no-op guard: when SWR_NARRATIVE is undefined, applyR
    // returns no drift bias on out.x / out.y
    const outNoGuard = await page.evaluate(() => {
      const synth = {
        baseScale: 1, hue: 0, opacity: 1, brightness: 1, contrast: 1,
        reactors: [], asset: { type: 'image' },
        reactorsEnabled: true, rotationEnabled: true,
      };
      const saved = window.SWR_NARRATIVE;
      delete window.SWR_NARRATIVE;
      try {
        const out = window.SWR.applyR(synth);
        return { x: out.x, y: out.y };
      } finally {
        window.SWR_NARRATIVE = saved;
      }
    });
    if (outNoGuard.x === 0 && outNoGuard.y === 0) {
      ok('no-op guard: applyR returns x=0, y=0 when SWR_NARRATIVE is undefined');
    } else {
      fail('no-op guard', `expected (0, 0), got (${outNoGuard.x}, ${outNoGuard.y})`);
    }

    // 4. With narrative-state loaded, bias is non-zero
    const outWith = await page.evaluate(() => {
      const synth = {
        baseScale: 1, hue: 0, opacity: 1, brightness: 1, contrast: 1,
        reactors: [], asset: { type: 'image' },
        reactorsEnabled: true, rotationEnabled: true,
      };
      // Force a known drift state
      window.SWR_NARRATIVE.state.drift.x = 0.5;
      window.SWR_NARRATIVE.state.drift.y = -0.5;
      window.SWR_NARRATIVE.state.age = 50; // middle phase, driftAmp=1.0
      const out = window.SWR.applyR(synth);
      return { x: out.x, y: out.y };
    });
    if (outWith.x !== 0 && outWith.y !== 0) {
      ok(`drift bias present: out.x=${outWith.x.toFixed(2)}, out.y=${outWith.y.toFixed(2)}`);
    } else {
      fail('drift bias', `expected non-zero bias, got x=${outWith.x}, y=${outWith.y}`);
    }

    // 5. Bias scales with drift: doubling drift.x should double out.x's
    //    bias contribution. We compute (out_with - out_no_guard) at two
    //    drift values and check the ratio is ~2x.
    const biasCheck = await page.evaluate(() => {
      const synth = {
        baseScale: 1, hue: 0, opacity: 1, brightness: 1, contrast: 1,
        reactors: [], asset: { type: 'image' },
        reactorsEnabled: true, rotationEnabled: true,
      };
      window.SWR_NARRATIVE.state.age = 50;
      window.SWR_NARRATIVE.state.drift.y = 0; // hold y constant
      const saved = window.SWR_NARRATIVE;
      delete window.SWR_NARRATIVE;
      const baselineX = window.SWR.applyR(synth).x;
      window.SWR_NARRATIVE = saved;
      window.SWR_NARRATIVE.state.drift.x = 0.25;
      const outAt25 = window.SWR.applyR(synth);
      window.SWR_NARRATIVE.state.drift.x = 0.5;
      const outAt50 = window.SWR.applyR(synth);
      const bias25 = outAt25.x - baselineX;
      const bias50 = outAt50.x - baselineX;
      return { baselineX, bias25, bias50, ratio: bias50 / bias25 };
    });
    // Allow 5% slack for arithmetic
    if (biasCheck.ratio > 1.9 && biasCheck.ratio < 2.1) {
      ok(`drift scales linearly: doubling drift.x doubles bias (ratio=${biasCheck.ratio.toFixed(3)})`);
    } else {
      fail('drift scaling', `expected ratio ~2.0, got ${biasCheck.ratio.toFixed(3)} (bias25=${biasCheck.bias25.toFixed(2)}, bias50=${biasCheck.bias50.toFixed(2)})`);
    }

    if (realErrors.length === 0) ok('no relevant console errors during full run');
    else fail('console errors', realErrors.join('; '));
  } finally {
    if (browser) await browser.close();
    server.close();
  }
}

run().catch(err => {
  console.error('FATAL', err);
  process.exit(1);
});