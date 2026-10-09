#!/usr/bin/env node
// scripts/check-targeting-smoke.mjs — Targeted Engine browser smoke.
//
// Boots engine.html on a static file server and asserts the wiring is live:
//   1. window.SWR_TARGETING is installed with the documented API surface.
//   2. targeting/rules.json is loaded (via the fetch path — the inline
//      <script id="swrc-targeting-rules"> tag only exists in a built dist).
//   3. #variant carries 'off' plus every canonical variant id (read at
//      runtime from SWR_VARIANTS.list()). Option order is not pinned —
//      maybeReorderVariants is free to reorder the select.
//   4. the banner host exists and is hidden.
//   5. nothing on the prove path threw a page error.
//
// Run: node scripts/check-targeting-smoke.mjs
// Exit 0 on full pass, 1 otherwise.

import puppeteer from 'puppeteer';
import http from 'node:http';
import { spawn } from 'node:child_process';

const PORT = 53961;
const BASE = `http://127.0.0.1:${PORT}`;

function startServer() {
  return new Promise((resolve, reject) => {
    const proc = spawn('python3', ['-m', 'http.server', String(PORT)], { cwd: process.cwd(), stdio: 'ignore' });
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
const pass = (m, d) => { checks.push({ ok: true, m }); console.log('✓', m, d ? `(${d})` : ''); };
const fail = (m, d) => { checks.push({ ok: false, m }); console.log('✗', m, d ? `(${d})` : ''); };

(async () => {
  let server;
  try { server = await startServer(); }
  catch (e) { fail('server boot', e.message); process.exit(1); }

  const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'] });
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1440, height: 900 });
    const errs = [];
    page.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
    page.on('console', (m) => { if (m.type() === 'error') errs.push('console.error: ' + m.text()); });

    // domcontentloaded, not networkidle0: engine.html auto-loads and streams
    // its demo track, so the network never goes idle and networkidle0 either
    // resolves early or times out — the same condition that made
    // verify-automix and check:automix-smoke flaky on CI runners. Gate on
    // domcontentloaded, then on the module this smoke actually asserts.
    await page.goto(`${BASE}/engine.html`, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForFunction('!!window.SWR_TARGETING', { timeout: 20000 }).catch(() => {});
    await new Promise((r) => setTimeout(r, 1500));

    const init = await page.evaluate(() => {
      const T = window.SWR_TARGETING;
      return {
        present: !!T,
        api: T ? ['signals', 'classify', 'maybeReorderVariants', 'applyVariantOrder', 'applyTransitionPins', 'showBanner', 'dismissBanner', 'notMe', 'voice'].filter((k) => T[k] !== undefined) : [],
        rulesLoaded: !!(T && T._debug && T._debug.state && T._debug.state.rules),
        rulesVersion: T && T._debug && T._debug.state && T._debug.state.rules ? T._debug.state.rules.version : null,
        variantOpts: Array.from(document.querySelectorAll('#variant option')).map((o) => o.value),
        // list() is the canonical source for the expected set — read at
        // runtime so variant additions/removals (grid's removal, the 9
        // artistic variants) are covered without editing this file.
        variantIds: window.SWR_VARIANTS ? window.SWR_VARIANTS.list().map((v) => v.id) : [],
        banner: !!document.getElementById('swr-targeting-banner'),
        bannerHidden: (() => { const b = document.getElementById('swr-targeting-banner'); return b ? b.hidden : null; })(),
      };
    });

    if (init.present) pass('window.SWR_TARGETING installed'); else fail('window.SWR_TARGETING missing');
    const need = ['signals', 'classify', 'maybeReorderVariants', 'applyVariantOrder', 'applyTransitionPins', 'showBanner', 'dismissBanner', 'notMe', 'voice'];
    if (need.every((k) => init.api.includes(k))) pass(`API surface complete (${init.api.length}/9)`);
    else fail('API surface incomplete', `missing ${need.filter((k) => !init.api.includes(k)).join(',')}`);

    if (init.rulesLoaded && init.rulesVersion === 'swr-targeting-rules/v1') pass('targeting/rules.json loaded', init.rulesVersion);
    else fail('rules not loaded', JSON.stringify(init.rulesVersion));

    // Expected set is derived at runtime from SWR_VARIANTS.list() (canonical)
    // with the static <option value="off"> the console toolbar carries first.
    //
    // The variant *order* is deliberately not asserted: wireUI() hands the
    // select to SWR_TARGETING.maybeReorderVariants, which reorders the
    // options most-relevant-first once its rules table loads, so the same
    // page legitimately yields two orders. Assert the set, and report the
    // order for visibility.
    const expected = ['off', ...init.variantIds];
    const sameSet = init.variantOpts.length === expected.length
      && expected.every((id) => init.variantOpts.includes(id))
      && new Set(init.variantOpts).size === init.variantOpts.length;
    if (sameSet) {
      pass(`#variant carries 'off' + all ${expected.length - 1} variants (${init.variantOpts.length} options)`);
      console.log(`  \x1b[33m·\x1b[0m option order: ${init.variantOpts.join(', ')}`);
    } else {
      fail('#variant options mismatch', JSON.stringify({ got: init.variantOpts, expected }));
    }

    if (init.banner && init.bannerHidden === true) pass('banner host present and hidden');
    else fail('banner host', JSON.stringify({ present: init.banner, hidden: init.bannerHidden }));

    // Same filter as check-variant-switcher-smoke.mjs: the static file server
    // has no /api/* handlers, so engine.html's session probe 404s — that is a
    // property of the harness, not of the targeting path. The rules-load
    // assertion above is the real signal that targeting's own network use
    // worked.
    const real = errs.filter((s) =>
      !/Failed to load resource|WebSocket|ws:\/\//i.test(s) &&
      !/play\(\) failed because the user didn't interact|NotAllowedError: play/i.test(s));
    if (real.length === 0) pass('no page errors on the targeting path');
    else fail('page errors', real.slice(0, 3).join(' | '));
  } finally {
    await browser.close();
    if (server) server.kill('SIGTERM');
  }

  const failed = checks.filter((c) => !c.ok).length;
  console.log('\n' + (failed === 0 ? 'TARGETING SMOKE: ALL GREEN' : `TARGETING SMOKE: ${failed} failure(s)`));
  process.exit(failed === 0 ? 0 : 1);
})();
