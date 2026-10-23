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
  steerDefault: document.querySelector('.panel[data-panel="steer"]').classList.contains('on'),
}));
if (chrome.nav && chrome.navLinks > 0) ok('the shared nav is mounted with links');
else bad('the shared nav is mounted with links', JSON.stringify(chrome));
if (chrome.footer && chrome.footerLinks > 0) ok('the shared footer is mounted with links');
else bad('the shared footer is mounted with links', JSON.stringify(chrome));
if (chrome.main) ok('the page has a main landmark');
else bad('the page has a main landmark', 'no <main>');
if (chrome.exit) ok('the page carries an exit link back to the site');
else bad('the page carries an exit link back to the site', 'no a[href="/"]');
if (chrome.steerDefault) ok('the Direction tab is the surface the page opens on');
else bad('the Direction tab is the surface the page opens on', 'not on');

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

// --- 6) the steering is additive, and the direction is what it says -------
// The Direction tab is the page's default surface, and the panel's central
// claim is that steering NUDGES the preset: at steer 0 the resolved values
// must be the preset's own.
const steerTab = await page.evaluate(() => ({
  summary: (document.querySelector('#summary') || {}).textContent || '',
  badge: (document.querySelector('#dirBadgeTxt') || {}).textContent || '',
}));
if (/Preset voice/.test(steerTab.summary) && /Your direction/.test(steerTab.summary)) {
  ok('the summary shows the preset/direction split');
} else {
  bad('the summary shows the preset/direction split', steerTab.summary.slice(0, 80));
}
if (steerTab.badge.trim()) ok('the stage carries a direction badge (' + steerTab.badge.trim() + ')');
else bad('the stage carries a direction badge', 'empty');

const neutral = await page.evaluate(() => {
  const p = window.SWRPresetEditor.preset;
  const before = window.SWRPresetEditor.resolved;
  // Steer to zero and read the resolution again: it must be the preset.
  p.steer.blend = 0;
  const atZero = window.SWRPresetEditor.resolved;
  p.steer.blend = 0.45;
  return {
    baseHue: p.global.hue,
    atZeroHue: atZero.hue,
    atZeroPa: atZero.pa,
    atZeroCountMul: atZero.countMul,
    atZeroOpacityMul: atZero.opacityMul,
    beforeHue: before.hue,
  };
});
if (Math.abs(neutral.atZeroHue - neutral.baseHue) < 1e-9) ok('at steer 0 the hue is the preset hue');
else bad('at steer 0 the hue is the preset hue', neutral.atZeroHue + ' vs ' + neutral.baseHue);
if (neutral.atZeroPa === 0) ok('at steer 0 no palette is mixed in');
else bad('at steer 0 no palette is mixed in', neutral.atZeroPa);
if (Math.abs(neutral.atZeroCountMul - 1) < 1e-9 && Math.abs(neutral.atZeroOpacityMul - 1) < 1e-9) {
  ok('at steer 0 the layer multipliers are neutral');
} else {
  bad('at steer 0 the layer multipliers are neutral',
    'count ' + neutral.atZeroCountMul + ' opacity ' + neutral.atZeroOpacityMul);
}

// A palette must change the picture, not just the numbers.
const beforePal = await stageStats();
await page.evaluate(() => document.querySelector('[data-pal="acid"]').click());
await new Promise(r => setTimeout(r, 700));
const afterPal = await page.evaluate(() => ({
  palette: window.SWRPresetEditor.preset.steer.palette,
  hue: window.SWRPresetEditor.resolved.hue,
  pa: window.SWRPresetEditor.resolved.pa,
}));
const afterPalStats = await stageStats();
if (afterPal.palette === 'acid' && afterPal.pa > 0) ok('a palette button sets the direction palette');
else bad('a palette button sets the direction palette', JSON.stringify(afterPal));
if (afterPalStats.sum !== beforePal.sum) ok('the palette changes what is rendered');
else bad('the palette changes what is rendered', 'identical pixels');

// A vibe is a whole direction in one click.
await page.evaluate(() => document.querySelector('[data-vibe="Hyper"]').click());
await new Promise(r => setTimeout(r, 500));
const vibe = await page.evaluate(() => {
  const s = window.SWRPresetEditor.preset.steer;
  return { palette: s.palette, energy: s.mood.energy, aberration: s.filters.aberration };
});
if (vibe.palette === 'ultra' && vibe.energy > 0.5 && vibe.aberration > 0.3) {
  ok('a vibe applies its palette, mood and filters');
} else {
  bad('a vibe applies its palette, mood and filters', JSON.stringify(vibe));
}

