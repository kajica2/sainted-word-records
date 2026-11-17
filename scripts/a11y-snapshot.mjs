#!/usr/bin/env node
// scripts/a11y-snapshot.mjs — the accessibility gate's MEASUREMENT, without
// its verdict.
//
// WHY THIS EXISTS
// ---------------
// The a11y gate (scripts/check-a11y.mjs) compares per-rule instance counts
// against a committed baseline and fails when a rule goes UP. That is the
// right gate, but it answers only one question: "did a rule's total move?"
// When a total moves, the next question is "WHICH PAGES moved, and WHAT on
// them?" — and the gate's stdout truncates its page list to the first eight
// routes, so it cannot answer that.
//
// A total is also a weak instrument: 148 pages summed into one number cannot
// tell a real regression on four pages from the same wobble spread thinly
// over 148. The gate's own comment records that two runs of the SAME build
// differed by two contrast instances, so a total moves for reasons that have
// nothing to do with the code.
//
// This script measures the SAME surface the gate measures, under the SAME
// pinned conditions, and writes the PER-PAGE counts to JSON. Two snapshots
// can then be diffed page by page: a rule that moved on two pages is a
// different fact from a rule that moved a little everywhere.
//
// IT IS NOT A GATE. It asserts nothing and exits 0 unless the measurement
// itself failed. A snapshot that measures nothing says so in its output,
// because a snapshot of zero pages is a snapshot of nothing.
//
// MEASUREMENT CONDITIONS — PINNED, AND THE PINS MATTER
// ----------------------------------------------------
// These are copied from scripts/check-a11y.mjs on purpose. A snapshot that
// measures something other than what the gate measures is not comparable to
// the gate, and the whole point of this script is comparison:
//   - the same routes and the same desktop viewport (qa/swarm.config.json)
//   - prefers-color-scheme: light, pinned twice (the media emulation tells
//     the page what the OS prefers; the data-theme attribute says what the
//     document IS, so a page that sets its own theme cannot move the count)
//   - the webfonts awaited, because axe computes contrast from rendered
//     pixels and a page measured before its font arrives is a different page
//   - the font stack pinned to Arial / Liberation Sans, so the counts do not
//     depend on a CDN being reachable
//   - a fixed settle delay after the fonts, for the same reason
//
// Usage:
//   node scripts/a11y-snapshot.mjs --out snapshot.json
//   node scripts/a11y-snapshot.mjs --out snapshot.json --rule label-content-name-mismatch
//
// The repo root is taken from SWR_ROOT, else from the current working
// directory, so the script can be copied out of the tree and run against a
// checkout of a different commit (which is how the A/B comparison works).
import puppeteer from 'puppeteer';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import http from 'node:http';
import { createServer } from 'node:net';

const ROOT = process.env.SWR_ROOT || process.cwd();
const AXE_PATH = join(ROOT, 'node_modules', 'axe-core', 'axe.min.js');
const CONFIG_PATH = join(ROOT, 'qa', 'swarm.config.json');

const args = process.argv.slice(2);
const outIndex = args.indexOf('--out');
const OUT = outIndex >= 0 ? args[outIndex + 1] : 'a11y-snapshot.json';
const ruleIndex = args.indexOf('--rule');
const ONLY_RULE = ruleIndex >= 0 ? args[ruleIndex + 1] : null;

function freePort() {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.unref();
    probe.on('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const port = probe.address().port;
      probe.close(() => resolve(port));
    });
  });
}

