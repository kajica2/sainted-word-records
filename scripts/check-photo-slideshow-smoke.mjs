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

// Navigate photo.html robustly. The page runs fx-background.client.js (a
// fullscreen Canvas2D rAF loop); on a CPU-starved CI runner 'networkidle0'
// never settles and used to take the smoke down with a 20s navigation
// timeout before a single check ran. Try networkidle0 briefly as a
// diagnostic, then fall back to domcontentloaded + explicit seam wait (the
// pattern the other smokes use).
// How long to let networkidle0 try before falling back (override for testing:
// SWR_SMOKE_NETIDLE_MS=1 forces the fallback path locally).
const DIAG_MS = Number(process.env.SWR_SMOKE_NETIDLE_MS || 5000);

async function gotoPhoto(page, label) {
  const inflight = new Map();
  const onReq = (r) => inflight.set(r.url(), true);
  const onDone = (r) => inflight.delete(r.url());
  page.on('request', onReq);
  page.on('requestfinished', onDone);
  page.on('requestfailed', onDone);
  try {
    await page.goto(`${BASE}/${TARGET}`, { waitUntil: 'networkidle0', timeout: DIAG_MS });
  } catch (e) {
    // A goto timeout does NOT cancel the navigation — the page keeps loading
    // in the background. Wait for in-page readiness instead of re-navigating
    // (a second goto while the first is in flight aborts it with ERR_ABORTED).
    const pending = [...inflight.keys()];
    console.log(`· ${label}: networkidle0 not reached in ${DIAG_MS}ms — waiting for page readiness instead`);
    console.log(`· ${label}: requests still in flight: ${pending.length ? pending.join(', ') : '(none)'}`);
    await page.waitForFunction(
      () => document.readyState === 'complete' || !!window.PHOTO_STUDIO_DEBUG,
      { timeout: 20000 }
    ).catch(() => {});
  }
  await page.waitForFunction(() => !!window.PHOTO_STUDIO_DEBUG, { timeout: 15000 }).catch(() => {});
}

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

    await gotoPhoto(page, 'deck A');
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
    await gotoPhoto(page2, 'deck B');
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

    // ── Deck C: preset template (Phase D) drives the slideshow ────────
    // Drop a swr-preset/v1 JSON carrying a `photo` block through the real
    // file input; verify transition/advance/holdBars take effect.
    const presetCut = {
      id: 'swr-preset-2026-09-14-test-cut',
      schema: 'swr-preset/v1',
      created_at: '2026-09-14T00:00:00Z',
      name: 'Test Cut',
      family: 'GENERATIVE',
      description: 'fixture',
      inspiration: [{ kind: 'palette_ref', name: 'x', weight: 0.8 }],
      fx_state: { liquid: 0, pearl: 0, glitch: 0, grain: 0, chroma: 0, bloom: 0,
                  vignette: 0, sepia: 0, glow: 0, grayscale: 0, blur: 0, mut: 0,
                  mutAlgo: 0, temp: 0, posterize: 8 },
      motion: { rotation_speed: 0, scale_pulse: 0, pan_x: 0, pan_y: 0 },
      palette: { primary: '#ff0066', secondary: '#00ccff', accent: '#ffff00', bg: '#000000' },
      audio_reactivity: { bass: ['scale_pulse'], mid: [], treble: [], onset: [] },
      preview: { thumbnail_svg: '<svg width="8" height="8"><rect width="8" height="8" fill="#ff0066"/></svg>', tags: ['test'] },
      photo: { transition: 'cut', advance: 'bars', holdBars: 2 },
    };
    const presetPath = '/tmp/test-cut-preset.json';
    (await import('node:fs')).writeFileSync(presetPath, JSON.stringify(presetCut));

    const page3 = await browser.newPage();
    const errs3 = [];
    page3.on('pageerror', (e) => errs3.push('pageerror: ' + e.message));
    page3.on('console', (m) => { if (m.type() === 'error') errs3.push('console.error: ' + m.text()); });
    await gotoPhoto(page3, 'deck C');
    await new Promise((r) => setTimeout(r, 800));

    // Deck of 2 + apply preset via the file input (real wire, not the seam)
    await dropImages(page3, [p1, p2]);
    const presetInput = await page3.$('#preset-file');
    if (presetInput) {
      await presetInput.uploadFile(presetPath);
      await new Promise((r) => setTimeout(r, 400));
    } else {
      fail('#preset-file input missing');
    }

    // The manifest picker should list photo-block presets (we seeded one:
    // swr-preset-2026-08-14-photo-cut-on-kick) and the list stays open even
    // when the manifest is unreachable (local settings remain the default).
    const pickerOpts = await page3.evaluate(() =>
      Array.from(document.querySelectorAll('#preset-select option')).map((o) => o.textContent));
    const hasPhotoPreset = pickerOpts.some((t) => /Photo Cut on Kick/.test(t));
    if (hasPhotoPreset) pass('manifest picker lists seeded photo-block preset');
    else fail('photo preset missing from picker', JSON.stringify(pickerOpts));

    const tpl = await page3.evaluate(() => window.PHOTO_STUDIO_DEBUG.template());
    if (tpl.transition === 'cut') pass('preset photo block: transition=cut applied');
    else fail('transition not cut', JSON.stringify(tpl));
    if (tpl.advance === 'bars' && tpl.holdBars === 2) pass('preset photo block: advance=bars holdBars=2 applied');
    else fail('advance/holdBars not applied', JSON.stringify(tpl));

    const statusText = await page3.evaluate(() => document.getElementById('preset-status').textContent);
    if (/Test Cut/.test(statusText)) pass(`preset status shows template (${statusText})`);
    else fail('preset status missing name', statusText);

    // cut transition → advance is instant: no crossfade window in flight
    await page3.evaluate(() => window.PHOTO_STUDIO_DEBUG.beat());
    await new Promise((r) => setTimeout(r, 120));
    const cutEnd = await page3.evaluate(() => {
      window.PHOTO_STUDIO_DEBUG.advance();
      return window.PHOTO_STUDIO_DEBUG.state();
    });
    if (cutEnd.fade === -1) pass('cut transition: no crossfade window (fade=-1)');
    else fail('cut should have fade=-1', JSON.stringify(cutEnd));

    // bars advance: holdBars=2 → 8 beats per advance. Beat 1..7 must NOT
    // advance (from the current idx), the 8th must.
    const barsStart = await page3.evaluate(() => {
      window.PHOTO_STUDIO_DEBUG.applyPreset({
        id: 'x', schema: 'swr-preset/v1', created_at: '2026-09-14T00:00:00Z',
        name: 'Bars', family: 'GENERATIVE', description: 'f',
        inspiration: [{ kind: 'palette_ref', name: 'x', weight: 0.8 }],
        fx_state: { liquid: 0, pearl: 0, glitch: 0, grain: 0, chroma: 0, bloom: 0,
                    vignette: 0, sepia: 0, glow: 0, grayscale: 0, blur: 0, mut: 0,
                    mutAlgo: 0, temp: 0, posterize: 8 },
        motion: { rotation_speed: 0, scale_pulse: 0, pan_x: 0, pan_y: 0 },
        palette: { primary: '#ff0066', secondary: '#00ccff', accent: '#ffff00', bg: '#000000' },
        audio_reactivity: { bass: ['scale_pulse'], mid: [], treble: [], onset: [] },
        preview: { thumbnail_svg: '<svg width="8" height="8"/><rect/></svg>', tags: ['t'] },
        photo: { transition: 'crossfade', advance: 'bars', holdBars: 2 },
      });
      return window.PHOTO_STUDIO_DEBUG.state();
    });
    let advanceOk = true;
    for (let b = 1; b <= 7; b++) {
      const s = await page3.evaluate(() => {
        window.PHOTO_STUDIO_DEBUG.beat();
        return window.PHOTO_STUDIO_DEBUG.state();
      });
      if (s.idx !== barsStart.idx) { advanceOk = false; break; }
    }
    if (advanceOk) pass('bars advance: beats 1–7 do NOT advance (holdBars=2)');
    else fail('bars advance advanced early');
    const barsAfter8 = await page3.evaluate(() => {
      window.PHOTO_STUDIO_DEBUG.beat();   // the 8th beat
      return window.PHOTO_STUDIO_DEBUG.state();
    });
    if (barsAfter8.idx !== barsStart.idx) pass('bars advance: 8th beat advances the photo');
    else fail('8th beat did not advance', JSON.stringify({ start: barsStart, after: barsAfter8 }));

    const allErrs = errs.concat(errs2, errs3).filter((e) => !/WebSocket|ws:\/\/|Failed to load resource/i.test(e));
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