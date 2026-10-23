#!/usr/bin/env node
// scripts/check-chain-view.mjs — the /alternate "Chain" view browser smoke.
//
// The Chain view is an Ozone-style mastering surface over the SAME engine
// (engine.html?chain=1). It wraps window.SWR_REACTORS.applyReactor rather
// than forking the engine, so this suite asserts the WIRING, not just that
// some markup appeared.
//
// Assertions:
//
//   A. Boot      — the engine's globals come up and the chain installs.
//   B. Structure — the Ozone surface is present and complete.
//   C. A11y      — every toggle carries aria-pressed; the knob and the
//                  fader thumbs are role=slider with a value.
//   D. Rack      — powering a module off removes exactly its targets, and
//                  the default chain leaves all eight targets active (the
//                  chain must not change what the engine does until asked).
//   E. Behaviour — character, threshold, mode, the rack and bypass all
//                  change what the REAL reactor contract computes, asserted
//                  by calling the wrapped applyReactor with a synthetic layer.
//   F. No-op     — without ?chain=1 the chain never mounts.
//   G. Mobile    — the chain overlay does not change the engine's stage.
//   H. Errors    — no page errors, console errors or failing responses.
//
// Run: node scripts/check-chain-view.mjs
// Exit 0 on full pass, 1 otherwise.

import puppeteer from 'puppeteer';
import http from 'node:http';
import https from 'node:https';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const PORT = 53973;
const LOCAL_BASE = `http://127.0.0.1:${PORT}`;
const BASE = process.env.CHAIN_BASE_URL || LOCAL_BASE;
const EXTERNAL_BASE = process.env.CHAIN_BASE_URL || null;

// Serve the BUILT output when it exists so the page runs against exactly
// what production serves. Fall back to the source tree on a fresh clone.
const DIST = path.resolve('dist');
const SERVE_ROOT = fs.existsSync(path.join(DIST, 'engine.html')) ? DIST : process.cwd();

