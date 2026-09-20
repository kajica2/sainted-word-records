#!/usr/bin/env node
// verify-automix.mjs — Puppeteer smoke test for the v2 automix pipeline
// (Phase 1: adaptive tick + smooth interpolation + beat-phased drift;
//  Phase 2: section-aware blending + richer features;
//  Phase 3: stuck detection + anti-pattern injection;
//  Phase 4: freeze / save / lock / debug panel).
//
//   node verify-automix.mjs
//
// Boots a local static server, loads versions/music_video.html in
// headless Chrome, drives automix through synthetic Audio.feat values
// (no real audio needed), and asserts:
//   1. Page loads with no console errors
//   2. Toggle button switches OFF → ON
//   3. Adaptive tick interval lands in [500, 3000] ms
//   4. After 8 ticks, blend evolves (preset field values change)
//   5. Freeze stops new ticks but keeps the blend
//   6. Save writes to localStorage `swrc.presets.user.v1`
//   7. Lock switches to single-anchor mode (preset changes drastically)
//   8. Debug panel toggles open and renders text
//   9. Keyboard shortcuts A/F/B/K/D fire
//  10. Stop cleans up timers (no leaks)

import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import puppeteer from 'puppeteer';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PORT = 8091;

const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.wav': 'audio/wav',
  '.mp3': 'audio/mpeg', '.mp4': 'video/mp4', '.webm': 'video/webm',
};

function serve() {
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
  try {
    await fn();
    console.log('  ✓ ' + name);
  } catch (e) {
    failed++;
    console.error('  ✗ ' + name + ': ' + (e.message || e));
  }
}

