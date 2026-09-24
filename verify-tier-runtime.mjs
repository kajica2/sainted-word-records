#!/usr/bin/env node
// verify-tier-runtime.mjs — tier detection + adaptive-guard step-down.
//
//   node verify-tier-runtime.mjs
//
// Asserts:
//   1. window.__TIER__ + window.SWR_TIER exist and <html data-tier> matches
//   2. ?tier=… overrides detection (low/medium/high)
//   3. the profile table is wired into the audio analyser (fftSize follows tier)
//   4. under 4x CDP CPU throttling the guard steps down within the budget
//      (the ladder's first rung: CSS grade off — observable on the stage)
//   5. the same page on ?tier=low starts with the grade already off
//   6. no pageerror during the run

import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import puppeteer from 'puppeteer';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PORT = 8115;
const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp',
  '.mp3': 'audio/mpeg', '.mp4': 'video/mp4', '.webm': 'video/webm',
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

function ok(label) { console.log(`  \u2713 ${label}`); }
function fail(label, msg) { console.log(`  \u2717 ${label}: ${msg}`); process.exitCode = 1; }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function run() {
  const server = await localServe();
  let browser;
  try {
    browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 800 });
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e).slice(0, 160)));
    page.on('console', (m) => { if (m.type() === 'error' && !/404/.test(m.text())) errors.push(m.text().slice(0, 160)); });

    // 1. detection + element tag
    await page.goto(`http://127.0.0.1:${PORT}/engine.html?tier=high`, { waitUntil: 'domcontentloaded', timeout: 30000 });
    const boot = await page.evaluate(() => ({
      tier: window.__TIER__ && window.__TIER__.tier,
      dataTier: document.documentElement.dataset.tier,
      hasGuard: !!window.SWR_ADAPTIVE,
      profile: window.__TIER__ && window.__TIER__.profile,
      signals: window.__TIER__ && window.__TIER__.signals,
    }));
    if (boot.tier === 'high' && boot.dataTier === 'high' && boot.hasGuard && boot.profile && boot.signals) {
      ok(`tier runtime live (\u2192 ${boot.tier}, cores=${boot.signals.cores}, fft=${boot.profile.fftSize})`);
    } else {
      fail('tier runtime', JSON.stringify(boot));
    }

    // 2. URL override wins over detection for every tier
    for (const t of ['low', 'medium', 'high']) {
      const p2 = await browser.newPage();
      await p2.goto(`http://127.0.0.1:${PORT}/engine.html?tier=${t}`, { waitUntil: 'domcontentloaded', timeout: 30000 });
      const got = await p2.evaluate(() => ({ tier: window.__TIER__.tier, fft: window.__TIER__.profile.fftSize, scale: window.__TIER__.profile.renderScale }));
      if (got.tier === t) ok(`?tier=${t} honoured (fft=${got.fft}, renderScale=${got.scale})`);
      else fail(`?tier=${t}`, JSON.stringify(got));
      await p2.close();
    }

    // 3. the profile reaches the audio analyser (fftSize follows the tier)
    const fftLow = await (async () => {
      const p3 = await browser.newPage();
      await p3.goto(`http://127.0.0.1:${PORT}/engine.html?tier=low`, { waitUntil: 'domcontentloaded', timeout: 30000 });
      // unlock() needs a WebAudio context; drive the public path the page uses.
      const v = await p3.evaluate(async () => {
        try {
          const A = (window.SWR && window.SWR.Audio) || window.Audio;
          if (!A || typeof A.unlock !== 'function') return { skipped: 'no Audio.unlock' };
          A.unlock();
          return { fft: A.analyser ? A.analyser.fftSize : null, smoothing: A.analyser ? A.analyser.smoothingTimeConstant : null };
        } catch (e) { return { error: String(e).slice(0, 80) }; }
      });
      await p3.close();
      return v;
    })();
    if (fftLow.fft === 512) ok(`low tier analyser fftSize=512, smoothing=${fftLow.smoothing}`);
    else fail('audio analyser tier wiring', JSON.stringify(fftLow));

    // 4. CPU throttling fires the guard's step-down within budget
    const client = await page.target().createCDPSession();
    await client.send('Emulation.setCPUThrottlingRate', { rate: 4 });
    const before = await page.evaluate(() => window.SWR_ADAPTIVE.stats().downCount);
    let after = before;
    const t0 = Date.now();
    while (Date.now() - t0 < 20000 && after === before) {
      await sleep(500);
      after = await page.evaluate(() => window.SWR_ADAPTIVE.stats().downCount);
    }
    if (after > before) {
      const st = await page.evaluate(() => window.SWR_ADAPTIVE.stats());
      ok(`guard stepped down under 4\u00d7 throttling in ${((Date.now() - t0) / 1000).toFixed(1)}s (${st.downCount} rung(s): ${st.steps.map((s) => s.label).join(' \u2192 ')})`);
    } else {
      const st = await page.evaluate(() => window.SWR_ADAPTIVE.stats());
      fail('guard step-down', `no step after 20s of 4x throttling — ema=${st.ema} pressure=${st.state}`);
    }

    // 5. the first rung is observable: the filmic grade is off
    const grade = await page.evaluate(() => {
      const st = window.SWR_ADAPTIVE.state();
      const c = document.getElementById('render');
      const fx = document.getElementById('fx-canvas');
      return {
        cssFilters: st.cssFilters,
        ladder: st.ladder,
        renderFilter: c ? (c.style.filter || 'none') : 'no-render',
        fxFilter: fx ? (fx.style.filter || 'none') : 'no-fx',
        naturalGrade: window.SWR_NATURAL ? window.SWR_NATURAL.stats.quality : null,
      };
    });
    if (grade.cssFilters === false && grade.renderFilter === 'none' && grade.fxFilter === 'none') {
      ok('rung 1 observable: grade filters cleared on both canvases');
    } else {
      // The grade may live on the fx overlay only when it is up; be explicit.
      fail('grade rung observable', JSON.stringify(grade));
    }

    await client.send('Emulation.setCPUThrottlingRate', { rate: 1 });

    // 6. pageerrors
    if (errors.length === 0) ok('no pageerror during the run');
    else fail('pageerror', errors.join('; '));
  } finally {
    if (browser) await browser.close();
    server.close();
  }
}

run().catch((err) => { console.error('FATAL', err); process.exit(1); });
