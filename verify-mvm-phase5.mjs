// verify-mvm-phase5.mjs — smoke for MVM Phase 5 (text overlays).
//
//   BASE_URL=https://sainted-word-records-kai-djurics-projects.vercel.app \
//     node verify-mvm-phase5.mjs
//
// Asserts:
//   1. window.MVM.addTextOverlay creates a row in state.textOverlays
//   2. addTextOverlay refuses empty/whitespace text
//   3. updateTextOverlay changes a field
//   4. removeTextOverlay removes the row
//   5. text overlays render on the canvas during their time window
//   6. text overlays persist in localStorage

import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import puppeteer from 'puppeteer';

const BASE = process.env.BASE_URL || 'http://localhost:5174';
const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PORT = 8084;

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

  await page.setViewport({ width: 1280, height: 720 });
  await page.goto(`${BASE}/make-video.html`, { waitUntil: 'networkidle0', timeout: 45000 });

  let waited = 0;
  while (waited < 30000) {
    const ready = await page.evaluate(() => !!window.MVM);
    if (ready) break;
    await new Promise((r) => setTimeout(r, 500));
    waited += 500;
  }
  if (waited >= 30000) throw new Error('MVM never came up');

  // Reset project
  await page.evaluate(() => {
    try { localStorage.removeItem('swr.mvm.project'); } catch (_) {}
  });
  await page.reload({ waitUntil: 'networkidle0' });
  await page.waitForFunction(() => !!window.MVM, { timeout: 20000, polling: 500 });

  await step('1. addTextOverlay creates a row in state.textOverlays', async () => {
    const v = await page.evaluate(() => {
      const before = window.MVM.project.textOverlays.length;
      const ov = window.MVM.addTextOverlay({ text: 'hello world', startMs: 0, durationMs: 3000 });
      return {
        before,
        hasOverlay: !!ov,
        overlayId: ov && ov.id,
        count: window.MVM.project.textOverlays.length,
        hasText: ov && ov.text === 'hello world',
        hasEndMs: ov && ov.endMs === 3000,
      };
    });
    ok(v.hasOverlay, 'overlay not returned');
    ok(v.count === v.before + 1, `count went from ${v.before} to ${v.count}`);
    ok(v.hasText, 'text not set');
    ok(v.hasEndMs, 'endMs not derived from start+duration');
  });

  await step('2. addTextOverlay refuses empty/whitespace text', async () => {
    const v = await page.evaluate(() => {
      const before = window.MVM.project.textOverlays.length;
      const r1 = window.MVM.addTextOverlay({ text: '' });
      const r2 = window.MVM.addTextOverlay({ text: '   ' });
      return { r1, r2, count: window.MVM.project.textOverlays.length, before };
    });
    ok(v.r1 === null, 'empty text should return null');
    ok(v.r2 === null, 'whitespace text should return null');
    ok(v.count === v.before, 'no rows should be added');
  });

  await step('3. updateTextOverlay changes a field', async () => {
    const v = await page.evaluate(() => {
      const ov = window.MVM.project.textOverlays[0];
      const updated = window.MVM.updateTextOverlay(ov.id, { text: 'updated', color: '#ff0066' });
      return {
        text: updated.text,
        color: updated.color,
        persisted: window.MVM.project.textOverlays[0].text,
      };
    });
    ok(v.text === 'updated', `text = ${v.text}`);
    ok(v.color === '#ff0066', `color = ${v.color}`);
    ok(v.persisted === 'updated', 'state not updated');
  });

  await step('4. removeTextOverlay removes the row', async () => {
    const v = await page.evaluate(() => {
      const before = window.MVM.project.textOverlays.length;
      const ov = window.MVM.project.textOverlays[0];
      const ok = window.MVM.removeTextOverlay(ov.id);
      return { ok, before, after: window.MVM.project.textOverlays.length };
    });
    ok(v.ok === true, 'removeTextOverlay should return true');
    ok(v.after === v.before - 1, 'row not removed');
  });

  await step('5. text overlays render on the canvas during their time window', async () => {
    const v = await page.evaluate(async () => {
      // Add a new overlay at startMs=0, duration=5000
      const ov = window.MVM.addTextOverlay({
        text: 'PHASE_FIVE_TEST',
        startMs: 0, durationMs: 5000,
        size: 64, color: '#ff0066',
        x: 0.5, y: 0.5,
      });
      // Render at playheadMs=1000 (inside the overlay's window)
      window.MVM.setCanvasSize();
      window.MVM.renderFrame(1000);
      // Sample the center of the canvas (where the text should be)
      const canvas = document.getElementById('preview');
      const ctx = canvas.getContext('2d');
      const cx = Math.floor(canvas.width * 0.5);
      const cy = Math.floor(canvas.height * 0.5);
      // Look for non-black pixels in a 100x40 band around the center
      let nonBlackCount = 0;
      for (let dy = -20; dy < 20; dy++) {
        for (let dx = -50; dx < 50; dx++) {
          const px = ctx.getImageData(cx + dx, cy + dy, 1, 1).data;
          if (px[0] > 20 || px[1] > 20 || px[2] > 20) nonBlackCount++;
        }
      }
      return { nonBlackCount, ovId: ov.id };
    });
    ok(v.nonBlackCount > 50, `expected non-black pixels around text, got ${v.nonBlackCount}`);
  });

  await step('6. text overlays persist in localStorage', async () => {
    const v = await page.evaluate(async () => {
      const beforeReload = window.MVM.project.textOverlays.length;
      const ls = localStorage.getItem('swr.mvm.project');
      return { beforeReload, hasLS: !!ls, ls: ls ? ls.substring(0, 200) : null };
    });
    ok(v.beforeReload > 0, 'should have overlays before reload');
    ok(v.hasLS, 'localStorage should be set');
    ok(v.ls && v.ls.indexOf('textOverlays') !== -1, 'LS should contain textOverlays key');
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