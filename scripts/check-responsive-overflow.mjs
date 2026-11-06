#!/usr/bin/env node
// scripts/check-responsive-overflow.mjs — no page may scroll sideways.
//
// WHY THIS GATE
// -------------
// The KAI SWARM QA pass (qa/swarm-runner.mjs) widened its surface from three
// routes to seventeen and immediately found four pages whose content ran past
// the viewport. All four were REAL: the same overflow was measured against the
// deployed site and against a local preview of the same build, so none of it
// was a preview artifact.
//
// The damage was not cosmetic. On /dashboard at 1440px the layers header ran
// 143px past the right edge, which pushed the Auto-rotate master toggle — the
// control that drives every layer at once — completely off-screen. A user
// could not see it, and could not click it.
//
// WHY THESE FOUR PAGES
// --------------------
// Each one had a different cause, so the gate covers the CLASS, not one page:
//   /persona-library  a nowrap inline-block label in a wrapping flex row
//   /style-guide     a grid track whose minimum floored at min-content
//   /dashboard        a control row in a 300px rail, plus a media query whose
//                     own rule lost the cascade to a utility sheet injected
//                     after it
//   /tiktok          the same grid-track floor as /style-guide, in the
//                     single-column fallback
//   /versions/gallery  a title row that cannot shrink its back link
//   /versions/temple-of-control  a header that cannot shrink its status bar
//   /shop            a nav row that cannot shrink its CTA
//   /director-mode-sainted-word  a nav row that cannot shrink its theme toggle
//
// The last four are the same class again — a flex row with `flex-wrap:
// nowrap` whose children do not fit a phone — so the gate now watches
// eight pages across five distinct causes.
//
// The four causes are now four different fixes, so a gate that watches all
// four pages cannot be satisfied by one lucky rule.
//
// WHAT IT ASSERTS
// ---------------
//   1. documentElement.scrollWidth <= innerWidth, at 390x844 and 1440x900,
//      for each of the four routes — the page must not scroll sideways.
//   2. The element that crosses the viewport is NAMED, with how far it
//      overflows. A bare "overflow detected" tells a fixer nothing; the
//      QA runner learned that the hard way.
//   3. On /dashboard, the Auto-rotate master toggle is inside the viewport.
//      This is the user-visible symptom the whole cycle started from, and it
//      is the one thing that must not regress silently.
//
// Run: node scripts/check-responsive-overflow.mjs
// Exit 0 on full pass, 1 on any failure.

import puppeteer from 'puppeteer';
import http from 'node:http';
import { spawn } from 'node:child_process';

const PORT = 53975;
const BASE = `http://127.0.0.1:${PORT}`;

// The routes and the viewports they are measured at. The source root is
// served, not dist/: the layout CSS is identical in both, and serving the
// source keeps this gate runnable without a build.
const ROUTES = [
  { path: '/persona-library.html', label: 'persona-library' },
  { path: '/style-guide.html', label: 'style-guide' },
  { path: '/dashboard.html', label: 'dashboard' },
  { path: '/tiktok.html', label: 'tiktok' },
  // Cycle 3: the same class on four more pages.
  { path: '/versions/gallery.html', label: 'versions/gallery' },
  { path: '/versions/temple-of-control.html', label: 'versions/temple-of-control' },
  { path: '/shop.html', label: 'shop' },
  { path: '/director-mode-sainted-word.html', label: 'director-mode-sainted-word' },
];
const VIEWPORTS = [
  { id: 'mobile', width: 390, height: 844 },
  { id: 'desktop', width: 1440, height: 900 },
];

