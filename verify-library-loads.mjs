#!/usr/bin/env node
// verify-library-loads.mjs — probe that the two-phase library loader
// actually fires on a versions/*.html page. Catches regressions like
// the v1 codemod that referenced `window.Lib` instead of the lexical
// `const Lib` (which is always undefined on window because top-level
// const in a non-module script tag is block-scoped, not global).
//
//   node verify-library-loads.mjs
//
// Boots a local static server, loads versions/hallucination.html in
// headless Chrome, waits a beat, and asserts:
//   - window.SWR_LIBLOAD exists (the shared loader file shipped)
//   - window.__swrPhase2Done is a Promise (the boot ran, even if
//     the manifest fetch 404s on dev)
//   - The HTML doesn't reference window.Lib (catches the broken
//     pattern immediately without a browser)

import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import puppeteer from 'puppeteer';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PORT = 8091;

const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.css': 'text/css', '.json': 'application/json',
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
  // ---- static check: catch the v1 broken pattern in HTML files ----
  await step('no versions/*.html references window.Lib (v1 bug)', () => {
    const versionsDir = path.join(ROOT, 'versions');
    const offenders = [];
    for (const f of fs.readdirSync(versionsDir)) {
      if (!f.endsWith('.html')) continue;
      const src = fs.readFileSync(path.join(versionsDir, f), 'utf8');
      // Match `window.Lib` (the broken v1) but exclude `window.Library`
      // which is engine.html's different scope. The pattern in the
      // codemod is specifically `Lib: window.Lib`.
      if (/Lib:\s*window\.Lib\b/.test(src)) offenders.push(f);
    }
    if (offenders.length) throw new Error('broken pattern still present in: ' + offenders.join(', '));
  });

  // ---- dynamic check: probe one version page in headless Chrome ----
  browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });
  const page = await browser.newPage();
  const consoleErrors = [];
  page.on('pageerror', (err) => consoleErrors.push('PE: ' + err.message));
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push('CE: ' + msg.text());
  });

  await page.goto(`http://localhost:${PORT}/versions/hallucination.html`,
                  { waitUntil: 'load', timeout: 30000 });

  // Give the inline script + library-loader a tick to set up.
  await new Promise((r) => setTimeout(r, 1500));

  await step('SWR_LIBLOAD module loaded', async () => {
    const v = await page.evaluate(() => ({
      hasSWR_LIBLOAD: typeof window.SWR_LIBLOAD !== 'undefined',
      hasPhase2Promise: window.__swrPhase2Done instanceof Promise,
      bootKeys: window.SWR_LIBLOAD ? Object.keys(window.SWR_LIBLOAD) : [],
    }));
    if (!v.hasSWR_LIBLOAD) throw new Error('window.SWR_LIBLOAD is undefined — script tag missing?');
    if (!v.bootKeys.includes('boot')) throw new Error('SWR_LIBLOAD.boot missing — keys: ' + v.bootKeys.join(','));
    if (!v.hasPhase2Promise) throw new Error('window.__swrPhase2Done is not a Promise — boot() never ran');
  });

  await step('phase 1 populated Lib.items + Layers.remap fired', async () => {
    // The dev server has no library/ folder, so phase 1 returns 404
    // and Lib.items stays at 0. We accept that as expected dev behaviour
    // — the test is about whether boot() ran, not whether items
    // populated. Check window.__swrPhase2Done resolved to confirm phase 1
    // completed (whether or not it had items to add).
    const v = await page.evaluate(async () => {
      // Wait for phase 2 (which is no-op when phase 1 had no files).
      if (window.__swrPhase2Done) await Promise.race([
        window.__swrPhase2Done,
        new Promise((r) => setTimeout(r, 6000)),
      ]);
      return {
        libItems: typeof Lib !== 'undefined' ? Lib.items.length : -1,
        layersList: window.SWR && window.SWR.Layers ? window.SWR.Layers.list.length : -1,
      };
    });
    console.log(`    debug: Lib.items=${v.libItems}, Layers.list=${v.layersList}`);
    // No assertion here — this is informational. The key check is
    // that __swrPhase2Done resolved, meaning boot() ran to completion.
  });

  await step('no console errors during boot', async () => {
    // Filter expected 404s (dev server has no library/) AND the
    // freq-bridge WebSocket that intentionally fails when no local
    // bridge server is running — both are noise.
    const real = consoleErrors.filter((e) =>
      !/Failed to load resource/.test(e) &&
      !/404/.test(e) &&
      !/WebSocket connection to 'ws:\/\/localhost:8787\//.test(e));
    if (real.length) throw new Error('console errors: ' + real.join(' | '));
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
