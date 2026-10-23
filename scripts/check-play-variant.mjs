#!/usr/bin/env node
// scripts/check-play-variant.mjs — /play deep-link variant browser smoke.
//
// Boots versions/play.html on a static file server and asserts the three
// URL-param modes are wired end-to-end:
//
//   1. The page loads, the engine boots, window.Audio/Library/Layers exist.
//   2. window.Play is installed by the variant wrapper and its snapshot
//      reflects the URL (?video / ?loop / ?photo_slide).
//   3. Conflict resolution: ?photo_slide wins over ?video for the
//      asset-surface (per the variant spec).
//   4. The ?diag=1 JSON dump carries playParams — the headless-verifier
//      surface other suites read.
//   5. The toolbar pills carry aria-pressed (a11y) and mirror the URL.
//   6. With no params, the wrapper is a complete no-op: all flags false,
//      all pills aria-pressed="false", and the engine behaves normally.
//
// Run: node scripts/check-play-variant.mjs
// Exit 0 on full pass, 1 otherwise.

import puppeteer from 'puppeteer';
import http from 'node:http';
import https from 'node:https';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const PORT = 53961;
const LOCAL_BASE = `http://127.0.0.1:${PORT}`;
const BASE = process.env.PLAY_BASE_URL || LOCAL_BASE;

// PLAY_BASE_URL points the suite at an already-deployed instance instead of
// spinning up a local server — e.g. to verify a real Vercel deployment:
//   PLAY_BASE_URL=https://sainted-word-records.vercel.app node scripts/check-play-variant.mjs
const EXTERNAL_BASE = process.env.PLAY_BASE_URL || null;

// Serve the BUILT output when it exists, so the page runs against exactly
// what production serves — including build-time copies like
// versions/layer-scheduler.worker.js, which only exist in dist/. Fall back
// to the source tree when dist/ is absent (fresh clone, no build yet).
const DIST = path.resolve('dist');
const SERVE_ROOT = fs.existsSync(path.join(DIST, 'versions', 'play.html'))
  ? DIST : process.cwd();

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.mp3': 'audio/mpeg',
  '.mp4': 'video/mp4',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
};

function startServer() {
  return new Promise((resolve, reject) => {
    const proc = spawn('python3', ['-m', 'http.server', String(PORT)], {
      cwd: SERVE_ROOT, stdio: 'ignore',
    });
    const start = Date.now();
    const tick = () => http.get(`${BASE}/versions/play.html`, (res) => {
      res.resume();
      if (res.statusCode === 200) return resolve(proc);
      if (Date.now() - start > 8000) return reject(new Error('server timeout'));
      setTimeout(tick, 100);
    }).on('error', () => {
      if (Date.now() - start > 8000) return reject(new Error('server error'));
      setTimeout(tick, 80);
    });
    setTimeout(tick, 100);
  });
}

const checks = [];
const pass = (m, d) => { checks.push({ ok: true, m, d }); console.log('✓', m, d ? `(${d})` : ''); };
const fail = (m, d) => { checks.push({ ok: false, m, d }); console.log('✗', m, d ? `(${d})` : ''); };

// The engine boots a lot of async work (library seed, media, onboarding).
// Wait for the specific globals we assert on rather than a fixed sleep.
// 40s: the engine is a 400KB page that boots ~96 modules; on a loaded CI
// runner this can legitimately take 10-20s.
async function waitForPlay(page, timeout = 40000) {
  // Wait for ALL of them, not just window.Play. The wrapper installs
  // window.Play from an inline script, but window.Audio / window.Library /
  // window.Layers are published by DEFERRED module scripts that land
  // afterwards. Checking the engine globals the instant window.Play appears
  // is a race — it passed locally only because the local server was slower
  // to deliver the module graph. On a CDN-backed deployment the modules
  // often win the race, and the assertion failed on window.Library /
  // window.Layers.
  //
  // This is also the honest precondition: the ?photo_slide mode wraps
  // window.Layers.autoMap and reads window.Library.items, so the engine
  // globals genuinely must be present before any /play assertion is valid.
  await page.waitForFunction(
    () => !!(window.Play && typeof window.Play.snapshot === 'function')
      && typeof window.Audio !== 'undefined'
      && typeof window.Library !== 'undefined'
      && typeof window.Layers !== 'undefined',
    { timeout },
  );
}

