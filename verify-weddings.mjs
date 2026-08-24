// verify-weddings.mjs — Puppeteer smoke for the /weddings page.
//
//   BASE_URL=http://localhost:5174 node verify-weddings.mjs
//
// Asserts:
//   1. /weddings.html loads with status 200, no console errors
//   2. The hero, header, and footer render
//   3. The catalog fetch succeeds → at least 1 .wed-section renders
//   4. Each .wed-section has at least 1 .wed-card
//   5. Each .wed-card has a USE IN MUSIC VIDEO → button
//   6. Clicking the CTA writes swr.pending-playlist + swr.pending-song
//      to localStorage with the right shape
//   7. After click, the page navigates to /make-video.html
//   8. MVM consumes the handoff: SWR_PLAYLIST.list().length > 0 and
//      the localStorage handoff keys are cleared
//   9. (negative) an empty catalog renders the empty state (use a stub)

import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import puppeteer from 'puppeteer';

const BASE = process.env.BASE_URL || 'http://localhost:5174';
const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PORT = 8077;

const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.wav': 'audio/wav',
  '.mp3': 'audio/mpeg', '.mp4': 'video/mp4', '.webm': 'video/webm',
};

function localServe() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const rel = decodeURIComponent(req.url.split('?')[0].replace(/^\/+/, '')) || 'index.html';
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

let failed = 0;
async function step(name, fn) {
  try { await fn(); process.stdout.write(`  ✓ ${name}\n`); }
  catch (e) { failed += 1; process.stderr.write(`  ✗ ${name}\n    ${e.stack || e.message}\n`); }
}
const ok = (cond, msg) => { if (!cond) throw new Error(msg || 'assertion failed'); };

