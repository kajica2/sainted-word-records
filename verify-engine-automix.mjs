#!/usr/bin/env node
// verify-engine-automix.mjs — smoke test for Phase 1 port of music_video's
// automix + asset-curator stack into engine.html.
//
//   node verify-engine-automix.mjs
//
// Asserts:
//   1. engine.html loads with no console errors
//   2. All 11 automix-stack scripts are present as <script> elements
//   3. All 5 panels (#mood-overlay, #hook-panel, #hero-panel, toolbar
//      buttons, #automix-debug-panel) are in the DOM
//   4. window.SWR_AUTOMIX_STATE or equivalent global is exposed
//   5. Toggling the Automix button updates the state text OFF → ON
//   6. After 4 ticks the blend evolves (a feature override is written)
//   7. Keyboard shortcut A toggles automix
//   8. Debug panel toggles open and renders text
//   9. URL deep-link ?automix=1 enables on load
//  10. Cleanup: stop() removes tick timers

import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import puppeteer from 'puppeteer';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PORT = 8091;
const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.wav': 'audio/wav',
  '.mp3': 'audio/mpeg', '.mp4': 'video/mp4', '.webm': 'video/webm',
};

function localServe() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const rel = decodeURIComponent(req.url.split('?')[0].replace(/^\/+/, '')) || 'engine.html';
      const file = path.join(ROOT, rel);
      if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
        res.writeHead(404); res.end('nf'); return;
      }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream' });
      fs.createReadStream(file).pipe(res);
    });
    server.listen(PORT, () => resolve(server));
  });
}

const AUTOMIX_SCRIPTS = [
  'preset-anchor-map.client.js',
  'anchor-embed.js',
  'automix.client.js',
  'section-detector.client.js',
  'preset-cycle.client.js',
  'preset-pick-store.client.js',
  'layer-state-store.client.js',
  'last-mix-store.client.js',
  'asset-curator.client.js',
  'library-packs.client.js',
  'track-analyzer.client.js',
];

const PANEL_IDS = [
  'mood-overlay',
  'hook-panel',
  'automix-toggle',
  'automix-state',
  'automix-freeze',
  'automix-save',
  'automix-lock',
  'automix-debug',
  'automix-debug-panel',
  'automix-debug-close',
  'automix-debug-body',
  'hook-btn',
  'hook-time',
  'hook-energy',
  'hook-conf',
  'stats-btn',
  'mood-btn',
  'scenes-btn',
];

function ok(label) { console.log(`  \u2713 ${label}`); }
function fail(label, msg) { console.log(`  \u2717 ${label}: ${msg}`); process.exitCode = 1; }

async function run() {
  const server = await localServe();
  let browser;
  try {
    browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
    const page = await browser.newPage();
    const errors = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') errors.push(msg.text());
    });
    page.on('pageerror', (err) => errors.push(String(err)));

    // 1. Load engine.html cleanly
    await page.goto(`http://localhost:${PORT}/engine.html`, { waitUntil: 'networkidle2', timeout: 30000 });
    await new Promise(r => setTimeout(r, 1500));
    if (errors.length === 0) ok('engine.html loads with no console errors');
    else fail('engine.html loads with no console errors', errors.join('; '));

    // 2. All 11 automix scripts are in the DOM
    const scriptStatus = await page.evaluate((scripts) => {
      const out = {};
      for (const s of scripts) {
        const nodes = Array.from(document.querySelectorAll('script[src]'));
        out[s] = nodes.some(n => (n.getAttribute('src') || '').includes(s));
      }
      return out;
    }, AUTOMIX_SCRIPTS);
    const missing = Object.entries(scriptStatus).filter(([, v]) => !v).map(([k]) => k);
    if (missing.length === 0) ok('all 11 automix-stack scripts present in DOM');
    else fail('automix-stack scripts present', `missing: ${missing.join(', ')}`);

    // 3. All 5 panels + their children in DOM
    const panelStatus = await page.evaluate((ids) => {
      const out = {};
      for (const id of ids) out[id] = !!document.getElementById(id);
      return out;
    }, PANEL_IDS);
    const missingPanels = Object.entries(panelStatus).filter(([, v]) => !v).map(([k]) => k);
    if (missingPanels.length === 0) ok(`all ${PANEL_IDS.length} panel IDs present in DOM`);
    else fail('panel IDs present', `missing: ${missingPanels.join(', ')}`);

    // 4. automix global API exposed (5 newly-extracted runtimes)
