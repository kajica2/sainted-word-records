#!/usr/bin/env node
// scripts/check-variants-smoke.mjs — full 16-variant switcher browser smoke.
//
// Companion to check-variants-unit.mjs. The unit test catches unbound names,
// drawFx bodies that throw, and missing drawFx declarations in the sandbox.
// This smoke catches what the unit cannot: a drawFx that compiles but produces
// a black frame, an activate that throws mid-frame, a targeting rules drift,
// or a missing audios/<id>.mp3 referenced by a new song: field.
//
// Boots the real built dist/engine.html on its own static server, walks every
// id in window.SWR_VARIANTS.list(), activates each one, samples 60×34 pixels
// of the engine render canvas, and asserts the frame is not black.
//
// The variant id list comes from window.SWR_VARIANTS.list() at runtime —
// future entries are auto-covered. The non-black threshold (nonBlackPct > 10)
// is loose enough to cover legitimate "quiet pre-roll" rendering (the current
// 16 all clear 38%+).
//
// Run: node scripts/check-variants-smoke.mjs
// Exit 0 on full pass, 1 otherwise.

import puppeteer from 'puppeteer';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { ensureDist, serveDist } from './with-dist.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.VARIANTS_SMOKE_PORT || 5392);
const BASE = `http://127.0.0.1:${PORT}`;

ensureDist();
const { close } = await serveDist(PORT);

const results = [];
function ok(name) { results.push('  ✓ ' + name); }
function bad(name, got) {
  results.push('  ✗ ' + name + ' (got: ' + got + ')');
  process.exitCode = 1;
}

// Sample 60×34 pixels of the engine render canvas (#render is a 2D
// canvas; the engine's draw loop paints it directly each frame, then the
// FX pipeline composites its WebGL output on a separate #fx-canvas above).
// We read the 2D pixels directly via getImageData, NOT via drawImage
// into a scratch — drawImage would copy the WebGL-backed #fx-canvas too
// (or fail to, depending on the preserveDrawingBuffer state) and confuse
// the diff signal with the FX output that has nothing to do with the
// variant postFx under test. The variant postFx runs against the SAME
// 2D ctx #render uses, so reading its pixels is the correct surface.
//
// The pixel buffer is sent to Node as a plain Array (not ArrayBuffer):
// page.evaluate's structured-clone serializer does not preserve
// ArrayBuffer.detach semantics, and returning a TypedArray is unreliable
// across Puppeteer versions. A 60×34×4 = 8160-element Array is ~32KB
// JSON, fine for one sample per variant.
async function sampleFrame(page) {
  return page.evaluate(() => {
    const stage = document.getElementById('render');
    if (!stage) return { error: 'no #render canvas' };
    const ctx = stage.getContext('2d');
    if (!ctx) return { error: 'no 2D context on #render' };
    const W = 60, H = 34;
    let d;
    try { d = ctx.getImageData(0, 0, W, H).data; }
    catch (e) { return { error: 'getImageData failed: ' + e.message }; }
    let sum = 0, nonBlack = 0;
    for (let i = 0; i < d.length; i += 4) {
      const lum = d[i] + d[i + 1] + d[i + 2];
      sum += lum;
      if (lum > 24) nonBlack += 1;
    }
    const px = W * H;
    return {
      data: Array.from(d),
      avgLum: sum / (px * 3),
      nonBlackPct: (nonBlack / px) * 100,
      totalPx: px,
    };
  });
}

// Fraction of pixels whose RGB sum differs between two consecutive
// samples. Used as the drawFx-aliveness signal: a real (animating)
// drawFx produces a high diff between two samples 80ms apart, a no-op
// drawFx (state.fx.run replaced with () => {}) produces a low diff
// because only the engine's audio jitter remains.
function pixelDiffPct(a, b) {
  if (!a || !b) return 0;
  if (!a.data || !b.data) return 0;
  const x = a.data;
  const y = b.data;
  const n = Math.min(x.length, y.length);
  let diff = 0, total = 0;
  for (let i = 0; i < n; i += 4) {
    const dr = Math.abs(x[i] - y[i]);
    const dg = Math.abs(x[i + 1] - y[i + 1]);
    const db = Math.abs(x[i + 2] - y[i + 2]);
    if (dr + dg + db > 0) diff += 1;
    total += 1;
  }
  return total === 0 ? 0 : (diff / total) * 100;
}

