#!/usr/bin/env node
// verify-bachdrop.mjs — smoke test for the Bachdrop engine + gallery.
//
// Checks (against the local dist/ static serve on port 5184 by default):
//   1. /versions/bachdrop.html returns 200 + loads bachdrop.mp3 (200)
//   2. /gallery-bachdrop.html returns 200 + has 8 .gallery-card nodes
//      (1 featured + 7 standard) + the shop-decorator script tag is wired
//   3. The engine IIFE exposes window.SWR.Audio.{load,play,pause,sample}
//      and window.SWR.Recorder.{start,stop,_save}
//   4. The DOM has the four voice-strip rows (soprano/alt/tenor/bass)
//      + the sens/gate/decay/voices/tempo sliders + the rec button
//   5. The paint loop actually runs (requestAnimationFrame fires) and
//      the canvas gets non-black pixels (counterpoint engine alive)
//   6. The auto-start overlay (#swr-start) is present and removable
//
// Usage:
//   node verify-bachdrop.mjs
//   FX_VERIFIER_PORT=5184 node verify-bachdrop.mjs
//   FX_VERIFIER_PORT=5184 verify-bachdrop.mjs

import puppeteer from 'puppeteer';
import http from 'node:http';
import { spawn } from 'node:child_process';

const PORT = parseInt(process.env.FX_VERIFIER_PORT || '5184', 10);
const BASE = `http://127.0.0.1:${PORT}`;
const ENGINE_URL = `${BASE}/versions/bachdrop.html`;
const GALLERY_URL = `${BASE}/gallery-bachdrop.html`;
const AUDIO_URL = `${BASE}/audios/bachdrop.mp3`;

const checks = [];
const pass = (m) => { checks.push({ ok: true, m }); console.log('✓', m); };
const fail = (m) => { checks.push({ ok: false, m }); console.log('✗', m); };

function startServer() {
  return new Promise((resolve, reject) => {
    const proc = spawn('python3', ['-m', 'http.server', String(PORT)], {
      cwd: process.cwd() + '/dist',
      stdio: 'ignore',
      detached: false,
    });
    proc.on('error', reject);
    // Probe for readiness.
    const start = Date.now();
    const tick = () => {
      http.get(`${BASE}/versions/bachdrop.html`, (res) => {
        res.resume();
        if (res.statusCode === 200) return resolve(proc);
        if (Date.now() - start > 8000) return reject(new Error('server never returned 200'));
        setTimeout(tick, 100);
      }).on('error', () => {
        if (Date.now() - start > 8000) return reject(new Error('server never came up'));
        setTimeout(tick, 80);
      });
    };
    setTimeout(tick, 100);
  });
}

function stopServer(proc) {
  try { proc.kill('SIGTERM'); } catch (_) {}
  try { process.kill(proc.pid, 'SIGTERM'); } catch (_) {}
}

function fetchStatus(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      res.resume();
      resolve(res.statusCode);
    }).on('error', reject);
  });
}

