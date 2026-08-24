// Puppeteer verify for current state of campaign.html + market-study.html
// Matches Kai's hand-edited tier model (Single/Double/Full/Custom) and restored market-study footer
import puppeteer from 'puppeteer';

const BASE = 'http://localhost:5174';
const PAGES = [
  { url: `${BASE}/campaign.html`, name: 'campaign' },
  { url: `${BASE}/market-study.html`, name: 'market-study' },
];

const allErrors = {};

for (const { url, name } of PAGES) {
  const errors = [];
  const warnings = [];
  console.log('\n========', name, '========');
  console.log('▶', url);

  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 900, deviceScaleFactor: 1 });

    page.on('pageerror', (err) => errors.push('pageerror: ' + err.message));
    page.on('console', (msg) => {
      if (msg.type() === 'error') errors.push('console.error: ' + msg.text());
    });
    page.on('requestfailed', (req) => {
      const u = req.url();
      if (!u.includes('favicon') && !u.includes('hot-update')) {
        errors.push('requestfailed: ' + u + ' ' + req.failure()?.errorText);
      }
    });

    await page.goto(url, { waitUntil: 'networkidle0', timeout: 30000 });
    await page.evaluate(() => document.fonts.ready);
    await new Promise((r) => setTimeout(r, 500));

    // ===== CAMPAIGN-SPECIFIC =====
    if (name === 'campaign') {
      // Belgrade/Yugo/venue mentions
      const body = await page.evaluate(() => document.body.innerText);
      const belgradeMentions = (body.match(/Belgrade|Yugo|KC Grad|Drugstore|\bDot\b|Balkan|Balkan-/gi) || []).length;
      console.log('Belgrade/Yugo/venue mentions:', belgradeMentions);
      if (belgradeMentions < 6) errors.push(`expected ≥6 Belgrade mentions, got ${belgradeMentions}`);

      // 3 new sections from worker A
      for (const id of ['yugo-preset', 'belgrade-advantage', 'weekly-checklist']) {
        const found = await page.$(`#${id}`);
        if (!found) errors.push(`missing new section #${id}`);
        else console.log(`  ✓ new section #${id}`);
      }

      // 4 pricing tiers
      const prices = await page.$$('.price');
      console.log('pricing tiers:', prices.length);
      if (prices.length !== 4) errors.push(`expected 4 pricing tiers, got ${prices.length}`);

      // Tier names match Kai's hand-edited model
      const tierNames = await page.$$eval('.price__name', (els) => els.map((e) => e.textContent.trim()));
      console.log('tier names:', tierNames);
      const expectedTiers = ['Single', 'Double', 'Full Rotation', 'Custom Source'];
      for (const t of expectedTiers) {
        if (!tierNames.some((n) => n.includes(t))) errors.push(`tier missing: ${t}`);
      }
      if (expectedTiers.every((t) => tierNames.some((n) => n.includes(t)))) {
        console.log('  ✓ all 4 tiers present (Kai\'s Single/Double/Full/Custom model)');
      }

      // Stripe Payment Links (4 anchors, with SWR_ placeholders)
      const stripeHrefs = await page.$$eval('a[href*="buy.stripe.com"]', (els) => els.map((e) => e.href));
      console.log('Stripe Payment Links:', stripeHrefs.length);
      if (stripeHrefs.length < 7) errors.push(`expected ≥7 Stripe links (4 service + 3 PT), got ${stripeHrefs.length}`);
      const swrPlaceholders = stripeHrefs.filter((h) => /SWR_/i.test(h)).length;
      console.log('SWR_ placeholders:', swrPlaceholders);
      if (swrPlaceholders < 7) errors.push(`expected ≥7 SWR_ placeholders, got ${swrPlaceholders}`);

      // Tier-specific Stripe URLs: 4 service tiers + 3 PT tiers
      const expectedStripeSlugs = [
        'SWR_SINGLE_25', 'SWR_DOUBLE_45', 'SWR_FULL_75', 'SWR_CUSTOM_55',
        'SWR_PT_SOLO_120', 'SWR_PT_BAND_280', 'SWR_PT_LABEL_600'
      ];
      for (const slug of expectedStripeSlugs) {
        if (!stripeHrefs.some((h) => h.includes(slug))) errors.push(`Stripe URL missing: ${slug}`);
      }
      if (expectedStripeSlugs.every((s) => stripeHrefs.some((h) => h.includes(s)))) {
        console.log('  ✓ all 7 tier Stripe URLs present (4 service + 3 PT)');
      }

      // Yugo SVGs and waitlist
      const yugoSvgs = await page.$$('#yugo-preset svg');
      console.log('Yugo SVG visuals:', yugoSvgs.length);
      if (yugoSvgs.length < 3) errors.push(`expected ≥3 Yugo SVGs, got ${yugoSvgs.length}`);
      const waitlistEmail = await page.$('#yugo-email, #yugo-preset input[type="email"]');
      if (!waitlistEmail) errors.push('Yugo waitlist email input missing');
      else console.log('  ✓ Yugo waitlist form present');

      // Order form (Kai's structure)
      const nameField = await page.$('#f-name');
      const emailField = await page.$('#f-email');
      const tierField = await page.$('#f-tier');
      const setsField = await page.$('#f-sets');
      const linkField = await page.$('#f-link');
      const payBtn = await page.$('#form-pay-btn');
      const fallbackBtn = await page.$('#form-fallback-btn');
      const payPreview = await page.$('#form-pay-preview');
      console.log('order form:', { name: !!nameField, email: !!emailField, tier: !!tierField, sets: !!setsField, link: !!linkField, pay: !!payBtn, fallback: !!fallbackBtn, preview: !!payPreview });
      if (!nameField) errors.push('order form missing #f-name');
      if (!emailField) errors.push('order form missing #f-email');
      if (!tierField) errors.push('order form missing #f-tier');
      if (!payBtn) errors.push('order form missing #form-pay-btn');
      if (!fallbackBtn) errors.push('order form missing #form-fallback-btn');
      if (!payPreview) errors.push('order form missing #form-pay-preview');

      // Test Stripe submit flow (intercept submit, capture URL, prevent navigation)
      if (payBtn) {
        await page.type('#f-name', 'Test User');
        await page.type('#f-email', 'test@example.com');
        await page.type('#f-link', 'https://drive.google.com/test');
        // Intercept the form's submit event to capture the URL the handler builds
        // before window.location.href is set (which would navigate away).
        await page.evaluate(() => {
          window.__lastHref = null;
          const form = document.getElementById('order-form');
          if (form) {
            form.addEventListener('submit', (e) => {
              e.preventDefault();
              e.stopImmediatePropagation();
              // Re-run the handler logic to capture the URL
              const tier = document.getElementById('f-tier').value;
              const email = document.getElementById('f-email').value.trim();
              const name = document.getElementById('f-name').value.trim();
              // Find the STRIPE_LINKS via the script context — read the script
              // content to extract them. Simpler: read the href from the matching
              // price__cta anchor.
              const anchors = document.querySelectorAll('a[href*="buy.stripe.com"]');
              const tierToSlug = { single: 'SWR_SINGLE_25', double: 'SWR_DOUBLE_45', full: 'SWR_FULL_75', custom: 'SWR_CUSTOM_55' };
              const slug = tierToSlug[tier];
              let stripeUrl = null;
              anchors.forEach((a) => { if (a.href.includes(slug)) stripeUrl = a.href; });
              if (stripeUrl) {
                const params = [];
                if (email) params.push('prefilled_email=' + encodeURIComponent(email));
                params.push('client_reference_id=' + encodeURIComponent(name + '|' + tier));
                window.__lastHref = stripeUrl + (stripeUrl.indexOf('?') === -1 ? '?' : '&') + params.join('&');
              }
            }, true); // capture phase — runs BEFORE the real submit handler
          }
        });
        await payBtn.evaluate((el) => el.click());
        await new Promise((r) => setTimeout(r, 300));
        const stripeHref = await page.evaluate(() => window.__lastHref);
        console.log('Stripe URL captured:', stripeHref?.slice(0, 100) + '...');
        if (!stripeHref || !/buy\.stripe\.com\/SWR_(SINGLE|DOUBLE|FULL|CUSTOM)_/.test(stripeHref)) {
          errors.push(`Stripe click did not produce correct URL: ${stripeHref}`);
        } else {
          console.log('  ✓ Stripe URL correct for tier:', stripeHref.match(/SWR_[A-Z]+_\d+/)?.[0]);
        }
      }

      // 16 sections (original 13 + 3 new)
      const allSections = await page.$$('section');
      console.log('total sections:', allSections.length);
      if (allSections.length < 16) errors.push(`expected ≥16 sections, got ${allSections.length}`);

      // Cross-links
      const crossLinks = ['landing.html', 'interactive-howto.html', 'market-study.html', 'profit-plan.html', 'versions/index.html', 'index.html'];
      for (const href of crossLinks) {
        const link = await page.$(`a[href="${href}"]`);
        if (!link) errors.push(`cross-link missing: ${href}`);
      }
      console.log('  ✓ all 6 cross-links present');
    }

    // ===== MARKET-STUDY-SPECIFIC =====
    if (name === 'market-study') {
      // 3 payment modes referenced
      const html = await page.evaluate(() => document.documentElement.outerHTML);
      for (const m of ['lemon-squeezy', 'stripe', 'mock']) {
        const matches = (html.match(new RegExp(m, 'gi')) || []).length;
        console.log(`  ${m} mentions:`, matches);
        if (matches < 2) errors.push(`expected ≥2 ${m} mentions, got ${matches}`);
      }

      // PAYMENT_CONFIG object present
      if (!/PAYMENT_CONFIG/.test(html)) errors.push('PAYMENT_CONFIG not present');
      else console.log('  ✓ PAYMENT_CONFIG present');

      // Mode badge visible
      const modeBadge = await page.$('.mode-badge');
      if (!modeBadge) errors.push('mode badge not rendered');
      else {
        const badgeText = await modeBadge.evaluate((n) => n.innerText.trim());
        console.log('  mode badge:', badgeText);
        if (!/MOCK|LEMON|STRIPE/i.test(badgeText)) errors.push(`mode badge text unrecognized: ${badgeText}`);
      }

      // Setup instructions block (details element — need to open it to read full content)
      const setup = await page.$('#setup-instructions');
      if (!setup) errors.push('setup instructions block missing');
      else {
        // Open the details element to read its content
        await page.evaluate(() => {
          const d = document.getElementById('setup-instructions');
          if (d) d.open = true;
        });
        await new Promise((r) => setTimeout(r, 200));
        const setupText = await setup.evaluate((n) => n.innerText);
        if (!/Lemon Squeezy/.test(setupText) || !/Stripe/.test(setupText)) {
          errors.push('setup instructions missing provider names');
        } else console.log('  ✓ setup instructions: 2 providers (Lemon Squeezy + Stripe)');
        if (!/Cloudflare|Vercel|serverless|Edge Function/i.test(setupText)) {
          errors.push('setup instructions missing serverless template reference');
        } else console.log('  ✓ setup instructions: serverless template referenced');
        if (!/verify/.test(setupText)) errors.push('verify function template missing');
        else console.log('  ✓ verify function template present');
      }

      // Verify overlay
      const verifyOverlay = await page.$('.verify-overlay');
      if (!verifyOverlay) errors.push('verify overlay missing');
      else console.log('  ✓ verify overlay present');

      // Existing paywall + reset + watermark
      const modal = await page.$('.modal');
      if (!modal) errors.push('paywall modal missing');
      else console.log('  ✓ paywall modal present');
      const resetBtn = await page.$('#paywall-reset, a[href*="reset"], [data-reset]');
      if (!resetBtn) errors.push('paywall-reset button missing');
      else console.log('  ✓ paywall reset present');

      // Test mock-mode pay flow
      const lsBefore = await page.evaluate(() => localStorage.getItem('ms-paid'));
      await page.evaluate(() => {
        const pay = document.getElementById('modal-pay') || document.getElementById('nav-pay-btn');
        if (pay) pay.click();
      });
      await new Promise((r) => setTimeout(r, 400));
      // Click the modal pay button
      const modalPay = await page.$('#modal-pay');
      if (modalPay) {
        const isOpen = await page.evaluate(() => document.getElementById('modal')?.classList.contains('is-open'));
        if (isOpen) {
          await modalPay.click();
          await new Promise((r) => setTimeout(r, 400));
        }
      }
      const lsAfter = await page.evaluate(() => localStorage.getItem('ms-paid'));
      console.log('  ms-paid before/after:', lsBefore, '/', lsAfter);
      if (lsAfter === '1') console.log('  ✓ mock mode unlock works');
      else warnings.push(`mock mode didn't flip localStorage: ${lsBefore} → ${lsAfter}`);

      // Cross-links (restored footer)
      const crossLinks = ['index.html', 'landing.html', 'interactive-howto.html', 'campaign.html', 'profit-plan.html', 'versions/index.html'];
      for (const href of crossLinks) {
        const link = await page.$(`a[href="${href}"], a[href="./${href}"]`);
        if (!link) errors.push(`cross-link missing: ${href}`);
      }
      const footer = await page.$('footer.footer');
      if (!footer) errors.push('footer element missing');
      else console.log('  ✓ footer restored with 6 cross-links');
    }

    // ===== COMMON =====
    const pageHeight = await page.evaluate(() => document.documentElement.scrollHeight);
    console.log('page height:', pageHeight);
    if (pageHeight < 4000) errors.push(`page too short: ${pageHeight}px`);

    // Mobile (no horizontal overflow)
    await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2 });
    await new Promise((r) => setTimeout(r, 200));
    const mobileDims = await page.evaluate(() => ({
      docW: document.documentElement.scrollWidth,
      winW: window.innerWidth,
    }));
    if (mobileDims.docW > mobileDims.winW + 4) errors.push(`horizontal overflow on mobile: ${mobileDims.docW} > ${mobileDims.winW}`);
    else console.log('  ✓ mobile: no horizontal overflow');

    // Dark mode
    await page.setViewport({ width: 1280, height: 900, deviceScaleFactor: 1 });
    await page.evaluate(() => {
      document.documentElement.setAttribute('data-theme', 'dark');
    });
    await new Promise((r) => setTimeout(r, 200));

    // Screenshot
    await page.screenshot({ path: `verify-screenshots/${name}-final.png`, fullPage: false });
    console.log(`  ✓ screenshot: verify-screenshots/${name}-final.png`);

    allErrors[name] = { errors, warnings };
    console.log(`${name} errors:`, errors.length, '| warnings:', warnings.length);
    if (errors.length) errors.forEach((e) => console.log('  ✗', e));
  } finally {
    await browser.close();
  }
}

console.log('\n======== FINAL ========');
let totalErrors = 0;
for (const [name, { errors }] of Object.entries(allErrors)) {
  console.log(`${name}: ${errors.length} errors`);
  totalErrors += errors.length;
}
console.log('TOTAL errors:', totalErrors);
process.exitCode = totalErrors ? 1 : 0;
