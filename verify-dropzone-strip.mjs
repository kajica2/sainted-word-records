#!/usr/bin/env node
// verify-dropzone-strip.mjs — confirms every gallery has the universal
// dropzone strip + script, and a synthetic file drop triggers the curator
// pipeline + emits swr:drop with results[].
import puppeteer from 'puppeteer';
import http from 'node:http';
import { spawn } from 'node:child_process';
import fs from 'node:fs';

const PORT = 53919;
const BASE = `http://127.0.0.1:${PORT}`;
const OUT = '/Users/kaidejuricmasscmbook/.hermes/scratch';
fs.mkdirSync(OUT, { recursive: true });

const GALLERIES = [
  'gallery-ai', 'gallery-albums', 'gallery-artist', 'gallery-bachdrop',
  'gallery-bio', 'gallery-brutalist', 'gallery-cosmic', 'gallery-darkfuture',
  'gallery-generative', 'gallery-glyphs', 'gallery-loops', 'gallery-music',
  'gallery-photoexp', 'gallery-point4brand', 'gallery-posters', 'gallery-tshirts',
  'gallery-videofx', 'gallery-vintage', 'gallery-vr',
];

const checks = [];
const pass = (m) => { checks.push({ ok: true, m }); console.log('✓', m); };
const fail = (m) => { checks.push({ ok: false, m }); console.log('✗', m); };

function startServer() {
  return new Promise((resolve, reject) => {
    const proc = spawn('python3', ['-m', 'http.server', String(PORT)], {
      cwd: process.cwd() + '/dist', stdio: 'ignore',
    });
    const start = Date.now();
    const tick = () => {
      http.get(`${BASE}/gallery-ai.html`, (res) => {
        res.resume();
        if (res.statusCode === 200) return resolve(proc);
        if (Date.now() - start > 8000) return reject(new Error('server timeout'));
        setTimeout(tick, 100);
      }).on('error', () => {
        if (Date.now() - start > 8000) return reject(new Error('server error'));
        setTimeout(tick, 80);
      });
    };
    setTimeout(tick, 100);
  });
}

(async () => {
  let server;
  try { server = await startServer(); } catch (e) { fail('server: ' + e.message); process.exit(1); }

  // Real 32x32 white PNG so the curator actually runs chroma-key
  const pngB64 = 'iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAAGklEQVR42mP8/5+hngEJMI4CfAGH0QERmAAAAABJRU5ErkJggg==';
  fs.writeFileSync('/tmp/swr-test-32white.png', Buffer.from(pngB64, 'base64'));

  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
  });

  for (const slug of GALLERIES) {
    const url = `${BASE}/${slug}.html`;
    let page;
    try {
      page = await browser.newPage();
      await page.setViewport({ width: 1280, height: 1000 });
      const errs = [];
      page.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
      page.on('console', (m) => { if (m.type() === 'error') errs.push('console: ' + m.text()); });

      await page.goto(url, { waitUntil: 'networkidle0', timeout: 15000 });
      // Wait for dropzone + curator to load
      await page.waitForFunction(() => window.SWR && window.SWR.Dropzone, { timeout: 5000 }).catch(() => {});

      // Inject curator so PNG routes through chroma-key path
      await page.addScriptTag({ path: 'dist/client/asset-curator.client.js' }).catch(() => {});

      const dom = await page.evaluate(() => ({
        stripPresent: !!document.querySelector('.dropzone-strip'),
        summaryPresent: !!document.querySelector('.dropzone-strip summary'),
        dropzoneMarked: !!document.querySelector('.dropzone-strip .swr-dropzone'),
        scriptLoaded: Array.from(document.scripts).some((s) => s.src.includes('dropzone')),
      }));

      if (dom.stripPresent && dom.dropzoneMarked && dom.scriptLoaded) {
        pass(`${slug}: dropzone strip + script + markup all present`);
      } else {
        fail(`${slug}: strip=${dom.stripPresent} marked=${dom.dropzoneMarked} script=${dom.scriptLoaded}`);
        await page.close();
        continue;
      }

      // Open the <details> so the dropzone is visible
      await page.evaluate(() => {
        document.querySelector('.dropzone-strip details')?.setAttribute('open', '');
      });
      await new Promise((r) => setTimeout(r, 200));

      // Synthesize a file drop and confirm swr:drop event fires with curator result
      await page.evaluate(async () => {
        // Read the test PNG from a known location via fetch — actually we already
        // injected curator; the dropzone.client.js processBatch will call curator.
        // Use a synthetic PNG via base64.
        const b64 = 'iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAAGklEQVR42mP8/5+hngEJMI4CfAGH0QERmAAAAABJRU5ErkJggg==';
        const bin = atob(b64); const u8 = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
        const f = new File([u8], 'test-32white.png', { type: 'image/png' });
        const dt = new DataTransfer();
        dt.items.add(f);
        window.__dropEvents = [];
        document.addEventListener('swr:drop', (e) => window.__dropEvents.push(e.detail));
        const dz = document.querySelector('.dropzone-strip .swr-dropzone');
        dz.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt }));
        await new Promise((r) => setTimeout(r, 1500));
      });

      const drop = await page.evaluate(() => ({
        eventCount: window.__dropEvents?.length || 0,
        firstResult: window.__dropEvents?.[0]?.results?.[0] || null,
        chipCount: document.querySelectorAll('.dropzone-strip .swr-dropzone__chip').length,
      }));

      if (drop.eventCount === 1 && drop.firstResult) {
        pass(`${slug}: drop fired swr:drop with status=${drop.firstResult.status}`);
      } else {
        fail(`${slug}: drop fired ${drop.eventCount} events, no result`);
      }

      if (drop.chipCount === 1) pass(`${slug}: chip rendered for the dropped file`);
      else fail(`${slug}: ${drop.chipCount} chips`);

      if (errs.length === 0) pass(`${slug}: no JS errors`);
      else fail(`${slug}: ${errs.length} JS errors (${errs.slice(0, 2).join(' | ')})`);

      await page.close();
    } catch (e) {
      fail(`${slug}: ${e.message}`);
      if (page) await page.close();
    }
  }

  await browser.close();
  if (server) try { process.kill(server.pid, 'SIGTERM'); } catch (_) {}

  const passed = checks.filter((c) => c.ok).length;
  console.log('');
  console.log('────────────────');
  console.log(`Dropzone-strip sweep: ${passed}/${checks.length} checks passed`);
  if (passed !== checks.length) process.exit(1);
  console.log('OK');
})();