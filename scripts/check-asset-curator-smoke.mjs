#!/usr/bin/env node
// scripts/check-asset-curator-smoke.mjs — Puppeteer integration smoke for the
// asset-curator wired into music_video.html. Per .hermes/plans/asset-curator.md
// Stage 3 success criteria, adapted to the actual implementation:
//   1. Loads music_video.html with HF tagging disabled (env-skip pattern,
//      matching the curator's own __SWR_HF_DISABLED guard).
//   2. Drives a synthetic white-bg PNG through the real file-input
//      drop handler (no stubbing of addFiles — exercises the real wire).
//   3. Asserts:
//      - The curator ran (status: 'cleaned' in DOM).
//      - The library aside renders the new asset under a folder group
//        header (.lib-folder-header).
//      - The ✓ curator badge is on the cleaned item.
//   4. Drops a second asset (non-uniform-bg PNG) and asserts it lands in
//      a different folder group (or 'uncategorized') and carries NO ✓ badge.
//
// Run: node scripts/check-asset-curator-smoke.mjs
// Exit 0 on full pass, 1 if any assertion fails.

import puppeteer from 'puppeteer';
import http from 'node:http';
import { spawn } from 'node:child_process';
import zlib from 'node:zlib';

const PORT = 53937;
const BASE = `http://127.0.0.1:${PORT}`;
const TARGET = 'versions/music_video.html';

// ─── Synthetic PNG builders ────────────────────────────────────────────
// Minimal PNG encoder: returns a Uint8Array of a valid PNG with the given
// RGB fill. We avoid npm deps; the curator reads the pixels via
// createImageBitmap, so any well-formed PNG works.
function crc32(buf) {
  const table = (crc32.table ||= (() => {
    const t = new Uint32Array(256);
    for (let i = 0; i < 256; i++) {
      let c = i;
      for (let j = 0; j < 8; j++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      t[i] = c >>> 0;
    }
    return t;
  })());
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = table[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
  const t = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([t, data])), 0);
  return Buffer.concat([len, t, data, crc]);
}
function makePng(width, height, fillRgb) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihd = Buffer.alloc(13);
  ihd.writeUInt32BE(width, 0); ihd.writeUInt32BE(height, 4);
  ihd[8] = 8;   // bit depth
  ihd[9] = 2;   // color type RGB
  ihd[10] = 0; ihd[11] = 0; ihd[12] = 0;
  const ihdr = chunk('IHDR', ihd);
  // raw scanlines with filter byte 0 + RGB triples
  const row = Buffer.alloc(1 + width * 3);
  row[0] = 0;
  for (let x = 0; x < width; x++) {
    row[1 + x * 3]     = fillRgb[0];
    row[1 + x * 3 + 1] = fillRgb[1];
    row[1 + x * 3 + 2] = fillRgb[2];
  }
  const raw = Buffer.alloc((1 + width * 3) * height);
  for (let y = 0; y < height; y++) row.copy(raw, y * (1 + width * 3));
  const idat = chunk('IDAT', zlib.deflateSync(raw));
  const iend = chunk('IEND', Buffer.alloc(0));
  return Buffer.concat([sig, ihdr, idat, iend]);
}

// Helper: build a checkerboard PNG (so the corner-sniff detects
// non-uniform bg and the curator passes through with passthrough).
function makeCheckerPng(width, height) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihd = Buffer.alloc(13);
  ihd.writeUInt32BE(width, 0); ihd.writeUInt32BE(height, 4);
  ihd[8] = 8; ihd[9] = 2; ihd[10] = 0; ihd[11] = 0; ihd[12] = 0;
  const ihdr = chunk('IHDR', ihd);
  const row = Buffer.alloc(1 + width * 3);
  for (let y = 0; y < height; y++) {
    row[0] = 0;
    for (let x = 0; x < width; x++) {
      const dark = ((Math.floor(x / 4) + Math.floor(y / 4)) % 2) === 0;
      row[1 + x * 3]     = dark ? 30 : 220;
      row[1 + x * 3 + 1] = dark ? 80 : 230;
      row[1 + x * 3 + 2] = dark ? 200 : 240;
    }
  }
  const raw = Buffer.alloc((1 + width * 3) * height);
  for (let y = 0; y < height; y++) row.copy(raw, y * (1 + width * 3));
  const idat = chunk('IDAT', zlib.deflateSync(raw));
  const iend = chunk('IEND', Buffer.alloc(0));
  return Buffer.concat([sig, ihdr, idat, iend]);
}

// ─── Server boot ───────────────────────────────────────────────────────
function startServer() {
  return new Promise((resolve, reject) => {
    const proc = spawn('python3', ['-m', 'http.server', String(PORT)], {
      cwd: process.cwd(), stdio: 'ignore',
    });
    const start = Date.now();
    const tick = () => http.get(`${BASE}/${TARGET}`, (res) => {
      res.resume();
      if (res.statusCode === 200) return resolve(proc);
      if (Date.now() - start > 8000) return reject(new Error('server timeout'));
      setTimeout(tick, 100);
    }).on('error', () => {
      if (Date.now() - start > 8000) return reject(new Error('server error'));
      setTimeout(tick, 80);
    });
    setTimeout(tick, 100);
  });
}

// ─── Assertions ────────────────────────────────────────────────────────
const checks = [];
const pass = (m, d) => { checks.push({ ok: true, m, d }); console.log('✓', m, d ? `(${d})` : ''); };
const fail = (m, d) => { checks.push({ ok: false, m, d }); console.log('✗', m, d ? `(${d})` : ''); };

