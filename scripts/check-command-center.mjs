#!/usr/bin/env node
// scripts/check-command-center.mjs — the Studio Command Center browser smoke.
//
// The Command Center is ONE control surface injected into every engine
// variant, bound to the API the variants already publish. This suite runs
// against a real variant and asserts:
//
//   A. Install   — the launcher appears and the script publishes its API.
//   B. Open      — ?cc=1 opens it; Escape closes it.
//   C. Structure — the fourteen panels, the nav and the regions are present.
//   D. Stacking  — it paints ABOVE the host surface's own overlays
//                  (#swr-start sits at z-index 10000, the engine's tour at
//                  10001), so the two UIs never compete.
//   E. Data      — the panels are bound to REAL engine state, not placeholders.
//   F. Wiring    — the nav, the filters and the auto-drift switch actually do
//                  something.
//   G. Canvas    — every live canvas is actually sized and drawn (a canvas
//                  left at its default 300x150 is a panel that never painted).
//   H. Mobile    — no horizontal overflow at 390px.
//
// Run: node scripts/check-command-center.mjs
// Exit 0 on full pass, 1 otherwise.

import puppeteer from 'puppeteer';
import http from 'node:http';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const PORT = 54041;
const LOCAL_BASE = `http://127.0.0.1:${PORT}`;
const BASE = process.env.CC_BASE_URL || LOCAL_BASE;
const EXTERNAL_BASE = process.env.CC_BASE_URL || null;
const VARIANT = process.env.CC_VARIANT || 'neon';

const DIST = path.resolve('dist');
const SERVE_ROOT = fs.existsSync(path.join(DIST, 'versions', `${VARIANT}.html`)) ? DIST : process.cwd();

