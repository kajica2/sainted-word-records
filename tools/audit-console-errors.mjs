#!/usr/bin/env node
// tools/audit-console-errors.js — walk every engine page with headless
// Chrome and collect console.error / console.warn / 4xx-5xx responses.
// Prints a grouped, de-duped report so we can fix everything in one pass.
//
// Usage:
//   npm run dev   (in another terminal)
//   node tools/audit-console-errors.js
//
// Add/remove URLs in the PAGES list to scope the audit.

import puppeteer from 'puppeteer';

const PAGES = [
  { name: 'engine.html',          url: 'http://localhost:5174/engine.html' },
  { name: 'dashboard.html',        url: 'http://localhost:5174/dashboard.html' },
  { name: 'versions/music_video',  url: 'http://localhost:5174/versions/music_video.html' },
  { name: 'versions/pulse',        url: 'http://localhost:5174/versions/pulse.html' },
  { name: 'versions/film',         url: 'http://localhost:5174/versions/film.html' },
  { name: 'versions/neon',         url: 'http://localhost:5174/versions/neon.html' },
  { name: 'landing.html',          url: 'http://localhost:5174/landing.html' },
];

const QUIET_MS_BEFORE_NEXT = 2500; // settle time after navigation
const HARD_TIMEOUT_MS = 30000;

(async () => {
  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  const aggregate = new Map(); // key -> { count, sources: Set, sample }
  function record(category, source, message) {
    const key = category + '||' + message;
    let entry = aggregate.get(key);
    if (!entry) {
      entry = { category, message, count: 0, sources: new Set(), sample: message.slice(0, 200) };
      aggregate.set(key, entry);
    }
    entry.count++;
    entry.sources.add(source);
  }

  for (const page of PAGES) {
    const tab = await browser.newPage();
    console.log(`\n─── ${page.name} (${page.url}) ───`);
    const consoleMsgs = [];
    const failedRequests = [];

    tab.on('console', (msg) => {
      const type = msg.type();
      if (type === 'error' || type === 'warning') {
        const text = msg.text();
        consoleMsgs.push({ type, text });
        record(type, page.name, text);
      }
    });
    tab.on('pageerror', (err) => {
      consoleMsgs.push({ type: 'pageerror', text: err.message });
      record('pageerror', page.name, err.message);
    });
    tab.on('response', (res) => {
      const status = res.status();
      if (status >= 400 && status < 600) {
        failedRequests.push({ status, url: res.url() });
        record(`HTTP ${status}`, page.name, res.url());
      }
    });
    tab.on('requestfailed', (req) => {
      const text = `${req.url()} — ${req.failure()?.errorText || 'unknown'}`;
      failedRequests.push({ status: 'failed', url: req.url(), reason: req.failure()?.errorText });
      record('request-failed', page.name, text);
    });

    try {
      await tab.goto(page.url, { waitUntil: 'networkidle2', timeout: HARD_TIMEOUT_MS });
    } catch (e) {
      console.log(`  (goto failed: ${e.message})`);
      record('navigation', page.name, e.message);
    }
    // Give late JS / setTimeout handlers a chance to fire
    await new Promise((r) => setTimeout(r, QUIET_MS_BEFORE_NEXT));

    const errCount = consoleMsgs.filter((m) => m.type === 'error' || m.type === 'pageerror').length;
    const warnCount = consoleMsgs.filter((m) => m.type === 'warning').length;
    const netCount = failedRequests.length;
    console.log(`  errors=${errCount} warnings=${warnCount} 4xx/5xx=${netCount}`);

    if (errCount || warnCount || netCount) {
      // Show up to 5 sample messages from this page so the report stays scannable
      const samples = [
        ...consoleMsgs.slice(0, 3).map((m) => `    [${m.type}] ${m.text}`),
        ...failedRequests.slice(0, 2).map((r) => `    [net ${r.status}] ${r.url}${r.reason ? ' — ' + r.reason : ''}`),
      ];
      samples.forEach((s) => console.log(s));
      if (consoleMsgs.length + failedRequests.length > 5) {
        console.log(`    ... (${consoleMsgs.length + failedRequests.length - 5} more on this page; see aggregate below)`);
      }
    }

    await tab.close();
  }

  await browser.close();

  // Final report — grouped + sorted by frequency
  console.log('\n\n========================================');
  console.log('AGGREGATED ERRORS / WARNINGS (de-duped)');
  console.log('========================================\n');

  const sorted = Array.from(aggregate.values()).sort((a, b) => b.count - a.count);
  console.log(`Total unique issues: ${sorted.length}`);
  console.log(`Total occurrences:   ${sorted.reduce((s, e) => s + e.count, 0)}\n`);

  let prevCat = null;
  for (const e of sorted) {
    if (e.category !== prevCat) {
      console.log(`\n── ${e.category} (${sorted.filter((x) => x.category === e.category).length} unique) ──`);
      prevCat = e.category;
    }
    const sourceList = Array.from(e.sources).slice(0, 4).join(', ') +
      (e.sources.size > 4 ? ` (+${e.sources.size - 4} more)` : '');
    console.log(`  ×${String(e.count).padStart(3)} [${sourceList}]`);
    console.log(`      ${e.message.slice(0, 240)}${e.message.length > 240 ? '…' : ''}`);
  }

  console.log('\nDone.');
})();
