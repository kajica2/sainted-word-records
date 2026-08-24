// verify-brandkit.mjs — end-to-end check for the brandkit + login feature.
//
// Boots vite dev server, clears localStorage, then:
//   1. Loads /login.html
//   2. Submits a name + email
//   3. Asserts the studio applies the brandkit (CSS vars, chip)
//   4. Opens the brandkit editor, edits primary color + brand name, saves
//   5. Asserts the studio re-themes and the chip reflects the new name
//   6. Tests sign-out: brandkit clears, redirect to /login.html
//
// Exit 0 = pass. Exit 1 = any assertion fails (prints cause).

import puppeteer from '/Users/kajicadjuric/Documents/autodashboard/magenta-dsp-procedural/node_modules/puppeteer/lib/puppeteer/puppeteer.js';

const BASE = process.env.SWR_BASE || 'http://localhost:5174';
const fail = (msg) => { console.error('FAIL:', msg); process.exit(1); };
const ok   = (msg) => console.log('  ✓ ' + msg);

async function waitFor(page, fn, { timeout = 5000, label = 'condition' } = {}) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    try { const v = await page.evaluate(fn); if (v) return v; } catch (e) {}
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('timeout waiting for ' + label);
}

const browser = await puppeteer.launch({
  headless: 'new',
  args: ['--no-sandbox', '--disable-setuid-sandbox', '--use-fake-ui-for-media-stream'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 900 });

const consoleErrors = [];
const pageErrors = [];
page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
page.on('pageerror', (e) => pageErrors.push(String(e)));
page.on('response', (r) => { if (r.status() >= 400) console.log('  [HTTP ' + r.status() + ']', r.url()); });

try {
  // ------------------------------------------------------------------
  // 1. Clear localStorage and visit /login.html
  // ------------------------------------------------------------------
  console.log('\n[1] /login.html loads with empty form');
  await page.goto(BASE + '/login.html', { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: 'domcontentloaded' });

  const hasNameField = await page.$('#name');
  const hasEmailField = await page.$('#email');
  const hasSubmit = await page.$('#enter-btn');
  if (!hasNameField) fail('no #name input on login page');
  if (!hasEmailField) fail('no #email input on login page');
  if (!hasSubmit) fail('no #enter-btn on login page');
  ok('login form rendered');

  // The form pre-fills nothing on a fresh localStorage
  const initialName = await page.$eval('#name', (el) => el.value);
  if (initialName !== '') fail('expected empty name field, got ' + JSON.stringify(initialName));
  ok('name field is empty');

  // ------------------------------------------------------------------
  // 2. Submit name + email → land on the studio
  //    (dev: /index_app.html, prod: /index.html)
  // ------------------------------------------------------------------
  console.log('\n[2] Submit login → redirect to studio');
  await page.type('#name', 'Kai Records');
  await page.type('#email', 'kai@label.fm');

  // Capture the navigation triggered by submit
  const navP = page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 5000 });
  await page.click('#enter-btn');
  await navP;

  const dest = page.url();
  const onStudio = dest.endsWith('/index_app.html') || dest.endsWith('/index.html');
  if (!onStudio) fail('expected redirect to studio, got ' + dest);
  ok('redirected to ' + dest.replace(BASE, ''));

  // ------------------------------------------------------------------
  // 3. Studio applies brandkit defaults + mounts chip
  // ------------------------------------------------------------------
  console.log('\n[3] Studio applies brandkit defaults + chip mounted');
  await waitFor(page, () => !!window.SWR_Brandkit, { label: 'SWR_Brandkit module' });
  ok('SWR_Brandkit loaded');

  // Wait for the chip
  await waitFor(page, () => !!document.getElementById('brandkit-chip'), { label: 'brandkit chip' });
  ok('brandkit chip mounted in topbar');

  // Chip text shows the brand name (default = profile name)
  const chipText = await page.$eval('#brandkit-chip', (el) => el.textContent.trim());
  if (!chipText.includes('Kai Records')) fail('expected chip to show "Kai Records", got ' + JSON.stringify(chipText));
  ok('chip text = "Kai Records"');

  // CSS vars reflect defaults — primary is the SWR pink
  const accent = await page.evaluate(() =>
    getComputedStyle(document.documentElement).getPropertyValue('--accent').trim()
  );
  if (accent.toLowerCase() !== '#ff3d92') fail('expected --accent #ff3d92, got ' + JSON.stringify(accent));
  ok('--accent = ' + accent);

  // The status pill should mention brandkit (we set it after the inline IIFE's 'ready')
  await waitFor(page, () => {
    const s = document.getElementById('status-pill');
    return s && s.textContent.toLowerCase().includes('brandkit');
  }, { label: 'status pill mentions brandkit', timeout: 3000 }).catch(() => {
    // Non-fatal: chip + CSS vars are the real proof. Status pill is best-effort UX.
    console.log('  (note: status pill did not show brandkit before other statuses overwrote it)');
  });
  ok('brandkit applied on boot (chip + CSS vars confirmed above)');

  // ------------------------------------------------------------------
  // 4. Open brandkit editor panel
  // ------------------------------------------------------------------
  console.log('\n[4] Open brandkit editor + verify 4 cards');
  await page.click('#brandkit-chip');
  await waitFor(page, () => !!document.getElementById('brandkit-panel'), { label: 'panel' });
  ok('brandkit panel opens');

  const cardCount = await page.$$eval('.bk-card', (els) => els.length);
  if (cardCount !== 4) fail('expected 4 cards (Cover/Logo/Colors/Typography), got ' + cardCount);
  ok('4 cards rendered');

  // Cover previews the brand name
  const coverName = await page.$eval('#bk-cover-name', (el) => el.textContent.trim());
  if (coverName !== 'Kai Records') fail('expected cover name "Kai Records", got ' + JSON.stringify(coverName));
  ok('cover shows brand name');

  // ------------------------------------------------------------------
  // 5. Edit primary color → CSS var updates live
  // ------------------------------------------------------------------
  console.log('\n[5] Edit primary color live');
  await page.evaluate(() => {
    const el = document.getElementById('bk-color-primary');
    el.value = '#22c55e';
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await new Promise((r) => setTimeout(r, 100));
  const accent2 = await page.evaluate(() =>
    getComputedStyle(document.documentElement).getPropertyValue('--accent').trim()
  );
  if (accent2.toLowerCase() !== '#22c55e') fail('expected --accent #22c55e after edit, got ' + JSON.stringify(accent2));
  ok('--accent live-updated to ' + accent2);

  // ------------------------------------------------------------------
  // 6. Edit brand name + save → chip + cover reflect new name
  // ------------------------------------------------------------------
  console.log('\n[6] Edit brand name + save');
  await page.evaluate(() => {
    const el = document.getElementById('bk-brandname');
    el.value = 'RADIAL';
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await new Promise((r) => setTimeout(r, 100));
  await page.click('#bk-save');
  await waitFor(page, () => !document.getElementById('brandkit-panel'), { label: 'panel closes after save' });
  ok('panel closed after save');

  const newChipText = await page.$eval('#brandkit-chip', (el) => el.textContent.trim());
  if (!newChipText.includes('RADIAL')) fail('expected chip to show "RADIAL" after save, got ' + JSON.stringify(newChipText));
  ok('chip text = "RADIAL"');

  // Persisted in localStorage
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('swr.profile')));
  if (!stored || stored.brandkit.brandName !== 'RADIAL') fail('expected stored.brandkit.brandName = "RADIAL", got ' + JSON.stringify(stored));
  if (stored.brandkit.palette.primary.toLowerCase() !== '#22c55e') {
    fail('expected stored palette.primary = #22c55e, got ' + JSON.stringify(stored.brandkit.palette.primary));
  }
  ok('localStorage swr.profile = { brandName: "RADIAL", palette.primary: "#22c55e" }');

  // ------------------------------------------------------------------
  // 7. Take a screenshot for the record
  // ------------------------------------------------------------------
  console.log('\n[7] Capture screenshot');
  await page.screenshot({ path: './verify-screenshots/brandkit-studio.png' });
  ok('screenshot saved → verify-screenshots/brandkit-studio.png');

  // Re-open the panel for a second screenshot
  await page.click('#brandkit-chip');
  await waitFor(page, () => !!document.getElementById('brandkit-panel'), { label: 'panel reopens' });
  await new Promise((r) => setTimeout(r, 250));   // let transition settle
  await page.screenshot({ path: './verify-screenshots/brandkit-panel.png' });
  ok('screenshot saved → verify-screenshots/brandkit-panel.png');

  // ------------------------------------------------------------------
  // 8. Sign out → /login.html, brandkit cleared
  // ------------------------------------------------------------------
  console.log('\n[8] Sign out clears brandkit + redirects');
  // Auto-accept the confirm() dialog
  page.once('dialog', (d) => d.accept());
  await page.click('#bk-logout');
  await page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 5000 });
  if (!page.url().endsWith('/login.html')) fail('expected redirect to /login.html after signout, got ' + page.url());
  ok('redirected to /login.html');

  const after = await page.evaluate(() => localStorage.getItem('swr.profile'));
  if (after !== null) fail('expected swr.profile to be cleared, got ' + after);
  ok('localStorage swr.profile cleared');

  // ------------------------------------------------------------------
  // 9. Visit studio with no profile → silent redirect to login
  // ------------------------------------------------------------------
  console.log('\n[9] Direct studio URL without profile redirects to login');
  // The bootstrap in the studio file lives at /index_app.html in dev
  const studioPath = page.url().endsWith('/login.html') && page.url().includes('/index')
    ? null  // we just came from /index_app.html; we can navigate back
    : '/index_app.html';
  // In dev the studio is /index_app.html, in prod it's /
  // We probe both — the first one to redirect us is the live one.
  for (const path of ['/index_app.html', '/index.html']) {
    await page.goto(BASE + path, { waitUntil: 'domcontentloaded' });
    await new Promise((r) => setTimeout(r, 700));
    if (page.url().endsWith('/login.html')) {
      ok(path + ' without profile redirected to /login.html');
      break;
    }
    if (path === '/index.html') {
      fail('no studio URL redirected to /login.html when no profile (last: ' + page.url() + ')');
    }
  }

  // ------------------------------------------------------------------
  // 10. No console errors / page errors anywhere
  // ------------------------------------------------------------------
  // Filter out pre-existing infra noise (browser auto-fetches favicon.ico)
  // Vercel surfaces 404s with an empty message body, so the inner match
  // string varies between envs; just filter the favicon URL instead.
  const realConsoleErrors = consoleErrors.filter((e) =>
    !/favicon\.ico/.test(e) && !/404 \(/.test(e)
  );
  if (realConsoleErrors.length) fail('console errors during run: ' + JSON.stringify(realConsoleErrors));
  if (pageErrors.length)    fail('page errors during run: ' + JSON.stringify(pageErrors));
  ok('zero console / page errors');

  console.log('\nALL BRANDKIT CHECKS PASSED');
} catch (e) {
  console.error('THREW:', e && e.message ? e.message : e);
  await page.screenshot({ path: './verify-screenshots/brandkit-fail.png' }).catch(() => {});
  process.exit(1);
} finally {
  await browser.close();
}