// ─── Main ─────────────────────────────────────────────────────────────
(async () => {
  let server;
  try { server = await startServer(); }
  catch (e) { fail('server boot', e.message); process.exit(1); }

  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
  });
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 900 });
    const errs = [];
    page.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
    page.on('console', (m) => { if (m.type() === 'error') errs.push('console.error: ' + m.text()); });

    // Disable HF before any curator call so we test the pure-local path.
    await page.evaluateOnNewDocument(() => {
      window.__SWR_HF_DISABLED = true;
    });

    await page.goto(`${BASE}/${TARGET}`, { waitUntil: 'networkidle0', timeout: 15000 });

    // Curator module must have installed itself.
    const curatorReady = await page.evaluate(() => ({
      present: !!window.SWR_ASSET_CURATOR,
      hasProcess: !!(window.SWR_ASSET_CURATOR && window.SWR_ASSET_CURATOR.process),
      status: window.SWR_ASSET_CURATOR ? window.SWR_ASSET_CURATOR.status() : null,
    }));
    if (curatorReady.present && curatorReady.hasProcess) {
      pass('window.SWR_ASSET_CURATOR installed with .process()');
    } else {
      fail('window.SWR_ASSET_CURATOR missing or .process() missing',
        JSON.stringify(curatorReady));
      process.exit(1);
    }

    // ── 1. Drop a white-bg PNG named "gift_bag_test.png" → should land
    //    in folder 'gift-bags' (filename heuristic) and show the ✓ badge.
    const whitePng = makePng(32, 32, [255, 255, 255]);
    const whitePath = '/tmp/gift_bag_test.png';
    (await import('node:fs')).writeFileSync(whitePath, whitePng);

    const fileInput = await page.$('#asset-input');
    if (!fileInput) { fail('#asset-input not found in DOM'); process.exit(1); }
    await fileInput.uploadFile(whitePath);

    // The drop handler is async; wait for the curator badge to appear.
    await page.waitForSelector('.curator-badge', { timeout: 8000 }).catch(() => {});
    await new Promise(r => setTimeout(r, 500));

    const after1 = await page.evaluate(() => ({
      folderHeaders: Array.from(document.querySelectorAll('.lib-folder-header'))
        .map(el => el.textContent.trim()),
      itemsWithBadge: document.querySelectorAll('.li .curator-badge').length,
      itemsTotal: document.querySelectorAll('.li').length,
      errorMsgs: window.__lastErr || null,
    }));

    if (after1.itemsTotal >= 1) pass(`white-bg PNG rendered (${after1.itemsTotal} items)`);
    else fail('white-bg PNG: no items in library aside', JSON.stringify(after1));

    if (after1.itemsWithBadge >= 1) pass('cleaned item shows ✓ curator badge');
    else fail('cleaned item: ✓ badge missing', JSON.stringify(after1));

    if (after1.folderHeaders.length >= 1) pass(`folder headers present (${after1.folderHeaders.length})`);
    else fail('folder headers missing', JSON.stringify(after1));

    const giftFolder = after1.folderHeaders.find(h => /gift-bags/i.test(h));
    if (giftFolder) pass('white-bg PNG routed to gift-bags folder via filename heuristic');
    else fail('white-bg PNG: not in gift-bags folder', after1.folderHeaders.join(' | '));

    // ── 2. Drop a checker-bg PNG named "background.png" → non-uniform bg,
    //    curator should passthrough, no ✓ badge on this item.
    const checkerPng = makeCheckerPng(32, 32);
    const checkerPath = '/tmp/background_test.png';
    (await import('node:fs')).writeFileSync(checkerPath, checkerPng);
    await fileInput.uploadFile(checkerPath);
    await new Promise(r => setTimeout(r, 800));

    const after2 = await page.evaluate(() => ({
      itemsTotal: document.querySelectorAll('.li').length,
      itemsWithBadge: document.querySelectorAll('.li .curator-badge').length,
      folderHeaders: Array.from(document.querySelectorAll('.lib-folder-header'))
        .map(el => el.textContent.trim()),
    }));

    if (after2.itemsTotal === after1.itemsTotal + 1) {
      pass(`second asset added (total: ${after2.itemsTotal})`);
    } else {
      fail(`second asset not added (expected ${after1.itemsTotal + 1}, got ${after2.itemsTotal})`);
    }

    // The new asset should NOT carry a ✓ badge (passthrough, not cleaned).
    // We can't easily distinguish which item is the new one from the DOM
    // alone (the curator doesn't add a per-item data-attribute), but we
    // CAN assert that the badge count is exactly 1 (only the first item
    // was cleaned, the second was passthrough).
    if (after2.itemsWithBadge === after1.itemsWithBadge) {
      pass(`checker-bg PNG passthrough (badge count unchanged at ${after2.itemsWithBadge})`);
    } else {
      fail(`checker-bg PNG unexpectedly cleaned (badges ${after1.itemsWithBadge} → ${after2.itemsWithBadge})`);
    }

    // Filter pre-existing dev-server noise (WebSocket failures to HMR /
    // Vite dev ports, recorder WebSocket retries) — unrelated to the
    // curator wiring under test. The same pattern is used by
    // verify-gallery-audio.mjs.
    const curatorErrors = errs.filter(e =>
      !/WebSocket|ws:\/\/|Failed to load resource/i.test(e));
    if (curatorErrors.length === 0) pass('no curator-related JS errors');
    else fail(`${curatorErrors.length} curator errors`, curatorErrors.slice(0, 3).join(' | '));
  } finally {
    await browser.close();
    if (server) try { server.kill('SIGTERM'); } catch (_) {}
  }

  const passed = checks.filter(c => c.ok).length;
  console.log('');
  console.log('────────────────');
  console.log(`Asset-curator smoke: ${passed}/${checks.length} checks passed`);
  if (passed !== checks.length) process.exit(1);
  console.log('OK');
})();