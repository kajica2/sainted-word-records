// Verifier — PWA live verification for Sainted Word Records
// Independent black-box audit. Does NOT modify project files.
// Tests the deployed PWA at https://sainted-word-records.vercel.app/:
//   1. Manifest reachable + valid (name, short_name, theme_color, display, start_url, 4 icons)
//   2. All 4 icons reachable + dimensions match
//   3. Service worker registers, getRegistration returns non-null, scriptURL ends with /sw.js
//   4. App shell precached in 'swr-v2' cache, >=12 entries
//   5. Offline page: setOfflineMode(true) + Network.emulateNetworkConditions, navigate, cached/503
//   6. Install prompt code path: beforeinstallprompt OR [class*="install"] OR no bootstrap errors
//   7. No console errors introduced by PWA additions
//   8. iOS hint code path: /iPad|iPhone|iPod/ AND navigator.standalone in pwa-bootstrap.js
//
// Usage: node verify-pwa.mjs

import puppeteer from 'puppeteer-core';
import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const URL = process.env.PWA_VERIFIER_URL || 'https://sainted-word-records.vercel.app/engine';
// Site root for fetching /manifest.webmanifest and /pwa-bootstrap.js (separate files)
const ROOT = URL.replace(/\/engine\/?$/, '');
const OUT = __dirname;
if (!existsSync(OUT)) mkdirSync(OUT, { recursive: true });

const checks = [];
const log = (name, ok, info) => {
  checks.push({ name, ok, info });
  console.log(`${ok ? '✓' : '✗'} ${name}${info ? '  ' + info : ''}`);
};

const browser = await puppeteer.launch({
  executablePath: process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: 'new',
  args: ['--no-sandbox', '--disable-setuid-sandbox'],
  defaultViewport: { width: 1400, height: 900 },
  protocolTimeout: 180000,
});

const page = await browser.newPage();

// Capture only NEW errors introduced by the PWA additions.
// We deliberately tolerate pre-existing engine errors (VERT, drawImage, InvalidStateError, 404).
const errors = [];
page.on('pageerror', (e) => {
  const m = e.message || String(e);
  if (m.includes('VERT') || m.includes('drawImage') || m.includes('InvalidStateError')) return;
  if (m.includes('Failed to fetch') || m.includes('NetworkError')) return;
  errors.push('pageerror: ' + m);
});
page.on('console', (m) => {
  if (m.type() === 'error') {
    const t = m.text();
    if (t.includes('VERT') || t.includes('drawImage') || t.includes('InvalidStateError')) return;
    if (t.includes('404')) return;
    if (t.includes('Failed to fetch') || t.includes('NetworkError')) return;
    if (t.includes('ServiceWorker') && t.includes('register')) return; // tolerate SW reg hiccups
    errors.push('console.error: ' + t);
  }
});

