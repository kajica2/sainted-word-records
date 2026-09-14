// scripts/debug-puppeteer.mjs — full console + network debug sweep.
//
// Visits each page, captures ALL console messages (errors + warnings),
// pageerrors, failed requests, and HTTP >= 400 responses; asserts the
// default-library seed state on /engine and tab behavior on /dashboard.
// Saves screenshots to /tmp/swr-debug/.
//
// Run: node scripts/debug-puppeteer.mjs [base-url]
import puppeteer from 'puppeteer';
import fs from 'node:fs';

const BASE = process.argv[2] || 'https://sainted-word-records.vercel.app';
const OUT = '/tmp/swr-debug';
fs.mkdirSync(OUT, { recursive: true });

const PAGES = [
  { path: '/engine',    name: 'engine' },
  { path: '/dashboard', name: 'dashboard' },
  { path: '/photo.html', name: 'photo' },
  { path: '/terms.html', name: 'terms' },
  { path: '/versions',  name: 'versions' },
];

const browser = await puppeteer.launch({
  headless: 'new',
  args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--autoplay-policy=no-user-gesture-required'],
});

let totalProblems = 0;
for (const { path, name } of PAGES) {
  const url = BASE + path;
  console.log('\n════════════════════ ' + url);
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  const msgs = [];
  const net = [];
  page.on('console', (m) => {
    const t = m.type();
    if (t === 'error' || t === 'warning') msgs.push(`[${t}] ${m.text()}`);
  });
  page.on('pageerror', (e) => msgs.push(`[pageerror] ${e.message}`));
  page.on('requestfailed', (r) => net.push(`FAILED ${r.url().slice(0, 110)} — ${r.failure()?.errorText || '?'}`));
  page.on('response', (r) => { if (r.status() >= 400) net.push(`${r.status()} ${r.url().slice(0, 110)}`); });

  await page.goto(url, { waitUntil: 'networkidle2', timeout: 45000 }).catch((e) => msgs.push('[nav] ' + e.message));
  await new Promise((r) => setTimeout(r, 5000));

  if (name === 'engine') {
    const seed = await page.evaluate(() => ({
      libModule: !!window.SWR_DEFAULT_LIBRARY,
      items: (window.Library && window.Library.items || []).length,
      webps: (window.Library && window.Library.items || []).filter((i) => /\.webp$/i.test(i.name || '')).length,
      songName: (document.getElementById('song-name') || {}).textContent || '',
      variants: !!window.SWR_VARIANTS,
      variantOptions: (document.getElementById('variant') || { options: [] }).options.length,
    }));
    console.log('  seed:', JSON.stringify(seed));
    if (seed.webps < 7) msgs.push('[assert] expected 7 default-library webps, got ' + seed.webps);
    if (!/endless-tomorrow/i.test(seed.songName) && seed.songName !== 'No song loaded') msgs.push('[assert] unexpected song: ' + seed.songName);
  }
  if (name === 'dashboard') {
    const dash = await page.evaluate(() => ({
      versions: document.querySelectorAll('.versions a[data-v]').length,
      toggles: document.querySelectorAll('[data-toggle-tab]').length,
      engineReady: !!window.__SWR_ENGINE,
      canvasW: (document.getElementById('render-canvas') || {}).width,
    }));
    console.log('  dashboard:', JSON.stringify(dash));
    // exercise a tab switch
    await page.click('[data-toggle-tab="enhance"]');
    await new Promise((r) => setTimeout(r, 400));
    const sw = await page.evaluate(() => ({
      enh: !document.getElementById('tab-enhance').classList.contains('hidden'),
      canvas: document.getElementById('render-canvas').style.display,
    }));
    console.log('  tab switch:', JSON.stringify(sw));
    if (!sw.enh || sw.canvas !== 'none') msgs.push('[assert] dashboard tab switch broken: ' + JSON.stringify(sw));
    await page.click('[data-toggle-tab="photo"]').catch(() => {});
  }

  await page.screenshot({ path: `${OUT}/${name}.png` }).catch(() => {});
  const problems = [...msgs, ...net];
  totalProblems += problems.length;
  if (problems.length) {
    console.log('  ── problems (' + problems.length + ') ──');
    for (const p of [...new Set(problems)]) console.log('   •', p.slice(0, 180));
  } else {
    console.log('  ✓ clean console + network');
  }
  await page.close();
}
await browser.close();
console.log('\n════ TOTAL PROBLEMS:', totalProblems);
console.log('screenshots: ' + OUT);