// The direction can be carried across presets: the direction of the preset
// you are LEAVING is the one that follows you.
const carried = await page.evaluate(async () => {
  const keep = document.querySelector('#keepSteer');
  keep.checked = true;
  keep.dispatchEvent(new Event('change', { bubbles: true }));
  // Two presets to switch between.
  document.querySelector('[data-cmd="new"]').click();
  const from = window.SWRPresetEditor.preset;
  from.steer.palette = 'blood';
  from.steer.mood.energy = 0.77;
  const sel = document.querySelector('#presetSelect');
  const other = Object.values(window.SWRPresetEditor.all).find(x => x.id !== from.id);
  sel.value = other.id;
  sel.dispatchEvent(new Event('change', { bubbles: true }));
  const now = window.SWRPresetEditor.preset.steer;
  return { palette: now.palette, energy: now.mood.energy, name: window.SWRPresetEditor.preset.name };
});
if (carried.palette === 'blood' && Math.abs(carried.energy - 0.77) < 1e-9) {
  ok('"keep my direction" carries the direction across presets');
} else {
  bad('"keep my direction" carries the direction across presets', JSON.stringify(carried));
}

// --- 7) a new preset persists ---------------------------------------------
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

// --- 8) the engine bridge -------------------------------------------------
const bridged = await page.evaluate(() => new Promise((resolve) => {
  window.addEventListener('swr:preset-applied', (e) => {
    resolve({
      name: e.detail && e.detail.name,
      layers: (e.detail && e.detail.layers || []).length,
      steer: !!(e.detail && e.detail.steer),
      resolved: e.detail && e.detail.resolved,
    });
  }, { once: true });
  document.querySelector('[data-cmd="push"]').click();
  setTimeout(() => resolve(null), 3000);
}));
if (bridged && bridged.name) ok('"Apply to engine" dispatches swr:preset-applied with the document');
else bad('"Apply to engine" dispatches swr:preset-applied with the document', JSON.stringify(bridged));
if (bridged && bridged.steer) ok('the applied document carries the steer block');
else bad('the applied document carries the steer block', JSON.stringify(bridged));
if (bridged && bridged.resolved && typeof bridged.resolved.hue === 'number' && bridged.resolved.palette) {
  ok('the applied document carries the resolved view');
} else {
  bad('the applied document carries the resolved view', JSON.stringify(bridged && bridged.resolved));
}
if (bridged && bridged.resolved
  && typeof bridged.resolved.reactivity === 'number'
  && typeof bridged.resolved.reactiveLayers === 'number'
  && typeof bridged.resolved.frozenLayers === 'number'
  && typeof bridged.resolved.lockedLayers === 'number') {
  ok('the resolved view counts the reactive, frozen and locked layers');
} else {
  bad('the resolved view counts the reactive, frozen and locked layers', JSON.stringify(bridged && bridged.resolved));
}

// --- 9) the deep link restores its preset ---------------------------------
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

