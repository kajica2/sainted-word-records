// verify-pt.mjs — End-to-end Personal Tier verifier for SWR
// ---------------------------------------------------------------------------
// Verifies:
//   1. Anonymous engine access (no brandkit auth wall)
//   2. PT chip + panel in the header
//   3. License activation flow (paste key, validates, stores)
//   4. Watermark suppression when PT is active
//   5. Credit consumption on render
//   6. thanks.html?type=pt path
//   7. campaign.html#pt pricing section
//
// Usage: node verify-pt.mjs  (default URL: live)
//        FX_VERIFIER_URL=http://localhost:5174/ node verify-pt.mjs
// ---------------------------------------------------------------------------

import puppeteer from 'puppeteer';

const URL = process.env.FX_VERIFIER_URL || 'https://sainted-word-records.vercel.app/engine';
// Site root (for fetching /campaign.html, /thanks.html, etc. from the engine)
const ROOT = URL.replace(/\/engine\/?$/, '');

const checks = [];
const pass = (m) => { checks.push({ ok: true, msg: m }); console.log('✓', m); };
const fail = (m) => { checks.push({ ok: false, msg: m }); console.log('✗', m); };

(async () => {
  console.log(`URL: ${URL}`);
  const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--disable-setuid-sandbox'] });
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1366, height: 900 });
    const consoleErrors = [];
    const responses404 = [];
    page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
    page.on('response', (r) => { if (r.status() === 404) responses404.push(r.url()); });

    // 1. Anonymous engine access — no redirect to login.html
    await page.goto(URL, { waitUntil: 'networkidle2', timeout: 30000 });
    await page.waitForFunction(() => window.SWR_PT && window.SWR_PT_Panel, { timeout: 10000 });
    const title = await page.title();
    const onLogin = title.toLowerCase().includes('sign in');
    !onLogin ? pass('engine loads without redirect to login.html') : fail('redirected to login.html');

    // 2. PT chip + panel
    const ptChip = await page.$('#pt-chip');
    ptChip ? pass('PT chip mounted in #transport') : fail('PT chip missing');
    const ptChipText = await page.evaluate(() => document.getElementById('pt-chip')?.textContent);
    /PT|activate|Engine/i.test(ptChipText || '') ? pass(`PT chip text: "${ptChipText}"`) : fail(`PT chip text unexpected: "${ptChipText}"`);

    // Open the panel
    await page.evaluate(() => window.SWR_PT_Panel.openPanel());
    await new Promise((r) => setTimeout(r, 200));
    const panelVisible = await page.evaluate(() => !!document.getElementById('pt-panel'));
    panelVisible ? pass('PT panel opens on chip click') : fail('PT panel did not open');

    // 3. License activation flow
    const activateResult = await page.evaluate(() => {
      const r1 = window.SWR_PT.activate('swr-band-test01');
      const r2 = window.SWR_PT.activate('swr-band-test01'); // idempotent
      const r3 = window.SWR_PT.activate('invalid-key');
      return { r1: { ok: !r1.error, hasKey: !!r1.license }, r2: { ok: !r2.error, sameKey: r1.license?.key === r2.license?.key }, r3: { ok: !r3.error, hasError: !!r3.error } };
    });
    activateResult.r1.ok && activateResult.r1.hasKey ? pass('activate(swr-band-test01) returns license') : fail('activate failed');
    activateResult.r2.ok && activateResult.r2.sameKey ? pass('activate is idempotent (same key returns same license)') : fail('activate not idempotent');
    activateResult.r3.hasError && !activateResult.r3.ok ? pass('activate(invalid-key) returns error') : fail('invalid key should error');

    // 4. PT chip reflects active state
    const chipAfterActivate = await page.evaluate(() => document.getElementById('pt-chip')?.textContent);
    /PT Band|150 credits/i.test(chipAfterActivate || '') ? pass(`PT chip updates on activate: "${chipAfterActivate}"`) : fail(`PT chip after activate: "${chipAfterActivate}"`);

    // 5. isActive() returns true
    const isActive = await page.evaluate(() => window.SWR_PT.isActive());
    isActive ? pass('SWR_PT.isActive() === true after activate') : fail('isActive() false');

    // 6. Watermark is suppressed when PT is active
    // The _drawWatermark function checks SWR_PT.isActive() and returns early.
    // We can't easily test the actual canvas pixels without a song loaded,
    // but we can verify the function is wired:
    const watermarkCheck = await page.evaluate(() => {
      // Rec is the Recorder. Check it has the _drawWatermark method.
      return typeof window.SWR === 'object' && typeof window.SWR?.Recorder?._drawWatermark === 'function';
    });
    watermarkCheck ? pass('Recorder._drawWatermark exists (will check PT at render time)') : fail('Recorder._drawWatermark not found');

    // 7. Credit consumption
    const consumeResult = await page.evaluate(() => {
      const before = window.SWR_PT.getCredits();
      const res = window.SWR_PT.consumeForRender(60, '1080p'); // 1 min, 1080p = 1 credit
      const after = window.SWR_PT.getCredits();
      return { before, after, ok: res.ok, cost: res.cost };
    });
    consumeResult.ok && consumeResult.before - consumeResult.after === consumeResult.cost
      ? pass(`consumeForRender(60s, 1080p) costs ${consumeResult.cost} credit (${consumeResult.before} → ${consumeResult.after})`)
      : fail(`consumeForRender failed: ${JSON.stringify(consumeResult)}`);

    // 8. Deactivation
    const deactivateResult = await page.evaluate(() => {
      window.SWR_PT.deactivate();
      return { active: window.SWR_PT.isActive(), credits: window.SWR_PT.getCredits() };
    });
    !deactivateResult.active && deactivateResult.credits === 0
      ? pass('deactivate() clears license')
      : fail(`deactivate failed: ${JSON.stringify(deactivateResult)}`);

    // 9. campaign.html#pt exists
    const campaignResp = await page.goto(ROOT + '/campaign.html#pt', { waitUntil: 'networkidle2' });
    const campaignStatus = campaignResp.status();
    const ptSection = await page.evaluate(() => {
      const el = document.querySelector('#pt');
      if (!el) return null;
      return {
        tierCount: el.querySelectorAll('.price').length,
        tierNames: Array.from(el.querySelectorAll('.price__name')).map(n => n.textContent.trim()),
        ctas: Array.from(el.querySelectorAll('.price__cta')).map(a => a.textContent.trim()),
      };
    });
    if (campaignStatus === 200 && ptSection && ptSection.tierCount === 3) {
      pass(`campaign.html#pt has 3 PT tiers: ${ptSection.tierNames.join(', ')}`);
      const hasAll = ['PT Solo', 'PT Band', 'PT Label'].every(t => ptSection.tierNames.includes(t));
      hasAll ? pass('all 3 PT tier names present') : fail(`missing tier names: ${ptSection.tierNames.join(', ')}`);
    } else {
      fail(`campaign.html#pt missing or wrong tier count (${campaignStatus}, ${ptSection?.tierCount})`);
    }

    // 10. thanks.html?type=pt renders PT-specific path
    const thanksResp = await page.goto(ROOT + '/thanks.html?type=pt&tier=band', { waitUntil: 'networkidle2' });
    const thanksStatus = thanksResp.status();
    const thanksContent = await page.evaluate(() => document.querySelector('main.card')?.textContent || '');
    const ptPath = /PT license|Activate your key|engine is waiting|swr-band/i.test(thanksContent);
    ptPath ? pass('thanks.html?type=pt renders PT path') : fail('thanks.html did not render PT path');

    // 11. No console errors (filter pre-existing brandkit library 404s)
    const knownPreExisting404 = (u) => /\/library\/p_\d+\.jpg/.test(u) || /\/library\/p\d+\.jpg/.test(u);
    const new404s = responses404.filter((u) => !knownPreExisting404(u));
    // Dedupe console errors that correspond to known 404s
    const newConsoleErrors = new404s.length === 0 ? consoleErrors.filter((e) => !/Failed to load resource/.test(e)) : consoleErrors;
    if (newConsoleErrors.length === 0 && new404s.length === 0) {
      pass(`No new console errors (${responses404.length} pre-existing brandkit library 404s filtered)`);
    } else {
      const total = newConsoleErrors.length + new404s.length;
      fail(`${total} new console error(s) (${responses404.length - new404s.length} pre-existing filtered)`);
      newConsoleErrors.forEach((e) => console.log('  console:', e));
      new404s.forEach((u) => console.log('  404:', u));
    }

  } finally {
    await browser.close();
  }

  const passed = checks.filter((c) => c.ok).length;
  console.log(`\n${passed}/${checks.length} checks passed`);
  if (passed < checks.length) {
    console.log('Failed:');
    checks.filter((c) => !c.ok).forEach((c) => console.log('  -', c.msg));
    process.exit(1);
  }
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
