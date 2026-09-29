// verify-pt.mjs — End-to-end Personal Tier verifier for SWR
// ---------------------------------------------------------------------------
// Verifies:
//   1. Anonymous engine access (no brandkit auth wall)
//   2. PT chip + panel in the header
//   3. License activation flow (paste key, validates, stores)
//   4. The mark stays forced while PT is active (there is no suppression path)
//   5. Credit consumption accounting (the export path no longer charges)
//   6. thanks.html?type=pt path
//   7. campaign.html#pt pricing section
//
// Usage: node verify-pt.mjs  (default URL: live)
//        FX_VERIFIER_URL=http://localhost:5174/ node verify-pt.mjs
// ---------------------------------------------------------------------------

import puppeteer from 'puppeteer';

const URL = process.env.FX_VERIFIER_URL || 'https://sainted-word-records.vercel.app/engine';
// Site root (for fetching /campaign.html, /thanks.html, etc. from the engine)
const ROOT = process.env.SITE_ROOT || URL.replace(/\/engine(\.html)?\/?$/, '');

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

    // 6. The mark stays forced while PT is active — there is no suppression path
    const forcedWithPt = await page.evaluate(async () => {
      const src = document.createElement('canvas');
      src.width = 1280; src.height = 720;
      src.style.cssText = 'position:fixed;left:-2000px;top:0';
      const sctx = src.getContext('2d');
      sctx.fillStyle = '#000'; sctx.fillRect(0, 0, 1280, 720);
      document.body.appendChild(src);
      const hasForcing = typeof window.SWR_WATERMARK?.frameSource === 'function';
      const comp = hasForcing ? window.SWR_WATERMARK.frameSource(src) : null;
      if (!comp) { src.remove(); return { hasForcing, marked: false, bright: 0, ptActive: window.SWR_PT.isActive() }; }
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      const w = comp.width, h = comp.height;
      const targetW = Math.round(w * 0.18);
      const margin = Math.round(Math.min(w, h) * 0.033);
      const data = comp.getContext('2d').getImageData(w - targetW - margin, h - 240 - margin, targetW, 240).data;
      let bright = 0;
      for (let i = 0; i < data.length; i += 4) if (data[i] + data[i + 1] + data[i + 2] > 90) bright++;
      src.remove();
      return { hasForcing, marked: bright > 50, bright, ptActive: window.SWR_PT.isActive() };
    });
    forcedWithPt.ptActive ? pass('PT is active during the watermark check') : fail('PT not active (check 3 activates it)');
    forcedWithPt.hasForcing && forcedWithPt.marked
      ? pass(`mark still forced with PT active (${forcedWithPt.bright} px on the captured surface)`)
      : fail(`mark missing with PT active (forcing=${forcedWithPt.hasForcing}, bright=${forcedWithPt.bright})`);

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

    // 11. No console errors (filter pre-existing brandkit library 404s, and the
    // routes only the deployed site answers — /api/auth/session, /null)
    const knownPreExisting404 = (u) => /\/library\/p_\d+\.jpg/.test(u) || /\/library\/p\d+\.jpg/.test(u) || /\/api\//.test(u) || /\/null$/.test(u);
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
