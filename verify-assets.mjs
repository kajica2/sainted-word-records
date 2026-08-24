// verify-assets.mjs — full site asset/links audit
// Crawls every public page, tracks every src= and href= request, flags 4xx/5xx.

import puppeteer from 'puppeteer';

const ROOT = 'https://sainted-word-records.vercel.app';
const PAGES = [
  '/', '/engine', '/versions', '/versions.html', '/versions/gallery.html',
  '/versions/neon.html', '/versions/film.html', '/versions/grid.html',
  '/versions/smoke.html', '/versions/hallucination.html', '/versions/glitch.html',
  '/versions/aurora.html', '/versions/pulse.html', '/versions/void.html',
  '/versions/chrome.html', '/versions/watercolor.html', '/versions/fractal.html',
  '/versions/eclipse.html',
  '/changelog.html', '/press.html', '/status.html', '/about.html',
  '/legal/privacy.html', '/legal/terms.html', '/404.html',
  '/campaign.html',
];

const checks = [];
const pass = (m) => { checks.push({ ok: true, m }); console.log('✓', m); };
const fail = (m) => { checks.push({ ok: false, m }); console.log('✗', m); };

(async () => {
  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-features=ServiceWorker,ServiceWorkerOnUI'],
    defaultViewport: { width: 1280, height: 800 },
  });
  const page = await browser.newPage();
  const failures = [];

  page.on('response', async (r) => {
    const url = r.url();
    if (!url.startsWith(ROOT)) return;  // skip fonts.googleapis etc
    if (r.status() >= 400) {
      failures.push({ url, status: r.status(), page: page._currentUrl });
    }
  });

  for (const path of PAGES) {
    failures.length = 0;
    const url = ROOT + path;
    try {
      const resp = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
      if (!resp) { fail(`no response: ${path}`); continue; }
      // Give the page a moment to load sub-resources
      await new Promise(r => setTimeout(r, 1500));
      if (failures.length === 0) {
        pass(`${path} (${resp.status()}) · 0 broken assets`);
      } else {
        for (const f of failures) {
          // page._currentUrl is the URL after redirects
          const ref = (f.page || url).replace(ROOT, '');
          fail(`${ref} → ${f.url.replace(ROOT, '')} → HTTP ${f.status}`);
        }
      }
    } catch (e) {
      fail(`${path} → ${e.message.split('\n')[0]}`);
    }
  }

  await browser.close();
  const total = checks.length;
  const passed = checks.filter(c => c.ok).length;
  console.log(`\n${passed}/${total} pages have 0 broken assets`);
  if (passed < total) process.exit(1);
})();