(async () => {
  console.log(`play-variant smoke → ${BASE}`);
  let server;
  if (!EXTERNAL_BASE) {
    try { server = await startServer(); }
    catch (e) { fail('server boot', e.message); process.exit(1); }
  }

  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage',
      '--autoplay-policy=no-user-gesture-required',
      // Chrome uses its own NSS trust store, not the system one, so it
      // rejects certificates the sandbox CA signs. This is a test harness
      // talking to a public deployment — the browser in front of a real
      // user validates the cert normally.
      ...(EXTERNAL_BASE ? ['--ignore-certificate-errors'] : [])],
  });

  // The engine page is large and boots ~96 modules; under CPU contention
  // (CI runners, repeated local runs) a navigation or boot can exceed the
  // default budget and surface as ERR_ABORTED / a wait timeout. Neither is
  // a /play defect, so the whole assertion pass is retried once from a
  // fresh page. A genuine defect fails both attempts.
  const MAX_ATTEMPTS = 2;
  let lastErr = null;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    checks.length = 0; // discard partial results from a failed attempt
    try {
      const page = await browser.newPage();
      await page.setViewport({ width: 1440, height: 900 });

    // ---- deterministic boot ------------------------------------------------
    // lib/app-version-bust.js hard-reloads the page when the stored app
    // version differs from the current one. On a fresh browser profile there
    // is no stored version, so the page reloads up to 3x (the bust's own
    // loop-protection ceiling) before it finally settles — and each reload
    // destroys the execution context, which aborts an in-flight assertion.
    //
    // That made this suite ~30% flaky for reasons unrelated to /play. Seed
    // the stored version so the bust takes its fast path, exactly as it does
    // for a returning user. Read the real value from the served file rather
    // than hard-coding it, so this keeps working against dist/ as well.
    const appVersion = await new Promise((resolve) => {
      const client = BASE.startsWith('https:') ? https : http;
      client.get(`${BASE}/lib/app-version.js`, (res) => {
        let b = '';
        res.on('data', (c) => { b += c; });
        res.on('end', () => {
          const m = /SWR_APP_VERSION\s*=\s*['"]([^'"]+)['"]/.exec(b);
          resolve(m ? m[1] : 'dev');
        });
      }).on('error', () => resolve('dev'));
    });
    await page.evaluateOnNewDocument((v) => {
      try { localStorage.setItem('swr_app_version_seen', v); } catch (_) {}
    }, appVersion);

    // Block every off-origin request. The default library pulls demo images
    // from an external CDN; in a sandbox those fail TLS verification, and the
    // engine's retry path then re-navigates the page, which destroys the
    // execution context mid-assertion and makes the suite flaky. Blocking
    // them keeps the run deterministic — none of the /play assertions depend
    // on remote images.
    await page.setRequestInterception(true);
    page.on('request', (req) => {
      const u = req.url();
      if (u.startsWith(BASE) || u.startsWith('data:') || u.startsWith('blob:')) {
        return req.continue();
      }
      return req.abort();
    });

    // Three separate error channels, because they mean different things:
    //   pageErrs — real JS exceptions. Always a failure.
    //   missing  — 404 responses. A failure UNLESS the URL is one of the
    //               resources that legitimately cannot exist in a static
    //               source-tree server (see ABSENT_OK below).
    //   consoleErrs — everything else the page complains about.
    const pageErrs = [];
    const missing = [];
    const consoleErrs = [];
    page.on('pageerror', (e) => pageErrs.push('pageerror: ' + e.message));
    page.on('response', (r) => {
      if (r.status() === 404) missing.push(r.url());
    });
    page.on('console', (m) => {
      if (m.type() !== 'error') return;
      const t = m.text();
      if (/ERR_CERT_AUTHORITY_INVALID/i.test(t)) return; // sandbox CA store, not deployed
      if (/Failed to load resource/i.test(t)) return;     // covered by the `missing` channel
      consoleErrs.push('console.error: ' + t);
    });

    // ---- 1. all three modes on -----------------------------------------
    await page.goto(`${BASE}/versions/play.html?video&loop&photo_slide`, { waitUntil: 'domcontentloaded' });
    await waitForPlay(page);

    const globals = await page.evaluate(() => ({
      audio: typeof window.Audio !== 'undefined',
      library: typeof window.Library !== 'undefined',
      layers: typeof window.Layers !== 'undefined',
      play: typeof window.Play !== 'undefined',
    }));
    globals.audio && globals.library && globals.layers
      ? pass('engine globals present (Audio/Library/Layers)')
      : fail('engine globals present (Audio/Library/Layers)', JSON.stringify(globals));
    globals.play
      ? pass('window.Play installed by the variant wrapper')
      : fail('window.Play installed by the variant wrapper');

    const snap = await page.evaluate(() => window.Play.snapshot());
    const p = snap.playParams || {};
    (p.video === true && p.loop === true && p.photo_slide === true)
      ? pass('snapshot().playParams reflects the URL', JSON.stringify(p))
      : fail('snapshot().playParams reflects the URL', JSON.stringify(p));

    // ---- 2. conflict resolution ----------------------------------------
    // ?photo_slide wins over ?video for the asset-surface (variant spec).
    const eff = snap.playEffective || {};
    (eff.video === false)
      ? pass('conflict resolution: ?photo_slide wins over ?video', `effectiveVideo=${eff.video}`)
      : fail('conflict resolution: ?photo_slide wins over ?video', JSON.stringify(eff));

    // ---- 3. the ?diag=1 surface carries playParams ----------------------
    await page.goto(`${BASE}/versions/play.html?diag=1&video&loop&photo_slide`, { waitUntil: 'domcontentloaded' });
    await waitForPlay(page);
    await new Promise((r) => setTimeout(r, 1200)); // let the diag dump settle
    const diag = await page.evaluate(() => {
      const el = document.getElementById('diag-out');
      if (!el) return null;
      // The engine writes the dump as:
      //   === DIAG (label) ===
      //   { ...json... }
      //   === END ===
      // so extract the JSON between the markers before parsing.
      const m = /=== DIAG \([^)]*\) ===\s*([\s\S]*?)\s*=== END ===/.exec(el.textContent);
      if (!m) return { __unparsed: el.textContent.slice(0, 200) };
      try { return JSON.parse(m[1]); } catch (_) { return { __unparsed: m[1].slice(0, 200) }; }
    });
    (diag && diag.playParams && diag.playParams.video === true)
      ? pass('?diag=1 dump carries playParams')
      : fail('?diag=1 dump carries playParams', JSON.stringify(diag && diag.playParams));

    // ---- 4. a11y: pills mirror the URL via aria-pressed -----------------
    await page.goto(`${BASE}/versions/play.html?video&loop&photo_slide`, { waitUntil: 'domcontentloaded' });
    await waitForPlay(page);
    const pressed = await page.evaluate(() => ({
      video: document.getElementById('pm-video')?.getAttribute('aria-pressed'),
      loop: document.getElementById('pm-loop')?.getAttribute('aria-pressed'),
      photo: document.getElementById('pm-photo')?.getAttribute('aria-pressed'),
      toolbar: !!document.getElementById('play-modes'),
    }));
    pressed.toolbar
      ? pass('play toolbar rendered (#play-modes)')
      : fail('play toolbar rendered (#play-modes)');
    (pressed.video === 'true' && pressed.loop === 'true' && pressed.photo === 'true')
      ? pass('param pills carry aria-pressed="true" (a11y)')
      : fail('param pills carry aria-pressed="true" (a11y)', JSON.stringify(pressed));

    // ---- 5. no-params → complete no-op ----------------------------------
    await page.goto(`${BASE}/versions/play.html`, { waitUntil: 'domcontentloaded' });
    await waitForPlay(page);
    const bare = await page.evaluate(() => ({
      params: window.Play.snapshot().playParams,
      video: document.getElementById('pm-video')?.getAttribute('aria-pressed'),
      loop: document.getElementById('pm-loop')?.getAttribute('aria-pressed'),
      photo: document.getElementById('pm-photo')?.getAttribute('aria-pressed'),
    }));
    const allFalse = (k) => bare.params[k] === false;
    (allFalse('video') && allFalse('loop') && allFalse('photo_slide'))
      ? pass('no-params URL → all flags false (wrapper is a no-op)')
      : fail('no-params URL → all flags false (wrapper is a no-op)', JSON.stringify(bare.params));
    (bare.video === 'false' && bare.loop === 'false' && bare.photo === 'false')
      ? pass('no-params URL → all pills aria-pressed="false"')
      : fail('no-params URL → all pills aria-pressed="false"', JSON.stringify(bare));

    // ---- 6. no errors across the whole run -----------------------------
    // ABSENT_OK: resources that cannot exist in a static file server but do
    // exist in the deployed environment.
    //   /api/*    → Vercel serverless functions; not part of the static build.
    //   /versions/layer-scheduler.worker.js → copy-static moves it into
    //     dist/versions/ at BUILD time. It is only absent when this suite
    //     falls back to the source tree (no dist/ yet), so the allowlist
    //     entry is conditional rather than permanent.
    //   /favicon* → browser default probe.
    const ABSENT_OK = [
      /\/api\//,
      /favicon/i,
    ];
    if (SERVE_ROOT === process.cwd()) {
      ABSENT_OK.push(/\/versions\/layer-scheduler\.worker\.js/);
    }
    const badMissing = missing.filter((u) => !ABSENT_OK.some((re) => re.test(u)));

    pageErrs.length === 0
      ? pass('no uncaught page errors during the run')
      : fail('no uncaught page errors during the run', pageErrs.slice(0, 3).join(' | '));

    badMissing.length === 0
      ? pass('no missing static assets (404s)', `${missing.length} absent-but-expected`)
      : fail('no missing static assets (404s)', badMissing.slice(0, 4).join(' | '));

    consoleErrs.length === 0
      ? pass('no console errors during the run')
      : fail('no console errors during the run', consoleErrs.slice(0, 3).join(' | '));

      await page.close();
      lastErr = null;
      break; // attempt succeeded
    } catch (e) {
      lastErr = e;
      if (attempt < MAX_ATTEMPTS) {
        console.log(`  (attempt ${attempt} failed: ${String(e && e.message).slice(0, 90)} — retrying)`);
        await new Promise((r) => setTimeout(r, 2000));
      }
    }
  }

  if (lastErr) fail('smoke run', lastErr && lastErr.message);

  await browser.close();
  if (server) server.kill();

  const failed = checks.filter((c) => !c.ok);
  console.log('');
  console.log('─'.repeat(60));
  if (failed.length) {
    console.log(`PLAY VARIANT: ${failed.length} FAILED / ${checks.length} checks`);
    process.exit(1);
  }
  console.log(`PLAY VARIANT: ALL GREEN (${checks.length} checks)`);
  process.exit(0);
})();
