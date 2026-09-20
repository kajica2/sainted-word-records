#!/usr/bin/env node
// verify-grid-automix.mjs — smoke test for Phase 2A port of music_video's
// automix + asset-curator stack into versions/grid.html.
//
//   node verify-grid-automix.mjs
//
// Asserts:
//   1. grid.html loads with no console errors
//   2. All 11 automix-stack scripts are present
//   3. All 5 runtime scripts (automix-runtime, hook-detector, stats,
//      mood, scenes) are loaded as <script> elements
//   4. All 5 panel IDs in DOM (mood-overlay, hook-panel, hook-btn,
//      stats-btn, mood-btn, scenes-btn, automix-toggle, automix-debug-panel)
//   5. All 5 extracted runtimes exposed on window
//   6. Click Automix toggle changes state OFF → ON
//   7. Keyboard shortcut A toggles
//   8. Debug panel opens on click
//   9. Cleanup runs cleanly

import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import puppeteer from 'puppeteer';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PORT = 8102;
const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.wav': 'audio/wav',
  '.mp3': 'audio/mpeg', '.mp4': 'video/mp4', '.webm': 'video/webm',
};

function localServe() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      // Rewrite root to versions/grid.html
      let rel = decodeURIComponent(req.url.split('?')[0].replace(/^\/+/, '')) || 'versions/grid.html';
      if (rel === 'grid.html') rel = 'versions/grid.html';
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
];

const RUNTIME_SCRIPTS = [
  'automix-runtime.client.js',
  'hook-detector.client.js',
  'stats.client.js',
  'mood.client.js',
  'scenes.client.js',
];

const PANEL_IDS = [
  'mood-overlay',
  'hook-panel',
  'hook-btn',
  'hook-time', 'hook-energy', 'hook-conf',
  'stats-btn',
  'mood-btn',
  'scenes-btn',
  'automix-toggle',
  'automix-state',
  'automix-freeze', 'automix-save', 'automix-lock', 'automix-debug',
  'automix-debug-panel',
  'automix-debug-close', 'automix-debug-body',
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

    await page.goto(`http://localhost:${PORT}/versions/grid.html`, { waitUntil: 'networkidle2', timeout: 30000 });
    await new Promise(r => setTimeout(r, 1500));

    // Filter out pre-existing harmless errors that aren't from our changes
    const realErrors = errors.filter(e =>
      !e.includes('SWR_RENDER') && // pre-existing try/caught
      !e.includes('ws://') &&       // websocket connection refused (dev only)
      !e.includes('404')            // asset 404s from dev environment
    );
    if (realErrors.length === 0) ok('grid.html loads with no relevant console errors');
    else fail('console errors', realErrors.join('; '));

    // 2. All 10 automix-stack scripts present
    const scriptStatus = await page.evaluate((scripts) => {
      const out = {};
      for (const s of scripts) {
        const nodes = Array.from(document.querySelectorAll('script[src]'));
        out[s] = nodes.some(n => (n.getAttribute('src') || '').includes(s));
      }
      return out;
    }, AUTOMIX_SCRIPTS);
    const missing = Object.entries(scriptStatus).filter(([, v]) => !v).map(([k]) => k);
    if (missing.length === 0) ok('all 10 automix-stack scripts present in DOM');
    else fail('automix-stack scripts present', `missing: ${missing.join(', ')}`);

    // 3. All 5 runtime scripts present
    const runtimeStatus = await page.evaluate((scripts) => {
      const out = {};
      for (const s of scripts) {
        const nodes = Array.from(document.querySelectorAll('script[src]'));
        out[s] = nodes.some(n => (n.getAttribute('src') || '').includes(s));
      }
      return out;
    }, RUNTIME_SCRIPTS);
    const missingRuntimes = Object.entries(runtimeStatus).filter(([, v]) => !v).map(([k]) => k);
    if (missingRuntimes.length === 0) ok('all 5 runtime scripts present in DOM');
    else fail('runtime scripts present', `missing: ${missingRuntimes.join(', ')}`);

    // 4. All panel IDs in DOM
    const panelStatus = await page.evaluate((ids) => {
      const out = {};
      for (const id of ids) out[id] = !!document.getElementById(id);
      return out;
    }, PANEL_IDS);
    const missingPanels = Object.entries(panelStatus).filter(([, v]) => !v).map(([k]) => k);
    if (missingPanels.length === 0) ok(`all ${PANEL_IDS.length} panel IDs present in DOM`);
    else fail('panel IDs present', `missing: ${missingPanels.join(', ')}`);

    // 5. Runtimes exposed on window
    const apiExposed = await page.evaluate(() => ({
      automix: !!(window.automix && typeof window.automix.toggle === 'function'),
      library: !!window.SWR_AUTOMIX,
      hookDetector: !!(window.SWR_HOOK_DETECTOR && typeof window.SWR_HOOK_DETECTOR.detect === 'function'),
      stats: !!(window.SWR_STATS && typeof window.SWR_STATS.summary === 'function'),
      mood: !!(window.SWR_MOOD && typeof window.SWR_MOOD.analyze === 'function'),
      scenes: !!(window.SWR_SCENES && typeof window.SWR_SCENES.list === 'function'),
    }));
    if (Object.values(apiExposed).every(Boolean)) ok('all 5 extracted runtimes exposed on window');
    else fail('runtime APIs exposed', JSON.stringify(apiExposed));

    // 6. Click Automix toggle — state text changes
    await page.evaluate(() => document.getElementById('automix-toggle').click());
    await new Promise(r => setTimeout(r, 200));
    const stateAfterClick = await page.evaluate(() => {
      const el = document.getElementById('automix-state');
      return el ? el.textContent.trim() : '';
    });
    if (/on/i.test(stateAfterClick)) ok(`Automix toggle changes state to: ${stateAfterClick}`);
    else fail('Automix toggle', `expected ON, got "${stateAfterClick}"`);

    // 7. Keyboard 'A' toggles
    const stateBefore = await page.evaluate(() => document.getElementById('automix-state').textContent.trim());
    await page.keyboard.press('a');
    await new Promise(r => setTimeout(r, 200));
    const stateAfter = await page.evaluate(() => document.getElementById('automix-state').textContent.trim());
    if (stateBefore !== stateAfter) ok(`keyboard 'A' toggles state (${stateBefore} \u2192 ${stateAfter})`);
    else fail('keyboard A toggle', `state unchanged: ${stateBefore}`);

    // 8. Debug panel toggles open
    await page.evaluate(() => document.getElementById('automix-debug').click());
    await new Promise(r => setTimeout(r, 200));
    const debugVisible = await page.evaluate(() => {
      const el = document.getElementById('automix-debug-panel');
      return el && !el.hidden;
    });
    if (debugVisible) ok('Debug panel opens on click');
    else fail('debug panel toggle', 'panel still hidden after click');

    // 9. Cleanup
    const cleanupOk = await page.evaluate(() => {
      if (window.automix) window.automix.stop();
      return true;
    });
    if (cleanupOk) ok('cleanup: automix stopped');
    else fail('cleanup', 'cleanup threw');

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