(async () => {
  let server = null;
  try {
    server = await startServer();
  } catch (e) {
    fail(`could not start static server on port ${PORT}: ${e.message}`);
    process.exit(1);
  }

  try {
    // 1) Engine HTTP + audio asset.
    const engineStatus = await fetchStatus(ENGINE_URL);
    if (engineStatus === 200) pass('engine returns 200');
    else fail(`engine returns ${engineStatus}`);

    const audioStatus = await fetchStatus(AUDIO_URL);
    if (audioStatus === 200) pass('bachdrop.mp3 returns 200');
    else fail(`bachdrop.mp3 returns ${audioStatus}`);

    // 2) Gallery HTTP + scaffold.
    const galleryStatus = await fetchStatus(GALLERY_URL);
    if (galleryStatus === 200) pass('gallery returns 200');
    else fail(`gallery returns ${galleryStatus}`);

    const browser = await puppeteer.launch({
      headless: 'new',
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
    });

    try {
      // === Engine page ===
      const page = await browser.newPage();
      const consoleErrors = [];
      page.on('pageerror', (err) => consoleErrors.push('pageerror: ' + err.message));
      page.on('console', (msg) => {
        if (msg.type() === 'error') consoleErrors.push('console.error: ' + msg.text());
      });

      await page.goto(ENGINE_URL, { waitUntil: 'load', timeout: 15000 });
      // Wait for the IIFE to attach window.SWR.Audio.
      await page.waitForFunction(() => window.SWR && window.SWR.Audio && typeof window.SWR.Audio.load === 'function', { timeout: 5000 })
        .catch(() => {});

      const audioApi = await page.evaluate(() => {
        const a = window.SWR && window.SWR.Audio;
        if (!a) return null;
        return {
          hasLoad: typeof a.load === 'function',
          hasPlay: typeof a.play === 'function',
          hasPause: typeof a.pause === 'function',
          hasSample: typeof a.sample === 'function',
          hasFeat: !!(a.feat && typeof a.feat === 'object'),
          hasVoice: !!(a.voice && typeof a.voice === 'object'),
          hasParams: !!(a.params && typeof a.params === 'object'),
        };
      });
      if (audioApi && audioApi.hasLoad && audioApi.hasPlay && audioApi.hasPause && audioApi.hasSample && audioApi.hasFeat && audioApi.hasVoice && audioApi.hasParams) {
        pass('SWR.Audio exposes load/play/pause/sample/feat/voice/params');
      } else {
        fail('SWR.Audio surface incomplete: ' + JSON.stringify(audioApi));
      }

      const recorderApi = await page.evaluate(() => {
        const r = window.SWR && window.SWR.Recorder;
        if (!r) return null;
        return { hasStart: typeof r.start === 'function', hasStop: typeof r.stop === 'function', hasSave: typeof r._save === 'function' };
      });
      if (recorderApi && recorderApi.hasStart && recorderApi.hasStop && recorderApi.hasSave) {
        pass('SWR.Recorder exposes start/stop/_save');
      } else {
        fail('SWR.Recorder surface incomplete: ' + JSON.stringify(recorderApi));
      }

      // 4) DOM nodes.
      const dom = await page.evaluate(() => ({
        voiceRows: document.querySelectorAll('.voice-strip .row').length,
        sliders: ['sens','gate','decay','voices','tempo'].filter((id) => !!document.getElementById(id)).length,
        recBtn: !!document.getElementById('rec'),
        startOverlay: !!document.getElementById('swr-start'),
        playBtn: !!document.getElementById('play'),
        ornaments: document.querySelectorAll('.ornament').length,
        canvas: !!document.getElementById('render'),
      }));
      if (dom.voiceRows === 4) pass('voice-strip has 4 rows (soprano/alt/tenor/bass)');
      else fail(`voice-strip has ${dom.voiceRows} rows (want 4)`);
      if (dom.sliders === 5) pass('all 5 sliders present (sens/gate/decay/voices/tempo)');
      else fail(`only ${dom.sliders}/5 sliders present`);
      if (dom.recBtn) pass('rec button present');
      else fail('rec button missing');
      if (dom.startOverlay) pass('auto-start overlay present');
      else fail('auto-start overlay missing');
      if (dom.playBtn) pass('play button present');
      else fail('play button missing');
      if (dom.ornaments === 4) pass('4 corner ornaments rendered');
      else fail(`ornaments count = ${dom.ornaments} (want 4)`);
      if (dom.canvas) pass('render canvas present');
      else fail('render canvas missing');

      // 5) Paint loop alive — give it ~500ms then check canvas pixel diversity.
      await new Promise((r) => setTimeout(r, 700));
      const canvasSample = await page.evaluate(() => {
        const c = document.getElementById('render');
        if (!c) return null;
        const cx = c.getContext('2d');
        // Read a 40x25 downsampled region of the centre of the canvas.
        const sw = 40, sh = 25;
        const tmp = document.createElement('canvas');
        tmp.width = sw; tmp.height = sh;
        const tcx = tmp.getContext('2d');
        tcx.drawImage(c, c.width / 2 - sw * 4, c.height / 2 - sh * 4, sw * 8, sh * 8, 0, 0, sw, sh);
        const d = tcx.getImageData(0, 0, sw, sh).data;
        const colors = new Map();
        let goldish = 0;
        for (let i = 0; i < d.length; i += 4) {
          const r = d[i], g = d[i+1], b = d[i+2];
          // Quick "is gold-ish" check: r > g > b, warm palette.
          if (r > 50 && r > b * 1.3 && g >= b && r - b > 20) goldish++;
          const k = `${r>>4},${g>>4},${b>>4}`;
          colors.set(k, (colors.get(k) || 0) + 1);
        }
        return { distinctColors: colors.size, goldPixels: goldish, totalSamples: (d.length / 4) };
      });
      if (canvasSample && canvasSample.distinctColors >= 6) {
        pass(`paint loop alive — ${canvasSample.distinctColors} distinct color buckets in centre`);
      } else {
        fail(`paint loop may be dead — only ${canvasSample ? canvasSample.distinctColors : '?'} color buckets (want 6+)`);
      }
      if (canvasSample && canvasSample.goldPixels >= 5) {
        pass(`gold palette visible (${canvasSample.goldPixels} warm pixels in 1000-sample window)`);
      } else {
        fail(`no gold palette visible (${canvasSample ? canvasSample.goldPixels : '?'} warm pixels)`);
      }

      if (consoleErrors.length === 0) {
        pass('no JS errors on engine page');
      } else {
        fail('JS errors: ' + consoleErrors.slice(0, 3).join(' | '));
      }

      await page.close();

      // === Gallery page ===
      const gpage = await browser.newPage();
      const gErrors = [];
      gpage.on('pageerror', (err) => gErrors.push('pageerror: ' + err.message));
      gpage.on('console', (msg) => {
        if (msg.type() === 'error') gErrors.push('console.error: ' + msg.text());
      });

      await gpage.goto(GALLERY_URL, { waitUntil: 'load', timeout: 15000 });
      const galleryDom = await gpage.evaluate(() => ({
        cards: document.querySelectorAll('.gallery-card').length,
        featured: document.querySelectorAll('.gallery-card--featured').length,
        standardCards: document.querySelectorAll('.gallery-card:not(.gallery-card--featured)').length,
        nav: !!document.querySelector('.nav'),
        hero: !!document.querySelector('.hero__title'),
        footer: !!document.querySelector('.footer'),
        shopDecorator: Array.from(document.scripts).some((s) => s.src.includes('shop-decorator')),
      }));
      if (galleryDom.cards === 8) pass('gallery has 8 cards (1 featured + 7 standard)');
      else fail(`gallery has ${galleryDom.cards} cards (want 8)`);
      if (galleryDom.featured === 1) pass('gallery has 1 featured card');
      else fail(`featured count = ${galleryDom.featured} (want 1)`);
      if (galleryDom.standardCards === 7) pass('gallery has 7 standard cards');
      else fail(`standard count = ${galleryDom.standardCards} (want 7)`);
      if (galleryDom.nav && galleryDom.hero && galleryDom.footer) pass('nav + hero + footer all present');
      else fail(`nav=${galleryDom.nav} hero=${galleryDom.hero} footer=${galleryDom.footer}`);
      if (galleryDom.shopDecorator) pass('shop-decorator wired (Buy-on-tee-or-cup enabled)');
      else fail('shop-decorator missing — gallery cards won\'t get Buy CTAs');

      // Hero copy is Bachdrop + BWV-themed.
      const heroTitle = await gpage.$eval('.hero__title', (el) => el.textContent.trim());
      if (/Bachdrop/i.test(heroTitle) && /BWV|Counterpoint|Bach/i.test(heroTitle)) {
        pass('hero title is Bach-themed: ' + heroTitle.replace(/\s+/g, ' ').slice(0, 80));
      } else {
        fail('hero title missing Bach reference: ' + heroTitle);
      }

      if (gErrors.length === 0) pass('no JS errors on gallery page');
      else fail('gallery JS errors: ' + gErrors.slice(0, 3).join(' | '));

      await gpage.close();
      await browser.close();
    } catch (e) {
      fail('puppeteer crashed: ' + e.message);
    }
  } finally {
    if (server) stopServer(server);
  }

  const passed = checks.filter((c) => c.ok).length;
  const failed = checks.length - passed;
  console.log('');
  console.log('────────────────');
  console.log(`Bachdrop smoke: ${passed}/${checks.length} checks passed`);
  if (failed > 0) {
    console.log(`FAILED — ${failed} check(s) did not pass.`);
    process.exit(1);
  }
  console.log('OK');
  process.exit(0);
})();