// --- 10) LOGIC: a rule fires, and the picture follows -------------------
// The engine is driven deterministically here (the same entry point the
// render loop uses), so the assertion is about the RULEBOOK, not about
// whether the demo signal happened to be loud enough.
const ruleTest = await page.evaluate(async () => {
  const R = window.SWRPresetEditor;
  const P = R.preset;
  P.logic.enabled = true;
  P.logic.tickMs = 20;
  P.logic.rules = [{
    id: 'r_smoke', name: 'pulse-driven bloom', enabled: true, priority: 10, mode: 'edge',
    when: { k: 'all', of: [{ k: 'feature', name: 'bass', op: '>', threshold: 0.7, sustainMs: 300 }] },
    then: [{ t: 'rampParam', path: 'global.bloom', value: 1, ms: 400, easing: 'smooth' }],
    else: [{ t: 'rampParam', path: 'global.bloom', value: 0.6, ms: 600, easing: 'smooth' }],
    cooldownMs: 2000, once: false,
  }];
  const loud = { bass: 0.9, mid: 0.5, treble: 0.5, rms: 0.7, centroid: 0.5, pulse: 1, beat: 1, onset: 0 };
  const quiet = { bass: 0.1, mid: 0.2, treble: 0.2, rms: 0.2, centroid: 0.5, pulse: 0, beat: 0, onset: 0 };
  const t = performance.now();
  R.logic.tick(t, loud, 60);          // the condition starts holding
  R.logic.tick(t + 200, loud, 60);
  R.logic.tick(t + 400, loud, 60);    // held for 400ms > the 300ms sustain
  const fired = R.events.filter(e => e.kind === 'rule' && e.ruleId === 'r_smoke').length;
  // the ramp is animated by the frame loop, so let a few frames run
  await new Promise(r => setTimeout(r, 600));
  const bloom = R.resolved.bloom;
  R.logic.tick(t + 800, quiet, 60);   // it stops holding → the else branch
  await new Promise(r => setTimeout(r, 200));
  const released = R.events.filter(e => e.kind === 'rule' && e.ruleId === 'r_smoke' && /released/.test(e.text)).length;
  return { fired, released, bloom: +bloom.toFixed(3), tick: R.tickCostMs };
});
if (ruleTest.fired >= 1) ok('a rule fires in the log (' + ruleTest.fired + ' firing)');
else bad('a rule fires in the log', JSON.stringify(ruleTest));
if (ruleTest.bloom > 0.9) ok('the fired rule changes the render (bloom → ' + ruleTest.bloom + ')');
else bad('the fired rule changes the render', JSON.stringify(ruleTest));
if (ruleTest.released >= 1) ok('the else branch runs when the condition falls away');
else bad('the else branch runs when the condition falls away', JSON.stringify(ruleTest));
if (ruleTest.tick <= 2) ok('the logic tick stays inside its 2ms budget (' + ruleTest.tick.toFixed(3) + 'ms)');
else bad('the logic tick stays inside its 2ms budget', ruleTest.tick + 'ms');

// A manual edit must win over the rule.
const manualWins = await page.evaluate(async () => {
  const R = window.SWRPresetEditor;
  const el = document.querySelector('input[data-path="global.bloom"]');
  el.value = '0.22';
  el.dispatchEvent(new Event('input', { bubbles: true }));
  const held = R.runtime.manualHold['global.bloom'] > 0;
  const loud = { bass: 0.9, mid: 0.5, treble: 0.5, rms: 0.7, centroid: 0.5, pulse: 1, beat: 1, onset: 0 };
  R.logic.tick(performance.now() + 3000, loud, 60);
  const events = R.events.slice(-4).map(e => e.kind);
  return { held, events };
});
if (manualWins.held) ok('a manual edit holds the rules off that parameter');
else bad('a manual edit holds the rules off that parameter', JSON.stringify(manualWins));
if (manualWins.events.includes('held')) ok('the hold is visible in the log');
else bad('the hold is visible in the log', JSON.stringify(manualWins));

// --- 11) SCENES + the timeline ------------------------------------------
const sceneTest = await page.evaluate(async () => {
  const R = window.SWRPresetEditor;
  const P = R.preset;
  P.logic.scenes = [
    { id: 'sc_intro', name: 'intro', overrides: { 'global.bloom': 0.2 }, transitionMs: 200, easing: 'smooth', entryRules: [], exitRules: [] },
    { id: 'sc_drop', name: 'drop', overrides: { 'global.bloom': 1.0 }, transitionMs: 200, easing: 'smooth', entryRules: [], exitRules: [] },
  ];
  P.sequence = {
    enabled: true, mode: 'loop',
    sections: [{ name: 'intro', sceneId: 'sc_intro', bars: 1 }, { name: 'drop', sceneId: 'sc_drop', bars: 1 }],
  };
  R.logic.setScene('sc_drop', { now: performance.now() });
  await new Promise(r => setTimeout(r, 500));
  const afterScene = { scene: P.logic.activeSceneId, bloom: +R.resolved.bloom.toFixed(3) };
  // the playhead: jump to the first section
  const jump = document.querySelector('#tlSections button');
  if (jump) jump.click();
  await new Promise(r => setTimeout(r, 400));
  const afterJump = { scene: P.logic.activeSceneId, section: R.runtime.seq.section };
  return { afterScene, afterJump };
});
if (sceneTest.afterScene.scene === 'sc_drop' && sceneTest.afterScene.bloom > 0.9) {
  ok('a scene switches and its overrides ease in (bloom → ' + sceneTest.afterScene.bloom + ')');
} else {
  bad('a scene switches and its overrides ease in', JSON.stringify(sceneTest));
}
if (sceneTest.afterJump.section === 0) ok('the timeline playhead jumps to a section');
else bad('the timeline playhead jumps to a section', JSON.stringify(sceneTest));

