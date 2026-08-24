// verify-css-fx.mjs
// Verifies the CSS Video FX popup: 20 toggleable CSS classes applied to #stage.
// Uses FX_VERIFIER_URL env var to override the default live URL with localhost.
import puppeteer from 'puppeteer';

const URL = process.env.FX_VERIFIER_URL || 'https://sainted-word-records.vercel.app/engine';

const checks = [];
const log = (m) => console.log(m);
const pass = (m) => checks.push({ ok: true, msg: m });
const fail = (m) => { checks.push({ ok: false, msg: m }); console.log('✗', m); };

(async () => {
  log(`URL: ${URL}`);
  const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--disable-setuid-sandbox'] });
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1366, height: 900 });
    const consoleErrors = [];
    page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });

    await page.goto(URL, { waitUntil: 'networkidle2', timeout: 30000 });
    // Wait for CSSFX
    await page.waitForFunction(() => window.CSSFX && window.CSSFX.catalog && window.CSSFX.catalog.length > 0, { timeout: 10000 });

    // 1. Catalog has exactly 20 entries
    const catalogSize = await page.evaluate(() => window.CSSFX.catalog.length);
    catalogSize === 20 ? pass(`CSSFX.catalog has 20 entries`) : fail(`catalog size: ${catalogSize}`);

    // 2. Toggle button exists with count badge
    const btn = await page.$('#css-fx-toggle');
    btn ? pass('CSS FX button present in footer') : fail('CSS FX button missing');

    // 3. Click toggle → panel becomes visible
    await page.evaluate(() => document.querySelector('#css-fx-toggle').click());
    await new Promise((r) => setTimeout(r, 250));
    const panelVisible = await page.evaluate(() => {
      const p = document.querySelector('#css-fx-panel');
      return p && !p.hasAttribute('hidden') && p.classList.contains('show');
    });
    panelVisible ? pass('Panel opens on click') : fail('Panel did not open');

    // 4. 20 chips rendered
    const chipCount = await page.evaluate(() => document.querySelectorAll('.css-fx-chip').length);
    chipCount === 20 ? pass(`20 chips rendered`) : fail(`chip count: ${chipCount}`);

    // 5. Toggle a chip on → stage has the class + count goes to 1
    await page.evaluate(() => window.CSSFX.toggle('kenburns'));
    await new Promise((r) => setTimeout(r, 50));
    const on1 = await page.evaluate(() => ({
      stageHas: document.querySelector('#stage').classList.contains('kenburns'),
      chipOn: document.querySelector('.css-fx-chip[data-fx="kenburns"]').classList.contains('on'),
      count: document.querySelector('#css-fx-count').textContent,
      badge: document.querySelector('#css-fx-toggle').dataset.count,
    }));
    on1.stageHas && on1.chipOn && on1.count === '1' && on1.badge === '1'
      ? pass('Toggle ON: stage class + chip state + count all update')
      : fail(`toggle on: ${JSON.stringify(on1)}`);

    // 6. Toggle another chip
    await page.evaluate(() => window.CSSFX.toggle('film-grain'));
    const stack = await page.evaluate(() => ({
      stageClasses: [...document.querySelector('#stage').classList].filter(c => ['kenburns','film-grain','vhs','crt','hue-shift'].includes(c)),
      count: document.querySelector('#css-fx-count').textContent,
    }));
    stack.stageClasses.length === 2 && stack.count === '2'
      ? pass('Stack: two classes on #stage simultaneously')
      : fail(`stack: ${JSON.stringify(stack)}`);

    // 7. Toggle OFF one
    await page.evaluate(() => window.CSSFX.toggle('kenburns'));
    const off1 = await page.evaluate(() => ({
      has: document.querySelector('#stage').classList.contains('kenburns'),
      count: document.querySelector('#css-fx-count').textContent,
    }));
    !off1.has && off1.count === '1'
      ? pass('Toggle OFF: stage class removed, count decremented')
      : fail(`toggle off: ${JSON.stringify(off1)}`);

    // 8. Visual proof: page screenshot before/after applying vhs+crt
    const beforeShot = await page.screenshot({ type: 'png', clip: { x: 240, y: 56, width: 860, height: 720 } });
    await page.evaluate(() => {
      window.CSSFX.active.clear();
      window.CSSFX._syncUI();
      document.querySelector('#stage').className = document.querySelector('#stage').className.split(' ').filter(c => !['kenburns','film-grain','vhs','crt','hue-shift'].includes(c)).join(' ');
      window.CSSFX.toggle('vhs');
      window.CSSFX.toggle('crt');
    });
    await new Promise((r) => setTimeout(r, 200));
    const afterShot = await page.screenshot({ type: 'png', clip: { x: 240, y: 56, width: 860, height: 720 } });
    let byteDiffs = 0;
    const minLen = Math.min(beforeShot.length, afterShot.length);
    for (let i = 0; i < minLen; i++) if (beforeShot[i] !== afterShot[i]) byteDiffs++;
    byteDiffs > 1000
      ? pass(`Visual diff: vhs+crt visibly changes the stage (${byteDiffs} byte diffs)`)
      : fail(`vhs+crt produced no visible diff (${byteDiffs})`);

    // 9. Persistence: reload and confirm state survives
    await page.evaluate(() => localStorage.setItem('swr-cssfx-active', JSON.stringify(['vhs','crt','hue-shift'])));
    await page.reload({ waitUntil: 'networkidle2' });
    await page.waitForFunction(() => window.CSSFX && window.CSSFX.active, { timeout: 10000 });
    const restored = await page.evaluate(() => ({
      active: [...window.CSSFX.active],
      stageClasses: [...document.querySelector('#stage').classList].filter(c => ['vhs','crt','hue-shift'].includes(c)),
    }));
    restored.active.length === 3 && restored.stageClasses.length === 3
      ? pass('Persistence: state restored after reload')
      : fail(`restore: ${JSON.stringify(restored)}`);

    // 10. Clear-all
    await page.evaluate(() => window.CSSFX.clear());
    const cleared = await page.evaluate(() => ({
      active: window.CSSFX.active.size,
      stageClasses: [...document.querySelector('#stage').classList].filter(c => ['vhs','crt','hue-shift','kenburns','film-grain'].includes(c)).length,
      count: document.querySelector('#css-fx-count').textContent,
    }));
    cleared.active === 0 && cleared.stageClasses === 0 && cleared.count === '0'
      ? pass('Clear all: all classes removed, badge=0')
      : fail(`clear: ${JSON.stringify(cleared)}`);

    // 11. Escape closes the panel
    await page.evaluate(() => window.CSSFX.setOpen(true));
    await new Promise((r) => setTimeout(r, 200));
    await page.keyboard.press('Escape');
    await new Promise((r) => setTimeout(r, 250));
    const closedByEsc = await page.evaluate(() => document.querySelector('#css-fx-panel').hasAttribute('hidden'));
    closedByEsc ? pass('Escape closes the panel') : fail('Escape did not close panel');

    // 12. No console errors
    if (consoleErrors.length === 0) pass('No new console errors');
    else { fail(`${consoleErrors.length} console error(s)`); consoleErrors.forEach((e) => console.log('  -', e)); }

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
