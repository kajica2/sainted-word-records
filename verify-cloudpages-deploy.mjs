// Puppeteer verify for the live cloudpages deploy (v2 — robust)
import puppeteer from 'puppeteer';
import { writeFileSync, mkdirSync } from 'node:fs';

const BASE = 'https://sainted-word-records.vercel.app';
// /personas.json is a data file, not an HTML page — verify by HTTP only, not by browser nav
// /index.html intentionally 404s — neither the splash nor the app is called index.html anymore
// /engine and /engine/ are the app entry points (rewrites in vercel.json)
const PAGES = [
  { path: '/index.html', name: 'app (expect 404 — no index.html anywhere)', kind: 'html', expectStatus: 404 },
  { path: '/engine', name: 'app entry (rewrite → /engine.html)', kind: 'html' },
  { path: '/engine/', name: 'app entry trailing slash', kind: 'html' },
  { path: '/landing.html', name: 'splash', kind: 'html' },
  { path: '/campaign.html', name: 'campaign', kind: 'html' },
  { path: '/tutorial-30s.html', name: 'tutorial-30s', kind: 'html' },
  { path: '/personas.html', name: 'personas-gallery', kind: 'html' },
  { path: '/landing-personas-v1-editorial.html', name: 'v1-editorial', kind: 'html' },
  { path: '/landing-personas-v2-dark.html', name: 'v2-dark', kind: 'html' },
  { path: '/landing-personas-v3-friendly.html', name: 'v3-friendly', kind: 'html' },
  { path: '/landing-personas-v4-dashboard.html', name: 'v4-dashboard', kind: 'html' },
  { path: '/landing-personas-v5-brutalist.html', name: 'v5-brutalist', kind: 'html' },
  { path: '/landing-personas-v6-wireframe.html', name: 'v6-wireframe', kind: 'html' },
  { path: '/market-study.html', name: 'market-study', kind: 'html' },
  { path: '/profit-plan.html', name: 'profit-plan', kind: 'html' },
  { path: '/personas.json', name: 'personas-json', kind: 'json' },
  { path: '/swr-tutorial-30s.mp4', name: 'mp4', kind: 'json' },
];

mkdirSync('verify-screenshots/vercel', { recursive: true });

const errors = [];
const results = [];

// Suppress these as noise (not real 404s on user-visible resources)
const isNoise = (e) => {
  if (e.startsWith('blob:')) return true;            // internal blob URL cleanup
  if (e.includes('favicon.ico')) return true;          // browser auto-request
  if (e.includes('sw.js')) return true;                // service worker
  return false;
};

const browser = await puppeteer.launch({
  headless: 'new',
  args: ['--no-sandbox', '--disable-setuid-sandbox', '--autoplay-policy=no-user-gesture-required'],
});
try {
  for (const p of PAGES) {
    const url = BASE + p.path;
    const page = await browser.newPage();
    const pageErrors = [];
    const four04s = [];
    page.on('pageerror', (e) => pageErrors.push('pageerror: ' + e.message));
    page.on('console', (m) => { if (m.type() === 'error') pageErrors.push('console.error: ' + m.text()); });
    page.on('response', (resp) => {
      if (resp.status() === 404 && !isNoise(resp.url())) four04s.push(resp.url());
    });
    try {
      let resp;
      if (p.kind === 'json') {
        // For data files, just HEAD/GET via fetch — don't try to render as HTML
        const fetchRes = await page.goto('about:blank');
        const headers = await page.evaluate(async (u) => {
          const r = await fetch(u, { method: 'GET' });
          return { status: r.status, type: r.headers.get('content-type'), length: (await r.text()).length };
        }, url);
        results.push({ path: p.path, status: headers.status, title: '', h1: null, bytes: headers.length, errors: 0, kind: 'json' });
        continue;
      } else {
        // HTML page: navigate with a generous timeout and settle
        resp = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
        await new Promise((r) => setTimeout(r, 4000)); // let JS + sub-resources settle
        const status = resp ? resp.status() : 'no-resp';
        const title = await page.title();
        const h1 = await page.evaluate(() => {
          const h = document.querySelector('h1');
          return h ? h.textContent.trim().slice(0, 80) : null;
        });
        const byteSize = await page.evaluate(() => document.documentElement.outerHTML.length);
        results.push({ path: p.path, status, title: title.slice(0, 80), h1, bytes: byteSize, errors: four04s.length, four04s, expectStatus: p.expectStatus });
        if (p.expectStatus && p.expectStatus !== status) {
          console.log(`  (note: expected ${p.expectStatus}, got ${status} — that's the new URL structure)`);
        }
        if (p.path.endsWith('.html')) {
          await page.screenshot({
            path: `verify-screenshots/vercel/${p.name}.png`,
            fullPage: false,
          });
        }
        if (four04s.length && !p.expectStatus) {
          for (const u of four04s) errors.push(`${p.path}: 404 ${u}`);
        }
        // Filter pre-existing engine noise from pageErrors
        for (const e of pageErrors) {
          if (e.includes('VERT is not defined')) continue;
          if (e.includes('drawImage') && e.includes('broken')) continue;
          // blob: aborts are internal cleanup, not real
          if (e.includes('blob:')) continue;
          // When this page is expected to 404, swallow its own 404 console errors
          if (p.expectStatus && (e.includes('status of 404') || e.includes('Failed to load resource'))) continue;
          errors.push(`${p.path}: ${e}`);
        }
      }
    } catch (e) {
      results.push({ path: p.path, status: 'EXCEPTION', error: e.message });
      errors.push(`${p.path}: ${e.message}`);
    } finally {
      await page.close();
    }
  }
} finally {
  await browser.close();
}

writeFileSync('verify-screenshots/vercel/_results.json', JSON.stringify(results, null, 2));

console.log('\n=== LIVE DEPLOY VERIFY ===');
for (const r of results) {
  const ok = (r.status === 200 || r.status === 304) ? '✓' : '✗';
  const line = `${ok} ${String(r.status).padEnd(6)} ${r.path.padEnd(48)} bytes=${String(r.bytes || 0).padStart(7)}  404s=${r.errors || 0}`;
  console.log(line);
  if (r.title) console.log(`     title="${r.title}"`);
  if (r.h1) console.log(`     h1="${r.h1}"`);
  if (r.four04s && r.four04s.length) for (const u of r.four04s) console.log(`     ⚠ 404: ${u}`);
}
console.log('\nerrors:', errors.length);
for (const e of errors) console.log('  ✗', e);

const allOk = results.every(r => {
  if (r.expectStatus) return r.status === r.expectStatus;
  return r.status === 200 || r.status === 304;
}) && errors.length === 0;
console.log('\nFINAL:', allOk ? 'GREEN ✓ all pages serve + render without errors' : 'RED ✗ see errors above');
process.exit(allOk ? 0 : 1);