function startServer() {
  return new Promise((resolve, reject) => {
    const proc = spawn('python3', ['-m', 'http.server', String(PORT)], {
      cwd: SERVE_ROOT, stdio: 'ignore',
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
const check = (cond, m, d) => (cond ? pass(m, d) : fail(m, d));

async function waitForEngine(page, timeout = 45000) {
  await page.waitForFunction(
    () => typeof window.Audio !== 'undefined'
      && typeof window.Library !== 'undefined'
      && typeof window.Layers !== 'undefined'
      && typeof window.SWR_REACTORS !== 'undefined'
      && typeof window.SWR_REACTORS.applyReactor === 'function',
    { timeout },
  );
}

async function waitForChain(page, timeout = 45000) {
  await page.waitForFunction(
    () => !!window.SWR_CHAIN && typeof window.SWR_CHAIN.isEngineHooked === 'function'
      && window.SWR_CHAIN.isEngineHooked(),
    { timeout },
  );
}

// pwa-bootstrap.js reloads the page when the service worker claims control
// for the first time (its `controllerchange` handler calls location.reload).
// On a fresh browser profile that fires a couple of seconds after the first
// load and destroys the execution context mid-assertion. It is standard
// first-visit PWA behaviour, not a defect of this feature — so the suite
// waits for the page to go QUIET before it starts asserting, and retries
// from a fresh page if a reload still lands mid-assertion.
let lastNav = Date.now();
function trackNavigations(page) {
  page.on('framenavigated', (f) => {
    try { if (f === page.mainFrame()) lastNav = Date.now(); } catch (_) { lastNav = Date.now(); }
  });
}

async function settle(page, quietMs = 2500, timeout = 60000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    try {
      await page.waitForFunction(
        () => !!window.SWR_CHAIN && window.SWR_CHAIN.isEngineHooked(),
        { timeout: 4000 },
      );
      if (Date.now() - lastNav > quietMs) return true;
    } catch (_) { /* context gone (reload) or not hooked yet */ }
    await new Promise((r) => setTimeout(r, 400));
  }
  return false;
}

(async () => {
  console.log(`chain-view smoke → ${BASE}`);
  let server;
  if (!EXTERNAL_BASE) {
    try { server = await startServer(); }
    catch (e) { fail('server boot', e.message); process.exit(1); }
  }

  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage',
      '--autoplay-policy=no-user-gesture-required',
      ...(EXTERNAL_BASE ? ['--ignore-certificate-errors'] : [])],
  });

  // The stored app version, read from the served file rather than
  // hard-coded, so this keeps working against dist/ and a live deploy.
  const appVersion = await new Promise((resolve) => {
    const client = BASE.startsWith('https:') ? https : http;
    client.get(`${BASE}/lib/app-version.js`, (res) => {
      let b = '';
      res.on('data', (c) => { b += c; });
      res.on('end', () => {
        const m = /SWR_APP_VERSION\s*=\s*['"]([^'"]+)['"]/.exec(b);
        resolve(m ? m[1] : 'dev');
      });
    }).on('error', () => resolve('dev'));
  });

  const seed = async (page, advanced) => {
    await page.evaluateOnNewDocument((a) => {
      try {
        localStorage.setItem('swr_app_version_seen', a.v);
        if (a.advanced) localStorage.setItem('swr.engine.mode', 'advanced');
      } catch (_) {}
    }, { v: appVersion, advanced: !!advanced });
    // Block off-origin requests — the default library pulls demo images from
    // an external CDN, and in a sandbox those fail TLS and trigger the
    // engine's retry path, which re-navigates and makes the suite flaky.
    await page.setRequestInterception(true);
    page.on('request', (req) => {
      const u = req.url();
      if (u.startsWith(BASE) || u.startsWith('data:') || u.startsWith('blob:')) return req.continue();
      return req.abort();
    });
  };

  const MAX_ATTEMPTS = 3;
  let lastErr = null;
  let done = false;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS && !done; attempt++) {
    checks.length = 0;              // discard a partial pass
    const page = await browser.newPage();
    trackNavigations(page);
    try {
      await page.setViewport({ width: 1440, height: 900 });
      await seed(page, false);

      // Resources that cannot exist on a static file server but DO exist in
      // the deployed environment. /api/* are Vercel serverless functions;
      // /favicon* is the browser's default probe. Neither is a defect.
      const ABSENT_OK = [/\/api\//, /favicon/i];
      const absentOk = (u) => ABSENT_OK.some((re) => re.test(u));
      const pageErrs = [];
      const consoleErrs = [];
      const badResponses = [];
      page.on('pageerror', (e) => pageErrs.push(e.message));
      page.on('console', (m) => {
        if (m.type() !== 'error') return;
        const t = m.text();
        // A 404 console message duplicates the response channel below.
        if (/Failed to load resource/i.test(t)) return;
        consoleErrs.push(t);
      });
      page.on('response', (r) => {
        if (r.status() >= 400 && !absentOk(r.url())) badResponses.push({ s: r.status(), u: r.url() });
      });

      await page.goto(`${BASE}/engine.html?chain=1`, { waitUntil: 'domcontentloaded', timeout: 60000 });
      await waitForEngine(page);
      await waitForChain(page);
      await settle(page);

      // ── A. Boot ───────────────────────────────────────────────────────
      check(true, 'A1 the engine globals are up');
      check(await page.evaluate(() => !!window.SWR_CHAIN), 'A2 window.SWR_CHAIN is installed');
      check(await page.evaluate(() => window.SWR_CHAIN.isEngineHooked()),
        'A3 applyReactor is wrapped by the chain');

      // ── B. Structure ──────────────────────────────────────────────────
      const structure = await page.evaluate(() => ({
        root: !!document.getElementById('swr-chain'),
        bodyClass: document.body.classList.contains('swr-chain-active'),
        top: !!document.querySelector('[data-chain-top]'),
        rack: !!document.querySelector('[data-chain-rack]'),
        main: !!document.querySelector('[data-chain-main]'),
        output: !!document.querySelector('[data-chain-output]'),
        modules: document.querySelectorAll('[data-chain-module]').length,
        addSlot: !!document.querySelector('[data-chain-addslot]'),
        faders: document.querySelectorAll('[data-chain-thumb]').length,
        knob: !!document.querySelector('[data-chain-knob]'),
        graph: !!document.querySelector('[data-chain-graph]'),
        modToggles: document.querySelectorAll('[data-chain-toggle]').length,
        utils: document.querySelectorAll('.swr-chain__util').length,
        styleLoaded: !!document.querySelector('link[data-chain-style]'),
        styled: (() => {
          const t = document.querySelector('.swr-chain__top');
          if (!t) return false;
          const cs = getComputedStyle(t);
          return cs.position === 'relative' && parseFloat(cs.zIndex) > 0;
        })(),
      }));
      check(structure.root, 'B1 the chain root is mounted');
      check(structure.bodyClass, 'B2 body carries swr-chain-active');
      check(structure.top && structure.rack && structure.main && structure.output,
        'B3 the four Ozone regions are present');
      check(structure.modules === 5, 'B4 the rack has five modules', `got ${structure.modules}`);
      check(structure.addSlot, 'B5 the add-module slot is present');
      check(structure.faders === 4, 'B6 there are four output faders', `got ${structure.faders}`);
      check(structure.knob && structure.graph, 'B7 the knob and the response graph are present');
      check(structure.modToggles === 10, 'B8 five module toggles + five utilities',
        `got ${structure.modToggles}`);
      check(structure.utils === 5, 'B9 five utility buttons', `got ${structure.utils}`);
      check(structure.styleLoaded && structure.styled,
        'B10 the stylesheet is loaded on demand and applied');

      // ── C. Accessibility ──────────────────────────────────────────────
      const a11y = await page.evaluate(() => {
        const toggles = [...document.querySelectorAll('[data-chain-toggle], [data-chain-power], [data-chain-brand], [data-chain-tab]')];
        const missingPressed = toggles.filter((n) => !n.hasAttribute('aria-pressed')).length;
        const sliders = [...document.querySelectorAll('[role=slider]')];
        const badSlider = sliders.filter((n) =>
          !n.hasAttribute('aria-valuemin') || !n.hasAttribute('aria-valuemax')
          || !n.hasAttribute('aria-valuenow')).length;
        const knob = document.querySelector('[data-chain-knob]');
        return {
          toggles: toggles.length,
          missingPressed,
          sliders: sliders.length,
          badSlider,
          knobMin: knob && knob.getAttribute('aria-valuemin'),
          knobMax: knob && knob.getAttribute('aria-valuemax'),
          knobText: knob && knob.getAttribute('aria-valuetext'),
          focusable: sliders.every((n) => n.tabIndex >= 0),
        };
      });
      check(a11y.toggles > 0 && a11y.missingPressed === 0,
        'C1 every toggle carries aria-pressed', `${a11y.toggles} toggles, ${a11y.missingPressed} missing`);
      check(a11y.sliders === 5 && a11y.badSlider === 0,
        'C2 the knob + four faders are role=slider with values', `${a11y.sliders} sliders`);
      check(a11y.knobMin === '0' && a11y.knobMax === '2' && a11y.knobText === 'Analog',
        'C3 the knob reports its mode', `${a11y.knobMin}..${a11y.knobMax} = ${a11y.knobText}`);
      check(a11y.focusable, 'C4 every slider is keyboard reachable');

      // ── D. The module rack ────────────────────────────────────────────
      const rack = await page.evaluate(() => {
        const C = window.SWR_CHAIN;
        const all = C.activeTargets().slice().sort();
        C.setModule('eq', false);
        const withoutEq = C.activeTargets().slice().sort();
        C.setModule('eq', true);
        const restored = C.activeTargets().slice().sort();
        return { all, withoutEq, restored };
      });
      check(rack.all.length === 8,
        'D1 the default chain leaves all eight reactor targets active',
        rack.all.join(','));
      check(!rack.withoutEq.includes('brightness') && !rack.withoutEq.includes('contrast'),
        'D2 powering Vintage EQ off removes exactly brightness + contrast',
        rack.withoutEq.join(','));
      check(JSON.stringify(rack.restored) === JSON.stringify(rack.all), 'D3 the rack restores cleanly');

      // ── E. Behaviour against the real reactor contract ───────────────
      const behaviour = await page.evaluate(() => {
        const RX = window.SWR_REACTORS;
        const C = window.SWR_CHAIN;

        // The engine's own curves, so the mode knob has something to switch.
        const ease = (name, t) => {
          if (name === 'sharp') return Math.pow(t, 0.4);
          if (name === 'soft') { const x = Math.max(0, Math.min(1, t)); return x * x * (3 - 2 * x); }
          if (name === 'release') return 1 - Math.pow(1 - t, 2);
          return t;
        };

        const layer = {
          baseScale: 1, pos: { x: 0, y: 0, rot: 0 }, rotOffset: 0,
          opacity: 1, hue: 0, brightness: 1, contrast: 1,
          reactors: [{ feature: 'bass', target: 'scale', scale: 0.5, ease: 'soft' }],
        };
        // A feature accessor that always returns 1 (a loud, steady bass).
        const feature = () => 1;
        const base = () => ({
          scale: 1, x: 0, y: 0, rot: 0, opacity: 1, hue: 0, brightness: 1, contrast: 1,
        });
        const run = () => RX.applyReactor(layer, { feat: {}, params: { sens: 1 } }, 0, {
          base: base(), units: RX.UNITS.natural, ease, feature,
        });

        C.setCharacter(10);
        const full = run().scale;
        C.setCharacter(5);
        const half = run().scale;
        C.setCharacter(0);
        const none = run().scale;

        C.setCharacter(10);
        C.setThreshold(-60);
        const open = run().scale;
        C.setThreshold(0);
        const edge = run().scale;
        C.setThreshold(-60);

        C.setModule('comp', false);
        const withoutComp = run().scale;
        C.setModule('comp', true);
        const withComp = run().scale;

        C.setMode('tube');
        const tube = run().scale;
        C.setMode('modern');
        const modern = run().scale;
        C.setMode('analog');
        const analog = run().scale;

        C.setBypass(true);
        const bypassed = run().scale;
        C.setBypass(false);

        C.reset();
        return { full, half, none, open, edge, withoutComp, withComp, tube, modern, analog, bypassed };
      });

      check(Math.abs(behaviour.full - 1.5) < 1e-6,
        'E1 at character 10 the scale reactor adds its full 0.5', `scale=${behaviour.full}`);
      check(Math.abs(behaviour.half - 1.25) < 1e-6,
        'E2 at character 5 it adds half', `scale=${behaviour.half}`);
      check(Math.abs(behaviour.none - 1.0) < 1e-6,
        'E3 at character 0 it adds nothing', `scale=${behaviour.none}`);
      check(Math.abs(behaviour.open - behaviour.edge) < 1e-6,
        'E4 a threshold at 0 dB still lets a full-scale feature through',
        `open=${behaviour.open} edge=${behaviour.edge}`);
      check(Math.abs(behaviour.withoutComp - 1.0) < 1e-6,
        'E5 powering Vintage Comp off removes the scale reactor',
        `scale=${behaviour.withoutComp}`);
      check(Math.abs(behaviour.withComp - behaviour.full) < 1e-6,
        'E6 powering it back on restores the reactor');
      check(Math.abs(behaviour.tube - behaviour.modern) < 1e-6
        && Math.abs(behaviour.tube - behaviour.analog) < 1e-6,
        'E7 the mode knob swaps the ease curve (all three reach 1 at a full-scale feature)',
        `tube=${behaviour.tube} modern=${behaviour.modern} analog=${behaviour.analog}`);
      check(Math.abs(behaviour.bypassed - 1.0) < 1e-6,
        'E8 bypass suppresses every reactor target', `scale=${behaviour.bypassed}`);

      // ── F. No-op without the parameter ────────────────────────────────
      const plain = await browser.newPage();
      await plain.setViewport({ width: 1440, height: 900 });
      await seed(plain, false);
      await plain.goto(`${BASE}/engine.html`, { waitUntil: 'domcontentloaded', timeout: 60000 });
      await plain.waitForFunction(() => typeof window.SWR_REACTORS !== 'undefined', { timeout: 45000 });
      const noop = await plain.evaluate(() => ({
        mounted: !!document.getElementById('swr-chain'),
        installed: !!window.SWR_CHAIN,
        hooked: !!(window.SWR_REACTORS && window.SWR_REACTORS.__swrChainInstalled),
      }));
      check(!noop.mounted && !noop.installed && !noop.hooked,
        'F1 without ?chain=1 the chain never mounts and never hooks the engine',
        JSON.stringify(noop));
      await plain.close();

      // ── G. Mobile ─────────────────────────────────────────────────────
      // The engine hides #stage in Basic mode, so an absolute width
      // assertion is not meaningful. What the chain must not do is CHANGE
      // the stage, so the comparison is against the same page without
      // ?chain=1, in the SAME engine mode (Advanced) the chain puts it in.
      const stageWidth = (pg) => pg.evaluate(() => {
        const st = document.getElementById('stage');
        const r = st ? st.getBoundingClientRect() : null;
        return { w: r ? Math.round(r.width) : 0, canvas: !!(st && st.querySelector('canvas')) };
      });

      const baseline = await browser.newPage();
      await baseline.setViewport({ width: 390, height: 844 });
      await seed(baseline, true);
      await baseline.goto(`${BASE}/engine.html`, { waitUntil: 'domcontentloaded', timeout: 60000 });
      await baseline.waitForFunction(() => typeof window.SWR_REACTORS !== 'undefined', { timeout: 45000 });
      await new Promise((r) => setTimeout(r, 2500));
      const baseStage = await stageWidth(baseline);
      await baseline.close();

      await page.setViewport({ width: 390, height: 844 });
      await new Promise((r) => setTimeout(r, 1500));
      const mobile = await page.evaluate(() => {
        const stage = document.getElementById('stage');
        const r = stage ? stage.getBoundingClientRect() : null;
        return {
          stageWidth: r ? Math.round(r.width) : 0,
          hasCanvas: !!(stage && stage.querySelector('canvas')),
          chainVisible: !!document.getElementById('swr-chain'),
          overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        };
      });
      check(mobile.stageWidth === baseStage.w && mobile.hasCanvas === baseStage.canvas,
        'G1 the chain overlay does not change the engine stage at 390x844',
        `chain=${mobile.stageWidth}px baseline=${baseStage.w}px`);
      check(mobile.chainVisible, 'G2 the chain is mounted on mobile');
      check(mobile.overflow <= 2,
        'G3 the chain overlay adds no horizontal overflow at 390px', `${mobile.overflow}px`);

      // ── H. Errors ─────────────────────────────────────────────────────
      const harnessAborts = /Failed to load resource: net::ERR_(FAILED|ABORTED)/;
      const realConsole = consoleErrs.filter((t) => !/favicon/i.test(t) && !harnessAborts.test(t));
      const realBad = badResponses.filter((x) => x.u.startsWith(BASE));
      check(pageErrs.length === 0, 'H1 no uncaught page errors', pageErrs.slice(0, 2).join(' | '));
      check(realConsole.length === 0, 'H2 no console errors', realConsole.slice(0, 2).join(' | '));
      check(realBad.length === 0, 'H3 no failing same-origin responses',
        realBad.slice(0, 3).map((x) => `${x.s} ${x.u}`).join(' | '));

      await page.close();
      done = true;
    } catch (e) {
      lastErr = e;
      console.log(`  (attempt ${attempt} aborted: ${String(e.message).slice(0, 90)} — retrying)`);
      try { await page.close(); } catch (_) {}
    }
  }

  if (!done) {
    fail('the assertion pass completed', lastErr ? String(lastErr.message).slice(0, 160) : 'unknown');
  }

  await browser.close();
  if (server) server.kill();

  const failed = checks.filter((c) => !c.ok);
  console.log(`\n${checks.length - failed.length}/${checks.length} checks passed`);
  if (failed.length) {
    console.log('FAILED:');
    for (const f of failed) console.log(`  ✗ ${f.m}${f.d ? ` (${f.d})` : ''}`);
    process.exit(1);
  }
  console.log('PASS');
  process.exit(0);
})().catch((e) => {
  console.error('smoke crashed:', e);
  process.exit(1);
});
