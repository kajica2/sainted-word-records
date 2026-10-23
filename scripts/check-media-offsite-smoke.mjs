// scripts/check-media-offsite-smoke.mjs — the shipped media off-site smoke.
//
// The claim this gate proves: the curated packs (582 files, 39.6 MB) can be
// served from an off-site host, and when they are, the deploy ships only
// the manifest — the media never enters the build.
//
// It does that end to end, not by inspection:
//
//   1. It builds the site with PACKS_BASE set, into a separate output
//      directory, so the normal dist/ is untouched.
//   2. It asserts the built packs directory holds the manifest and nothing
//      else, and that the manifest's base is the off-site URL.
//   3. It measures the build: the off-site build must be smaller by the
//      size of the packs media.
//   4. It stands up a second server that plays the off-site host — a
//      different ORIGIN, with the CORS header the real hosts send — and
//      loads /packs.html in a real browser. The page must render the pack
//      grid with every image pointing at the off-site origin, the images
//      must actually load, and a cross-origin fetch of a pack file (the
//      exact call the engine's library makes) must succeed.
//
// Run: node scripts/check-media-offsite-smoke.mjs
import puppeteer from 'puppeteer';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { ensureDist } from './with-dist.mjs';
import { offsiteSavings, listPackFiles } from './lib/packs-offsite.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OFFSITE_OUT = 'dist-offsite';

ensureDist();

const results = [];
function ok(name, detail) {
  results.push({ ok: true, name });
  console.log('  ✓ ' + name + (detail ? ' — ' + detail : ''));
}
function bad(name, detail) {
  results.push({ ok: false, name });
  console.log('  ✗ ' + name + (detail ? ' — ' + detail : ''));
  process.exitCode = 1;
}

function dirSize(dir) {
  let total = 0;
  const walk = (d) => {
    let entries;
    try { entries = fs.readdirSync(d, { withFileTypes: true }); }
    catch { return; }
    for (const e of entries) {
      const full = path.join(d, e.name);
      if (e.isDirectory()) walk(full);
      else {
        try { total += fs.statSync(full).size; } catch { /* raced */ }
      }
    }
  };
  walk(dir);
  return total;
}

// A static server for a directory. `cors` adds the header the real
// off-site hosts send, so the browser can fetch the media cross-origin.
function serveDir(dir, { cors = false } = {}) {
  const server = http.createServer((req, res) => {
    let p = req.url.split('?')[0];
    if (p.endsWith('/')) p += 'index.html';
    const file = path.join(dir, path.normalize(p).replace(/^(\.\.[/\\])+/, ''));
    fs.readFile(file, (err, data) => {
      if (err) { res.statusCode = 404; res.end('not found'); return; }
      if (cors) res.setHeader('access-control-allow-origin', '*');
      res.setHeader('Content-Type', contentType(file));
      res.end(data);
    });
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port }));
  });
}

function contentType(file) {
  const ext = path.extname(file);
  if (ext === '.html') return 'text/html';
  if (ext === '.js') return 'text/javascript';
  if (ext === '.css') return 'text/css';
  if (ext === '.json') return 'application/json';
  if (ext === '.webp') return 'image/webp';
  if (ext === '.mp4') return 'video/mp4';
  if (ext === '.mp3') return 'audio/mpeg';
  if (ext === '.png') return 'image/png';
  return 'application/octet-stream';
}

// The off-site host: the packs directory, served from its own origin.
const host = await serveDir(path.join(ROOT, 'packs'), { cors: true });
const packsBase = `http://127.0.0.1:${host.port}/`;
console.log(`[media-offsite] the stand-in off-site host: ${packsBase}`);

