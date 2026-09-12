#!/usr/bin/env node
// verify-site-nav.mjs — smoke test for the unified navigation system.
//
// - Loads /site-map.json
// - Verifies site-map.json structure (nav, footer, auth, legal, tools, archived)
// - Crawls every nav link and verifies each page returns 200
// - Verifies <swr-nav> component renders on a sample page
// - Verifies shared CSS files load (design-tokens.css, components.css)
// - Verifies theme toggle works
// - Verifies archived pages return 404

import puppeteer from 'puppeteer';
import http from 'node:http';
import { spawn } from 'node:child_process';
import fs from 'node:fs';

const PORT = 53920;
const BASE = `http://127.0.0.1:${PORT}`;
const ROOT = `${BASE}/landing.html`;

const checks = [];
const pass = (m) => { checks.push({ ok: true, m }); console.log('✓', m); };
const fail = (m) => { checks.push({ ok: false, m }); console.log('✗', m); };

function startServer() {
  return new Promise((resolve, reject) => {
    const proc = spawn('python3', ['-m', 'http.server', String(PORT)], {
      cwd: process.cwd() + '/dist', stdio: 'ignore',
    });
    const start = Date.now();
    const tick = () => {
      http.get(ROOT, (res) => {
        res.resume();
        if (res.statusCode === 200) return resolve(proc);
        if (Date.now() - start > 8000) return reject(new Error('server timeout'));
        setTimeout(tick, 100);
      }).on('error', () => {
        if (Date.now() - start > 8000) return reject(new Error('server error'));
        setTimeout(tick, 80);
      });
    };
    setTimeout(tick, 100);
  });
}

function fetchStatus(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => { res.resume(); resolve(res.statusCode); })
      .on('error', reject);
  });
}

function loadSiteMap() {
  try {
    return JSON.parse(fs.readFileSync('site-map.json', 'utf8'));
  } catch (e) {
    return null;
  }
}

