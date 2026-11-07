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

import { chromium } from 'playwright';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import http from 'node:http';
import { runAxe, tally } from '../qa/a11y.mjs';
import { ensureDist } from './with-dist.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const PORT = Number(process.env.SWR_A11Y_PORT || 53988);
const BASE = `http://127.0.0.1:${PORT}`;
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
function startServer() {
  return new Promise((resolve, reject) => {
    const proc = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--host', '127.0.0.1', '--outDir', 'dist'], {
      cwd: ROOT, stdio: 'ignore',
    });
    // The server must die with THIS process on EVERY exit path — a gate
    // that failed early used to leave it running, and the next run on the
    // same fixed port then polled the STALE server.
    process.on('exit', () => { try { proc.kill('SIGTERM'); } catch { /* already gone */ } });
    // vite spawns esbuild; killing the parent alone can leave the port
    // held, and the NEXT run on this fixed port would then measure the
    // STALE server.
    proc.on('exit', () => { try { proc.kill('SIGKILL'); } catch { /* already gone */ } });
    const start = Date.now();
    const tick = () => http.get(`${BASE}/`, (res) => {
      res.resume();
      if (res.statusCode === 200) return resolve(proc);
      if (Date.now() - start > 30000) return reject(new Error('server timeout'));
      setTimeout(tick, 200);
    }).on('error', () => {
      if (Date.now() - start > 30000) return reject(new Error('server error'));
      setTimeout(tick, 150);
    });
    setTimeout(tick, 200);
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
  try { server = await startServer(); }
  catch (e) { fail('server boot', e.message); process.exit(1); }

  const browser = await chromium.launch({ headless: true });
  const counts = {};
  const detail = {};
  const pagesWith = {};
  const pages = {};
  let pagesProbed = 0;

  try {
    for (const route of config.routes) {
      const context = await browser.newContext({ viewport: { width: viewport.width, height: viewport.height }, reducedMotion: 'reduce' });
      const page = await context.newPage();
      try {
        const res = await page.goto(new URL(route.path, BASE).href, { waitUntil: 'domcontentloaded', timeout: 30000 });
        if (!res || res.status() >= 400) continue;   // not this gate's business
        // Wait for the WEBFONTS before measuring. axe computes contrast
        // from the rendered pixels' colours, and a page measured before
        // its font arrives is a different page: two runs of the same
        // build differed by two contrast instances until this wait was
        // added.
        await page.evaluate(() => (document.fonts ? document.fonts.ready : null)).catch(() => {});
        await page.waitForTimeout(700);
        const violations = await runAxe(page);
        const t = tally(violations);
        pagesProbed++;
        for (const [id, n] of Object.entries(t.counts)) {
          counts[id] = (counts[id] || 0) + n;
          pagesWith[id] = (pagesWith[id] || 0) + 1;
          (pages[id] ||= []).push(route.path);
          if (!detail[id]) detail[id] = { ...t.detail[id], example: route.path };
        }
      } catch (_) {
        // A page that will not load is the load gate's finding, not this
        // gate's; it must not make the accessibility counts unstable.
      } finally {
        await context.close().catch(() => {});
      }
    }
  } finally {
    await browser.close();
    if (server) try { server.kill('SIGTERM'); } catch (_) { /* already gone */ }
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
    process.exit(1);
  }

  const base = baseline.counts || {};
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
    const was = base[id] || 0;
    const delta = n - was;
    if (delta > toleranceFor(was)) regressions.push(`${id}: ${was} → ${n} (+${delta}, tolerance ${toleranceFor(was)})`);
  }
  for (const [id, n] of Object.entries(base)) {
    const now = counts[id] || 0;
    if (now < n) improvements.push(`${id}: ${n} → ${now}`);
  }

  if (regressions.length === 0) {
    pass('no accessibility rule regressed', `${pagesProbed} pages, ${Object.keys(counts).length} rules`);
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
    const was = base[id] || 0;
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