async function startServer() {
  const port = await freePort();
  const base = `http://127.0.0.1:${port}`;
  return new Promise((resolve, reject) => {
    let stderr = '';
    const proc = spawn('npx', ['vite', 'preview', '--port', String(port), '--host', '127.0.0.1', '--outDir', 'dist'], {
      cwd: ROOT, stdio: ['ignore', 'ignore', 'pipe'],
    });
    proc.stderr.on('data', (c) => { stderr += String(c); });
    process.on('exit', () => { try { proc.kill('SIGTERM'); } catch { /* gone */ } });
    proc.on('exit', () => { try { proc.kill('SIGKILL'); } catch { /* gone */ } });
    const start = Date.now();
    const tick = () => {
      http.get(`${base}/`, (res) => {
        res.resume();
        if (res.statusCode === 200) return resolve({ base, proc });
        if (Date.now() - start > 60000) return reject(new Error('server timeout'));
        setTimeout(tick, 200);
      }).on('error', () => {
        if (Date.now() - start > 60000) return reject(new Error('server error' + (stderr ? ': ' + stderr.slice(-300) : '')));
        setTimeout(tick, 150);
      });
    };
    setTimeout(tick, 150);
  });
}

const axeSource = readFileSync(AXE_PATH, 'utf8');

(async () => {
  const config = JSON.parse(readFileSync(CONFIG_PATH, 'utf8'));
  const viewport = config.viewports.find(v => v.id === 'desktop') || { width: 1440, height: 900 };

  const { base, proc } = await startServer();
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
  });

  const pages = {};
  const skipped = [];
  let probed = 0;

  try {
    for (const route of config.routes) {
      const page = await browser.newPage();
      await page.setViewport({ width: viewport.width, height: viewport.height });
      await page.emulateMediaFeatures([
        { name: 'prefers-reduced-motion', value: 'reduce' },
        { name: 'prefers-color-scheme', value: 'light' },
      ]);
      try {
        const res = await page.goto(new URL(route.path, base).href, { waitUntil: 'domcontentloaded', timeout: 30000 });
        if (!res || res.status() >= 400) { skipped.push({ route: route.path, error: 'http ' + (res && res.status()) }); continue; }
        await page.evaluate(() => {
          const fonts = document.fonts ? document.fonts.ready : null;
          return fonts ? Promise.race([fonts, new Promise(r => setTimeout(r, 3000))]) : null;
        }).catch(() => {});
        await new Promise(r => setTimeout(r, 700));
        await page.evaluate(() => {
          document.documentElement.setAttribute('data-theme', 'light');
          const style = document.createElement('style');
          style.textContent = '*, *::before, *::after { font-family: Arial, "Liberation Sans", sans-serif !important; }';
          document.head.appendChild(style);
        });
        await page.addScriptTag({ content: axeSource });
        const violations = await page.evaluate(async (ms) => {
          const result = await window.axe.run(document, { resultTypes: ['violations'], timeout: ms });
          return result.violations.map(v => ({
            id: v.id,
            nodes: v.nodes.length,
            samples: v.nodes.slice(0, 6).map(n => ({
              target: Array.isArray(n.target) ? n.target.join(' ') : String(n.target),
            })),
          }));
        }, 30000);
        probed++;
        const perRule = {};
        for (const v of violations) {
          if (ONLY_RULE && v.id !== ONLY_RULE) continue;
          perRule[v.id] = { n: v.nodes, samples: v.samples };
        }
        pages[route.path] = perRule;
      } catch (err) {
        skipped.push({ route: route.path, error: String(err && err.message || err).split('\n')[0] });
      } finally {
        await Promise.race([page.close().catch(() => {}), new Promise(r => setTimeout(r, 5000))]);
      }
    }
  } finally {
    await browser.close();
    try { proc.kill('SIGTERM'); } catch { /* gone */ }
  }

  const totals = {};
  for (const perRule of Object.values(pages)) {
    for (const [id, v] of Object.entries(perRule)) {
      totals[id] = (totals[id] || 0) + v.n;
    }
  }

  writeFileSync(OUT, JSON.stringify({ probed, skipped, totals, pages }, null, 2) + '\n');
  console.log(`snapshot: ${probed} pages measured, ${skipped.length} skipped -> ${OUT}`);
  if (skipped.length) console.log('skipped:', skipped.slice(0, 10));
  console.log('totals:', JSON.stringify(totals));
  // A snapshot of nothing is a snapshot of nothing — say so loudly.
  if (probed === 0) { console.error('NOTHING WAS MEASURED'); process.exit(1); }
})();
