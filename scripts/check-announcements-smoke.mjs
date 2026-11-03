// scripts/check-announcements-smoke.mjs
// Puppeteer smoke test for the auto-post feed. Verifies the real user
// path against the built dist/:
//
//   1. /changelog renders the posts from site-map.json's `announcements`
//      (date, title, body, link) in the "Latest posts" section
//   2. The newest post leads the feed and links to its own destination
//   3. The shared footer's bottom bar shows the newest post as "New — …"
//   4. /marketplace renders the same feed, capped by its own limit
//   5. A page with no feed container (e.g. /about) still shows the post
//      in the footer — the data is inlined site-wide, not fetched
//
// Self-contained: ensureDist() (from scripts/with-dist.mjs) auto-builds
// dist/ if missing.
//
// Run command:
//   node scripts/check-announcements-smoke.mjs
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
  let file = path.join(distDir, p);
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
      : 'application/octet-stream';
    res.setHeader('Content-Type', mime);
    res.end(data);
  });
});
server.on('error', (err) => {
  console.error('ANNOUNCEMENTS SMOKE: cannot bind port 5185 — ' + (err && err.code ? err.code : err));
  process.exit(1);
});
// The port is chosen by the OS (0 = ephemeral) and read back below: a
// fixed port collides with whatever else holds it — a parallel gate run
// is enough to fail the whole step with EADDRINUSE.
await new Promise((resolve, reject) => {
  server.once('error', reject);
  server.listen(0, '127.0.0.1', resolve);
});
const PORT = server.address().port;
const BASE = `http://127.0.0.1:${PORT}`;

const browser = await puppeteer.launch({
  args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
});

const results = [];
function ok(name) { results.push('  ✓ ' + name); }
function bad(name, got) {
  results.push('  ✗ ' + name + ' (got: ' + got + ')');
  process.exitCode = 1;
}

const page = await browser.newPage();
await page.setRequestInterception(true);
page.on('request', (r) => {
  if (/sw\.js(\?|$)/.test(r.url())) r.abort().catch(() => {});
  else r.continue().catch(() => {});
});
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

async function nav(url) {
  // Navigate on domcontentloaded and give the page a bounded chance to
  // reach 'complete'. A networkidle wait never settles on a CI runner —
  // the service worker and the announcement feed keep a connection open —
  // and the step then dies with a 30s navigation timeout that says
  // nothing about the gate.
  await page.goto(BASE + url, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForFunction(() => document.readyState === 'complete', { timeout: 15000 }).catch(() => {});
  await page.waitForFunction(() => window.SWR_ANNOUNCEMENTS || true, { timeout: 10000 }).catch(() => {});
}

// The expectations come from the data, not from a copy of it: if a post
// is added or edited, the gate follows.
const siteMap = JSON.parse(fs.readFileSync(path.join(distDir, 'site-map.json'), 'utf8'));
const posts = Array.isArray(siteMap.announcements) ? siteMap.announcements : [];
if (!posts.length) {
  console.log('ANNOUNCEMENTS SMOKE: FAILURES ABOVE');
  console.log('  ✗ site-map.json has no announcements');
  await browser.close();
  server.close();
  process.exit(1);
}
const newest = posts[0];

// --- 1) the changelog renders the feed ------------------------------------
await nav('/changelog.html');
const feed = await page.evaluate(() => {
  const box = document.querySelector('[data-announcements]');
  if (!box) return null;
  return [...box.querySelectorAll('.announcement')].map(card => ({
    date: (card.querySelector('.announcement__date') || {}).textContent || '',
    title: (card.querySelector('.announcement__title') || {}).textContent || '',
    body: (card.querySelector('.announcement__body') || {}).textContent || '',
    href: (card.querySelector('.announcement__link') || {}).getAttribute
      ? card.querySelector('.announcement__link').getAttribute('href')
      : '',
    target: (card.querySelector('.announcement__link') || {}).target || '',
  }));
});
if (feed === null) bad('the changelog has a feed container', 'no [data-announcements] element');
else if (feed.length !== Math.min(5, posts.length)) bad('the changelog renders the posts', feed.length + ' of ' + posts.length);
else ok('the changelog renders the posts');
if (feed && feed[0] && feed[0].title === newest.title) ok('the newest post leads the feed');
else bad('the newest post leads the feed', feed && feed[0] ? feed[0].title : 'none');
if (feed && feed[0] && feed[0].date === String(newest.date || '')) ok('the post shows its date');
else bad('the post shows its date', feed && feed[0] ? feed[0].date : 'none');
if (feed && feed[0] && feed[0].href === newest.href) ok('the post links to its own destination');
else bad('the post links to its own destination', feed && feed[0] ? feed[0].href : 'none');
if (feed && feed[0] && feed[0].target === '_blank') ok('an external post opens in a new tab');
else bad('an external post opens in a new tab', feed && feed[0] ? feed[0].target : 'none');

// --- 2) the footer shows the newest post ----------------------------------
const foot = await page.evaluate(() => {
  const a = document.querySelector('.footer__bottom-links a.footer__announcement');
  if (!a) return null;
  return { text: a.textContent, href: a.getAttribute('href'), target: a.target, rel: a.rel };
});
if (!foot) bad('the footer shows the newest post', 'no .footer__announcement link');
else {
  ok('the footer shows the newest post');
  if (foot.text === 'New — ' + newest.title) ok('the footer post is labelled');
  else bad('the footer post is labelled', foot.text);
  if (foot.href === newest.href) ok('the footer post links to the store');
  else bad('the footer post links to the store', foot.href);
  if (foot.target === '_blank' && foot.rel === 'noopener') ok('the footer post is a safe external link');
  else bad('the footer post is a safe external link', foot.target + '/' + foot.rel);
}

// --- 3) the marketplace renders the same feed ------------------------------
await nav('/marketplace.html');
const mp = await page.evaluate(() => {
  const box = document.querySelector('[data-announcements]');
  if (!box) return null;
  return [...box.querySelectorAll('.announcement')].map(c => (c.querySelector('.announcement__title') || {}).textContent || '');
});
if (mp === null) bad('the marketplace has a feed container', 'no [data-announcements] element');
else if (mp.length !== Math.min(3, posts.length)) bad('the marketplace renders the posts', mp.length + ' of ' + posts.length);
else ok('the marketplace renders the posts');
if (mp && mp[0] === newest.title) ok('the marketplace shows the newest post first');
else bad('the marketplace shows the newest post first', mp && mp[0] ? mp[0] : 'none');

// --- 4) a page with no feed still shows it in the footer -------------------
await nav('/about.html');
const aboutFoot = await page.evaluate(() => {
  const a = document.querySelector('.footer__bottom-links a.footer__announcement');
  return a ? a.getAttribute('href') : null;
});
if (aboutFoot === newest.href) ok('the post reaches every page through the footer');
else bad('the post reaches every page through the footer', String(aboutFoot));

// --- 5) no errors ----------------------------------------------------------
const FATAL_FILTER = /404|Failed to load resource/;
const fatalErrors = errors.filter((e) => !FATAL_FILTER.test(e));
if (fatalErrors.length === 0) ok('no console errors');
else bad('no console errors', fatalErrors.slice(0, 3).join(' | '));

console.log(results.join('\n'));
console.log('');
if (process.exitCode) {
  console.log('ANNOUNCEMENTS SMOKE: FAILURES ABOVE');
} else {
  console.log('ANNOUNCEMENTS SMOKE: PASSED (' + results.length + ' assertions)');
}
await browser.close();
server.close();
