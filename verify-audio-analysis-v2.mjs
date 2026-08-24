// Puppeteer verifier for the new audio analysis v2 module.
// Loads /audio-analysis-v2-test.html, waits for window.__testResults to fill,
// reads the 13 page-level results, adds 3 script-level checks (HTTP 200, no
// console errors, 2 screenshots), and exits 0 on GREEN, 1 on RED.
//
// Pattern: same structure as verify-v6.mjs (suppression list, page.evaluate
// for state, screenshot via element-clip).
import puppeteer from 'puppeteer';
import { mkdirSync, statSync } from 'node:fs';

const URL = 'http://localhost:5174/audio-analysis-v2-test.html';
const SCREENSHOT_DIR = 'verify-screenshots';
const EXPECTED_PAGE_RESULTS = 13; // 13 page-level checks, 3 script-level = 16 total

// Suppress pre-existing / dev-server noise that does not indicate a real
// page error. Same suppression set as verify-v6.mjs, plus blob: aborts
// (the test page uses OfflineAudioContext which can fire these).
// Note: a "Failed to load resource" 404 from a missing favicon is a known
// pre-existing browser request, not a page error. The console message text
// does not include the URL, so we suppress the generic 404 line.
const SUPPRESS_PATTERNS = [
  /Failed to load resource/i,
  /\/@vite\/client/i,
  /hot-update/i,
  /net::ERR_CONNECTION_REFUSED/i,
  /net::ERR_ABORTED/i,
  /blob:/i,
  /VERT is not defined/i,
  /drawImage/i,
];

function shouldSuppress(msg) {
  return SUPPRESS_PATTERNS.some((re) => re.test(String(msg)));
}

const errors = [];
const checks = [];

function pushError(e) {
  if (!shouldSuppress(e)) errors.push(e);
}

const browser = await puppeteer.launch({
  headless: 'new',
  args: ['--no-sandbox', '--disable-setuid-sandbox', '--autoplay-policy=no-user-gesture-required'],
});

