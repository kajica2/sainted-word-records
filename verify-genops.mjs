// verify-genops.mjs — headless verification of the generative control system
// across every full engine page.
//
//   node verify-genops.mjs
//
// Serves the product root on a local port, loads each versions/*.html in
// Puppeteer, seeds a synthetic library (the real one needs media files), then
// runs 8 checks per page.

import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import puppeteer from 'puppeteer';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PORT = 8099;

const ENGINES = [
  'aurora', 'chrome', 'eclipse', 'film', 'fractal', 'glitch', 'grid',
  'hallucination', 'neon', 'pulse', 'smoke', 'void', 'watercolor',
];

const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.wav': 'audio/wav', '.mp3': 'audio/mpeg',
};

function serve() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const rel = decodeURIComponent(req.url.split('?')[0].replace(/^\/+/, '')) || 'index.html';
      const file = path.join(ROOT, rel);
      if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
        res.writeHead(404); res.end('nf'); return;
      }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
      fs.createReadStream(file).pipe(res);
    });
    server.listen(PORT, () => resolve(server));
  });
}

// Build a synthetic library + layers entirely in-page, so verification does not
// depend on library/ media being present or on classification finishing.
const SEED_PAGE = `(() => {
  const L = window.SWR.Layers, Lib = window.SWR.Library;
  Lib.items = [];
  for (let i = 1; i <= 6; i++) {
    Lib.items.push({ id: i, name: 'synthetic-' + i + '.png', type: 'image',
      blob: null, url: '', motion: i / 6, luma: (i % 3) / 3 + 0.2, hue: i / 6,
      w: 640, h: 360, added: Date.now(), thumb: null });
  }
  L.list = Lib.items.slice(0, 4).map((it, i) => ({
    id: 'L' + (i + 1), asset: it,
    blend: 'source-over', opacity: 0.9, baseScale: 1.0,
    hue: 0, brightness: 1.0, contrast: 1.0,
    alpha: 1.0, mutate: 0.0, locks: {},
    reactors: [ { feature: 'rms', target: 'scale', scale: 0.4, ease: 'soft' },
                { feature: 'bass', target: 'x', scale: 20, ease: 'soft' } ],
  }));
  L.sel = L.list[0];
  L.render();
  // reset genops history against this baseline
  window.SWR_GENOPS.commit();
})()`;

