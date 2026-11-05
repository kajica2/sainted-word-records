#!/usr/bin/env node
// scripts/check-seo-landing-smoke.mjs — SEO landing pages + embedded studio smoke.
//
//   node scripts/check-seo-landing-smoke.mjs
//
// Asserts:
//   - Each of the five SEO routes loads with #seo-studio and an iframe src (?embed=1)
//   - make-video and engine honour ?embed=1 (swr-embed class, nav hidden)
//   - Engine canvas preset: ?canvas=1 sets reel + 8s; ?rec-dur=5 overrides duration
//   - Make Video embed can record a non-empty WebM/MP4 from a test clip + silent audio

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer';
import { ensureDist } from './with-dist.mjs';

ensureDist();

const distDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../dist');
const vercelRewrites = JSON.parse(
  fs.readFileSync(path.join(distDir, '..', 'vercel.json'), 'utf8')
).rewrites.filter((r) => r.source && r.destination && !r.destination.includes(':'));

function rewritePath(pathname) {
  const hit = vercelRewrites.find((r) => r.source === pathname);
  return hit ? hit.destination : pathname;
}

const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (!p.startsWith('/')) p = '/' + p;
  p = rewritePath(p);
  if (p.endsWith('/')) p += 'index.html';
  let file = path.join(distDir, p.replace(/^\//, ''));
  if (!file.startsWith(distDir)) {
    res.statusCode = 403;
    res.end();
    return;
  }
  const trySend = (f) => {
    fs.readFile(f, (err, data) => {
      if (err) {
        res.statusCode = 404;
        res.end('nf');
        return;
      }
      const ext = path.extname(f);
      const mime = ext === '.html' ? 'text/html'
        : ext === '.js' ? 'text/javascript'
          : ext === '.css' ? 'text/css'
            : ext === '.mp3' ? 'audio/mpeg'
              : 'application/octet-stream';
      res.setHeader('Content-Type', mime);
      res.end(data);
    });
  };
  if (fs.existsSync(file) && fs.statSync(file).isFile()) return trySend(file);
  if (!path.extname(file)) return trySend(file + '.html');
  trySend(file);
});

await new Promise((resolve, reject) => {
  server.once('error', reject);
  server.listen(0, '127.0.0.1', resolve);
});
const PORT = server.address().port;
const BASE = `http://127.0.0.1:${PORT}`;

const SEO_PAGES = [
  { route: '/music-video-maker', iframeMustInclude: 'make-video', embed: 'make-video' },
  { route: '/beatstars-visualizer', iframeMustInclude: 'engine', embed: 'engine' },
  { route: '/spotify-canvas-maker', iframeMustInclude: 'engine', embed: 'engine' },
  { route: '/guides/music-video-no-budget', iframeMustInclude: 'make-video', embed: 'make-video' },
  { route: '/muzicki-spot-beograd', iframeMustInclude: 'make-video', embed: 'make-video' },
];

let failed = 0;
function pass(msg) {
  process.stdout.write(`  ✓ ${msg}\n`);
}
function fail(msg, detail) {
  failed += 1;
  process.stderr.write(`  ✗ ${msg}${detail ? ` — ${detail}` : ''}\n`);
}

const browser = await puppeteer.launch({
  headless: 'new',
  args: ['--no-sandbox', '--disable-setuid-sandbox', '--autoplay-policy=no-user-gesture-required'],
});

