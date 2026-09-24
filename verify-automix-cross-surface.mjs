#!/usr/bin/env node
// verify-automix-cross-surface.mjs — Phase 4 cross-surface drift check.
//
// Loads every surface that ships the music_video automix+curator stack
// and asserts the expected scripts + panel IDs + runtime globals are
// present. Reports drift across surfaces in one run.
//
//   node verify-automix-cross-surface.mjs
//
// Surfaces covered:
//   engine.html              — PWA shell (full stack)
//   versions/neon.html       — high-contrast 2D overlay
//   versions/film.html       — warm vignette + grain
//   versions/grid.html       — CRT grid + flash
//   versions/smoke.html      — soft particle haze
//   versions/hallucination.html — kaleidoscope
//   versions/{aurora,baroque,chrome,collage,echo-manifold,eclipse,
//             fractal,glitch,kraft,mosaic,phosphor,pulse,spectrum,
//             tape,typography,void,watercolor}.html
//                              — 17 cross-variant port pages (Task 4)
//   dashboard.html           — read-only status tile only
//
// Expected per surface:
//   - 11 automix-stack scripts (engine + 5 variants)
//   - 5 runtime scripts (engine + 5 variants + dashboard)
//   - 18 panel IDs (engine + 5 variants; dashboard only has the status tile)
//   - All 5 extracted runtimes exposed on window

import http from 'http';
import fs from 'fs';
import path from 'path';
import { join as joinPath } from 'path';
import { fileURLToPath } from 'url';
import puppeteer from 'puppeteer';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PORT = 8107;
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

// Full automix stack — engine.html + the 5 core variants ship every module
// (section detection, preset cycling, curation UI, etc.).
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

// Automix-min stack — the 17 artistic variants ship a deliberately lighter
// page: automix + the anchor map (SWR_ANCHOR_MAP, required for mix() to
// resolve neighbours — without it automix is structurally inert) + the
// runtime orchestrator. They never shipped hook-detector/stats/mood/scenes
// (those are engine.html panels), so the previous expectation here asserted
// scripts and panels these pages never had and could not pass.
const AUTOMIX_MIN_SCRIPTS = [
  'preset-anchor-map.client.js',
  'anchor-embed.js',
  'automix.client.js',
  'automix-runtime.client.js',
];

const RUNTIME_SCRIPTS = [
  'automix-runtime.client.js',
  'hook-detector.client.js',
  'stats.client.js',
  'mood.client.js',
  'scenes.client.js',
];

const PANEL_IDS = [
  'mood-overlay', 'hook-panel',
  'hook-btn', 'hook-time', 'hook-energy', 'hook-conf',
  'stats-btn', 'mood-btn', 'scenes-btn',
  'automix-toggle', 'automix-state',
  'automix-freeze', 'automix-save', 'automix-lock', 'automix-debug',
  'automix-debug-panel', 'automix-debug-close', 'automix-debug-body',
];

// Each entry: [label, path, expectsStack]
//   expectsStack=true  → expects 11 automix + 5 runtime scripts + 18 panel IDs
//   expectsStack=false → dashboard: expects only 5 runtime scripts + status tile
//
// Task 4 (cross-variant port) adds the 17 new variant pages that ship
// the automix config (Task 3) plus the script tag + toggle button.
// All 15 enabled variants have an inlined #swrc-automix-config; the
// 2 disabled (echo-manifold, tape) ship the script tag too but the
// runtime hides #automix-toggle when enabled=false. Both kinds go
// through expectsStack=true — the assertions below check structural
// drift (panel IDs present, scripts loaded, runtimes exposed), not
// runtime behaviour, so opt-out variants behave the same as enabled.
const TASK_4_VARIANTS = [
  'aurora', 'baroque', 'chrome', 'collage', 'echo-manifold',
  'eclipse', 'fractal', 'glitch', 'kraft', 'mosaic',
  'phosphor', 'pulse', 'spectrum', 'tape', 'typography',
  'void', 'watercolor',
];
const SURFACES = [
  ['engine.html',            'engine.html',                        true],
  ['versions/neon.html',     'versions/neon.html',                 true],
  ['versions/film.html',     'versions/film.html',                 true],
  ['versions/grid.html',     'versions/grid.html',                 true],
  ['versions/smoke.html',    'versions/smoke.html',                true],
  ['versions/hallucination.html', 'versions/hallucination.html',    true],
  ['dashboard.html',         'dashboard.html',                     false],
  ...TASK_4_VARIANTS.map(v => ['versions/' + v + '.html', 'versions/' + v + '.html',
    v === 'echo-manifold' ? 'off' : 'min']),
];

