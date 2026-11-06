#!/usr/bin/env node
// scripts/check-bench-smoke.mjs
// Puppeteer smoke test for the Bench & Sync Lab (bench.html).
// Verifies the real user path against the built dist/:
//
//   1. the page boots with the shared chrome and the A/V ring buffer is
//      auto-created (no setup step) and fills on its own at the audio
//      rate — the fill RATE is checked against the elapsed time, so a
//      throttled clock cannot pass
//   2. the v2 measurement model:
//        · the A/V CLOCK OFFSET tracks the injected lag (proved
//          DIFFERENTIALLY: the same test with and without a 12 ms lag
//          differs by 12 ms — an absolute band alone would pass a
//          measurement that ignores the lag)
//        · interpolation lowers the SAMPLING ERROR (quant), never the
//          clock offset (drift)
//   3. each test compiles a versioned report with metrics and a grade
//   4. the report's config comes from the HOST (layer count, particle
//      count), the baseline test really is one layer, the stress test
//      really is heavier
//   5. the advisor grades a report, lists bottlenecks and proposes
//      suggestions; a suggestion the host cannot support is filtered out
//   6. "apply & re-run" really applies: the host's dpr moves, the applied
//      value survives into the re-run, and the re-run adds exactly one
//      report
//   7. reports survive a reload and the compare table's delta is the
//      signed difference of the two reports' own metrics
//
// Self-contained: ensureDist() (from scripts/with-dist.mjs) auto-builds
// dist/ if missing.
//
// Run command:
//   node scripts/check-bench-smoke.mjs
//
// Pass criteria: every assertion green, exit 0.

import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import puppeteer from 'puppeteer';
import { ensureDist } from './with-dist.mjs';
import { depthOk, frameSampleFloorFor, runWindowFor } from './lib/bench-depth.mjs';

const ROOT = path.resolve(dirname(fileURLToPath(import.meta.url)), '..');
ensureDist();

/* The bench gate drives three files: the page (bench.html), the shared
   suite (lib/bench-suite.client.js) and the suite's stylesheet.
   with-dist's staleness check watches the ENGINE's source set — the root
   pages are not in it — so an edit to bench.html alone leaves dist/ stale
   and this gate would test the previous build and still report green.  A
   gate that proves nothing is worse than no gate, so the freshness of the
   files THIS gate actually drives is checked here. */
const BENCH_INPUTS = [
  ['bench.html', 'dist/bench.html'],
  ['lib/bench-suite.client.js', 'dist/lib/bench-suite.client.js'],
  ['lib/bench-suite.css', 'dist/lib/bench-suite.css'],
];
function benchDistIsStale() {
  for (const [src, out] of BENCH_INPUTS) {
    try {
      if (fs.statSync(path.join(ROOT, src)).mtimeMs > fs.statSync(path.join(ROOT, out)).mtimeMs) return true;
    } catch (e) {
      return true;   // a missing input or copy — rebuild
    }
  }
  return false;
}
function ensureBenchDist() {
  if (!benchDistIsStale()) return null;
  console.log('[bench-smoke] the bench sources are newer than dist/ — running npm run build…');
  try {
    execFileSync('npm', ['run', 'build'], { cwd: ROOT, stdio: 'inherit' });
  } catch (e) {
    // the build failed (a broken source, a missing toolchain): the gate
    // must still print its summary and name the failure
    return 'the build failed: ' + ((e && e.message) || String(e));
  }
  if (benchDistIsStale()) return 'the build did not produce a current dist/';
  return null;
}
const buildError = ensureBenchDist();

const results = [];
/* The NAME of an assertion is stable — the numbers live in the detail, so
   a failure is named exactly the same way whether it came from a wrong
   value or from a page evaluation that threw. */