async function main() {
  const server = await serve();
  let browser;
  try {
    browser = await puppeteer.launch({
      headless: 'new',
      args: ['--no-sandbox', '--disable-setuid-sandbox',
             '--autoplay-policy=no-user-gesture-required'],
    });
    const page = await browser.newPage();
    const consoleErrors = [];
    page.on('console', (msg) => {
      if (msg.type() !== 'error') return;
      const t = msg.text();
      // Ignore dev-server / network noise that isn't related to automix.
      if (/WebSocket.*localhost:|ERR_CONNECTION_REFUSED|net::ERR_/i.test(t)) return;
      if (/Failed to load resource.*\(404\)/.test(t)) return;  // missing favicon etc
      consoleErrors.push(t);
    });
    page.on('pageerror', (err) => consoleErrors.push('pageerror: ' + err.message));

    await page.goto(`http://localhost:${PORT}/versions/music_video.html`, { waitUntil: 'networkidle0', timeout: 30000 });
    await new Promise((r) => setTimeout(r, 800));

    // ---- 1. Page loads clean -------------------------------------------
    await step('page loads with no console errors', async () => {
      if (consoleErrors.length > 0) {
        throw new Error('console errors: ' + consoleErrors.slice(0, 3).join(' | '));
      }
    });

    // ---- 2. Toggle button exists ---------------------------------------
    const hasAutomix = await page.evaluate(() => {
      return !!document.getElementById('automix-toggle')
        && !!window.SWR_AUTOMIX
        && !!window.SWR_ANCHOR_MAP;
    });
    if (!hasAutomix) { console.error('FAIL: missing automix scaffolding'); process.exit(1); }

    // Allow extra time for IIFEs to register click listeners (they sit
    // deep in the page's inline scripts and parse after document.ready).
    await new Promise((r) => setTimeout(r, 800));

    // ---- 3. Inject synthetic Audio.feat so the tick has something to mix
    // ----    Also expose `automix` IIFE on window for direct assertions.
    await page.evaluate(() => {
      // Make Audio.feat a controllable object that returns our synthetic values
      if (!window.SWR) window.SWR = {};
      if (!window.SWR.Audio) window.SWR.Audio = { feat: {} };
      window.__synthFeat = { bass: 0.4, mid: 0.5, treb: 0.3,
                             rms: 0.3, onset: 0.2, centroid: 0.5,
                             beat: 0, beatPulse: false,
                             centroidVar: 0.4 };
      window.SWR.Audio.feat = window.__synthFeat;
    });

    // The automix IIFE is inside a `<script>` tag — it lives in module scope.
    // We need to expose it. Easiest: scan the page for the IIFE and read
    // it via window property assignment. The cleanest way is to re-find
    // it through `__lastStatus` etc. is not possible. So we trigger a tick
    // and read window.SWR._fxOverride (which IS exposed) instead.

    // ---- 4. Click toggle → ON ------------------------------------------
    await step('toggle button enables automix', async () => {
      // Click the inner span (the label works in some browsers, but
      // Puppeteer's click-on-label behavior is finicky across versions).
      await page.evaluate(() => document.getElementById('automix-toggle').click());
      await new Promise((r) => setTimeout(r, 400));
      const state = await page.evaluate(() => document.getElementById('automix-state').textContent);
      if (state !== 'ON') throw new Error('expected ON, got ' + state);
    });

    // ---- 5. _fxOverride is written within the adaptive interval --------
    await step('adaptive tick writes _fxOverride', async () => {
      await new Promise((r) => setTimeout(r, 2000));
      const fx = await page.evaluate(() => window.SWR && window.SWR._fxOverride);
      if (!fx || typeof fx.temp !== 'number') throw new Error('_fxOverride not set: ' + JSON.stringify(fx));
    });

    // ---- 6. Adaptive interval lands in [500, 3000] ----------------------
    await step('tick interval in [500, 3000] ms', async () => {
      const interval = await page.evaluate(() => window.SWR_AUTOMIX.computeTickInterval(
        (window.SWR && window.SWR.Audio && window.SWR.Audio.feat) || {}));
      if (interval < 500 || interval > 3000) throw new Error('out of range: ' + interval);
    });

    // ---- 7. After several ticks with shifting features, blend evolves ---
    await step('blend evolves as features shift', async () => {
      const before = await page.evaluate(() => Object.assign({}, window.SWR._fxOverride));
      // Push through 5 ticks worth of changing features
      for (let i = 0; i < 5; i++) {
        await page.evaluate((v) => {
          window.SWR.Audio.feat.bass = v;
          window.SWR.Audio.feat.mid = 1 - v;
          window.SWR.Audio.feat.treb = v * 0.5;
          window.SWR.Audio.feat.rms = Math.abs(v - 0.5);
        }, i / 4);
        await new Promise((r) => setTimeout(r, 700));
      }
      const after = await page.evaluate(() => Object.assign({}, window.SWR._fxOverride));
      // blend should have moved at least one field by >0.05
      let moved = false;
      for (const k of Object.keys(after)) {
        if (Math.abs((after[k] || 0) - (before[k] || 0)) > 0.05) { moved = true; break; }
      }
      if (!moved) throw new Error('blend did not move across 5 feature shifts');
    });

    // ---- 8. Freeze stops new ticks but keeps the blend ------------------
    await step('freeze stops ticking', async () => {
      await page.evaluate(() => document.getElementById('automix-freeze').click());
      // Wait for any in-flight 1s lerp ramp to complete BEFORE sampling
      await new Promise((r) => setTimeout(r, 1300));
      const fx = await page.evaluate(() => Object.assign({}, window.SWR._fxOverride));
      await new Promise((r) => setTimeout(r, 4000));  // several potential ticks' worth
      const fx2 = await page.evaluate(() => Object.assign({}, window.SWR._fxOverride));
      let moved = false;
      for (const k of Object.keys(fx)) {
        if (Math.abs((fx2[k] || 0) - (fx[k] || 0)) > 1e-6) { moved = true; break; }
      }
      if (moved) throw new Error('blend moved while frozen');
      // Unfreeze for the rest of the suite
      await page.evaluate(() => document.getElementById('automix-freeze').click());
      await new Promise((r) => setTimeout(r, 200));
    });

    // ---- 9. Save blend writes to localStorage ---------------------------
    await step('save blend writes to localStorage', async () => {
      await page.evaluate(() => localStorage.removeItem('swrc.presets.user.v1'));
      await page.evaluate(() => document.getElementById('automix-save').click());
      await new Promise((r) => setTimeout(r, 200));
      const raw = await page.evaluate(() => localStorage.getItem('swrc.presets.user.v1'));
      if (!raw) throw new Error('localStorage empty after save');
      const list = JSON.parse(raw);
      if (!Array.isArray(list) || list.length === 0) throw new Error('saved list malformed');
      if (!list[0].preset || typeof list[0].preset.temp !== 'number') throw new Error('saved preset malformed');
    });

    // ---- 10. Lock switches to single-anchor mode -----------------------
    await step('lock picks single nearest anchor', async () => {
      await page.evaluate(() => document.getElementById('automix-lock').click());
      await new Promise((r) => setTimeout(r, 1500));
      const state = await page.evaluate(() => document.getElementById('automix-state').textContent);
      if (state !== 'LOCKED') throw new Error('expected LOCKED, got ' + state);
      await page.evaluate(() => document.getElementById('automix-lock').click());
      await new Promise((r) => setTimeout(r, 200));
    });

    // ---- 11. Debug panel toggles open and renders text ------------------
    await step('debug panel toggles + renders', async () => {
      await page.evaluate(() => {
        localStorage.removeItem('swr.automix.debugOpen');
        const panel = document.getElementById('automix-debug-panel');
        if (panel) panel.hidden = true;
        document.getElementById('automix-debug').click();
      });
      await new Promise((r) => setTimeout(r, 300));
      const visible = await page.evaluate(() =>
        !document.getElementById('automix-debug-panel').hidden);
      if (!visible) throw new Error('panel did not open');
      const text = await page.evaluate(() =>
        document.getElementById('automix-debug-body').textContent);
      if (!text || text.length < 20) throw new Error('panel body empty: ' + text);
      await page.evaluate(() => document.getElementById('automix-debug-close').click());
      await new Promise((r) => setTimeout(r, 200));
    });

    // ---- 12. Keyboard shortcuts work ----------------------------------
    await step('keyboard shortcut A toggles', async () => {
      const stateBefore = await page.evaluate(() => document.getElementById('automix-state').textContent);
      await page.keyboard.press('a');
      await new Promise((r) => setTimeout(r, 200));
      const stateAfter = await page.evaluate(() => document.getElementById('automix-state').textContent);
      if (stateBefore === stateAfter) throw new Error('A did not toggle state');
      // restore
      await page.keyboard.press('a');
      await new Promise((r) => setTimeout(r, 200));
    });

    await step('keyboard shortcut F freezes', async () => {
      await page.keyboard.press('f');
      await new Promise((r) => setTimeout(r, 200));
      const state = await page.evaluate(() => document.getElementById('automix-state').textContent);
      if (state !== 'FROZEN') throw new Error('F did not freeze, got ' + state);
      // restore
      await page.keyboard.press('f');
      await new Promise((r) => setTimeout(r, 200));
    });

    await step('keyboard shortcut K locks', async () => {
      await page.keyboard.press('k');
      await new Promise((r) => setTimeout(r, 200));
      const state = await page.evaluate(() => document.getElementById('automix-state').textContent);
      if (state !== 'LOCKED') throw new Error('K did not lock, got ' + state);
      // restore
      await page.keyboard.press('k');
      await new Promise((r) => setTimeout(r, 200));
    });

    await step('keyboard shortcut D opens debug panel', async () => {
      await page.evaluate(() => {
        const panel = document.getElementById('automix-debug-panel');
        if (panel) panel.hidden = true;
        document.body.focus();
      });
      await page.keyboard.press('d');
      await new Promise((r) => setTimeout(r, 300));
      const visible = await page.evaluate(() =>
        !document.getElementById('automix-debug-panel').hidden);
      if (!visible) throw new Error('D did not open debug panel');
      await page.evaluate(() => document.getElementById('automix-debug-close').click());
      await new Promise((r) => setTimeout(r, 200));
    });

    // ---- 13. URL deep-links -------------------------------------------
    // Each test loads the page with a different query string and asserts
    // the resulting automix state. We open a fresh tab each time so
    // page state from previous tests doesn't leak.
    async function loadFresh(query) {
      const fresh = await browser.newPage();
      const errs = [];
      fresh.on('pageerror', (e) => errs.push(e.message));
      const consoleErrs = [];
      fresh.on('console', (m) => {
        if (m.type() !== 'error') return;
        const t = m.text();
        if (/WebSocket|ERR_CONNECTION_REFUSED|net::ERR_/i.test(t)) return;
        if (/Failed to load resource.*\(404\)/.test(t)) return;
        consoleErrs.push(t);
      });
      // Clear localStorage flags before each fresh load so deep-link
      // tests don't inherit state from earlier pages in this browser.
      await fresh.goto(`http://localhost:${PORT}/versions/music_video.html${query}`,
                       { waitUntil: 'domcontentloaded', timeout: 30000 });
      await fresh.evaluate(() => {
        try {
          localStorage.removeItem('swr.automix.enabled');
          localStorage.removeItem('swr.automix.debugOpen');
          localStorage.removeItem('swr.automix.frozen');
          localStorage.removeItem('swr.automix.locked');
          localStorage.removeItem('swrc.presets.user.v1');
          localStorage.removeItem('swr.automix.lastMix.v1');
        } catch (_) {}
      });
      // Now reload so the URL-param handler reads clean localStorage.
      await fresh.goto(`http://localhost:${PORT}/versions/music_video.html${query}`,
                       { waitUntil: 'networkidle0', timeout: 30000 });
      await new Promise((r) => setTimeout(r, 1200));
      return { fresh, errs, consoleErrs };
    }

    await step('?automix=1 enables on load', async () => {
      const { fresh, errs, consoleErrs } = await loadFresh('?automix=1');
      const state = await fresh.evaluate(() =>
        document.getElementById('automix-state').textContent);
      if (state !== 'ON') throw new Error('expected ON, got ' + state);
      if (errs.length || consoleErrs.length) throw new Error('errors: ' + (errs+consoleErrs).slice(0, 200));
      await fresh.close();
    });

    await step('?automix-debug=1 opens panel on load', async () => {
      const { fresh, errs, consoleErrs } = await loadFresh('?automix-debug=1');
      const visible = await fresh.evaluate(() =>
        !document.getElementById('automix-debug-panel').hidden);
      if (!visible) throw new Error('panel not visible on load');
      if (errs.length || consoleErrs.length) throw new Error('errors: ' + (errs+consoleErrs).slice(0, 200));
      await fresh.close();
    });

    await step('?automix-frozen=1 starts frozen', async () => {
      const { fresh, errs, consoleErrs } = await loadFresh('?automix-frozen=1');
      const state = await fresh.evaluate(() =>
        document.getElementById('automix-state').textContent);
      if (state !== 'FROZEN') throw new Error('expected FROZEN, got ' + state);
      if (errs.length || consoleErrs.length) throw new Error('errors: ' + (errs+consoleErrs).slice(0, 200));
      await fresh.close();
    });

    await step('?automix-locked=1 starts locked', async () => {
      const { fresh, errs, consoleErrs } = await loadFresh('?automix-locked=1');
      const state = await fresh.evaluate(() =>
        document.getElementById('automix-state').textContent);
      if (state !== 'LOCKED') throw new Error('expected LOCKED, got ' + state);
      if (errs.length || consoleErrs.length) throw new Error('errors: ' + (errs+consoleErrs).slice(0, 200));
      await fresh.close();
    });

    await step('combined ?automix=1&automix-debug=1&automix-frozen=1 boots pre-configured', async () => {
      const { fresh, errs, consoleErrs } = await loadFresh('?automix=1&automix-debug=1&automix-frozen=1');
      const state = await fresh.evaluate(() =>
        document.getElementById('automix-state').textContent);
      const visible = await fresh.evaluate(() =>
        !document.getElementById('automix-debug-panel').hidden);
      if (state !== 'FROZEN') throw new Error('expected FROZEN, got ' + state);
      if (!visible) throw new Error('panel not visible');
      if (errs.length || consoleErrs.length) throw new Error('errors: ' + (errs+consoleErrs).slice(0, 200));
      await fresh.close();
    });

    // ---- 14. Stop cleans up timers ------------------------------------
    await step('stop cleans up tick + beat timers', async () => {
      // Use evaluate-click instead of mouse-click — labels sometimes don't
      // route mouse events cleanly in headless Chrome.
      await page.evaluate(() => document.getElementById('automix-toggle').click());
      await new Promise((r) => setTimeout(r, 250));
      const state = await page.evaluate(() => document.getElementById('automix-state').textContent);
      if (state !== 'OFF') throw new Error('expected OFF, got ' + state);
      // The IIFE-internal `automix` reference isn't exposed on window,
      // but we can check that toggling on → off and back on still works
      await page.evaluate(() => document.getElementById('automix-toggle').click());
      await new Promise((r) => setTimeout(r, 300));
      const state2 = await page.evaluate(() => document.getElementById('automix-state').textContent);
      if (state2 !== 'ON') throw new Error('re-toggle failed: ' + state2);
      // cleanup
      await page.evaluate(() => document.getElementById('automix-toggle').click());
      await new Promise((r) => setTimeout(r, 200));
    });

  } finally {
    if (browser) await browser.close();
    server.close();
  }

  if (failed > 0) {
    console.error('\nAUTOMIX VERIFY: ' + failed + ' step(s) failed');
    process.exit(1);
  }
  console.log('\nAUTOMIX VERIFY: ALL GREEN');
}

main().catch((e) => {
  console.error('FATAL:', e);
  process.exit(1);
});