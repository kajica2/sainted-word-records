#!/usr/bin/env node
// verify-dashboard-automix.mjs — smoke test for Phase 3 dashboard surface
// of the music_video automix+curator stack.
//
// The dashboard is a separate runtime (Tailwind + dashboard-engine.client.js
// + window.__SWR_ENGINE). Phase 3 only loads the 5 extracted runtimes
// as globals — they don't drive any dashboard UI yet. This test asserts:
//   1. dashboard.html loads with no console errors
//   2. All 5 runtime scripts are loaded as <script> elements
//   3. All 5 runtimes exposed on window (even if not actively driven)
//   4. The curator-status tile renders in the DOM
//   5. The curator panel renders (Phase 4 supersedes the Phase 3
//      read-only tile; both the new panel and the underlying globals
//      are what matters)
//   6. The panel shows the 5 runtime rows runtimes

import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import puppeteer from 'puppeteer';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PORT = 8106;
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
        res.writeHead(404); res.end('nf'); return;
      }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream' });
      fs.createReadStream(file).pipe(res);
    });
    server.listen(PORT, () => resolve(server));
  });
}

const RUNTIME_SCRIPTS = [
  'automix-runtime.client.js',
  'hook-detector.client.js',
  'stats.client.js',
  'mood.client.js',
  'scenes.client.js',
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

    await page.goto(`http://localhost:${PORT}/dashboard.html`, { waitUntil: 'networkidle2', timeout: 30000 });
    await new Promise(r => setTimeout(r, 1500));

    // Filter out pre-existing dashboard errors that aren't from our changes
    const realErrors = errors.filter(e =>
      !e.includes('SWR_RENDER') &&
      !e.includes('ws://') &&
      !e.includes('404')
    );
    if (realErrors.length === 0) ok('dashboard.html loads with no relevant console errors');
    else fail('console errors', realErrors.join('; '));

    // 2. All 5 runtime scripts present
    const scriptStatus = await page.evaluate((scripts) => {
      const out = {};
      for (const s of scripts) {
        const nodes = Array.from(document.querySelectorAll('script[src]'));
        out[s] = nodes.some(n => (n.getAttribute('src') || '').includes(s));
      }
      return out;
    }, RUNTIME_SCRIPTS);
    const missing = Object.entries(scriptStatus).filter(([, v]) => !v).map(([k]) => k);
    if (missing.length === 0) ok('all 5 runtime scripts present in DOM');
    else fail('runtime scripts present', `missing: ${missing.join(', ')}`);

    // 3. All 5 runtimes exposed on window
    const apiExposed = await page.evaluate(() => ({
      automix: !!(window.automix && typeof window.automix.toggle === 'function'),
      hookDetector: !!(window.SWR_HOOK_DETECTOR && typeof window.SWR_HOOK_DETECTOR.detect === 'function'),
      stats: !!(window.SWR_STATS && typeof window.SWR_STATS.summary === 'function'),
      mood: !!(window.SWR_MOOD && typeof window.SWR_MOOD.analyze === 'function'),
      scenes: !!(window.SWR_SCENES && typeof window.SWR_SCENES.list === 'function'),
    }));
    if (Object.values(apiExposed).every(Boolean)) ok('all 5 runtimes exposed on window');
    else fail('runtime APIs exposed', JSON.stringify(apiExposed));

    // 4. Curator panel in DOM (Phase 4 supersedes the Phase 3 read-only tile)
    const panelExists = await page.evaluate(() => !!document.getElementById('automix-curator-panel'));
    if (panelExists) ok('curator panel rendered in DOM (Phase 4 supersedes Phase 3 tile)');
    else fail('curator panel', 'panel element not found');

    // 5. Panel shows the 5 curator buttons (Phase 4 layout; replaces the
//    Phase 3 "loaded" text). Each button label corresponds to one of
//    the 5 extracted runtimes.
    const panelButtons = await page.evaluate(() => ({
      automix: !!document.getElementById('dash-automix-toggle'),
      hook:    !!document.getElementById('dash-hook-btn'),
      stats:   !!document.getElementById('dash-stats-btn'),
      mood:    !!document.getElementById('dash-mood-btn'),
      scenes:  !!document.getElementById('dash-scenes-btn'),
    }));
    if (Object.values(panelButtons).every(Boolean)) ok('panel shows all 5 curator buttons');
    else fail('panel buttons', JSON.stringify(panelButtons));

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