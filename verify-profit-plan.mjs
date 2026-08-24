// Puppeteer verify for the new comprehensive profit-plan.html
import puppeteer from 'puppeteer';

const URL = process.env.URL || 'http://localhost:5174/profit-plan.html';
const errors = [];
const warnings = [];

const browser = await puppeteer.launch({
  headless: 'new',
  args: ['--no-sandbox', '--disable-setuid-sandbox', '--autoplay-policy=no-user-gesture-required'],
});
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 900, deviceScaleFactor: 1 });

  page.on('pageerror', (err) => errors.push('pageerror: ' + err.message));
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push('console.error: ' + msg.text());
    if (msg.type() === 'warning') warnings.push('console.warn: ' + msg.text());
  });
  page.on('requestfailed', (req) => {
    const url = req.url();
    if (!url.includes('favicon') && !url.includes('hot-update')) {
      errors.push('requestfailed: ' + url + ' ' + req.failure()?.errorText);
    }
  });

  console.log('▶', URL);
  await page.goto(URL, { waitUntil: 'networkidle0', timeout: 30000 });
  await page.evaluate(() => document.fonts.ready);
  await new Promise((r) => setTimeout(r, 500));

  // 1. Title
  const title = await page.title();
  console.log('title:', title);
  if (!/90-day|launch/i.test(title)) errors.push(`title missing launch: ${title}`);

  // 2. Hero h1
  const h1 = await page.$eval('h1', (n) => n.innerText.replace(/\s+/g, ' ').trim());
  console.log('h1:', h1);
  if (!/make .*money/i.test(h1)) errors.push(`h1 missing "make money": ${h1}`);

  // 3. Required sections exist (12 numbered + hero = 13 sections)
  const requiredSections = ['lineup', 'vectors', 'projection', 'phases', 'distribution', 'risks', 'north-star', 'playbook', 'model', 'calendar', 'recommendation', 'checklist'];
  for (const id of requiredSections) {
    const found = await page.$(`#${id}`);
    if (!found) errors.push(`missing section #${id}`);
    else console.log(`  ✓ #${id}`);
  }
  const allSections = await page.$$('section');
  console.log('total sections:', allSections.length);
  if (allSections.length < 12) errors.push(`expected ≥12 sections, got ${allSections.length}`);

  // 4. Lineup table has 8 rows
  const lineupRows = await page.$$('#lineup tbody tr');
  console.log('lineup rows:', lineupRows.length);
  if (lineupRows.length !== 8) errors.push(`lineup expected 8 rows, got ${lineupRows.length}`);

  // 5. Five monetization vectors
  const tactics = await page.$$('.tactic');
  console.log('tactics (vectors):', tactics.length);
  if (tactics.length !== 5) errors.push(`expected 5 tactics, got ${tactics.length}`);

  // 6. Revenue projection: big number + 5 rows
  const bigNums = await page.$$('.big-num__value');
  console.log('big nums:', bigNums.length);
  if (bigNums.length !== 2) errors.push(`expected 2 big nums (projection + north star), got ${bigNums.length}`);
  const projectionText = bigNums.length > 0 ? await bigNums[0].evaluate((n) => n.textContent) : '';
  console.log('projection text:', projectionText);
  if (!/\$3,200/.test(projectionText)) errors.push(`projection missing $3,200: ${projectionText}`);

  // 7. Phases bar (4 phases)
  const phases = await page.$$('.phase');
  console.log('phases:', phases.length);
  if (phases.length !== 4) errors.push(`expected 4 phases, got ${phases.length}`);

  // 8. Distribution table
  const distRows = await page.$$('#distribution tbody tr');
  console.log('distribution rows:', distRows.length);
  if (distRows.length < 6) errors.push(`distribution expected ≥6 rows, got ${distRows.length}`);

  // 9. Risks (4 callouts: 3 warn + 1 ok)
  const callouts = await page.$$('.callout');
  console.log('callouts:', callouts.length);
  if (callouts.length < 4) errors.push(`expected ≥4 callouts, got ${callouts.length}`);
  const warnCallouts = await page.$$('.callout--warn');
  const okCallouts = await page.$$('.callout--ok');
  console.log('warn callouts:', warnCallouts.length, 'ok callouts:', okCallouts.length);
  if (warnCallouts.length !== 3) errors.push(`expected 3 warn callouts, got ${warnCallouts.length}`);

  // 10. North star
  const nsText = bigNums.length > 1 ? await bigNums[1].evaluate((n) => n.textContent) : '';
  console.log('north star:', nsText);
  if (!/\$1k/.test(nsText)) errors.push(`north star missing $1k: ${nsText}`);

  // 11. CHANNEL PLAYBOOK (worker A slice) — 6 channels
  const channels = await page.$$('.channel');
  console.log('channel cards:', channels.length);
  if (channels.length !== 6) errors.push(`expected 6 channel cards, got ${channels.length}`);
  const expectedChannels = ['Instagram Reels', 'TikTok', 'YouTube Shorts', 'Reddit', 'Discord', 'Email / newsletter'];
  for (const ch of expectedChannels) {
    const foundByText = await page.$$eval('.channel h3', (els, t) => els.some((e) => e.textContent.includes(t)), ch);
    if (!foundByText) errors.push(`channel missing: ${ch}`);
    else console.log(`  ✓ channel: ${ch}`);
  }

  // 12. FINANCIAL MODEL (worker B slice) — assumptions, 5 vectors, runway
  const assumptionItems = await page.$$('.assumption ol li');
  console.log('assumption items:', assumptionItems.length);
  if (assumptionItems.length < 5) errors.push(`assumptions expected ≥5, got ${assumptionItems.length}`);
  const models = await page.$$('.model');
  console.log('model cards:', models.length);
  if (models.length !== 5) errors.push(`expected 5 model cards, got ${models.length}`);
  const runwayCols = await page.$$('.runway__col');
  console.log('runway cols:', runwayCols.length);
  if (runwayCols.length !== 3) errors.push(`runway expected 3 cols, got ${runwayCols.length}`);
  const runwayText = await page.$eval('#model', (n) => n.innerText);
  if (!/Stress test/.test(runwayText)) errors.push('stress test missing');
  if (!/\$2,940/.test(runwayText) && !/\$2,942/.test(runwayText)) errors.push('bottom line number missing');

  // 13. EXECUTION CALENDAR (worker C slice) — 13 weeks
  const calRows = await page.$$('.calendar tbody tr');
  console.log('calendar rows:', calRows.length);
  if (calRows.length !== 13) errors.push(`calendar expected 13 rows, got ${calRows.length}`);
  const dropItems = await page.$$('.drop-list li');
  console.log('drop priority items:', dropItems.length);
  if (dropItems.length < 4) errors.push(`drop list expected ≥4 items, got ${dropItems.length}`);

  // 14. The recommendation (DARK section)
  const inkSection = await page.$('.section--ink');
  if (!inkSection) errors.push('missing ink section');
  else {
    const inkText = await inkSection.evaluate((n) => n.innerText);
    if (!/ship vector 1/i.test(inkText)) errors.push('recommendation missing "ship vector 1"');
    if (!/defer vector 5/i.test(inkText)) errors.push('recommendation missing "defer vector 5"');
    console.log('  ✓ recommendation section present with both anchors');
  }

  // 15. This week's checklist
  const checklistItems = await page.$$('#checklist ol li');
  console.log('checklist items:', checklistItems.length);
  if (checklistItems.length !== 6) errors.push(`checklist expected 6 items, got ${checklistItems.length}`);

  // 16. Footer
  const footerLinks = await page.$$('.footer__col a');
  console.log('footer links:', footerLinks.length);
  if (footerLinks.length < 8) errors.push(`footer expected ≥8 links, got ${footerLinks.length}`);

  // 17. Nav links
  const navLinks = await page.$$('.nav__links a');
  console.log('nav links:', navLinks.length);
  if (navLinks.length < 5) errors.push(`nav expected ≥5 links, got ${navLinks.length}`);

  // 18. Cross-links to all sister pages
  const crossLinks = ['landing.html', 'interactive-howto.html', 'market-study.html', 'campaign.html', 'versions/index.html', 'index.html'];
  for (const href of crossLinks) {
    const link = await page.$(`a[href="${href}"]`);
    if (!link) errors.push(`missing cross-link: ${href}`);
  }
  console.log('  ✓ all 6 cross-links present');

  // 19. Page height
  const dims = await page.evaluate(() => ({
    docHeight: document.documentElement.scrollHeight,
    viewportHeight: window.innerHeight,
  }));
  console.log('page height:', dims.docHeight, 'viewport:', dims.viewportHeight);
  if (dims.docHeight < 8000) errors.push(`page too short: ${dims.docHeight}px (expected ≥ 8000px for full profit plan)`);

  // 20. Screenshots
  await page.evaluate(() => window.scrollTo(0, 0));
  await new Promise((r) => setTimeout(r, 200));
  await page.screenshot({ path: 'verify-screenshots/profit-plan-hero.png', fullPage: false });
  console.log('  ✓ screenshot: verify-screenshots/profit-plan-hero.png');
  await page.screenshot({ path: 'verify-screenshots/profit-plan-full.png', fullPage: true });
  console.log('  ✓ screenshot: verify-screenshots/profit-plan-full.png');

  // 21. Mobile
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2 });
  await new Promise((r) => setTimeout(r, 200));
  const mobileDims = await page.evaluate(() => ({
    docW: document.documentElement.scrollWidth,
    winW: window.innerWidth,
  }));
  if (mobileDims.docW > mobileDims.winW + 4) errors.push(`horizontal overflow on mobile: ${mobileDims.docW} > ${mobileDims.winW}`);
  else console.log('  ✓ mobile: no horizontal overflow');
  await page.screenshot({ path: 'verify-screenshots/profit-plan-mobile.png', fullPage: false });
  console.log('  ✓ screenshot: verify-screenshots/profit-plan-mobile.png');

  // 22. Dark mode
  await page.setViewport({ width: 1280, height: 900, deviceScaleFactor: 1 });
  await page.evaluate(() => {
    document.documentElement.setAttribute('data-theme', 'dark');
  });
  await new Promise((r) => setTimeout(r, 200));
  await page.screenshot({ path: 'verify-screenshots/profit-plan-dark.png', fullPage: false });
  console.log('  ✓ screenshot: verify-screenshots/profit-plan-dark.png');

  // 23. Ink section screenshot
  await page.evaluate(() => {
    const el = document.querySelector('#recommendation');
    if (el) el.scrollIntoView({ block: 'center' });
  });
  await new Promise((r) => setTimeout(r, 200));
  await page.screenshot({ path: 'verify-screenshots/profit-plan-ink.png', fullPage: false });
  console.log('  ✓ screenshot: verify-screenshots/profit-plan-ink.png (dark recommendation)');

  // 24. Final tally
  console.log('\n=== RESULTS ===');
  console.log('errors:', errors.length);
  console.log('warnings:', warnings.length);
  if (errors.length) {
    console.log('\nERRORS:');
    errors.forEach((e) => console.log('  ✗', e));
  }
  if (warnings.length) {
    console.log('\nWARNINGS:');
    warnings.forEach((w) => console.log('  ⚠', w));
  }
  process.exitCode = errors.length ? 1 : 0;
} finally {
  await browser.close();
}