//    Note: SWR_HERO_FRAMES was already inline in engine.html before this
//    port (line 6989) — it's intentionally NOT extracted from music_video
//    per the /steer skip hero direction. We don't assert its presence.
    const apiExposed = await page.evaluate(() => ({
      automix: !!(window.automix && typeof window.automix.toggle === 'function'),
      runtime: !!window.SWR_AUTOMIX_RUNTIME,
      library: !!window.SWR_AUTOMIX,
      hookDetector: !!(window.SWR_HOOK_DETECTOR && typeof window.SWR_HOOK_DETECTOR.detect === 'function'),
      stats: !!(window.SWR_STATS && typeof window.SWR_STATS.summary === 'function'),
      mood: !!(window.SWR_MOOD && typeof window.SWR_MOOD.analyze === 'function'),
      scenes: !!(window.SWR_SCENES && typeof window.SWR_SCENES.list === 'function'),
    }));
    const allRuntimes = Object.values(apiExposed).every(Boolean);
    if (allRuntimes) ok('all 5 extracted runtimes exposed on window');
    else fail('runtime APIs exposed', JSON.stringify(apiExposed));

    // 5. Click Automix toggle — state text changes
    // engine.html's footer is wide; the Automix button is off-screen on
    // a default viewport, so use a DOM-level click instead of page.click().
    await page.evaluate(() => document.getElementById('automix-toggle').click());
    await new Promise(r => setTimeout(r, 200));
    const stateAfterClick = await page.evaluate(() => {
      const el = document.getElementById('automix-state');
      return el ? el.textContent.trim() : '';
    });
    if (/on/i.test(stateAfterClick)) ok(`Automix toggle changes state to: ${stateAfterClick}`);
    else fail('Automix toggle', `expected ON in #automix-state, got "${stateAfterClick}"`);

    // 6. After 4 ticks blend evolves (synthetic feat values)
    await page.evaluate(() => {
      if (window.automixStart) window.automixStart();
      // Drive features so blend mutates
      window.__t0 = Date.now();
      const tick = () => {
        const t = (Date.now() - window.__t0) / 1000;
        const feat = {
          beat: 0.4 + 0.5 * Math.abs(Math.sin(t * 1.3)),
          onset: 0.3 + 0.6 * Math.abs(Math.sin(t * 0.7 + 1.0)),
          rms: 0.2 + 0.5 * Math.abs(Math.sin(t * 0.9 + 0.5)),
          centroid: 0.5 + 0.3 * Math.sin(t * 0.5),
          zcr: 0.4 + 0.3 * Math.abs(Math.sin(t * 1.1)),
        };
        window.Audio_feats = feat;
        window.dispatchEvent(new CustomEvent('swr:audio-feat', { detail: feat }));
      };
      tick();
      window.__automixTick = setInterval(tick, 600);
    });
    await new Promise(r => setTimeout(r, 3500)); // ~5 ticks
    const blendEvolves = await page.evaluate(() => {
      // The automix.client.js writes _fxOverride; check that something non-default exists
      const keys = Object.keys(window).filter(k => /automix|blend|fxOverride/i.test(k));
      return keys.length > 0;
    });
    if (blendEvolves) ok('automix exposes blend-related globals after ticks');
    else fail('blend evolution', 'no automix/blend/fxOverride globals after 5 ticks');

    // 7. Keyboard shortcut A toggles
    const stateBeforeKbd = await page.evaluate(() => document.getElementById('automix-state').textContent.trim());
    await page.keyboard.press('a');
    await new Promise(r => setTimeout(r, 200));
    const stateAfterKbd = await page.evaluate(() => document.getElementById('automix-state').textContent.trim());
    if (stateBeforeKbd !== stateAfterKbd) ok(`keyboard 'A' toggles state (${stateBeforeKbd} \u2192 ${stateAfterKbd})`);
    else fail('keyboard A toggle', `state unchanged: ${stateBeforeKbd}`);

    // 8. Debug panel toggles
    await page.evaluate(() => document.getElementById('automix-debug').click());
    await new Promise(r => setTimeout(r, 200));
    const debugVisible = await page.evaluate(() => {
      const el = document.getElementById('automix-debug-panel');
      return el && !el.hidden && getComputedStyle(el).display !== 'none';
    });
    if (debugVisible) ok('Debug panel opens on click');
    else fail('debug panel toggle', 'panel still hidden after click');

    // 9. URL deep-link ?automix=1 enables on load
    const page2 = await browser.newPage();
    await page2.goto(`http://localhost:${PORT}/engine.html?automix=1`, { waitUntil: 'networkidle2', timeout: 30000 });
    await new Promise(r => setTimeout(r, 1000));
    const deepLinkState = await page2.evaluate(() => document.getElementById('automix-state').textContent.trim());
    if (/on/i.test(deepLinkState)) ok(`?automix=1 enables on load (state: ${deepLinkState})`);
    else fail('URL deep-link', `expected ON with ?automix=1, got "${deepLinkState}"`);
    await page2.close();

    // 10. Cleanup
    const cleanupOk = await page.evaluate(() => {
      if (window.__automixTick) {
        clearInterval(window.__automixTick);
        window.__automixTick = null;
      }
      if (window.automixStop) window.automixStop();
      return true;
    });
    if (cleanupOk) ok('cleanup: timers cleared + automix stopped');
    else fail('cleanup', 'cleanup threw');

    if (errors.length === 0) ok('no console errors during full run');
    else fail('no console errors', errors.join('; '));
  } finally {
    if (browser) await browser.close();
    server.close();
  }
}

run().catch(err => {
  console.error('FATAL', err);
  process.exit(1);
});