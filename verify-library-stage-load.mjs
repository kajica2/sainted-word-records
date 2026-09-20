#!/usr/bin/env node
// verify-library-stage-load.mjs — regression test for the "library item
// shows in the grid but doesn't load on stage" bug.
//
//   node verify-library-stage-load.mjs
//
// The bug: engine.html:5018 created the stage <img> with `a._el.src =
// a.url` and no onerror handler. If the blob URL was revoked (quota
// eviction, removeItem-then-undo race, etc.), `a._el.complete` stayed
// false forever and the stage silently drew nothing — no error toast,
// no console message, just a blank canvas.
//
// The fix added an onerror handler that retries with a fresh blob URL
// from `a.blob`, and surfaces a `setStatus('media failed to load …')`
// toast if the retry also fails. This verify-script exercises both
// paths:

//   1. Happy path: synthetic asset with a valid blob URL loads on the
//      stage (a._el.complete becomes true; no error toast).
//   2. Retry path: asset with a now-broken `a.url` but valid `a.blob`
//      triggers the onerror handler, which rebuilds the URL from
//      `a.blob` and recovers.
//   3. Surface path: asset with broken URL AND null `a.blob` shows
//      a 'media blob missing' status toast so the user knows the
//      asset is broken.
//
// Headless Chrome (auto-grants autoplay permissions).

import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import puppeteer from 'puppeteer';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PORT = 8092;

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
  try { await fn(); console.log('  ✓ ' + name); }
  catch (e) { failed++; console.error('  ✗ ' + name + ': ' + (e.message || e)); }
}

