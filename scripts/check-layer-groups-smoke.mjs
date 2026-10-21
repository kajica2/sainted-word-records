// scripts/check-layer-groups-smoke.mjs
// Puppeteer smoke test for the engine's layer groups. Verifies the
// real user path against the built dist/engine:
//
//   1. The engine boots and the layer panel renders layer cards
//   2. The "+ Group" button exists in the layers panel head
//   3. Shift+click marks two layer cards (.multi-selected)
//   4. Pressing "+ Group" creates a group header (.layer-group)
//   5. The group's members carry the group id; unmarked layers do not
//   6. The visibility toggle hides the members and the stage stops
//      drawing them (SWR.Renderer.drawLayer is spied on); the layer
//      strip dims them too
//   7. The collapse toggle removes the member cards from the panel
//   8. Ungroup dissolves the group and restores the members
//   9. A plain click clears the multi-selection and the ring on the card
//  10. Renaming a group updates the record and the field
//
// Self-contained: ensureDist() (from scripts/with-dist.mjs) auto-builds
// dist/ if missing.
//
// Run command:
//   node scripts/check-layer-groups-smoke.mjs
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

// Static server for the built dist/. Port 5184 is distinct from the
// automix (5181) and capture (5182) smokes so they can run side-by-side.
const distDir = path.resolve(dirname(fileURLToPath(import.meta.url)), '../dist');
// The built app version, read from the artifact the Vite plugin wrote.
// lib/app-version-bust.js compares the stored version against this one
// and hard-reloads on a mismatch, so the smoke seeds it (below) to keep
// the page from reloading mid-assertion.
const APP_VERSION = (() => {
  try {
    const src = fs.readFileSync(path.join(distDir, 'lib/app-version.js'), 'utf8');
    const m = src.match(/SWR_APP_VERSION\s*=\s*"([^"]+)"/);
    return m ? m[1] : '';
  } catch (_) {
    return '';
  }
})();
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
  console.error('LAYER GROUPS SMOKE: cannot bind port 5184 — ' + (err && err.code ? err.code : err));
  process.exit(1);
});
server.listen(5184);

const browser = await puppeteer.launch({
  args: [
    '--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage',
    // Belt and braces with the register() stub below: the feature flags
    // stop the worker existing at all, the stub stops it being created.
    '--disable-features=ServiceWorker,ServiceWorkerOnUI',
  ],
});

const results = [];
function ok(name) { results.push('  ✓ ' + name); }
function bad(name, got) {
  results.push('  ✗ ' + name + ' (got: ' + got + ')');
  process.exitCode = 1;
}

async function nav(page, url) {
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForFunction(
    () => document.readyState === 'complete',
    { timeout: 15000 }
  ).catch(() => {});
}

const page = await browser.newPage();
// The engine page reloads itself twice on a cold profile, and either
// reload destroys the execution context in the middle of an assertion:
//   1. lib/app-version-bust.js hard-reloads when the stored version is
//      stale, which it always is in a fresh profile.
//   2. The service worker claims the page on its first activation and
//      pwa-bootstrap.js reloads on 'controllerchange'.
// Neither the layer panel nor the group model has anything to do with
// either, so both are neutralised. Stubbing register() is what actually
// works for the worker — page.setRequestInterception() does not
// intercept the SW script fetch, so blocking the request leaves the
// worker free to register and claim.
await page.evaluateOnNewDocument((v) => {
  try { if (v) localStorage.setItem('swr_app_version_seen', v); } catch (e) {}
  try {
    if (navigator.serviceWorker && typeof navigator.serviceWorker.register === 'function') {
      navigator.serviceWorker.register = () => new Promise(() => {});
    }
  } catch (e) {}
}, APP_VERSION);
// The engine boots in Basic mode, where the layers panel is hidden.
// Force Advanced mode (the mode preference lives in localStorage).
await page.evaluateOnNewDocument(() => {
  try {
    localStorage.setItem('swr.engine.mode', 'advanced');
    localStorage.setItem('swr.engine.firstRun', 'false');
    // The first-run persona tour opens a modal over the layers panel.
    localStorage.setItem('swr.persona.v1', JSON.stringify({ id: 'skipped' }));
    // The engine's own welcome panel does the same (it auto-opens 600ms
    // after boot when this key is absent).
    localStorage.setItem('swr.onboarded.v1', JSON.stringify({ dismissedAt: new Date().toISOString(), version: 1 }));
  } catch (e) {}
});
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

await nav(page, 'http://localhost:5184/engine');

// The same filter the other smokes use: the dev-control WS probe and the
// static server's inability to serve /api/* are pre-existing noise.
const FATAL_FILTER = /WebSocket.*ws:\/\/localhost:8787|404/;
const fatalErrors = errors.filter((e) => !FATAL_FILTER.test(e));
if (fatalErrors.length === 0) ok('no console errors at boot');
else bad('no console errors at boot', JSON.stringify(fatalErrors));

