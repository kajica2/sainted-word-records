// verify-agi-bg.mjs
// Verifies the HF Space embed panels (AGI BG + MG AGI).
// Confirms: footer toggle buttons present, both panels render with iframe +
// fallback, open/close works for each, state pills settle, both panels can be
// open simultaneously, clicking one panel's toggle doesn't close the other.
//
// Override the URL with AGI_BG_VERIFIER_URL to point at a local dev server
// (e.g. http://127.0.0.1:4173/engine.html) for faster iteration.
import puppeteer from 'puppeteer';

const URL = process.env.AGI_BG_VERIFIER_URL || 'https://sainted-word-records.vercel.app/engine';

const PANELS = [
  {
    key:      'agi-bg',
    space:    'kaidjuric-agi-background-working-system.hf.space',
    toggleId: 'agi-bg-toggle',
    panelId:  'agi-bg-panel',
    frameId:  'agi-bg-frame',
    stateId:  'agi-bg-state',
    fallbackId: 'agi-bg-fallback',
  },
  {
    key:      'mg-agi',
    space:    'kaidjuric-motion-graphic-designer-agi-system.static.hf.space',
    toggleId: 'mg-agi-toggle',
    panelId:  'mg-agi-panel',
    frameId:  'mg-agi-frame',
    stateId:  'mg-agi-state',
    fallbackId: 'mg-agi-fallback',
  },
];

const checks = [];
const log = (m) => console.log(m);
const pass = (m) => checks.push({ ok: true, msg: m });
const fail = (m) => { checks.push({ ok: false, msg: m }); console.log('  ✗', m); };

async function isOpen(page, panelId) {
  return page.evaluate((id) => {
    const p = document.getElementById(id);
    return p && !p.hasAttribute('hidden') && p.classList.contains('show');
  }, panelId);
}

async function closeViaOutside(page) {
  // Click on a known neutral surface (the stage element).
  await page.evaluate(() => document.getElementById('stage').click());
  await new Promise((r) => setTimeout(r, 350));
}

async function checkPanel(page, p) {
  // 1. Toggle button is in the footer.
  const togglePresent = await page.evaluate((id) => !!document.getElementById(id), p.toggleId);
  togglePresent ? pass(`${p.key}: toggle present in footer`) : fail(`${p.key}: toggle missing`);

  // 2. Panel markup exists (closed).
  const panelMarkup = await page.evaluate(({ panelId, frameId, fallbackId }) => {
    const pn = document.getElementById(panelId);
    const fr = document.getElementById(frameId);
    const fb = document.getElementById(fallbackId);
    return pn && fr && fb ? { hidden: pn.hasAttribute('hidden'), frameSrc: fr.getAttribute('src') } : null;
  }, p);
  panelMarkup
    ? pass(`${p.key}: panel markup present (hidden=${panelMarkup.hidden})`)
    : fail(`${p.key}: panel/frame/fallback markup missing`);

  // 3. Click toggle → panel opens.
  await page.evaluate((id) => document.getElementById(id).click(), p.toggleId);
  await new Promise((r) => setTimeout(r, 350));
  const opened = await isOpen(page, p.panelId);
  opened ? pass(`${p.key}: panel opens on toggle click`) : fail(`${p.key}: panel did not open`);

  // 4. Iframe src is set to the right Space URL.
  const iframeSrc = await page.evaluate((id) => document.getElementById(id).src, p.frameId);
  iframeSrc.includes(p.space)
    ? pass(`${p.key}: iframe src points at ${p.space}`)
    : fail(`${p.key}: iframe src wrong: ${iframeSrc}`);

  // 5. State pill settles to "embed" or "offline" within 10s.
  log(`  …${p.key}: waiting up to 10s for state pill to settle`);
  const settled = await page.waitForFunction(
    (id) => {
      const s = document.getElementById(id);
      return s && (s.dataset.state === 'embed' || s.dataset.state === 'offline');
    },
    { timeout: 10000 },
    p.stateId,
  ).then(() => true).catch(() => false);

  const stateInfo = await page.evaluate((stateId, fallbackId, frameId) => {
    const s  = document.getElementById(stateId);
    const fb = document.getElementById(fallbackId);
    const fr = document.getElementById(frameId);
    return {
      state: s ? s.dataset.state : null,
      fallbackVisible: fb ? !fb.hasAttribute('hidden') : null,
      frameVisible: fr ? fr.style.display !== 'none' : null,
    };
  }, p.stateId, p.fallbackId, p.frameId);
  settled
    ? pass(`${p.key}: state pill settled (${stateInfo.state})`)
    : fail(`${p.key}: state pill did not settle: ${JSON.stringify(stateInfo)}`);

  if (stateInfo.state === 'offline') {
    stateInfo.fallbackVisible
      ? pass(`${p.key}: fallback shown when offline`)
      : fail(`${p.key}: fallback should be visible when offline`);
  } else if (stateInfo.state === 'embed') {
    stateInfo.fallbackVisible === false
      ? pass(`${p.key}: fallback hidden when embed`)
      : fail(`${p.key}: fallback should be hidden when embed`);
  }

  // 6. Close it again.
  await closeViaOutside(page);
  const closed = !(await isOpen(page, p.panelId));
  closed ? pass(`${p.key}: panel closes on outside click`) : fail(`${p.key}: panel did not close`);
}