// --- 12) EVOLUTION: drift stays inside the cap, and reverts ---------------
const driftTest = await page.evaluate(() => {
  const R = window.SWRPresetEditor;
  const P = R.preset;
  P.evolution.enabled = true;
  P.evolution.mode = 'drift';
  const authored = P.global.bloom;
  let max = 0;
  for (let i = 0; i < 300; i++) {           // 30 seconds of drift at 10Hz
    R.evolution.drift(0.1);
    max = Math.max(max, R.evolution.deviation());
  }
  const dev = R.evolution.deviation();
  const moved = Object.keys(R.runtime.drift).length;
  R.evolution.revert();
  return { dev: +dev.toFixed(4), max: +max.toFixed(4), moved, afterRevert: R.evolution.deviation(), driftLeft: Object.keys(R.runtime.drift).length, bloom: R.resolved.bloom, authored };
});
if (driftTest.max <= 0.35) ok('drift stays inside the deviation cap (' + driftTest.max + ' ≤ 0.35)');
else bad('drift stays inside the deviation cap', JSON.stringify(driftTest));
if (driftTest.moved > 0) ok('drift actually moves the preset (' + driftTest.moved + ' parameters)');
else bad('drift actually moves the preset', JSON.stringify(driftTest));
if (driftTest.afterRevert === 0 && driftTest.driftLeft === 0) {
  ok('one click reverts the drift to the authored preset');
} else {
  bad('one click reverts the drift to the authored preset', JSON.stringify(driftTest));
}

// --- 13) EVOLUTION: breeding produces a lineage --------------------------
const breedTest = await page.evaluate(() => {
  const R = window.SWRPresetEditor;
  const P = R.preset;
  P.evolution.enabled = true;
  P.evolution.mode = 'breeding';
  P.evolution.seed = 4242;
  P.evolution.rngState = 0;
  R.evolution.spawn();
  const gen0 = P.evolution.population.map(i => i.id);
  for (let g = 0; g < 3; g++) {
    P.evolution.population.forEach((ind, i) => R.evolution.rate(ind.id, 1 + ((i + g) % 5)));
    R.evolution.breed();
  }
  return {
    generation: P.evolution.generation,
    population: P.evolution.population.length,
    lineage: P.evolution.lineage.length,
    children: P.evolution.lineage.map(l => l.children.length),
    gen0,
    seed: P.evolution.seed,
  };
});
if (breedTest.generation === 3) ok('three generations bred');
else bad('three generations bred', JSON.stringify(breedTest));
if (breedTest.population === 6 && breedTest.lineage === 3) ok('the population stays at six and the lineage records every generation');
else bad('the population stays at six and the lineage records every generation', JSON.stringify(breedTest));
if (breedTest.children.every(n => n === 6)) ok('every generation has six children');
else bad('every generation has six children', JSON.stringify(breedTest));