// The engine + its layer stack must be up.
const booted = await page.waitForFunction(
  () => !!(window.SWR && window.SWR.Layers && window.SWR.Renderer),
  { timeout: 20000 }
).then(() => true).catch(() => false);
if (booted) ok('engine booted (window.SWR.Layers + window.SWR.Renderer)');
else bad('engine booted (window.SWR.Layers + window.SWR.Renderer)', 'not ready');

// Wait for the default library to seed the stack, then make sure there
// are at least two layers to group.
const seeded = await page.waitForFunction(
  () => window.SWR.Layers.list.length >= 2,
  { timeout: 20000 }
).then(() => true).catch(() => false);
if (!seeded) {
  await page.evaluate(() => {
    const L = window.SWR.Layers;
    for (let i = 0; i < 2; i++) {
      L.add({ id: 'smoke' + i, name: 'smoke' + i, type: 'image', url: '/default-library/1.png', w: 512, h: 512 });
    }
  });
}
const layerCount = await page.evaluate(() => window.SWR.Layers.list.length);
if (layerCount >= 2) ok('layer stack has ' + layerCount + ' layers');
else bad('layer stack has >= 2 layers', String(layerCount));

// 2. The "+ Group" button.
const btn = await page.evaluate(() => {
  const b = document.getElementById('group-layers');
  return b ? b.tagName + ':' + b.textContent.trim() : null;
});
if (btn && btn.startsWith('BUTTON')) ok('"+ Group" button present (' + btn + ')');
else bad('"+ Group" button present', String(btn));

// 3. Shift+click two layer cards.
const cardCount = await page.evaluate(() => document.querySelectorAll('#layer-list .layer').length);
if (cardCount >= 2) ok('layer panel rendered ' + cardCount + ' layer cards');
else bad('layer panel rendered >= 2 layer cards', String(cardCount));

async function shiftClickCard(index) {
  await page.keyboard.down('Shift');
  await page.evaluate((i) => {
    const cards = document.querySelectorAll('#layer-list .layer');
    const el = cards[i];
    if (!el) throw new Error('no card at ' + i);
    const target = el.querySelector('.name') || el;
    target.dispatchEvent(new MouseEvent('click', { bubbles: true, shiftKey: true, cancelable: true }));
  }, index);
  await page.keyboard.up('Shift');
}

await shiftClickCard(0);
await shiftClickCard(1);
const marked = await page.evaluate(() => ({
  marked: document.querySelectorAll('#layer-list .layer.multi-selected').length,
  selection: window.SWR.Layers.selection.length,
}));
if (marked.marked === 2 && marked.selection === 2) {
  ok('shift+click marked 2 layers (.multi-selected)');
} else {
  bad('shift+click marked 2 layers (.multi-selected)', JSON.stringify(marked));
}

// 4. Press "+ Group".
await page.click('#group-layers');
const afterGroup = await page.evaluate(() => ({
  headers: document.querySelectorAll('#layer-list .layer-group').length,
  groups: window.SWR.Layers.groups.length,
  members: window.SWR.Layers.list.filter((l) => l.groupId).length,
  groupIds: window.SWR.Layers.list.map((l) => l.groupId || null),
}));
if (afterGroup.headers === 1 && afterGroup.groups === 1) {
  ok('"+ Group" created one group header');
} else {
  bad('"+ Group" created one group header', JSON.stringify(afterGroup));
}
if (afterGroup.members === 2) ok('the two marked layers joined the group');
else bad('the two marked layers joined the group', JSON.stringify(afterGroup));

// The unmarked layers must NOT be in the group.
const outsiders = await page.evaluate(() =>
  window.SWR.Layers.list.filter((l) => !l.groupId).length);
if (outsiders >= 1) ok('unmarked layers stayed outside the group');
else bad('unmarked layers stayed outside the group', 'none left');

// 5/6. Visibility toggle → members hidden → the stage stops drawing them.
const drawnBefore = await page.evaluate(async () => {
  const R = window.SWR.Renderer;
  const seen = new Set();
  const orig = R.drawLayer.bind(R);
  R.drawLayer = function (layer, ...rest) { seen.add(layer.id); return orig(layer, ...rest); };
  await new Promise((r) => setTimeout(r, 400));
  R.drawLayer = orig;
  return [...seen];
});
const groupIds = await page.evaluate(() =>
  window.SWR.Layers.list.filter((l) => l.groupId).map((l) => l.id));
if (groupIds.length && groupIds.every((id) => drawnBefore.includes(id))) {
  ok('group members draw on the stage before hiding');
} else {
  bad('group members draw on the stage before hiding', JSON.stringify({ drawnBefore, groupIds }));
}