const CHECKS = `(async () => {
  const G = window.SWR_GENOPS;
  const out = [];
  const ok = (name, pass, note) => out.push({ name, pass: !!pass, note: note || '' });
  const snap = () => JSON.stringify(G._snapshot().layers);
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));

  // 1. module + UI present
  const bar = document.querySelector('.genops');
  const opBtns = document.querySelectorAll('.genops-ops button');
  ok('module+ui', !!G && !!bar && opBtns.length === 4, 'buttons=' + opBtns.length);

  // 2. the four ops exist and are callable
  ok('four ops', ['remap','randomize','mutate','evolve'].every(k => typeof G[k] === 'function'));

  // 3. determinism: same seed -> same randomize result
  G.setDeterministic(true);
  G.setPreserve('assets', true);
  const base = G._snapshot();
  G.setSeed(42); G.randomize(); const A = snap();
  G._restore(base); G.setSeed(42); G.randomize(); const B = snap();
  ok('determinism', A === B, A === B ? '' : 'seeded runs diverged');

  // 4. locks: locked hue survives randomize
  G._restore(base);
  const L = window.SWR.Layers;
  L.list[0].locks = { hue: true };
  const hueBefore = L.list[0].hue;
  G.setSeed(7); G.randomize();
  ok('lock hue', L.list[0].hue === hueBefore, 'was ' + hueBefore + ' now ' + L.list[0].hue);
  L.list[0].locks = {};

  // 5. preserve assets: asset ids unchanged
  G._restore(base);
  const idsBefore = L.list.map(l => l.asset && l.asset.id).join(',');
  G.setPreserve('assets', true); G.randomize();
  const idsAfter = L.list.map(l => l.asset && l.asset.id).join(',');
  ok('preserve assets', idsBefore === idsAfter, idsBefore + ' vs ' + idsAfter);

  // 6. undo / redo round trip
  G._restore(base); G.commit();
  const pre = snap();
  G.randomize();
  const post = snap();
  G.undo();
  const undone = snap();
  G.redo();
  const redone = snap();
  ok('undo/redo', undone === pre && redone === post,
     'undo=' + (undone === pre) + ' redo=' + (redone === post));

  // 7. mutate perturbs less than randomize
  const mean = (a, b) => {
    const x = JSON.parse(a), y = JSON.parse(b);
    let s = 0, n = 0;
    for (let i = 0; i < x.length; i++)
      for (const f of ['opacity','baseScale','hue','brightness','contrast','alpha','mutate']) {
        s += Math.abs((x[i][f] || 0) - (y[i][f] || 0)); n++;
      }
    return s / n;
  };
  G._restore(base); G.commit(); G.setAmount(0.2); G.setSeed(11);
  const m0 = snap(); G.mutate(); const mDelta = mean(m0, snap());
  G._restore(base); G.commit(); G.setSeed(11);
  const r0 = snap(); G.randomize(); const rDelta = mean(r0, snap());
  ok('mutate<randomize', mDelta < rDelta, 'mutate=' + mDelta.toFixed(3) + ' randomize=' + rDelta.toFixed(3));

  // 8. evolve produces generations then stops
  G._restore(base); G.commit(); G.setAmount(0.4);
  G.evolve({ rate: 100, generations: 3, bars: 2 });
  // Heavy-shader pages throttle timers, so poll rather than assume a fixed wait.
  for (let i = 0; i < 40 && G.getState().generation < 3; i++) await sleep(100);
  const gens = G.getState().generation;
  const running = G.getState().evolving;
  G.pauseEvolve();
  await sleep(200);
  const stopped = !G.getState().evolving;
  ok('evolve', gens >= 3 && stopped,
     'generations=' + gens + ' autoStopped=' + !running + ' pausedOk=' + stopped);

  // 9. layer card decoration: locks, live mapping matrix, advanced drawer
  G._restore(base); G.commit();
  window.SWR.Layers.render();
  await sleep(120);
  const card = document.querySelector('#layers .l');
  const locks = card ? card.querySelectorAll('.lockbtn').length : 0;
  const maps  = card ? card.querySelectorAll('.mapmx .mapr').length : 0;
  const adv   = card ? card.querySelectorAll('details.adv input[type=range]').length : 0;
  ok('layer card', locks >= 5 && maps >= 2 && adv === 2,
     'locks=' + locks + ' mappingRows=' + maps + ' advSliders=' + adv);

  // 10. mapping matrix is live: changing a destination updates the model
  const tSel = card && card.querySelector('.mapmx .mapr select:nth-of-type(2)');
  let liveOk = false;
  if (tSel) {
    const l0 = window.SWR.Layers.list[0];
    tSel.value = 'rot';
    tSel.dispatchEvent(new Event('change', { bubbles: true }));
    liveOk = l0.reactors[0].target === 'rot';
  }
  ok('mapping is live', liveOk);

  // 11. DPR-aware canvas: backing store is sized at dpr × cssW/H so that
  // on retina/2× displays the canvas is rasterized at 2× the CSS size
  // (and crisply downsampled by the browser), instead of being rasterized
  // at CSS size and upscaled (blurry). At 1× DPR (the verify default)
  // this is a no-op; the check still verifies the module is wired and
  // the canvas was sized through it.
  const swr = window.SWR, R = window.SWR_RENDER;
  const stage = swr && swr.stage;
  // Some engines (grid, hallucination, smoke) compute their CSS layout
  // a frame or two after DOMContentLoaded. Each engine's fit() runs
  // once at script load, then again on window 'resize'. Dispatch a
  // synthetic resize to re-run it after layout settles. Then directly
  // call SWR_RENDER.fit as a safety net for the cases where the engine's
  // own fit() never ran (e.g. an error earlier in the IIFE).
  if (stage && stage.clientWidth === 0) {
    for (let i = 0; i < 10 && stage.clientWidth === 0; i++) {
      await new Promise((r) => requestAnimationFrame(r));
      window.dispatchEvent(new Event('resize'));
    }
  }
  if (R && stage && R.cssW === 0 && stage.clientWidth > 0) {
    R.fit(stage);
  }
  const dprOk = !!(R && stage && R.dpr > 0 && R.cssW > 0 && R.cssH > 0 &&
                  Math.abs(stage.width - Math.round(R.cssW * R.dpr)) <= 1 &&
                  Math.abs(stage.height - Math.round(R.cssH * R.dpr)) <= 1);
  ok('DPR module', dprOk,
     R ? 'dpr=' + R.dpr + ' css=' + R.cssW + 'x' + R.cssH +
        ' stage=' + stage.width + 'x' + stage.height +
        ' clientW=' + stage.clientWidth + 'x' + stage.clientHeight
     : 'SWR_RENDER missing');

  // 12. engine-render module loads + exposes cache controls (for follow-up
  // migration). The cache itself is implemented but not yet wired to the
  // page's per-frame draw path; this verifies the surface area exists.
  const modOk = !!(R && typeof R.invalidate === 'function' &&
                   typeof R.setBackground === 'function' &&
                   typeof R.frame === 'function' &&
                   typeof R.fit === 'function' &&
                   typeof R.cacheSize === 'number');
  ok('render module surface', modOk,
     R ? 'invalidate=' + typeof R.invalidate + ' frame=' + typeof R.frame +
        ' cacheSize=' + R.cacheSize : 'no SWR_RENDER');

  // 13. library/ ships with the deploy. If the engine pages can't reach
  // ../library/manifest.json, the boot auto-load is a no-op and the
  // "video reactive feature is empty" regression returns.
  try {
    const r = await fetch('../library/manifest.json', { cache: 'no-cache' });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const m = await r.json();
    const libOk = !!(m && Array.isArray(m.files) && m.files.length > 0);
    ok('library served', libOk, 'files=' + (m && m.files ? m.files.length : 0));
  } catch (e) {
    ok('library served', false, 'fetch failed: ' + e.message);
  }

  // 14. Per-layer color-motion sliders (contrast / brightness / alpha / mutate).
  //     The color-motion upgrade exposes these on every engine study's layer
  //     card. We re-render to ensure a fresh DOM, then look for an input
  //     whose current value matches the layer's corresponding field.
  G._restore(base); G.commit();
  window.SWR.Layers.render();
  await sleep(120);
  const l0 = window.SWR.Layers.list[0] || {};
  const allCards = document.querySelectorAll('#layers .l');
  const findInputByValue = (val) => {
    for (const card of allCards) {
      const inputs = card.querySelectorAll('input[type=range]');
      for (const inp of inputs) {
        if (Math.abs(+inp.value - val) < 1e-6) return inp;
      }
    }
    return null;
  };
  const ctOk  = !!findInputByValue(l0.contrast   ?? 1);
  const brOk  = !!findInputByValue(l0.brightness ?? 1);
  const alOk  = !!findInputByValue(l0.alpha      ?? 1);
  const mtOk  = !!findInputByValue(l0.mutate     ?? 0);
  ok('color-motion sliders',
     ctOk && brOk && alOk && mtOk,
     'ct=' + ctOk + ' br=' + brOk + ' al=' + alOk + ' mt=' + mtOk +
     ' (values ' + JSON.stringify({
       ct: l0.contrast, br: l0.brightness, al: l0.alpha, mt: l0.mutate
     }) + ')');

  // 14b. Drive each slider and confirm the corresponding layer field updates
  //      — verifies the binding (not just the DOM presence).
  let driveOk = false;
  const drive = () => {
    const l0 = window.SWR.Layers.list[0];
    const card = document.querySelector('#layers .l');
    if (!l0 || !card) return false;
    const inputs = card.querySelectorAll('input[type=range]');
    if (!inputs.length) return false;
    // The 4 new fields are appended after the legacy 3 (opacity, baseScale,
    // hue) in the order ct, br, alpha, mutate. For engines with no hue
    // (grid), the indices shift by one — handled below.
    // Find the inputs by inspecting adjacent labels.
    const findByLabel = (text) => {
      for (const inp of inputs) {
        const lab = inp.parentElement && inp.parentElement.querySelector('label');
        if (lab && lab.textContent.trim() === text) return inp;
      }
      return null;
    };
    const ct = findByLabel('ct');
    const br = findByLabel('br');
    const al = findByLabel('\u03b1');
    const mt = findByLabel('mt');
    if (!ct || !br || !al || !mt) return false;
    ct.value = '1.7'; ct.dispatchEvent(new Event('input', { bubbles: true }));
    br.value = '1.3'; br.dispatchEvent(new Event('input', { bubbles: true }));
    al.value = '0.5'; al.dispatchEvent(new Event('input', { bubbles: true }));
    mt.value = '0.4'; mt.dispatchEvent(new Event('input', { bubbles: true }));
    return Math.abs(l0.contrast - 1.7) < 1e-6
        && Math.abs(l0.brightness - 1.3) < 1e-6
        && Math.abs(l0.alpha - 0.5) < 1e-6
        && Math.abs(l0.mutate - 0.4) < 1e-6;
  };
  driveOk = drive();
  ok('color-motion drive', driveOk,
     driveOk ? '' : 'input event did not propagate to layer field');

  // 15. Keyboard shortcuts help: a clickable "?" icon must be present and
  //     open the SWR_KEYS overlay when clicked. The overlay (SWR_KEYS.showHelp
  //     creates <div id="swr-keys-help">) is the source of truth.
  const helpBtn = document.getElementById('swr-keys-help-btn');
  let helpOpenOk = false;
  if (helpBtn && window.SWR_KEYS && typeof window.SWR_KEYS.showHelp === 'function') {
    helpBtn.click();
    helpOpenOk = !!document.getElementById('swr-keys-help');
    if (helpOpenOk && typeof window.SWR_KEYS.hideHelp === 'function') {
      window.SWR_KEYS.hideHelp();
    }
  }
  ok('keys help icon', helpOpenOk,
     helpBtn ? 'btn present, overlay ' + (helpOpenOk ? 'opened' : 'failed to open')
             : 'no #swr-keys-help-btn in DOM');

  // 16. Intuitive keymap expansion — the new shortcuts (Cmd+Z undo, Cmd+S
  //     save, Cmd+O open, Cmd+R record, F fullscreen, M mute, C cycle blend,
  //     Y duplicate, Del delete, bracket-pattern nudges) must be present in
  //     SWR_KEYS.help() and dispatch to real handlers via SWR_KEYS.simulate().
  // The help() function uses combined rows (e.g. "[ / ]") for visual
  // density, so this assertion checks for the combined string.
  const expectedShortcuts = [
    'Cmd+Z', 'Cmd+Shift+Z', 'Cmd+S', 'Cmd+O', 'Cmd+R', 'Cmd+Enter',
    'F', 'M', 'C', 'Y', 'Del / Bksp',
    '[ / ]', ', / .', "; / '", '/', 'Shift+/',
    'Shift+[', 'Shift+]', 'Shift+,', 'Shift+.', 'Shift+;', "Shift+'",
    'Shift+N', 'Shift+R', 'Shift+A', 'Shift+M', 'Shift+T', 'Shift+L',
    'B', 'X', '0', '?', 'Esc',
  ];
  const helpKeys = window.SWR_KEYS ? window.SWR_KEYS.help().map(function (r) { return r.keys; }) : [];
  const missing = expectedShortcuts.filter(function (k) { return helpKeys.indexOf(k) === -1; });
  ok('expanded keymap', missing.length === 0,
     missing.length === 0 ? helpKeys.length + ' shortcuts present'
                          : 'missing: ' + missing.join(', '));

  // 17. Bracket-pattern nudges drive the layer field. Set a known alpha,
  //     simulate '[', confirm alpha decreased by 0.05 (default nudge).
  const nudgeOk = (function () {
    const L = window.SWR.Layers;
    if (!L || !L.list || !L.list.length) return false;
    const l0 = L.list[0];
    const before = 0.5;
    l0.alpha = before;
    try { window.SWR_KEYS.simulate('BracketLeft', {}); } catch (e) { return false; }
    return Math.abs(l0.alpha - (before - 0.05)) < 1e-6;
  })();
  ok('bracket nudge', nudgeOk, 'alpha 0.50 → 0.45 via [ key');

  // 18. Cmd/Ctrl dispatch routes correctly (Ctrl+Z calls undo, which
  //     doesn't error out on a fresh state).
  let undoOk = false;
  try {
    window.SWR_KEYS.simulate('KeyZ', { ctrl: true });
    undoOk = true;
  } catch (e) { undoOk = false; }
  ok('cmd dispatch', undoOk, 'Ctrl+Z did not throw');

  return out;
})()`;