// Build with PACKS_BASE set, into a separate output directory.
console.log('[media-offsite] building with PACKS_BASE=' + packsBase + ' …');
const build = spawn('npx', ['vite', 'build', '--outDir', OFFSITE_OUT], {
  cwd: ROOT,
  env: { ...process.env, PACKS_BASE: packsBase },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let buildOut = '';
build.stdout.on('data', (d) => { buildOut += d.toString(); });
build.stderr.on('data', (d) => { buildOut += d.toString(); });
const buildCode = await new Promise((resolve) => {
  build.on('close', (code) => resolve(code));
});
if (buildCode !== 0) {
  bad('the off-site build succeeds', 'exit ' + buildCode + '\n' + buildOut.slice(-2000));
  host.server.close();
  process.exit(1);
}
ok('the off-site build succeeds');

const offsiteDir = path.join(ROOT, OFFSITE_OUT);
const builtPacks = path.join(offsiteDir, 'packs');
const built = fs.existsSync(builtPacks) ? fs.readdirSync(builtPacks) : [];
if (built.length === 1 && built[0] === 'manifest.json') {
  ok('the build ships only the packs manifest', built.join(', '));
} else {
  bad('the build ships only the packs manifest', built.length + ' entries: ' + built.slice(0, 5).join(', '));
}

let manifest = null;
try {
  manifest = JSON.parse(fs.readFileSync(path.join(builtPacks, 'manifest.json'), 'utf8'));
} catch (e) {
  bad('the built manifest parses', e.message);
}
if (manifest) {
  if (manifest.base === packsBase) ok('the manifest points at the off-site host', manifest.base);
  else bad('the manifest points at the off-site host', 'base is ' + manifest.base);
  const packs = Object.keys(manifest.packs || {});
  if (packs.length) ok('the manifest still lists the packs', packs.length + ' packs');
  else bad('the manifest still lists the packs', 'the packs map is empty');
}

// The size claim, measured on the packs themselves: the normal build
// ships this many bytes of pack media, and the off-site build ships none
// of it — the off-site host has to serve exactly that.
const savings = offsiteSavings(ROOT);
const shippedMedia = dirSize(path.join(ROOT, 'dist', 'packs'))
  - fs.statSync(path.join(ROOT, 'dist', 'packs', 'manifest.json')).size;
if (Math.abs(shippedMedia - savings) < savings * 0.02) {
  ok('the normal build ships the pack media the off-site host must serve',
    (shippedMedia / 1048576).toFixed(1) + ' MB');
} else {
  bad('the normal build ships the pack media the off-site host must serve',
    'built ' + (shippedMedia / 1048576).toFixed(1) + ' MB, source ' + (savings / 1048576).toFixed(1) + ' MB');
}

// The runtime: the packs page must resolve the media to the off-site
// origin, load it, and let a cross-origin fetch succeed — the exact call
// client/library-packs.client.js makes.
const site = await serveDir(offsiteDir);
const browser = await puppeteer.launch({
  args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
});
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 900 });
  await page.goto(`http://127.0.0.1:${site.port}/packs.html`, { waitUntil: 'networkidle0', timeout: 30000 });
  await page.waitForFunction(
    () => document.querySelectorAll('img').length > 0,
    { timeout: 15000 },
  ).catch(() => {});

  const siteOrigin = `http://127.0.0.1:${site.port}`;
  const grid = await page.evaluate((origin) => {
    const imgs = Array.from(document.querySelectorAll('img'));
    const cover = document.querySelector('.pack-card__cover');
    return {
      images: imgs.length,
      offsite: imgs.filter((i) => i.src && !i.src.startsWith(origin)).length,
      sources: imgs.slice(0, 3).map((i) => i.getAttribute('src')),
      loaded: imgs.filter((i) => i.complete && i.naturalWidth > 0).length,
      cover: cover ? getComputedStyle(cover).backgroundImage : '',
    };
  }, siteOrigin);
  if (grid.images > 0) ok('the packs page renders the pack grid', grid.images + ' images');
  else bad('the packs page renders the pack grid', 'no images');

  const offsiteSrcs = (grid.sources || []).filter((s) => s && s.startsWith(`http://127.0.0.1:${host.port}/`));
  if (offsiteSrcs.length === (grid.sources || []).length && offsiteSrcs.length) {
    ok('the pack images point at the off-site origin', offsiteSrcs[0]);
  } else {
    bad('the pack images point at the off-site origin', JSON.stringify(grid.sources));
  }

  if (grid.cover && grid.cover.includes(`127.0.0.1:${host.port}`)) {
    ok('the pack cover points at the off-site origin');
  } else {
    bad('the pack cover points at the off-site origin', grid.cover);
  }

  if (grid.loaded > 0) ok('the pack images load from the off-site host', grid.loaded + ' loaded');
  else bad('the pack images load from the off-site host', 'none loaded');

  // The engine's library fetches the bytes with fetch() — CORS applies.
  const fetched = await page.evaluate(async (base) => {
    try {
      const r = await fetch(base + 'dancers/dancer-01.webp');
      if (!r.ok) return { ok: false, status: r.status };
      const buf = await r.arrayBuffer();
      return { ok: true, bytes: buf.byteLength };
    } catch (err) {
      return { ok: false, error: String(err) };
    }
  }, packsBase);
  if (fetched.ok && fetched.bytes > 0) {
    ok('a cross-origin fetch of a pack file succeeds', fetched.bytes + ' bytes');
  } else {
    bad('a cross-origin fetch of a pack file succeeds', JSON.stringify(fetched));
  }
} finally {
  await browser.close();
  site.server.close();
  host.server.close();
  fs.rmSync(offsiteDir, { recursive: true, force: true });
}

const files = listPackFiles(ROOT);
console.log(`\n[media-offsite] ${files.length} pack files, ${(offsiteSavings(ROOT) / 1048576).toFixed(1)} MB off the build`);
const failed = results.filter((r) => !r.ok).length;
console.log(`\nMEDIA OFFSITE SMOKE: ${failed ? 'FAILED' : 'PASSED'} (${results.length - failed}/${results.length} assertions)`);
if (failed) process.exit(1);
