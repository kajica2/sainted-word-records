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
    hue: 0, brightness: 1.0, contrast: 1.0, locks: {},
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
      for (const f of ['opacity','baseScale','hue','brightness','contrast']) {
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
  const dprOk = !!(R && stage && R.dpr > 0 && R.cssW > 0 && R.cssH > 0 &&
                  // The CSS box should be sane and the backing store should
                  // be stage.width === Math.round(cssW * dpr), with at most
                  // a 1-px rounding error from the original CSS-pixel sizing.
                  Math.abs(stage.width - Math.round(R.cssW * R.dpr)) <= 1 &&
                  Math.abs(stage.height - Math.round(R.cssH * R.dpr)) <= 1);
  ok('DPR module', dprOk,
     R ? 'dpr=' + R.dpr + ' css=' + R.cssW + 'x' + R.cssH +
        ' stage=' + stage.width + 'x' + stage.height +
        ' expected=' + Math.round(R.cssW * R.dpr) + 'x' + Math.round(R.cssH * R.dpr)
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