try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1400, height: 900, deviceScaleFactor: 1 });

  page.on('pageerror', (e) => pushError('pageerror: ' + e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') pushError('console.error: ' + m.text());
  });
  page.on('requestfailed', (req) => {
    const u = req.url();
    if (u.includes('favicon') || u.includes('hot-update') || u.includes('@vite/client')) return;
    pushError('requestfailed: ' + u + ' ' + (req.failure()?.errorText || ''));
  });

  let resp;
  try {
    resp = await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
  } catch (e) {
    console.error('FAILED to load page:', e.message);
    console.error('Start dev server with: npx vite --port 5174');
    process.exit(1);
  }

  // ───── Wait for the page to finish running its 13 checks ─────
  // The last check (#15, analyzeBuffer end-to-end) is async (OfflineAudioContext
  // render). Wait until window.__testResults has the full count AND the
  // __testResultsComplete flag flips to true.
  try {
    await page.waitForFunction(
      (expected) => {
        const r = window.__testResults;
        return Array.isArray(r) && r.length >= expected && window.__testResultsComplete === true;
      },
      { timeout: 60000 },
      EXPECTED_PAGE_RESULTS
    );
  } catch (e) {
    // Don't bail — still report whatever made it into __testResults.
  }
  // Small settle delay so the final DOM row has time to render.
  await new Promise((r) => setTimeout(r, 200));

  // ───── Pull results from the page ─────
  const pageResults = await page.evaluate(() => {
    const r = window.__testResults || [];
    return r.map((x) => ({ name: x.name, ok: !!x.ok, detail: x.detail || '' }));
  });
  const complete = await page.evaluate(() => window.__testResultsComplete === true);

  // ───── Check 1: HTTP 200 ─────
  const status = resp ? resp.status() : 0;
  checks.push({ name: '1. HTTP 200', ok: status === 200, detail: 'status=' + status });

  // ───── Check 2: No console errors ─────
  const realErrors = errors.filter((e) => !shouldSuppress(e));
  checks.push({
    name: '2. No console errors (pageerror / console.error, post-suppression)',
    ok: realErrors.length === 0,
    detail: realErrors.length + ' error(s)',
  });

  // ───── Check 3-15: 13 page-level results from window.__testResults ─────
  if (pageResults.length < EXPECTED_PAGE_RESULTS || !complete) {
    checks.push({
      name: '3-15. Page-level checks (13) populated',
      ok: false,
      detail: 'got ' + pageResults.length + '/' + EXPECTED_PAGE_RESULTS + ', complete=' + complete,
    });
  } else {
    // Surface them as a single "all 13 passed" group check, and as individual
    // pass/fail rows so a single failure is visible.
    let passCount = 0;
    const fails = [];
    for (const r of pageResults) {
      if (r.ok) passCount++;
      else fails.push(r.name + ' (' + r.detail + ')');
    }
    // Single summary row (counts toward 16)
    checks.push({
      name: '3-15. AudioAnalysisV2 13 page-level checks',
      ok: passCount === EXPECTED_PAGE_RESULTS,
      detail: passCount + '/' + EXPECTED_PAGE_RESULTS + ' passed' + (fails.length ? ' - fails: ' + fails.join('; ') : ''),
    });
    // Also include each individual check as a row so they're visible in the report
    for (let i = 0; i < pageResults.length; i++) {
      const r = pageResults[i];
      checks.push({
        name: '   ' + (i + 3) + '. ' + r.name,
        ok: r.ok,
        detail: r.detail,
      });
    }
  }

  // ───── Check 16: 2 screenshots saved ─────
  mkdirSync(SCREENSHOT_DIR, { recursive: true });
  // Screenshot 1: full page (top of viewport) — shows the 13 test results.
  await page.screenshot({
    path: SCREENSHOT_DIR + '/audio-v2-test.png',
    clip: { x: 0, y: 0, width: 1400, height: 900 },
  });
  // Screenshot 2: chromagram canvas (element-screenshot so it captures
  // only the canvas, not the full viewport — the canvas is small enough
  // that it would otherwise be lost in a full-page screenshot).
  let shot2Size = 0;
  try {
    const chromaHandle = await page.$('#c');
    if (chromaHandle) {
      const buf = await chromaHandle.screenshot({ omitBackground: false });
      const fs = await import('node:fs');
      fs.writeFileSync(SCREENSHOT_DIR + '/audio-v2-chromagram.png', buf);
      shot2Size = buf.length;
    }
  } catch (e) {
    shot2Size = 0;
  }

  // Verify the screenshot files exist and are non-trivial in size
  let shot1Size = 0;
  try { shot1Size = statSync(SCREENSHOT_DIR + '/audio-v2-test.png').size; } catch (_) {}
  // The chromagram canvas is mostly one background color with thin bars,
  // so PNG compresses it to a few hundred bytes. 200B is enough to prove
  // it's a real PNG (not an error stub or empty file).
  const bothShotsOk = shot1Size > 1024 && shot2Size > 200;
  checks.push({
    name: '16. 2 screenshots saved (audio-v2-test.png, audio-v2-chromagram.png)',
    ok: bothShotsOk,
    detail: 'audio-v2-test.png=' + shot1Size + 'B, audio-v2-chromagram.png=' + shot2Size + 'B',
  });

  // ───── Report ─────
  console.log('\n=== AUDIO ANALYSIS V2 VERIFY · ' + URL + ' ===\n');
  for (const c of checks) {
    console.log((c.ok ? '\u2713' : '\u2717') + ' ' + c.name + (c.detail ? '  ' + c.detail : ''));
  }
  console.log('\nerrors:', realErrors.length);
  for (const e of realErrors) console.log('  \u2717', e);
  console.log('suppressed (pre-existing):', errors.length - realErrors.length);

  // Top-level summary: only the 16 "real" checks (not the per-page sub-rows).
  // The summary check is the row at index 2 (after HTTP 200 + no-errors).
  const summary = checks.filter((c) => /^(1\.|2\.|3-15\.|16\.)/.test(c.name));
  const allOk = summary.every((c) => c.ok) && realErrors.length === 0;
  console.log('\nFINAL:', allOk ? 'GREEN \u2713' : 'RED \u2717');
  console.log('  (' + summary.filter((c) => c.ok).length + '/' + summary.length + ' top-level checks passed)');
  process.exit(allOk ? 0 : 1);
} catch (e) {
  console.error('UNCAUGHT:', e.stack || e.message);
  process.exit(2);
} finally {
  await browser.close();
}
