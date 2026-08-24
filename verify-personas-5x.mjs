// Puppeteer verify for all 5 character preset personas pages
import puppeteer from 'puppeteer';

const BASE = 'http://localhost:5174';
const PAGES = [
  { file: 'landing-personas-v1-editorial.html', register: 'editorial', accent: '#c4543a', expectPersonas: 8, expectBestFit: 2 },
  { file: 'landing-personas-v2-dark.html',       register: 'dark',       accent: '#7af0c4', expectPersonas: 8, expectBestFit: 2 },
  { file: 'landing-personas-v3-friendly.html',    register: 'friendly',   accent: '#ff6b6b', expectPersonas: 8, expectBestFit: 2 },
  { file: 'landing-personas-v4-dashboard.html',   register: 'dashboard',  accent: '#2563eb', expectPersonas: 8, expectBestFit: 2 },
  { file: 'landing-personas-v5-brutalist.html',   register: 'brutalist',  accent: '#dc2626', expectPersonas: 8, expectBestFit: 2 },
];

const allErrors = {};
const expectedNames = [
  'Indie musician', 'Beatmaker', 'DJ', 'Small label',
  'Belgrade', 'Podcaster', 'Sound designer', 'Music manager',
];

for (const { file, register, accent, expectPersonas, expectBestFit } of PAGES) {
  const errors = [];
  const url = `${BASE}/${file}`;
  console.log(`\n======== ${register} (${file}) ========`);

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

    await page.goto(url, { waitUntil: 'networkidle0', timeout: 30000 });
    await page.evaluate(() => document.fonts.ready);
    await new Promise((r) => setTimeout(r, 600));

    // 1. Title (each register styles it differently — V1 says "Quarterly", V3 says "Member directory", etc.)
    const title = await page.title();
    console.log('title:', title);
    if (!title || title.length < 5) errors.push(`title empty or too short: ${title}`);

    // 2. All 8 personas present
    const body = await page.evaluate(() => document.body.innerText);
    const foundNames = expectedNames.filter((n) => body.includes(n));
    console.log(`personas found: ${foundNames.length}/8`);
    if (foundNames.length < 8) errors.push(`only ${foundNames.length}/8 personas found: ${expectedNames.filter((n) => !foundNames.includes(n))}`);

    // 3. Best fit indicators (text-based — each register uses different styling)
    const bestFitText = await page.evaluate(() => {
      const text = document.body.innerText;
      const patterns = [/best[\s_-]*fit/gi, /fan[-_ ]favorite/gi, /★/g, /starred/gi, /bestfit/gi];
      let total = 0;
      const found = new Set();
      for (const pat of patterns) {
        const m = text.match(pat) || [];
        m.forEach((x) => found.add(x.toLowerCase()));
      }
      // Count actual best-fit-style elements (any element containing the indie musician or belgrade name with a badge nearby)
      const indieBlock = document.querySelector('[class*="indie"], [id*="indie"], [class*="bestfit"]');
      return { uniquePatterns: found.size, hasIndieOrBelgrade: !!indieBlock, text: text.toLowerCase().includes('best fit') || text.toLowerCase().includes('best_fit') || text.toLowerCase().includes('bestfit') || text.toLowerCase().includes('starred') || text.toLowerCase().includes('fan favorite') };
    });
    console.log(`best-fit indicators: patterns=${bestFitText.uniquePatterns}, hasBadge=${bestFitText.hasIndieOrBelgrade}, text=${bestFitText.text}`);
    if (!bestFitText.text) errors.push('no best-fit text indicator found on page');
    if (!bestFitText.hasIndieOrBelgrade) console.log('  ⚠ no best-fit class element found (may be styled differently per register)');

    // 4. Locked accent color present, pink NOT present
    const html = await page.evaluate(() => document.documentElement.outerHTML);
    if (!html.toLowerCase().includes(accent.toLowerCase())) {
      errors.push(`accent color ${accent} not found`);
    } else console.log(`  ✓ accent ${accent} present`);
    const pinkMatches = (html.match(/#e6306b/gi) || []).length;
    if (pinkMatches > 0) errors.push(`found ${pinkMatches} pink #e6306b leaks`);
    else console.log('  ✓ no pink leak');

    // 5. Cross-links to all 5 sister pages
    const sisterPages = [
      'landing-personas-v1-editorial.html',
      'landing-personas-v2-dark.html',
      'landing-personas-v3-friendly.html',
      'landing-personas-v4-dashboard.html',
      'landing-personas-v5-brutalist.html',
    ];
    const linkCount = await page.evaluate((pages) => {
      return pages.filter((p) => document.querySelector(`a[href*="${p}"]`)).length;
    }, sisterPages);
    console.log(`sister-page links: ${linkCount}/5`);
    if (linkCount < 4) errors.push(`only ${linkCount}/5 sister-page links present`);

    // 6. landing.html + index.html links
    const crossLinks = await page.evaluate(() => ({
      landing: !!document.querySelector('a[href*="landing.html"]'),
      index: !!document.querySelector('a[href*="index.html"]'),
    }));
    if (!crossLinks.landing) errors.push('missing landing.html link');
    if (!crossLinks.index) errors.push('missing index.html link');

    // 7. Inline personas JSON
    const hasInline = await page.evaluate(() => {
      const scripts = document.querySelectorAll('script[type="application/json"]');
      for (const s of scripts) {
        try {
          const d = JSON.parse(s.textContent);
          if (d.personas && Array.isArray(d.personas) && d.personas.length === 8) return true;
        } catch (e) {}
      }
      return false;
    });
    if (!hasInline) errors.push('inline personas JSON missing or malformed');
    else console.log('  ✓ inline personas JSON present (8 entries)');

    // 8. Mobile responsive
    await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2 });
    await new Promise((r) => setTimeout(r, 200));
    const mobileDims = await page.evaluate(() => ({
      docW: document.documentElement.scrollWidth,
      winW: window.innerWidth,
    }));
    if (mobileDims.docW > mobileDims.winW + 4) errors.push(`mobile overflow: ${mobileDims.docW} > ${mobileDims.winW}`);
    else console.log('  ✓ mobile: no horizontal overflow');

    // 9. Screenshot
    await page.setViewport({ width: 1280, height: 900, deviceScaleFactor: 1 });
    await new Promise((r) => setTimeout(r, 200));
    await page.screenshot({ path: `verify-screenshots/personas-${register}.png`, fullPage: false });
    console.log(`  ✓ screenshot: verify-screenshots/personas-${register}.png`);

    allErrors[register] = errors;
    console.log(`${register} errors:`, errors.length);
    if (errors.length) errors.forEach((e) => console.log('  ✗', e));
  } finally {
    await browser.close();
  }
}

console.log('\n======== FINAL ========');
let total = 0;
for (const [name, errs] of Object.entries(allErrors)) {
  console.log(`${name}: ${errs.length} errors`);
  total += errs.length;
}
console.log('TOTAL:', total);
process.exitCode = total ? 1 : 0;