(async () => {
  log(`URL: ${URL}`);
  const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--disable-setuid-sandbox'] });
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1366, height: 900 });
    const consoleErrors = [];
    page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });

    // Force both panels closed at start so we test the open path from scratch.
    await page.evaluateOnNewDocument(() => {
      try {
        localStorage.setItem('swr.agi-bg-panel-open', '0');
        localStorage.setItem('swr.mg-agi-panel-open', '0');
      } catch (e) {}
    });

    await page.goto(URL, { waitUntil: 'networkidle2', timeout: 45000 });

    // Run the standard checks for each panel independently.
    for (const p of PANELS) {
      await checkPanel(page, p);
    }

    // 7. Both panels open simultaneously + cross-toggle doesn't dismiss.
    await page.evaluate((id) => document.getElementById(id).click(), PANELS[0].toggleId);
    await new Promise((r) => setTimeout(r, 200));
    await page.evaluate((id) => document.getElementById(id).click(), PANELS[1].toggleId);
    await new Promise((r) => setTimeout(r, 350));
    const bothOpen =
      (await isOpen(page, PANELS[0].panelId)) &&
      (await isOpen(page, PANELS[1].panelId));
    bothOpen
      ? pass('both panels can be open simultaneously')
      : fail('only one panel stayed open after toggling the other');

    // 8. Position check — panels should not overlap (one left, one right).
    const overlap = await page.evaluate((ids) => {
      const a = document.getElementById(ids[0]).getBoundingClientRect();
      const b = document.getElementById(ids[1]).getBoundingClientRect();
      const overlapX = !(a.right <= b.left || b.right <= a.left);
      const overlapY = !(a.bottom <= b.top || b.bottom <= a.top);
      return overlapX && overlapY;
    }, [PANELS[0].panelId, PANELS[1].panelId]);
    !overlap
      ? pass('panels do not visually overlap')
      : fail('panels overlap each other — collision detected');

    // 9. No fatal console errors.
    const fatal = consoleErrors.filter((m) =>
      !m.includes('favicon') &&
      !m.includes('source map') &&
      !m.includes('404') // HF Space 404 inside iframe is expected
    );
    fatal.length === 0
      ? pass(`no fatal console errors (${consoleErrors.length} total, all benign)`)
      : fail(`unexpected console errors:\n  ${fatal.join('\n  ')}`);

  } catch (e) {
    fail(`exception: ${e.message}`);
    console.error(e);
  } finally {
    await browser.close();
  }

  const passed = checks.filter((c) => c.ok).length;
  const total = checks.length;
  console.log(`\n${passed}/${total} checks passed`);
  if (passed !== total) process.exit(1);
})();
