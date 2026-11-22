import { chromium } from 'playwright';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { runAxe, tally } from './a11y.mjs';

// The config path can be overridden, so a test can drive the surface
// over two routes instead of a hundred and forty-eight.
const configPath = process.env.KAI_QA_CONFIG || new URL('./swarm.config.json', import.meta.url);
const config = JSON.parse(readFileSync(configPath, 'utf8'));
if (config.maxConcurrentAgents > 2 || config.maxDailyApiUsd > 2 || config.allowMerge || config.allowProductionDeploy) throw new Error('Unsafe swarm policy');
const base = process.env.KAI_QA_BASE_URL || config.baseUrl;
const output = process.env.KAI_QA_OUTPUT || 'qa-results';
mkdirSync(join(output, 'screenshots'), { recursive: true });
const findings = [], evidence = [];
const add = (severity, mission, target, description) => findings.push({ id: 'KAI-' + String(findings.length + 1).padStart(4, '0'), severity, mission, target, description });
let browser;
try {
  browser = await chromium.launch({ headless: true });
  // Concurrency is intentionally capped at 2 browser contexts; API checks follow serially.
  const work = config.routes.flatMap(route => config.viewports.map(viewport => ({ route, viewport })));

// Does this base have a serverless API behind it? The dev server does
// (scripts/dev-api.mjs); a static `vite preview` does not, so a page's own
// fetch to /api/… answers 404 there and in production. The config's
// apiChecks already say the API may be absent on a static preview; this is
// the same rule for the errors the pages log themselves, and it is probed
// once instead of guessed per route.
let hasApiServer = true;
for (const endpoint of config.apiChecks) {
  try {
    const probe = await fetch(new URL(endpoint.path, base), { signal: AbortSignal.timeout(8000) });
    // The STATUS is not enough: `vite preview`'s SPA fallback answers 200
    // with the home page for any unknown path, so a static preview LOOKS
    // like it has a healthy API. The API answers JSON; the fallback
    // answers HTML. That is the difference.
    const type = (probe.headers.get('content-type') || '').toLowerCase();
    if (!endpoint.expectedStatus.includes(probe.status) || !type.includes('json')) {
      hasApiServer = false;
      break;
    }
  } catch (_) { hasApiServer = false; break; }
}
  // The home page's title is the fingerprint of a soft 404: a route that
  // answers 200 with the HOME PAGE is a broken route, and a surface that
  // cannot see that will happily report 148 routes while covering 122
  // pages. (It did: 26 routes measured the home page, because the
  // preview server was not applying vercel.json's rewrites. The preview
  // now is — vite.config.js's dev-vercel-rewrites plugin hooks
  // configurePreviewServer as well as configureServer — and this check
  // is what proves it.)
  let homeTitle = '';
  try {
    const home = await browser.newPage();
    await home.goto(new URL('/', base).href, { waitUntil: 'domcontentloaded', timeout: 30000 });
    homeTitle = await home.title();
    await home.close();
  } catch (_) { /* the home page is not this surface's business */ }

  async function run({ route, viewport }) {
    const context = await browser.newContext({ viewport: { width: viewport.width, height: viewport.height }, reducedMotion: 'reduce' });
    const page = await context.newPage();
    const key = route.id + '-' + viewport.id;
    const errors = [];
    // An error WITHOUT a file:line is not actionable. The QA pass used to
    // store `err.message` and `msg.text()` alone, so every regression finding
    // it produced named a symptom and no cause: a fixer could not tell which
    // script threw, let alone which line. Capture the stack and the console
    // location, and capture a script that 404s (a missing module is the
    // classic cause of `undefined.length`, and an HTTP 404 is NOT a
    // "requestfailed" — only a transport failure is).
    const frame = (err) => {
      const stack = String(err && err.stack || '');
      const m = stack.match(/at .*?(\S+):(\d+):(\d+)/);
      return m ? ` (${m[1]}:${m[2]}:${m[3]})` : '';
    };
    page.on('pageerror', err => errors.push(['regression', err.message + frame(err)]));
    page.on('console', msg => {
      if (msg.type() !== 'error') return;
      const loc = msg.location() || {};
      const at = loc.url ? ` (${loc.url}:${loc.lineNumber}:${loc.columnNumber})` : '';
      // A failed load of the site's OWN /api/ route is expected when this
      // base has no serverless API behind it — the route exists (there is
      // an api/entrance-analytics.js in the repo) and answers in production.
      // Reporting it here would cost every cycle a turn to triage.
      if (!hasApiServer && /Failed to load resource/.test(msg.text()) && /\/api\//.test(loc.url || '')) return;
      errors.push(['regression', msg.text() + at]);
    });
    page.on('requestfailed', request => { if (!request.failure()?.errorText?.includes('ERR_ABORTED')) errors.push(['api', request.url() + ': ' + request.failure()?.errorText]); });
    const scripts = [];
    page.on('response', res => {
      if (!/\.(m?js)(\?|$)/.test(res.url())) return;
      scripts.push({ url: res.url(), status: res.status() });
    });
    try {
      const response = await page.goto(new URL(route.path, base).href, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await page.waitForTimeout(1200);
      const status = response?.status() || 0;
      if (status >= 400) add('high', 'api', key, 'Navigation HTTP ' + status);
      const state = await page.evaluate(() => {
        const vw = window.innerWidth;
        // An overflow finding that names no element is not actionable either:
        // measure WHICH element crosses the viewport, and by how much.
        const offenders = [];
        for (const el of document.querySelectorAll('*')) {
          const r = el.getBoundingClientRect();
          if (r.width === 0 && r.height === 0) continue;
          // Only the RIGHT edge can make a page scroll sideways. The
          // shared skip link sits at `left: -9999px` until it is focused,
          // so testing the left edge too reported it as the worst
          // offender on every page — a red herring at +9999px that hid
          // the element actually causing the scroll.
          if (r.right > vw + 2) {
            offenders.push({
              tag: el.tagName.toLowerCase(),
              id: el.id || null,
              cls: (el.className && String(el.className).slice(0, 70)) || null,
              overBy: Math.round(Math.max(r.right - vw, -r.left)),
              text: (el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 60),
            });
          }
        }
        offenders.sort((a, b) => b.overBy - a.overBy);
        return {
          title: document.title,
          bodyTextLength: document.body?.innerText?.trim().length ?? 0,
          horizontalOverflow: document.documentElement.scrollWidth > innerWidth + 2,
          scrollWidth: document.documentElement.scrollWidth,
          clientWidth: document.documentElement.clientWidth,
          innerWidth: vw,
          overflowOffenders: offenders.slice(0, 6),
          brokenImages: [...document.images].filter(img => img.complete && img.naturalWidth === 0 && img.currentSrc).slice(0, 15).map(img => img.currentSrc),
          canvasCount: document.querySelectorAll('canvas').length
        };
      });
      // Accessibility is a mission of this surface too: the same axe
      // probe the gate uses, so a fix and its gate can never disagree
      // about what the page's accessibility state is.
      let a11y = { counts: {}, detail: {} };
      try {
        a11y = tally(await runAxe(page));
      } catch (err) {
        errors.push(['accessibility', 'axe could not run: ' + err.message]);
      }
      await page.screenshot({ path: join(output, 'screenshots', key + '.png'), fullPage: true, animations: 'disabled', timeout: 15000 });
      evidence.push({ key, route: route.path, viewport: viewport.id, status, ...state, a11y, scripts: scripts.slice(0, 60), screenshot: 'screenshots/' + key + '.png' });
      if (state.bodyTextLength < 2) add('medium', 'visual', key, 'Page has little visible text; inspect screenshot (canvas-only surfaces may be valid)');
      if (homeTitle && state.title === homeTitle && route.path !== '/') {
        add('high', 'regression', key, 'The route serves the HOME PAGE (soft 404) — the rewrite for ' + route.path + ' does not reach its own document');
      }
      if (state.horizontalOverflow) {
        const who = state.overflowOffenders.map(o => `${o.tag}${o.id ? '#' + o.id : ''}${o.cls ? '.' + o.cls.split(/\s+/).join('.') : ''} (+${o.overBy}px)`).join(', ');
        add('medium', 'visual', key, 'Horizontal overflow: scrollWidth ' + state.scrollWidth + ' > innerWidth ' + state.innerWidth + ' — ' + (who || 'no element located'));
      }
      for (const src of state.brokenImages) add('medium', 'visual', key, 'Broken image: ' + src);
      for (const s of scripts) {
        if (s.status >= 400) add('medium', 'api', key, 'Script did not load: HTTP ' + s.status + ' ' + s.url);
      }
    } catch (err) {
      add('high', 'regression', key, 'Browser capture failed: ' + err.message);
    } finally {
      for (const [mission, description] of errors) add('medium', mission, key, description);
      await context.close();
    }
  }
  for (let i = 0; i < work.length; i += 2) await Promise.all(work.slice(i, i + 2).map(run));
} catch (err) { add('high', 'regression', 'browser', err.message); }
finally { await browser?.close(); }
// Accessibility, aggregated BY RULE across the whole surface. The same
// rule broken on sixty pages is ONE defect with sixty symptoms; reported
// per instance it would be sixty tasks, and the swarm would spend its
// budget on the count rather than on the cause.
const a11yCounts = {};
const a11yPages = {};
const a11yDetail = {};
for (const ev of evidence) {
  for (const [id, n] of Object.entries(ev.a11y?.counts || {})) {
    a11yCounts[id] = (a11yCounts[id] || 0) + n;
    a11yPages[id] = (a11yPages[id] || 0) + 1;
    if (!a11yDetail[id]) a11yDetail[id] = { ...ev.a11y.detail[id], example: ev.route };
  }
}
for (const [id, n] of Object.entries(a11yCounts).sort((a, b) => b[1] - a[1])) {
  const d = a11yDetail[id];
  const sample = d?.sample?.target ? ' — e.g. ' + d.sample.target : '';
  add('medium', 'accessibility', id, n + ' instance' + (n === 1 ? '' : 's') + ' on ' + a11yPages[id] + ' page' + (a11yPages[id] === 1 ? '' : 's') + ': ' + (d?.help || id) + sample);
}
for (const endpoint of config.apiChecks) {
  try {
    const response = await fetch(new URL(endpoint.path, base), { signal: AbortSignal.timeout(12000) });
    const type = (response.headers.get('content-type') || '').toLowerCase();
    evidence.push({ api: endpoint.id, path: endpoint.path, status: response.status, contentType: type });
    // The SPA fallback answers 200 with HTML for any unknown path, so a
    // static preview looks like it has a healthy API. Compare the content
    // type as well as the status: the API answers JSON.
    const healthy = endpoint.expectedStatus.includes(response.status) && type.includes('json');
    if (!healthy) {
      const optional = endpoint.optionalOnStaticPreview && (response.status === 404 || !type.includes('json'));
      add(optional ? 'info' : 'high', 'api', endpoint.id, 'HTTP ' + response.status + ' ' + type + (optional ? ' (static preview has no serverless API)' : ''));
    }
  } catch (err) { add('medium', 'api', endpoint.id, err.message); }
}
// Static, zero-cost security gate: checks repository policy; full security audit remains a separate agent mission.
if (config.allowMerge || config.allowProductionDeploy || config.allowSecretMutation || config.allowBaselineUpdates) add('high', 'security', 'policy', 'Forbidden privilege enabled');
const report = { schema: 'kai-swarm/phase1', timestamp: new Date().toISOString(), base, limits: { workers: 2, dailyApiUsd: 2, apiModelCalls: 0 }, findings, evidence };
writeFileSync(join(output, 'report.json'), JSON.stringify(report, null, 2));
writeFileSync(join(output, 'errorlog.ndjson'), findings.map(f => JSON.stringify(f)).join('\n') + '\n');
const lines = findings.map(f => '| ' + [f.id, f.severity, f.mission, f.target, f.description.replaceAll('|', '/').replaceAll('\n', ' ').slice(0, 180)].join(' | ') + ' |');
writeFileSync(join(output, 'REVISION_REPORT.md'), ['# KAI SWARM — Phase 1', '', 'Target: ' + base, 'Screenshots: ' + evidence.filter(e => e.screenshot).length, 'Findings: ' + findings.length, '', 'Creative review: inspect generated engine and versions captures for crop, layers, rhythm/readability; no automated aesthetic verdict is asserted.', '', '| ID | Severity | Mission | Target | Finding |', '|---|---|---|---|---|', ...lines, '', 'Revision process: fix on a separate branch, rerun existing CI, compare screenshots, request review; never merge automatically.'].join('\n'));
console.log(JSON.stringify({ screenshots: evidence.filter(e => e.screenshot).length, findings: findings.length, high: findings.filter(f => f.severity === 'high').length }));
if (findings.some(f => f.severity === 'high')) process.exitCode = 1;
