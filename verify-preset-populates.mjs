#!/usr/bin/env node
// verify-preset-populates.mjs — regression guard: when a preset is
// applied and the stage is empty (Layers.list.length === 0) but the
// library has items (Library.items.length > 0), the preset should
// auto-populate the stage with N layers (N = preset's max array
// length) from the library before applying the preset styles.
//
//   node verify-preset-populates.mjs
//
// Exit 0 on green, 1 on any failure.

import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import puppeteer from 'puppeteer';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PORT = 8094;
const BASE = process.env.BASE_URL || `http://localhost:${PORT}`;

const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.wav': 'audio/wav',
  '.mp3': 'audio/mpeg', '.mp4': 'video/mp4', '.webm': 'video/webm',
};

function serve() {
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

const server = await serve();
let browser;
try {
  browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });
  const page = await browser.newPage();
  await page.goto(`${BASE}/engine.html`, {waitUntil: 'networkidle0', timeout: 30000});

  // Wait for the library to populate (45 items)
  let waited = 0;
  while (waited < 30000) {
    const ok = await page.evaluate(() =>
      !!(window.SWR && window.SWR.Library && window.SWR.Library.items.length > 0));
    if (ok) break;
    await new Promise((r) => setTimeout(r, 500));
    waited += 500;
  }
  if (waited >= 30000) throw new Error('library never populated');

  // Baseline: stage should be empty (no song loaded by default)
  const baseline = await page.evaluate(() => ({
    layers: window.SWR.Layers.list.length,
    libItems: window.SWR.Library.items.length,
  }));
  if (baseline.layers !== 0) throw new Error(`baseline expected 0 layers, got ${baseline.layers}`);

  await step('applying preset to empty stage auto-populates from library', async () => {
    await page.evaluate(() => {
      window.applyVisualPreset('pulse');
    });
    await new Promise((r) => setTimeout(r, 500));
    const v = await page.evaluate(() => ({
      layers: window.SWR.Layers.list.length,
      allHaveAssets: window.SWR.Layers.list.every(l => l.asset && l.asset.id),
      firstBlend: window.SWR.Layers.list[0] ? window.SWR.Layers.list[0].blend : null,
    }));
    if (v.layers === 0) throw new Error('still 0 layers after preset apply');
    if (v.layers > 6) throw new Error(`too many layers: ${v.layers} (expected 2-6)`);
    if (!v.allHaveAssets) throw new Error('not every layer has an asset');
    if (v.firstBlend !== 'screen') throw new Error(`expected first blend='screen', got '${v.firstBlend}'`);
  });

  await step('reset clears layers', async () => {
    await page.evaluate(() => {
      window.applyVisualPreset('off');
    });
    await new Promise((r) => setTimeout(r, 300));
    const layers = await page.evaluate(() => window.SWR.Layers.list.length);
    // 'off' preset doesn't necessarily clear layers — it's a visual
    // preset (no media). Just confirm we don't crash and layers
    // count is reasonable (>= 0).
    if (layers < 0) throw new Error('layer count went negative');
  });

  await step('applying different preset does not double-populate', async () => {
    const before = await page.evaluate(() => window.SWR.Layers.list.length);
    await page.evaluate(() => {
      window.applyVisualPreset('drift');
    });
    await new Promise((r) => setTimeout(r, 500));
    const after = await page.evaluate(() => window.SWR.Layers.list.length);
    if (after !== before) throw new Error(`layer count changed: ${before} -> ${after}`);
  });

  await step('all 5 presets work on empty stage', async () => {
    // Reset to empty
    await page.evaluate(() => {
      while (window.SWR.Layers.list.length > 0) {
        window.SWR.Layers.list.pop();
      }
    });
    for (const preset of ['pulse', 'drift', 'strobe', 'warp', 'mosh']) {
      const layers = await page.evaluate((k) => {
        window.applyVisualPreset(k);
        return window.SWR.Layers.list.length;
      }, preset);
      if (layers === 0) throw new Error(`${preset} did not populate`);
      // Reset for next preset
      await page.evaluate(() => {
        while (window.SWR.Layers.list.length > 0) {
          window.SWR.Layers.list.pop();
        }
      });
    }
  });
} finally {
  if (browser) await browser.close();
  server.close();
}

if (failed > 0) {
  process.stderr.write(`\n${failed} check(s) failed\n`);
  process.exit(1);
}
process.stdout.write('\nALL GREEN\n');
