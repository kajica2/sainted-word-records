#!/usr/bin/env node
// scripts/check-bench-smoke.mjs
// Puppeteer smoke test for the Bench & Sync Lab (bench.html).
// Verifies the real user path against the built dist/:
//
//   1. the page boots with the shared chrome and the ring buffer is
//      auto-created (no setup step, and it fills on its own)
//   2. the buffer measures what it is given: a 12 ms injected lag comes
//      back as ~12 ms of drift
//   3. interpolation lowers the measured drift versus the same run without
//      it — the comparison the whole lab exists to make
//   4. each test compiles a versioned report with the metrics and a grade
//   5. the baseline test really is one layer (the preset drives the
//      layers, not a hardcoded set)
//   6. the advisor grades a report, lists bottlenecks and proposes
//      suggestions, and "apply & re-run" produces a second report
//   7. reports survive a reload and the compare table renders a delta
//
// Self-contained: ensureDist() (from scripts/with-dist.mjs) auto-builds
// dist/ if missing.
//
// Run command:
//   node scripts/check-bench-smoke.mjs
//
// Pass criteria: every assertion green, exit 0.

import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import puppeteer from 'puppeteer';
import { ensureDist } from './with-dist.mjs';

ensureDist();

const distDir = path.resolve(dirname(fileURLToPath(import.meta.url)), '../dist');
const server = http.createServer((req, res) => {
  let p = req.url.split('?')[0];
  if (p.endsWith('/')) p += 'index.html';
  const file = path.join(distDir, p);
  if (!file.startsWith(distDir)) { res.statusCode = 403; res.end(); return; }
  fs.readFile(file, (err, data) => {
    if (err) {
      if (!path.extname(file)) {
        return fs.readFile(file + '.html', (err2, data2) => {
          if (err2) { res.statusCode = 404; res.end(); return; }
          res.setHeader('Content-Type', 'text/html');
          res.end(data2);
        });
      }
      res.statusCode = 404; res.end(); return;
    }
    const ext = path.extname(file);
    const mime = ext === '.html' ? 'text/html'
      : ext === '.js' ? 'text/javascript'
      : ext === '.css' ? 'text/css'
      : ext === '.json' ? 'application/json'
      : 'application/octet-stream';
    res.setHeader('Content-Type', mime);
    res.end(data);
  });
});
server.on('error', (err) => {
  console.error('BENCH SMOKE: cannot bind port 5187 — ' + (err && err.code ? err.code : err));
  process.exit(1);
});
server.listen(5187);

const browser = await puppeteer.launch({
  args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
});

const results = [];
function ok(name) { results.push('  ✓ ' + name); }
function bad(name, got) {
  results.push('  ✗ ' + name + (got === undefined ? '' : ' (got: ' + got + ')'));
  process.exitCode = 1;
}

const page = await browser.newPage();
await page.setViewport({ width: 1400, height: 950 });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

await page.goto('http://localhost:5187/bench.html', { waitUntil: 'networkidle2', timeout: 30000 });
await page.waitForFunction(() => !!window.SWRBench, { timeout: 10000 });

// --- 1) boot + shared chrome + an auto-created buffer --------------------
const boot = await page.evaluate(() => ({
  nav: document.querySelectorAll('swr-nav a').length,
  footer: document.querySelectorAll('swr-footer a').length,
  main: !!document.querySelector('main'),
  buffer: !!window.SWRBench.buffer,
  capacity: window.SWRBench.buffer.capacity,
  pushes: window.SWRBench.buffer.pushes,
}));
if (boot.nav > 0) ok('the shared nav is mounted');
else bad('the shared nav is mounted', JSON.stringify(boot));
if (boot.footer > 0) ok('the shared footer is mounted');
else bad('the shared footer is mounted', JSON.stringify(boot));
if (boot.main) ok('the page has a main landmark');
else bad('the page has a main landmark', 'no <main>');
if (boot.buffer && boot.capacity > 0) ok('the A/V ring buffer is auto-created (capacity ' + boot.capacity + ')');
else bad('the A/V ring buffer is auto-created', JSON.stringify(boot));

// the buffer fills on its own — nobody pressed anything
await new Promise(r => setTimeout(r, 700));
const filled = await page.evaluate(() => window.SWRBench.buffer.pushes);
if (filled > 10) ok('the buffer fills on its own (' + filled + ' samples)');
else bad('the buffer fills on its own', filled);

// --- 2) the buffer measures the lag it is given --------------------------
const lag = await page.evaluate(async () => {
  const r = await window.SWRBench.runTest('sync-stress',
    { layerPreset: 'reactive', reactivity: 1.5, interpolate: true, injectAudioDrift: 0.012 }, 1500);
  return r.metrics.driftAvg;
});
if (lag > 6 && lag < 26) ok('a 12ms injected lag is measured back as ~12ms (' + lag.toFixed(1) + 'ms)');
else bad('a 12ms injected lag is measured back as ~12ms', lag.toFixed(1));

// --- 3) interpolation lowers the measured drift ---------------------------
const interp = await page.evaluate(async () => {
  const on = await window.SWRBench.runTest('reactive',
    { layerPreset: 'reactive', reactivity: 1.5, interpolate: true }, 1500);
  const off = await window.SWRBench.runTest('reactive-noint',
    { layerPreset: 'reactive', reactivity: 1.5, interpolate: false }, 1500);
  return { on: on.metrics.driftAvg, off: off.metrics.driftAvg };
});
if (interp.on < interp.off) {
  ok('interpolation lowers the measured drift (' + interp.on.toFixed(1) + ' vs ' + interp.off.toFixed(1) + 'ms)');
} else {
  bad('interpolation lowers the measured drift', JSON.stringify(interp));
}