await page.click('#layer-list .layer-group .g-vis');
const afterHide = await page.evaluate(async () => {
  const hidden = window.SWR.Layers.list.filter((l) => l.hidden).map((l) => l.id);
  const R = window.SWR.Renderer;
  const seen = new Set();
  const orig = R.drawLayer.bind(R);
  R.drawLayer = function (layer, ...rest) { seen.add(layer.id); return orig(layer, ...rest); };
  await new Promise((r) => setTimeout(r, 400));
  R.drawLayer = orig;
  return { hidden, drawn: [...seen] };
});
if (afterHide.hidden.length === 2) ok('visibility toggle hid both group members');
else bad('visibility toggle hid both group members', JSON.stringify(afterHide.hidden));
// The layer strip is the engine's sibling view of the same stack — it
// must agree that the hidden members are not on the stage.
const strip = await page.evaluate(() => ({
  mounted: !!document.querySelector('.layer-strip'),
  items: document.querySelectorAll('.layer-strip .li').length,
  hidden: document.querySelectorAll('.layer-strip .li.hidden').length,
}));
if (!strip.mounted) ok('layer strip not mounted on this page (nothing to keep in sync)');
else if (strip.hidden === 2) ok('the layer strip dims the hidden members too');
else bad('the layer strip dims the hidden members too', JSON.stringify(strip));
if (groupIds.length && groupIds.every((id) => !afterHide.drawn.includes(id))) {
  ok('the stage stops drawing the hidden members');
} else {
  bad('the stage stops drawing the hidden members', JSON.stringify(afterHide));
}

// 7. Collapse removes the member cards from the panel.
await page.click('#layer-list .layer-group .g-caret');
const afterCollapse = await page.evaluate(() => ({
  headers: document.querySelectorAll('#layer-list .layer-group').length,
  cards: document.querySelectorAll('#layer-list .layer').length,
  groupCount: window.SWR.Layers.groups.length,
  collapsed: window.SWR.Layers.groups[0] ? window.SWR.Layers.groups[0].collapsed : null,
}));
if (afterCollapse.headers === 1 && afterCollapse.collapsed === true) {
  ok('collapse toggle kept the header and collapsed the group');
} else {
  bad('collapse toggle kept the header and collapsed the group', JSON.stringify(afterCollapse));
}
if (afterCollapse.cards === cardCount - 2) {
  ok('a collapsed group removes its member cards from the panel');
} else {
  bad('a collapsed group removes its member cards from the panel',
    JSON.stringify({ cards: afterCollapse.cards, expected: cardCount - 2 }));
}

// Expand again, then ungroup.
await page.click('#layer-list .layer-group .g-caret');
await page.click('#layer-list .layer-group .g-ungroup');
const afterUngroup = await page.evaluate(() => ({
  headers: document.querySelectorAll('#layer-list .layer-group').length,
  groups: window.SWR.Layers.groups.length,
  bound: window.SWR.Layers.list.filter((l) => l.groupId).length,
  hidden: window.SWR.Layers.list.filter((l) => l.hidden).length,
}));
if (afterUngroup.headers === 0 && afterUngroup.groups === 0 && afterUngroup.bound === 0) {
  ok('ungroup dissolved the group and its header');
} else {
  bad('ungroup dissolved the group and its header', JSON.stringify(afterUngroup));
}
if (afterUngroup.hidden === 0) ok('ungrouped members are visible again');
else bad('ungrouped members are visible again', JSON.stringify(afterUngroup));

// 9. A plain click clears the marking — both the state and the ring the
// user sees on the card (select() does not re-render, so the ring has to
// come off the DOM in the same call).
await shiftClickCard(0);
const ringBefore = await page.evaluate(() =>
  document.querySelectorAll('#layer-list .layer.multi-selected').length);
await page.evaluate(() => {
  const cards = document.querySelectorAll('#layer-list .layer');
  const target = cards[cards.length - 1];
  const hit = target.querySelector('.name') || target;
  hit.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
});
const ringAfter = await page.evaluate(() => ({
  rings: document.querySelectorAll('#layer-list .layer.multi-selected').length,
  selection: window.SWR.Layers.selection.length,
}));
if (ringBefore === 1 && ringAfter.rings === 0 && ringAfter.selection === 0) {
  ok('a plain click clears the multi-select ring and the marking');
} else {
  bad('a plain click clears the multi-select ring and the marking',
    JSON.stringify({ ringBefore, ...ringAfter }));
}

// 10. Rename a group: type a name into the header's input and commit it.
await shiftClickCard(0);
await shiftClickCard(1);
await page.click('#group-layers');
await page.click('#layer-list .layer-group .g-name');
// Clear whatever the header shipped with, then type the new name.
await page.evaluate(() => {
  const inp = document.querySelector('#layer-list .layer-group .g-name');
  if (inp) { inp.focus(); inp.value = ''; }
});
await page.type('#layer-list .layer-group .g-name', 'Intro');
await page.keyboard.press('Enter');
await new Promise((r) => setTimeout(r, 200));
const renamed = await page.evaluate(() => ({
  name: window.SWR.Layers.groups[0] ? window.SWR.Layers.groups[0].name : null,
  shown: document.querySelector('#layer-list .layer-group .g-name')
    ? document.querySelector('#layer-list .layer-group .g-name').value
    : null,
}));
if (renamed.name === 'Intro' && renamed.shown === 'Intro') {
  ok('renaming a group updates the record and the field');
} else {
  bad('renaming a group updates the record and the field', JSON.stringify(renamed));
}

await page.close();
console.log(results.join('\n'));
console.log('\nLAYER GROUPS SMOKE: ' + (process.exitCode ? 'FAILED' : 'PASSED') +
  ' (' + results.length + ' assertions)');
await browser.close();
server.close();
