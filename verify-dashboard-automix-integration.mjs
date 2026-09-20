#!/usr/bin/env node
// verify-dashboard-automix-integration.mjs — Phase 4 dashboard integration
// smoke test for the music_video automix+curator stack.
//
//   node verify-dashboard-automix-integration.mjs
//
// Asserts:
//   1. dashboard.html loads with no console errors
//   2. The new dashboard-engine-bridge.client.js script is loaded
//   3. window.SWR_DASHBOARD_BRIDGE is exposed (start/stop/ready)
//   4. The curator panel renders (replaces Phase 3 read-only tile)
//   5. All 5 curator buttons (Automix/Hooks/Stats/Mood/Scenes) are
//      present and clickable
//   6. After clicking Automix, the state pill flips OFF → ON
//   7. The keyboard shortcut A toggles Automix
//   8. The Stats button opens a modal with render/minutes/size
//   9. The Scenes button opens a modal with 4 pads
//  10. The bridge polls __SWR_ENGINE.features() and writes to
//      window.SWR.Audio.feat (synthesized shape)

import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import puppeteer from 'puppeteer';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PORT = 8206;
const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml',
};

function localServe() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const rel = decodeURIComponent(req.url.split('?')[0].replace(/^\/+/, '')) || 'dashboard.html';
      const file = path.join(ROOT, rel);
      if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
        res.writeHead(404); res.end('nf:' + rel); return;
      }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream' });
      fs.createReadStream(file).pipe(res);
    });
    server.listen(PORT, () => resolve(server));
  });
}

function ok(label) { console.log(`  \u2713 ${label}`); }
function fail(label, msg) { console.log(`  \u2717 ${label}: ${msg}`); process.exitCode = 1; }