try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 900 });

  for (const spec of SEO_PAGES) {
    await page.goto(`${BASE}${spec.route}`, { waitUntil: 'domcontentloaded', timeout: 60000 });
    const studio = await page.$('#seo-studio');
    if (!studio) {
      fail(`${spec.route} missing #seo-studio`);
      continue;
    }
    pass(`${spec.route} has studio section`);

    await page.evaluate(() => {
      const el = document.getElementById('seo-studio');
      if (el) el.scrollIntoView({ block: 'center' });
    });

    await page.waitForFunction(
      () => {
        const f = document.querySelector('#seo-studio [data-seo-studio-frame]');
        return f && f.src && f.src.includes('embed=1');
      },
      { timeout: 15000 }
    );
    const src = await page.$eval('#seo-studio [data-seo-studio-frame]', (el) => el.src);
    if (!src.includes(spec.iframeMustInclude)) {
      fail(`${spec.route} iframe src`, src);
    } else {
      pass(`${spec.route} iframe points at ${spec.iframeMustInclude}`);
    }
  }

  // Embed chrome
  await page.goto(`${BASE}/make-video?embed=1`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForFunction(() => !!window.MVM, { timeout: 45000 });
  const embedMake = await page.evaluate(() => ({
    cls: document.documentElement.classList.contains('swr-embed'),
    navHidden: !document.querySelector('swr-nav') || getComputedStyle(document.querySelector('swr-nav')).display === 'none',
    mvm: !!window.MVM,
  }));
  if (embedMake.cls && embedMake.mvm) pass('make-video ?embed=1 boots MVM with swr-embed');
  else fail('make-video embed', JSON.stringify(embedMake));

  await page.goto(`${BASE}/engine/?embed=1`, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await page.waitForFunction(() => document.getElementById('rec-size'), { timeout: 120000 });
  const embedEngine = await page.evaluate(() => ({
    cls: document.documentElement.classList.contains('swr-embed'),
    recSize: document.getElementById('rec-size') && document.getElementById('rec-size').value,
  }));
  if (embedEngine.cls) pass('engine ?embed=1 has swr-embed');
  else fail('engine embed class');

  await page.goto(`${BASE}/engine/?embed=1&canvas=1`, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await page.waitForFunction(() => document.getElementById('rec-size'), { timeout: 120000 });
  const canvas8 = await page.evaluate(() => ({
    recSize: document.getElementById('rec-size') && document.getElementById('rec-size').value,
    recDur: document.getElementById('rec-dur') && document.getElementById('rec-dur').value,
  }));
  if (canvas8.recSize === 'reel' && canvas8.recDur === '8') {
    pass('?canvas=1 selects reel + 8s');
  } else {
    fail('canvas preset 8s', JSON.stringify(canvas8));
  }

  await page.goto(`${BASE}/engine/?embed=1&canvas=1&rec-dur=5`, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await page.waitForFunction(() => document.getElementById('rec-dur'), { timeout: 120000 });
  const canvas5 = await page.evaluate(() => document.getElementById('rec-dur') && document.getElementById('rec-dur').value);
  if (canvas5 === '5') pass('?canvas=1&rec-dur=5 keeps reel and sets 5s');
  else fail('canvas 5s override', canvas5);

  // Export smoke on make-video embed (clip + short manual record)
  await page.goto(`${BASE}/make-video?embed=1&dur=5`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForFunction(() => !!window.MVM && !!window.SWR_MEDIA, { timeout: 30000 });

  const exportOk = await page.evaluate(async () => {
    try { localStorage.removeItem('swr.mvm.project'); } catch (_) {}
    const RED_PNG = Uint8Array.from(
      atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='),
      (c) => c.charCodeAt(0)
    );
    const file = new File([new Blob([RED_PNG], { type: 'image/png' })], 'rec.png', { type: 'image/png' });
    const c = await window.MVM.addClip(file);
    if (!c) return { error: 'addClip' };
    c.durationMs = 10000;
    window.MVM.addToTimeline(c.id);
    window.__captured = null;
    window.MVM.Recorder._save = function () {
      const blob = new Blob(this.chunks, { type: this.mime });
      window.__captured = { size: blob.size, type: blob.type };
    };
    if (!window.MVM.Recorder.start(5000)) return { error: 'Recorder.start false' };
    const t0 = performance.now();
    while (performance.now() - t0 < 1200) {
      window.MVM.renderFrame(performance.now() - t0);
      await new Promise((r) => setTimeout(r, 33));
    }
    window.MVM.Recorder.stop();
    await new Promise((r) => setTimeout(r, 250));
    return window.__captured || { error: 'no blob' };
  });

  if (exportOk.size > 500 && /webm|mp4/i.test(exportOk.type || '')) {
    pass(`make-video embed export (${exportOk.size} bytes, ${exportOk.type})`);
  } else {
    fail('make-video embed export', JSON.stringify(exportOk));
  }
} finally {
  await browser.close();
  server.close();
}

if (failed) {
  process.stderr.write(`\nSEO landing smoke: ${failed} failure(s)\n`);
  process.exit(1);
}
process.stdout.write('\nSEO landing smoke: all checks passed\n');
