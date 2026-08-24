// Puppeteer verify for the new personas subsection in landing.html#versions
import puppeteer from 'puppeteer';

const URL = 'http://localhost:5174/landing.html#versions';
const errors = [];
const warnings = [];

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
  await new Promise((r) => setTimeout(r, 500));

  // 1. Page still has 5 version cards (preserved)
  const versionCards = await page.$$('#versions .ver');
  console.log('version cards:', versionCards.length);
  if (versionCards.length !== 6) errors.push(`expected 6 version cards (5 styles + see all), got ${versionCards.length}`);

  // 2. Persona subsection exists
  const personasDiv = await page.$('#versions .personas');
  if (!personasDiv) errors.push('personas grid missing');
  else console.log('  ✓ personas grid present');

  // 3. Divider + intro
  const dividerLabel = await page.$eval('.personas-divider__label', (n) => n.textContent.trim()).catch(() => null);
  console.log('divider label:', dividerLabel);
  if (!/made for these people/i.test(dividerLabel || '')) errors.push('divider label missing or wrong');

  const introH3 = await page.$eval('.personas-intro h3', (n) => n.textContent.trim()).catch(() => null);
  console.log('intro h3:', introH3);
  if (!/who actually/i.test(introH3 || '')) errors.push('intro h3 missing');

  // 4. 8 persona cards
  const personaCards = await page.$$('.persona');
  console.log('persona cards:', personaCards.length);
  if (personaCards.length !== 8) errors.push(`expected 8 personas, got ${personaCards.length}`);

  // 5. Persona names
  const personaNames = await page.$$eval('.persona__name', (els) => els.map((e) => e.textContent.trim()));
  console.log('persona names:', personaNames);
  const expectedNames = [
    'Indie musician',
    'Beatmaker',
    'DJ',
    'Small label',
    'Belgrade / Serbian artist',
    'Podcaster',
    'Sound designer',
    'Music manager / agency',
  ];
  for (const n of expectedNames) {
    if (!personaNames.includes(n)) errors.push(`persona missing: ${n}`);
  }
  if (expectedNames.every((n) => personaNames.includes(n))) console.log('  ✓ all 8 personas present');

  // 6. 2 "Best fit" badges
  const bestBadges = await page.$$('.persona__best');
  console.log('best-fit badges:', bestBadges.length);
  if (bestBadges.length !== 2) errors.push(`expected 2 best-fit badges, got ${bestBadges.length}`);

  // 7. Each persona has icon + body + tool link
  const personaStructure = await page.evaluate(() => {
    return Array.from(document.querySelectorAll('.persona')).map((p) => ({
      hasIcon: !!p.querySelector('.persona__icon'),
      hasName: !!p.querySelector('.persona__name'),
      hasBody: !!p.querySelector('.persona__body'),
      hasTool: !!p.querySelector('.persona__tool'),
      toolText: p.querySelector('.persona__tool')?.textContent.trim().slice(0, 40) || '',
    }));
  });
  console.log('persona structure check:');
  for (let i = 0; i < personaStructure.length; i++) {
    const p = personaStructure[i];
    const ok = p.hasIcon && p.hasName && p.hasBody && p.hasTool;
    if (!ok) errors.push(`persona ${i + 1} missing structure: ${JSON.stringify(p)}`);
    if (ok) console.log(`  ✓ ${personaNames[i]}: ${p.toolText}`);
  }

  // 8. Tool links point to real destinations
  const toolLinks = await page.$$eval('.persona__tool code', (els) => els.map((e) => e.textContent.trim()));
  console.log('tool links:', toolLinks);
  const expectedLinks = [
    'versions/neon.html',
    'versions/grid.html',
    'versions/smoke.html',
    'versions/film.html',
    'campaign.html',
    'versions/film.html', // podcaster
    'versions/hallucination.html',
    'profit-plan.html',
  ];
  for (const link of expectedLinks) {
    if (!toolLinks.includes(link)) errors.push(`tool link missing: ${link}`);
  }

  // 9. Screenshot the personas section
  await page.evaluate(() => {
    const el = document.querySelector('.personas');
    if (el) el.scrollIntoView({ block: 'start' });
  });
  await new Promise((r) => setTimeout(r, 200));
  await page.screenshot({ path: 'verify-screenshots/landing-personas.png', fullPage: false });
  console.log('  ✓ screenshot: verify-screenshots/landing-personas.png');

  // 10. Mobile responsive
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2 });
  await new Promise((r) => setTimeout(r, 200));
  const mobileDims = await page.evaluate(() => ({
    docW: document.documentElement.scrollWidth,
    winW: window.innerWidth,
  }));
  if (mobileDims.docW > mobileDims.winW + 4) errors.push(`horizontal overflow on mobile: ${mobileDims.docW} > ${mobileDims.winW}`);
  else console.log('  ✓ mobile: no horizontal overflow');

  // Check mobile persona grid (should be 1-col)
  const mobileGridCols = await page.evaluate(() => {
    return getComputedStyle(document.querySelector('.personas')).gridTemplateColumns;
  });
  console.log('mobile grid cols:', mobileGridCols);
  if (!/^[\d.]+px$/.test(mobileGridCols.trim())) {
    warnings.push(`mobile grid template unexpected: ${mobileGridCols}`);
  } else {
    const colWidth = parseFloat(mobileGridCols);
    if (colWidth < 350 || colWidth > 400) warnings.push(`mobile col width unexpected: ${colWidth}px`);
  }

  // Mobile screenshot
  await page.evaluate(() => {
    const el = document.querySelector('.personas');
    if (el) el.scrollIntoView({ block: 'start' });
  });
  await new Promise((r) => setTimeout(r, 200));
  await page.screenshot({ path: 'verify-screenshots/landing-personas-mobile.png', fullPage: false });
  console.log('  ✓ mobile screenshot: verify-screenshots/landing-personas-mobile.png');

  // 11. Dark mode
  await page.setViewport({ width: 1280, height: 900, deviceScaleFactor: 1 });
  await page.evaluate(() => {
    document.documentElement.setAttribute('data-theme', 'dark');
  });
  await new Promise((r) => setTimeout(r, 200));
  await page.evaluate(() => {
    const el = document.querySelector('.personas');
    if (el) el.scrollIntoView({ block: 'start' });
  });
  await new Promise((r) => setTimeout(r, 200));
  await page.screenshot({ path: 'verify-screenshots/landing-personas-dark.png', fullPage: false });
  console.log('  ✓ dark screenshot: verify-screenshots/landing-personas-dark.png');

  // 12. Tablet (2-col)
  await page.evaluate(() => {
    document.documentElement.setAttribute('data-theme', 'light');
  });
  await page.setViewport({ width: 800, height: 1000, deviceScaleFactor: 1 });
  await new Promise((r) => setTimeout(r, 200));
  const tabletGridCols = await page.evaluate(() => {
    return getComputedStyle(document.querySelector('.personas')).gridTemplateColumns;
  });
  console.log('tablet grid cols:', tabletGridCols);

  console.log('\n=== RESULTS ===');
  console.log('errors:', errors.length);
  console.log('warnings:', warnings.length);
  if (errors.length) errors.forEach((e) => console.log('  ✗', e));
  if (warnings.length) warnings.forEach((w) => console.log('  ⚠', w));
  process.exitCode = errors.length ? 1 : 0;
} finally {
  await browser.close();
}
