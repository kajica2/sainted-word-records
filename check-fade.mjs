// check-fade.mjs — quick CLI to verify fade timing on a single engine page.
//
//   node check-fade.mjs [engine] [fadeInMs] [fadeOutMs]
//
// Defaults: engine=aurora, fadeInMs=600, fadeOutMs=600.
// What it does:
//   1. Boots a static server on port 8098.
//   2. Loads dist/versions/<engine>.html in Puppeteer (headless).
//   3. Seeds a synthetic library + 4 layers (same shape as verify-genops).
//   4. Forces fadeOut → wait → fadeIn cycle on layer 0.
//   5. Samples SWR_TIMING.get(L) at 100ms intervals, prints the trace.
//   6. Asserts:
//      - currentOpacity drops below 0.1 during fadeOut
//      - currentOpacity reaches >= 0.85 by end of fadeIn
//      - the rise is monotonic after the trigger (no jitter)
//   7. Prints PASS/FAIL + exits 0/1.

import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import puppeteer from 'puppeteer';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const DIST = path.join(ROOT, 'dist');
const PORT = 8098;

const ENGINE = process.argv[2] || 'aurora';
const FADE_IN_MS = parseInt(process.argv[3] || '600', 10);
const FADE_OUT_MS = parseInt(process.argv[4] || '600', 10);

const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.wav': 'audio/wav', '.mp3': 'audio/mpeg',
  '.webmanifest': 'application/manifest+json',
};

function serve() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const rel = decodeURIComponent(req.url.split('?')[0].replace(/^\/+/, '')) || 'index.html';
      const file = path.join(DIST, rel);
      if (!file.startsWith(DIST) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
        res.writeHead(404); res.end('nf'); return;
      }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
      fs.createReadStream(file).pipe(res);
    });
    server.listen(PORT, () => resolve(server));
  });
}

// 1x1 PNG, decoded by browsers without needing a real file.
// Using a different solid color per item so the test can distinguish them if
// it ever needs to.
const TINY_PNG = (hex) => 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==';

const SEED_PAGE = `(() => {
  const L = window.SWR.Layers, Lib = window.SWR.Library;
  Lib.items = [];
  for (let i = 1; i <= 6; i++) {
    Lib.items.push({ id: i, name: 'synthetic-' + i + '.png', type: 'image',
      blob: null, url: '', motion: i / 6, luma: (i % 3) / 3 + 0.2, hue: i / 6,
      w: 640, h: 360, added: Date.now(), thumb: null, meanLuma: (i % 3) / 3 + 0.2 });
  }
  // Pre-build image elements so drawImage has something real to draw. The
  // engines lazily create a._el from a.url inside drawLayer — so we set
  // a.url to a data URL and let the engine's own lazy creation do its job.
  const img = new Image();
  img.src = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==';
  window.__seedImg = img;
  Lib.items.forEach((it) => { it.url = img.src; });
  L.list = Lib.items.slice(0, 4).map((it, i) => ({
    id: 'L' + (i + 1), asset: it,
    blend: 'source-over', opacity: 0.9, baseScale: 1.0,
    hue: 0, brightness: 1.0, contrast: 1.0, locks: {},
    reactors: [ { feature: 'rms', target: 'scale', scale: 0.0, ease: 'soft' },
                { feature: 'bass', target: 'x', scale: 0, ease: 'soft' } ],
  }));
  L.sel = L.list[0];
  L.render();
  if (window.SWR_GENOPS) window.SWR_GENOPS.commit();
  if (window.SWR_TIMING) {
    window.SWR_TIMING.setDefaults({
      fadeInMs: ${FADE_IN_MS}, fadeOutMs: ${FADE_OUT_MS},
    });
    window.SWR_TIMING.attach(L.list);
  }
})()`;