function startServer() {
  return new Promise((resolve, reject) => {
    const proc = spawn('python3', ['-m', 'http.server', String(PORT)], {
      cwd: process.cwd(), stdio: 'ignore',
    });
    // The server must die with THIS process on EVERY exit path. A gate that
    // failed early used to leave it running; the next run on the same fixed
    // port then polled the STALE server and reported a failure that had
    // nothing to do with the code under test. One such orphan sat on a port
    // for 36 hours, serving 404s out of a worktree that no longer existed.
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

// Measure the page: the document's scroll width, and EVERY element that
// crosses the right edge of the viewport with how far it crosses. An element
// positioned off-canvas on purpose (a skip link) is not an overflow.
async function measure(page) {
  return page.evaluate(() => {
    const de = document.documentElement;
    const offenders = [];
    for (const el of document.querySelectorAll('body *')) {
      const r = el.getBoundingClientRect();
      if (r.width <= 0 || r.right <= window.innerWidth + 1) continue;
      const cs = getComputedStyle(el);
      // A skip link parked off-canvas is a deliberate pattern, not an overflow.
      if (cs.position === 'absolute' && r.right < 0) continue;
      const cls = typeof el.className === 'string' ? el.className.trim() : '';
      offenders.push({
        sel: el.tagName.toLowerCase() + (el.id ? '#' + el.id : '') +
             (cls ? '.' + cls.split(/\s+/).slice(0, 3).join('.') : ''),
        over: Math.round(r.right - window.innerWidth),
        text: (el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 40),
      });
    }
    return {
      scrollWidth: de.scrollWidth,
      innerWidth: window.innerWidth,
      offenders: offenders.sort((a, b) => b.over - a.over).slice(0, 5),
    };
  });
}

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
      for (const vp of VIEWPORTS) {
        const page = await browser.newPage();
        await page.setViewport({ width: vp.width, height: vp.height });
        try {
          await page.goto(BASE + route.path, { waitUntil: 'domcontentloaded', timeout: 30000 });
          // The pages hydrate their chrome asynchronously; give the layout a
          // beat to settle before the measurement, or a late-arriving
          // footer can be mistaken for a stable one.
          await new Promise((r) => setTimeout(r, 1200));
          const m = await measure(page);

          if (m.scrollWidth <= m.innerWidth) {
            pass(`${route.label} @${vp.id} does not scroll sideways`,
                 `scrollWidth=${m.scrollWidth} innerWidth=${m.innerWidth}`);
          } else {
            const who = m.offenders.map((o) => `${o.sel} +${o.over}px "${o.text}"`).join('; ');
            fail(`${route.label} @${vp.id} scrolls sideways`,
                 `scrollWidth=${m.scrollWidth} innerWidth=${m.innerWidth}` +
                 (who ? ` — ${who}` : ''));
          }

          // The symptom this cycle started from: the Auto-rotate master
          // toggle must be reachable, not parked past the right edge.
          if (route.label === 'dashboard') {
            const toggle = await page.evaluate(() => {
              const el = document.querySelector('#auto-rotate-master');
              if (!el) return { missing: true };
              const r = el.getBoundingClientRect();
              return { right: Math.round(r.right), left: Math.round(r.left), iw: window.innerWidth };
            });
            if (toggle.missing) {
              fail('dashboard @' + vp.id + ': the Auto-rotate master toggle exists');
            } else if (toggle.right <= toggle.iw && toggle.left >= 0) {
              pass(`dashboard @${vp.id}: the Auto-rotate master toggle is on screen`,
                   `right=${toggle.right} innerWidth=${toggle.iw}`);
            } else {
              fail(`dashboard @${vp.id}: the Auto-rotate master toggle is off screen`,
                   `left=${toggle.left} right=${toggle.right} innerWidth=${toggle.iw}`);
            }
          }
        } catch (e) {
          fail(`${route.label} @${vp.id} loads`, e.message);
        } finally {
          await page.close().catch(() => {});
        }
      }
    }
  } finally {
    await browser.close();
    if (server) try { server.kill('SIGTERM'); } catch (_) { /* already gone */ }
  }

  const passed = checks.filter((c) => c.ok).length;
  console.log('');
  console.log('────────────────');
  console.log(`Responsive overflow gate: ${passed}/${checks.length} checks passed`);
  if (passed !== checks.length) process.exit(1);
  console.log('OK');
})();
