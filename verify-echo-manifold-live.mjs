// verify-echo-manifold-live.mjs — one-shot Puppeteer smoke against the
// deployed ECHO Manifold 5.0 (https://echo-manifold.vercel.app).
//
// Same 7 checks as verify-echo-manifold.mjs but points at the live Vercel
// alias instead of a local preview server. No server boot. If Puppeteer
// can't launch Chromium, prints (env skip: ...) and exits 0.

import { setTimeout as wait } from 'node:timers/promises';
import puppeteer from 'puppeteer';

const URL = process.argv[2] || 'https://echo-manifold.vercel.app/';

function step(msg) { console.log('• ' + msg); }
function fail(msg) { console.error('✗ ' + msg); cleanup(1); }

let browser = null;
async function cleanup(code) {
  try { if (browser) await browser.close(); } catch {}
  process.exit(code);
}

await (async () => {
  step('Target: ' + URL);
  try {
    browser = await puppeteer.launch({
      headless: 'new',
      args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'],
    });
  } catch (e) {
    console.log('(env skip: puppeteer launch failed: ' + e.message + ')');
    return cleanup(0);
  }

  const page = await browser.newPage();
  const consoleErrors = [];
  page.on('console', msg => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });
  page.on('pageerror', err => consoleErrors.push(String(err)));

  step('Loading page');
  await page.goto(URL, { waitUntil: 'domcontentloaded' });

  step('Waiting for SWR_ECHO to mount');
  await page.waitForFunction(() => !!window.SWR_ECHO, { timeout: 15_000 });
  step('SWR_ECHO mounted.');

  step('Waiting for intro overlay');
  await page.waitForFunction(
    () => {
      const el = document.getElementById('intro-overlay');
      return el && !el.classList.contains('hidden') && getComputedStyle(el).opacity !== '0';
    },
    { timeout: 10_000 }
  );
  step('Intro overlay visible.');

  step('Clicking #enter-btn');
  await page.click('#enter-btn');

  step('Waiting for isPlaying');
  await page.waitForFunction(() => window.SWR_ECHO && window.SWR_ECHO.isPlaying === true, { timeout: 10_000 });
  step('Engine is playing.');

  step('Asserting AudioContext.state === running');
  const audioState = await page.evaluate(() => window.SWR_ECHO.audioState);
  if (audioState !== 'running') return fail('AudioContext state was ' + audioState);

  step('Cycling formulas × 3');
  const firstName = await page.evaluate(() => window.SWR_ECHO.activeName);
  for (let i = 0; i < 3; i++) {
    await page.keyboard.press('ArrowRight');
    await wait(400);
  }
  const cycledName = await page.evaluate(() => window.SWR_ECHO.activeName);
  if (cycledName === firstName) return fail('Formula did not change (' + firstName + ')');
  step('Formula: ' + firstName + ' → ' + cycledName);

  step('Cycling generative mode × 3');
  const startMode = await page.evaluate(() => window.SWR_ECHO.genMode);
  for (let i = 0; i < 3; i++) {
    await page.evaluate(() => document.getElementById('gen-mode-btn').click());
    await wait(150);
  }
  const endMode = await page.evaluate(() => window.SWR_ECHO.genMode);
  if (endMode === startMode) return fail('Gen mode did not change');
  step('Gen mode: ' + startMode + ' → ' + endMode);

  step('Sampling canvas + FFT');
  const activity = await page.evaluate(() => {
    const c = document.getElementById('main-canvas');
    if (!c) return { ok: false, reason: 'no canvas' };
    const ctx = c.getContext('2d');
    const d = ctx.getImageData(0, 0, c.width, c.height).data;
    let nonBlack = 0;
    for (let i = 0; i < d.length; i += 4) {
      if (d[i] > 8 || d[i+1] > 8 || d[i+2] > 8) nonBlack++;
    }
    return { ok: true, width: c.width, height: c.height, nonBlackPixels: nonBlack, totalPixels: d.length / 4, fftMax: window.SWR_ECHO.fftBinMax };
  });
  if (!activity.ok) return fail('Canvas: ' + activity.reason);
  step('Canvas: ' + activity.width + '×' + activity.height + ', non-black = ' + activity.nonBlackPixels + '/' + activity.totalPixels + ', fftMax = ' + activity.fftMax);
  if (activity.nonBlackPixels < 5) return fail('Canvas blank');
  if (activity.fftMax === 0) return fail('FFT all-zero');

  step('Stopping via Space');
  await page.keyboard.press(' ');
  await wait(400);
  const stopped = await page.evaluate(() => window.SWR_ECHO.isPlaying);
  if (stopped !== false) return fail('Engine did not stop');

  step('Console errors: ' + consoleErrors.length);
  const real = consoleErrors.filter(e => !/AudioContext|autoplay/i.test(e));
  if (real.length > 0) {
    real.forEach(e => console.error('  ' + e));
    return fail(real.length + ' console errors');
  }

  step('All checks passed on ' + URL);
  return cleanup(0);
})();