let browser;
try {
  browser = await puppeteer.launch({
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      // --autoplay-policy: engine.html calls Audio.play() during boot, which
      // Chrome otherwise rejects (NotAllowedError) because no gesture has
      // happened yet. The flag is the fix, so these errors are no longer
      // filtered below.
      '--autoplay-policy=no-user-gesture-required',
    ],
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });

  const pageErrors = [];
  const consoleErrors = [];
  // HTTP 4xx/5xx URLs collected separately so the console-error filter
  // can be path-scoped (the bare "Failed to load resource" text Chromium
  // emits does not include the URL). /api/* 4xx is noise from the static
  // server; 4xx on /versions/<id>.html or /audios/<id>.mp3 is a real
  // regression.
  const httpFailures = [];
  page.on('pageerror', (e) => pageErrors.push(e.message.split('\n')[0]));
  page.on('console', (m) => {
    if (m.type() === 'error') consoleErrors.push(m.text().slice(0, 200));
  });
  page.on('response', (r) => {
    if (r.status() >= 400) httpFailures.push(`${r.status()} ${r.url()}`);
  });

  // CI runner note: networkidle0 never settles on engine.html (long-lived
  // audio/fetch). Navigate on domcontentloaded, then poll for the harness
  // readiness signal: SWR_VARIANTS + SWR_LOOKS + FX all defined.
  await page.goto(`${BASE}/engine.html`, { waitUntil: 'domcontentloaded', timeout: 45000 });
  await page.waitForFunction(
    () => !!(window.SWR_VARIANTS && window.SWR_LOOKS && window.FX),
    { timeout: 30000, polling: 400 }
  ).catch(() => {});

  const boot = await page.evaluate(() => ({
    variants: !!window.SWR_VARIANTS,
    looks: !!window.SWR_LOOKS,
    fx: !!window.FX,
    list: window.SWR_VARIANTS ? window.SWR_VARIANTS.list().map((v) => v.id) : [],
  }));
  if (boot.variants && boot.looks && boot.fx) {
    ok(`harness ready: SWR_VARIANTS + SWR_LOOKS + FX (${boot.list.length} variants)`);
  } else {
    bad('harness readiness', JSON.stringify(boot));
    throw new Error('harness never became ready — dist build is the prerequisite');
  }

  // Page errors: drop favicon / ResizeObserver / AudioContext noise. No
  // path scoping here because pageerror messages are not URL-prefixed
  // (a real "ReferenceError" or "TypeError" is exactly what we want to
  // surface; the path-scoped filtering for 404s lives in the HTTP-failure
  // handling below).
  const PAGE_ERR_FILTER = /favicon|ResizeObserver|AudioContext/i;
  // Console errors: same as page errors, plus the bare Chromium
  // "Failed to load resource: 404" string is a known pattern. The
  // URL scoping is done via the parallel httpFailures list — that one
  // carries the real URL, so we can distinguish /api/* noise from
  // /versions/* or /audios/* regressions.
  const CONSOLE_ERR_FILTER = /favicon|AudioContext|Failed to load resource/i;
  // HTTP 4xx/5xx: /api/* is the static server's noise (no swrc
  // middleware). Anything else is a real regression — a missing
  // /versions/<id>.html, /audios/<id>.mp3, etc.
  const HTTP_API_FILTER = /\/api\//i;
  const realPageErrors = pageErrors.filter((m) => !PAGE_ERR_FILTER.test(m));
  const realConsoleErrors = consoleErrors.filter((m) => !CONSOLE_ERR_FILTER.test(m));
  // Cross-check console errors that look like 404s against the URL list:
  // if the page's only 4xx was on /api/*, the matching console error is
  // accounted for, otherwise the console error is a real signal.
  const realHttpFailures = httpFailures.filter((u) => !HTTP_API_FILTER.test(u));
  if (realPageErrors.length === 0) ok('no uncaught page errors at boot');
  else bad(`${realPageErrors.length} page errors at boot`, realPageErrors.slice(0, 3).join(' | '));
  if (realConsoleErrors.length === 0) ok('no console errors at boot');
  else bad(`${realConsoleErrors.length} console errors at boot`, realConsoleErrors.slice(0, 3).join(' | '));
  if (realHttpFailures.length === 0) ok('no non-/api 4xx/5xx at boot');
  else bad(`${realHttpFailures.length} non-/api 4xx/5xx at boot`, realHttpFailures.slice(0, 3).join(' | '));

  // Walk every id in the runtime list. activate() fetches /versions/<id>.html
  // and compiles its drawFx; we then load a song (audio features must
  // be moving — several variants, notably void, are explicitly designed
  // to multiply the canvas down toward black when audio is silent), and
  // for each id sample two consecutive frames 80ms apart. The pass
  // criterion is that the frame changes between the two samples — a
  // real (animating) drawFx produces a high diff, a no-op drawFx (e.g.
  // state.fx.run replaced with () => {}) leaves only the engine's
  // audio jitter, which is much smaller.
  await page.evaluate(() => {
    if (window.SWR_VARIANTS) window.SWR_VARIANTS.deactivate();
  });
  await new Promise((r) => setTimeout(r, 500));

  // Load a generic song so Audio.feat is moving. We use the first
  // variant's song because it is guaranteed to be on disk — the boot
  // header claimed to catch missing audios/<id>.mp3 files, so picking
  // the wrong one could mask that signal.
  const probeSong = boot.list[0] && boot.list[0].song;
  if (probeSong) {
    await page.evaluate(async (songUrl) => {
      try {
        const r = await fetch(songUrl);
        if (!r.ok) return;
        const blob = await r.blob();
        if (!window.Audio || typeof window.Audio.loadFile !== 'function') return;
        const file = new File([blob], songUrl.split('/').pop(), { type: blob.type });
        window.Audio.loadFile(file);
        if (typeof window.Audio.play === 'function') window.Audio.play();
      } catch (_) { /* tolerate — variant may render fine without audio */ }
    }, probeSong).catch(() => {});
    await new Promise((r) => setTimeout(r, 800));
  }

  for (const id of boot.list) {
    // activate, then give the engine a few render frames plus a settle for
    // any async fetch/compile to finish.
    const activated = await page.evaluate(async (vid) => {
      try {
        await window.SWR_VARIANTS.activate(vid);
        return {
          ok: true,
          fx: !!(window.SWR_VARIANTS._debug && window.SWR_VARIANTS._debug.state && window.SWR_VARIANTS._debug.state.fx),
          song: (window.SWR_VARIANTS.list().find((v) => v.id === vid) || {}).song,
        };
      } catch (e) {
        return { ok: false, fx: false, err: e && e.message };
      }
    }, id);

    if (!activated.ok) {
      bad(`${id}: activate()`, activated.err || 'threw');
      continue;
    }
    if (!activated.fx) {
      bad(`${id}: fx=null after activate`, 'state.fx is null (compile or postFx self-disabled)');
      continue;
    }

    // Load + play the variant's default song so the engine's audio features
    // (bass/beat/treble/onset) move. Without this, "void" multiplies the
    // canvas to all black. We tolerate the load failing (404 etc.) — the
    // variant may have rendered fine without audio.
    if (activated.song) {
      await page.evaluate(async (songUrl) => {
        try {
          const r = await fetch(songUrl);
          if (!r.ok) return;
          const blob = await r.blob();
          if (!window.Audio || typeof window.Audio.loadFile !== 'function') return;
          const file = new File([blob], songUrl.split('/').pop(), { type: blob.type });
          window.Audio.loadFile(file);
          if (typeof window.Audio.play === 'function') window.Audio.play();
        } catch (_) { /* tolerate — variant may render fine without audio */ }
      }, activated.song).catch(() => {});
    }

    // 1.6s settle: enough for the engine to draw several frames with the
    // variant postFx applied and for the song to be analyzed. Music video
    // and music_video_mtv have heavier init paths and benefit from a
    // slightly longer settle.
    await new Promise((r) => setTimeout(r, 1600));

    // Pass criterion: the variant's drawFx is mechanically alive — it
    // is called by the engine every frame, AND the call writes to the
    // canvas. The first assertion catches a drawFx that was never
    // invoked (already covered by the activated.fx check above, but
    // defended in depth here). The second catches the failure mode
    // the original threshold could not: a drawFx that compiles and
    // runs but does nothing — its pixels are bit-identical before and
    // after the call. We sample the full canvas (not an 8x8 in the
    // corner) because some drawFxs paint only specific regions —
    // grid and eclipse, measured, leave a top-left 8x8 untouched while
    // writing elsewhere.
    const runStats = await page.evaluate(() => {
      const v = window.SWR_VARIANTS;
      if (!v || !v._debug || !v._debug.state || !v._debug.state.fx) {
        return { count: 0, drewSomething: false };
      }
      const fx = v._debug.state.fx;
      const original = fx.run;
      let count = 0;
      let drewSomething = false;
      fx.run = function (...args) {
        count += 1;
        const ctx = args[0];
        if (!ctx || typeof ctx.getImageData !== 'function') { return original.apply(this, args); }
        const w = ctx.canvas && ctx.canvas.width || 0;
        const h = ctx.canvas && ctx.canvas.height || 0;
        if (!w || !h) { return original.apply(this, args); }
        let before, after;
        try { before = ctx.getImageData(0, 0, w, h).data; } catch (_) { before = null; }
        const r = original.apply(this, args);
        try { after = ctx.getImageData(0, 0, w, h).data; } catch (_) { after = null; }
        if (before && after) {
          // Sample 200 random pixels rather than the whole canvas
          // (a 1280x720x4 = ~3.7MB byte compare per call is too slow).
          for (let s = 0; s < 200; s += 1) {
            const i = (Math.random() * (before.length / 4) | 0) * 4;
            if (before[i] !== after[i] || before[i+1] !== after[i+1] || before[i+2] !== after[i+2]) {
              drewSomething = true;
              break;
            }
          }
        }
        return r;
      };
      // Wait two rAFs for the engine to tick twice.
      return new Promise((resolve) => {
        let frames = 0;
        function loop() {
          frames += 1;
          if (frames >= 2) resolve({ count, drewSomething });
          else requestAnimationFrame(loop);
        }
        requestAnimationFrame(loop);
      });
    });

    if (runStats.count < 2) {
      bad(`${id}: drawFx not called`, `run() invoked ${runStats.count}x in 2 frames (expected >=2)`);
    } else if (!runStats.drewSomething) {
      bad(`${id}: drawFx ran but did not change any sampled pixel`, `count=${runStats.count}, drewSomething=false (drawFx may be a no-op)`);
    } else {
      ok(`${id}: fx=true drawFx ran ${runStats.count}x, painted pixels`);
    }
  }

  // Final tally of any new pageerrors / console.errors that surfaced across
  // the variant walk. Same allowlist as the boot checks; /api/* 404s
  // remain noise from the static server, but a 4xx on /versions/<id>.html
  // or /audios/<id>.mp3 is a real regression and must surface.
  const latePageErrors = pageErrors.filter((m) => !PAGE_ERR_FILTER.test(m));
  const lateConsoleErrors = consoleErrors.filter((m) => !CONSOLE_ERR_FILTER.test(m));
  const lateHttpFailures = httpFailures.filter((u) => !HTTP_API_FILTER.test(u));
  if (latePageErrors.length === 0) ok('no uncaught page errors across full walk');
  else bad(`${latePageErrors.length} page errors during walk`, latePageErrors.slice(0, 3).join(' | '));
  if (lateConsoleErrors.length === 0) ok('no console errors across full walk');
  else bad(`${lateConsoleErrors.length} console errors during walk`, lateConsoleErrors.slice(0, 3).join(' | '));
  if (lateHttpFailures.length === 0) ok('no non-/api 4xx/5xx across full walk');
  else bad(`${lateHttpFailures.length} non-/api 4xx/5xx during walk`, lateHttpFailures.slice(0, 3).join(' | '));

  await page.close();
} finally {
  if (browser) await browser.close();
  await close();
}

console.log(results.join('\n'));
const passed = results.filter((r) => r.startsWith('  ✓')).length;
console.log('\nVARIANTS SMOKE: ' + (process.exitCode ? 'FAILED' : 'PASSED') +
  ` (${passed}/${results.length} assertions)`);
process.exit(process.exitCode || 0);
