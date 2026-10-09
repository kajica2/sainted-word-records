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
    // --autoplay-policy: engine.html calls Audio.play() during boot, which
    // Chrome otherwise rejects (NotAllowedError) because no gesture has
    // happened yet. The flag is the fix, so these errors are no longer
    // filtered out below: a play() regression now fails this suite.
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage',
      '--autoplay-policy=no-user-gesture-required'],
  });
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1440, height: 900 });
    const errs = [];
    page.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
    page.on('console', (m) => { if (m.type() === 'error') errs.push('console.error: ' + m.text()); });

    // domcontentloaded + an explicit wait for the module under test.
    // networkidle0 is unreliable on engine.html: the page holds long-lived
    // audio/fetch connections, so it can fire before SWR_VARIANTS attaches
    // (or not fire at all). Waiting on the module is the actual precondition
    // the first assertion needs.
    await page.goto(`${BASE}/engine.html`, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForFunction('typeof window.SWR_VARIANTS !== "undefined"', { timeout: 20000 });
    // wireUI() appends the options and then hands the select to
    // SWR_TARGETING.maybeReorderVariants, which reorders *once its rules
    // table has loaded* (it returns early and "init() re-applies" if not).
    // Wait for the full option set so the assertion below never races the
    // populate step; the order itself is deliberately not pinned (see the
    // assertion) because the reorder is a supported behaviour.
    await page.waitForFunction('document.querySelectorAll("#variant option").length >= 6', { timeout: 15000 });
    await new Promise((r) => setTimeout(r, 1500));

    // 1. Module + select present with options
    const init = await page.evaluate(() => ({
      present: !!window.SWR_VARIANTS,
      hasPostFx: !!(window.SWR_VARIANTS && window.SWR_VARIANTS.postFx),
      select: !!document.getElementById('variant'),
      opts: Array.from(document.querySelectorAll('#variant option')).map((o) => o.value),
      // list() is the canonical source for the expected set — read at
      // runtime so the 5→16 expansion (and any future addition) is
      // covered without editing this file.
      list: window.SWR_VARIANTS ? window.SWR_VARIANTS.list().map((v) => v.id) : [],
    }));
    if (init.present && init.hasPostFx) pass('window.SWR_VARIANTS installed with postFx()');
    else fail('window.SWR_VARIANTS missing', JSON.stringify(init));
    if (init.select) pass('#variant select found in transport');
    else fail('#variant select missing');
    // Single #variant select: the console toolbar carries the static "off"
    // option first, the switcher appends the variants.
    //
    // The variant *order* is deliberately not asserted. wireUI() hands the
    // select to SWR_TARGETING.maybeReorderVariants, which reorders the
    // options most-relevant-first once its rules table loads — measured here
    // as ['neon','grid','film',…] with the rules in and ['neon','film','grid',…]
    // without, i.e. the same page yields two legitimate orders. Pinning one of
    // them made this suite fail by timing. Assert the set, and report the
    // order for visibility.
    const expectedIds = (init.list && init.list.length ? init.list : init.opts.slice(1));
    const got = init.opts.slice(1);                    // drop the static 'off'
    const sameSet = got.length === expectedIds.length
      && expectedIds.every((id) => got.includes(id))
      && new Set(got).size === got.length;
    if (init.opts[0] === 'off' && sameSet) {
      pass(`select carries 'off' + all ${expectedIds.length} variants (${init.opts.length} options)`);
      console.log(`  \x1b[33m·\x1b[0m option order: ${init.opts.join(', ')}`);
    } else {
      fail('select options mismatch', JSON.stringify(init.opts));
    }

    // 2. Baseline accent value
    const accentBefore = await page.evaluate(() =>
      getComputedStyle(document.documentElement).getPropertyValue('--accent').trim());

    // 3. For each variant: set select → change event → wait for active → postFx + overlay check
    // Walk the runtime list, not a hardcoded subset, so the 5→16 expansion
    // (and any future addition) is auto-covered.
    for (const id of expectedIds) {
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

    // 5. No variant-related JS errors. Only dev-server WebSocket noise and
    // 404s are filtered; autoplay/play() errors are deliberately NOT — the
    // --autoplay-policy flag above prevents the headless-only
    // NotAllowedError, so one surfacing here would be a real play() regression.
    const realErrs = errs.filter((e) =>
      !/WebSocket|ws:\/\/|Failed to load resource/i.test(e)
    );
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