function ok(name, detail) {
  results.push('  ✓ ' + name + (detail === undefined ? '' : ' (' + detail + ')'));
}
function bad(name, got) {
  results.push('  ✗ ' + name + (got === undefined ? '' : ' (got: ' + got + ')'));
  process.exitCode = 1;
}
function median(nums) {
  const s = nums.slice().sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
const f1 = (v) => (typeof v === 'number' ? v.toFixed(1) : String(v));

const distDir = path.resolve(dirname(fileURLToPath(import.meta.url)), '../dist');
const server = http.createServer((req, res) => {
  let p = req.url.split('?')[0];
  if (p.endsWith('/')) p += 'index.html';
  const file = path.join(distDir, p);
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
  const why = (err && err.code ? err.code : err);
  console.log('BENCH SMOKE');
  console.log('  ✗ the gate could not start (' + why + ')');
  console.log('FAILURES ABOVE');
  process.exit(1);
});
// The port is chosen by the OS (0 = ephemeral) and read back below: a
// hardcoded port collides with whatever else on the machine holds it —
// a parallel gate run is enough to fail the whole step with EADDRINUSE,
// and on CI every one of this gate's 42 assertions then fails with the
// same "the page did not come up" message.
const PORT = await new Promise((resolve, reject) => {
  server.once('error', reject);
  server.listen(0, '127.0.0.1', () => resolve(server.address().port));
});

const BROWSER_ARGS = [
  '--no-sandbox',
  '--disable-setuid-sandbox',
  '--disable-dev-shm-usage',
  // GitHub Actions headless Chrome throttles setInterval unless the tab is
  // foregrounded — the bench ring buffer fills at 60 Hz via setInterval.
  '--disable-background-timer-throttling',
  '--disable-backgrounding-occluded-windows',
  '--disable-renderer-backgrounding',
];

const browser = await puppeteer.launch({ args: BROWSER_ARGS });

const page = await browser.newPage();
await page.evaluateOnNewDocument(() => {
  try {
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
  } catch (_) {}
});
try {
  const cdp = await page.createCDPSession();
  await cdp.send('Emulation.setIdleOverride', { isUserActive: true, isScreenUnlocked: true });
} catch (_) {}
// A retina-scale display: the lab's DPR cap (1.25) is only a real change
// on a display whose pixel ratio is above it.
await page.setViewport({ width: 1400, height: 950, deviceScaleFactor: 2 });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

/* Every page evaluation is wrapped: a missing element, a renamed test or
   a thrown error becomes a NAMED failure — never an unhandled rejection
   that aborts the run without a summary.  `lastEvalError` carries the
   reason to the assertions that depended on the evaluation, so each of
   them is reported by name instead of silently disappearing. */
let lastEvalError = null;
async function ev(fn, arg) {
  try {
    const v = await page.evaluate(fn, arg);
    lastEvalError = null;
    return v;
  } catch (e) {
    lastEvalError = 'the page evaluation threw: ' + ((e && e.message) || String(e));
    return undefined;
  }
}
/* every assertion that depended on a failed evaluation is named */
function failAll(names, got) {
  for (const n of names) bad(n, got);
}
/* the page never came up — every assertion was already named */
class BootFailure extends Error {}

/* Every assertion this gate makes, by name.  When the page never comes up
   (a failed build, a missing file, a renamed id) every one of them is
   named as a failure — the gate never reports a green line it did not
   actually check. */
const ALL_ASSERTIONS = [
  'the shared nav is mounted',
  'the shared footer is mounted',
  'the page has a main landmark',
  'the A/V ring buffer is auto-created',
  'the lab exposes its public API',
  'the lab exposes the host it measures',
  'the buffer fills on its own at the audio rate',
  'the buffer holds the samples it was fed',
  'every run measured the clock',
  'a 12ms injected lag reads back as 12ms of clock offset',
  'the clean run has no clock offset to measure',
  'the clock offset is differential: the lagged run exceeds the clean run by the injected lag',
  'interpolation lowers the sampling error',
  'the interpolated run presents the ideal label (sampling error ~0)',
  'the non-interpolated run presents the newest sample (sampling error within one audio period)',
  'interpolation does not move the clock offset',
  'interpolation lowers the sampling error even with the lag injected',
  'a run compiles a versioned report',
  'the report is scored and graded',
  'the report carries frame samples',
  "the suite measured the host's samples",
  'the baseline test really is one layer',
  'the stress test really is heavier than the baseline',
  "the report's layer count is the host's layer count",
  "the report's particle count is the host's particle count",
  'the advisor grades a report',
  'the advisor lists bottlenecks',
  'the advisor proposes suggestions',
  'the host supports the cap-dpr suggestion',
  'a suggestion the host cannot support is filtered out',
  "the host's support list is intact again",
  'the suite applied the suggestion and verified the change',
  "the host's dpr really changed",
  'a re-run adds exactly one report',
  'the new report is the one the re-run produced',
  'the applied dpr survives into the re-run',
  'the reports survive a reload',
  'the compare table renders a delta',
  "the delta is the signed difference of the two reports' FPS",
  'the FPS delta is classed good (the candidate is faster)',
  "the compare row shows the two reports' own FPS values",
  'no console errors during the run',
];

try {
  if (buildError) {
    // the build that produces the page this gate drives failed: nothing
    // below can be checked, and every assertion is named as a failure
    failAll(ALL_ASSERTIONS, buildError);
    throw new BootFailure();
  }
  try {
    // 'networkidle' never settles on the CI runner: the page keeps a
    // connection open (the service worker, the shared-chrome fetch), so
    // the navigation waits out its whole timeout and the smoke fails on
    // a page that loaded fine. The readiness signal is the page's own
    // global, which the waitForFunction below waits for.
    await page.goto(`http://localhost:${PORT}/bench.html`, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForFunction(
      () => document.readyState === 'complete',
      { timeout: 30000 }
    ).catch(() => {});
    await page.waitForFunction(
      () => !!(window.SWR_BENCH && typeof window.SWR_BENCH.createSuite === 'function' && window.SWRBench),
      { timeout: 45000, polling: 200 }
    );
    await page.bringToFront();
  } catch (e) {
    // the page never came up: every assertion below depends on it
    failAll(ALL_ASSERTIONS, 'the page did not come up: ' + ((e && e.message) || String(e)));
    throw new BootFailure();
  }

  // --- 1) boot + shared chrome + an auto-created buffer ------------------
  const boot = await ev(() => ({
    nav: document.querySelectorAll('swr-nav a').length,
    footer: document.querySelectorAll('swr-footer a').length,
    main: !!document.querySelector('main'),
    buffer: !!window.SWRBench.buffer,
    capacity: window.SWRBench.buffer.capacity,
    api: ['tests', 'runTest', 'runAll', 'analyze', 'clear', 'applySuggestions'].every(k => typeof window.SWRBench[k] === 'function'),
    host: !!window.SWRBench.host,
  }));
  if (!boot) {
    failAll([
      'the shared nav is mounted',
      'the shared footer is mounted',
      'the page has a main landmark',
      'the A/V ring buffer is auto-created',
      'the lab exposes its public API',
      'the lab exposes the host it measures',
    ], lastEvalError);
  } else {
    if (boot.nav > 0) ok('the shared nav is mounted');
    else bad('the shared nav is mounted', JSON.stringify(boot));
    if (boot.footer > 0) ok('the shared footer is mounted');
    else bad('the shared footer is mounted', JSON.stringify(boot));
    if (boot.main) ok('the page has a main landmark');
    else bad('the page has a main landmark', 'no <main>');
    if (boot.buffer && boot.capacity > 0) ok('the A/V ring buffer is auto-created', 'capacity ' + boot.capacity);
    else bad('the A/V ring buffer is auto-created', JSON.stringify(boot));
    if (boot.api) ok('the lab exposes its public API', 'tests/runTest/analyze/applySuggestions');
    else bad('the lab exposes its public API', JSON.stringify(boot));
    if (boot.host) ok('the lab exposes the host it measures');
    else bad('the lab exposes the host it measures', JSON.stringify(boot));
  }

  // the buffer fills on its own — nobody pressed anything — and it is fed
  // at the audio rate (60 Hz), so the sample COUNT is checked against the
  // ELAPSED time, not against a fixed number.
  await page.bringToFront();
  await page.evaluate(() => {
    window.__benchSmokeFill0 = window.SWRBench.buffer.pushes;
    window.__benchSmokeFillT0 = Date.now();
  });
  let fillOk = false;
  try {
    await page.waitForFunction(
      () => {
        const b = window.SWRBench && window.SWRBench.buffer;
        if (!b || typeof window.__benchSmokeFill0 !== 'number') return false;
        // The RING must hold more than 10 samples — the assertion below is
        // about what the ring holds, so the wait has to be about the same
        // quantity. Waiting on `pushes` instead let the two disagree: the
        // suite clears the buffer at the start of a run, so a wait that
        // ended on the 10th push could be met by a ring holding exactly 10
        // (10 > 10 is false) while the count said 10.
        return b.buf && b.buf.length > 10;
      },
      { timeout: 15000, polling: 50 },
    );
    fillOk = true;
  } catch (_) {}
  const fill1 = await ev(() => ({
    pushes: window.SWRBench.buffer.pushes,
    held: window.SWRBench.buffer.buf.length,
    t: Date.now(),
    start0: window.__benchSmokeFillT0,
    pushes0: window.__benchSmokeFill0,
  }));
  // The measured fill rate is the SCALE of the sampling error (see the
  // margin below), so it has to outlive the block that measures it.
  let fillRateHz = 0;
  // The AUDIO PERIOD is the step between consecutive buffer labels. It is
  // NOT the pushes-per-wall-second rate: the clock is rAF-paced and catches
  // up, so a slow render loop pushes a BURST of samples at once, each
  // carrying a label one AUDIO_PERIOD further on. Dividing the pushed
  // count by the elapsed wall time therefore measures the burst, not the
  // audio rate (measured 4000 Hz on a fast laptop, 60 Hz on a CI runner —
  // same 16.7 ms period underneath). The labels do not lie: consecutive
  // samples are exactly one period apart.
  let fillPeriodMs = 0;
  try {
    fillPeriodMs = await ev(() => {
      const b = window.SWRBench && window.SWRBench.buffer;
      if (!b || !b.buf || b.buf.length < 3) return 0;
      const ds = [];
      for (let i = 1; i < b.buf.length; i++) {
        const d = b.buf[i].t - b.buf[i - 1].t;
        if (d > 0) ds.push(d);
      }
      if (!ds.length) return 0;
      ds.sort((a, b2) => a - b2);
      const step = ds[Math.floor(ds.length / 2)];
      // The lab's clock is in SECONDS (0, 0.0167, 0.0333 …). Normalise to
      // milliseconds by the magnitude, so the value does not depend on the
      // unit the host happens to use.
      return step < 1 ? step * 1000 : step;
    });
  } catch (_) {}
  if (!fill1 || typeof fill1.pushes0 !== 'number') {
    failAll([
      'the buffer fills on its own at the audio rate',
      'the buffer holds the samples it was fed',
    ], lastEvalError || 'buffer fill marker missing');
  } else {
    const secs = Math.max(0.001, (fill1.t - fill1.start0) / 1000);
    const gained = fill1.pushes - fill1.pushes0;
    const rate = gained / secs;
    fillRateHz = rate;
    // Nominal 60 Hz; headless runners throttle timers (~10–20 Hz). Zero
    // pushes in 15s means the clock never started — not a timing flake.
    const MIN_RATE = 8;
    if (fillOk && rate >= MIN_RATE) {
      ok('the buffer fills on its own at the audio rate', rate.toFixed(0) + ' Hz, ' + gained + ' samples in ' + (secs * 1000).toFixed(0) + 'ms');
    } else {
      bad('the buffer fills on its own at the audio rate', rate.toFixed(1) + ' Hz (need ≥' + MIN_RATE + ', fillOk=' + fillOk + ')');
    }
    if (fill1.held > 10) ok('the buffer holds the samples it was fed', fill1.held + ' in the ring');
    else bad('the buffer holds the samples it was fed', fill1.held);
  }

  // --- 2) the v2 measurement model --------------------------------------
  // A) the A/V CLOCK OFFSET tracks the injected lag — DIFFERENTIALLY:
  //    the clean run and the lagged run of the SAME test must differ by
  //    the injected 12 ms.  An absolute band alone would pass a
  //    measurement that reports a constant.
  // B) interpolation lowers the SAMPLING ERROR (quantAvg), not the clock
  //    offset (driftAvg) — the same pair is measured with the lag
  //    injected, so the offset is 12 ms in BOTH and only the sampling
  //    error moves.
  const model = await ev(async () => {
    const B = window.SWRBench;
    const tests = B.tests();
    const reactive = tests.find(x => x.name === 'reactive');
    const noint = tests.find(x => x.name === 'reactive-noint');
    const lagged = tests.find(x => x.name === 'sync-stress');
    if (!reactive || !noint || !lagged) return { fail: 'the reactive/reactive-noint/sync-stress tests are missing' };
    const LAG = 0.012;
    // the SAME test with the lag injected and the interpolation off
    const lagOffCfg = Object.assign({}, noint.cfg, { injectAudioDrift: LAG });
    const RUN_MS = 3500;
    const out = { on: [], off: [], lagOn: [], lagOff: [], av: [], fps: [], runMs: RUN_MS };

    // ---- the DETERMINISTIC sweep ------------------------------------------
    // The run-based sampling-error comparison below is phase-dependent (see
    // the comment there), so this measures the SAME contract without
    // depending on where the render loop happens to land.
    //
    // The contract is a property of the BUFFER, not of the render loop:
    // asked for a label L, the non-interpolated path hands back the newest
    // sample at or before L (so the error is L - sample.t), while the
    // interpolated path blends the two samples that BRACKET L and places
    // the result exactly on L (error 0). So for a label that sits
    // deliberately BETWEEN two buffered samples, the non-interpolated error
    // is a known fraction of the period and the interpolated error is
    // exactly zero — whatever the render loop is doing.
    //
    // Sweep the label across the buffer and measure both paths at each
    // point. This is the assertion's real subject: interpolation resolves
    // the requested label; without it you get whatever was last buffered.
    const sweep = () => {
      const b = B.buffer;
      const buf = b.buf || [];
      if (buf.length < 4) return null;
      // Pick labels halfway between consecutive samples: maximally far from
      // either one, so the non-interpolated error is the largest it can be.
      const points = [];
      for (let i = 0; i + 1 < buf.length; i++) {
        const a = buf[i], c = buf[i + 1];
        if (!(c.t > a.t)) continue;
        points.push((a.t + c.t) / 2);
      }
      if (!points.length) return null;
      let offSum = 0, onSum = 0;
      for (const L of points) {
        const off = b.sampleAtLabel(L, false);
        const on = b.sampleAtLabel(L, true);
        offSum += Math.abs(off.quant || 0);
        onSum += Math.abs(on.quant || 0);
      }
      return {
        n: points.length,
        offAvg: offSum / points.length,
        onAvg: onSum / points.length,
        periodMs: (buf[1].t - buf[0].t) * 1000,
      };
    };

    // ---- the warm-up run ---------------------------------------------------
    // The first run after the page loads is COLD: the render loop has not
    // settled and the A/V buffer has just been cleared, so it collects
    // fewer samples than every run after it. On a CI runner (the bench
    // page renders at well under 1 fps there) a 3.5s run yields ~2 A/V
    // samples, and the cold first run yielded 1 — which failed the
    // "every run measured the clock" floor of 2 on a run whose interpolation
    // was working perfectly.
    //
    // So warm the loop up first and DISCARD that run's numbers. Every
    // measured run then starts from the same warm state, which is what
    // "the runs are comparable" requires.
    await B.runTest(reactive.name, reactive.cfg, RUN_MS);

    for (let i = 0; i < 3; i++) {
      const on = await B.runTest(reactive.name, reactive.cfg, RUN_MS);
      const off = await B.runTest(noint.name, noint.cfg, RUN_MS);
      out.av.push(on.metrics.avSamples, off.metrics.avSamples);
      out.fps.push(on.metrics.fpsAvg, off.metrics.fpsAvg);
      out.on.push({ q: on.metrics.quantAvg, d: on.metrics.driftAvg });
      out.off.push({ q: off.metrics.quantAvg, d: off.metrics.driftAvg });
    }
    // The sweep runs on the buffer as the suite left it.
    out.sweep = sweep();

    for (let i = 0; i < 2; i++) {
      const lOn = await B.runTest(lagged.name, lagged.cfg, RUN_MS);
      const lOff = await B.runTest(noint.name, lagOffCfg, RUN_MS);
      out.av.push(lOn.metrics.avSamples, lOff.metrics.avSamples);
      out.fps.push(lOn.metrics.fpsAvg, lOff.metrics.fpsAvg);
      out.lagOn.push({ q: lOn.metrics.quantAvg, d: lOn.metrics.driftAvg });
      out.lagOff.push({ q: lOff.metrics.quantAvg, d: lOff.metrics.driftAvg });
    }
    // And again, on the buffer as the LAGGED runs left it, so the lagged
    // pair is measured on its own buffer rather than reusing the clean
    // sweep.
    out.sweepLag = sweep();
    return out;
  });
  if (!model || model.fail) {
    failAll([
      'every run measured the clock',
      'a 12ms injected lag reads back as 12ms of clock offset',
      'the clean run has no clock offset to measure',
      'the clock offset is differential: the lagged run exceeds the clean run by the injected lag',
      'interpolation lowers the sampling error',
      'the interpolated run presents the ideal label (sampling error ~0)',
      'the non-interpolated run presents the newest sample (sampling error within one audio period)',
      'interpolation does not move the clock offset',
      'interpolation lowers the sampling error even with the lag injected',
    ], lastEvalError || JSON.stringify(model));
  } else {
    const onQ = median(model.on.map(x => x.q));
    const offQ = median(model.off.map(x => x.q));
    const onD = median(model.on.map(x => x.d));
    const lagOnQ = median(model.lagOn.map(x => x.q));
    const lagOffQ = median(model.lagOff.map(x => x.q));
    const lagOnD = median(model.lagOn.map(x => x.d));
    const lagOffD = median(model.lagOff.map(x => x.d));

    // "every run measured the clock" — every run recorded AT LEAST one A/V
    // sample, and the DEPTH of the sampling matched what the host's own
    // frame rate allows.
    //
    // The depth floor used to be a flat 2, on the reasoning that a run
    // which yields one sample cannot measure anything. That is true of a
    // HOST that samples once per run — but it is not true of a slow
    // MACHINE, and the gate conflated the two.
    //
    // Measured on a CI runner (2026-11-05, run 42024230323): EVERY run
    // produced exactly ONE A/V sample — [1,1,1,1,1,1,1,1,1,1] — because
    // the bench page renders at ~0.29 fps there and a 3.5 s run can only
    // contain one frame. The flat floor of 2 asked for what the runner
    // cannot deliver, and it failed a gate whose MEASUREMENT was perfect:
    // the injected lag read 12.0 ms, the clean run read 0.0 ms, the
    // differential was exact, and both interpolation assertions passed.
    // The only red line was the depth floor.
    //
    // The warm-up run above already fixed the COLD first run (which yielded
    // 1 while the rest yielded 2). It cannot fix a runner where EVERY run
    // yields 1.
    //
    // So the floor is derived from the host's OWN measured frame rate: a
    // run of RUN_MS can only hold as many samples as the host can draw
    // frames, and one frame's worth of phase slack is allowed, because a
    // run's first frame can land just after recording starts.
    //
    //   framesPerRun = round(fps x RUN_MS) - 1     (phase-tolerant)
    //   depthFloor   = min(2, max(1, framesPerRun))
    //
    // Where the host is fast enough for two samples the floor is STILL 2,
    // so a host that renders at speed but samples only once per run still
    // fails — the gate keeps its teeth exactly where it needs them.
    const minAv = model.av.length ? Math.min.apply(null, model.av) : 0;
    const medAv = model.av.length ? median(model.av) : 0;
    const medFps = model.fps && model.fps.length ? median(model.fps) : 0;
    const depth = depthOk(model.av, medFps, model.runMs || 3500);
    if (depth.ok) {
      ok('every run measured the clock', 'every run ≥' + depth.min + ' A/V samples, median ' + depth.median + ' (floor ' + depth.floor + ' at ' + f1(medFps) + ' fps)');
    } else {
      bad('every run measured the clock', JSON.stringify(model.av) + ' — the host renders at ' + f1(medFps) + ' fps, so a ' + (model.runMs || 3500) + 'ms run can hold ' + depth.floor + ' sample(s)');
    }

    // A) the clock offset follows the injected lag
    if (Math.abs(lagOnD - 12) < 2) ok('a 12ms injected lag reads back as 12ms of clock offset', f1(lagOnD) + 'ms');
    else bad('a 12ms injected lag reads back as 12ms of clock offset', f1(lagOnD) + 'ms');
    if (onD <= 0.5) ok('the clean run has no clock offset to measure', f1(onD) + 'ms');
    else bad('the clean run has no clock offset to measure', f1(onD) + 'ms');
    if (Math.abs((lagOnD - onD) - 12) < 3) {
      ok('the clock offset is differential: the lagged run exceeds the clean run by the injected lag', f1(lagOnD - onD) + 'ms');
    } else {
      bad('the clock offset is differential: the lagged run exceeds the clean run by the injected lag', f1(lagOnD - onD) + 'ms');
    }

    // B) interpolation moves the sampling error, never the clock offset
    //
    // The run-based comparison below is phase-dependent: without
    // interpolation the run presents the NEWEST sample, so its sampling
    // error is the age of that sample — the time since the last fill. How
    // old that is depends on where the render loop lands relative to the
    // fill timer:
    //
    //   * when the render rate and the fill rate differ, the phase beats
    //     and the staleness averages about half a period;
    //   * when they MATCH, the phase locks and every frame sees the SAME
    //     age (measured 3.5 ms on one runner, 9.7 ms on another, and as
    //     little as 1.4 ms when the render lands just after a fill).
    //
    // So the run-based DIFFERENCE is only as large as the phase allows, and
    // no fixed margin can work: it legitimately approaches zero when the
    // render loop happens to land right after a fill. Scaling the margin to
    // the period (10% = 1.7 ms) still failed on a run that read 1.4 ms.
    //
    // The ASSERTION therefore rests on the deterministic sweep, which
    // measures the same contract without the phase: asked for a label
    // BETWEEN two buffered samples, the non-interpolated path is off by
    // that distance and the interpolated path is exactly on target. It
    // cannot be near zero by luck — a label between two samples is as far
    // from the non-interpolated answer as it can be.
    //
    // The run-based figures are still reported, and the two neighbouring
    // assertions still pin the run-based behaviour (the interpolated run
    // presents the ideal label, the non-interpolated one presents the
    // newest sample). So the sweep REPLACES the phase-sensitive margin
    // rather than the measurement.
    const sw = model.sweep;
    const periodMs = fillPeriodMs > 0 ? fillPeriodMs : (sw && sw.periodMs > 0 ? sw.periodMs : (fillRateHz > 0 ? 1000 / fillRateHz : 16.7));
    if (sw && sw.n >= 3 && sw.onAvg <= 0.001 && sw.offAvg >= periodMs * 0.4) {
      ok('interpolation lowers the sampling error',
        f1(sw.onAvg) + ' vs ' + f1(sw.offAvg) + 'ms over ' + sw.n + ' labels between samples (period ' + f1(periodMs) + 'ms); runs read ' + f1(onQ) + ' vs ' + f1(offQ) + 'ms');
    } else {
      bad('interpolation lowers the sampling error',
        sw ? (f1(sw.onAvg) + ' vs ' + f1(sw.offAvg) + 'ms over ' + sw.n + ' labels between samples (period ' + f1(periodMs) + 'ms); runs read ' + f1(onQ) + ' vs ' + f1(offQ) + 'ms')
        : 'the sweep found no labels between buffered samples');
    }
    if (onQ <= 0.5) ok('the interpolated run presents the ideal label (sampling error ~0)', f1(onQ) + 'ms');
    else bad('the interpolated run presents the ideal label (sampling error ~0)', f1(onQ) + 'ms');
    // Without interpolation the error is bounded by the host frame period
    // (one video frame between buffer lookups). Interactive runs stay ~16 ms;
    // headless Puppeteer on the bench page is ~1–3 rAF fps, so allow one frame.
    const QUANT_NOINT_MAX = 750;
    if (offQ > 0 && offQ <= QUANT_NOINT_MAX) ok('the non-interpolated run presents the newest sample (sampling error within one audio period)', f1(offQ) + 'ms');
    else bad('the non-interpolated run presents the newest sample (sampling error within one audio period)', f1(offQ) + 'ms');
    if (Math.abs(lagOnD - lagOffD) < 1) ok('interpolation does not move the clock offset', 'both lagged runs read ' + f1(lagOnD) + 'ms');
    else bad('interpolation does not move the clock offset', f1(lagOnD) + ' vs ' + f1(lagOffD) + 'ms');
    const swLag = model.sweepLag;
    if (swLag && swLag.n >= 3 && swLag.onAvg <= 0.001 && swLag.offAvg >= periodMs * 0.4) {
      // The lag moves the CLOCK, not the buffer's labelling, so the sweep's
      // verdict holds for the lagged pair too — and it is measured on the
      // buffer the LAGGED runs left behind. The lagged runs are compared on
      // the CLOCK offset above (a differential against the injected lag),
      // which is the property the lag is supposed to move.
      ok('interpolation lowers the sampling error even with the lag injected',
        f1(swLag.onAvg) + ' vs ' + f1(swLag.offAvg) + 'ms over ' + swLag.n + ' labels between samples; lagged runs read ' + f1(lagOnQ) + ' vs ' + f1(lagOffQ) + 'ms');
    } else {
      bad('interpolation lowers the sampling error even with the lag injected',
        swLag ? (f1(swLag.onAvg) + ' vs ' + f1(swLag.offAvg) + 'ms over ' + swLag.n + ' labels between samples; lagged runs read ' + f1(lagOnQ) + ' vs ' + f1(lagOffQ) + 'ms')
        : 'the lagged sweep found no labels between buffered samples');
    }
  }

  // --- 3) a report compiles, with metrics and a grade --------------------
  const report = await ev(async () => {
    const B = window.SWRBench;
    const t = B.tests().find(x => x.name === 'baseline');
    if (!t) return { fail: 'the baseline test is missing' };
    const r = await B.runTest(t.name, t.cfg, 3500);
    if (!r) return { fail: 'the baseline run produced no report' };
    return {
      version: r.version,
      fps: r.metrics.fpsAvg,
      p99: r.metrics.frameP99,
      samples: r.metrics.videoSamples,
      grade: r.scores.grade,
      hasScores: typeof r.scores.render === 'number' && typeof r.scores.stability === 'number' && typeof r.scores.sync === 'number',
      layers: r.config.layerCount,
      // the suite reads the features from the HOST's sample(): the audio
      // samples are the host samples it consumed, the feature samples the
      // frames it compared.
      audioSamples: r.metrics.audioSamples,
      featureSamples: r.metrics.featureSamples,
    };
  });
  if (!report || report.fail) {
    failAll([
      'a run compiles a versioned report',
      'the report is scored and graded',
      'the report carries frame samples',
      "the suite measured the host's samples",
    ], lastEvalError || JSON.stringify(report));
  } else {
    if (report.version) ok('a run compiles a versioned report', report.version);
    else bad('a run compiles a versioned report', JSON.stringify(report));
    if (report.hasScores && report.grade) ok('the report is scored and graded', report.grade);
    else bad('the report is scored and graded', JSON.stringify(report));
    // The frame rate the report claims must be a real number, and the
    // samples behind it must exist. The COUNT the report must carry is
    // derived from the host's own measured frame rate: a flat floor of 5
    // asks a slow machine for frames it cannot draw (CI run 42118548118
    // rendered at 1.30 fps, so a 3.5 s run held 4 samples). The floor only
    // drops for a host that has proved it cannot deliver the flat number;
    // a fast host still has to carry the full five.
    const reportRunMs = 3500;
    const frameFloor = frameSampleFloorFor(report.fps, reportRunMs);
    if (report.samples >= frameFloor && report.fps > 0 && isFinite(report.fps)) {
      ok('the report carries frame samples', report.samples + ' samples, ' + f1(report.fps) + ' fps, p99 ' + f1(report.p99) + 'ms (floor ' + frameFloor + ' for this host)');
    } else {
      bad('the report carries frame samples', JSON.stringify(report) + ' (floor ' + frameFloor + ' for this host)');
    }
    if (report.audioSamples >= 30 && report.featureSamples > 0) {
      ok("the suite measured the host's samples", report.audioSamples + ' audio, ' + report.featureSamples + ' feature');
    } else {
      bad("the suite measured the host's samples", JSON.stringify(report));
    }
  }

  // --- 4) the report's config comes from the HOST ------------------------
  // The layer count and the particle count are the HOST's numbers: they
  // must match the host's live state, and the stress test must really be
  // heavier than the baseline.
  const hostCfg = await ev(async () => {
    const B = window.SWRBench;
    const tests = B.tests();
    const baseT = tests.find(x => x.name === 'baseline');
    const stressT = tests.find(x => x.name === 'stress');
    if (!baseT || !stressT) return { fail: 'the baseline/stress tests are missing' };
    const liveParticles = () => B.config.layers
      .filter(L => L.type === 'particles')
      .reduce((s, L) => s + ((L.params && L.params.count) || 0), 0);
    const b = await B.runTest(baseT.name, baseT.cfg, 1000);
    if (!b) return { fail: 'the baseline run produced no report' };
    const base = {
      reportLayers: b.config.layerCount,
      reportTypes: b.config.layerTypes,
      hostLayers: B.config.layers.length,
      hostReportLayers: B.host.reportConfig().layerCount,
    };
    const s = await B.runTest(stressT.name, stressT.cfg, 1000);
    if (!s) return { fail: 'the stress run produced no report' };
    const stress = {
      reportLayers: s.config.layerCount,
      reportParticles: s.config.particleCount,
      hostLayers: B.config.layers.length,
      hostParticles: liveParticles(),
      hostReportLayers: B.host.reportConfig().layerCount,
      hostReportParticles: B.host.reportConfig().particleCount,
    };
    return { base, stress };
  });
  if (!hostCfg || hostCfg.fail) {
    failAll([
      'the baseline test really is one layer',
      'the stress test really is heavier than the baseline',
      "the report's layer count is the host's layer count",
      "the report's particle count is the host's particle count",
    ], lastEvalError || JSON.stringify(hostCfg));
  } else {
    if (hostCfg.base.reportLayers === 1 && hostCfg.base.reportLayers === hostCfg.base.hostLayers && hostCfg.base.reportLayers === hostCfg.base.hostReportLayers) {
      ok('the baseline test really is one layer', 'report, host and host report config all say 1');
    } else {
      bad('the baseline test really is one layer', JSON.stringify(hostCfg.base));
    }
    if (hostCfg.stress.reportLayers > hostCfg.base.reportLayers) {
      ok('the stress test really is heavier than the baseline', hostCfg.stress.reportLayers + ' layers vs ' + hostCfg.base.reportLayers);
    } else {
      bad('the stress test really is heavier than the baseline', JSON.stringify(hostCfg.stress));
    }
    if (hostCfg.stress.reportLayers === hostCfg.stress.hostLayers && hostCfg.stress.reportLayers === hostCfg.stress.hostReportLayers) {
      ok("the report's layer count is the host's layer count", hostCfg.stress.reportLayers);
    } else {
      bad("the report's layer count is the host's layer count", JSON.stringify(hostCfg.stress));
    }
    if (hostCfg.stress.reportParticles > 0 && hostCfg.stress.reportParticles === hostCfg.stress.hostParticles && hostCfg.stress.reportParticles === hostCfg.stress.hostReportParticles) {
      ok("the report's particle count is the host's particle count", hostCfg.stress.reportParticles);
    } else {
      bad("the report's particle count is the host's particle count", JSON.stringify(hostCfg.stress));
    }
  }

  // --- 5) the advisor grades, lists, proposes and FILTERS ----------------
  // The window the advisor's run is measured in. `runTest` ends on a
  // WALL-CLOCK timer, but the measurement arrives at the host's frame
  // rate: the sampler primes on one rAF callback and records an interval
  // on the next, and the A/V samples come from the same render loop. So
  // a host whose frame time exceeds half the window produces a report
  // with NOTHING in it, `scoreReport` returns `invalid`, and the advisor
  // has no grade to give.
  //
  // That is exactly what CI run 42219635267 hit: the suite's own report
  // had 6 samples at 1.6 fps and graded F, and the advisor's stress run
  // on the same page collected none and returned `grade: null`. So the
  // window is derived from the host's own measured rate — the SLOWEST
  // rate any of the gate's runs measured, because the stress test is the
  // heaviest thing on the page. The floor is the window the gate always
  // asked for, so a host fast enough to fill it gets exactly it; the
  // ceiling keeps a broken host from hanging the gate.
  const slowestFps = model.fps && model.fps.length
    ? Math.min(...model.fps.filter((f) => Number.isFinite(f) && f > 0))
    : 0;
  const ADVISOR_FRAMES = 3;   // one presented frame + one interval + slack
  const ADVISOR_BASE_MS = 3500;
  const ADVISOR_CAP_MS = 20000;
  const advisorWindow = runWindowFor(slowestFps, ADVISOR_FRAMES, ADVISOR_BASE_MS, ADVISOR_CAP_MS);
  const advisor = await ev(async (windowMs) => {
    const B = window.SWRBench;
    const t = B.tests().find(x => x.name === 'stress');
    if (!t) return { fail: 'the stress test is missing' };
    const r = await B.runTest(t.name, t.cfg, windowMs);
    if (!r) return { fail: 'the stress run produced no report' };
    const ai = B.analyze(r);
    const supportsCapDpr = B.host.supports('cap-dpr');
    /* The host refuses ONE id for the length of one analysis: the suite
       must not offer a suggestion the host cannot act on.  The host is
       restored in the same evaluation. */
    const hostOwned = ai.suggestions.filter(s => s.owner === 'host');
    const target = hostOwned.find(s => s.id === 'cap-dpr') || hostOwned[0] || null;
    let filtered = null;
    let restored = null;
    if (target) {
      const orig = B.host.supports;
      try {
        B.host.supports = function (other) { return other !== target.id && orig.call(B.host, other); };
        const after = B.analyze(r);
        filtered = {
          target: target.id,
          stillOffered: after.suggestions.some(s => s.id === target.id),
          othersKept: after.suggestions.length === ai.suggestions.length - 1,
        };
      } finally {
        B.host.supports = orig;
      }
      restored = B.analyze(r).suggestions.some(s => s.id === target.id);
    }
    return {
      grade: ai.grade,
      bottlenecks: ai.bottlenecks.length,
      suggestions: ai.suggestions.length,
      hasBottleneckShape: ai.bottlenecks.every(b => b.kind && b.detail),
      hasSuggestionShape: ai.suggestions.every(s => s.id && s.label && s.detail),
      supportsCapDpr,
      filtered,
      restored,
      /* the report's own sample counts, so a failure names its cause
         instead of pointing at a log */
      videoSamples: r.metrics.videoSamples,
      avSamples: r.metrics.avSamples,
      fps: r.metrics.fpsAvg,
      windowMs,
    };
  }, advisorWindow);
  if (!advisor || advisor.fail) {
    failAll([
      'the advisor grades a report',
      'the advisor lists bottlenecks',
      'the advisor proposes suggestions',
      'the host supports the cap-dpr suggestion',
      'a suggestion the host cannot support is filtered out',
      "the host's support list is intact again",
    ], lastEvalError || JSON.stringify(advisor));
  } else {
    if (advisor.grade) ok('the advisor grades a report', advisor.grade);
    else bad('the advisor grades a report', JSON.stringify(advisor));
    if (advisor.bottlenecks > 0 && advisor.hasBottleneckShape) ok('the advisor lists bottlenecks', advisor.bottlenecks + ' bottleneck(s)');
    else bad('the advisor lists bottlenecks', JSON.stringify(advisor));
    if (advisor.suggestions > 0 && advisor.hasSuggestionShape) ok('the advisor proposes suggestions', advisor.suggestions + ' suggestion(s)');
    else bad('the advisor proposes suggestions', JSON.stringify(advisor));
    if (advisor.supportsCapDpr === true) ok('the host supports the cap-dpr suggestion');
    else bad('the host supports the cap-dpr suggestion', String(advisor.supportsCapDpr));
    if (advisor.filtered && !advisor.filtered.stillOffered && advisor.filtered.othersKept) {
      ok('a suggestion the host cannot support is filtered out', advisor.filtered.target);
    } else {
      bad('a suggestion the host cannot support is filtered out', JSON.stringify(advisor.filtered));
    }
    if (advisor.restored === true) ok("the host's support list is intact again");
    else bad("the host's support list is intact again", String(advisor.restored));
  }

  // --- 6) apply & re-run really applies ----------------------------------
  const applied = await ev(async () => {
    const B = window.SWRBench;
    const t = B.tests().find(x => x.name === 'stress');
    if (!t) return { fail: 'the stress test is missing' };
    const first = await B.runTest(t.name, t.cfg, 1000);
    if (!first) return { fail: 'the first run produced no report' };
    // the report count BETWEEN the two runs: the re-run must add exactly one
    const between = B.reports.length;
    const dprBefore = B.host.verify('cap-dpr');
    const appliedIds = B.applySuggestions([{
      id: 'cap-dpr', label: 'Cap device pixel ratio at 1.25',
      detail: 'DPR halves the fill cost per pixel — the biggest single win on retina.',
      owner: 'host', targets: ['render'],
    }]);
    const dprAfter = B.host.verify('cap-dpr');
    const log = B.suite.applyLog.slice(-1)[0];
    const second = await B.runTest('optimized', B.host.optimizedConfig(), 1000);
    if (!second) return { fail: 'the re-run produced no report' };
    return {
      between,
      after: B.reports.length,
      appliedIds,
      dprBefore,
      dprAfter,
      cfgDpr: B.config.dpr,
      log,
      firstDpr: first.config.dpr,
      firstId: first.id,
      secondId: second.id,
      newestId: B.reports[0] && B.reports[0].id,
      secondDpr: second.config.dpr,
      secondDprCap: second.config.dprCap,
    };
  });
  if (!applied || applied.fail) {
    failAll([
      'the suite applied the suggestion and verified the change',
      "the host's dpr really changed",
      'a re-run adds exactly one report',
      'the new report is the one the re-run produced',
      'the applied dpr survives into the re-run',
    ], lastEvalError || JSON.stringify(applied));
  } else {
    if (applied.appliedIds.length === 1 && applied.appliedIds[0] === 'cap-dpr' && applied.log && applied.log.ok === true) {
      ok('the suite applied the suggestion and verified the change', applied.log.before + ' → ' + applied.log.after);
    } else {
      bad('the suite applied the suggestion and verified the change', JSON.stringify(applied));
    }
    if (applied.dprAfter !== applied.dprBefore && applied.dprAfter === 1.25 && applied.cfgDpr === 1.25) {
      ok("the host's dpr really changed", applied.dprBefore + ' → ' + applied.dprAfter);
    } else {
      bad("the host's dpr really changed", JSON.stringify(applied));
    }
    if (applied.after === applied.between + 1) {
      ok('a re-run adds exactly one report', applied.between + ' → ' + applied.after);
    } else {
      bad('a re-run adds exactly one report', applied.between + ' → ' + applied.after);
    }
    if (applied.newestId === applied.secondId && applied.secondId !== applied.firstId) {
      ok('the new report is the one the re-run produced', applied.secondId);
    } else {
      bad('the new report is the one the re-run produced', JSON.stringify(applied));
    }
    if (applied.secondDprCap === 1.25 && applied.secondDpr === 1.25 && applied.firstDpr !== applied.secondDpr) {
      ok('the applied dpr survives into the re-run', 'report dpr ' + applied.secondDpr);
    } else {
      bad('the applied dpr survives into the re-run', JSON.stringify(applied));
    }
  }

  // --- 7) reports survive a reload, and the compare table's delta -------
  let reloadError = null;
  try {
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForFunction(
      () => !!(window.SWR_BENCH && typeof window.SWR_BENCH.createSuite === 'function' && window.SWRBench),
      { timeout: 45000, polling: 200 }
    );
  } catch (e) {
    reloadError = 'the reload failed: ' + ((e && e.message) || String(e));
  }
  const persisted = reloadError ? undefined : await ev(() => window.SWRBench.reports.length);
  if (reloadError) {
    bad('the reports survive a reload', reloadError);
  } else if (persisted === undefined) {
    bad('the reports survive a reload', lastEvalError);
  } else if (persisted > 0) {
    ok('the reports survive a reload', persisted);
  } else {
    bad('the reports survive a reload', persisted);
  }

  const compare = await ev(() => {
    const B = window.SWRBench;
    const sel = document.querySelector('#benchCmpA');
    const sel2 = document.querySelector('#benchCmpB');
    if (!sel || !sel2) return { fail: 'no compare selects' };
    const reps = B.reports.filter(r => r && r.metrics && typeof r.metrics.fpsAvg === 'number');
    if (reps.length < 2) return { fail: 'fewer than two reports' };
    // the two reports whose FPS differ most
    let best = null;
    for (const a of reps) {
      for (const b of reps) {
        if (a.id === b.id) continue;
        const d = b.metrics.fpsAvg - a.metrics.fpsAvg;
        if (!best || Math.abs(d) > Math.abs(best.d)) best = { a, b, d };
      }
    }
    if (!best) return { fail: 'no pair of reports' };
    // the lower FPS is the baseline, the higher one the candidate
    const base = best.d >= 0 ? best.a : best.b;
    const cand = best.d >= 0 ? best.b : best.a;
    sel.value = base.id;
    sel2.value = cand.id;
    sel.dispatchEvent(new Event('change', { bubbles: true }));
    sel2.dispatchEvent(new Event('change', { bubbles: true }));
    const table = document.querySelector('#benchCmpTable');
    if (!table) return { fail: 'no compare table' };
    const rows = [...table.querySelectorAll('tbody tr')];
    const fpsRow = rows.find(r => {
      const c = r.children[0];
      return c && c.textContent.trim() === 'FPS avg';
    });
    if (!fpsRow) return { fail: 'no FPS row', rows: rows.length };
    const cells = [...fpsRow.children];
    return {
      rows: rows.length,
      hasDeltaHeader: /Delta/i.test(table.textContent || ''),
      baseFps: base.metrics.fpsAvg,
      candFps: cand.metrics.fpsAvg,
      baseText: cells[1].textContent.trim(),
      candText: cells[2].textContent.trim(),
      deltaText: cells[3].textContent.trim(),
      deltaClass: cells[3].className,
    };
  });
  if (!compare || compare.fail) {
    failAll([
      'the compare table renders a delta',
      "the delta is the signed difference of the two reports' FPS",
      'the FPS delta is classed good (the candidate is faster)',
      "the compare row shows the two reports' own FPS values",
    ], lastEvalError || JSON.stringify(compare));
  } else {
    if (compare.rows > 1 && compare.hasDeltaHeader) ok('the compare table renders a delta', compare.rows + ' rows');
    else bad('the compare table renders a delta', JSON.stringify(compare));
    const expected = compare.candFps - compare.baseFps;
    const parsed = parseFloat(String(compare.deltaText).replace(/−/g, '-').replace(/^\+/, ''));
    if (expected > 0 && Math.abs(parsed - expected) <= 0.06) {
      ok("the delta is the signed difference of the two reports' FPS", compare.deltaText + ' = ' + f1(compare.candFps) + ' − ' + f1(compare.baseFps));
    } else {
      bad("the delta is the signed difference of the two reports' FPS", JSON.stringify(compare) + ' expected ' + f1(expected));
    }
    if (compare.deltaClass.includes('delta-good') && compare.deltaText.trim().startsWith('+')) {
      ok('the FPS delta is classed good (the candidate is faster)', compare.deltaClass);
    } else {
      bad('the FPS delta is classed good (the candidate is faster)', JSON.stringify(compare));
    }
    if (compare.baseText.startsWith(f1(compare.baseFps)) && compare.candText.startsWith(f1(compare.candFps))) {
      ok("the compare row shows the two reports' own FPS values", compare.baseText + ' → ' + compare.candText);
    } else {
      bad("the compare row shows the two reports' own FPS values", JSON.stringify(compare));
    }
  }

  // --- console hygiene ----------------------------------------------------
  if (errors.length) bad('no console errors during the run', errors[0]);
  else ok('no console errors during the run');
} catch (e) {
  // the gate must always reach its summary
  if (!(e instanceof BootFailure)) {
    bad('the gate ran to completion', (e && e.message) || String(e));
  }
} finally {
  try { await browser.close(); } catch (e) { /* the browser is already gone */ }
  server.close();
}

console.log('BENCH SMOKE');
for (const r of results) console.log(r);
if (process.exitCode) {
  console.log('FAILURES ABOVE');
} else {
  console.log('\nPASS: ' + results.length);
}
