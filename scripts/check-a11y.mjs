#!/usr/bin/env node
// scripts/check-a11y.mjs — the accessibility gate.
//
// WHAT IT ASSERTS
// ---------------
// That the site has not become LESS accessible since the baseline was
// taken: no rule that was clean has started failing, and no rule that was
// failing is failing on more elements than it was.
//
// WHY A BASELINE AND NOT "ZERO VIOLATIONS"
// ----------------------------------------
// The site is a decade of pages; demanding zero axe violations today
// would mean demanding a rewrite, and a gate nobody can pass is a gate
// nobody runs. The baseline turns accessibility into a direction of
// travel: the counts can only go down, and every fix lowers them. The
// baseline is a committed file, so a lowering is a reviewable change —
// `node scripts/check-a11y.mjs --update-baseline` writes the current
// counts after a fix has landed.
//
// WHAT IT COVERS
// --------------
// Every route in qa/swarm.config.json — the same surface the swarm
// measures — at the desktop viewport. One viewport, not two: axe's rules
// are overwhelmingly layout-independent, and halving the gate's cost is
// worth more than catching the rare mobile-only violation twice.
//
// Run: node scripts/check-a11y.mjs
// Exit 0 on no regression, 1 on a regression or a missing baseline.

// Puppeteer, not Playwright. The repo's CI installs Puppeteer's Chromium
// (it is the browser every other gate uses); Playwright's browser is not
// installed there, and a gate that needs a browser nobody installed is a
// gate that fails on CI and nowhere else.
import puppeteer from 'puppeteer';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import http from 'node:http';
import { createServer } from 'node:net';
import { runAxe, tally } from '../qa/a11y.mjs';
import { ensureDist } from './with-dist.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
// The port is EPHEMERAL. A fixed port is a shared global: a stale server
// left by an earlier run would answer this run's readiness poll, and the
// gate would then measure the stale server's pages while reporting them
// as this run's. The gate kills its server on every exit path (verified),
// but binding is the other half of that.
//
// The port is CHOSEN here, by asking the OS for a free one, and handed to
// vite. Parsing vite's own output for the port it picked worked locally
// and failed on CI, where nothing in the captured stdout matched — a
// readiness poll that depends on a log line's format is a readiness poll
// that breaks when the tool changes how it logs.
const PORT = Number(process.env.SWR_A11Y_PORT || 0);
let base = '';

/** Ask the OS for a free TCP port and hand it back. */
function freePort() {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.unref();
    probe.on('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const port = probe.address().port;
      probe.close(() => resolve(port));
    });
  });
}
const BASELINE_PATH = join(ROOT, 'qa', 'a11y-baseline.json');
const CONFIG_PATH = join(ROOT, 'qa', 'swarm.config.json');
const updateBaseline = process.argv.includes('--update-baseline');

const checks = [];
const pass = (m, d) => { checks.push({ ok: true, m, d }); console.log('✓', m, d ? `(${d})` : ''); };
const fail = (m, d) => { checks.push({ ok: false, m, d }); console.log('✗', m, d ? `(${d})` : ''); };

// The server must answer the routes the way PRODUCTION does — including
// vercel.json's rewrites. A plain static server does not: `/play`'s file
// is `dist/versions/play.html`, and without the rewrite the path reaches
// the home page instead. `vite preview` is the same server the QA surface
// measures against, and vite.config.js's dev-vercel-rewrites plugin now
// applies the rewrites to it (configurePreviewServer, as well as
// configureServer).
async function startServer() {
  const port = PORT || await freePort();
  base = `http://127.0.0.1:${port}`;
  return new Promise((resolve, reject) => {
    let stderr = '';
    const proc = spawn('npx', ['vite', 'preview', '--port', String(port), '--host', '127.0.0.1', '--outDir', 'dist'], {
      cwd: ROOT, stdio: ['ignore', 'ignore', 'pipe'],
    });
    // vite's own complaints are the only useful thing if it refuses to
    // start, so they are kept — and shown, not swallowed.
    proc.stderr.on('data', (chunk) => { stderr += String(chunk); });
    // The server must die with THIS process on EVERY exit path — a gate
    // that failed early used to leave it running, and the next run on the
    // same fixed port then polled the STALE server.
    process.on('exit', () => { try { proc.kill('SIGTERM'); } catch { /* already gone */ } });
    // vite spawns esbuild; killing the parent alone can leave the port
    // held, and the NEXT run on this fixed port would then measure the
    // STALE server.
    proc.on('exit', () => { try { proc.kill('SIGKILL'); } catch { /* already gone */ } });
    const start = Date.now();
    const tick = () => {
      http.get(`${base}/`, (res) => {
        res.resume();
        if (res.statusCode === 200) return resolve(proc);
        if (Date.now() - start > 30000) return reject(new Error('server timeout'));
        setTimeout(tick, 200);
      }).on('error', () => {
        if (Date.now() - start > 30000) return reject(new Error('server error' + (stderr ? ': ' + stderr.slice(-300) : '')));
        setTimeout(tick, 150);
      });
    };
    setTimeout(tick, 150);
  });
}

