import { chromium } from 'playwright';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const config = JSON.parse(readFileSync(new URL('./swarm.config.json', import.meta.url)));
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
  async function run({ route, viewport }) {
    const context = await browser.newContext({ viewport: { width: viewport.width, height: viewport.height }, reducedMotion: 'reduce' });
    const page = await context.newPage();
    const key = route.id + '-' + viewport.id;
    const errors = [];
    page.on('pageerror', err => errors.push(['regression', err.message]));
    page.on('console', msg => { if (msg.type() === 'error') errors.push(['regression', msg.text()]); });
    page.on('requestfailed', request => { if (!request.failure()?.errorText?.includes('ERR_ABORTED')) errors.push(['api', request.url() + ': ' + request.failure()?.errorText]); });
    try {
      const response = await page.goto(new URL(route.path, base).href, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await page.waitForTimeout(1200);
      const status = response?.status() || 0;
      if (status >= 400) add('high', 'api', key, 'Navigation HTTP ' + status);
      const state = await page.evaluate(() => ({
        title: document.title,
        bodyTextLength: document.body?.innerText?.trim().length ?? 0,
        horizontalOverflow: document.documentElement.scrollWidth > innerWidth + 2,
        brokenImages: [...document.images].filter(img => img.complete && img.naturalWidth === 0 && img.currentSrc).slice(0, 15).map(img => img.currentSrc),
        canvasCount: document.querySelectorAll('canvas').length
      }));
      await page.screenshot({ path: join(output, 'screenshots', key + '.png'), fullPage: true, animations: 'disabled', timeout: 15000 });
      evidence.push({ key, route: route.path, viewport: viewport.id, status, ...state, screenshot: 'screenshots/' + key + '.png' });
      if (state.bodyTextLength < 2) add('medium', 'visual', key, 'Page has little visible text; inspect screenshot (canvas-only surfaces may be valid)');
      if (state.horizontalOverflow) add('medium', 'visual', key, 'Horizontal overflow');
      for (const src of state.brokenImages) add('medium', 'visual', key, 'Broken image: ' + src);
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
for (const endpoint of config.apiChecks) {
  try {
    const response = await fetch(new URL(endpoint.path, base), { signal: AbortSignal.timeout(12000) });
    evidence.push({ api: endpoint.id, path: endpoint.path, status: response.status });
    if (!endpoint.expectedStatus.includes(response.status)) {
      const optional = endpoint.optionalOnStaticPreview && response.status === 404;
      add(optional ? 'info' : 'high', 'api', endpoint.id, 'HTTP ' + response.status + (optional ? ' (static preview has no serverless API)' : ''));
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
