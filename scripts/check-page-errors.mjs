#!/usr/bin/env node
// scripts/check-page-errors.mjs — a page must load without a JavaScript error.
//
// WHY THIS GATE
// -------------
// The KAI SWARM QA pass found `/engine-personas` throwing on every load:
//
//   ReferenceError: Cannot access 'currentPalette' before initialization
//   (engine-personas.html:569)
//
// A temporal dead zone: the page called `resizeCanvas()` — which calls
// `drawCanvasBackground()`, which reads `currentPalette` — about six lines
// ABOVE the `let currentPalette = null;` that declares it. The declaration
// is evaluated after the call, so the read hits a binding that does not
// exist yet. The page's canvas background never painted.
//
// The QA runner catches this class of failure, but the runner is a
// development tool that measures a route table; this is the gate that
// keeps the specific pages honest between runs.
//
// WHAT IT ASSERTS
// ---------------
// For each route: the page loads, and NOTHING raises an uncaught error or
// logs a console error while it settles. A route that cannot load at all
// fails on the navigation.
//
// Run: node scripts/check-page-errors.mjs
// Exit 0 on full pass, 1 on any failure.

import puppeteer from 'puppeteer';
import http from 'node:http';
import { spawn } from 'node:child_process';

const PORT = 53977;
const BASE = `http://127.0.0.1:${PORT}`;

// The pages that carry their own scripts and are reachable without a
// session. `/engine-personas` is the one the QA pass caught.
const ROUTES = [
  { path: '/engine-personas.html', label: 'engine-personas' },
  { path: '/persona-library.html', label: 'persona-library' },
  { path: '/style-guide.html', label: 'style-guide' },
  { path: '/dashboard.html', label: 'dashboard' },
  { path: '/tiktok.html', label: 'tiktok' },
  { path: '/versions/gallery.html', label: 'versions/gallery' },
  { path: '/shop.html', label: 'shop' },
];

function startServer() {
  return new Promise((resolve, reject) => {
    const proc = spawn('python3', ['-m', 'http.server', String(PORT)], {
      cwd: process.cwd(), stdio: 'ignore',
    });
    // The server must die with THIS process on EVERY exit path — a gate
    // that failed early used to leave it running, and the next run on the
    // same fixed port then polled the STALE server.
    process.on('exit', () => { try { proc.kill(); } catch { /* already gone */ } });
    const start = Date.now();
    const tick = () => http.get(`${BASE}/dashboard.html`, (res) => {
      res.resume();
      if (res.statusCode === 200) return resolve(proc);
      if (Date.now() - start > 10000) return reject(new Error('server timeout'));
      setTimeout(tick, 100);
    }).on('error', () => {
      if (Date.now() - start > 10000) return reject(new Error('server error'));
      setTimeout(tick, 80);
    });
    setTimeout(tick, 100);
  });
}

const checks = [];
const pass = (m, d) => { checks.push({ ok: true, m, d }); console.log('✓', m, d ? `(${d})` : ''); };
const fail = (m, d) => { checks.push({ ok: false, m, d }); console.log('✗', m, d ? `(${d})` : ''); };

(async () => {
  let server;
  try { server = await startServer(); }
  catch (e) { fail('server boot', e.message); process.exit(1); }

  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
  });

  try {
    for (const route of ROUTES) {
      const page = await browser.newPage();
      await page.setViewport({ width: 1440, height: 900 });
      const errs = [];
      page.on('pageerror', (e) => errs.push('uncaught: ' + String(e.message || e).split('\n')[0]));
      page.on('console', (m) => {
        if (m.type() !== 'error') return;
        const t = m.text();
        // A missing font file or a blocked third-party asset is not a
        // script error in the page; a WebSocket to an absent dev bridge is
        // not either. Everything else is.
        if (/Failed to load resource|net::ERR_|WebSocket|fonts\.googleapis/.test(t)) return;
        errs.push('console: ' + t.split('\n')[0]);
      });
      try {
        // The cache-buster keeps every run a fresh 200: a conditional
        // request answers 304, which IS a served page (the browser renders
        // its cached copy and runs the scripts), but the gate wants to know
        // it loaded THIS build.
        const url = `${BASE}${route.path}?gate=${Date.now()}`;
        const res = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
        if (!res || (res.status() !== 200 && res.status() !== 304)) {
          fail(`${route.label} loads`, `status ${res ? res.status() : 'none'}`);
        } else {
          // Let the page's own scripts run and settle.
          await new Promise((r) => setTimeout(r, 2000));
          if (errs.length === 0) pass(`${route.label} loads without a JavaScript error`);
          else fail(`${route.label} raises an error while loading`, errs.slice(0, 3).join(' | '));
        }
      } catch (e) {
        fail(`${route.label} loads`, e.message);
      } finally {
        await page.close().catch(() => {});
      }
    }
  } finally {
    await browser.close();
    if (server) try { server.kill('SIGTERM'); } catch (_) { /* already gone */ }
  }

  const passed = checks.filter((c) => c.ok).length;
  console.log('');
  console.log('────────────────');
  console.log(`Page error gate: ${passed}/${checks.length} checks passed`);
  if (passed !== checks.length) process.exit(1);
  console.log('OK');
})();
