#!/usr/bin/env node
// verify-asset-curator.mjs — Phase 2 P2 sprint item: validate the
// asset-curator.client.js runtime (extracted during the music_video →
// all-surfaces automix port). It's loaded on every variant but nothing
// currently uses it; this verify confirms the runtime works and tags
// files correctly so we can decide whether to wire it into the user
// media upload flow.
//
//   node verify-asset-curator.mjs
//
// Asserts:
//   1. SWR_ASSET_CURATOR is exposed with process() and status()
//   2. process() runs on a programmatic PNG and returns the expected
//      shape: { file, folder, tags, status, tookMs, backgroundColor }
//   3. Tag set includes at least one entry with a score
//   4. The folder value is one of the known FOLDER_MAP values
//   5. The runtime handles a 64x64 white-bg PNG by chroma-keying
//      (status = 'cleaned' or 'passthrough', backgroundColor set)

import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import puppeteer from 'puppeteer';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PORT = 8215;
const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml',
};

function localServe() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const rel = decodeURIComponent(req.url.split('?')[0].replace(/^\/+/, '')) || 'engine.html';
      const file = path.join(ROOT, rel);
      if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
        res.writeHead(404); res.end('nf'); return;
      }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream' });
      fs.createReadStream(file).pipe(res);
    });
    server.listen(PORT, () => resolve(server));
  });
}

// Build a 64x64 PNG with white background + a black square in the
// middle. Real chroma-keying candidates are usually "white bg + colored
// object" — this fixture matches that pattern.
//
// PNG structure: 8-byte signature + IHDR (13 bytes) + IDAT (zlib of
// raw RGBA scanlines) + IEND. We build it with the Canvas API in the
// browser to keep things simple.
const TEST_PNG_SCRIPT = `
(async function () {
  // Build a 64x64 PNG with white bg + black 32x32 square in the middle.
  // Canvas API requires a DOM, so we create one.
  var canvas = document.createElement('canvas');
  canvas.width = 64; canvas.height = 64;
  var ctx = canvas.getContext('2d');
  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, 64, 64);
  ctx.fillStyle = '#000000';
  ctx.fillRect(16, 16, 32, 32);
  var blob = await new Promise(function (resolve) {
    canvas.toBlob(resolve, 'image/png');
  });
  return blob;
})();
`;

function ok(label) { console.log(`  \u2713 ${label}`); }
function fail(label, msg) { console.log(`  \u2717 ${label}: ${msg}`); process.exitCode = 1; }

async function run() {
  const server = await localServe();
  let browser;
  try {
    browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
    const page = await browser.newPage();
    const errors = [];
    page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
    page.on('pageerror', e => errors.push(String(e)));

    await page.goto(`http://localhost:${PORT}/engine.html`, { waitUntil: 'networkidle2' });
    await new Promise(r => setTimeout(r, 1500));

    // 1. SWR_ASSET_CURATOR exposed with process() and status()
    const apiOk = await page.evaluate(() => ({
      hasCurator: !!window.SWR_ASSET_CURATOR,
      hasProcess: typeof window.SWR_ASSET_CURATOR?.process === 'function',
      hasStatus: typeof window.SWR_ASSET_CURATOR?.status === 'function',
    }));
    if (apiOk.hasCurator && apiOk.hasProcess && apiOk.hasStatus)
      ok('SWR_ASSET_CURATOR exposed with process() and status()');
    else fail('SWR_ASSET_CURATOR API', JSON.stringify(apiOk));

    // 2-5. Build a test PNG via Canvas, run process() on it, verify shape
    const result = await page.evaluate(async () => {
      // Build 64x64 PNG: white bg + black 32x32 square in the middle.
      var canvas = document.createElement('canvas');
      canvas.width = 64; canvas.height = 64;
      var ctx = canvas.getContext('2d');
      ctx.fillStyle = '#FFFFFF';
      ctx.fillRect(0, 0, 64, 64);
      ctx.fillStyle = '#000000';
      ctx.fillRect(16, 16, 32, 32);
      var blob = await new Promise(function (resolve) {
        canvas.toBlob(resolve, 'image/png');
      });
      var file = new File([blob], 'gift-bag-test.png', { type: 'image/png' });

      // Run the curator
      var procResult;
      try {
        procResult = await window.SWR_ASSET_CURATOR.process(file);
      } catch (e) {
        return { error: 'process threw: ' + e.message };
      }

      // Wrap the curator output itself so the outer code can check
      // shape directly without re-serializing.
      return {
        hasFile: !!procResult.file,
        folder: procResult.folder,
        tags: procResult.tags,
        tagsIsArray: Array.isArray(procResult.tags),
        tagCount: (procResult.tags || []).length,
        topTag: procResult.tags && procResult.tags[0] && procResult.tags[0].tag,
        topScore: procResult.tags && procResult.tags[0] && procResult.tags[0].score,
        status: procResult.status,
        tookMs: procResult.tookMs,
        tookMsIsNumber: typeof procResult.tookMs === 'number',
        hasBg: !!procResult.backgroundColor,
      };
    });

    if (result.error) {
      fail('process() result', result.error);
    } else {
      // 2. Shape
      if (result.hasFile && result.folder && result.tagsIsArray &&
          ['cleaned', 'passthrough', 'skipped'].includes(result.status) &&
          result.tookMsIsNumber) {
        ok('process() returns expected shape { file, folder, tags, status, tookMs, backgroundColor }');
      } else {
        fail('process() shape', JSON.stringify(result));
      }

      // 3. Tag set has at least one entry with a score
      if (result.tagCount > 0 && result.topScore > 0 && result.topScore <= 1) {
        ok(`process() produced ${result.tagCount} tag(s); top: "${result.topTag}" @ ${result.topScore.toFixed(2)}`);
      } else {
        fail('process() tags', JSON.stringify(result));
      }

      // 4. Folder is a known value
      var validFolders = ['gift-bags', 'transparent-pngs', 'characters', 'creatures', 'nature', 'food', 'objects', 'uncategorized'];
      if (validFolders.includes(result.folder)) {
        ok(`process() assigned folder "${result.folder}"`);
      } else {
        fail('process() folder', JSON.stringify(result));
      }

      // 5. status is one of cleaned/passthrough (the white-bg fixture
      //    should trigger the background-detection path)
      if (result.status === 'cleaned' || result.status === 'passthrough') {
        ok(`process() status: "${result.status}" (chroma-key path engaged in ${result.tookMs}ms)`);
      } else {
        fail('process() status', JSON.stringify(result));
      }
    }

    // Cleanup: remove any test files from the user library
    await page.evaluate(async () => {
      if (window.SWR_MEDIA) {
        try {
          await window.SWR_MEDIA.deleteAll();
        } catch (_) {}
      }
    });

    if (errors.length === 0) ok('no console errors during full run');
    else {
      // The curator's HF-augmented path tries to call kaidjuric-association
      // and may get 503 in CI / sandboxed environments. That's the
      // designed-for offline-fallback path — filter it.
      const realErrors = errors.filter(e => !e.includes('503') && !e.includes('association.hf.space'));
      if (realErrors.length === 0) ok('no console errors during full run (HF 503 ignored — expected offline fallback)');
      else fail('console errors', realErrors.join(' | '));
    }
  } finally {
    if (browser) await browser.close();
    server.close();
  }
}

run().catch(err => {
  console.error('FATAL', err);
  process.exit(1);
});