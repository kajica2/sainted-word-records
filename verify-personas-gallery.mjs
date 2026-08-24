// Puppeteer verify for the personas.html gallery index
import puppeteer from 'puppeteer';

const URL = 'http://localhost:5174/personas.html';
const errors = [];
const browser = await puppeteer.launch({
  headless: 'new',
  args: ['--no-sandbox', '--disable-setuid-sandbox'],
});
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 900, deviceScaleFactor: 1 });

  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console.error: ' + m.text()); });
  page.on('requestfailed', (req) => {
    const u = req.url();
    if (!u.includes('favicon') && !u.includes('hot-update')) {
      errors.push('requestfailed: ' + u + ' ' + req.failure()?.errorText);
    }
  });

  await page.goto(URL, { waitUntil: 'networkidle0', timeout: 30000 });
  await page.evaluate(() => document.fonts.ready);
  await new Promise((r) => setTimeout(r, 600));

  // Title
  const title = await page.title();
  console.log('title:', title);
  if (!/personas/i.test(title)) errors.push(`title unexpected: ${title}`);

  // 5 register cards
  const registers = await page.$$('.reg');
  console.log('register cards:', registers.length);
  if (registers.length !== 5) errors.push(`expected 5 registers, got ${registers.length}`);

  // 5 distinct register classes
  const regClasses = await page.$$eval('.reg', (els) => els.map((e) => Array.from(e.classList).filter((c) => c.startsWith('reg--'))).flat());
  console.log('register classes:', regClasses);
  const expectedRegs = ['reg--editorial', 'reg--dark', 'reg--friendly', 'reg--dashboard', 'reg--brutalist'];
  for (const r of expectedRegs) {
    if (!regClasses.includes(r)) errors.push(`missing register: ${r}`);
  }
  if (expectedRegs.every((r) => regClasses.includes(r))) console.log('  ✓ all 5 register classes present');

  // Each register has accent color
  const accents = await page.evaluate(() => {
    const out = {};
    for (const r of document.querySelectorAll('.reg')) {
      const cls = Array.from(r.classList).find((c) => c.startsWith('reg--'));
      const preview = r.querySelector('.reg__preview-title');
      out[cls] = preview ? getComputedStyle(preview).color : null;
    }
    return out;
  });
  console.log('accent colors:', accents);
  for (const r of expectedRegs) {
    if (!accents[r]) errors.push(`no accent color for ${r}`);
  }

  // Links to all 5 sister register pages
  const sisterLinks = await page.$$eval('a', (els) => els.map((e) => e.href).filter((h) => h.includes('landing-personas-v')));
  console.log('sister page links:', sisterLinks);
  const expectedSisters = [
    'landing-personas-v1-editorial.html',
    'landing-personas-v2-dark.html',
    'landing-personas-v3-friendly.html',
    'landing-personas-v4-dashboard.html',
    'landing-personas-v5-brutalist.html',
  ];
  for (const s of expectedSisters) {
    if (!sisterLinks.some((h) => h.includes(s))) errors.push(`missing sister link: ${s}`);
  }

  // Cross-links to landing, index, campaign, profit-plan
  const crossLinks = ['landing.html', 'index.html', 'campaign.html', 'profit-plan.html'];
  for (const href of crossLinks) {
    const link = await page.$(`a[href$="${href}"]`);
    if (!link) errors.push(`cross-link missing: ${href}`);
  }
  console.log('  ✓ cross-links present');

  // Screenshot hero
  await page.screenshot({ path: 'verify-screenshots/personas-gallery.png', fullPage: false });
  console.log('  ✓ screenshot: verify-screenshots/personas-gallery.png');

  // Mobile
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2 });
  await new Promise((r) => setTimeout(r, 200));
  const mobileDims = await page.evaluate(() => ({
    docW: document.documentElement.scrollWidth,
    winW: window.innerWidth,
  }));
  if (mobileDims.docW > mobileDims.winW + 4) errors.push(`mobile overflow: ${mobileDims.docW} > ${mobileDims.winW}`);
  else console.log('  ✓ mobile: no horizontal overflow');

  // Mobile screenshot
  await page.screenshot({ path: 'verify-screenshots/personas-gallery-mobile.png', fullPage: false });
  console.log('  ✓ mobile screenshot');

  // Full page screenshot
  await page.setViewport({ width: 1280, height: 900, deviceScaleFactor: 1 });
  await page.screenshot({ path: 'verify-screenshots/personas-gallery-full.png', fullPage: true });
  console.log('  ✓ full-page screenshot');

  // Verify each register link works (just check they return 200, don't render each)
  for (const s of expectedSisters) {
    const url = `http://localhost:5174/${s}`;
    const r = await page.goto(url, { waitUntil: 'networkidle0', timeout: 15000 });
    if (!r.ok()) errors.push(`sister link broken: ${s} → ${r.status()}`);
    else console.log(`  ✓ ${s} → ${r.status()}`);
  }

  console.log('\n=== RESULTS ===');
  console.log('errors:', errors.length);
  if (errors.length) errors.forEach((e) => console.log('  ✗', e));
  process.exitCode = errors.length ? 1 : 0;
} finally {
  await browser.close();
}
