#!/usr/bin/env node
// scripts/check-targeting-smoke.mjs — Targeted Engine browser smoke.
//
// Boots engine.html on a static file server and asserts the wiring is live:
//   1. window.SWR_TARGETING is installed with the documented API surface.
//   2. targeting/rules.json is loaded (via the fetch path — the inline
//      <script id="swrc-targeting-rules"> tag only exists in a built dist).
//   3. #variant carries the 6 options (off + the 5 variant ids) and the
//      order is the unmodified canonical one on a cold session.
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

    await page.goto(`${BASE}/engine.html`, { waitUntil: 'networkidle0', timeout: 25000 });
    await page.waitForFunction('!!window.SWR_TARGETING', { timeout: 15000 }).catch(() => {});
    await new Promise((r) => setTimeout(r, 1500));

    const init = await page.evaluate(() => {
      const T = window.SWR_TARGETING;
      return {
        present: !!T,
        api: T ? ['signals', 'classify', 'maybeReorderVariants', 'applyVariantOrder', 'applyTransitionPins', 'showBanner', 'dismissBanner', 'notMe', 'voice'].filter((k) => T[k] !== undefined) : [],
        rulesLoaded: !!(T && T._debug && T._debug.state && T._debug.state.rules),
        rulesVersion: T && T._debug && T._debug.state && T._debug.state.rules ? T._debug.state.rules.version : null,
        variantOpts: Array.from(document.querySelectorAll('#variant option')).map((o) => o.value),
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

    const expected = ['off', 'neon', 'film', 'grid', 'smoke', 'hallucination'];
    if (JSON.stringify(init.variantOpts) === JSON.stringify(expected)) pass('#variant canonical order (6 options)');
    else fail('#variant options mismatch', JSON.stringify(init.variantOpts));

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