function startServer() {
  return new Promise((resolve, reject) => {
    const proc = spawn('python3', ['-m', 'http.server', String(PORT)], {
      cwd: SERVE_ROOT, stdio: 'ignore',
    });
    const start = Date.now();
    const tick = () => http.get(`${BASE}/versions/${VARIANT}.html`, (res) => {
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

let lastNav = Date.now();
function trackNavigations(page) {
  page.on('framenavigated', (f) => {
    try { if (f === page.mainFrame()) lastNav = Date.now(); } catch (_) { lastNav = Date.now(); }
  });
}

// pwa-bootstrap.js reloads the page when the service worker claims control
// for the first time. Standard first-visit PWA behaviour, not a defect —
// wait for the page to go quiet before asserting.
async function settle(page, quietMs = 2200, timeout = 45000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    try {
      await page.waitForFunction(() => !!window.SWR_COMMAND_CENTER, { timeout: 3000 });
      if (Date.now() - lastNav > quietMs) return true;
    } catch (_) { /* context gone */ }
    await new Promise((r) => setTimeout(r, 350));
  }
  return false;
}

(async () => {
  console.log(`command-center smoke → ${BASE}/versions/${VARIANT}.html`);
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

  const page = await browser.newPage();
  await page.setViewport({ width: 1600, height: 1000 });
  trackNavigations(page);

  // Seed the stored app version from the SERVED file so
  // lib/app-version-bust.js takes its fast path instead of clearing state
  // and hard-reloading up to 3x, which destroys the execution context
  // mid-assertion.
  const appVersion = await new Promise((resolve) => {
    http.get(`${BASE}/lib/app-version.js`, (res) => {
      let b = '';
      res.on('data', (c) => { b += c; });
      res.on('end', () => {
        const m = /SWR_APP_VERSION\s*=\s*['"]([^'"]+)['"]/.exec(b);
        resolve(m ? m[1] : 'dev');
      });
    }).on('error', () => resolve('dev'));
  });
  await page.evaluateOnNewDocument((v) => {
    try { localStorage.setItem('swr_app_version_seen', v); } catch (_) {}
  }, appVersion);
  await page.setRequestInterception(true);
  page.on('request', (req) => {
    const u = req.url();
    if (u.startsWith(BASE) || u.startsWith('data:') || u.startsWith('blob:')) return req.continue();
    return req.abort();
  });

  const pageErrs = [];
  const consoleErrs = [];
  page.on('pageerror', (e) => pageErrs.push(e.message));
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    if (/Failed to load resource/i.test(m.text())) return;
    // The variants' dev-server HMR client tries to reach the vite dev
    // websocket on :8787, which a static file server does not serve. That
    // is the variant's own dev tooling, not a Command Center defect.
    if (/WebSocket connection to|ws:\/\//i.test(m.text())) return;
    consoleErrs.push(m.text());
  });

  // The LAZY contract, asserted before anything else: without ?cc=1 the
  // implementation must NOT be loaded. The Command Center is ~67 KB of JS
  // and CSS, and every variant used to carry it whether the visitor wanted
  // it or not — which was enough to push neon's render loop past the
  // variants smoke's two-frame window (neon is walked first, so it ate the
  // cold-start cost).
  await page.goto(`${BASE}/versions/${VARIANT}.html`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await new Promise((r) => setTimeout(r, 2500));
  const lazy = await page.evaluate(() => ({
    launcher: !!document.getElementById('swr-cc-launch'),
    implementation: !!window.SWR_COMMAND_CENTER,
    implementationTag: !!document.querySelector('script[data-swr-cc]'),
    stylesheet: !!document.querySelector('link[data-swr-cc-css]'),
  }));
  check(lazy.launcher, 'A0 the ◈ launcher is present on the surface');
  check(!lazy.implementation && !lazy.implementationTag && !lazy.stylesheet,
    'A0b the implementation is NOT loaded until it is asked for',
    JSON.stringify(lazy));

  // Now ask for it: ?cc=1 makes the launcher inject the implementation.
  await page.goto(`${BASE}/versions/${VARIANT}.html?cc=1`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForFunction(
    () => !!window.SWR_COMMAND_CENTER && window.SWR_COMMAND_CENTER.isOpen(),
    { timeout: 30000 },
  ).catch(() => {});
  await settle(page);
  await new Promise((r) => setTimeout(r, 2500));

  // ── A. Install ───────────────────────────────────────────────────────
  const install = await page.evaluate(() => ({
    api: typeof window.SWR_COMMAND_CENTER,
    launcher: !!document.getElementById('swr-cc-launch'),
    launcherPressed: document.getElementById('swr-cc-launch')
      ? document.getElementById('swr-cc-launch').getAttribute('aria-pressed') : null,
  }));
  check(install.api === 'object', 'A1 window.SWR_COMMAND_CENTER is published');
  check(install.launcher, 'A2 the launcher button is injected');
  check(install.launcherPressed === 'true', 'A3 the launcher reflects the open state');

  // ── B. Open ──────────────────────────────────────────────────────────
  const open = await page.evaluate(() => ({
    open: window.SWR_COMMAND_CENTER.isOpen(),
    root: !!document.getElementById('swr-cc'),
    bodyClass: document.body.classList.contains('swr-cc-open'),
    rootHidden: document.getElementById('swr-cc')
      ? document.getElementById('swr-cc').hidden : null,
  }));
  check(open.open && open.root && open.bodyClass && open.rootHidden === false,
    'B1 ?cc=1 opens the Command Center', JSON.stringify(open));

  // ── C. Structure ─────────────────────────────────────────────────────
  const structure = await page.evaluate(() => {
    const titles = [...document.querySelectorAll('.swr-cc-panel-title')].map((n) => n.textContent);
    return {
      panels: document.querySelectorAll('.swr-cc-panel').length,
      titles,
      navButtons: document.querySelectorAll('[data-cc-section]').length,
      cols: document.querySelectorAll('.swr-cc-col').length,
      bottom: document.querySelectorAll('.swr-cc-bottom .swr-cc-panel').length,
      mirror: !!document.querySelector('.swr-cc-mirror'),
      knobs: document.querySelectorAll('[data-cc-knob]').length,
      demandCols: document.querySelectorAll('.swr-cc-demand-col').length,
      filterRows: document.querySelectorAll('[data-cc-filter]').length,
      faders: 0,
    };
  });
  check(structure.panels === 14, 'C1 fourteen panels', `got ${structure.panels}`);
  check(structure.navButtons === 6, 'C2 six nav sections', `got ${structure.navButtons}`);
  check(structure.cols === 3, 'C3 three columns', `got ${structure.cols}`);
  check(structure.bottom === 5, 'C4 five bottom panels', `got ${structure.bottom}`);
  check(structure.mirror, 'C5 the PROGRAM mirror canvas is present');
  check(structure.knobs === 3, 'C6 three audio knobs', `got ${structure.knobs}`);
  check(structure.demandCols === 4, 'C7 four peak-demand columns', `got ${structure.demandCols}`);
  check(structure.filterRows === 12, 'C8 twelve filter rows', `got ${structure.filterRows}`);
  const wantTitles = ['Audio Analysis', 'Personas', 'Layers lifecycle', 'Program', 'Library',
    'Filters', 'Recording / Export', 'Mood', 'Scenes', 'Beat confidence', 'Hook detector', 'Auto-drift',
    'Credits', 'Lifecycle cost / render time'];
  const missing = wantTitles.filter((t) => structure.titles.indexOf(t) === -1);
  check(missing.length === 0, 'C9 every expected panel is titled', missing.join('|'));

  // ── D. Stacking ──────────────────────────────────────────────────────
  const stacking = await page.evaluate(() => {
    const cc = document.getElementById('swr-cc');
    const cs = getComputedStyle(cc);
    const start = document.getElementById('swr-start');
    const startZ = start ? parseInt(getComputedStyle(start).zIndex, 10) || 0 : 0;
    return { ccZ: parseInt(cs.zIndex, 10) || 0, startZ };
  });
  check(stacking.ccZ > 10001,
    'D1 the Command Center paints above every host overlay',
    `cc=${stacking.ccZ} start=${stacking.startZ}`);

  // ── E. Data ──────────────────────────────────────────────────────────
  const data = await page.evaluate(() => {
    const C = window.SWR_COMMAND_CENTER;
    const personas = [...document.querySelectorAll('[data-cc-persona]')].map((n) => n.textContent);
    return {
      personas,
      api: {
        audio: !!(C.api.audio && C.api.audio.feat),
        fx: !!C.api.fx,
        stats: !!C.api.stats,
        hook: !!C.api.hook,
        mood: !!C.api.mood,
        scenes: !!C.api.scenes,
      },
      fxState: C.api.fx && C.api.fx.state ? Object.keys(C.api.fx.state).length : 0,
      hud: (document.querySelector('[data-cc-hud="stats"]') || {}).textContent,
      costText: (document.querySelector('[data-cc-cost]') || {}).textContent,
      hookText: (document.querySelector('[data-cc-hook]') || {}).textContent,
      moodPanel: !!document.querySelector('[data-cc-mood-status]'),
      scenesPanel: !!document.querySelector('[data-cc-scenes]'),
    };
  });
  check(data.personas.length > 0, 'E1 the personas panel is populated', `${data.personas.length} looks`);
  // Regression guard: SWR_LOOKS is an API OBJECT ({list, groups, apply,
  // current, refresh}); reading its keys produced a row of method names
  // instead of looks.
  const methodNames = ['list', 'groups', 'apply', 'current', 'refresh'];
  const leaked = data.personas.filter((p) => methodNames.indexOf(String(p).toLowerCase()) !== -1);
  check(leaked.length === 0, 'E2 the personas are real looks, not API method names',
    leaked.join('|'));
  check(data.api.audio, 'E3 the panel is bound to the live audio features');
  check(data.api.fx, 'E4 the FX stack is reachable');
  // Not every surface publishes every ledger: chrome has no SWR_STATS and
  // no SWR_HOOK_DETECTOR. The Command Center must degrade to "—" rather
  // than throw, so the assertion is that the panel is present and the
  // surface either exposes the API or degrades cleanly.
  check(data.api.stats || data.costText === '—',
    'E5 the render-cost panel is wired or degrades to "—"',
    data.api.stats ? 'stats present' : `cost="${data.costText}"`);
  check(data.api.hook || data.hookText === 'no hook detected',
    'E6 the hook panel is wired or degrades to "no hook detected"',
    data.api.hook ? 'hook present' : `hook="${data.hookText}"`);
  check(data.fxState > 5, 'E7 the FX state carries its real values', `${data.fxState} keys`);
  check(data.moodPanel, 'E8 Mood panel is present');
  check(data.scenesPanel, 'E9 Scenes panel is present');

  // ── F. Wiring ────────────────────────────────────────────────────────
  const wiring = await page.evaluate(() => {
    const C = window.SWR_COMMAND_CENTER;
    // Nav
    const personasTab = document.querySelector('.swr-cc-nav [data-cc-section="personas"]');
    personasTab.click();
    const navOn = document.querySelector('.swr-cc-nav [data-cc-section="personas"]')
      .getAttribute('aria-pressed');
    const section = document.getElementById('swr-cc').getAttribute('data-cc-active-section');
    // Filters: move a CSS filter slider and an FX slider.
    const cssInput = document.querySelector('[data-cc-filter="saturate"]');
    cssInput.value = '180';
    cssInput.dispatchEvent(new Event('input', { bubbles: true }));
    const cssState = C.state.filters.saturate;
    const mirrorFilter = document.querySelector('.swr-cc-mirror').style.filter;
    const fxInput = document.querySelector('[data-cc-filter="glow"]');
    fxInput.value = '60';
    fxInput.dispatchEvent(new Event('input', { bubbles: true }));
    const fxState = C.state.filters.glow;
    // Auto-drift switch
    const drift = document.querySelector('[data-cc-toggle="autodrift"]');
    drift.click();
    const driftOn = drift.getAttribute('aria-pressed');
    // A persona
    const p = document.querySelector('[data-cc-persona]');
    if (p) p.click();
    const personaPressed = p ? p.getAttribute('aria-pressed') : null;
    return { navOn, section, cssState, mirrorFilter, fxState, driftOn, personaPressed };
  });
  check(wiring.navOn === 'true' && wiring.section === 'personas',
    'F1 the nav switches sections', `${wiring.section}`);
  check(wiring.cssState === 180, 'F2 the CSS filter slider drives the state',
    `saturate=${wiring.cssState}`);
  check(/saturate\(180\)/.test(wiring.mirrorFilter || ''),
    'F3 the CSS filter reaches the mirror canvas', wiring.mirrorFilter);
  check(wiring.fxState === 60, 'F4 the FX slider drives the state', `glow=${wiring.fxState}`);
  check(wiring.driftOn === 'true', 'F5 the auto-drift switch toggles');
  check(wiring.personaPressed === 'true', 'F6 selecting a persona marks it pressed');

  // ── G. Canvas ────────────────────────────────────────────────────────
  // Regression guard: the gauge / hook / cost canvases were once queried by
  // a data-attribute that did not exist, so they stayed at the default
  // 300x150 and never painted.
  const canvases = await page.evaluate(() => {
    const out = {};
    for (const [k, sel] of Object.entries({
      spectrum: '.swr-cc-spectrum-canvas',
      gauge: '.swr-cc-gauge',
      hook: '.swr-cc-spark--hook',
      cost: '.swr-cc-spark--cost',
      layers: '.swr-cc-spark:not(.swr-cc-spark--hook):not(.swr-cc-spark--cost)',
      mirror: '.swr-cc-mirror',
    })) {
      const c = document.querySelector(sel);
      out[k] = c ? { w: c.width, h: c.height, cw: c.clientWidth, ch: c.clientHeight } : null;
    }
    return out;
  });
  const badCanvas = Object.entries(canvases)
    .filter(([, v]) => !v || v.w === 300 || v.h === 150 || v.cw === 0)
    .map(([k]) => k);
  check(badCanvas.length === 0, 'G1 every live canvas was fitted and drawn',
    badCanvas.join('|') || 'all fitted');

  // ── H. Mobile ────────────────────────────────────────────────────────
  await page.setViewport({ width: 390, height: 844 });
  await new Promise((r) => setTimeout(r, 1200));
  const mobile = await page.evaluate(() => ({
    overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    ccVisible: !!document.getElementById('swr-cc'),
    panels: document.querySelectorAll('.swr-cc-panel').length,
  }));
  check(mobile.ccVisible && mobile.panels === 14, 'H1 the Command Center is intact on mobile');
  check(mobile.overflow <= 2, 'H2 no horizontal overflow at 390px', `${mobile.overflow}px`);

  // ── Close ────────────────────────────────────────────────────────────
  await page.keyboard.press('Escape');
  await new Promise((r) => setTimeout(r, 600));
  const closed = await page.evaluate(() => ({
    open: window.SWR_COMMAND_CENTER.isOpen(),
    hidden: document.getElementById('swr-cc').hidden,
  }));
  check(!closed.open && closed.hidden, 'I1 Escape closes the Command Center');

  // ── Errors ───────────────────────────────────────────────────────────
  check(pageErrs.length === 0, 'J1 no uncaught page errors', pageErrs.slice(0, 2).join(' | '));
  check(consoleErrs.length === 0, 'J2 no console errors', consoleErrs.slice(0, 2).join(' | '));

  await page.close();
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