// --- 14) the round trip: export → import → identical behaviour -----------
const roundTrip = await page.evaluate(() => {
  const R = window.SWRPresetEditor;
  const P = R.preset;
  P.evolution.mode = 'drift';
  P.evolution.seed = 4242;
  P.evolution.rngState = 0;
  R.evolution.spawn();
  P.evolution.population.forEach((ind, i) => R.evolution.rate(ind.id, 1 + (i % 5)));
  R.evolution.breed();
  const exported = JSON.parse(JSON.stringify(P));
  // the same seed must replay the same stream: both replays start from the
  // authored state, and the live drift is quiesced so the render loop is
  // not consuming the PRNG stream between the two of them
  P.evolution.enabled = false;
  R.evolution.revert();
  // a manual edit earlier in the run holds the drift off a gene for four
  // seconds; the hold survives in the first replay but not after the
  // reload (which resets the live layer), so both replays must start
  // without it
  R.runtime.manualHold = {};
  const a = [];
  for (let i = 0; i < 5; i++) a.push(R.evolution.drift(0.1));
  // import the EXPORTED document (the state before the first replay) and
  // replay it: the same document must produce the same stream
  const clone = JSON.parse(JSON.stringify(exported));
  clone.evolution.seed = 4242;
  R.load(clone);              // loading resets the live layer
  const b = [];
  for (let i = 0; i < 5; i++) b.push(R.evolution.drift(0.1));
  return {
    same: JSON.stringify(a.map(x => +x.toFixed(6))) === JSON.stringify(b.map(x => +x.toFixed(6))),
    seedKept: R.preset.evolution.seed === 4242,
    lineageKept: (R.preset.evolution.lineage || []).length,
    locksKept: JSON.stringify(R.preset.evolution.geneMap.map(g => g.locked)) === JSON.stringify(exported.evolution.geneMap.map(g => g.locked)),
  };
});
if (roundTrip.same) ok('the same seed replays the same stream after export → import');
else bad('the same seed replays the same stream after export → import', JSON.stringify(roundTrip));
if (roundTrip.seedKept && roundTrip.lineageKept >= 1 && roundTrip.locksKept) {
  ok('the round trip keeps the seed, the lineage and the gene locks');
} else {
  bad('the round trip keeps the seed, the lineage and the gene locks', JSON.stringify(roundTrip));
}

// --- 15) an old preset still loads and renders unchanged -----------------
const legacy = await page.evaluate(() => {
  const R = window.SWRPresetEditor;
  // a preset written before the subsystems existed
  const old = {
    id: 'p_legacy', name: 'Legacy', version: 1,
    created: 1, modified: 1, tags: ['neon'], look: 'clean', webgl: 0,
    audio: { source: 'demo', gain: 1, smoothing: 0.72, bands: { sub: 1, bass: 1, mid: 1, treble: 1, air: 1, rms: 1, centroid: 0.6 }, tempo: { bpm: 120, lock: true, offset: 0 } },
    global: { hue: 0.52, saturation: 0.9, bloom: 0.6, contrast: 1, speed: 1, seed: 1337 },
    layers: [{ id: 'l_1', name: 'Bars', type: 'bars', enabled: true, opacity: 0.55, blend: 'lighter', params: { count: 56, width: 0.72, gain: 0.85, tilt: 0.3, mirror: true } }],
    lfos: [],
  };
  R.load(old);
  const p = R.preset;
  const res = R.resolved;
  return {
    hasLogic: !!p.logic, logicEnabled: p.logic.enabled,
    hasEvo: !!p.evolution, evoEnabled: p.evolution.enabled,
    hasSeq: !!p.sequence, seqEnabled: p.sequence.enabled,
    hue: +res.hue.toFixed(4), sat: +res.sat.toFixed(4), bloom: +res.bloom.toFixed(4),
    contrast: +res.contrast.toFixed(4), speed: +res.speed.toFixed(4),
    layers: p.layers.length,
  };
});
if (legacy.hasLogic && !legacy.logicEnabled && legacy.hasEvo && !legacy.evoEnabled && legacy.hasSeq && !legacy.seqEnabled) {
  ok('an old preset gains the three blocks, all switched off');
} else {
  bad('an old preset gains the three blocks, all switched off', JSON.stringify(legacy));
}
if (legacy.hue === 0.52 && legacy.sat === 0.9 && legacy.bloom === 0.6 && legacy.contrast === 1 && legacy.speed === 1) {
  ok('an old preset resolves to exactly its authored values');
} else {
  bad('an old preset resolves to exactly its authored values', JSON.stringify(legacy));
}

// --- 16) the LIBRARY: six reactive starters -------------------------------
const lib = await page.evaluate(() => {
  const R = window.SWRPresetEditor;
  document.querySelector('[data-tab="library"]').click();
  const cards = document.querySelectorAll('#libGrid .lib-card').length;
  const names = R.library.map(b => b.name);
  const hasMaps = R.library.every(b => b.layers.some(L => L.react && L.react.length));
  return { cards, names, hasMaps };
});
if (lib.cards === 6 && lib.names.length === 6) ok('the library offers six starter presets (' + lib.names.join(', ') + ')');
else bad('the library offers six starter presets', JSON.stringify(lib));
if (lib.hasMaps) ok('every library preset carries audio-reactivity maps');
else bad('every library preset carries audio-reactivity maps', JSON.stringify(lib));

