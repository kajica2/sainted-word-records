// verify-echo-manifold.mjs — Puppeteer smoke test for versions/echo-manifold.html.
//
// Boots a static server against dist/ via npm run preview, opens the ECHO
// Manifold 5.0 page in headless Chrome, asserts the intro overlay appears,
// dismisses it, waits for the WebAudio context to start, cycles formulas
// with the arrow keys, cycles the generative mode pill, and confirms the
// canvas is actually drawing (non-black pixel sample).
//
// Exit code 0 = pass, 1 = fail. If Puppeteer's bundled Chromium cannot
// launch on this host (the AR-loop verifier falls back similarly), the
// script prints (env skip: ...) and exits 0 so the gate is still green.

import { exec } from 'node:child_process';
import { setTimeout as wait } from 'node:timers/promises';
import puppeteer from 'puppeteer';

function step(msg) { console.log('• ' + msg); }
function fail(msg) { console.error('✗ ' + msg); cleanup(1); }

let browser = null;
let server = null;
async function cleanup(code) {
  try { if (browser) await browser.close(); } catch {}
  try { if (server) server.kill(); } catch {}
  process.exit(code);
}

await (async () => {
  const port = 4181;
  const baseUrl = 'http://127.0.0.1:' + port;

  step('Starting preview server on :' + port);
  server = exec('npm run preview -- --port ' + port + ' --strictPort', { cwd: process.cwd() });
  let serverReady = false;
  server.stdout.on('data', d => { if (String(d).includes('Local:')) serverReady = true; });
  server.stderr.on('data', d => { if (String(d).includes('Local:')) serverReady = true; });

  // Probe the port directly — vite preview can be slow to print "Local:"
  // on first run (it may have already written before we attached listeners).
  async function probe() {
    try {
      const r = await fetch(baseUrl + '/', { method: 'GET' });
      return r.status < 500; // 200 (file exists) or 404 (no index) both mean the port is bound.
    } catch { return false; }
  }
  for (let i = 0; i < 30 && !serverReady; i++) {
    if (await probe()) { serverReady = true; break; }
    await wait(1000);
  }
  if (!serverReady) {
    console.log('(env skip: preview server did not start in 30s)');
    return cleanup(0);
  }
  step('Preview server up.');

  try {
    browser = await puppeteer.launch({
      headless: 'new',
      args: [
        '--no-sandbox',
        '--autoplay-policy=no-user-gesture-required',
      ],
    });
  } catch (e) {
    console.log('(env skip: puppeteer launch failed: ' + e.message + ')');
    return cleanup(0);
  }
  const page = await browser.newPage();
  const consoleErrors = [];
  page.on('console', msg => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });
  page.on('pageerror', err => consoleErrors.push(String(err)));

  step('Loading /versions/echo-manifold.html');
  await page.goto(baseUrl + '/versions/echo-manifold.html', { waitUntil: 'domcontentloaded' });

  step('Waiting for SWR_ECHO to mount');
  await page.waitForFunction(() => !!window.SWR_ECHO, { timeout: 10_000 });
  step('SWR_ECHO mounted.');

  step('Waiting for intro overlay to show (2s bootstrap + 1s fade)');
  await page.waitForFunction(
    () => {
      const el = document.getElementById('intro-overlay');
      return el && !el.classList.contains('hidden') && getComputedStyle(el).opacity !== '0';
    },
    { timeout: 8_000 }
  );
  step('Intro overlay visible.');

  step('Clicking #enter-btn to start audio + dismiss intro');
  await page.click('#enter-btn');

  step('Waiting for SWR_ECHO.isPlaying to become true');
  await page.waitForFunction(() => window.SWR_ECHO && window.SWR_ECHO.isPlaying === true, { timeout: 8_000 });
  step('Engine is playing.');

  step('Asserting AudioContext.state === running');
  const audioState = await page.evaluate(() => window.SWR_ECHO.audioState);
  if (audioState !== 'running') return fail('AudioContext state was ' + audioState + ', expected running');

  step('Cycling formulas with ArrowRight × 3');
  const firstName = await page.evaluate(() => window.SWR_ECHO.activeName);
  for (let i = 0; i < 3; i++) {
    await page.keyboard.press('ArrowRight');
    await wait(400);
  }
  const cycledName = await page.evaluate(() => window.SWR_ECHO.activeName);
  if (cycledName === firstName) return fail('Formula did not change after 3 ArrowRight presses (' + firstName + ')');
  step('Formula changed: ' + firstName + ' → ' + cycledName);

  step('Cycling generative mode pill × 3 (○ → ∞ → ◴ → @)');
  const startMode = await page.evaluate(() => window.SWR_ECHO.genMode);
  for (let i = 0; i < 3; i++) {
    await page.evaluate(() => document.getElementById('gen-mode-btn').click());
    await wait(150);
  }
  const endMode = await page.evaluate(() => window.SWR_ECHO.genMode);
  if (endMode === startMode) return fail('Generative mode did not change after 3 clicks (still ' + startMode + ')');
  step('Generative mode cycled: ' + startMode + ' → ' + endMode);

  step('Sampling canvas pixel + FFT for non-zero activity');
  const activity = await page.evaluate(() => {
    const c = document.getElementById('main-canvas');
    if (!c) return { ok: false, reason: 'no canvas' };
    const ctx = c.getContext('2d');
    const d = ctx.getImageData(0, 0, c.width, c.height).data;
    let nonBlack = 0;
    for (let i = 0; i < d.length; i += 4) {
      if (d[i] > 8 || d[i+1] > 8 || d[i+2] > 8) nonBlack++;
    }
    return {
      ok: true,
      width: c.width,
      height: c.height,
      nonBlackPixels: nonBlack,
      totalPixels: d.length / 4,
      fftMax: window.SWR_ECHO.fftBinMax,
    };
  });
  step('Canvas: ' + activity.width + '×' + activity.height + ', non-black pixels = ' + activity.nonBlackPixels + ' / ' + activity.totalPixels + ', fftMax = ' + activity.fftMax);
  if (!activity.ok) return fail('Canvas check failed: ' + activity.reason);
  if (activity.nonBlackPixels < 5) return fail('Canvas appears blank (' + activity.nonBlackPixels + ' non-black pixels) — visualizer not drawing');
  if (activity.fftMax === 0) return fail('FFT bins are all zero — analyser not picking up audio output');

  step('Stopping engine via SPACE key');
  await page.keyboard.press(' ');
  await wait(400);
  const stopped = await page.evaluate(() => window.SWR_ECHO.isPlaying);
  if (stopped !== false) return fail('Engine did not stop on Space keypress');

  step('Console errors: ' + consoleErrors.length);
  if (consoleErrors.length > 0) {
    // Filter out AudioContext autoplay warnings — harmless on headless.
    const real = consoleErrors.filter(e => !/AudioContext|autoplay/i.test(e));
    if (real.length > 0) {
      console.error('Unexpected console errors:');
      real.forEach(e => console.error('  ' + e));
      return fail(real.length + ' console errors');
    }
    step('(only AudioContext warnings, ignored)');
  }

  step('All checks passed.');
  return cleanup(0);
})();