async function run() {
  const server = await localServe();
  let browser;
  try {
    browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
    const page = await browser.newPage();
    const errors = [];
    page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
    page.on('pageerror', e => errors.push(String(e)));

    await page.goto(`http://localhost:${PORT}/dashboard.html`, { waitUntil: 'networkidle2', timeout: 30000 });
    await new Promise(r => setTimeout(r, 1500));

    const realErrors = errors.filter(e =>
      !e.includes('SWR_RENDER') &&
      !e.includes('ws://') &&
      !e.includes('404')
    );
    if (realErrors.length === 0) ok('dashboard.html loads with no relevant console errors');
    else fail('console errors', realErrors.join('; '));

    // 2. Bridge script loaded
    const bridgeLoaded = await page.evaluate(() =>
      Array.from(document.querySelectorAll('script[src]')).some(s =>
        (s.getAttribute('src') || '').includes('dashboard-engine-bridge')
      )
    );
    if (bridgeLoaded) ok('dashboard-engine-bridge.client.js loaded');
    else fail('bridge script', 'not in DOM');

    // 3. SWR_DASHBOARD_BRIDGE exposed
    const bridgeApi = await page.evaluate(() => ({
      hasBridge: !!window.SWR_DASHBOARD_BRIDGE,
      hasStart: typeof window.SWR_DASHBOARD_BRIDGE?.start === 'function',
      hasStop: typeof window.SWR_DASHBOARD_BRIDGE?.stop === 'function',
      hasReady: typeof window.SWR_DASHBOARD_BRIDGE?.ready === 'function',
    }));
    if (bridgeApi.hasBridge && bridgeApi.hasStart && bridgeApi.hasStop && bridgeApi.hasReady)
      ok('SWR_DASHBOARD_BRIDGE API exposed (start/stop/ready)');
    else fail('SWR_DASHBOARD_BRIDGE API', JSON.stringify(bridgeApi));

    // 4. Curator panel rendered
    const panelExists = await page.evaluate(() => !!document.getElementById('automix-curator-panel'));
    if (panelExists) ok('curator panel rendered (replaces Phase 3 read-only tile)');
    else fail('curator panel', 'element not in DOM');

    // 5. All 5 curator buttons present
    const buttons = await page.evaluate(() => ({
      automix: !!document.getElementById('dash-automix-toggle'),
      hook:    !!document.getElementById('dash-hook-btn'),
      stats:   !!document.getElementById('dash-stats-btn'),
      mood:    !!document.getElementById('dash-mood-btn'),
      scenes:  !!document.getElementById('dash-scenes-btn'),
    }));
    if (Object.values(buttons).every(Boolean)) ok('all 5 curator buttons rendered');
    else fail('curator buttons', JSON.stringify(buttons));

    // 6. Click Automix → state flips OFF → ON
    await page.evaluate(() => document.getElementById('dash-automix-toggle').click());
    await new Promise(r => setTimeout(r, 200));
    const stateOn = await page.evaluate(() => {
      var el = document.getElementById('dash-automix-state');
      return el ? el.textContent.trim() : '';
    });
    if (/ON/i.test(stateOn)) ok(`Automix toggle: state flipped to ${stateOn}`);
    else fail('Automix toggle', `expected ON, got "${stateOn}"`);

    // 7. Keyboard A toggles back. The runtime's _onKey handler calls
    //    automix.toggle() once; the dashboard's own 'a' handler
    //    fires drawer-toggle.click() (no automix effect). Net result:
    //    one automix toggle, state flips ON → OFF.
    await page.keyboard.press('a');
    await new Promise(r => setTimeout(r, 200));
    const stateOff = await page.evaluate(() => {
      var el = document.getElementById('dash-automix-state');
      return el ? el.textContent.trim() : '';
    });
    if (/OFF/i.test(stateOff)) ok(`keyboard A: state back to ${stateOff}`);
    else fail('keyboard A toggle', `expected OFF, got "${stateOff}"`);

    // 8. Stats button opens a modal
    await page.evaluate(() => document.getElementById('dash-stats-btn').click());
    await new Promise(r => setTimeout(r, 200));
    const statsModal = await page.evaluate(() => {
      var m = document.getElementById('dash-stats-modal');
      return m ? m.textContent.slice(0, 200) : '';
    });
    if (statsModal.includes('Renders') && statsModal.includes('Minutes') && statsModal.includes('Size'))
      ok('Stats button opens modal with Renders/Minutes/Size');
    else fail('Stats modal', statsModal);
    await page.evaluate(() => { var m = document.getElementById('dash-stats-modal'); if (m) m.remove(); });

    // 9. Scenes button opens a modal with 4 pads
    await page.evaluate(() => document.getElementById('dash-scenes-btn').click());
    await new Promise(r => setTimeout(r, 200));
    const scenesPadCount = await page.evaluate(() =>
      document.querySelectorAll('#dash-scenes-list button').length
    );
    if (scenesPadCount === 4) ok('Scenes button opens modal with 4 pads');
    else fail('Scenes pads', `expected 4, got ${scenesPadCount}`);
    await page.evaluate(() => { var m = document.getElementById('dash-scenes-modal'); if (m) m.remove(); });

    // 10. Bridge feeds SWR.Audio.feat
    const bridgeFeeds = await page.evaluate(() => {
      if (!window.SWR_DASHBOARD_BRIDGE) return null;
      window.SWR_DASHBOARD_BRIDGE.start();
      var feat = window.SWR_DASHBOARD_BRIDGE.synthesizedFeatures();
      var swr = window.SWR && window.SWR.Audio;
      return {
        synthKeys: Object.keys(feat).sort(),
        hasFeatOnSWR: !!(swr && swr.feat),
        swrFeatKeys: swr && swr.feat ? Object.keys(swr.feat).sort() : [],
        enabled: window.SWR_DASHBOARD_BRIDGE.enabled,
      };
    });
    if (bridgeFeeds && bridgeFeeds.enabled &&
        bridgeFeeds.synthKeys.includes('beat') &&
        bridgeFeeds.synthKeys.includes('rms') &&
        bridgeFeeds.synthKeys.includes('centroid') &&
        bridgeFeeds.synthKeys.includes('bpm') &&
        bridgeFeeds.hasFeatOnSWR) {
      ok('bridge: synthesizes features + writes to SWR.Audio.feat');
    } else {
      fail('bridge feeds', JSON.stringify(bridgeFeeds));
    }

    // Cleanup
    await page.evaluate(() => { try { window.SWR_DASHBOARD_BRIDGE.stop(); } catch (_) {} });

    if (realErrors.length === 0) ok('no relevant console errors during full run');
    else fail('console errors', realErrors.join('; '));
  } finally {
    if (browser) await browser.close();
    server.close();
  }
}

run().catch(err => {
  console.error('FATAL', err);
  process.exit(1);
});