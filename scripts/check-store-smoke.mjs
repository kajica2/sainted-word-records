// scripts/check-store-smoke.mjs
// Puppeteer smoke test for the store. Verifies the real user path against
// the built dist/:
//
//   1. /marketplace renders the download catalogue from site-map.json's
//      `store` block — name, blurb, price and a CTA — without a line of
//      product HTML in the page
//   2. a product with a Gumroad URL links to it; a product without one says
//      "Coming soon" and carries no URL
//   3. /shop renders the shop products from the same catalogue, and a
//      product without a Stripe Payment Link gets a disabled Buy button —
//      never a dead checkout URL
//   4. the shop's "checkout is not live yet" notice is visible while the
//      payments are pending
//   5. /campaign's tier CTAs are wired to the store, and its order form
//      falls back to email when a tier has no Payment Link
//   6. no page ships a placeholder checkout URL (buy.stripe.com/SWR_… or
//      REPLACE_…)
//
// Self-contained: ensureDist() (from scripts/with-dist.mjs) auto-builds
// dist/ if missing.
//
// Run command:
//   node scripts/check-store-smoke.mjs
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

// The port is chosen by the OS (0 = ephemeral) and read back from the
// bound server: a hardcoded port collides with whatever else on the
// machine holds it.
let PORT = 0;
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
  console.error('STORE SMOKE: the static server failed — ' + (err && err.code ? err.code : err));
  process.exit(1);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
PORT = server.address().port;

const browser = await puppeteer.launch({
  args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
});

const results = [];
function ok(name) { results.push('  ✓ ' + name); }
function bad(name, got) {
  results.push('  ✗ ' + name + (got !== undefined ? ' — got: ' + got : ''));
  process.exitCode = 1;
}

const page = await browser.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

async function nav(pathname) {
// 'networkidle' never settles on the CI runner: the page keeps a
// connection open (the service worker, the shared-chrome fetch), so
// the navigation waits out its whole timeout and the smoke fails on
// a page that loaded fine. The readiness signal is the page's own
// global, which the waitForFunction below already waits for — the
// same reasoning as scripts/check-play-variant.mjs.
  await page.goto('http://127.0.0.1:' + PORT + pathname, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => !!window.SWR_STORE, { timeout: 5000 }).catch(() => {});
}

// The expectations come from the data, not from a copy of it: add a
// product to site-map.json and the gate follows.
const siteMap = JSON.parse(fs.readFileSync(path.join(distDir, 'site-map.json'), 'utf8'));
const store = siteMap.store || {};
const downloads = Array.isArray(store.downloads) ? store.downloads : [];
const products = Array.isArray(store.products) ? store.products : [];

if (!downloads.length) {
  console.error('STORE SMOKE: site-map.json has no store.downloads');
  process.exit(1);
}

// --- 1) the marketplace renders the catalogue ------------------------------
await nav('/marketplace.html');
const cards = await page.evaluate(() => {
  const grid = document.querySelector('.store__grid');
  if (!grid) return null;
  return Array.from(grid.querySelectorAll('.store__card')).map(card => ({
    id: card.getAttribute('data-store-product'),
    name: (card.querySelector('.store__name') || {}).textContent || '',
    blurb: (card.querySelector('.store__blurb') || {}).textContent || '',
    price: (card.querySelector('.store__price') || {}).textContent || '',
    cta: (card.querySelector('.store__cta') || {}).textContent || '',
    href: (card.querySelector('.store__cta') || {}).getAttribute
      ? card.querySelector('.store__cta').getAttribute('href')
      : null,
    disabled: card.querySelector('.store__cta')
      ? card.querySelector('.store__cta').getAttribute('aria-disabled') === 'true'
      : false,
  }));
});

if (cards === null) bad('the marketplace has a store section', 'no .store__grid');
else if (cards.length !== downloads.length) bad('the marketplace renders every product', cards.length + ' of ' + downloads.length);
else ok('the marketplace renders every product');

if (cards) {
  const first = downloads[0];
  const card = cards.find(c => c.id === first.id);
  if (!card) bad('the first product is listed', 'no card for ' + first.id);
  else {
    if (card.name !== first.name) bad('the card shows the product name', card.name);
    else ok('the card shows the product name');
    if (card.blurb !== first.blurb) bad('the card shows the blurb', card.blurb);
    else ok('the card shows the blurb');
    if (card.price) ok('the card shows the price');
    else bad('the card shows the price', '(empty)');
    // A live Gumroad URL wins; otherwise the off-site download URL; with
    // neither, the card must not carry a URL at all.
    const liveGumroad = /^https:\/\//.test(first.gumroadUrl || '') && !/REPLACE_/.test(first.gumroadUrl || '');
    const liveDownload = /^https:\/\//.test(first.downloadUrl || '') && !/REPLACE_/.test(first.downloadUrl || '');
    if (liveGumroad) {
      if (card.href === first.gumroadUrl) ok('the card links to Gumroad');
      else bad('the card links to Gumroad', String(card.href));
      if (card.cta === 'Buy on Gumroad →') ok('the CTA says it buys on Gumroad');
      else bad('the CTA says it buys on Gumroad', card.cta);
    } else if (liveDownload) {
      if (card.href === first.downloadUrl) ok('the card links to the off-site download');
      else bad('the card links to the off-site download', String(card.href));
    } else {
      if (!card.href) ok('a product without a link carries no URL');
      else bad('a product without a link carries no URL', String(card.href));
      if (card.disabled) ok('a product without a link is marked pending');
      else bad('a product without a link is marked pending', 'aria-disabled is not set');
    }
  }
}

