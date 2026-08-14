// verify-presets.mjs — Phase 2 E2E: self-evolving engine preset ingest.
// Tests the live engine at https://sainted-word-records.vercel.app/engine:
//   1. /presets/manifest.json reachable, valid, has presets
//   2. Engine loads window.SWR_PRESETS and SWR_PRESETS_PANEL
//   3. On a fresh browser, the "N new personalities" pill appears
//   4. Clicking the pill opens the panel with one card per new preset
//   5. Each card has a thumbnail, name, family tag, palette, [Apply] [Dismiss]
//   6. Clicking Apply calls SWR_PRESETS.apply() and marks the preset as seen
//   7. After apply + dismiss-all, the pill disappears
//   8. localStorage['swr.presets.known'] tracks seen presets
//
// Usage: node verify-presets.mjs
//        FX_VERIFIER_URL=http://localhost:5174/engine node verify-presets.mjs

import puppeteer from 'puppeteer';

const URL = process.env.FX_VERIFIER_URL || 'https://sainted-word-records.vercel.app/engine';
const ROOT = URL.replace(/\/engine\/?$/, '');

const checks = [];
const pass = (m) => { checks.push({ ok: true, m }); console.log('✓', m); };
const fail = (m) => { checks.push({ ok: false, m }); console.log('✗', m); };

