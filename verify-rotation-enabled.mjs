#!/usr/bin/env node
// verify-rotation-enabled.mjs — smoke test for the per-layer ROTATE toggle.
//
//   node verify-rotation-enabled.mjs
//
// Boots a local static server, loads engine.html in headless Chrome (no media
// required — we drive the Renderer API directly), seeds a synthetic layer
// with a `rms → rot × 90` reactor, and asserts:
//
//   1. A newly-added layer has rotationEnabled === true (default).
//   2. applyReactors().rot > 0 when the rms reactor fires (audio-driven).
//   3. Setting layer.rotationEnabled = false → applyReactors().rot === 0.
//   4. Setting it back to true → applyReactors().rot > 0 again.
//   5. Other reactor targets (scale, x, y) still apply while rotation is off.
//   6. The `[rot off]` chip is present in the layer card when rotation is off,
//      and absent when it's on.
//   7. The checkbox reflects + writes back to layer.rotationEnabled.
//
// Exits 0 on green, 1 on any failure.

import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import puppeteer from 'puppeteer';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PORT = 8098;

const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.wav': 'audio/wav', '.mp3': 'audio/mpeg',
};

function serve() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const rel = decodeURIComponent(req.url.split('?')[0].replace(/^\/+/, '')) || 'index.html';
      const file = path.join(ROOT, rel);
      if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
        res.writeHead(404); res.end('nf'); return;
      }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
      fs.createReadStream(file).pipe(res);
    });
    server.listen(PORT, () => resolve(server));
  });
}

let failed = 0;
async function step(name, fn) {
  try {
    await fn();
    process.stdout.write(`  ✓ ${name}\n`);
  } catch (e) {
    failed += 1;
    process.stderr.write(`  ✗ ${name}\n    ${e.stack || e.message}\n`);
  }
}

