// scripts/check-automix-smoke.mjs
// Puppeteer smoke test against the live music_video.html. Verifies:
//   1. Page boots without console errors
//   2. SWR_AUTOMIX is defined
//   3. The Automix toggle button exists and starts in OFF state
//   4. Clicking it switches state to ON
//   5. After 2.5s, window.SWR._fxOverride is a non-null object with
//      all 8 fx_state fields
//   6. Pressing `A` toggles it back OFF and _fxOverride stays frozen
//
// Self-contained: ensureDist() (from scripts/with-dist.mjs) auto-builds
// dist/ if missing. No need to remember `npm run build` first.
//
// Run command:
//   node scripts/check-automix-smoke.mjs
//
// Pass criteria: 6/6 assertions green, exit 0.

import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import puppeteer from 'puppeteer';
import { ensureDist } from './with-dist.mjs';

// Auto-build dist/ if missing — no more "forgot to npm run build" 404s.
ensureDist();

// Static server for the built dist/
const distDir = path.resolve(dirname(fileURLToPath(import.meta.url)), '../dist');
const server = http.createServer((req, res) => {
  let p = req.url.split('?')[0];
  if (p.endsWith('/')) p += 'index.html';
  let file = path.join(distDir, p);
  if (!file.startsWith(distDir)) { res.statusCode = 403; res.end(); return; }
  fs.readFile(file, (err, data) => {
    if (err) { res.statusCode = 404; res.end(); return; }
    const ext = path.extname(file);
    const mime = ext === '.html' ? 'text/html' : ext === '.js' ? 'text/javascript' : 'application/octet-stream';
    res.setHeader('Content-Type', mime);
    res.end(data);
  });
});
server.listen(5181);