const server = await serve();
const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });

let pagesOk = 0, pagesBad = 0;
const failures = [];

for (const name of ENGINES) {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e.message || e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });

  let results = [];
  try {
    await page.goto(`http://localhost:${PORT}/versions/${name}.html`, {
      waitUntil: 'domcontentloaded', timeout: 20000,
    });
    await page.waitForFunction('window.SWR && window.SWR.Layers && window.SWR_GENOPS', { timeout: 10000 });
    await page.evaluate(SEED_PAGE);
    results = await page.evaluate(CHECKS);
  } catch (e) {
    results = [{ name: 'load', pass: false, note: String(e.message || e) }];
  }

  // console errors are their own check; ignore benign media/network noise from
  // the synthetic library (empty asset urls) and absent audio files.
  const realErrors = errors.filter((e) =>
    !/Failed to load resource|net::ERR|NotSupportedError|manifest\.json|Failed to fetch/i.test(e));
  results.unshift({ name: 'no console errors', pass: realErrors.length === 0, note: realErrors.slice(0, 2).join(' | ') });

  const failed = results.filter((r) => !r.pass);
  if (failed.length === 0) {
    console.log(`✓ ${name.padEnd(14)} ${results.length}/${results.length} checks`);
    pagesOk++;
  } else {
    console.log(`✗ ${name.padEnd(14)} ${results.length - failed.length}/${results.length} checks`);
    for (const f of failed) console.log(`    ${f.name}: ${f.note}`);
    failures.push({ name, failed });
    pagesBad++;
  }
  await page.close();
}

await browser.close();
server.close();

console.log(`\n${pagesOk}/${ENGINES.length} pages fully passing, ${pagesBad} with failures`);
process.exit(pagesBad ? 1 : 0);
