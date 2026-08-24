// verify-mvm-phase9.mjs — smoke for MVM Phase 9 (viz-toggle persistence).
//
//   BASE_URL=http://localhost:5174 node verify-mvm-phase9.mjs
//
// Asserts:
//   1. Default state: vizEnabled === true (no localStorage entry)
//   2. setVizEnabled(false) updates state + DOM checkbox + localStorage
//   3. After reload with localStorage '0', vizEnabled === false on init
//   4. After reload with localStorage '1', vizEnabled === true on init
//   5. The checkbox reflects the persisted value on init

import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import puppeteer from 'puppeteer';

const BASE = process.env.BASE_URL || 'http://localhost:5174';
const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PORT = 8079;

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

  // Reset both localStorage keys
  await page.evaluate(() => {
    try { localStorage.removeItem('swr.mvm.viz'); } catch (_) {}
    try { localStorage.removeItem('swr.mvm.project'); } catch (_) {}
  });
  await page.reload({ waitUntil: 'networkidle0' });
  await page.waitForFunction(() => !!window.MVM, { timeout: 20000, polling: 500 });

  await step('1. default state is vizEnabled=true when no localStorage entry', async () => {
    const v = await page.evaluate(() => ({
      enabled: window.MVM.vizEnabled,
      checked: document.getElementById('viz-toggle').checked,
    }));
    ok(v.enabled === true, `default vizEnabled should be true, got ${v.enabled}`);
    ok(v.checked === true, `default checkbox should be checked, got ${v.checked}`);
  });

  await step('2. setVizEnabled(false) updates state, DOM, and localStorage', async () => {
    const v = await page.evaluate(() => {
      window.MVM.setVizEnabled(false);
      return {
        enabled: window.MVM.vizEnabled,
        checked: document.getElementById('viz-toggle').checked,
        stored: localStorage.getItem('swr.mvm.viz'),
      };
    });
    ok(v.enabled === false, 'state should be false');
    ok(v.checked === false, 'checkbox should be unchecked');
    ok(v.stored === '0', `localStorage should be "0", got "${v.stored}"`);
  });

  await step('3. setVizEnabled(true) updates state, DOM, and localStorage', async () => {
    const v = await page.evaluate(() => {
      window.MVM.setVizEnabled(true);
      return {
        enabled: window.MVM.vizEnabled,
        checked: document.getElementById('viz-toggle').checked,
        stored: localStorage.getItem('swr.mvm.viz'),
      };
    });
    ok(v.enabled === true, 'state should be true');
    ok(v.checked === true, 'checkbox should be checked');
    ok(v.stored === '1', `localStorage should be "1", got "${v.stored}"`);
  });

  await step('4. after reload with viz="0", vizEnabled is false on init', async () => {
    await page.evaluate(() => { try { localStorage.setItem('swr.mvm.viz', '0'); } catch (_) {} });
    await page.reload({ waitUntil: 'networkidle0' });
    await page.waitForFunction(() => !!window.MVM, { timeout: 20000, polling: 500 });
    const v = await page.evaluate(() => ({
      enabled: window.MVM.vizEnabled,
      checked: document.getElementById('viz-toggle').checked,
    }));
    ok(v.enabled === false, `expected false, got ${v.enabled}`);
    ok(v.checked === false, `checkbox should be unchecked, got ${v.checked}`);
  });

  await step('5. after reload with viz="1", vizEnabled is true on init', async () => {
    await page.evaluate(() => { try { localStorage.setItem('swr.mvm.viz', '1'); } catch (_) {} });
    await page.reload({ waitUntil: 'networkidle0' });
    await page.waitForFunction(() => !!window.MVM, { timeout: 20000, polling: 500 });
    const v = await page.evaluate(() => ({
      enabled: window.MVM.vizEnabled,
      checked: document.getElementById('viz-toggle').checked,
    }));
    ok(v.enabled === true, `expected true, got ${v.enabled}`);
    ok(v.checked === true, `checkbox should be checked, got ${v.checked}`);
  });

  await step('6. clicking the checkbox writes to localStorage', async () => {
    const v = await page.evaluate(() => {
      const cb = document.getElementById('viz-toggle');
      cb.checked = false;
      cb.dispatchEvent(new Event('change', { bubbles: true }));
      return {
        enabled: window.MVM.vizEnabled,
        stored: localStorage.getItem('swr.mvm.viz'),
      };
    });
    ok(v.enabled === false, 'state should be false after click');
    ok(v.stored === '0', `localStorage should be "0", got "${v.stored}"`);
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