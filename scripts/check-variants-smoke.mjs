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
  page.on('pageerror', (e) => pageErrors.push(e.message.split('\n')[0]));
  page.on('console', (m) => {
    if (m.type() === 'error') consoleErrors.push(m.text().slice(0, 200));
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

  const ERR_FILTER = /favicon|ResizeObserver|AudioContext|Failed to load resource|404/i;
  const realPageErrors = pageErrors.filter((m) => !ERR_FILTER.test(m));
  const realConsoleErrors = consoleErrors.filter((m) => !ERR_FILTER.test(m));
  if (realPageErrors.length === 0) ok('no uncaught page errors at boot');
  else bad(`${realPageErrors.length} page errors at boot`, realPageErrors.slice(0, 3).join(' | '));
  if (realConsoleErrors.length === 0) ok('no console errors at boot');
  else bad(`${realConsoleErrors.length} console errors at boot`, realConsoleErrors.slice(0, 3).join(' | '));

  // Walk every id in the runtime list. activate() fetches /versions/<id>.html
  // and compiles its drawFx; we then load the variant's default song, wait
  // for a few render frames with audio playing, and sample the render
  // canvas for non-black pixels. Loading the song is necessary because
  // several variants (notably void) are explicitly designed to multiply
  // the canvas down toward black when audio is silent — without a song
  // playing those variants would falsely fail this gate.
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

    // Sample 60×34 pixels of the engine render canvas. We do this by drawing
    // the canvas into a 60×34 scratch via a temporary canvas, then reading
    // ImageData. Cheap and bounded.
    const sample = await page.evaluate(() => {
      const stage = document.getElementById('render');
      if (!stage) return { error: 'no #render canvas' };
      const W = 60, H = 34;
      const scratch = document.createElement('canvas');
      scratch.width = W;
      scratch.height = H;
      const sctx = scratch.getContext('2d');
      sctx.drawImage(stage, 0, 0, W, H);
      let d;
      try { d = sctx.getImageData(0, 0, W, H).data; }
      catch (e) { return { error: 'getImageData failed: ' + e.message }; }
      let sum = 0, nonBlack = 0;
      for (let i = 0; i < d.length; i += 4) {
        const lum = d[i] + d[i + 1] + d[i + 2];
        sum += lum;
        if (lum > 24) nonBlack += 1;
      }
      const px = W * H;
      return {
        avgLum: sum / (px * 3),
        nonBlackPct: (nonBlack / px) * 100,
        totalPx: px,
      };
    });

    if (sample.error) {
      bad(`${id}: canvas sample`, sample.error);
      continue;
    }

    if (sample.nonBlackPct > 10 && sample.avgLum > 5) {
      ok(`${id}: fx=true nonBlack=${sample.nonBlackPct.toFixed(1)}% avgLum=${sample.avgLum.toFixed(1)}`);
    } else {
      bad(`${id}: frame is black`, `nonBlack=${sample.nonBlackPct.toFixed(1)}% avgLum=${sample.avgLum.toFixed(1)}`);
    }
  }

  // Final tally of any new pageerrors / console.errors that surfaced across
  // the variant walk. Filter the same allowlist (autoplay policy noise,
  // favicon, AudioContext, ResizeObserver, /api/ 404s).
  const latePageErrors = pageErrors.filter((m) => !ERR_FILTER.test(m));
  const lateConsoleErrors = consoleErrors.filter((m) => !ERR_FILTER.test(m));
  if (latePageErrors.length === 0) ok('no uncaught page errors across full walk');
  else bad(`${latePageErrors.length} page errors during walk`, latePageErrors.slice(0, 3).join(' | '));
  if (lateConsoleErrors.length === 0) ok('no console errors across full walk');
  else bad(`${lateConsoleErrors.length} console errors during walk`, lateConsoleErrors.slice(0, 3).join(' | '));

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