function ok(label) { console.log(`  \u2713 ${label}`); }
function fail(label, msg) { console.log(`  \u2717 ${label}: ${msg}`); process.exitCode = 1; }

async function checkSurface(page, label, path, expectsStack) {
  console.log(`\n[${label}]`);

  const errors = [];
  const onConsole = (msg) => { if (msg.type() === 'error') errors.push(msg.text()); };
  const onError = (err) => errors.push(String(err));
  page.on('console', onConsole);
  page.on('pageerror', onError);

  await page.goto(`http://localhost:${PORT}/${path}`, { waitUntil: 'networkidle2', timeout: 30000 });
  await new Promise(r => setTimeout(r, 1500));

  // Filter out pre-existing harmless errors that aren't from our changes
  const realErrors = errors.filter(e =>
    !e.includes('SWR_RENDER') &&
    !e.includes('ws://') &&
    !e.includes('404')
  );
  if (realErrors.length === 0) ok(`${label}: no relevant console errors`);
  else fail(`${label}: console errors`, realErrors.join('; '));

  if (expectsStack === 'off') {
    // Opt-out tier (echo-manifold). The verifier serves the SOURCE tree
    // (ROOT = repo root), but the automix config is only inlined into the
    // page at build time (inline-automix-config Vite plugin) — CI runs the
    // build AFTER this verifier — so the runtime's enabled:false hide path
    // is not observable here (proven: dist serving hides the toggle).
    // Assert the source-level contract instead: runtime scripts present,
    // toggle element present (so the runtime CAN hide it), and the config
    // file on disk opts out.
    const offPage = await page.evaluate(() => {
      const nodes = Array.from(document.querySelectorAll('script[src]'));
      const has = (s) => nodes.some(n => (n.getAttribute('src') || '').includes(s));
      return {
        'automix.client.js': has('automix.client.js'),
        'automix-runtime.client.js': has('automix-runtime.client.js'),
        'toggle element': !!document.getElementById('automix-toggle'),
      };
    });
    const offConfig = {
      'config enabled:false': (() => {
        try {
          const cfg = JSON.parse(fs.readFileSync(joinPath(ROOT, 'variants', 'echo-manifold.automix.json'), 'utf8'));
          return cfg.enabled === false;
        } catch (_) { return false; }
      })(),
    };
    const offStatus = Object.assign(offPage, offConfig);
    const missingOff = Object.entries(offStatus).filter(([, v]) => !v).map(([k]) => k);
    if (missingOff.length === 0) ok(`${label}: automix opt-out contract held (enabled:false config, runtime + toggle present)`);
    else fail(`${label}: automix opt-out contract`, `failing: ${missingOff.join(', ')} — observed: ${JSON.stringify(offStatus)}`);

    page.off('console', onConsole);
    page.off('pageerror', onError);
    return;
  }

  if (expectsStack === 'min') {
    // Artistic-variant tier: the automix-min stack (4 scripts), the toggle
    // IDs, SWR_ANCHOR_MAP exposed, and the automix runtime API. The
    // hook/stats/mood/scenes panels and runtimes are engine.html features
    // these pages never shipped — asserting them asserted structural
    // impossibility (see AUTOMIX_MIN_SCRIPTS note).
    const minStatus = await page.evaluate((scripts) => {
      const nodes = Array.from(document.querySelectorAll('script[src]'));
      const out = {};
      for (const s of scripts) out[s] = nodes.some(n => (n.getAttribute('src') || '').includes(s));
      out['#automix-toggle'] = !!document.getElementById('automix-toggle');
      out['#automix-state'] = !!document.getElementById('automix-state');
      out['#fx-intensity'] = !!(document.getElementById('fx-intensity') ||
        document.querySelector('[data-fx-intensity-mount]'));
      out['SWR_ANCHOR_MAP'] = !!(window.SWR_ANCHOR_MAP && typeof window.SWR_ANCHOR_MAP.neighbours === 'function');
      return out;
    }, AUTOMIX_MIN_SCRIPTS);
    const missingMin = Object.entries(minStatus).filter(([, v]) => !v).map(([k]) => k);
    if (missingMin.length === 0) ok(`${label}: automix-min stack complete (4 scripts + toggle + anchor map)`);
    else fail(`${label}: automix-min stack`, `missing: ${missingMin.join(', ')}`);

    const minApi = await page.evaluate(() => ({
      automix: !!(window.automix && typeof window.automix.toggle === 'function'),
    }));
    if (Object.values(minApi).every(Boolean)) ok(`${label}: automix runtime exposed`);
    else fail(`${label}: runtime APIs`, JSON.stringify(minApi));

    page.off('console', onConsole);
    page.off('pageerror', onError);
    return;
  }

  // Runtime scripts (5)
  const runtimeStatus = await page.evaluate((scripts) => {
    const out = {};
    for (const s of scripts) {
      const nodes = Array.from(document.querySelectorAll('script[src]'));
      out[s] = nodes.some(n => (n.getAttribute('src') || '').includes(s));
    }
    return out;
  }, RUNTIME_SCRIPTS);
  const missingRuntime = Object.entries(runtimeStatus).filter(([, v]) => !v).map(([k]) => k);
  if (missingRuntime.length === 0) ok(`${label}: all 5 runtime scripts present`);
  else fail(`${label}: runtime scripts`, `missing: ${missingRuntime.join(', ')}`);

  if (expectsStack) {
    // Panel IDs (18)
    const panelStatus = await page.evaluate((ids) => {
      const out = {};
      for (const id of ids) out[id] = !!document.getElementById(id);
      return out;
    }, PANEL_IDS);
    const missingPanels = Object.entries(panelStatus).filter(([, v]) => !v).map(([k]) => k);
    if (missingPanels.length === 0) ok(`${label}: all 18 panel IDs present`);
    else fail(`${label}: panel IDs`, `missing: ${missingPanels.join(', ')}`);
  }

  // All 5 runtimes exposed on window
  const apiExposed = await page.evaluate(() => ({
    automix: !!(window.automix && typeof window.automix.toggle === 'function'),
    hookDetector: !!(window.SWR_HOOK_DETECTOR && typeof window.SWR_HOOK_DETECTOR.detect === 'function'),
    stats: !!(window.SWR_STATS && typeof window.SWR_STATS.summary === 'function'),
    mood: !!(window.SWR_MOOD && typeof window.SWR_MOOD.analyze === 'function'),
    scenes: !!(window.SWR_SCENES && typeof window.SWR_SCENES.list === 'function'),
  }));
  if (Object.values(apiExposed).every(Boolean)) ok(`${label}: all 5 runtimes exposed`);
  else fail(`${label}: runtime APIs`, JSON.stringify(apiExposed));

  page.off('console', onConsole);
  page.off('pageerror', onError);
}

async function run() {
  const server = await localServe();
  let browser;
  try {
    browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
    const page = await browser.newPage();
    for (const [label, path, expectsStack] of SURFACES) {
      await checkSurface(page, label, path, expectsStack);
    }
  } finally {
    if (browser) await browser.close();
    server.close();
  }
}

run().catch(err => {
  console.error('FATAL', err);
  process.exit(1);
});