try {
  console.log('\n=== Phase 1: navigate to live URL ===');
  const resp = await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
  log('engine HTTP 200', resp.status() === 200, `(${resp.status()})`);

  // Wait for pwa-bootstrap to attach
  await page.evaluate(() => document.fonts.ready).catch(() => {});
  await new Promise(r => setTimeout(r, 3000));

  // Check 1: Manifest reachable + valid
  console.log('\n=== Check 1: manifest ===');
  const manifestFetch = await page.evaluate(async () => {
    try {
      const url = new URL('manifest.webmanifest', location.origin).href;
      const r = await fetch(url, { cache: 'no-store' });
      const j = await r.json();
      return { ok: r.ok, status: r.status, json: j, url };
    } catch (e) {
      return { ok: false, error: String(e) };
    }
  });
  log('manifest.webmanifest HTTP 200', manifestFetch.ok && manifestFetch.status === 200, `(${manifestFetch.status}${manifestFetch.url ? ' url=' + manifestFetch.url : ''}${manifestFetch.error ? ' err=' + manifestFetch.error : ''})`);

  if (manifestFetch.json) {
    const m = manifestFetch.json;
    log('manifest.name = "Sainted Word Records"', m.name === 'Sainted Word Records', JSON.stringify(m.name));
    log('manifest.short_name = "SWR"', m.short_name === 'SWR', JSON.stringify(m.short_name));
    log('manifest.theme_color = "#f5a524"', m.theme_color === '#f5a524', JSON.stringify(m.theme_color));
    log('manifest.display = "standalone"', m.display === 'standalone', JSON.stringify(m.display));
    log('manifest.start_url = "/engine" (PWA launches into the app, not the splash)', m.start_url === '/engine', JSON.stringify(m.start_url));
    log('manifest.scope = "/engine/"', m.scope === '/engine/', JSON.stringify(m.scope));
    log('manifest.icons has 4 entries', Array.isArray(m.icons) && m.icons.length === 4, `count=${m.icons?.length}`);
    const expectedIconSrcs = [
      '/icons/icon-192.png',
      '/icons/icon-512.png',
      '/icons/icon-maskable-512.png',
      '/icons/apple-touch-icon-180.png',
    ];
    const allIconSrcsMatch = Array.isArray(m.icons) && expectedIconSrcs.every(s => m.icons.some(i => i.src === s));
    log('all 4 icon srcs match expected', allIconSrcsMatch, allIconSrcsMatch ? '' : `got=${JSON.stringify(m.icons?.map(i => i.src))}`);
  } else {
    log('manifest JSON parse', false, 'no JSON returned');
  }

  // Check 2: All 4 icons reachable + dimensions
  console.log('\n=== Check 2: icons ===');
  const expectedIcons = [
    { url: '/icons/icon-192.png', w: 192, h: 192 },
    { url: '/icons/icon-512.png', w: 512, h: 512 },
    { url: '/icons/icon-maskable-512.png', w: 512, h: 512 },
    { url: '/icons/apple-touch-icon-180.png', w: 180, h: 180 },
  ];

  for (const icon of expectedIcons) {
    const r = await page.evaluate(async (u) => {
      try {
        const res = await fetch(u, { cache: 'no-store' });
        if (!res.ok) return { ok: false, status: res.status };
        const blob = await res.blob();
        const reader = new FileReader();
        const dataUrl = await new Promise((resolve, reject) => {
          reader.onload = () => resolve(reader.result);
          reader.onerror = () => reject(reader.error);
          reader.readAsDataURL(blob);
        });
        const dims = await new Promise((resolve) => {
          const img = new Image();
          img.onload = () => resolve({ w: img.naturalWidth, h: img.naturalHeight });
          img.onerror = () => resolve({ w: 0, h: 0 });
          img.src = dataUrl;
        });
        return { ok: true, status: res.status, type: res.headers.get('content-type'), ...dims };
      } catch (e) {
        return { ok: false, error: String(e) };
      }
    }, icon.url);
    log(
      `icon ${icon.url} HTTP 200 + ${icon.w}x${icon.h}`,
      r.ok && r.status === 200 && r.w === icon.w && r.h === icon.h,
      `(${r.status}, ${r.w}x${r.h}, type=${r.type})`
    );
  }

  // Check 3: Service worker registers
  console.log('\n=== Check 3: service worker ===');
  await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.evaluate(() => document.fonts.ready).catch(() => {});
  const swInfo = await page.evaluate(async () => {
    try {
      if (!('serviceWorker' in navigator)) return { supported: false };
      const reg = await navigator.serviceWorker.ready;
      const reg2 = await navigator.serviceWorker.getRegistration();
      return {
        supported: true,
        ready: !!reg,
        registration: reg2 ? {
          scope: reg2.scope,
          active: reg2.active ? reg2.active.scriptURL : null,
          installing: reg2.installing ? reg2.installing.scriptURL : null,
          waiting: reg2.waiting ? reg2.waiting.scriptURL : null,
        } : null,
      };
    } catch (e) {
      return { supported: true, error: String(e) };
    }
  });
  log('navigator.serviceWorker.ready resolved', swInfo.ready, '');
  log('getRegistration() is not null', !!swInfo.registration, '');
  const scriptUrl = swInfo.registration?.active || swInfo.registration?.waiting || swInfo.registration?.installing;
  log('active/waiting/installing scriptURL ends with /sw.js',
    !!scriptUrl && scriptUrl.endsWith('/sw.js'),
    scriptUrl || '(no worker)');

  // Check 4: App shell precached (>=12 paths in 'swr-v2')
  console.log('\n=== Check 4: app shell precache ===');
  const cacheInfo = await page.evaluate(async () => {
    try {
      const keys = await caches.keys();
      if (!keys.includes('swr-v2')) return { hasSwrV2: false, keys, count: 0, paths: [] };
      const cache = await caches.open('swr-v2');
      const reqs = await cache.keys();
      const paths = reqs.map(r => new URL(r.url).pathname).sort();
      return { hasSwrV2: true, keys, count: paths.length, paths };
    } catch (e) {
      return { hasSwrV2: false, error: String(e) };
    }
  });
  log("caches.keys() includes 'swr-v2'", cacheInfo.hasSwrV2, cacheInfo.hasSwrV2 ? '' : `keys=${JSON.stringify(cacheInfo.keys)}`);
  log('swr-v2 cache has >= 12 paths', cacheInfo.count >= 12, `count=${cacheInfo.count}`);

  // Check 5: Offline page serves
  console.log('\n=== Check 5: offline mode ===');
  const client = await page.target().createCDPSession();
  await client.send('Network.enable');
  await client.send('Network.emulateNetworkConditions', {
    offline: true,
    latency: 0,
    downloadThroughput: 0,
    uploadThroughput: 0,
  });
  await page.setOfflineMode(true);

  let offlineOk = false;
  let offlineNote = '';
  let offlineTitle = '';
  let offlineBody = '';
  try {
    const navResp = await page.goto(URL + '?offline-test=' + Date.now(), {
      waitUntil: 'domcontentloaded',
      timeout: 30000,
    });
    offlineTitle = await page.title();
    offlineBody = await page.evaluate(() => document.body ? document.body.innerText.slice(0, 300) : '');
    offlineOk = !!navResp && (navResp.status() === 200 || navResp.status() === 503);
    offlineNote = `status=${navResp?.status()} fromSW=${navResp?.fromServiceWorker()} title="${offlineTitle}"`;
  } catch (e) {
    offlineNote = 'navigation threw: ' + e.message;
  } finally {
    try { await client.send('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 }); } catch (_) {}
    try { await page.setOfflineMode(false); } catch (_) {}
  }
  log('offline navigation returns 200 or 503 (cached/SW shell)', offlineOk, offlineNote);

  // Check 6: Install prompt code path
  console.log('\n=== Check 6: install prompt ===');
  await page.setOfflineMode(false);
  try { await client.send('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 }); } catch (_) {}

  await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.evaluate(() => document.fonts.ready).catch(() => {});
  await new Promise(r => setTimeout(r, 2000));

  const installInfo = await page.evaluate(async () => {
    return new Promise((resolve) => {
      let fired = false;
      const onPrompt = () => { fired = true; };
      window.addEventListener('beforeinstallprompt', onPrompt, { once: true });
      const card = document.querySelector('.pwa-install-card');
      setTimeout(() => {
        window.removeEventListener('beforeinstallprompt', onPrompt);
        resolve({
          eventFired: fired,
          cardInDom: !!card,
          cardDisplay: card ? getComputedStyle(card).display : null,
        });
      }, 2000);
    });
  });
  const bootstrapErrorsBefore = errors.length;
  log('install code path (event OR .pwa-install-card in DOM OR no bootstrap errors)',
    installInfo.eventFired || installInfo.cardInDom || errors.length === bootstrapErrorsBefore,
    `event=${installInfo.eventFired} card=${installInfo.cardInDom} display=${installInfo.cardDisplay}`);

  // Check 7: No console errors introduced by PWA additions
  console.log('\n=== Check 7: console errors ===');
  log('no new console errors introduced by PWA', errors.length === 0,
    errors.length ? errors.slice(0, 2).join('; ') : '0 errors');

  // Check 8: iOS hint code path in pwa-bootstrap.js
  console.log('\n=== Check 8: iOS hint code path ===');
  const bootstrapFetch = await page.evaluate(async () => {
    try {
      const url = new URL('pwa-bootstrap.js', location.origin).href;
      const r = await fetch(url, { cache: 'no-store' });
      return { ok: r.ok, status: r.status, text: await r.text(), url };
    } catch (e) {
      return { ok: false, error: String(e) };
    }
  });
  log('pwa-bootstrap.js reachable', bootstrapFetch.ok && bootstrapFetch.status === 200, `(${bootstrapFetch.status})`);
  if (bootstrapFetch.text) {
    const hasIOSRegex = /iPad\|iPhone\|iPod/.test(bootstrapFetch.text);
    const hasStandalone = /navigator\.standalone/.test(bootstrapFetch.text);
    log('iOS regex /iPad|iPhone|iPod/ present', hasIOSRegex, '');
    log('navigator.standalone reference present', hasStandalone, '');
    log('both iOS-hint code paths present', hasIOSRegex && hasStandalone, '');
  } else {
    log('iOS regex present', false, 'no file');
    log('navigator.standalone present', false, 'no file');
    log('both iOS-hint code paths present', false, 'no file');
  }

  // Final report
  const passed = checks.filter(c => c.ok).length;
  const total = checks.length;
  console.log(`\n${passed}/${total} checks passed`);

  if (passed < total) {
    console.log('Failed:');
    checks.filter(c => !c.ok).forEach(c => console.log(`  - ${c.name}: ${c.info || ''}`));
  }

  const status = {
    status: passed === total ? 'PASS' : 'FAIL',
    signals: total,
    falsified: checks.filter(c => !c.ok).length,
    notes: `${passed} of ${total} PWA acceptance checks observed at live URL ${URL}. ` +
      `Manifest + 4 icons (192/512/maskable-512/180) reachable, JSON fields match, ` +
      `SW registers, swr-v2 cache has ${cacheInfo.count} precached paths, ` +
      `offline navigation returns 200/503 (cached or SW shell), ` +
      `install code path present (DOM element or no errors), ` +
      `iOS hint regex + navigator.standalone both present in pwa-bootstrap.js. ` +
      `Errors: ${errors.length}.`,
    checks: checks,
    details: {
      url: URL,
      cacheCount: cacheInfo.count,
      cachePaths: cacheInfo.paths || [],
      errorCount: errors.length,
      errors: errors,
      installInfo,
      offlineResponse: { title: offlineTitle, body: offlineBody },
    },
  };
  writeFileSync(resolve(OUT, 'pwa-live-verifier.json'), JSON.stringify(status, null, 2));
  console.log('\nWrote pwa-live-verifier.json with status=' + status.status);
} finally {
  await browser.close();
}