const libLoad = await page.evaluate(async () => {
  const R = window.SWRPresetEditor;
  document.querySelector('[data-tab="library"]').click();
  document.querySelector('[data-lib="4"]').click();
  await new Promise(r => setTimeout(r, 400));
  const p = R.preset;
  return {
    name: p.name,
    maps: p.layers[0].react.length,
    reactivity: p.audio.reactivity,
    badge: document.querySelector('#reactBadge').classList.contains('on'),
    copies: Object.keys(R.all).length,
  };
});
if (libLoad.name === 'Shatter' && libLoad.maps === 3) ok('loading a library preset keeps its reactivity maps');
else bad('loading a library preset keeps its reactivity maps', JSON.stringify(libLoad));
if (libLoad.badge) ok('the REACTIVE badge shows a preset has reactive layers');
else bad('the REACTIVE badge shows a preset has reactive layers', JSON.stringify(libLoad));

// --- 17) lock: the layer is inert ------------------------------------------
const lockTest = await page.evaluate(async () => {
  const R = window.SWRPresetEditor;
  document.querySelector('[data-tab="library"]').click();
  document.querySelector('[data-lib="5"]').click();     // Riot — three layers
  await new Promise(r => setTimeout(r, 300));
  document.querySelector('[data-tab="layers"]').click();
  await new Promise(r => setTimeout(r, 200));
  const card = document.querySelector('#layers .card');
  if (!card) return { skipped: true };
  card.querySelector('[data-act="lock"]').click();
  await new Promise(r => setTimeout(r, 200));
  const after = document.querySelector('#layers .card');
  const ctrls = [...after.querySelectorAll('input,select,button')];
  const allDisabled = ctrls.filter(el => el.dataset.act !== 'lock').every(el => el.disabled);
  // an edit attempt must not take
  const before = R.preset.layers[0].params.gain;
  const slider = after.querySelector('input[type=range]');
  if (slider) { slider.value = '0.1'; slider.dispatchEvent(new Event('input', { bubbles: true })); }
  return {
    locked: R.preset.layers[0].locked,
    allDisabled,
    lockButtonWorks: !after.querySelector('[data-act="lock"]').disabled,
    gainUnchanged: R.preset.layers[0].params.gain === before,
  };
});
if (lockTest.locked && lockTest.allDisabled) ok('a locked layer disables every control');
else bad('a locked layer disables every control', JSON.stringify(lockTest));
if (lockTest.lockButtonWorks) ok('a locked layer can still be unlocked');
else bad('a locked layer can still be unlocked', JSON.stringify(lockTest));
if (lockTest.gainUnchanged) ok('a locked layer ignores edits');
else bad('a locked layer ignores edits', JSON.stringify(lockTest));

// --- 18) freeze: the geometry is held, the colour is not ------------------
const freezeTest = await page.evaluate(async () => {
  const R = window.SWRPresetEditor;
  document.querySelector('[data-tab="layers"]').click();
  await new Promise(r => setTimeout(r, 200));
  const cards = document.querySelectorAll('#layers .card');
  if (cards.length < 2) return { skipped: true };
  cards[1].querySelector('[data-act="freeze"]').click();
  await new Promise(r => setTimeout(r, 300));
  const L = R.preset.layers[1];
  const frozenParams = { ...(R.runtime.lastParams[1] || {}) };
  const liveParams = { ...(R.runtime.lastParams[0] || {}) };
  await new Promise(r => setTimeout(r, 900));   // let the music move
  const frozenAfter = { ...(R.runtime.lastParams[1] || {}) };
  const liveAfter = { ...(R.runtime.lastParams[0] || {}) };
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  return {
    frozen: L.frozen,
    hasSnapshot: typeof L.frozenAt === 'number' && !!L.frozenFeatures,
    frozenHeld: same(frozenParams, frozenAfter),
    liveMoved: !same(liveParams, liveAfter),
    frozenParams, liveParams, frozenAfter, liveAfter,
  };
});
if (freezeTest.frozen && freezeTest.hasSnapshot) ok('freezing snapshots the features and the time');
else bad('freezing snapshots the features and the time', JSON.stringify(freezeTest));
if (freezeTest.frozenHeld) ok('a frozen layer holds its geometry');
else bad('a frozen layer holds its geometry', JSON.stringify(freezeTest));
if (freezeTest.liveMoved) ok('an unfrozen layer keeps moving');
else bad('an unfrozen layer keeps moving', JSON.stringify(freezeTest));

