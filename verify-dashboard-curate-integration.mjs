#!/usr/bin/env node
// verify-dashboard-curate-integration.mjs — end-to-end test for the
// dashboard's "Curate Library" button. Validates that:
//   1. SWR_ASSET_CURATOR is wired into the dashboard's curator panel
//   2. Clicking the button processes each file in the user library
//   3. The results table shows folder + tag + status per file
//
// Follows verify-asset-curator.mjs (runtime validation) with a real
// UI integration check.

import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import puppeteer from 'puppeteer';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PORT = 8216;
const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml',
};

function localServe() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const rel = decodeURIComponent(req.url.split('?')[0].replace(/^\/+/, '')) || 'dashboard.html';
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

function ok(label) { console.log(`  \u2713 ${label}`); }
function fail(label, msg) { console.log(`  \u2717 ${label}: ${msg}`); process.exitCode = 1; }

async function run() {
  const server = await localServe();
  let browser;
  try {
    browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
    const page = await browser.newPage();
    const errors = [];
    page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
    page.on('pageerror', e => errors.push(String(e)));

    await page.goto(`http://localhost:${PORT}/dashboard.html`, { waitUntil: 'networkidle2' });
    await new Promise(r => setTimeout(r, 1500));

    // Seed the user library with two synthetic PNGs (different
    // shapes so the curator tags them differently).
    await page.evaluate(async () => {
      async function makeFile(name, drawFn) {
        var c = document.createElement('canvas');
        c.width = 64; c.height = 64;
        var ctx = c.getContext('2d');
        drawFn(ctx);
        var blob = await new Promise(function (resolve) { c.toBlob(resolve, 'image/png'); });
        return new File([blob], name, { type: 'image/png' });
      }
      function whiteSquare(ctx) {
        ctx.fillStyle = '#FFFFFF'; ctx.fillRect(0, 0, 64, 64);
        ctx.fillStyle = '#000000'; ctx.fillRect(16, 16, 32, 32);
      }
      function blackSquare(ctx) {
        ctx.fillStyle = '#000000'; ctx.fillRect(0, 0, 64, 64);
      }
      var f1 = await makeFile('gift-bag-1.png', whiteSquare);
      var f2 = await makeFile('icon-foo.png', function (ctx) {
        // 32x32 white bg + 32x32 black — matches 'icon' rule (square aspect <= 256)
        ctx.fillStyle = '#FFFFFF'; ctx.fillRect(0, 0, 64, 64);
        ctx.fillStyle = '#000000'; ctx.fillRect(16, 16, 32, 32);
      });
      await window.SWR_MEDIA.deleteAll();
      await window.SWR_MEDIA.addMedia([f1, f2]);
    });

    // 1. Curate button exists
    const curateBtnExists = await page.evaluate(() => !!document.getElementById('dash-curate-btn'));
    if (curateBtnExists) ok('Curate button rendered in dashboard curator panel');
    else fail('Curate button', 'not in DOM');

    // 2. Click → modal opens with results table
    await page.evaluate(() => document.getElementById('dash-curate-btn').click());
    await new Promise(r => setTimeout(r, 1500));
    const modal = await page.evaluate(() => {
      var m = document.getElementById('dash-curate-modal');
      if (!m) return null;
      var rows = Array.from(m.querySelectorAll('tr')).slice(1); // skip header
      return {
        exists: true,
        rowCount: rows.length,
        rows: rows.map(r => Array.from(r.querySelectorAll('td')).map(td => td.textContent.trim())),
      };
    });
    if (modal && modal.exists && modal.rowCount >= 2) {
      ok(`Curate modal opened with ${modal.rowCount} rows`);
    } else {
      fail('Curate modal', JSON.stringify(modal));
      return;
    }

    // 3. Each row has folder + tag + status
    const allRowsHaveData = modal.rows.every(r =>
      r.length >= 4 && r[0].length > 0 && r[1].length > 0 && r[2].length > 0 && r[3].length > 0
    );
    if (allRowsHaveData) ok('Every row has file/folder/tag/status');
    else fail('Row data', JSON.stringify(modal.rows));

    // 4. At least one row has a known folder
    var validFolders = ['gift-bags', 'transparent-pngs', 'characters', 'creatures', 'nature', 'food', 'objects', 'uncategorized'];
    var hasKnownFolder = modal.rows.some(r => validFolders.includes(r[1]));
    if (hasKnownFolder) ok(`At least one row assigned a known folder`);
    else fail('Folder assignment', JSON.stringify(modal.rows.map(r => r[1])));

    // 5. The status column shows cleaned/passthrough/skipped
    var validStatuses = ['cleaned', 'passthrough', 'skipped'];
    var allValidStatuses = modal.rows.every(r => validStatuses.includes(r[3]));
    if (allValidStatuses) ok('All rows have a valid status');
    else fail('Status values', JSON.stringify(modal.rows.map(r => r[3])));

    // Cleanup
    await page.evaluate(async () => { try { await window.SWR_MEDIA.deleteAll(); } catch (_) {} });

    // Ignore HF 503 noise (curator's offline-fallback path)
    var realErrors = errors.filter(e => !e.includes('503') && !e.includes('association.hf.space'));
    if (realErrors.length === 0) ok('no real console errors (HF 503 ignored — offline fallback)');
    else fail('console errors', realErrors.join(' | '));
  } finally {
    if (browser) await browser.close();
    server.close();
  }
}

run().catch(err => {
  console.error('FATAL', err);
  process.exit(1);
});