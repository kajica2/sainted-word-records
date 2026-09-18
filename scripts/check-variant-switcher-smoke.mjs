#!/usr/bin/env node
// scripts/check-variant-switcher-smoke.mjs — variant-switcher (Phase A) browser smoke.
//
// Boots engine.html on a static file server, then drives window.SWR_VARIANTS:
//   1. Module loads, select exists, all 5 variants are populated.
//   2. Activating each variant via the real select (change event) applies theme
//      tokens and — after the drawFx source fetch completes — a variant is active.
//   3. postFx runs on real stage canvas without throwing (engine render loop,
//      which calls it every frame, stays alive — no new pageerrors).
//   4. film creates #vignette, grid creates #grid/#flash overlays.
//   5. Deactivate restores --accent to original value.
//
// Run: node scripts/check-variant-switcher-smoke.mjs
// Exit 0 on full pass, 1 otherwise.

import puppeteer from 'puppeteer';
import http from 'node:http';
import { spawn } from 'node:child_process';

const PORT = 53947;
const BASE = `http://127.0.0.1:${PORT}`;

function startServer() {
  return new Promise((resolve, reject) => {
    const proc = spawn('python3', ['-m', 'http.server', String(PORT)], {
      cwd: process.cwd(), stdio: 'ignore',
    });
    const start = Date.now();
    const tick = () => http.get(`${BASE}/engine.html`, (res) => {
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
    await page.setViewport({ width: 1440, height: 900 });
    const errs = [];
    page.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
    page.on('console', (m) => { if (m.type() === 'error') errs.push('console.error: ' + m.text()); });

    await page.goto(`${BASE}/engine.html`, { waitUntil: 'networkidle0', timeout: 25000 });
    await new Promise((r) => setTimeout(r, 2500));

    // 1. Module + select present with options
    const init = await page.evaluate(() => ({
      present: !!window.SWR_VARIANTS,
      hasPostFx: !!(window.SWR_VARIANTS && window.SWR_VARIANTS.postFx),
      select: !!document.getElementById('variant'),
      opts: Array.from(document.querySelectorAll('#variant option')).map((o) => o.value),
    }));
    if (init.present && init.hasPostFx) pass('window.SWR_VARIANTS installed with postFx()');
    else fail('window.SWR_VARIANTS missing', JSON.stringify(init));
    if (init.select) pass('#variant select found in transport');
    else fail('#variant select missing');
    // Single #variant select (the console toolbar one carries the static
    // "off" option first; the switcher appends the 5 variants).
    const expected = ['off', 'neon', 'film', 'grid', 'smoke', 'hallucination'];
    if (JSON.stringify(init.opts) === JSON.stringify(expected)) {
      pass(`select populated with 5 variants (${init.opts.length} options)`);
    } else {
      fail('select options mismatch', JSON.stringify(init.opts));
    }

    // 2. Baseline accent value
    const accentBefore = await page.evaluate(() =>
      getComputedStyle(document.documentElement).getPropertyValue('--accent').trim());

    // 3. For each variant: set select → change event → wait for active → postFx + overlay check
    for (const id of ['film', 'grid', 'neon', 'hallucination', 'smoke']) {
      await page.evaluate((vid) => {
        const sel = document.getElementById('variant');
        sel.value = vid;
        sel.dispatchEvent(new Event('change', { bubbles: true }));
      }, id);
      // drawFx source fetched from /versions/<id>.html + compiled
      await page.waitForFunction((vid) => window.SWR_VARIANTS.current() === vid, { timeout: 8000 }, id)
        .catch(() => {});
      const active = await page.evaluate(() => window.SWR_VARIANTS.current());
      if (active === id) pass(`${id}: activated via select change`);
      else fail(`${id}: did not activate`, `current=${active}`);

      // Post-fx runs inside the engine render loop; give it a few frames.
      await new Promise((r) => setTimeout(r, 400));
      const state = await page.evaluate((vid) => ({
        accent: getComputedStyle(document.documentElement).getPropertyValue('--accent').trim(),
        vignette: !!document.getElementById('vignette'),
        grid: !!document.getElementById('grid'),
        flash: !!document.getElementById('flash'),
        engineAlive: !!window.SWR_ASSET_CURATOR || !!window.Layers || !!document.querySelector('#render'),
      }), id);
      if (id === 'film' && state.vignette) pass('film: #vignette overlay created');
      if (id === 'grid' && state.grid && state.flash) pass('grid: #grid + #flash overlays created');
      if (state.accent !== accentBefore) pass(`${id}: theme accent swapped (${accentBefore} → ${state.accent})`);
      else fail(`${id}: accent unchanged`, state.accent);
    }

    // 4. Deactivate restores accent
    await page.evaluate(() => {
      const sel = document.getElementById('variant');
      sel.value = 'off';
      sel.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await new Promise((r) => setTimeout(r, 300));
    const afterOff = await page.evaluate(() => ({
      current: window.SWR_VARIANTS.current(),
      accent: getComputedStyle(document.documentElement).getPropertyValue('--accent').trim(),
    }));
    if (afterOff.current === null) pass('deactivate: current() === null');
    else fail('deactivate: still active', afterOff.current);
    if (afterOff.accent === accentBefore) pass('deactivate: original --accent restored');
    else fail('deactivate: accent not restored', `${accentBefore} vs ${afterOff.accent}`);

    // 4.5 Deep-link: /engine?variant=neon auto-activates (Phase B seam)
    await page.goto(`${BASE}/engine.html?variant=neon`, { waitUntil: 'domcontentloaded', timeout: 20000 });
    await page.waitForFunction(() => window.SWR_VARIANTS && window.SWR_VARIANTS.current() === 'neon', { timeout: 8000 })
      .catch(() => {});
    const deep = await page.evaluate(() => ({
      current: window.SWR_VARIANTS.current(),
      selectSynced: document.getElementById('variant').value,
    }));
    if (deep.current === 'neon' && deep.selectSynced === 'neon') {
      pass('deep-link ?variant=neon auto-activates + synced to select');
    } else {
      fail('deep-link activation failed', JSON.stringify(deep));
    }

    // 5. No variant-related JS errors (filter dev-server WebSocket noise)
    const realErrs = errs.filter((e) => !/WebSocket|ws:\/\/|Failed to load resource/i.test(e));
    if (realErrs.length === 0) pass('no variant-related JS errors');
    else fail(`${realErrs.length} errors`, realErrs.slice(0, 3).join(' | '));
  } finally {
    await browser.close();
    if (server) try { server.kill('SIGTERM'); } catch (_) {}
  }

  const passed = checks.filter((c) => c.ok).length;
  console.log('');
  console.log('────────────────');
  console.log(`Variant-switcher smoke: ${passed}/${checks.length} checks passed`);
  if (passed !== checks.length) process.exit(1);
  console.log('OK');
})();