const storeLink = await page.evaluate(() => {
  const el = document.querySelector('.store__store-link');
  return el ? { href: el.getAttribute('href'), text: el.textContent } : null;
});
if (!storeLink) bad('the store link is painted', 'no .store__store-link');
else if (storeLink.href === (store.gumroad && store.gumroad.url)) ok('the store link points at the store');
else bad('the store link points at the store', String(storeLink.href));

// --- 2) the shop renders the shop catalogue --------------------------------
await nav('/shop.html?g=music&c=0');
const shopRows = await page.evaluate(() => {
  const rows = Array.from(document.querySelectorAll('#products .product'));
  return rows.map(row => {
    const buy = row.querySelector('.product__buy');
    return {
      name: (row.querySelector('.product__name') || {}).textContent || '',
      price: (row.querySelector('.product__price') || {}).textContent || '',
      label: buy ? buy.textContent.trim() : '',
      href: buy ? buy.getAttribute('href') : null,
      disabled: row.classList.contains('is-disabled'),
    };
  });
});
const shopProducts = products.filter(p => p.surface === 'shop');
if (shopRows.length !== shopProducts.length) bad('the shop renders the shop catalogue', shopRows.length + ' of ' + shopProducts.length);
else ok('the shop renders the shop catalogue');
if (shopRows.length) {
  const p = shopProducts[0];
  const row = shopRows.find(r => r.name === p.name);
  if (!row) bad('the shop lists the first product', shopRows.map(r => r.name).join(', '));
  else {
    const live = /^https:\/\//.test(p.stripeUrl || '') && !/REPLACE_|SWR_[A-Z_]*_\d/.test(p.stripeUrl || '');
    if (live) {
      if (row.href && row.href.indexOf(p.stripeUrl) === 0) ok('the buy button points at the Payment Link');
      else bad('the buy button points at the Payment Link', String(row.href));
      if (!row.disabled) ok('a live product is not disabled');
      else bad('a live product is not disabled', 'is-disabled');
    } else {
      if (row.disabled) ok('a product without a link is disabled');
      else bad('a product without a link is disabled', 'not disabled');
      if (row.href === '#notice' || row.href === '#') ok('a disabled buy button points at the notice');
      else bad('a disabled buy button points at the notice', String(row.href));
      if (row.label === 'Coming soon') ok('a disabled buy button says so');
      else bad('a disabled buy button says so', row.label);
    }
  }
}

const noticeVisible = await page.evaluate(() => {
  const notice = document.getElementById('notice');
  if (!notice) return null;
  return getComputedStyle(notice).display !== 'none';
});
if (noticeVisible === null) bad('the shop has a checkout notice', 'no #notice');
else if (noticeVisible) ok('the shop says checkout is not live yet');
else bad('the shop says checkout is not live yet', 'the notice is hidden while the payments are pending');

// --- 3) the campaign tiers are wired to the store --------------------------
await nav('/campaign.html');
const tiers = await page.evaluate(() => {
  const nodes = Array.from(document.querySelectorAll('[data-stripe-product]'));
  return nodes.map(n => ({
    id: n.getAttribute('data-stripe-product'),
    state: n.getAttribute('data-stripe-state'),
    href: n.getAttribute('href'),
    disabled: n.getAttribute('aria-disabled') === 'true',
  }));
});
const campaignProducts = products.filter(p => p.surface === 'campaign');
if (!tiers.length) bad('the campaign has tier CTAs', 'no [data-stripe-product] elements');
else ok('the campaign has tier CTAs');
const campaignIds = tiers.map(t => t.id).sort().join(',');
const expectedIds = campaignProducts.map(p => p.id).sort().join(',');
if (campaignIds === expectedIds) ok('every campaign tier maps to a store product');
else bad('every campaign tier maps to a store product', campaignIds + ' vs ' + expectedIds);
const liveTier = tiers.find(t => {
  const p = campaignProducts.find(x => x.id === t.id);
  return p && /^https:\/\//.test(p.stripeUrl || '') && !/REPLACE_|SWR_[A-Z_]*_\d/.test(p.stripeUrl || '');
});
if (liveTier) {
  if (liveTier.state === 'live' && liveTier.href === liveTier.href) ok('a tier with a Payment Link is live');
  else bad('a tier with a Payment Link is live', liveTier.state + ' ' + liveTier.href);
} else {
  const pending = tiers.find(t => t.state === 'pending');
  if (pending) ok('a tier without a Payment Link is pending');
  else bad('a tier without a Payment Link is pending', 'none pending');
  if (tiers.every(t => !/buy\.stripe\.com/.test(t.href || ''))) ok('no tier points at a placeholder checkout');
  else bad('no tier points at a placeholder checkout', tiers.map(t => t.href).join(' '));
}

// --- 4) no placeholder checkout URLs shipped -------------------------------
const placeholderPages = ['/marketplace.html', '/shop.html', '/campaign.html'];
let placeholders = [];
for (const p of placeholderPages) {
  const html = fs.readFileSync(path.join(distDir, p.replace(/^\//, '')), 'utf8');
  if (/buy\.stripe\.com\/SWR_|REPLACE_[A-Z_]*_\d/.test(html)) placeholders.push(p);
}
if (placeholders.length === 0) ok('no page ships a placeholder checkout URL');
else bad('no page ships a placeholder checkout URL', placeholders.join(' '));

// --- 5) no console errors --------------------------------------------------
const FATAL_FILTER = /404|Failed to load resource/;
const fatalErrors = errors.filter((e) => !FATAL_FILTER.test(e));
if (fatalErrors.length === 0) ok('no console errors');
else bad('no console errors', fatalErrors.slice(0, 3).join(' | '));

console.log(results.join('\n'));
console.log('');
if (process.exitCode) {
  console.log('STORE SMOKE: FAILURES ABOVE');
} else {
  console.log('STORE SMOKE: PASSED (' + results.length + ' assertions)');
}
await browser.close();
server.close();