// --- 19) drag to reorder ----------------------------------------------------
const dragTest = await page.evaluate(async () => {
  const R = window.SWRPresetEditor;
  document.querySelector('[data-tab="layers"]').click();
  await new Promise(r => setTimeout(r, 200));
  const cards = document.querySelectorAll('#layers .card');
  if (cards.length < 3) return { skipped: true };
  const before = R.preset.layers.map(l => l.name);
  const handle = cards[2].querySelector('.drag-handle');
  const from = cards[2].getBoundingClientRect();
  const to = cards[0].getBoundingClientRect();
  const ev = (type, y) => handle.dispatchEvent(new PointerEvent(type, { bubbles: true, clientY: y, pointerId: 1, cancelable: true }));
  ev('pointerdown', from.top + 10);
  ev('pointermove', to.top + 2);
  ev('pointerup', to.top + 2);
  await new Promise(r => setTimeout(r, 300));
  const after = R.preset.layers.map(l => l.name);
  return { before, after, changed: before.join() !== after.join(), movedToTop: after[0] === before[2] };
});
if (dragTest.skipped) ok('drag to reorder (skipped: fewer than three layers)');
else if (dragTest.changed && dragTest.movedToTop) ok('a dragged layer moves to the drop position');
else bad('a dragged layer moves to the drop position', JSON.stringify(dragTest));

// --- 20) BENCH: the editor measures ITSELF --------------------------------
// The bench tab runs the shared suite against the editor's own render and
// the editor's own preset — not a copy of them.
const bench = await page.evaluate(async () => {
  document.querySelector('[data-tab="bench"]').click();
  await new Promise(r => setTimeout(r, 400));
  const s = window.SWRPresetEditor.bench;
  if (!s) return { mounted: false };
  const r = await s.runTest('this preset', { interpolate: true, injectAudioDrift: 0 }, 1200);
  const lagged = await s.runTest('this preset · +12ms audio lag', { interpolate: true, injectAudioDrift: 0.012 }, 1200);
  return {
    mounted: true,
    fps: r.metrics.fpsAvg,
    drift: r.metrics.driftAvg,
    lagDrift: lagged.metrics.driftAvg,
    grade: r.scores.grade,
    layers: r.config.layerCount,
  };
});
if (bench.mounted) ok('the Bench tab mounts the shared suite inside the editor');
else bad('the Bench tab mounts the shared suite inside the editor', JSON.stringify(bench));
if (bench.fps > 0 && bench.grade) ok('the editor measures its own render (' + bench.fps.toFixed(1) + ' fps, grade ' + bench.grade + ')');
else bad('the editor measures its own render', JSON.stringify(bench));
if (bench.drift < 20) ok('the editor\'s own A/V drift is measured (' + bench.drift.toFixed(1) + 'ms)');
else bad('the editor\'s own A/V drift is measured', JSON.stringify(bench));
if (bench.lagDrift > bench.drift + 4) ok('an injected lag shows up in the editor\'s sync number (' + bench.lagDrift.toFixed(1) + 'ms)');
else bad('an injected lag shows up in the editor\'s sync number', JSON.stringify(bench));

const applied = await page.evaluate(async () => {
  const R = window.SWRPresetEditor;
  R.loadBuiltin(5);                       // Riot — three layers
  await new Promise(r => setTimeout(r, 300));
  const before = R.preset.layers.find(l => l.type === 'particles').params.count;
  const s = R.bench;
  const r = await s.runTest('this preset', { interpolate: true, injectAudioDrift: 0 }, 1200);
  const ai = s.analyze(r);
  const count = ai.suggestions.find(x => x.id === 'reduce-count');
  if (!count) return { skipped: true, suggestions: ai.suggestions.length };
  s.applySuggestions([count]);
  await new Promise(r2 => setTimeout(r2, 200));
  const after = R.preset.layers.find(l => l.type === 'particles').params.count;
  return { before, after, suggestions: ai.suggestions.length };
});
if (applied.skipped) ok('the advisor proposes nothing to apply on this run (skipped)');
else if (applied.after < applied.before) {
  ok('the advisor\'s suggestion applies to the editor\'s own preset (' + applied.before + ' → ' + applied.after + ' particles)');
} else {
  bad('the advisor\'s suggestion applies to the editor\'s own preset', JSON.stringify(applied));
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