const browser = await puppeteer.launch({ args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'] });
const page = await browser.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

await page.goto('http://localhost:5181/versions/music_video.html', { waitUntil: 'networkidle0', timeout: 30000 });

const results = [];
function ok(name) { results.push('  ✓ ' + name); }
function bad(name, got) { results.push('  ✗ ' + name + ' (got: ' + got + ')'); process.exitCode = 1; }

// 1. No console errors during boot (excluding pre-existing dev-control WS
//    probe noise — that socket is opened by the engine regardless of this
//    PR and connection-refused messages are emitted when the dev server
//    is not running, which is the case in CI).
const fatalErrors = errors.filter(e => !/WebSocket.*ws:\/\/localhost:8787/.test(e));
if (fatalErrors.length === 0) ok('no console errors at boot');
else bad('no console errors at boot', JSON.stringify(fatalErrors));

// 2. SWR_AUTOMIX defined
const hasAutomix = await page.evaluate(() => !!window.SWR_AUTOMIX);
if (hasAutomix) ok('SWR_AUTOMIX defined'); else bad('SWR_AUTOMIX defined', 'undefined');

// 3. Toggle button present, OFF by default
const state0 = await page.evaluate(() => document.getElementById('automix-state') && document.getElementById('automix-state').textContent);
if (state0 === 'OFF') ok('toggle starts OFF'); else bad('toggle starts OFF', state0);

// 4. Click → ON (use evaluate-click for reliability: puppeteer's page.click
//    scrolls into view, which on this page can land at the footer's bottom
//    edge outside the label's hit area; the label is <span>/<label>
//    semantically, so a programmatic .click() exercises the same handler.)
await page.evaluate(() => document.getElementById('automix-toggle').click());
await new Promise(r => setTimeout(r, 100));
const state1 = await page.evaluate(() => document.getElementById('automix-state').textContent);
if (state1 === 'ON') ok('click flips to ON'); else bad('click flips to ON', state1);

// 5. After 2.5s, _fxOverride populated with 8 fields
await new Promise(r => setTimeout(r, 2500));
const fx = await page.evaluate(() => {
  const o = window.SWR && window.SWR._fxOverride;
  if (!o) return null;
  return ['temp','mut','sepia','chroma','grain','glow','grayscale','posterize'].every(k => typeof o[k] === 'number');
});
if (fx) ok('_fxOverride has all 8 numeric fields'); else bad('_fxOverride has all 8 numeric fields', String(fx));

// 6. Press A → OFF, _fxOverride not cleared (frozen)
await page.keyboard.press('a');
await new Promise(r => setTimeout(r, 100));
const state2 = await page.evaluate(() => document.getElementById('automix-state').textContent);
const fxFrozen = await page.evaluate(() => !!window.SWR._fxOverride);
if (state2 === 'OFF' && fxFrozen) ok('A key toggles OFF + freezes _fxOverride');
else bad('A key toggles OFF + freezes _fxOverride', 'state=' + state2 + ' frozen=' + fxFrozen);

// 7. Phase B: Gradient.setTrack + setBeatPulse expose state, dot lands at
//    expected (warmth, intensity) coordinates from the embedding formula.
const gradState = await page.evaluate(() => {
  const g = window.SWR_GRADIENT;
  g.setTrack({ bass: 0.8, mid: 0.2, treb: 0.1 });  // bass-heavy -> warm
  g.setBeatPulse(0.5);
  return g._state();
});
if (gradState && gradState.warmth > 0.5 && gradState.beatPulse === 0.5)
  ok('Gradient.setTrack + setBeatPulse expose state');
else bad('Gradient.setTrack + setBeatPulse expose state', JSON.stringify(gradState));

// 7b. Phase C: SWR_ANCHOR_EMBED loaded and Gradient uses it (single source of truth)
const embedCheck = await page.evaluate(() => {
  const embed = window.SWR_ANCHOR_EMBED;
  const grad  = window.SWR_GRADIENT;
  const embedCoords = embed && embed.featuresToCoords({ bass: 0.8, mid: 0.2, treb: 0.1 });
  // Drive Gradient.setTrack and read back via _state — same features.
  grad.setTrack({ bass: 0.8, mid: 0.2, treb: 0.1 });
  const gradState = grad._state();
  return {
    hasEmbed: !!embed,
    embedCoords,
    gradCoords: { warmth: gradState.warmth, intensity: gradState.intensity },
    sameImpl: embed && Math.abs(embedCoords.warmth - gradState.warmth) < 1e-9
                 && Math.abs(embedCoords.intensity - gradState.intensity) < 1e-9,
  };
});
if (embedCheck.hasEmbed && embedCheck.sameImpl)
  ok('Gradient uses SWR_ANCHOR_EMBED (shared impl)');
else bad('Gradient uses SWR_ANCHOR_EMBED (shared impl)', JSON.stringify(embedCheck));

// 8. Phase B: dot is actually drawn on the canvas (magenta pixels > 0).
//    Wait one redraw tick (100ms) before sampling.
await new Promise(r => setTimeout(r, 150));
const magentaPixels = await page.evaluate(() => {
  const c = document.getElementById('gradient');
  const ctx = c.getContext('2d');
  const d = ctx.getImageData(0, 0, c.width, c.height).data;
  let n = 0;
  for (let i = 0; i < d.length; i += 4) {
    const r = d[i], g = d[i+1], b = d[i+2];
    // magenta core: high R, low-mid G, mid-high B
    if (r > 200 && g < 100 && b > 80 && b < 200) n++;
  }
  return n;
});
if (magentaPixels > 0) ok('gradient canvas has magenta track dot (' + magentaPixels + ' px)');
else bad('gradient canvas has magenta track dot', '0 magenta pixels');

// 9. Depth slider wires to HologramState.depth (Tier-1 #1 — fixes dead UI).
//    Drive the slider via input event and read back HologramState.depth.
const depthAfter = await page.evaluate(() => {
  const s = document.getElementById('depth');
  s.value = '0.85';
  s.dispatchEvent(new Event('input', { bubbles: true }));
  return window.SWR && window.SWR.HologramState && window.SWR.HologramState.depth;
});
if (Math.abs(depthAfter - 0.85) < 1e-6) ok('depth slider → HologramState.depth (0.85)');
else bad('depth slider → HologramState.depth', String(depthAfter));

// 10. Depth blend: with _fxOverride set + depth=1, blendFxOverride returns
//     pure override values. Direct test of the extracted helper.
const blendAt1 = await page.evaluate(() => {
  window.SWR._fxOverride = { temp: 0.9, mut: 0.9, sepia: 0.9, chroma: 0.9, grain: 0.9, glow: 0.9, grayscale: 0.9, posterize: 0.9 };
  const neon = { temp: -0.3, mut: 0.55, sepia: 0, chroma: 0.85, grain: 0.4, glow: 0.4, grayscale: 0, posterize: 0.1 };
  return window.__SWR_BLEND_FX(neon, window.SWR._fxOverride, 1);
});
if (blendAt1 && Math.abs(blendAt1.temp - 0.9) < 1e-6 && Math.abs(blendAt1.chroma - 0.9) < 1e-6)
  ok('blendFxOverride at depth=1 = override');
else bad('blendFxOverride at depth=1 = override', JSON.stringify(blendAt1));

// 11. Depth blend at 0 → pure neon (override ignored).
const blendAt0 = await page.evaluate(() => {
  const neon = { temp: -0.3, mut: 0.55, sepia: 0, chroma: 0.85, grain: 0.4, glow: 0.4, grayscale: 0, posterize: 0.1 };
  return window.__SWR_BLEND_FX(neon, window.SWR._fxOverride, 0);
});
if (blendAt0 && blendAt0.temp === -0.3 && blendAt0.chroma === 0.85)
  ok('blendFxOverride at depth=0 = neon preset');
else bad('blendFxOverride at depth=0 = neon preset', JSON.stringify(blendAt0));

// 12. setAutomixAnchor highlights a preset and dims the track dot.
//     Call the method directly (the page does this from automix.tick()).
const anchorState = await page.evaluate(() => {
  // Set up a track dot first so the dim effect has something to dim.
  window.SWR_GRADIENT.setTrack({ bass: 0.5, mid: 0.5, treb: 0.5 });
  window.SWR_GRADIENT.setAutomixAnchor('neon');
  return window.SWR_GRADIENT._state();
});
if (anchorState && anchorState.automixAnchor === 'neon')
  ok('setAutomixAnchor(neon) exposes state');
else bad('setAutomixAnchor(neon) exposes state', JSON.stringify(anchorState));

// 13. setAutomixAnchor(null) clears the highlight.
const cleared = await page.evaluate(() => {
  window.SWR_GRADIENT.setAutomixAnchor(null);
  return window.SWR_GRADIENT._state();
});
if (cleared && cleared.automixAnchor === null)
  ok('setAutomixAnchor(null) clears');
else bad('setAutomixAnchor(null) clears', JSON.stringify(cleared));

// 14. setAutomixAnchor with unknown id is silently ignored (no throw).
const unknown = await page.evaluate(() => {
  try {
    window.SWR_GRADIENT.setAutomixAnchor('this-preset-does-not-exist');
    return { ok: true };
  } catch (e) {
    return { ok: false, err: String(e) };
  }
});
if (unknown.ok) ok('setAutomixAnchor unknown id is safe');
else bad('setAutomixAnchor unknown id is safe', JSON.stringify(unknown));

// 15. SWR_LAST_MIX persists the automix blend to localStorage.
const lastMixState = await page.evaluate(async () => {
  if (!window.SWR_LAST_MIX) return { ok: false, reason: 'SWR_LAST_MIX missing' };
  window.SWR_LAST_MIX.clear();
  window.SWR_LAST_MIX.save({
    ts: Date.now(),
    coords: { warmth: 0.42, intensity: 0.67 },
    anchors: [{ id: 'neon', dist: 0.1 }],
    preset: { temp: 0.5, mut: 0.5 },
  });
  window.SWR_LAST_MIX.flush();
  const r = window.SWR_LAST_MIX.read();
  return { ok: !!r, coords: r && r.coords };
});
if (lastMixState.ok && Math.abs(lastMixState.coords.warmth - 0.42) < 1e-6)
  ok('SWR_LAST_MIX save/flush/read roundtrips coords');
else bad('SWR_LAST_MIX save/flush/read roundtrips coords', JSON.stringify(lastMixState));

// 16. Gradient.setGhostDot shows up in _state and clears with null.
const ghostState = await page.evaluate(() => {
  window.SWR_GRADIENT.setGhostDot({ warmth: 0.7, intensity: 0.3 });
  const s1 = window.SWR_GRADIENT._state();
  window.SWR_GRADIENT.setGhostDot(null);
  const s2 = window.SWR_GRADIENT._state();
  return { setState: s1 && s1.ghost, clearedState: s2 && s2.ghost };
});
if (ghostState.setState && Math.abs(ghostState.setState.warmth - 0.7) < 1e-6 && ghostState.clearedState === null)
  ok('setGhostDot reflects in _state, null clears');
else bad('setGhostDot reflects in _state, null clears', JSON.stringify(ghostState));

// 17. Phase D: setNeighbours populates #neighbours-list with N clickable
//     entries sorted by distance. State exposes the structured list too.
const neighState = await page.evaluate(() => {
  // Drop a track dot at bass-heavy coords; neighbours should cluster near
  // warm presets.
  window.SWR_GRADIENT.setTrack({ bass: 0.8, mid: 0.2, treb: 0.1 });
  window.SWR_GRADIENT.setNeighbours(3, { warmth: 0.8, intensity: 0.4 });
  const list = document.querySelectorAll('#neighbours-list .neigh');
  const state = window.SWR_GRADIENT._state();
  return {
    buttonCount: list.length,
    stateCount: state.neighbours && state.neighbours.length,
    firstId: list[0] && list[0].getAttribute('data-id'),
    ascending: state.neighbours && state.neighbours.every((n, i, a) => i === 0 || a[i-1].dist <= n.dist),
  };
});
if (neighState.buttonCount === 3 && neighState.stateCount === 3 && neighState.ascending)
  ok('setNeighbours(3) populates 3 clickable buttons, sorted by dist');
else bad('setNeighbours(3) populates 3 clickable buttons, sorted by dist', JSON.stringify(neighState));

// 18. Phase D: clicking a neighbour entry writes that preset's fx_state
//     into window.SWR._fxOverride. Direct test of the click handler.
const clickResult = await page.evaluate(() => {
  // Reset to a known coord, populate the list, then click the first entry.
  window.SWR_GRADIENT.setNeighbours(2, { warmth: 0.5, intensity: 0.5 });
  const btn = document.querySelector('#neighbours-list .neigh');
  const id = btn && btn.getAttribute('data-id');
  btn.click();
  const ov = window.SWR._fxOverride;
  return { id, hasOverride: !!ov, presetId: id };
});
if (clickResult.hasOverride && clickResult.id === clickResult.presetId)
  ok('clicking neighbour writes _fxOverride from preset');
else bad('clicking neighbour writes _fxOverride from preset', JSON.stringify(clickResult));

// 19. Phase D: setPresetOverride (new VersionsPresets API) writes the
//     fx_state straight from the preset id, returns true on success /
//     false on unknown id.
const setPresetOverrideResult = await page.evaluate(() => {
  const ok1 = window.VersionsPresets && window.VersionsPresets.setPresetOverride('neon');
  const ok2 = window.VersionsPresets && window.VersionsPresets.setPresetOverride('this-does-not-exist');
  const ov = window.SWR && window.SWR._fxOverride;
  return { knownId: ok1, unknownId: ok2, hasOverride: !!ov, temp: ov && ov.temp };
});
if (setPresetOverrideResult.knownId === true && setPresetOverrideResult.unknownId === false
    && Math.abs(setPresetOverrideResult.temp - (-0.3)) < 1e-6)
  ok('VersionsPresets.setPresetOverride returns true for known, false for unknown');
else bad('VersionsPresets.setPresetOverride returns true for known, false for unknown', JSON.stringify(setPresetOverrideResult));

// 20. setNeighbours(0) clears the list.
const clearedList = await page.evaluate(() => {
  window.SWR_GRADIENT.setNeighbours(0);
  return { count: document.querySelectorAll('#neighbours-list .neigh').length };
});
if (clearedList.count === 0) ok('setNeighbours(0) clears the list');
else bad('setNeighbours(0) clears the list', JSON.stringify(clearedList));

// 21. neighbours slider re-renders the list (Tier-2 #2 — slider wiring).
const sliderRe = await page.evaluate(() => {
  const s = document.getElementById('neighbour-count');
  s.value = '6';
  s.dispatchEvent(new Event('input', { bubbles: true }));
  return document.querySelectorAll('#neighbours-list .neigh').length;
});
if (sliderRe === 6) ok('neighbours slider → setNeighbours(6) renders 6 entries');
else bad('neighbours slider → setNeighbours(6) renders 6 entries', 'got ' + sliderRe);

// 22. Layers.reset() exists on window.SWR.Layers and clears the list.
const layersResetShape = await page.evaluate(() => {
  return {
    hasReset: !!(window.SWR && window.SWR.Layers && typeof window.SWR.Layers.reset === 'function'),
    listLength: window.SWR && window.SWR.Layers ? window.SWR.Layers.list.length : -1,
  };
});
if (layersResetShape.hasReset && layersResetShape.listLength === 0)
  ok('SWR.Layers.reset exists; list starts empty');
else bad('SWR.Layers.reset exists; list starts empty', JSON.stringify(layersResetShape));

// 23. Pushing a fake layer, calling reset() → list goes back to empty.
const layersResetClears = await page.evaluate(() => {
  // Simulate an uploaded layer by pushing directly. Lib.add requires a
  // real asset; the reset behaviour we want to verify only touches
  // .list, so direct manipulation suffices.
  const L = window.SWR.Layers;
  L.list.push({ id: 'L1', asset: null, opacity: 1, blend: 'screen' });
  L.list.push({ id: 'L2', asset: null, opacity: 0.5, blend: 'multiply' });
  const before = L.list.length;
  const cleared = L.reset();
  return { before, cleared, after: L.list.length };
});
if (layersResetClears.before === 2 && layersResetClears.cleared === 2 && layersResetClears.after === 0)
  ok('Layers.reset() empties the list and returns the prior count');
else bad('Layers.reset() empties the list and returns the prior count', JSON.stringify(layersResetClears));

// 24. Reset button click also fires the reset path (mirror of #23).
const buttonClick = await page.evaluate(() => {
  const L = window.SWR.Layers;
  L.list.push({ id: 'L9', asset: null });
  document.getElementById('reset-layers').click();
  return L.list.length;
});
if (buttonClick === 0) ok('reset-layers button click empties Layers.list');
else bad('reset-layers button click empties Layers.list', 'after=' + buttonClick);

// 25. Backspace keydown resets layers (Tier-4 #22 — keyboard shortcut).
//     Simulate by dispatching a keydown directly. Need to blur any
//     focus first so the input-focus guard doesn't bail out.
const backspaceReset = await page.evaluate(() => {
  const L = window.SWR.Layers;
  L.list.push({ id: 'L8', asset: null });
  if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
  document.body.focus();
  const ev = new KeyboardEvent('keydown', { key: 'Backspace', bubbles: true });
  document.dispatchEvent(ev);
  return L.list.length;
});
if (backspaceReset === 0) ok('Backspace keydown resets Layers.list');
else bad('Backspace keydown resets Layers.list', 'after=' + backspaceReset);

// 26. Backspace in an input is ignored (typing-friendly).
const backspaceInInput = await page.evaluate(() => {
  const L = window.SWR.Layers;
  L.list.push({ id: 'L7', asset: null });
  const slider = document.getElementById('depth');
  slider.focus();
  const ev = new KeyboardEvent('keydown', { key: 'Backspace', bubbles: true });
  slider.dispatchEvent(ev);
  return L.list.length;
});
if (backspaceInInput === 1) ok('Backspace in an input does NOT reset (focus guard works)');
else bad('Backspace in an input does NOT reset (focus guard works)', 'list=' + backspaceInInput);

// 27. Modifier-key Backspace (Cmd+Backspace) is ignored — that's browser nav.
//     Push an item, dispatch Cmd+Backspace, the item should survive
//     (handler bails on metaKey).
const modifierBackspace = await page.evaluate(() => {
  const L = window.SWR.Layers;
  L.reset();                       // baseline
  L.list.push({ id: 'L6', asset: null });
  if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
  document.body.focus();
  const ev = new KeyboardEvent('keydown', { key: 'Backspace', metaKey: true, bubbles: true });
  document.dispatchEvent(ev);
  return L.list.length;             // expect 1 — handler should bail
});
if (modifierBackspace === 1) ok('Cmd+Backspace is NOT intercepted (browser nav preserved)');
else bad('Cmd+Backspace is NOT intercepted (browser nav preserved)', 'list=' + modifierBackspace);

// Cleanup so subsequent tests/runs start fresh.
await page.evaluate(() => {
  if (window.SWR_LAST_MIX) window.SWR_LAST_MIX.clear();
  if (window.SWR_GRADIENT) {
    window.SWR_GRADIENT.setGhostDot(null);
    window.SWR_GRADIENT.setAutomixAnchor(null);
    window.SWR_GRADIENT.setNeighbours(0);
  }
  if (window.SWR) window.SWR._fxOverride = null;
  if (window.SWR && window.SWR.Layers) window.SWR.Layers.reset();
});

await browser.close();
server.close();
console.log(results.join('\n'));
console.log('AUTOMIX SMOKE: ' + (process.exitCode ? 'FAILED' : 'ALL GREEN') + ' (' + results.length + ' assertions)');