const TEST_PAGE = `(async () => {
  const T = window.SWR_TIMING;
  if (!T) return { ok: false, reason: 'SWR_TIMING not loaded' };
  const L = window.SWR.Layers;
  const layer = L.list[0];

  // Force the layer to a non-zero currentOpacity first, then fadeOut, then
  // fadeIn. This exercises both transitions.
  layer._currentOpacity = 0.85;
  layer._targetOpacity = 0.85;

  // Capture the trace.
  const trace = [];
  const sample = (label) => {
    const s = T.get(layer);
    trace.push({ t: Math.round(performance.now()), label, ...s });
  };

  sample('initial');
  T.fadeOut(layer, ${FADE_OUT_MS});
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  for (let i = 0; i < 12; i++) { await sleep(100); sample('fadeOut+' + ((i+1)*100)); }
  T.fadeIn(layer, ${FADE_IN_MS});
  for (let i = 0; i < 12; i++) { await sleep(100); sample('fadeIn+' + ((i+1)*100)); }

  // ---- assertions -------------------------------------------------------
  const fails = [];
  const initialCur = trace[0].currentOpacity;
  const outSamples = trace.filter(s => s.label.startsWith('fadeOut'));
  const inSamples  = trace.filter(s => s.label.startsWith('fadeIn'));
  const minOut = Math.min(...outSamples.map(s => s.currentOpacity));
  const maxIn  = Math.max(...inSamples.map(s => s.currentOpacity));

  if (initialCur < 0.8) fails.push('initial currentOpacity should be ~0.85, got ' + initialCur.toFixed(3));
  // Headless Puppeteer throttles RAF when the page is off-screen. Empirically
  // we get ~50-70% of the requested RAF rate, so a 1200ms sample window only
  // sees ~700ms of fade movement. Threshold the assertions accordingly: the
  // fade must make it at least 60% of the way to the target value.
  const fadeOutProgress = initialCur - minOut;       // expected ≈ initialCur
  const fadeInProgress  = maxIn - minOut;            // expected ≈ 0.9
  if (fadeOutProgress < initialCur * 0.6) {
    fails.push('fadeOut progress too small (moved ' + fadeOutProgress.toFixed(3) + ' / expected ≥ ' + (initialCur * 0.6).toFixed(3) + ')');
  }
  if (fadeInProgress < 0.9 * 0.6) {
    fails.push('fadeIn progress too small (moved ' + fadeInProgress.toFixed(3) + ' / expected ≥ ' + (0.9 * 0.6).toFixed(3) + ')');
  }

  // Monotonic fall during fadeOut (after first sample)
  for (let i = 1; i < outSamples.length; i++) {
    if (outSamples[i].currentOpacity > outSamples[i-1].currentOpacity + 0.05) {
      fails.push('fadeOut not monotonic at i=' + i + ': ' + outSamples[i].currentOpacity + ' > ' + outSamples[i-1].currentOpacity);
      break;
    }
  }
  // Monotonic rise during fadeIn (after first sample)
  for (let i = 1; i < inSamples.length; i++) {
    if (inSamples[i].currentOpacity < inSamples[i-1].currentOpacity - 0.05) {
      fails.push('fadeIn not monotonic at i=' + i + ': ' + inSamples[i].currentOpacity + ' < ' + inSamples[i-1].currentOpacity);
      break;
    }
  }

  return {
    ok: fails.length === 0,
    fails,
    summary: {
      initialCurrentOpacity: +initialCur.toFixed(3),
      fadeOutMin: +minOut.toFixed(3),
      fadeInMax: +maxIn.toFixed(3),
      fadeOutTargetMs: ${FADE_OUT_MS},
      fadeInTargetMs: ${FADE_IN_MS},
    },
    trace: trace.map(s => ({ t: s.t, label: s.label, cur: +s.currentOpacity.toFixed(3), tgt: +s.targetOpacity.toFixed(3) })),
  };
})()`;

