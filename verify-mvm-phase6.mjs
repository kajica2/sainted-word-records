// verify-mvm-phase6.mjs — smoke for MVM Phase 6 (snapshot thumbnails).
//
//   BASE_URL=http://localhost:5174 node verify-mvm-phase6.mjs
//
// Asserts:
//   1. window.MVM.renderClipThumb returns a dataURL for an image clip
//   2. The dataURL is non-empty + looks like a JPEG (header 'data:image/jpeg')
//   3. Every timeline row has a .tl-thumb element
//   4. After renderClipThumb, the row's .tl-thumb contains an <img> with src

import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import puppeteer from 'puppeteer';

const BASE = process.env.BASE_URL || 'http://localhost:5174';
const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PORT = 8083;

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

  // Reset + seed
  await page.evaluate(() => {
    try { localStorage.removeItem('swr.mvm.project'); } catch (_) {}
  });
  await page.reload({ waitUntil: 'networkidle0' });
  await page.waitForFunction(() => !!window.MVM, { timeout: 20000, polling: 500 });

  // Add a real 1x1 red PNG as a clip
  await page.evaluate(async () => {
    const RED_PNG_1x1 = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='), (c) => c.charCodeAt(0));
    const blob = new Blob([RED_PNG_1x1], { type: 'image/png' });
    const file = new File([blob], 'red.png', { type: 'image/png' });
    const clip = await window.MVM.addClip(file);
    window.MVM.addToTimeline(clip.id);
  });

  await step('1. window.MVM.renderClipThumb exists + returns a dataURL', async () => {
    const v = await page.evaluate(async () => {
      const clip = window.MVM.project.clips[0];
      const dataUrl = await window.MVM.renderClipThumb(clip, 60, 40);
      return {
        exists: typeof window.MVM.renderClipThumb === 'function',
        hasDataUrl: !!dataUrl,
        isJpeg: dataUrl && dataUrl.indexOf('data:image/jpeg') === 0,
        length: dataUrl ? dataUrl.length : 0,
      };
    });
    ok(v.exists, 'renderClipThumb missing');
    ok(v.hasDataUrl, 'no dataURL returned');
    ok(v.isJpeg, `not a JPEG dataURL: ${v.dataUrl ? v.dataUrl.substring(0, 30) : 'null'}`);
    ok(v.length > 100, `dataURL suspiciously short: ${v.length}`);
  });

  await step('2. timeline rows have a .tl-thumb element', async () => {
    const v = await page.evaluate(() => {
      const rows = document.querySelectorAll('#timeline-list .mvm-timeline-row');
      let allHave = true;
      for (const r of rows) {
        if (!r.querySelector('.tl-thumb')) allHave = false;
      }
      return { rowCount: rows.length, allHave };
    });
    ok(v.rowCount === 1, `expected 1 row, got ${v.rowCount}`);
    ok(v.allHave, 'all rows must have a .tl-thumb');
  });

  await step('3. .tl-thumb gets an <img> once the async thumb resolves', async () => {
    // Wait up to 3s for the async renderClipThumb to populate the <img>
    let hasImg = false;
    for (let i = 0; i < 30; i++) {
      hasImg = await page.evaluate(() => {
        const row = document.querySelector('#timeline-list .mvm-timeline-row');
        if (!row) return false;
        const thumb = row.querySelector('.tl-thumb');
        if (!thumb) return false;
        const img = thumb.querySelector('img');
        return !!img && img.src && img.src.indexOf('data:image/jpeg') === 0;
      });
      if (hasImg) break;
      await new Promise((r) => setTimeout(r, 100));
    }
    ok(hasImg, '.tl-thumb <img> with JPEG dataURL never appeared');
  });

  await step('4. second call to renderClipThumb returns the same dimensions', async () => {
    const v = await page.evaluate(async () => {
      const clip = window.MVM.project.clips[0];
      const a = await window.MVM.renderClipThumb(clip, 100, 80);
      const b = await window.MVM.renderClipThumb(clip, 50, 30);
      // Different sizes should produce different dataURLs
      return { a: a ? a.substring(0, 30) : null, b: b ? b.substring(0, 30) : null, same: a === b };
    });
    ok(v.a && v.b, 'both dataURLs present');
    ok(!v.same, 'different sizes should produce different dataURLs');
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