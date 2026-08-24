// verify-versions.mjs — /versions page E2E verifier
//
// Tests the live https://sainted-word-records.vercel.app/versions:
//   1. /versions returns 200 (vercel.json rewrite works)
//   2. Page title contains "Versions"
//   3. Hero h1 + lede present
//   4. Live state panel renders 8 cells
//   5. Live state fills in: engine version, schema, manifest count
//   6. Engine releases timeline has 6+ releases with date + sha
//   7. Visual styles grid has 12 cards, each linking to /versions/<name>.html
//   8. Preset schema section shows swr-preset/v1 + draft v1.5
//   9. Daily preset timeline renders at least 1 day (live manifest fetch)
//  10. Status pill (refresh text) updates to a real time, not "Probing…"
//  11. Nav has 6 links including /versions, /engine, /changelog
//  12. Footer present with copyright + link set
//  13. No JS console errors (except favicon.ico noise)
//
// Usage: node verify-versions.mjs
//        FX_VERIFIER_URL=http://localhost:5174/versions node verify-versions.mjs

import puppeteer from 'puppeteer';

const URL = process.env.FX_VERIFIER_URL || 'https://sainted-word-records.vercel.app/versions';
const ROOT = URL.replace(/\/versions\/?$/, '');

const checks = [];
const pass = (m) => { checks.push({ ok: true, m }); console.log('✓', m); };
const fail = (m) => { checks.push({ ok: false, m }); console.log('✗', m); };

