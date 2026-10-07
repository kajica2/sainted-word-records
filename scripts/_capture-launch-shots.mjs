// scripts/_capture-launch-shots.mjs
// Regenerates the five launch-submission screenshots referenced by launch.md
// into the repo root:
//   landing-full.png          full page, 1440 wide, dark
//   landing-light.png         landing.html above the fold, 1440x900, light
//   landing-dark.png          landing.html above the fold, 1440x900, dark
//   landing-catalog.png       marketplace.html above the fold, light
//   landing-catalog-dark.png  marketplace.html above the fold, dark
//
// Underscore-prefixed like the other standalone codemods in scripts/: nothing
// loads it and no gate runs it. Run it by hand after the landing page changes.
//
//   node scripts/_capture-launch-shots.mjs
//
// Serves dist/ itself, so run `npm run build` first (or let ensureDist build).
// Needs puppeteer, which is already a devDependency for the verify-*.mjs suites.

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST = process.env.SWR_DIST || path.join(ROOT, 'dist');
const OUT = process.env.SWR_OUT || ROOT;
const PORT = 54171;

const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.css': 'text/css', '.json': 'application/json', '.mp3': 'audio/mpeg',
  '.webp': 'image/webp', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg', '.svg': 'image/svg+xml', '.mp4': 'video/mp4',
};

if (!fs.existsSync(path.join(DIST, 'landing.html'))) {
  console.error(`dist/landing.html not found under ${DIST} — run "npm run build" first.`);
  process.exit(1);
}

const server = http.createServer((req, res) => {
  let p = req.url.split('?')[0];
  if (p.endsWith('/')) p += 'index.html';
  const f = path.join(DIST, p);
  if (!f.startsWith(DIST)) { res.statusCode = 403; return res.end(); }
  fs.readFile(f, (err, data) => {
    if (err) { res.statusCode = 404; return res.end(); }
    res.setHeader('Content-Type', MIME[path.extname(f)] || 'application/octet-stream');
    res.end(data);
  });
});
await new Promise((r) => server.listen(PORT, r));

const browser = await puppeteer.launch({
  args: ['--no-sandbox', '--disable-setuid-sandbox', '--autoplay-policy=no-user-gesture-required'],
});
const base = `http://localhost:${PORT}`;
const results = [];

async function shot({ file, url, theme = 'dark', fullPage = false, w = 1440, h = 900 }) {
  const page = await browser.newPage();
  await page.setViewport({ width: w, height: h, deviceScaleFactor: 1 });
  // The theme has to be in localStorage before the page bootstrap reads it,
  // otherwise the first paint wins and the shot comes out on the wrong theme.
  await page.evaluateOnNewDocument((t) => {
    try { localStorage.setItem('swr-theme', t); } catch (e) {}
  }, theme);
  const resp = await page.goto(base + url, { waitUntil: 'domcontentloaded', timeout: 45000 });
  // Give the nav web component and fonts a moment, then shoot.
  await page.waitForSelector('swr-nav nav.swr-nav', { timeout: 10000 }).catch(() => {});
  await new Promise((r) => setTimeout(r, 1200));
  const dims = await page.evaluate(() => ({
    scrollH: document.documentElement.scrollHeight,
    applied: document.documentElement.getAttribute('data-theme'),
  }));
  const out = path.join(OUT, file);
  await page.screenshot({ path: out, fullPage });
  results.push({
    file,
    url,
    theme,
    appliedTheme: dims.applied,
    fullPage,
    size: `${w}x${fullPage ? dims.scrollH : h}`,
    status: resp ? resp.status() : null,
    bytes: fs.statSync(out).size,
  });
  await page.close();
}

await shot({ file: 'landing-full.png', url: '/landing.html', theme: 'dark', fullPage: true });
await shot({ file: 'landing-light.png', url: '/landing.html', theme: 'light' });
await shot({ file: 'landing-dark.png', url: '/landing.html', theme: 'dark' });
await shot({ file: 'landing-catalog.png', url: '/marketplace.html', theme: 'light' });
await shot({ file: 'landing-catalog-dark.png', url: '/marketplace.html', theme: 'dark' });

await browser.close();
server.close();

console.log('launch screenshots written to ' + OUT);
for (const r of results) {
  console.log(`  ${r.file.padEnd(26)} ${r.size.padEnd(12)} theme=${r.appliedTheme} (${r.theme})  ${(r.bytes / 1024).toFixed(0)} KB  ${r.url}`);
}
const bad = results.filter((r) => r.status !== 200 || r.appliedTheme !== r.theme);
if (bad.length) {
  console.error('\nFAILED: ' + bad.map((b) => `${b.file} status=${b.status} theme=${b.appliedTheme}`).join(', '));
  process.exit(1);
}
console.log('\nOK — all five captured on the requested theme.');