async function main() {
  const server = await serve();
  let browser;
  try {
    browser = await puppeteer.launch({
      headless: 'new',
      args: ['--no-sandbox', '--disable-setuid-sandbox',
             '--autoplay-policy=no-user-gesture-required'],
    });
    const page = await browser.newPage();
    page.on('console', (m) => {
      if (m.type() !== 'error') return;
      const t = m.text();
      if (/WebSocket|ERR_CONNECTION_REFUSED|net::ERR_/.test(t)) return;
      console.error('  [console error]', t.slice(0, 200));
    });
    page.on('pageerror', (e) => console.error('  [pageerror]', e.message));

    await page.goto(`http://localhost:${PORT}/engine.html`,
                    { waitUntil: 'networkidle0', timeout: 30000 });
    await new Promise((r) => setTimeout(r, 1500));

    // Build a real 64x64 PNG blob so a.blob is a usable Blob reference.
    // Then construct three library items in JS-injected state:
    //   A. Valid item (happy path)
    //   B. Broken URL but valid blob (retry path — exercises onerror)
    //   C. Broken URL and null blob (surface path — exercises setStatus)
    const seed = await page.evaluate(async () => {
      // Make a tiny PNG (red 64×64) via canvas → blob
      const c = document.createElement('canvas');
      c.width = 64; c.height = 64;
      const cx = c.getContext('2d');
      cx.fillStyle = '#ff3030'; cx.fillRect(0, 0, 64, 64);
      const blob = await new Promise((res) => c.toBlob(res, 'image/png'));
      const validUrl = URL.createObjectURL(blob);

      const items = [
        {
          id: 'happy-1', name: 'happy.png', type: 'image',
          blob, url: validUrl, thumb: null,
          motion: 0, luma: 0, hue: 0, w: 64, h: 64, rotation: 0,
        },
        {
          id: 'retry-1', name: 'retry.png', type: 'image',
          blob, url: validUrl, thumb: null,                    // start with valid URL
          _revokedUrl: null,                                  // will be set after URL.revokeObjectURL
          motion: 0, luma: 0, hue: 0, w: 64, h: 64, rotation: 0,
        },
        {
          id: 'surface-1', name: 'surface.png', type: 'image',
          blob: null, url: validUrl, thumb: null,             // start with valid URL but null blob
          _revokedUrl: null,
          motion: 0, luma: 0, hue: 0, w: 64, h: 64, rotation: 0,
        },
      ];

      // For retry-1 and surface-1: keep a backup URL we'll revoke after
      // the layer is added, so the onerror handler fires with a real
      // (not synthetic-invalid) URL.
      const retryBackupUrl = validUrl;
      // Make a separate valid URL for surface-1 since we'll revoke it.
      const surfaceBackupUrl = URL.createObjectURL(blob);
      items[1].url = retryBackupUrl;
      items[2].url = surfaceBackupUrl;
      items[1]._revokedUrl = retryBackupUrl;
      items[2]._revokedUrl = surfaceBackupUrl;

      // Push into Library.items directly (bypass the boot IDB rehydration)
      if (window.Library) {
        for (const it of items) window.Library.items.push(it);
        if (typeof window.Library.render === 'function') window.Library.render();
      }

      // Capture status pill element for assertions
      const statusEl = document.getElementById('status-pill');
      return { hasLibrary: !!window.Library, itemsCount: items.length, hasStatus: !!statusEl };
    });
    if (!seed.hasLibrary) throw new Error('Library not present on page');

    // ---- 1. Happy path: add the valid item as a layer and verify _el.complete ----
    await step('happy path: valid asset loads on stage', async () => {
      await page.evaluate(() => {
        if (window.Layers && window.Layers.add) {
          const valid = window.Library.items.find((it) => it.id === 'happy-1');
          if (valid) window.Layers.add(valid);
        }
      });
      // Give the image time to decode
      await new Promise((r) => setTimeout(r, 500));
      const complete = await page.evaluate(() => {
        const l = window.Layers && window.Layers.list && window.Layers.list[0];
        return !!(l && l.asset && l.asset._el && l.asset._el.complete && l.asset._el.naturalWidth > 0);
      });
      if (!complete) throw new Error('happy asset not loaded on stage');
    });

    // ---- 2. Retry path: valid URL, then revoke it after layer added ----
    // Simulates a real scenario: the item is added, _el loads OK, but
    // then the URL gets revoked (e.g. another part of the code calls
    // URL.revokeObjectURL). On the next drawLayer call, the Image has
    // src=revoked-url. We then re-set src from a.blob to recover.
    await step('retry path: revoked URL + valid blob recovers', async () => {
      // Add the layer with a valid URL — it loads fine.
      await page.evaluate(() => {
        const sp = document.getElementById('status-pill');
        if (sp) { sp.textContent = ''; sp.className = ''; }
        if (window.Layers && window.Layers.add) {
          const retry = window.Library.items.find((it) => it.id === 'retry-1');
          if (retry) window.Layers.add(retry);
        }
      });
      await new Promise((r) => setTimeout(r, 400));
      // Now corrupt the asset's _el by reassigning src to the revoked URL
      await page.evaluate(() => {
        const item = window.Library.items.find((it) => it.id === 'retry-1');
        if (item && item._el) {
          // Force the next drawLayer call to hit onerror by reassigning
          // src to a known-bad URL. The browser will fire onerror.
          URL.revokeObjectURL(item.url);
          item._el.src = 'about:blank';
          // Trigger onerror synchronously: setting src to something that
          // fails. The browser blocks blob: invalid URLs as security
          // exceptions, so use a non-existent http URL instead.
          item._el.src = 'http://127.0.0.1:1/__definitely_not_a_real_url__';
        }
      });
      // Wait for onerror to fire + retry
      await new Promise((r) => setTimeout(r, 1500));
      const urlChanged = await page.evaluate(() => {
        const item = window.Library.items.find((it) => it.id === 'retry-1');
        // Recovery swaps the URL via a.url = freshUrl. After swap, the
        // URL is no longer the http://127.0.0.1 invalid URL.
        return !!(item && item.url && item.url.startsWith('blob:') && item.url !== item._revokedUrl);
      });
      if (!urlChanged) throw new Error('retry did not rebuild URL from a.blob');
      // Status pill should NOT show 'failed to load' toast (retry succeeded)
      const status = await page.evaluate(() =>
        document.getElementById('status-pill') ? document.getElementById('status-pill').textContent : '');
      if (/failed to load|blob missing/i.test(status)) {
        throw new Error('status shows error despite successful retry: ' + status);
      }
    });

    // ---- 3. Surface path: valid URL, then revoke AND null out blob ----
    await step('surface path: null blob shows error toast', async () => {
      await page.evaluate(() => {
        const sp = document.getElementById('status-pill');
        if (sp) { sp.textContent = ''; sp.className = ''; }
        if (window.Layers && window.Layers.add) {
          const surface = window.Library.items.find((it) => it.id === 'surface-1');
          if (surface) window.Layers.add(surface);
        }
      });
      await new Promise((r) => setTimeout(r, 400));
      await page.evaluate(() => {
        const item = window.Library.items.find((it) => it.id === 'surface-1');
        if (item) {
          // Corrupt both: revoke URL + null out blob
          try { URL.revokeObjectURL(item.url); } catch (_) {}
          item.blob = null;
          if (item._el) {
            // Trigger onerror with a bad URL — the handler will then
            // see item.blob is null and surface the toast.
            item._el.src = 'http://127.0.0.1:1/__definitely_not_a_real_url__';
          }
        }
      });
      await new Promise((r) => setTimeout(r, 1500));
      const status = await page.evaluate(() => {
        const sp = document.getElementById('status-pill');
        return sp ? sp.textContent + '|' + sp.className : null;
      });
      if (!status || !/blob missing|failed to load/i.test(status)) {
        throw new Error('expected error toast, got: ' + status);
      }
    });

  } finally {
    if (browser) await browser.close();
    server.close();
  }

  if (failed > 0) {
    console.error('\nLIBRARY-STAGE-LOAD VERIFY: ' + failed + ' step(s) failed');
    process.exit(1);
  }
  console.log('\nLIBRARY-STAGE-LOAD VERIFY: ALL GREEN');
}

main().catch((e) => {
  console.error('FATAL:', e);
  process.exit(1);
});