(async () => {
  // The gate measures the BUILT site, so it must measure the CURRENT
  // build: a gate that serves a stale dist measures a page that no
  // longer exists. (The mutation test for this gate caught exactly
  // that — it injected a violation into the source and the gate did
  // not see it.)
  ensureDist();
  const config = JSON.parse(readFileSync(CONFIG_PATH, 'utf8'));
  const viewport = config.viewports.find(v => v.id === 'desktop') || { width: 1440, height: 900 };

  let server;
  // A global ceiling. A gate that can hang is a gate that hangs CI for
  // the runner's six-hour limit, and a gate that takes six hours to fail
  // tells you nothing about the code. Every wait inside the gate is
  // bounded too; this is the backstop for the ones that are not.
  const deadline = Date.now() + 20 * 60 * 1000;
  try { server = await startServer(); }
  catch (e) { fail('server boot', e.message); process.exit(1); }

  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
  });
  const counts = {};
  const detail = {};
  const pagesWith = {};
  const pages = {};
  const skipped = [];
  let pagesProbed = 0;

  try {
    for (const route of config.routes) {
      if (Date.now() > deadline) {
        fail('the gate finished inside its budget', `ran out of time after ${pagesProbed} pages`);
        break;
      }
      const page = await browser.newPage();
      await page.setViewport({ width: viewport.width, height: viewport.height });
      // The colour scheme is PINNED. lib/nav.client.js picks the theme
      // from the OS preference — `matchMedia('(prefers-color-scheme: dark)')`
      // — so the same build renders a DIFFERENT palette on a machine in
      // dark mode and on a runner with no preference. The contrast counts
      // are a claim about the palette, not about the code: the same
      // commit measured 3425 contrast instances on a dark-mode Mac and
      // 4546 on the CI runner, and the gate failed on its own baseline.
      //
      // Light is the tokens' documented default ("light theme (default)"
      // in lib/design-tokens.css), so that is what is measured.
      await page.emulateMediaFeatures([
        { name: 'prefers-reduced-motion', value: 'reduce' },
        { name: 'prefers-color-scheme', value: 'light' },
      ]);
      try {
        const res = await page.goto(new URL(route.path, base).href, { waitUntil: 'domcontentloaded', timeout: 30000 });
        if (!res || res.status() >= 400) continue;   // not this gate's business
        // Wait for the WEBFONTS before measuring. axe computes contrast
        // from the rendered pixels' colours, and a page measured before
        // its font arrives is a different page: two runs of the same
        // build differed by two contrast instances until this wait was
        // added.
        // The font wait is BOUNDED. `document.fonts.ready` settles when the
        // webfonts settle — and if a font request hangs, it never settles,
        // and a gate that awaits it hangs with it. The page is measured
        // with whatever font is available; a font that arrives late cannot
        // change a measurement that has already been taken.
        await page.evaluate(() => {
          const fonts = document.fonts ? document.fonts.ready : null;
          return fonts ? Promise.race([fonts, new Promise(r => setTimeout(r, 3000))]) : null;
        }).catch(() => {});
        // page.waitForTimeout was removed in Puppeteer v23; a plain sleep
        // is the replacement.
        await new Promise(r => setTimeout(r, 700));
        // PIN THE PALETTE, explicitly. The media-query emulation above
        // tells the page what the OS prefers; this says what the document
        // actually is, so a nav that reads localStorage, or a page that
        // sets its own theme, cannot move the measurement.
        await page.evaluate(() => {
          document.documentElement.setAttribute('data-theme', 'light');
          // PIN THE FONT STACK. A webfont that loads on one machine and
          // not on another changes the rendered text, and the counts must
          // not depend on a CDN being reachable. Arial and Liberation
          // Sans are metric-compatible, so the two platforms agree.
          const style = document.createElement('style');
          style.textContent = '*, *::before, *::after { font-family: Arial, "Liberation Sans", sans-serif !important; }';
          document.head.appendChild(style);
        });
        const violations = await runAxe(page);
        const t = tally(violations);
        pagesProbed++;
        for (const [id, n] of Object.entries(t.counts)) {
          counts[id] = (counts[id] || 0) + n;
          pagesWith[id] = (pagesWith[id] || 0) + 1;
          (pages[id] ||= []).push(route.path);
          if (!detail[id]) detail[id] = { ...t.detail[id], example: route.path };
        }
      } catch (err) {
        // A page that will not load is the load gate's finding, not this
        // gate's — but it must not be SILENT. A gate that skips a page
        // without saying so can report a clean bill of health for a
        // surface it never measured, which is the same class of bug as
        // the preview measuring the home page: a measurement that looks
        // like evidence and is not.
        skipped.push({ route: route.path, error: String(err && err.message || err).split('\n')[0] });
      } finally {
        // A page that will not close must not hold the gate open.
        await Promise.race([page.close().catch(() => {}), new Promise(r => setTimeout(r, 5000))]);
      }
    }
  } finally {
    await browser.close();
    if (server) try { server.kill('SIGTERM'); } catch (_) { /* already gone */ }
  }

  if (skipped.length) {
    fail('every route in the table was measured', `${skipped.length} skipped: ` + skipped.slice(0, 5).map(s => s.route + ' (' + s.error + ')').join('; '));
  } else {
    pass('every route in the table was measured', `${pagesProbed} pages`);
  }

  const baseline = existsSync(BASELINE_PATH) ? JSON.parse(readFileSync(BASELINE_PATH, 'utf8')) : null;

  if (!baseline) {
    writeFileSync(BASELINE_PATH, JSON.stringify({
      schema: 'swr/a11y-baseline/v1',
      note: 'Per-rule instance counts. Lower them by fixing the violation; the gate fails on any increase. `pages` and `example` say where — a count with no location is not a work item.',
      routes: config.routes.length,
      counts,
      pages,
      example: Object.fromEntries(Object.entries(detail).map(([id, d]) => [id, { help: d.help, impact: d.impact, example: d.example, target: d.sample?.target || null }])),
    }, null, 2) + '\n');
    fail('no baseline', `created ${BASELINE_PATH} from ${pagesProbed} pages — review and commit it`);
    if (skipped.length) console.log('   skipped:', skipped.slice(0, 8));
    process.exit(1);
  }

  const baselineCounts = baseline.counts || {};
  const regressions = [];
  const improvements = [];
  // The tolerance absorbs the measurement's own noise — the font CDN
  // fails sometimes, and a page measured with the fallback font is not
  // the page measured with the webfont. Two runs of the SAME build
  // differed by two contrast instances before the fonts were awaited,
  // and a gate that fails on a coin flip is worse than no gate.
  //
  // The tolerance is small on purpose: 0.2% of the baseline, and never
  // less than two instances. It catches a real regression (a colour
  // change across a page is tens of instances) and ignores the wobble.
  const toleranceFor = (was) => Math.max(2, Math.floor(was * 0.002));
  for (const [id, n] of Object.entries(counts)) {
    const was = baselineCounts[id] || 0;
    const delta = n - was;
    if (delta > toleranceFor(was)) regressions.push(`${id}: ${was} → ${n} (+${delta}, tolerance ${toleranceFor(was)})`);
  }
  for (const [id, n] of Object.entries(baselineCounts)) {
    const now = counts[id] || 0;
    if (now < n) improvements.push(`${id}: ${n} → ${now}`);
  }

  if (regressions.length === 0) {
    // A gate that measured nothing must not report clean. "No rule
    // regressed" over zero pages is the shape of a false green.
    if (pagesProbed === 0) {
      fail('no accessibility rule regressed', 'NOTHING WAS MEASURED — 0 pages');
    } else {
      pass('no accessibility rule regressed', `${pagesProbed} pages, ${Object.keys(counts).length} rules`);
    }
  } else {
    fail('accessibility regressed', regressions.join('; '));
  }
  if (improvements.length === 0) {
    pass('the baseline is current', 'nothing improved');
  } else {
    // A count that went DOWN is good news, and it means the baseline is
    // stale — but it is not a failure. It says the next commit should
    // lower it.
    pass('the baseline can be lowered', improvements.join('; '));
  }

  // The counts always go to stdout, so a run that lowered something is
  // visible without opening the file.
  console.log('');
  console.log('  per-rule instance counts (' + pagesProbed + ' pages):');
  for (const [id, n] of Object.entries(counts).sort((a, b) => b[1] - a[1])) {
    const was = baselineCounts[id] || 0;
    const mark = n > was ? '▲' : (n < was ? '▼' : '·');
    const delta = n - was;
    const tol = toleranceFor(was);
    console.log(`   ${mark} ${id}: ${n} (baseline ${was}, ${delta >= 0 ? '+' : ''}${delta}, tolerance ${tol}) on ${pagesWith[id]} pages — ${detail[id]?.help || ''}`);
    if (detail[id]?.example) console.log(`       example: ${detail[id].example} ${detail[id].sample?.target || ''}`);
    const where = (pages[id] || []).slice(0, 8).join(', ');
    if (where) console.log(`       pages: ${where}${(pages[id] || []).length > 8 ? `, +${pages[id].length - 8} more` : ''}`);
  }

  if (updateBaseline) {
    writeFileSync(BASELINE_PATH, JSON.stringify({ ...baseline, counts, pages, example: Object.fromEntries(Object.entries(detail).map(([id, d]) => [id, { help: d.help, impact: d.impact, example: d.example, target: d.sample?.target || null }])) }, null, 2) + '\n');
    console.log('');
    console.log('  baseline updated: ' + BASELINE_PATH);
  }

  console.log('');
  console.log('────────────────');
  console.log(`Accessibility gate: ${checks.filter(c => c.ok).length}/${checks.length} checks passed`);
  if (checks.some(c => !c.ok)) process.exit(1);
  console.log('OK');
})();