// --- 4) a report compiles, with metrics and a grade ----------------------
const report = await page.evaluate(async () => {
  const r = await window.SWRBench.runTest('baseline',
    { layerPreset: 'baseline', reactivity: 0, interpolate: true }, 1200);
  return {
    version: r.version,
    fps: r.metrics.fpsAvg,
    p99: r.metrics.frameP99,
    samples: r.metrics.videoSamples,
    grade: r.scores.grade,
    hasScores: typeof r.scores.render === 'number' && typeof r.scores.stability === 'number' && typeof r.scores.sync === 'number',
    layers: r.config.layerCount,
  };
});
if (report.version) ok('a run compiles a versioned report (' + report.version + ')');
else bad('a run compiles a versioned report', JSON.stringify(report));
if (report.hasScores && report.grade) ok('the report is scored and graded (' + report.grade + ')');
else bad('the report is scored and graded', JSON.stringify(report));
if (report.samples > 20) ok('the report carries frame samples (' + report.samples + ')');
else bad('the report carries frame samples', report.samples);
if (report.layers === 1) ok('the baseline test really is one layer');
else bad('the baseline test really is one layer', report.layers);

// --- 5) the advisor grades, lists and proposes --------------------------
const advisor = await page.evaluate(async () => {
  const r = await window.SWRBench.runTest('stress',
    { layerPreset: 'stress', reactivity: 1.5, interpolate: true }, 1500);
  const ai = window.SWRBench.analyze(r);
  return {
    grade: ai.grade,
    bottlenecks: ai.bottlenecks.length,
    suggestions: ai.suggestions.length,
    hasBottleneckShape: ai.bottlenecks.every(b => b.kind && b.detail),
    hasSuggestionShape: ai.suggestions.every(s => s.id && s.label && s.detail),
  };
});
if (advisor.grade) ok('the advisor grades a report (' + advisor.grade + ')');
else bad('the advisor grades a report', JSON.stringify(advisor));
if (advisor.bottlenecks > 0 && advisor.hasBottleneckShape) ok('the advisor lists ' + advisor.bottlenecks + ' bottleneck(s)');
else bad('the advisor lists bottlenecks', JSON.stringify(advisor));
if (advisor.suggestions > 0 && advisor.hasSuggestionShape) ok('the advisor proposes ' + advisor.suggestions + ' suggestion(s)');
else bad('the advisor proposes suggestions', JSON.stringify(advisor));

// --- 6) apply & re-run produces a second, comparable report --------------
const applied = await page.evaluate(async () => {
  const before = window.SWRBench.reports.length;
  const r = await window.SWRBench.runTest('stress',
    { layerPreset: 'stress', reactivity: 1.5, interpolate: true }, 1200);
  const ai = window.SWRBench.analyze(r);
  const dpr = window.SWRBench.config.dpr;
  // the advisor's own suggestion path: cap the DPR and re-run
  window.SWRBench.config.dpr = 1.25;
  const after = await window.SWRBench.runTest('optimized', { ...window.SWRBench.config }, 1200);
  return { before, after: window.SWRBench.reports.length, hasCompare: typeof after === 'object' && !!after.id, ai: ai.suggestions.length, dpr };
});
if (applied.after > applied.before) ok('a re-run adds a report (' + applied.before + ' → ' + applied.after + ')');
else bad('a re-run adds a report', JSON.stringify(applied));

// --- 7) reports survive a reload, and the compare table renders ----------
await page.reload({ waitUntil: 'networkidle2' });
await page.waitForFunction(() => !!window.SWRBench, { timeout: 10000 });
const persisted = await page.evaluate(() => window.SWRBench.reports.length);
if (persisted > 0) ok('the reports survive a reload (' + persisted + ')');
else bad('the reports survive a reload', persisted);

const compare = await page.evaluate(() => {
  const sel = document.querySelector('#cmpA');
  const sel2 = document.querySelector('#cmpB');
  if (!sel || !sel2) return { ok: false, why: 'no selects' };
  const opts = [...sel.options].filter(o => o.value);
  if (opts.length < 2) return { ok: false, why: 'fewer than two reports' };
  sel.value = opts[0].value;
  sel2.value = opts[1].value;
  sel.dispatchEvent(new Event('change', { bubbles: true }));
  const rows = document.querySelectorAll('#cmpTable tbody tr').length;
  const text = document.querySelector('#cmpTable').textContent || '';
  return { ok: rows > 1 && /Delta/i.test(text), rows };
});
if (compare.ok) ok('the compare table renders a delta (' + compare.rows + ' rows)');
else bad('the compare table renders a delta', JSON.stringify(compare));

// --- console hygiene ------------------------------------------------------
if (errors.length) bad('no console errors during the run', errors[0]);
else ok('no console errors during the run');

await browser.close();
server.close();

console.log('BENCH SMOKE');
for (const r of results) console.log(r);
if (process.exitCode) {
  console.log('FAILURES ABOVE');
} else {
  console.log('\nPASS: ' + results.length);
}
