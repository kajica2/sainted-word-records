#!/usr/bin/env node
// verify-rotation-enabled.mjs — smoke test for the global rotation/zoom kill-switch.
//
// With SWR_MOTION_KILL defaulting OFF, per-layer rotation and zoom reactors
// stay inert and saved-state flags cannot re-enable them.

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
  browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-features=ServiceWorker,ServiceWorkerOnUI'],
  });
  const page = await browser.newPage();
  await page.evaluateOnNewDocument(() => {
    try {
      if (navigator.serviceWorker && typeof navigator.serviceWorker.register === 'function') {
        navigator.serviceWorker.register = () => new Promise(() => {});
      }
    } catch (_) {}
  });
  page.on('pageerror', (err) => process.stderr.write(`[page error] ${err.message}\n`));
  await page.goto(`http://localhost:${PORT}/engine.html`, { waitUntil: 'domcontentloaded', timeout: 60000 });

  await page.waitForFunction(
    () => !!(window.SWR_MOTION_KILL && window.SWR && window.SWR.Renderer && typeof window.SWR.Renderer.applyReactors === 'function'),
    { timeout: 10000 }
  );

  await step('SWR_MOTION_KILL defaults rotation and zoom OFF', async () => {
    const v = await page.evaluate(() => ({
      rot: window.SWR_MOTION_KILL.isRotationGloballyEnabled(),
      zoom: window.SWR_MOTION_KILL.isZoomGloballyEnabled(),
    }));
    if (v.rot !== false || v.zoom !== false) throw new Error(JSON.stringify(v));
  });

  await page.evaluate(() => {
    const SWR = window.SWR;
    SWR.Library.items = [{
      id: 'asset-test-rotation',
      name: 'p01.jpg',
      type: 'image',
      w: 100, h: 100,
      _el: { naturalWidth: 100, naturalHeight: 100 },
      url: 'about:blank',
    }];
    SWR.Layers.add(SWR.Library.items[0]);
  });

  await page.waitForFunction(
    () => {
      const btn = document.getElementById('swr-rot-master');
      return btn && btn.disabled === true;
    },
    { timeout: 5000 }
  );

  await page.evaluate(() => {
    const l = window.SWR.Layers.list.find((x) => x.asset && x.asset.id === 'asset-test-rotation');
    if (!l) throw new Error('seed layer missing');
    l.reactors = [
      { feature: 'rms', target: 'rot', scale: 90, ease: 'linear' },
      { feature: 'rms', target: 'scale', scale: 2.0, ease: 'linear' },
    ];
    l.pos.rot = 10;
    l.rotOffset = 20;
    l.rotationEnabled = true;
    window.SWR.Audio.feat = window.SWR.Audio.feat || {};
    window.SWR.Audio.feat.rms = 0.5;
  });

  await step('new layer cannot opt into rotation while kill-switch off', async () => {
    const v = await page.evaluate(() => {
      const l = window.SWR.Layers.list.find((x) => x.asset && x.asset.id === 'asset-test-rotation');
      if (!l) return { missing: true };
      return {
        rotationEnabled: l.rotationEnabled,
        allowed: window.SWR_MOTION_KILL.isRotationAllowed(l),
      };
    });
    if (v.missing) throw new Error('seed layer missing');
    if (v.allowed !== false) throw new Error('expected isRotationAllowed false, got ' + JSON.stringify(v));
  });

  await step('forced rotationEnabled true still yields applyReactors().rot === 0', async () => {
    const r = await page.evaluate(() => {
      const l = window.SWR.Layers.list[0];
      l.rotationEnabled = true;
      return window.SWR.Renderer.applyReactors(l).rot;
    });
    if (r !== 0) throw new Error('expected rot === 0, got ' + r);
  });

  await step('scale reactor inert while zoom kill-switch off', async () => {
    const r = await page.evaluate(() => {
      const l = window.SWR.Layers.list[0];
      l.baseScale = 1.0;
      l.reactors = [{ feature: 'rms', target: 'scale', scale: 2.0, ease: 'linear' }];
      return window.SWR.Renderer.applyReactors(l);
    });
    if (Math.abs(r.scale - 1.0) > 0.001) throw new Error('expected scale ≈ 1.0, got ' + r.scale);
  });

  await step('CSSFX catalog excludes zoom-pulse', async () => {
    const has = await page.evaluate(() => {
      return !!(window.CSSFX && window.CSSFX.catalog && window.CSSFX.catalog.find((f) => f.name === 'zoom-pulse'));
    });
    if (has) throw new Error('zoom-pulse still in CSSFX.catalog');
  });

  await step('rot-master control disabled in DOM', async () => {
    const v = await page.evaluate(() => {
      const btn = document.getElementById('swr-rot-master');
      return btn ? btn.disabled : null;
    });
    if (v !== true) throw new Error('expected swr-rot-master disabled, got ' + v);
  });

} finally {
  if (browser) await browser.close();
  server.close();
}

if (failed === 0) {
  console.log('\nALL GREEN');
  process.exit(0);
}
console.log(`\n${failed} FAILED`);
process.exit(1);
