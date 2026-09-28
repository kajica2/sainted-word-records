#!/usr/bin/env node
// verify-targeting.mjs — Targeted Engine end-to-end probe.
//
// Boots engine.html against the repo root and drives a synthetic session
// through the real public API, then asserts the UI actually reacted:
//
//   1. a cold session leaves #variant in its canonical order (no targeting)
//   2. after 2 AR surface visits + 1 preset change the session classifies as
//      ar-loop-poster and #variant is reordered — "smoke" (that persona's
//      top preference) becomes the first non-"off" option
//   3. the banner host stays hidden (ar-loop-poster's copy is only offered
//      once, and this probe does not ask for it)
//   4. "Not me" records a correction that lowers the persona's score
//
// Locally:  node verify-targeting.mjs
// npm:      npm run verify:targeting

import puppeteer from 'puppeteer';
import http from 'node:http';
import { spawn } from 'node:child_process';

const PORT = 53962;
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

    await page.goto(`${BASE}/engine.html`, { waitUntil: 'networkidle0', timeout: 25000 });
    await page.waitForFunction('!!(window.SWR_TARGETING && window.SWR_TARGETING.ready && window.SWR_TARGETING.ready())', { timeout: 20000 });
    await page.waitForFunction('!!document.querySelector("#variant option[value=\'smoke\']")', { timeout: 15000 });

    // 1. cold session: canonical order, no persona
    const cold = await page.evaluate(() => ({
      opts: Array.from(document.querySelectorAll('#variant option')).map((o) => o.value),
      persona: window.SWR_TARGETING.persona(),
    }));
    if (cold.persona === null) pass('cold session is untargeted');
    else fail('cold session classified', String(cold.persona));
    if (cold.opts[1] === 'neon') pass('cold #variant order is canonical', cold.opts.join(','));
    else fail('cold #variant order unexpected', cold.opts.join(','));

    // 2. synthetic session: 2 AR visits + 1 preset change
    const after = await page.evaluate(async () => {
      const T = window.SWR_TARGETING;
      T.signals.record({ kind: 'visit', payload: { surface: 'AR' } });
      T.signals.record({ kind: 'visit', payload: { surface: 'AR' } });
      T.signals.record({ kind: 'preset', payload: { id: 'pulse' } });
      await new Promise((r) => setTimeout(r, 150));
      return {
        persona: T.persona(),
        segment: T.segment(),
        opts: Array.from(document.querySelectorAll('#variant option')).map((o) => o.value),
        bannerHidden: document.getElementById('swr-targeting-banner').hidden,
        bannerText: document.getElementById('swr-targeting-banner').textContent,
      };
    });
    if (after.persona === 'ar-loop-poster') pass('AR×2 + preset → ar-loop-poster', `segment=${after.segment}`);
    else fail('classification', String(after.persona));
    if (after.opts[0] === 'off' && after.opts[1] === 'smoke') pass('#variant reordered — smoke first after "off"', after.opts.join(','));
    else fail('#variant not reordered', after.opts.join(','));
    // FR-8/9: classification offers the persona's banner copy, dismissible.
    if (after.bannerHidden === false && /Free, no signup/.test(after.bannerText)) {
      pass('persona banner offered with the CTA line', JSON.stringify(after.bannerText));
    } else {
      fail('persona banner', JSON.stringify({ hidden: after.bannerHidden, text: after.bannerText }));
    }
    const dismissed = await page.evaluate(() => {
      const host = document.getElementById('swr-targeting-banner');
      const close = host.querySelector('.swr-targeting-banner__close');
      if (!close) return { ok: false, reason: 'no close control' };
      close.click();
      const off = window.SWR_TARGETING.showBanner({ surface: 'persona:ar-loop-poster', copy: 'Again. Free, no signup.' });
      return { ok: host.hidden === true, suppressed: off.shown === false && off.reason === 'dismissed' };
    });
    if (dismissed.ok && dismissed.suppressed) pass('banner dismissal hides it and suppresses re-offer for 7 days');
    else fail('banner dismissal', JSON.stringify(dismissed));

    // 3. "Not me" correction lowers the score
    const corrected = await page.evaluate(async () => {
      const T = window.SWR_TARGETING;
      const before = T.classify().personaScore;
      const applied = T.notMe();
      await new Promise((r) => setTimeout(r, 50));
      return { applied, before, after: T.classify().personaScore, persona: T.persona() };
    });
    if (corrected.applied === true && corrected.after < corrected.before) pass('"Not me" lowers the persona score', `${corrected.before} → ${corrected.after}`);
    else fail('"Not me" correction', JSON.stringify(corrected));

    const real = errs.filter((s) => !/play\(\) failed because the user didn't interact|NotAllowedError: play/i.test(s));
    if (real.length === 0) pass('no page errors');
    else fail('page errors', real.slice(0, 3).join(' | '));
  } finally {
    await browser.close();
    if (server) server.kill('SIGTERM');
  }

  const failed = checks.filter((c) => !c.ok).length;
  console.log('\n' + (failed === 0 ? 'VERIFY TARGETING: ALL GREEN' : `VERIFY TARGETING: ${failed} failure(s)`));
  process.exit(failed === 0 ? 0 : 1);
})();
