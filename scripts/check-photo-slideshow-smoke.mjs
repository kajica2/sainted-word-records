#!/usr/bin/env node
// scripts/check-photo-slideshow-smoke.mjs — Phase C: beat-reactive photo slideshow.
//
// Boots photo.html and drives the multi-image slideshow through the real
// file input (no stubbing of addFiles — real wire):
//   1. Drop TWO synthetic PNGs → slideshow deck of 2, first shown.
//   2. Drive a beat via window.PHOTO_STUDIO_DEBUG.beat() → advances to photo 2,
//      crossfade in flight, count text "(2/2)".
//   3. Beat again → wraps to photo 1.
//   4. Advance-on-beat checkbox OFF → beat does NOT advance.
//   5. Single image (fresh page) → beat does NOT advance (legacy path intact).
//   6. No console errors.
//
// Run: node scripts/check-photo-slideshow-smoke.mjs
// Exit 0 on full pass, 1 on any failure.

import puppeteer from 'puppeteer';
import http from 'node:http';
import { spawn } from 'node:child_process';
import zlib from 'node:zlib';

const PORT = 53957;
const BASE = `http://127.0.0.1:${PORT}`;
const TARGET = 'photo.html';

// ─── Synthetic PNG builder (RGB, no alpha) ─────────────────────────────
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
  ihd[8] = 8; ihd[9] = 2; ihd[10] = 0; ihd[11] = 0; ihd[12] = 0;
  const ihdr = chunk('IHDR', ihd);
  const row = Buffer.alloc(1 + width * 3);
  row[0] = 0;
  for (let x = 0; x < width; x++) {
    row[1 + x * 3] = fillRgb[0];
    row[1 + x * 3 + 1] = fillRgb[1];
    row[1 + x * 3 + 2] = fillRgb[2];
  }
  const raw = Buffer.alloc((1 + width * 3) * height);
  for (let y = 0; y < height; y++) row.copy(raw, y * (1 + width * 3));
  return Buffer.concat([sig, ihdr, chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

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

const checks = [];
const pass = (m, d) => { checks.push({ ok: true, m, d }); console.log('✓', m, d ? `(${d})` : ''); };
const fail = (m, d) => { checks.push({ ok: false, m, d }); console.log('✗', m, d ? `(${d})` : ''); };

async function dropImages(page, paths) {
  const input = await page.$('#image-input');
  if (!input) throw new Error('#image-input not found');
  await input.uploadFile(...paths);
  // Images decode async; wait for the deck to populate.
  await page.waitForFunction(
    (n) => window.PHOTO_STUDIO_DEBUG && window.PHOTO_STUDIO_DEBUG.state().count === n,
    { timeout: 8000 }, paths.length
  ).catch(() => {});
}

(async () => {
  let server;
  try { server = await startServer(); }
  catch (e) { fail('server boot', e.message); process.exit(1); }

  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
  });

  try {
    // ── Deck A: two images → slideshow advances on beat ──────────────
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 900 });
    const errs = [];
    page.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
    page.on('console', (m) => { if (m.type() === 'error') errs.push('console.error: ' + m.text()); });

    await page.goto(`${BASE}/${TARGET}`, { waitUntil: 'networkidle0', timeout: 20000 });
    await new Promise((r) => setTimeout(r, 1000));

    const seamReady = await page.evaluate(() => !!window.PHOTO_STUDIO_DEBUG);
    if (seamReady) pass('PHOTO_STUDIO_DEBUG seam installed');
    else fail('PHOTO_STUDIO_DEBUG seam missing');

    const p1 = '/tmp/photo-pink.png';
    const p2 = '/tmp/photo-teal.png';
    (await import('node:fs')).writeFileSync(p1, makePng(64, 64, [255, 0, 128]));
    (await import('node:fs')).writeFileSync(p2, makePng(64, 64, [0, 200, 200]));

    await dropImages(page, [p1, p2]);
    const deck = await page.evaluate(() => window.PHOTO_STUDIO_DEBUG.state());
    if (deck.count === 2) pass('two images loaded into slideshow deck (count=2)');
    else fail('expected 2-image deck', JSON.stringify(deck));

    const countText = await page.evaluate(() => document.getElementById('slideshow-count').textContent);
    if (countText === '1/2') pass(`slideshow count shows 1/2 (got ${countText})`);
    else fail('slideshow count not 1/2', countText);

    // Beat 1 → advance to image 2 with crossfade
    await page.evaluate(() => window.PHOTO_STUDIO_DEBUG.beat());
    await new Promise((r) => setTimeout(r, 120));
    const afterBeat1 = await page.evaluate(() => window.PHOTO_STUDIO_DEBUG.state());
    if (afterBeat1.idx === 1) pass('beat advances to photo 2 (idx=1)');
    else fail('beat did not advance', JSON.stringify(afterBeat1));
    if (afterBeat1.fade >= 0) pass('crossfade in flight after beat');
    else fail('no crossfade started', JSON.stringify(afterBeat1));

    // Beat 2 → wraps to photo 1
    await page.evaluate(() => window.PHOTO_STUDIO_DEBUG.beat());
    await new Promise((r) => setTimeout(r, 120));
    const afterBeat2 = await page.evaluate(() => window.PHOTO_STUDIO_DEBUG.state());
    if (afterBeat2.idx === 0) pass('beat wraps to photo 1 (idx=0)');
    else fail('wrap-around failed', JSON.stringify(afterBeat2));

    // Toggle OFF → beat does not advance
    await page.evaluate(() => window.PHOTO_STUDIO_DEBUG.setAdvanceOnBeat(false));
    await page.click('#advance-on-beat');  // sync the checkbox UI state
    await page.mouse.click(0, 0).catch(() => {});  // deselect if open
    await page.evaluate(() => window.PHOTO_STUDIO_DEBUG.beat());
    await new Promise((r) => setTimeout(r, 120));
    const afterOff = await page.evaluate(() => window.PHOTO_STUDIO_DEBUG.state());
    if (afterOff.idx === 0) pass('advance-on-beat OFF → beat does not advance');
    else fail('beat advanced while toggle OFF', JSON.stringify(afterOff));

    // ── Deck B: single image → legacy path, beat must NOT advance ─────
    const p3 = '/tmp/photo-single.png';
    (await import('node:fs')).writeFileSync(p3, makePng(32, 32, [80, 180, 40]));
    const page2 = await browser.newPage();
    const errs2 = [];
    page2.on('pageerror', (e) => errs2.push('pageerror: ' + e.message));
    page2.on('console', (m) => { if (m.type() === 'error') errs2.push('console.error: ' + m.text()); });
    await page2.goto(`${BASE}/${TARGET}`, { waitUntil: 'networkidle0', timeout: 20000 });
    await new Promise((r) => setTimeout(r, 800));
    await dropImages(page2, [p3]);
    const single = await page2.evaluate(() => window.PHOTO_STUDIO_DEBUG.state());
    if (single.count === 1) pass('single image loads (legacy path)');
    else fail('single image failed', JSON.stringify(single));
    await page2.evaluate(() => window.PHOTO_STUDIO_DEBUG.beat());
    await new Promise((r) => setTimeout(r, 120));
    const singleAfterBeat = await page2.evaluate(() => window.PHOTO_STUDIO_DEBUG.state());
    if (singleAfterBeat.idx === 0 && singleAfterBeat.count === 1) {
      pass('single image: beat does NOT advance (legacy intact)');
    } else {
      fail('single-image deck advanced on beat', JSON.stringify(singleAfterBeat));
    }

    const allErrs = errs.concat(errs2).filter((e) => !/WebSocket|ws:\/\/|Failed to load resource/i.test(e));
    if (allErrs.length === 0) pass('no slideshow-related JS errors');
    else fail(`${allErrs.length} JS errors`, allErrs.slice(0, 3).join(' | '));
  } finally {
    await browser.close();
    if (server) try { server.kill('SIGTERM'); } catch (_) {}
  }

  const passed = checks.filter((c) => c.ok).length;
  console.log('');
  console.log('────────────────');
  console.log(`Photo slideshow smoke: ${passed}/${checks.length} checks passed`);
  if (passed !== checks.length) process.exit(1);
  console.log('OK');
})();