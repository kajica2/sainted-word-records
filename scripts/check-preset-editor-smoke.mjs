#!/usr/bin/env node
// scripts/check-preset-editor-smoke.mjs
// Puppeteer smoke test for the NEON preset editor (preset-editor.html).
// Verifies the real user path against the built dist/:
//
//   1. the page boots with no console/page errors and the shared chrome is
//      mounted (nav + footer) — the editor is a shipped page, not a stub
//   2. the stage actually paints (the canvas is not a blank field)
//   3. moving a control changes the preset document AND the rendered pixels
//   4. adding a layer adds a layer card, and deleting it removes it
//   5. the JSON tab round-trips: apply a document, the editor adopts it
//   6. a new preset persists to localStorage and reloads with it
//   7. "Apply to engine" dispatches the swr:preset-applied event with the
//      preset document — the documented engine bridge
//   8. the deep link (#p=<base64url>) restores the preset it carries
//
// Self-contained: ensureDist() (from scripts/with-dist.mjs) auto-builds
// dist/ if missing.
//
// Run command:
//   node scripts/check-preset-editor-smoke.mjs
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
      : ext === '.css' ? 'text/css'
      : ext === '.json' ? 'application/json'
      : 'application/octet-stream';
    res.setHeader('Content-Type', mime);
    res.end(data);
  });
});
server.on('error', (err) => {
  console.error('PRESET EDITOR SMOKE: cannot bind port 5186 — ' + (err && err.code ? err.code : err));
  process.exit(1);
});
server.listen(5186);

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
await page.setViewport({ width: 1440, height: 900 });
await page.setRequestInterception(true);
page.on('request', (r) => {
  if (/sw\.js(\?|$)/.test(r.url())) r.abort().catch(() => {});
  else r.continue().catch(() => {});
});
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

async function nav(url) {
  await page.goto('http://localhost:5186' + url, { waitUntil: 'networkidle2', timeout: 30000 });
  await page.waitForFunction(() => !!window.SWRPresetEditor, { timeout: 10000 });
}

// --- 1) boot + shared chrome ----------------------------------------------
await nav('/preset-editor');
if (errors.length) bad('the page boots without console errors', errors[0]);
else ok('the page boots without console errors');

const chrome = await page.evaluate(() => ({
  nav: !!document.querySelector('swr-nav'),
  navLinks: document.querySelectorAll('swr-nav a').length,
  footer: !!document.querySelector('swr-footer'),
  footerLinks: document.querySelectorAll('swr-footer a').length,
  main: !!document.querySelector('main'),
  exit: !!document.querySelector('a[href="/"]'),
}));
if (chrome.nav && chrome.navLinks > 0) ok('the shared nav is mounted with links');
else bad('the shared nav is mounted with links', JSON.stringify(chrome));
if (chrome.footer && chrome.footerLinks > 0) ok('the shared footer is mounted with links');
else bad('the shared footer is mounted with links', JSON.stringify(chrome));
if (chrome.main) ok('the page has a main landmark');
else bad('the page has a main landmark', 'no <main>');
if (chrome.exit) ok('the page carries an exit link back to the site');
else bad('the page carries an exit link back to the site', 'no a[href="/"]');

// --- 2) the stage paints ---------------------------------------------------
// The composition is centred, so the sample covers the WHOLE canvas: a
// corner sample reads an empty region and would pass or fail on where the
// drawing happens to sit, not on whether it drew.
const stageStats = () => page.evaluate(() => {
  const c = document.querySelector('#stage');
  const g = c.getContext('2d');
  const d = g.getImageData(0, 0, c.width, c.height).data;
  let lit = 0, sum = 0;
  for (let i = 0; i < d.length; i += 4) {
    const v = d[i] + d[i + 1] + d[i + 2];
    sum += v;
    if (v > 40) lit++;
  }
  return { lit, sum, w: c.width, h: c.height };
});
await page.waitForFunction(() => {
  const c = document.querySelector('#stage');
  if (!c || !c.width) return false;
  const g = c.getContext('2d');
  const d = g.getImageData(0, 0, c.width, c.height).data;
  for (let i = 0; i < d.length; i += 4) {
    if (d[i] + d[i + 1] + d[i + 2] > 40) return true;
  }
  return false;
}, { timeout: 10000 }).catch(() => {});
const painted = await stageStats();
if (painted.lit > 0) ok('the stage paints a live composition (' + painted.lit + ' lit samples)');
else bad('the stage paints a live composition', 'no lit pixels');

// --- 3) a control changes the document AND the pixels ----------------------
const before = await stageStats();
await page.evaluate(() => {
  const el = document.querySelector('input[data-path="global.hue"]');
  el.value = '0.05';
  el.dispatchEvent(new Event('input', { bubbles: true }));
});
await new Promise(r => setTimeout(r, 600));
const after = await page.evaluate(() => ({
  hue: window.SWRPresetEditor.preset.global.hue,
}));
const afterStats = await stageStats();
if (Math.abs(after.hue - 0.05) < 1e-6) ok('a slider writes into the preset document');
else bad('a slider writes into the preset document', after.hue);
if (afterStats.sum !== before.sum) ok('a slider changes what is rendered');
else bad('a slider changes what is rendered', 'identical pixels');

