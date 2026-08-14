// verify-presets-evolve.mjs — Phase 3 E2E: on-device variant evolution.
// Tests the live engine at https://sainted-word-records.vercel.app/engine:
//   1. Engine exposes window.SWR_PRESETS_EVOLVE with recordUsage/getVariants/evolveNow
//   2. Calling recordUsage() 3 times with the same persona generates a variant
//   3. The variant has the right shape: id, fx_state, motion, palette, _meta
//   4. The variant has its basePersona set
//   5. Calling apply() on the variant works (skips bloom)
//   6. The variant shows up in the panel with the "personal" badge
//   7. Dismiss removes the variant from the panel
//
// Usage: node verify-presets-evolve.mjs

import puppeteer from 'puppeteer';

const URL = process.env.FX_VERIFIER_URL || 'https://sainted-word-records.vercel.app/engine';

const checks = [];
const pass = (m) => { checks.push({ ok: true, m }); console.log('✓', m); };
const fail = (m) => { checks.push({ ok: false, m }); console.log('✗', m); };

(async () => {
  console.log(`URL: ${URL}`);

  const browser = await puppeteer.launch({
    headless: 'new',
    args: [
      '--no-sandbox', '--disable-setuid-sandbox',
      // Disable service workers so the PWA's controllerchange handler
      // (which calls location.reload() on first install) doesn't break the test.
      '--disable-features=ServiceWorker,ServiceWorkerOnUI',
    ],
    defaultViewport: { width: 1280, height: 800 },
  });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => {
    if (m.type() === 'error' && !m.text().includes('favicon.ico') && !m.text().includes('library/p_0')) {
      errors.push('console.error: ' + m.text());
    }
  });

  await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.evaluate(() => document.fonts && document.fonts.ready).catch(() => {});

  // Reset state so this run is reproducible
  await page.evaluate(() => {
    localStorage.removeItem('swr.presets.known');
    localStorage.removeItem('swr.persona.usage');
    localStorage.removeItem('swr.persona.variants');
  });
  await page.reload({ waitUntil: 'domcontentloaded' });

  // 1. Engine exposes SWR_PRESETS_EVOLVE
  await page.waitForFunction(() => !!window.SWR_PRESETS_EVOLVE, { timeout: 30000 });
  const apiShape = await page.evaluate(() => {
    const e = window.SWR_PRESETS_EVOLVE;
    return {
      hasRecordUsage:   typeof e.recordUsage === 'function',
      hasGetUsage:      typeof e.getUsage === 'function',
      hasGetVariants:   typeof e.getVariants === 'function',
      hasDismiss:       typeof e.dismissVariant === 'function',
      hasEvolveNow:     typeof e.evolveNow === 'function',
      threshold:        e.threshold,
    };
  });
  if (apiShape.hasRecordUsage && apiShape.hasGetUsage && apiShape.hasGetVariants &&
      apiShape.hasDismiss && apiShape.hasEvolveNow && apiShape.threshold >= 2) {
    pass(`SWR_PRESETS_EVOLVE exposed with full API (threshold=${apiShape.threshold})`);
  } else {
    fail(`API shape wrong: ${JSON.stringify(apiShape)}`);
  }

  // 2. Recording 3 uses of the same persona generates a variant
  const evolveResult = await page.evaluate(() => {
    // Force BPM + key so the variant has data to mutate from
    if (window.SWR && window.SWR.Audio && window.SWR.Audio.feat) {
      window.SWR.Audio.feat.bpm = 128;
      window.SWR.Audio.feat.key = 'A';
      window.SWR.Audio.feat.scale = 'minor';
    }
    // Use the public API directly to avoid the persona dropdown races
    const ev = window.SWR_PRESETS_EVOLVE;
    ev.recordUsage('raw');
    ev.recordUsage('raw');
    const v = ev.recordUsage('raw');  // 3rd → threshold hit
    return v;
  });
  if (evolveResult && typeof evolveResult === 'object') {
    pass(`recordUsage x3 generated a variant`);
  } else {
    fail(`recordUsage did not return a variant: ${JSON.stringify(evolveResult)}`);
  }

  // 3 & 4. Variant shape
  const variantShape = await page.evaluate(() => {
    const list = window.SWR_PRESETS_EVOLVE.getVariants();
    return list.length ? {
      hasId:           !!list[0].id,
      hasSchema:       list[0].schema === 'swr-preset/v1',
      hasFxState:      !!list[0].fx_state && typeof list[0].fx_state === 'object',
      fxKeyCount:      list[0].fx_state ? Object.keys(list[0].fx_state).length : 0,
      hasMotion:       !!list[0].motion && typeof list[0].motion === 'object',
      hasPalette:      !!list[0].palette && typeof list[0].palette === 'object',
      hasMeta:         !!list[0]._meta,
      basePersona:     list[0]._meta ? list[0]._meta.basePersona : null,
      bpmAvg:          list[0]._meta ? list[0]._meta.bpmAvg : null,
      dominantKey:     list[0]._meta ? list[0]._meta.dominantKey : null,
      dominantScale:   list[0]._meta ? list[0]._meta.dominantScale : null,
    } : null;
  });
  if (variantShape && variantShape.hasId && variantShape.hasSchema && variantShape.hasFxState &&
      variantShape.fxKeyCount === 15 && variantShape.hasMotion && variantShape.hasPalette &&
      variantShape.hasMeta && variantShape.basePersona === 'raw') {
    pass(`variant has 15-key fx_state + motion + palette + _meta.basePersona='raw' (bpm=${variantShape.bpmAvg}, key=${variantShape.dominantKey} ${variantShape.dominantScale})`);
  } else {
    fail(`variant shape wrong: ${JSON.stringify(variantShape)}`);
  }

  // 5. Apply the variant
  const applyResult = await page.evaluate(async () => {
    // Wait for SWR_PRESETS to be available, then load + apply
    if (window.SWR_PRESETS && window.SWR_PRESETS.load) {
      await window.SWR_PRESETS.load();
    }
    const v = window.SWR_PRESETS_EVOLVE.getVariants()[0];
    if (!v) return { ok: false, error: 'no variant' };
    return window.SWR_PRESETS.apply(v.id);
  });
  if (applyResult && applyResult.ok) {
    pass(`apply(variant) ok (skipped: ${JSON.stringify(applyResult.fxResult.skipped)})`);
  } else {
    fail(`apply(variant) failed: ${JSON.stringify(applyResult)}`);
  }

  // 6. Variant shows up in the panel with the "personal" badge
  // First, clear the known set so the variant + daily presets all appear fresh
  // (no page.reload — that triggers a PWA controllerchange reload that
  // races the verifier. Just clear + re-trigger load.)
  await page.evaluate(async () => {
    localStorage.removeItem('swr.presets.known');
    // small delay to let any in-flight load settle
    await new Promise(r => setTimeout(r, 50));
    if (window.SWR_PRESETS && window.SWR_PRESETS.load) {
      await window.SWR_PRESETS.load();
    }
  });
  // Give the panel handler a tick to mount the pill
  await page.waitForFunction(
    () => !!document.getElementById('presets-pill'),
    { timeout: 5000 }
  ).catch(() => {});
  const pill = await page.evaluate(() => {
    const p = document.getElementById('presets-pill');
    return p ? p.textContent.trim() : null;
  });
  if (pill && /\d+ new personalit/.test(pill)) {
    pass(`pill appears with variant: "${pill}"`);
  } else {
    fail(`pill missing: ${JSON.stringify(pill)}`);
  }
  // Track navigations
  await page.evaluate(() => {
    window.__navigations = [];
    window.addEventListener('beforeunload', () => { window.__navigations.push('beforeunload at ' + Date.now()); });
    window.addEventListener('unload', () => { window.__navigations.push('unload at ' + Date.now()); });
  });
  await page.click('#presets-pill');
  // Wait for the panel to be visible (sometimes the click races with the
  // panel's swr-presets-loaded rebuild). Up to 3s.
  await page.waitForFunction(
    () => {
      const p = document.getElementById('presets-panel');
      return p && !p.hidden;
    },
    { timeout: 3000 }
  ).catch(() => {});
  await new Promise(r => setTimeout(r, 100));
  const panelInfo = await page.evaluate(() => {
    const panel = document.getElementById('presets-panel');
    if (!panel) return { exists: false };
    const cards = Array.from(panel.querySelectorAll('.presets-card'));
    return {
      exists: true,
      hidden: panel.hidden,
      total: cards.length,
      withPersonalBadge: cards.filter(c => !!c.querySelector('.presets-card-personalized')).length,
    };
  });
  if (panelInfo && panelInfo.exists && panelInfo.total >= 1 && panelInfo.withPersonalBadge >= 1) {
    pass(`panel shows ${panelInfo.total} card(s), ${panelInfo.withPersonalBadge} with "★ personal" badge`);
  } else {
    fail(`panel state wrong: ${JSON.stringify(panelInfo)}`);
  }

  // 7. Dismiss the variant via API → it should be removed
  await page.evaluate(() => {
    const v = window.SWR_PRESETS_EVOLVE.getVariants()[0];
    if (v) window.SWR_PRESETS_EVOLVE.dismissVariant(v.id);
  });
  await new Promise(r => setTimeout(r, 200));
  const afterDismiss = await page.evaluate(() => window.SWR_PRESETS_EVOLVE.getVariants().length);
  if (afterDismiss === 0) {
    pass('dismissVariant removed the variant from localStorage');
  } else {
    fail(`after dismiss, ${afterDismiss} variant(s) still in localStorage`);
  }

  // 8. Console errors
  const filtered = errors.filter(e =>
    !e.includes('favicon.ico') &&
    !e.includes('VERT is not defined') &&
    !e.includes('drawImage') &&
    !e.includes('InvalidStateError') &&
    !e.includes('library/p_0') &&
    !e.includes('worker')
  );
  if (filtered.length === 0) {
    pass('no new console errors from evolve module');
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