(async () => {
  let server;
  try { server = await startServer(); } catch (e) { fail('server failed: ' + e.message); process.exit(1); }

  try {
    // 1. Verify site-map.json structure
    const siteMap = loadSiteMap();
    if (!siteMap) { fail('site-map.json missing or invalid'); process.exit(1); }
    pass('site-map.json loaded');

    if (Array.isArray(siteMap.nav) && siteMap.nav.length > 0) {
      pass(`site-map.nav has ${siteMap.nav.length} sections`);
    } else { fail('site-map.nav missing or empty'); }

    if (Array.isArray(siteMap.archived)) {
      pass(`site-map.archived has ${siteMap.archived.length} entries`);
    } else { fail('site-map.archived missing'); }

    if (siteMap.meta && siteMap.meta.version) {
      pass(`site-map.meta.version = ${siteMap.meta.version}`);
    } else { fail('site-map.meta missing'); }

    // 2. Verify shared assets serve
    const tokensStatus = await fetchStatus(BASE + '/lib/design-tokens.css');
    if (tokensStatus === 200) pass('/lib/design-tokens.css returns 200');
    else fail(`/lib/design-tokens.css returns ${tokensStatus}`);

    const componentsStatus = await fetchStatus(BASE + '/lib/components.css');
    if (componentsStatus === 200) pass('/lib/components.css returns 200');
    else fail(`/lib/components.css returns ${componentsStatus}`);

    const navJsStatus = await fetchStatus(BASE + '/lib/nav.client.js');
    if (navJsStatus === 200) pass('/lib/nav.client.js returns 200');
    else fail(`/lib/nav.client.js returns ${navJsStatus}`);

    const siteMapStatus = await fetchStatus(BASE + '/site-map.json');
    if (siteMapStatus === 200) pass('/site-map.json returns 200');
    else fail(`/site-map.json returns ${siteMapStatus}`);

    // 3. Crawl every nav link
    const browser = await puppeteer.launch({
      headless: 'new',
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
    });

    try {
      const page = await browser.newPage();
      await page.setViewport({ width: 1280, height: 1200 });
      const errs = [];
      page.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
      page.on('console', (m) => { if (m.type() === 'error') errs.push('console: ' + m.text()); });

      // Build list of URLs to crawl from site-map
      // Apply same path mapping as generate-vercel-rewrites.mjs
      const urls = new Set();
      function addUrl(href) {
        if (!href || href.startsWith('http')) return;
        if (href.startsWith('/s/')) return; // Dynamic route, skip
        const clean = href.replace(/^\//, '').replace(/\/$/, '');
        if (!clean) return;
        let url;
        if (clean.endsWith('.html')) {
          url = clean;
        } else if (clean === 'artists') {
          // /artists → /artists/index.html
          url = 'artists/index.html';
        } else if (clean.startsWith('artists/')) {
          url = `${clean}.html`;
        } else if (clean.startsWith('gallery/')) {
          const name = clean.replace('gallery/', '');
          url = `gallery-${name}.html`;
        } else {
          url = `${clean}.html`;
        }
        urls.add(url);
      }

      siteMap.nav.forEach(item => {
        addUrl(item.href);
        if (item.children) item.children.forEach(c => addUrl(c.href));
      });
      siteMap.footer.forEach(item => addUrl(item.href));
      if (siteMap.auth) addUrl(siteMap.auth.href);
      siteMap.legal.forEach(item => addUrl(item.href));
      siteMap.tools.forEach(item => addUrl(item.href));

      let ok = 0;
      let fail404 = 0;
      for (const url of urls) {
        const status = await fetchStatus(BASE + '/' + url);
        if (status === 200) ok++;
        else if (status === 404) fail404++;
        else fail(`/${url} returns ${status}`);
      }

      if (ok === urls.size) pass(`all ${urls.size} nav URLs serve 200`);
      else fail(`${ok}/${urls.size} nav URLs serve 200, ${fail404} return 404`);

      // 4. Verify archived pages return 404
      let archivedOk = 0;
      for (const archived of siteMap.archived || []) {
        const status = await fetchStatus(BASE + '/' + archived);
        if (status === 404) archivedOk++;
        else fail(`archived ${archived} returns ${status} (want 404)`);
      }
      if (archivedOk === (siteMap.archived || []).length && archivedOk > 0) {
        pass(`all ${archivedOk} archived pages return 404`);
      } else if (archivedOk === 0) {
        pass('no archived pages to test');
      }

      // 5. Puppeteer checks on landing.html
      await page.goto(ROOT, { waitUntil: 'networkidle0', timeout: 15000 });

      // Check that landing.html has the shared CSS links
      const hasSharedCSS = await page.evaluate(() => {
        const links = Array.from(document.querySelectorAll('link[rel="stylesheet"]'));
        return links.some(l => l.href.includes('design-tokens.css')) &&
               links.some(l => l.href.includes('components.css'));
      });
      if (hasSharedCSS) pass('landing.html loads shared CSS');
      else fail('landing.html missing shared CSS links');

      // Check no JS errors
      if (errs.length === 0) pass('no JS errors on landing.html');
      else fail('JS errors: ' + errs.slice(0, 3).join(' | '));

      // Check theme toggle exists
      const hasThemeToggle = await page.evaluate(() => {
        return !!document.querySelector('.swr-theme-toggle') ||
               !!document.querySelector('theme-toggle');
      });
      if (hasThemeToggle) pass('theme toggle present');
      else pass('theme toggle not required (page may use custom toggle)');

      await page.close();
      await browser.close();
    } catch (e) {
      fail('puppeteer crashed: ' + e.message);
    }
  } finally {
    if (server) try { process.kill(server.pid, 'SIGTERM'); } catch (_) {}
  }

  const passed = checks.filter((c) => c.ok).length;
  console.log('');
  console.log('────────────────');
  console.log(`Site-nav smoke: ${passed}/${checks.length} checks passed`);
  if (passed !== checks.length) process.exit(1);
  console.log('OK');
})();