// --- 4) add + delete a layer ----------------------------------------------
const layersBefore = await page.evaluate(() => window.SWRPresetEditor.preset.layers.length);
await page.evaluate(() => document.querySelector('[data-cmd="addLayer"]').click());
const layersAfter = await page.evaluate(() => ({
  count: window.SWRPresetEditor.preset.layers.length,
  cards: document.querySelectorAll('#layers .card').length,
}));
if (layersAfter.count === layersBefore + 1) ok('adding a layer adds it to the preset');
else bad('adding a layer adds it to the preset', layersAfter.count + ' vs ' + layersBefore);
if (layersAfter.cards === layersAfter.count) ok('the layer panel renders a card per layer');
else bad('the layer panel renders a card per layer', layersAfter.cards + ' cards for ' + layersAfter.count);
await page.evaluate(() => {
  const del = document.querySelector('#layers .card [data-act="del"]');
  del.click();
});
const layersBack = await page.evaluate(() => window.SWRPresetEditor.preset.layers.length);
if (layersBack === layersBefore) ok('deleting a layer removes it from the preset');
else bad('deleting a layer removes it from the preset', layersBack + ' vs ' + layersBefore);

// --- 5) the JSON tab round-trips ------------------------------------------
await page.evaluate(() => document.querySelector('[data-tab="json"]').click());
const jsonApplied = await page.evaluate(() => {
  const box = document.querySelector('#jsonBox');
  const doc = JSON.parse(JSON.stringify(window.SWRPresetEditor.preset));
  doc.name = 'JSON Round Trip';
  doc.global.bloom = 0.11;
  box.value = JSON.stringify(doc, null, 2);
  document.querySelector('[data-cmd="jsonApply"]').click();
  const p = window.SWRPresetEditor.preset;
  return { name: p.name, bloom: p.global.bloom };
});
if (jsonApplied.name === 'JSON Round Trip' && Math.abs(jsonApplied.bloom - 0.11) < 1e-6) {
  ok('the JSON tab applies a document to the editor');
} else {
  bad('the JSON tab applies a document to the editor', JSON.stringify(jsonApplied));
}
const jsonRejected = await page.evaluate(() => {
  const box = document.querySelector('#jsonBox');
  box.value = '{ not json';
  document.querySelector('[data-cmd="jsonApply"]').click();
  return { name: window.SWRPresetEditor.preset.name, toast: (document.querySelector('#toast') || {}).textContent || '' };
});
if (jsonRejected.name === 'JSON Round Trip' && /Invalid JSON/.test(jsonRejected.toast)) {
  ok('invalid JSON is rejected without losing the preset');
} else {
  bad('invalid JSON is rejected without losing the preset', JSON.stringify(jsonRejected));
}

// --- 6) a new preset persists ---------------------------------------------
await page.evaluate(() => document.querySelector('[data-cmd="new"]').click());
await new Promise(r => setTimeout(r, 700));
const stored = await page.evaluate(() => {
  const raw = JSON.parse(localStorage.getItem('swr.presets.v1') || '{}');
  const names = Object.values(raw.presets || {}).map(p => p.name);
  return { names, current: (window.SWRPresetEditor.preset || {}).name };
});
if (stored.names.length >= 2 && stored.current && stored.names.includes(stored.current)) {
  ok('a new preset is written to localStorage');
} else {
  bad('a new preset is written to localStorage', JSON.stringify(stored));
}
await page.reload({ waitUntil: 'networkidle2' });
await page.waitForFunction(() => !!window.SWRPresetEditor, { timeout: 10000 });
const afterReload = await page.evaluate(() => ({
  count: Object.keys(window.SWRPresetEditor.all).length,
  current: window.SWRPresetEditor.preset.name,
}));
if (afterReload.count === stored.names.length) ok('the presets survive a reload');
else bad('the presets survive a reload', afterReload.count + ' vs ' + stored.names.length);

// --- 7) the engine bridge -------------------------------------------------
const bridged = await page.evaluate(() => new Promise((resolve) => {
  window.addEventListener('swr:preset-applied', (e) => {
    resolve({ name: e.detail && e.detail.name, layers: (e.detail && e.detail.layers || []).length });
  }, { once: true });
  document.querySelector('[data-cmd="push"]').click();
  setTimeout(() => resolve(null), 3000);
}));
if (bridged && bridged.name) ok('"Apply to engine" dispatches swr:preset-applied with the document');
else bad('"Apply to engine" dispatches swr:preset-applied with the document', JSON.stringify(bridged));

// --- 8) the deep link restores its preset ---------------------------------
// The link carries whatever is current, so the expectation comes from the
// link's own payload — not from a name captured earlier in the run.
const link = await page.evaluate(() => ({
  url: window.SWRPresetEditor.shareUrl(),
  name: window.SWRPresetEditor.preset.name,
  bloom: window.SWRPresetEditor.preset.global.bloom,
}));
const hash = link.url.slice(link.url.indexOf('#'));
await page.goto('http://localhost:5186/preset-editor' + hash, { waitUntil: 'networkidle2' });
await page.waitForFunction(() => !!window.SWRPresetEditor, { timeout: 10000 });
const deep = await page.evaluate(() => ({
  name: window.SWRPresetEditor.preset.name,
  bloom: window.SWRPresetEditor.preset.global.bloom,
}));
if (deep.name === link.name && Math.abs(deep.bloom - link.bloom) < 1e-6) {
  ok('the deep link restores the preset it carries');
} else {
  bad('the deep link restores the preset it carries', JSON.stringify({ expected: link, got: deep }));
}

// --- console hygiene ------------------------------------------------------
if (errors.length) bad('no console errors during the run', errors[0]);
else ok('no console errors during the run');

await browser.close();
server.close();

console.log('PRESET EDITOR SMOKE');
for (const r of results) console.log(r);
if (process.exitCode) {
  console.log('FAILURES ABOVE');
} else {
  console.log('\nPASS: ' + results.length);
}