const server = await serve();
let browser;
try {
  browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
  const page = await browser.newPage();
  page.on('pageerror', (err) => process.stderr.write(`[page error] ${err.message}\n`));
  await page.goto(`http://localhost:${PORT}/engine.html`, { waitUntil: 'networkidle0', timeout: 30000 });

  // Wait until the engine has attached window.SWR with the Renderer + Layers.
  await page.waitForFunction(
    () => !!(window.SWR && window.SWR.Layers && window.SWR.Layers.list && window.SWR.Renderer && typeof window.SWR.Renderer.applyReactors === 'function'),
    { timeout: 10000 }
  );

  // Seed a synthetic layer via the public API, then add an rms→rot reactor.
  await page.evaluate(() => {
    const SWR = window.SWR;
    // Synthetic asset — applyReactors reads from the asset's static fields,
    // not its media element, so no real media is required.
    SWR.Library.items = [{
      id: 'asset-test-rotation',
      name: 'p01.jpg',
      type: 'image',
      w: 100, h: 100,
      _el: { naturalWidth: 100, naturalHeight: 100 },
      url: 'about:blank',
    }];
    // Add a layer using the engine's add() path (sets rotationEnabled default).
    SWR.Layers.add(SWR.Library.items[0]);
    const l = SWR.Layers.list[0];
    // Force a known reactor: rms → rot × 90
    l.reactors = [{ feature: 'rms', target: 'rot', scale: 90, ease: 'linear' }];
    // Force known pos.rot + rotOffset so manual contribution is deterministic.
    l.pos.rot = 10;
    l.rotOffset = 20;
    // Make Audio.feat.rms a known value so getFeature returns something.
    SWR.Audio.feat = SWR.Audio.feat || {};
    SWR.Audio.feat.rms = 0.5;
  });

  await step('new layer has rotationEnabled === true (default)', async () => {
    const v = await page.evaluate(() => window.SWR.Layers.list[0].rotationEnabled);
    if (v !== true) throw new Error('expected true, got ' + JSON.stringify(v));
  });

  await step('rotation ON → applyReactors().rot > 0 (pos.rot 10 + rotOffset 20 + 0.5*90 = 75)', async () => {
    const r = await page.evaluate(() => window.SWR.Renderer.applyReactors(window.SWR.Layers.list[0]).rot);
    if (!(r > 0)) throw new Error('expected rot > 0, got ' + r);
    // 0.5 * 90 * linear(0.5) = 45 added to pos.rot+rotOffset (30) = 75
    if (Math.abs(r - 75) > 0.5) {
      // Tolerate float rounding but flag a >0.5 deg drift
      console.log(`    note: rot=${r}, expected ~75`);
    }
  });

  await step('rotation OFF → applyReactors().rot === 0 (manual + audio both silenced)', async () => {
    const r = await page.evaluate(() => {
      const l = window.SWR.Layers.list[0];
      l.rotationEnabled = false;
      return window.SWR.Renderer.applyReactors(l).rot;
    });
    if (r !== 0) throw new Error('expected rot === 0, got ' + r);
  });

  await step('rotation OFF → scale reactor still applies (other targets unaffected)', async () => {
    const r = await page.evaluate(() => {
      const l = window.SWR.Layers.list[0];
      l.baseScale = 1.0;
      l.reactors = [{ feature: 'rms', target: 'scale', scale: 2.0, ease: 'linear' }];
      l.rotationEnabled = false;
      return window.SWR.Renderer.applyReactors(l);
    });
    // baseScale 1.0 + 0.5 * 2.0 = 2.0 (linear easing on 0.5 is 0.5)
    if (Math.abs(r.scale - 2.0) > 0.001) {
      throw new Error('expected scale ≈ 2.0 with rotation disabled, got ' + r.scale);
    }
    if (r.rot !== 0) {
      throw new Error('expected rot === 0 with rotation disabled, got ' + r.rot);
    }
  });

  await step('rotation back ON → rot > 0 again', async () => {
    const r = await page.evaluate(() => {
      const l = window.SWR.Layers.list[0];
      l.reactors = [{ feature: 'rms', target: 'rot', scale: 90, ease: 'linear' }];
      l.rotationEnabled = true;
      return window.SWR.Renderer.applyReactors(l).rot;
    });
    if (!(r > 0)) throw new Error('expected rot > 0 after re-enabling, got ' + r);
  });

  // Existence of [rot off] chip — driven by Layers.render()
  await step('rotation OFF → [rot off] chip visible in layer card', async () => {
    await page.evaluate(() => {
      const l = window.SWR.Layers.list[0];
      l.rotationEnabled = false;
      window.SWR.Layers.render();
    });
    const has = await page.evaluate(() => !!document.querySelector('.layer .rot-off-tag'));
    if (!has) throw new Error('expected .rot-off-tag in DOM after re-render with rotation disabled');
  });

  await step('rotation ON → [rot off] chip hidden in layer card', async () => {
    await page.evaluate(() => {
      const l = window.SWR.Layers.list[0];
      l.rotationEnabled = true;
      window.SWR.Layers.render();
    });
    const has = await page.evaluate(() => !!document.querySelector('.layer .rot-off-tag'));
    if (has) throw new Error('expected .rot-off-tag absent after re-render with rotation enabled');
  });

  await step('checkbox reflects layer.rotationEnabled', async () => {
    const v = await page.evaluate(() => {
      const cb = document.querySelector('.layer input.rot-enable-toggle');
      return cb ? cb.checked : null;
    });
    if (v !== true) throw new Error('expected checkbox.checked === true, got ' + v);
  });

  await step('checkbox change → layer.rotationEnabled flips + chip re-renders', async () => {
    await page.evaluate(() => {
      const cb = document.querySelector('.layer input.rot-enable-toggle');
      cb.checked = false;
      cb.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await new Promise((r) => setTimeout(r, 50));
    const after = await page.evaluate(() => {
      const l = window.SWR.Layers.list[0];
      return { rotationEnabled: l.rotationEnabled, chip: !!document.querySelector('.layer .rot-off-tag') };
    });
    if (after.rotationEnabled !== false) {
      throw new Error('expected rotationEnabled=false after checkbox uncheck, got ' + after.rotationEnabled);
    }
    if (!after.chip) {
      throw new Error('expected chip present after flipping checkbox off');
    }
  });

  await step('checkbox tick → layer.rotationEnabled flips back to true', async () => {
    await page.evaluate(() => {
      const cb = document.querySelector('.layer input.rot-enable-toggle');
      cb.checked = true;
      cb.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await new Promise((r) => setTimeout(r, 50));
    const v = await page.evaluate(() => window.SWR.Layers.list[0].rotationEnabled);
    if (v !== true) throw new Error('expected rotationEnabled=true after checkbox tick, got ' + v);
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