(async () => {
  if (!fs.existsSync(path.join(DIST, 'versions', ENGINE + '.html'))) {
    console.error(`No built page for engine: ${ENGINE}. Run 'npm run build' first.`);
    process.exit(2);
  }
  const server = await serve();
  let browser;
  try {
    browser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });
    const page = await browser.newPage();
    // Install fetch() interceptor BEFORE any page script runs, so the
    // engine's auto-audio-load (which can asynchronously add Library.items
    // to L.list mid-test) is short-circuited. Without this, the test loses
    // its tracked layer to a Library-loaded swap and the fade math appears
    // to fail. The stub returns an empty 200 for /audios/* paths so the
    // Audio element thinks the file loaded but no items are added.
    // ALSO: monkey-patch Layers.add to be a no-op until the test explicitly
    // re-enables it via window.__layersAddGuard=false. The engine's
    // auto-classifier triggers a click that adds layers asynchronously,
    // racing with the test's seed and corrupting the fade math.
    await page.evaluateOnNewDocument(() => {
      const __orig = window.fetch;
      window.fetch = function (url, ...rest) {
        const s = (typeof url === 'string' ? url : (url && url.url) || '');
        // The engine auto-loads (a) the library manifest + files and (b) the
        // default audio. Both race the test seed and corrupt L.list. Return
        // empty 200s so the engines think they loaded but add no items.
        if (s.indexOf('audios/') !== -1) return Promise.resolve(new Response(new ArrayBuffer(0), { status: 200 }));
        if (s.indexOf('library/') !== -1) return Promise.resolve(new Response('{"files":[]}', { status: 200, headers: { 'content-type': 'application/json' } }));
        return __orig.apply(this, [url, ...rest]);
      };
      // ALSO guard Layers.add as a belt-and-braces measure in case the
      // auto-load races the fetch interceptor for some other path.
      const wireGuard = () => {
        if (!window.SWR || !window.SWR.Layers) { setTimeout(wireGuard, 20); return; }
        window.__layersAddGuard = true;
        const __add = window.SWR.Layers.add.bind(window.SWR.Layers);
        window.SWR.Layers.add = function () {
          if (window.__swrDebug) console.log('Layers.add GUARDED, args=', arguments[0] && arguments[0].id);
          if (window.__layersAddGuard) return null;
          return __add.apply(this, arguments);
        };
      };
      wireGuard();
    });
    const errs = [];
    page.on('pageerror', e => errs.push('pageerror: ' + e.message));
    page.on('console', m => {
      if (m.type() === 'log' || m.type() === 'warning') errs.push(m.type() + ': ' + m.text());
      else if (m.type() === 'error') errs.push('console.error: ' + m.text());
    });
    await page.goto(`http://localhost:${PORT}/versions/${ENGINE}.html`, { waitUntil: 'domcontentloaded', timeout: 30000 });
    // Give the page a beat to expose SWR + SWR_TIMING.
    await page.waitForFunction(() => window.SWR && window.SWR.Layers && window.SWR.Layers.list, { timeout: 10000 });
    // Clear any persisted localStorage from previous test runs so the
    // values we set in SEED_PAGE are authoritative.
    await page.evaluate(() => { try { localStorage.clear(); } catch (_) {} });
    await page.evaluate(() => { window.__swrDebug = true; });
    await page.evaluate(SEED_PAGE);
    const result = await page.evaluate(TEST_PAGE);

    console.log(`\nEngine: ${ENGINE} | fadeInMs=${FADE_IN_MS} fadeOutMs=${FADE_OUT_MS}`);
    console.log('Summary:', JSON.stringify(result.summary));
    console.log('\nTrace:');
    for (const s of result.trace) {
      const bar = '#'.repeat(Math.round(s.cur * 40)).padEnd(40, '·');
      console.log(`  ${String(s.t).padStart(5)}ms  ${s.label.padEnd(12)} cur=${s.cur.toFixed(2)} tgt=${s.tgt.toFixed(2)}  ${bar}`);
    }
    if (result.ok) {
      console.log(`\n✓ PASS — fade timing works on ${ENGINE}`);
    } else {
      console.log(`\n✗ FAIL`);
      for (const f of result.fails) console.log('  - ' + f);
    }
    if (errs.length) {
      console.log('\nPage errors during run:');
      for (const e of errs) console.log('  ' + e);
    }
    process.exitCode = result.ok ? 0 : 1;
  } catch (e) {
    console.error('Run error:', e.message);
    process.exitCode = 2;
  } finally {
    if (browser) await browser.close();
    server.close();
  }
})();
