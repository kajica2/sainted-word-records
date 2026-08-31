#!/usr/bin/env node
// verify-collage-loads.mjs — end-to-end smoke: load the collage
// engine, confirm the library loads into the 6-panel grid, click
// the auto-start overlay to start audio, and assert at least one
// panel has a decoded library asset drawn to the stage.
//
// Regression test for the "media images and videos don't load when
// music starts playing in /versions" bug, scoped to collage. The
// page's <meta> + UI promise "drop clips + audio · beat-synced
// cuts" but the engine shipped without a library loader, so the
// 6 panels only ever painted synthetic patterns.
//
//   node verify-collage-loads.mjs
//
// Exits 0 on green, 1 on any failure.

import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import puppeteer from 'puppeteer';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PORT = 8095;

const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.gif': 'image/gif', '.wav': 'audio/wav', '.mp3': 'audio/mpeg',
  '.mp4': 'video/mp4', '.webm': 'video/webm',
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
  browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'],
  });
  const page = await browser.newPage();
  const consoleErrors = [];
  page.on('pageerror', (err) => consoleErrors.push('PE: ' + err.message));
  page.on('console', (msg) => { if (msg.type() === 'error') consoleErrors.push('CE: ' + msg.text()); });

  await page.setViewport({ width: 1280, height: 720 });
  await page.goto(`http://localhost:${PORT}/versions/collage.html`,
                  { waitUntil: 'domcontentloaded', timeout: 30000 });

  // ---- Static: confirm the library-loader script tag is shipped ----
  await step('collage.html includes client/library-loader.client.js', async () => {
    const html = fs.readFileSync(path.join(ROOT, 'versions/collage.html'), 'utf8');
    ok(html.includes('client/library-loader.client.js'),
      'versions/collage.html is missing the library-loader script tag — Lib will never populate');
  });

  // ---- Dynamic: library populates + panels pick assets ----
  await step('library populates after page load', async () => {
    // Wait up to 30s for Lib.items to be non-empty.
    let waited = 0;
    let libCount = 0;
    while (waited < 30000) {
      libCount = await page.evaluate(() => {
        // The fix must expose Lib on window for the loader to populate.
        // We accept either window.Lib or a module-scoped `Lib` (read via
        // a probe the fix installs). For the fix to be testable, we
        // require window.SWR.Library to be present.
        return (window.SWR && window.SWR.Library && window.SWR.Library.items)
          ? window.SWR.Library.items.length
          : 0;
      });
      if (libCount > 0) break;
      await new Promise((r) => setTimeout(r, 500));
      waited += 500;
    }
    ok(libCount > 0, `window.SWR.Library.items is empty after 30s — the library never loaded`);
  });

  // ---- Click overlay + wait for audio + check panels have assets ----
  await step('after click: at least 2 of 6 panels have a decoded asset', async () => {
    // Click the auto-start overlay to kick the audio.
    await page.evaluate(() => {
      const o = document.getElementById('swr-start');
      if (o) o.click();
    });
    // Give the engine a few seconds to assign items to panels.
    await new Promise((r) => setTimeout(r, 3000));
    const v = await page.evaluate(() => {
      const panels = window.SWR && window.SWR.collage_panels;
      if (!panels) return { panelsFound: 0, withAsset: 0, decoded: [], types: [], errors: ['window.SWR.collage_panels not exposed by engine'] };
      const list = Array.isArray(panels) ? panels : Array.from(panels);
      const decoded = list.map((p) => {
        if (!p || !p.asset) return -1;
        const el = p.asset._el;
        if (!el) return -1;
        if (p.asset.type === 'video') return el.readyState;
        return (el.complete && el.naturalWidth > 0) ? 4 : 0;
      });
      const types = list.map((p) => p && p.asset ? p.asset.type : null);
      return {
        panelsFound: list.length,
        withAsset: list.filter((p) => p && p.asset).length,
        decoded,
        types,
        errors: [],
      };
    });
    ok(v.panelsFound === 6, `expected 6 panels, got ${v.panelsFound} — fix must expose panels via window.SWR.collage_panels`);
    ok(v.withAsset >= 2, `expected >=2 panels to have an asset, got ${v.withAsset} — fix must assign Lib items to panels`);
    const ready = v.decoded.filter((d) => d >= 2).length;
    ok(ready >= 2, `expected >=2 panels to have decoded assets, decoded=[${v.decoded.join(',')}] types=[${v.types.join(',')}]`);
  });

  if (consoleErrors.length) {
    process.stderr.write('Console errors during run:\n');
    consoleErrors.forEach((e) => process.stderr.write('  ' + e + '\n'));
  }
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