(async () => {
  console.log(`URL: ${URL}`);

  // 1. Manifest reachable
  const manifestResp = await fetch(ROOT + '/presets/manifest.json', { cache: 'no-store' });
  if (!manifestResp.ok) { fail(`manifest HTTP ${manifestResp.status}`); process.exit(1); }
  const manifest = await manifestResp.json();
  if (!Array.isArray(manifest.presets) || manifest.presets.length === 0) {
    fail('manifest has no presets'); process.exit(1);
  }
  pass(`manifest reachable with ${manifest.presets.length} preset(s)`);

  // 2. Engine loads
  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
    defaultViewport: { width: 1280, height: 800 },
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

  // Clear any prior known set so the pill appears
  await page.evaluate(() => localStorage.removeItem('swr.presets.known'));
  await page.reload({ waitUntil: 'domcontentloaded' });

  // Wait for SWR_PRESETS to be available
  await page.waitForFunction(() => !!(window.SWR_PRESETS && window.SWR_PRESETS_PANEL), { timeout: 30000 });
  pass('engine exposes window.SWR_PRESETS + window.SWR_PRESETS_PANEL');

  // Trigger load and wait for it to complete
  const loadResult = await page.evaluate(async () => {
    const r = await window.SWR_PRESETS.load();
    return { ok: r.ok, all: r.all ? r.all.length : 0, fresh: r.fresh ? r.fresh.length : 0 };
  });
  if (!loadResult.ok) { fail('SWR_PRESETS.load() did not return ok'); }
  else { pass(`SWR_PRESETS.load() ok: ${loadResult.all} total, ${loadResult.fresh} fresh`); }

  // 3. Pill appears
  const pillVisible = await page.evaluate(() => {
    const p = document.getElementById('presets-pill');
    if (!p) return null;
    return p.textContent.trim();
  });
  if (pillVisible && /\d+ new personalit/.test(pillVisible)) {
    pass(`pill appears with text: "${pillVisible}"`);
  } else {
    fail(`pill missing or wrong text: ${JSON.stringify(pillVisible)}`);
  }

  // 4. Click pill → panel opens
  await page.click('#presets-pill');
  await new Promise(r => setTimeout(r, 200));
  const panelOpen = await page.evaluate(() => {
    const panel = document.getElementById('presets-panel');
    if (!panel) return { exists: false };
    return { exists: true, hidden: panel.hidden, cards: panel.querySelectorAll('.presets-card').length };
  });
  if (panelOpen.exists && !panelOpen.hidden && panelOpen.cards === loadResult.fresh) {
    pass(`panel opens with ${panelOpen.cards} card(s)`);
  } else {
    fail(`panel state wrong: ${JSON.stringify(panelOpen)}`);
  }

  // 5. Card anatomy
  const firstCard = await page.evaluate(() => {
    const c = document.querySelector('.presets-card');
    if (!c) return null;
    return {
      id: c.dataset.id,
      hasName: !!c.querySelector('.presets-card-name')?.textContent.trim(),
      hasFamily: !!c.querySelector('.presets-card-family')?.textContent.trim(),
      hasDesc: !!c.querySelector('.presets-card-desc')?.textContent.trim(),
      paletteCount: c.querySelectorAll('.presets-color').length,
      hasThumb: !!c.querySelector('.presets-card-thumb svg'),
      hasApply: !!c.querySelector('.presets-apply'),
      hasDismiss: !!c.querySelector('.presets-dismiss'),
    };
  });
  if (firstCard && firstCard.hasName && firstCard.hasFamily && firstCard.hasDesc &&
      firstCard.paletteCount === 4 && firstCard.hasThumb && firstCard.hasApply && firstCard.hasDismiss) {
    pass(`first card has name/family/desc/4 colors/thumb/apply/dismiss`);
  } else {
    fail(`first card anatomy wrong: ${JSON.stringify(firstCard)}`);
  }

  // 6. Apply
  const applyResult = await page.evaluate(async () => {
    const r = window.SWR_PRESETS.apply('swr-preset-2026-08-14-barry-curl-snap');
    return { ok: r && r.ok, skipped: r ? r.fxResult.skipped : null };
  });
  if (applyResult.ok) {
    pass(`apply('swr-preset-2026-08-14-barry-curl-snap') ok (skipped: ${JSON.stringify(applyResult.skipped)})`);
  } else {
    fail(`apply returned: ${JSON.stringify(applyResult)}`);
  }

  // 7. After apply, that preset is in localStorage known
  const knownAfterApply = await page.evaluate(() => {
    try { return JSON.parse(localStorage.getItem('swr.presets.known')); } catch (_) { return null; }
  });
  if (Array.isArray(knownAfterApply) && knownAfterApply.includes('swr-preset-2026-08-14-barry-curl-snap')) {
    pass(`localStorage['swr.presets.known'] now contains the applied preset`);
  } else {
    fail(`localStorage known: ${JSON.stringify(knownAfterApply)}`);
  }

  // 8. Dismiss all → pill disappears
  await page.evaluate(() => {
    const btn = document.querySelector('.presets-dismiss-all');
    if (btn) btn.click();
  });
  await new Promise(r => setTimeout(r, 200));
  const pillAfterDismiss = await page.evaluate(() => !!document.getElementById('presets-pill'));
  if (!pillAfterDismiss) {
    pass('pill removed after Dismiss all');
  } else {
    fail('pill still present after Dismiss all');
  }

  // 9. Reload + re-check: no pill because all known
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => !!(window.SWR_PRESETS), { timeout: 30000 });
  // Give the auto-load (window 'load' handler with 800ms delay) time to run
  await new Promise(r => setTimeout(r, 1500));
  const pillAfterReload = await page.evaluate(() => !!document.getElementById('presets-pill'));
  if (!pillAfterReload) {
    pass('no pill on reload when all presets are known (localStorage persists)');
  } else {
    fail('pill appeared on reload despite all known — localStorage not honored');
  }

  // 10. Console errors
  const filtered = errors.filter(e =>
    !e.includes('favicon.ico') &&
    !e.includes('VERT is not defined') &&
    !e.includes('drawImage') &&
    !e.includes('InvalidStateError') &&
    !e.includes('library/p_0') &&  // pre-existing brandkit 404s
    !e.includes('worker')  // service worker / web worker noise
  );
  if (filtered.length === 0) {
    pass('no new console errors from preset ingest');
  } else {
    fail(`${filtered.length} new console error(s):`);
    for (const e of filtered.slice(0, 5)) console.log('     -', e);
  }

  await browser.close();
  const failed = checks.filter(c => !c.ok).length;
  console.log(`\n${checks.length - failed}/${checks.length} checks passed`);
  process.exit(failed === 0 ? 0 : 1);
})().catch((e) => {
  console.error('verifier crashed:', e);
  process.exit(2);
});
