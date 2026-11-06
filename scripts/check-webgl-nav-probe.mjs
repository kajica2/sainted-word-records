#!/usr/bin/env node
// scripts/check-webgl-nav-probe.mjs — the WebGL gate must survive a navigation.
//
// WHY THIS EXISTS
// ---------------
// CI run 42244823136 failed on `check:webgl-default-off` with:
//
//   FAIL  default (no flag) → isWebGLEnabled() === false
//        — Execution context was destroyed, most likely because of a navigation.
//
// The cause is the PWA bootstrap: when the service worker takes control
// for the FIRST time it reloads the page
// (`navigator.serviceWorker.addEventListener('controllerchange', …
// location.reload())` in pwa-bootstrap.js). On a cold Chrome profile that
// install happens during this gate's first page load, so the reload can
// land WHILE the gate is reading the page — and the read dies with the
// navigation error. Only the FIRST assertion saw it, because every later
// page in the same profile is already controlled by the service worker and
// never reloads.
//
// A reload on a timer cannot reproduce that deterministically: it may land
// before or after the read. A navigation that is already IN FLIGHT can —
// start a navigation without awaiting it, hold its request open, and read
// the page while it is still going.
//
// So this gate builds the destroyed context on purpose and pins the two
// halves of the contract:
//
//   A. reading a page mid-navigation raises the navigation error — the
//      condition is real and reproducible here;
//   B. the gate's retry turns that into a successful read of the page the
//      navigation lands on.
//
// If A ever stops holding, the race is no longer being tested and this
// gate is vacuous. If B stops holding, the webgl gate is flaky again.
//
// Run command:
//   node scripts/check-webgl-nav-probe.mjs
import puppeteer from 'puppeteer';
import { ensureDist, serveDist } from './with-dist.mjs';

/* The same shape the webgl gate recognises. Keep the two in step: if this
   list is widened, the gate's must be widened with it. */
const NAV_ERROR = /Execution context was destroyed|Target closed|frame was detached|Navigating frame/i;

ensureDist();
const served = await serveDist(0);
const BASE = served.url;

let failures = 0;
function assert(cond, msg) {
  if (cond) console.log('  ok   ' + msg);
  else { failures++; console.log('  FAIL ' + msg); }
}

/* Open a page and start a navigation whose request is HELD OPEN, so the
   page is genuinely mid-navigation when the read happens. */
async function navigatingPage(browser) {
  const page = await browser.newPage();
  await page.goto(`${BASE}/engine.html`, { waitUntil: 'domcontentloaded' });
  await page.setRequestInterception(true);
  page.on('request', async (req) => {
    if (req.url().includes('bench.html')) await new Promise((r) => setTimeout(r, 2500));
    req.continue().catch(() => {});
  });
  page.goto(`${BASE}/bench.html`).catch(() => {});
  await new Promise((r) => setTimeout(r, 400));
  return page;
}

const browser = await puppeteer.launch({
  headless: 'new',
  args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
});

try {
  // --- A. the condition is real ------------------------------------------
  {
    const page = await navigatingPage(browser);
    let msg = '';
    try {
      await page.evaluate(() => document.title);
      msg = '(no error)';
    } catch (e) {
      msg = String((e && e.message) || e);
    }
    console.log('  a read during a navigation says: ' + msg.slice(0, 90));
    assert(NAV_ERROR.test(msg), 'reading a page mid-navigation raises a navigation error');
    await page.close();
  }

  // --- B. the gate rides it out -------------------------------------------
  {
    const page = await navigatingPage(browser);
    let value = null;
    let rethrown = null;
    for (let attempt = 0; attempt < 8; attempt++) {
      try {
        value = await page.evaluate(() => ({ title: document.title, ready: document.readyState }));
        break;
      } catch (e) {
        // the gate's rule: a navigation error means "the page is
        // reloading" — wait for it. Anything else is the assertion's own.
        if (!NAV_ERROR.test(String((e && e.message) || e))) { rethrown = e; break; }
        await new Promise((r) => setTimeout(r, 250));
      }
    }
    assert(rethrown === null, 'a navigation error is not rethrown');
    assert(value !== null, 'the retry reads the page the navigation lands on');
    if (value) console.log('  and it read: ' + JSON.stringify(value));
    await page.close();
  }

  // --- C. an ordinary error is still thrown -------------------------------
  {
    const page = await browser.newPage();
    await page.goto(`${BASE}/engine.html`, { waitUntil: 'domcontentloaded' });
    let threw = false;
    try {
      await page.evaluate(() => { throw new Error('the assertion is the one that failed'); });
    } catch (e) {
      threw = /the assertion is the one that failed/.test(String((e && e.message) || e));
    }
    assert(threw, 'an ordinary error is NOT mistaken for a navigation');
    await page.close();
  }
} finally {
  await browser.close();
  await served.close();
}

console.log('');
if (failures > 0) {
  console.log(`WEBGL NAV PROBE: ${failures} check(s) failed`);
  process.exit(1);
}
console.log('WEBGL NAV PROBE: ALL GREEN');
process.exit(0);