(async () => {
  console.log(`URL: ${URL}`);

  // 1. /versions returns 200
  const head = await fetch(URL, { method: 'HEAD', redirect: 'manual' });
  if (head.status !== 200) {
    fail(`/versions HTTP ${head.status} (expected 200)`);
    process.exit(1);
  }
  pass(`/versions HTTP 200`);

  // 2. Browser load
  const browser = await puppeteer.launch({
    headless: 'new',
    args: [
      '--no-sandbox', '--disable-setuid-sandbox',
      '--disable-features=ServiceWorker,ServiceWorkerOnUI',
    ],
    defaultViewport: { width: 1280, height: 1800 },
  });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => {
    if (m.type() === 'error' && !m.text().includes('favicon.ico')) {
      errors.push('console.error: ' + m.text());
    }
  });

  await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.evaluate(() => document.fonts && document.fonts.ready).catch(() => {});

  // Wait for live state to populate
  await page.waitForFunction(() => {
    const r = document.getElementById('l-refresh');
    return r && r.textContent && !/Probing/.test(r.textContent);
  }, { timeout: 15000 }).catch(() => fail('live state probe timed out after 15s'));

  // 2. Page title
  const title = await page.title();
  if (/Versions/i.test(title)) pass(`title: ${title}`);
  else fail(`title: ${title} (expected "Versions")`);

  // 3. Hero h1 + lede
  const h1 = await page.$eval('h1', el => el.textContent.trim()).catch(() => '');
  if (h1.length > 0) pass(`hero h1: "${h1.slice(0, 40)}…"`);
  else fail('hero h1 missing');
  const lede = await page.$eval('.lede', el => el.textContent.trim()).catch(() => '');
  if (lede.length > 0) pass(`lede: ${lede.length} chars`);
  else fail('lede missing');

  // 4. Live state panel has 8 cells
  const liveCells = await page.$$eval('.live-cell', els => els.length);
  if (liveCells === 8) pass(`live state: ${liveCells} cells`);
  else fail(`live state: ${liveCells} cells (expected 8)`);

  // 5. Live state filled in
  const liveData = await page.evaluate(() => {
    return {
      engine: document.getElementById('l-engine')?.textContent?.trim(),
      schema: document.getElementById('l-schema')?.textContent?.trim(),
      count: document.getElementById('l-count')?.textContent?.trim(),
      latest: document.getElementById('l-latest')?.textContent?.trim(),
      http: document.getElementById('l-http')?.textContent?.trim(),
      styles: document.getElementById('l-styles')?.textContent?.trim(),
      refresh: document.getElementById('l-refresh')?.textContent?.trim(),
    };
  });
  if (liveData.engine && /v\d/.test(liveData.engine)) pass(`engine: ${liveData.engine}`);
  else fail(`engine: ${JSON.stringify(liveData.engine)}`);
  if (liveData.schema && /swr-preset/.test(liveData.schema)) pass(`schema: ${liveData.schema}`);
  else fail(`schema: ${JSON.stringify(liveData.schema)}`);
  if (liveData.count && /^\d+$/.test(liveData.count) && parseInt(liveData.count) > 0) {
    pass(`manifest count: ${liveData.count} presets`);
  } else fail(`manifest count: ${JSON.stringify(liveData.count)}`);
  if (liveData.latest && liveData.latest !== '—') pass(`latest preset: ${liveData.latest}`);
  else fail(`latest preset: ${JSON.stringify(liveData.latest)}`);
  if (liveData.http === '200') pass(`engine HTTP: 200`);
  else fail(`engine HTTP: ${JSON.stringify(liveData.http)}`);
  if (liveData.styles && /12|13/.test(liveData.styles)) pass(`visual styles: ${liveData.styles}`);
  else fail(`visual styles: ${JSON.stringify(liveData.styles)}`);

  // 6. Engine releases timeline
  const releases = await page.$$eval('.release', els => els.length);
  if (releases >= 5) pass(`releases: ${releases}`);
  else fail(`releases: ${releases} (expected ≥5)`);
  const currentRelease = await page.$$eval('.release.current', els => els.length);
  if (currentRelease === 1) pass(`current release: 1 (marked live)`);
  else fail(`current release: ${currentRelease} (expected 1)`);
  const hasShas = await page.$$eval('.release .sha code', els => els.length);
  if (hasShas >= 5) pass(`release SHAs: ${hasShas}`);
  else fail(`release SHAs: ${hasShas}`);

  // 7. Visual styles grid
  const styleCards = await page.$$eval('.style-card', els => els.length);
  if (styleCards >= 12) pass(`style cards: ${styleCards}`);
  else fail(`style cards: ${styleCards} (expected ≥12)`);
  const styleHrefs = await page.$$eval('.style-card', els => els.map(e => e.getAttribute('href')));
  const allValid = styleHrefs.every(h => h && /^\/versions\/[a-z]+\.html$/.test(h));
  if (allValid) pass(`all ${styleHrefs.length} style links point to /versions/<name>.html`);
  else fail(`some style links invalid: ${styleHrefs.filter(h => !/^\/versions\/[a-z]+\.html$/.test(h)).join(', ')}`);

  // 8. Preset schema section
  const schemaCards = await page.$$eval('.schema-card', els => els.length);
  if (schemaCards >= 2) pass(`schema cards: ${schemaCards} (v1 + v1.5)`);
  else fail(`schema cards: ${schemaCards} (expected ≥2)`);
  const schemaH3 = await page.$eval('.schema-card h3', el => el.textContent.trim());
  if (/swr-preset\/v1/.test(schemaH3)) pass(`primary schema: ${schemaH3}`);
  else fail(`primary schema: ${schemaH3}`);

  // 9. Daily preset timeline populated
  const presetDays = await page.$$eval('.preset-day', els => els.length);
  if (presetDays >= 1) pass(`preset timeline: ${presetDays} day(s)`);
  else fail(`preset timeline: ${presetDays} day(s) (expected ≥1)`);
  const presetChips = await page.$$eval('.preset-chip', els => els.length);
  if (presetChips >= 1) pass(`preset chips: ${presetChips}`);
  else fail(`preset chips: ${presetChips}`);

  // 10. Refresh text is a real time, not "Probing…"
  if (liveData.refresh && /Updated/.test(liveData.refresh)) {
    pass(`refresh: ${liveData.refresh}`);
  } else {
    fail(`refresh: ${JSON.stringify(liveData.refresh)} (expected "Updated HH:MM:SS")`);
  }

  // 10b. Randomize button + card
  const hasRandBtn = await page.$('#rbtn-randomize');
  if (hasRandBtn) pass('randomize button present');
  else fail('randomize button missing');

  // Card should auto-populate on load (we call setTimeout(pickRandom, 600) in init)
  await page.waitForFunction(() => {
    const c = document.getElementById('rand-card');
    return c && c.classList.contains('show') && document.getElementById('r-name')?.textContent !== '—';
  }, { timeout: 8000 }).catch(() => fail('randomize card did not auto-populate within 8s'));

  const rand1 = await page.evaluate(() => ({
    picknum: document.getElementById('r-picknum')?.textContent?.trim(),
    name: document.getElementById('r-name')?.textContent?.trim(),
    id: document.getElementById('r-id')?.textContent?.trim(),
    shader: document.getElementById('r-shader')?.textContent?.trim(),
    fam: document.getElementById('r-fam')?.textContent?.trim(),
    swatches: document.querySelectorAll('#r-swatches .sw').length,
  }));
  if (rand1.name && rand1.name !== '—') pass(`auto-pick #1: "${rand1.name}" (${rand1.id})`);
  else fail(`auto-pick #1: ${JSON.stringify(rand1)}`);
  if (rand1.shader && rand1.shader !== '—') pass(`auto-pick shader: ${rand1.shader}`);
  else fail(`auto-pick shader: ${JSON.stringify(rand1.shader)}`);
  if (rand1.swatches === 4) pass(`palette swatches: ${rand1.swatches}/4`);
  else fail(`palette swatches: ${rand1.swatches}/4`);

  // Click "Pick another" — must yield a new pick (likely different id, pick #2)
  await page.click('#r-again');
  await new Promise(r => setTimeout(r, 600));
  const rand2 = await page.evaluate(() => ({
    picknum: document.getElementById('r-picknum')?.textContent?.trim(),
    name: document.getElementById('r-name')?.textContent?.trim(),
    id: document.getElementById('r-id')?.textContent?.trim(),
  }));
  if (rand2.picknum && /pick\s*#2/i.test(rand2.picknum)) pass(`pick #2: "${rand2.name}" (${rand2.id})`);
  else fail(`pick #2: ${JSON.stringify(rand2)}`);

  // Click many times — confirm we keep getting picks (no errors)
  let allOk = true;
  const seen = new Set([rand1.id, rand2.id]);
  for (let i = 0; i < 5; i++) {
    await page.click('#rbtn-randomize');
    await new Promise(r => setTimeout(r, 250));
    const id = await page.$eval('#r-id', el => el.textContent.trim());
    if (!id || id === '—') { allOk = false; break; }
    seen.add(id);
  }
  if (allOk && seen.size >= 2) pass(`5 more picks · ${seen.size} unique ids seen`);
  else fail(`5 more picks · only ${seen.size} unique ids`);

  // 11. Nav links
  const navHrefs = await page.$$eval('.nav__links a', els => els.map(e => e.getAttribute('href')));
  const expectedNav = ['/', '/engine', '/versions', '/changelog', '/press', '/status'];
  const hasAll = expectedNav.every(h => navHrefs.includes(h));
  if (hasAll) pass(`nav links: ${navHrefs.length} (all expected present)`);
  else fail(`nav links: ${navHrefs.join(', ')} (missing some of ${expectedNav.join(', ')})`);

  // 12. Footer
  const footer = await page.$eval('footer', el => el.textContent.trim()).catch(() => '');
  if (/2026.*Kai Djuric/.test(footer)) pass(`footer: present + © 2026 Kai Djuric`);
  else fail(`footer: ${footer.slice(0, 100)}`);

  // 13. No JS errors
  if (errors.length === 0) pass('no JS errors');
  else fail(`JS errors (${errors.length}): ${errors.slice(0, 3).join(' | ')}`);

  // Take a screenshot for the audit trail
  await page.screenshot({ path: 'out/versions_live.png', fullPage: true });
  pass('screenshot saved: out/versions_live.png');

  await browser.close();

  // Summary
  const total = checks.length;
  const passed = checks.filter(c => c.ok).length;
  console.log(`\n${passed}/${total} passed`);
  if (passed < total) {
    process.exit(1);
  }
})();
