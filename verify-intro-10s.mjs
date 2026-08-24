// Verifier for swr-intro-10s.html
// 1. Loads the page
// 2. Verifies GSAP loaded and timeline is exposed
// 3. Verifies all 5 phases reach the expected state
// 4. Captures 5 sample frames at key timestamps
// 5. Verifies no console errors
//
// Usage: node verify-intro-10s.mjs [url]

import puppeteer from 'puppeteer-core';
import { writeFileSync, mkdirSync, existsSync } from 'node:fs';

const URL = process.argv[2] || 'https://sainted-word-records.vercel.app/swr-intro-10s.html';
const OUT = './verify-screenshots/intro-10s-live';
if (!existsSync(OUT)) mkdirSync(OUT, { recursive: true });

const checks = [];
const log = (name, ok, info) => {
  checks.push({ name, ok, info });
  console.log(`${ok ? '✓' : '✗'} ${name}${info ? '  ' + info : ''}`);
};

const browser = await puppeteer.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: 'new',
  args: ['--no-sandbox', '--disable-setuid-sandbox'],
  defaultViewport: { width: 1280, height: 720 },
  protocolTimeout: 60000,
});

try {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console.error: ' + m.text()); });
  page.on('requestfailed', (r) => { if (!r.url().includes('favicon')) errors.push('reqfailed: ' + r.url()); });

  console.log(`Loading ${URL}...`);
  const resp = await page.goto(URL, { waitUntil: 'networkidle0', timeout: 30000 });
  log('HTTP 200', resp.status() === 200, `(${resp.status()})`);
  await page.evaluate(() => document.fonts.ready);
  await new Promise((r) => setTimeout(r, 500));

  // Check 1: GSAP loaded
  const gsapLoaded = await page.evaluate(() => typeof gsap !== 'undefined');
  log('GSAP loaded', gsapLoaded);

  // Check 2: timeline exposed
  const tlInfo = await page.evaluate(() => ({
    exposed: typeof window.__swrIntroTL !== 'undefined',
    duration: window.__swrIntroTL ? window.__swrIntroTL.duration() : 0,
  }));
  log('__swrIntroTL exposed', tlInfo.exposed, `duration=${tlInfo.duration}s`);

  // Check 3: pause and seek
  await page.evaluate(() => { window.__swrIntroTL.pause(0); });

  // Check 4: 5 phases — sample 1 frame per phase
  const phases = [
    { name: 'Phase 1 (breath + Close your eyes)', t: 1.0, expect: 'breath' },
    { name: 'Phase 2 (waveform + Listen)',         t: 3.0, expect: 'wave' },
    { name: 'Phase 3 (frame + Now open them)',     t: 5.0, expect: 'frame' },
    { name: 'Phase 4 (stacked layers)',            t: 7.0, expect: 'layers' },
    { name: 'Phase 5 (wordmark)',                  t: 9.5, expect: 'wordmark' },
  ];
  for (const ph of phases) {
    await page.evaluate((t) => {
      window.__swrIntroTL.seek(t, false);
    }, ph.t);
    await new Promise((r) => setTimeout(r, 100));
    const visible = await page.evaluate((sel) => {
      const el = document.querySelector(sel);
      if (!el) return { exists: false };
      const cs = getComputedStyle(el);
      return { exists: true, opacity: parseFloat(cs.opacity) };
    }, ph.expect === 'breath' ? '.breath'
        : ph.expect === 'wave' ? '.wave'
        : ph.expect === 'frame' ? '.frame'
        : ph.expect === 'layers' ? '.layers'
        : '.wordmark');
    const ok = visible.exists && visible.opacity > 0.1;
    log(ph.name, ok, `opacity=${visible.opacity?.toFixed(2)}`);

    // Snapshot
    const buf = await page.screenshot({ type: 'png' });
    writeFileSync(`${OUT}/t${ph.t.toFixed(1).replace('.', 'p')}s.png`, buf);
  }

  // Check 5: wordmark text correct (read directly from the DOM, no seek needed)
  const wordmarkText = await page.evaluate(() => {
    return {
      line1: document.querySelector('.wordmark__line1')?.textContent,
      line2: document.querySelector('.wordmark__line2')?.textContent,
      url: document.querySelector('.wordmark__url')?.textContent,
    };
  });
  log('Wordmark line 1', wordmarkText.line1 === 'Sainted Word Records', wordmarkText.line1);
  log('Wordmark line 2', wordmarkText.line2 === 'drop a song · get a video', wordmarkText.line2);
  log('Wordmark URL', wordmarkText.url === 'sainted-word-records.vercel.app', wordmarkText.url);

  // Check 6: no console errors
  log('No console errors', errors.length === 0, errors.length ? errors.slice(0, 2).join('; ') : '');

  // Check 7: prefers-reduced-motion respected (CSS only, no reload needed)
  await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
  const reducedMotionCSS = await page.evaluate(() => {
    // Just confirm the @media rule exists in stylesheets (without reloading the page)
    for (const sheet of document.styleSheets) {
      try {
        for (const rule of sheet.cssRules) {
          if (rule.cssText && rule.cssText.includes('prefers-reduced-motion')) {
            return true;
          }
        }
      } catch (e) { /* cross-origin sheet */ }
    }
    return false;
  });
  log('Reduced-motion CSS rule present', reducedMotionCSS);

  // Summary
  const passed = checks.filter((c) => c.ok).length;
  const total = checks.length;
  console.log(`\n${passed}/${total} checks passed`);
  if (passed < total) {
    console.log('Failed:');
    checks.filter((c) => !c.ok).forEach((c) => console.log(`  - ${c.name}: ${c.info || ''}`));
    process.exit(1);
  }
} finally {
  await browser.close();
}
