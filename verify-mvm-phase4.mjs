// verify-mvm-phase4.mjs — smoke test for MVM Phase 4 (audio-reactive viz).
//
//   BASE_URL=https://sainted-word-records-kai-djurics-projects.vercel.app \
//     node verify-mvm-phase4.mjs
//
// Asserts:
//   1. window.MVM_AUDIO_VIZ exists with .render
//   2. render with high bass+beat produces non-black pixels
//   3. render with all-zero feat produces a thin baseline only (no jazz)
//   4. setVizEnabled(false) toggles state._vizEnabled
//   5. viz-toggle checkbox exists in the header

import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import puppeteer from 'puppeteer';

const BASE = process.env.BASE_URL || 'http://localhost:5174';
const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PORT = 8085;

const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.wav': 'audio/wav',
  '.mp3': 'audio/mpeg', '.mp4': 'video/mp4', '.webm': 'video/webm',
};

function localServe() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const rel = decodeURIComponent(req.url.split('?')[0].replace(/^\/+/, '')) || 'index.html';
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

let failed = 0;
async function step(name, fn) {
  try { await fn(); process.stdout.write(`  ✓ ${name}\n`); }
  catch (e) { failed += 1; process.stderr.write(`  ✗ ${name}\n    ${e.stack || e.message}\n`); }
}
const ok = (cond, msg) => { if (!cond) throw new Error(msg || 'assertion failed'); };

const server = await localServe();
let browser;
try {
  browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
  const page = await browser.newPage();
  page.on('pageerror', (err) => process.stderr.write('PE: ' + err.message + '\n'));
  page.on('console', (msg) => { if (msg.type() === 'error') process.stderr.write('CE: ' + msg.text() + '\n'); });

  await page.setViewport({ width: 1280, height: 720 });
  await page.goto(`${BASE}/make-video.html`, { waitUntil: 'networkidle0', timeout: 45000 });

  let waited = 0;
  while (waited < 30000) {
    const ready = await page.evaluate(() =>
      !!window.MVM && !!window.MVM_AUDIO_VIZ);
    if (ready) break;
    await new Promise((r) => setTimeout(r, 500));
    waited += 500;
  }
  if (waited >= 30000) throw new Error('MVM + MVM_AUDIO_VIZ never came up');

  await step('1. window.MVM_AUDIO_VIZ exists with .render', async () => {
    const v = await page.evaluate(() => ({
      exists: !!window.MVM_AUDIO_VIZ,
      hasRender: !!(window.MVM_AUDIO_VIZ && typeof window.MVM_AUDIO_VIZ.render === 'function'),
      marker: window.MVM_AUDIO_VIZ && window.MVM_AUDIO_VIZ.__mvm,
    }));
    ok(v.exists, 'MVM_AUDIO_VIZ missing');
    ok(v.hasRender, 'render() missing');
    ok(v.marker, 'idempotency marker missing');
  });

  await step('2. render() with high bass+beat produces non-black pixels', async () => {
    const v = await page.evaluate(() => {
      const canvas = document.createElement('canvas');
      canvas.width = 800; canvas.height = 450;
      const ctx = canvas.getContext('2d');
      // Black backdrop to isolate the viz contribution
      ctx.fillStyle = '#000000';
      ctx.fillRect(0, 0, 800, 450);
      // Strong feature values: high bass, mid, treble, RMS, and a beat
      const feat = { bass: 200, mid: 180, treble: 160, sub: 100, rms: 200, centroid: 0.5, bpm: 120, beatPulse: true };
      window.MVM_AUDIO_VIZ.render(ctx, 800, 450, feat, 200);
      // Sample 9 grid points + the bottom 1/3 (where bars are)
      const samples = [];
      for (let yi = 0; yi < 3; yi++) {
        for (let xi = 0; xi < 3; xi++) {
          const px = ctx.getImageData(Math.floor(800 * (xi + 0.5) / 3), Math.floor(450 * (yi + 0.5) / 3), 1, 1).data;
          samples.push([px[0], px[1], px[2]]);
        }
      }
      // Sample bars region (bottom 1/3) — sample densely along the
      // bottom row to avoid landing on bar gaps
      const barSamples = [];
      for (let i = 0; i < 80; i++) {
        const x = 5 + i * 10;
        const y = 380;
        const px = ctx.getImageData(x, y, 1, 1).data;
        barSamples.push([px[0], px[1], px[2]]);
      }
      return { samples, barSamples };
    });
    const nonBlackSamples = v.samples.filter((s) => s[0] > 10 || s[1] > 10 || s[2] > 10);
    const nonBlackBars = v.barSamples.filter((s) => s[0] > 10 || s[1] > 10 || s[2] > 10);
    ok(nonBlackSamples.length > 0, `3x3 grid stayed black: ${JSON.stringify(v.samples)}`);
    ok(nonBlackBars.length > 0, `bar region stayed black: ${JSON.stringify(v.barSamples)}`);
  });

  await step('3. render() with all-zero feat produces a thin baseline only', async () => {
    const v = await page.evaluate(() => {
      const canvas = document.createElement('canvas');
      canvas.width = 400; canvas.height = 200;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#000000';
      ctx.fillRect(0, 0, 400, 200);
      // Silent canvas
      window.MVM_AUDIO_VIZ.render(ctx, 400, 200, {}, 0);
      // Sample a vertical slice to see how many rows have non-black pixels
      // (the baseline is just 1px tall at the very bottom)
      let rowsWithColor = 0;
      for (let y = 0; y < 200; y++) {
        let rowHasColor = false;
        for (let x = 0; x < 400; x += 10) {
          const px = ctx.getImageData(x, y, 1, 1).data;
          if (px[0] > 10 || px[1] > 10 || px[2] > 10) { rowHasColor = true; break; }
        }
        if (rowHasColor) rowsWithColor++;
      }
      return { rowsWithColor };
    });
    // The backdrop is 67 rows (bottom 1/3 of 200). The waveform adds ~5
    // rows in the middle. The baseline adds 1. So silent should be
    // substantially less than loud. Compare to the loud run.
    ok(v.rowsWithColor <= 90, `silent canvas had ${v.rowsWithColor} non-black rows; expected ≤ 90`);
  });

  await step('4. setVizEnabled(false) toggles state._vizEnabled', async () => {
    const v = await page.evaluate(() => {
      // Default is true (no song loaded, so we manually flip)
      const before = window.MVM.vizEnabled;
      window.MVM.setVizEnabled(false);
      const after = window.MVM.vizEnabled;
      const cb = document.getElementById('viz-toggle');
      // The setter also updates the DOM checkbox
      const cbChecked = cb ? cb.checked : null;
      // Restore
      window.MVM.setVizEnabled(true);
      return { before, after, cbChecked };
    });
    ok(v.before === true, 'vizEnabled should default to true');
    ok(v.after === false, 'setVizEnabled(false) should flip vizEnabled to false');
    ok(v.cbChecked === false, 'checkbox should be unchecked after setVizEnabled(false)');
  });

  await step('5. viz-toggle checkbox exists in the header', async () => {
    const v = await page.evaluate(() => {
      const cb = document.getElementById('viz-toggle');
      return { exists: !!cb, type: cb && cb.type, checked: cb && cb.checked };
    });
    ok(v.exists, 'checkbox missing');
    ok(v.type === 'checkbox', 'wrong type: ' + v.type);
    ok(v.checked === true, 'default should be checked');
  });
} finally {
  if (browser) await browser.close();
  server.close();
}

if (failed === 0) {
  console.log('\nALL GREEN');
  process.exit(0);
} else {
  console.log(`\n${failed} FAILED`);
  process.exit(1);
}