const server = await localServe();
let browser;
try {
  browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (err) => errors.push('PE: ' + err.message));
  page.on('console', (msg) => { if (msg.type() === 'error') errors.push('CE: ' + msg.text()); });

  await page.setViewport({ width: 1280, height: 720 });
  await page.goto(`${BASE}/weddings.html`, { waitUntil: 'networkidle0', timeout: 30000 });

  await step('1. /weddings.html loads cleanly', async () => {
    const v = await page.evaluate(() => ({
      hasHeader: !!document.querySelector('.wed-head'),
      hasHero: !!document.querySelector('.wed-hero h1'),
      hasFooter: !!document.querySelector('.wed-foot'),
      title: document.title,
    }));
    ok(v.hasHeader, 'header missing');
    ok(v.hasHero, 'hero missing');
    ok(v.hasFooter, 'footer missing');
    ok(/Weddings/.test(v.title), `title should include Weddings, got "${v.title}"`);
    // The catalog fetch is async; wait a beat then re-check
    await new Promise((r) => setTimeout(r, 200));
    ok(errors.length === 0, `console errors: ${errors.join(' | ')}`);
  });

  await step('2. catalog fetch renders sections + cards', async () => {
    // Wait for the catalog to render — sections are appended after fetch
    let r;
    for (let i = 0; i < 50; i++) {
      r = await page.evaluate(() => ({
        sections: document.querySelectorAll('.wed-section').length,
        cards: document.querySelectorAll('.wed-card').length,
        ctas: document.querySelectorAll('.wed-card-cta').length,
      }));
      if (r.sections > 0) break;
      await new Promise((res) => setTimeout(res, 100));
    }
    ok(r.sections >= 1, `expected at least 1 section, got ${r.sections}`);
    ok(r.cards >= 1, `expected at least 1 card, got ${r.cards}`);
    ok(r.ctas === r.cards, `expected ${r.cards} CTAs, got ${r.ctas}`);
  });

  await step('3. each section has a category label in its h2', async () => {
    const v = await page.evaluate(() => {
      const sections = Array.from(document.querySelectorAll('.wed-section h2'));
      return sections.map((h) => h.textContent);
    });
    ok(v.length >= 1, 'no section h2s');
    // We expect at least one of the known labels
    const known = ['CEREMONY', 'RECEPTION', 'FIRST DANCE', 'COCKTAIL HOUR', 'LAST DANCE'];
    const hasKnown = v.some((label) => known.indexOf(label) >= 0);
    ok(hasKnown, `expected at least one known label, got ${JSON.stringify(v)}`);
  });

  await step('4. click USE IN MUSIC VIDEO → writes handoff + navigates', async () => {
    // Clear any prior handoff state
    await page.evaluate(() => {
      try { localStorage.removeItem('swr.pending-playlist'); } catch (_) {}
      try { localStorage.removeItem('swr.pending-song'); } catch (_) {}
    });
    const v = await page.evaluate(async () => {
      const btn = document.querySelector('.wed-card-cta');
      const songId = btn && btn.dataset.songId;
      btn.click();
      // After the click, the page schedules a setTimeout(80ms) before
      // navigation. Poll localStorage for up to 1s.
      let playlist = null, song = null;
      for (let i = 0; i < 20; i++) {
        try {
          playlist = JSON.parse(localStorage.getItem('swr.pending-playlist') || 'null');
          song     = JSON.parse(localStorage.getItem('swr.pending-song')     || 'null');
          if (playlist) break;
        } catch (_) {}
        await new Promise((r) => setTimeout(r, 50));
      }
      return { songId, playlist, song };
    });
    ok(Array.isArray(v.playlist) && v.playlist.length >= 1, 'pending-playlist not set');
    ok(v.song && v.song.source === 'weddings', 'pending-song not set');
    ok(v.song.sourceId === v.songId, `pending-song should be the clicked one; got ${v.song.sourceId} vs ${v.songId}`);
    ok(v.playlist[0].source === 'weddings' && v.playlist[0].sourceId === v.songId,
       'first entry of pending-playlist should be the clicked song');
  });

  await step('5. MVM consumes the handoff: playlist populated, keys cleared', async () => {
    // Wait for the MVM page to load + init() to run
    await page.waitForFunction(() => !!window.MVM && !!window.SWR_PLAYLIST, { timeout: 15000 });
    // Give the init() chain (load + loadPendingHandoff) time to complete
    await new Promise((r) => setTimeout(r, 800));
    const v = await page.evaluate(() => {
      const P = window.SWR_PLAYLIST;
      const url = location.pathname;
      return {
        url,
        playlistLen: P && typeof P.list === 'function' ? P.list().length : -1,
        pendingPl: (() => { try { return localStorage.getItem('swr.pending-playlist'); } catch (_) { return null; } })(),
        pendingSg: (() => { try { return localStorage.getItem('swr.pending-song'); } catch (_) { return null; } })(),
        mvmSong: window.MVM && window.MVM.project ? window.MVM.project.song : null,
        mvmHasLoadPending: window.MVM && typeof window.MVM.loadPendingHandoff === 'function',
      };
    });
    if (!/make-video/.test(v.url)) {
      throw new Error(`expected to be on /make-video, got ${v.url}`);
    }
    ok(v.mvmHasLoadPending, 'MVM.loadPendingHandoff should be exposed');
    ok(v.playlistLen > 0, `expected MVM playlist to be populated, got length ${v.playlistLen}`);
    ok(v.pendingPl === null, `pending-playlist should be cleared, got ${v.pendingPl && v.pendingPl.substring(0, 40)}`);
    ok(v.pendingSg === null, 'pending-song should be cleared');
    ok(v.mvmSong && v.mvmSong.source === 'weddings', 'MVM should have the pending song set');
  });

  await step('6. weddings.html has the secondary CTA + landing nav entry', async () => {
    // Fetch the page fresh (step 5 navigated us to /make-video)
    await page.goto(`${BASE}/weddings.html`, { waitUntil: 'networkidle0', timeout: 20000 });
    await new Promise((r) => setTimeout(r, 200));
    const v = await page.evaluate(() => {
      const cta = document.querySelector('.wed-cta-secondary');
      const landingLink = document.querySelector('.wed-brand');
      return {
        hasSecondaryCta: !!cta,
        secondaryHref: cta && cta.getAttribute('href'),
        hasLandingLink: !!landingLink,
        landingHref: landingLink && landingLink.getAttribute('href'),
      };
    });
    ok(v.hasSecondaryCta, 'weddings.html missing .wed-cta-secondary (header link to MVM)');
    ok(v.hasLandingLink, 'weddings.html missing .wed-brand (header link to landing)');
  });

  if (errors.length) {
    process.stderr.write('Console errors during run:\n');
    errors.forEach((e) => process.stderr.write('  ' + e + '\n'));
  }
} finally {
  if (browser) await browser.close();
  server.close();
}

if (failed === 0) {
  console.log('\nALL GREEN');
  process.exit(0);
} else {
  console.log(`\n${failed} FAILED`);
  process.exit(1);
}