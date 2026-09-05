// verify-weddings-redesign.mjs — smoke test the redesigned /weddings
// against the Pre-Flight checklist (Section 14 of design-taste-frontend).
//
// Run with: node verify-weddings-redesign.mjs
// (Requires: npm run dev to be running on http://localhost:5174)

import puppeteer from 'puppeteer';
import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const BASE = process.env.WEDDINGS_URL || 'http://localhost:5174';
const URL = BASE + '/weddings.html';
const SHOTS = 'verify-screenshots';

if (!existsSync(SHOTS)) mkdirSync(SHOTS, { recursive: true });

const checks = [];
const pass = (m) => { checks.push({ ok: true, m }); console.log('PASS', m); };
const fail = (m) => { checks.push({ ok: false, m }); console.log('FAIL', m); };

// Pre-Flight text checks: scan rendered text for forbidden patterns.
const TEXT_FORBIDDEN = {
  emDash:  /[—–]/,             // em-dash OR en-dash (per Section 9.G, the ban extends to en-dash as separator)
  middleDot: /·/,              // rationed (max 1 per line). We just count lines.
  scrollCue: /\b(Scroll|↓ scroll|Scroll to explore)\b/i,
  versionLabel: /\b(v\d+\.\d+|BETA|ALPHA|EARLY ACCESS)\b/i,
};

(async () => {
  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
    defaultViewport: { width: 1440, height: 900 },
  });
  const page = await browser.newPage();

  const consoleErrors = [];
  page.on('pageerror', (e) => consoleErrors.push(String(e)));
  page.on('console', (m) => {
    if (m.type() === 'error') consoleErrors.push(m.text());
  });

  // ---- 1. Page loads ----
  const resp = await page.goto(URL, { waitUntil: 'networkidle2', timeout: 30000 });
  if (!resp || !resp.ok()) {
    fail(`page did not load: ${resp ? resp.status() : 'no response'}`);
    await browser.close();
    process.exit(1);
  }
  pass(`page loaded: ${URL} (${resp.status()})`);

  // Give the fade-in motion a beat
  await new Promise((r) => setTimeout(r, 800));

  // ---- 2. Hero structure ----
  const hero = await page.$('.wed-hero');
  if (hero) pass('hero rendered'); else fail('hero missing');
  const heroTitle = await page.$eval('.wed-hero-title', (el) => el.textContent.trim());
  if (heroTitle && heroTitle.length > 10) pass(`hero title: ${heroTitle.slice(0, 60)}…`);
  else fail('hero title missing or empty');
  const heroEm = await page.$('.wed-hero-title em');
  if (heroEm) pass('hero italic emphasis present'); else fail('hero italic emphasis missing');
  const heroImage = await page.$('.wed-hero-image');
  if (heroImage) pass('hero image present'); else fail('hero image missing');

  // ---- 3. Five category sections rendered with five different variants ----
  const sectionData = await page.$$eval('.wed-section', (els) => els.map((el) => ({
    id:    el.id,
    variant: el.dataset.variant || null,
    title: el.querySelector('.wed-section-title')?.textContent.trim() || null,
  })));

  if (sectionData.length === 5) {
    pass(`5 category sections rendered`);
  } else {
    fail(`expected 5 sections, got ${sectionData.length}`);
  }
  const variants = sectionData.map((s) => s.variant);
  const uniqueVariants = new Set(variants);
  if (uniqueVariants.size === 5) {
    pass(`5 distinct layout variants: ${[...uniqueVariants].join(', ')}`);
  } else {
    fail(`expected 5 distinct variants, got ${uniqueVariants.size}: ${[...uniqueVariants].join(', ')}`);
  }
  for (const s of sectionData) {
    pass(`section: ${s.id} (${s.variant}) → "${s.title}"`);
  }

  // ---- 4. CTA buttons exist + click writes to localStorage ----
  const ctaCount = await page.$$eval('button[data-action="use"]', (els) => els.length);
  if (ctaCount === 15) {
    pass(`${ctaCount} CTA buttons rendered (5 categories x 3 tracks)`);
  } else {
    fail(`expected 15 CTA buttons, got ${ctaCount}`);
  }

  // ---- 5. CTA handoff: invoke the click, capture localStorage, then
  //      reload the page so we can keep going. The page's click handler
  //      does setTimeout(80ms) → location.href = make-video.html. We
  //      read localStorage BEFORE that 80ms fires, so the write is
  //      captured, then we explicitly reload to stay on /weddings.html.
  const firstBtn = await page.$('button[data-action="use"]');
  if (!firstBtn) {
    fail('no CTA button to click');
  } else {
    const before = await page.evaluate(() => ({
      playlist: localStorage.getItem('swr.pending-playlist'),
      song:     localStorage.getItem('swr.pending-song'),
    }));
    if (!before.playlist) pass('pre-click: localStorage empty (cold start)');
    else pass('pre-click: localStorage has prior state (will be overwritten)');

    await firstBtn.click();
    await new Promise((r) => setTimeout(r, 30));  // before the 80ms nav

    const after = await page.evaluate(() => ({
      playlist: localStorage.getItem('swr.pending-playlist'),
      song:     localStorage.getItem('swr.pending-song'),
    }));
    if (after.playlist && after.song) {
      const pl = JSON.parse(after.playlist);
      pass(`CTA click wrote handoff: ${pl.length} tracks in playlist, first is "${JSON.parse(after.song).title}"`);
    } else {
      fail('CTA click did NOT write handoff to localStorage');
    }
  }

  // Reload the page to undo any navigation that may have started.
  await page.goto(URL, { waitUntil: 'networkidle2', timeout: 30000 });
  await new Promise((r) => setTimeout(r, 400));

  // ---- 6. Em-dash / en-dash / forbidden-pattern scan on visible text ----
  const visibleText = await page.evaluate(() => {
    // Walk text nodes from <main> + <header> + <footer>
    const roots = [
      document.querySelector('header'),
      document.querySelector('main'),
      document.querySelector('footer'),
    ].filter(Boolean);
    const out = [];
    for (const r of roots) {
      const tw = document.createTreeWalker(r, NodeFilter.SHOW_TEXT);
      let n;
      while ((n = tw.nextNode())) {
        const t = n.textContent;
        if (t && t.trim()) out.push(t);
      }
    }
    return out;
  });

  let emDashLines = 0;
  let middleDotLines = 0;
  let middleDotOverflowLines = [];
  let scrollCueLines = 0;
  let versionLabelLines = 0;
  const emDashExamples = [];
  for (const line of visibleText) {
    if (TEXT_FORBIDDEN.emDash.test(line)) {
      emDashLines += 1;
      emDashExamples.push(line.trim().slice(0, 80));
    }
    // Middle-dot rule: max 1 per LINE. Count occurrences within each
    // line, not just the number of lines containing a dot. Each card
    // meta line ("SWR Picks · 0:32") has exactly 1 dot on 1 line —
    // that is the allowed ration. Multiple dots on one line is the
    // forbidden case ("foo · bar · baz · qux").
    const dotCount = (line.match(/·/g) || []).length;
    if (dotCount > 0) middleDotLines += 1;
    if (dotCount > 1) middleDotOverflowLines.push(line.trim().slice(0, 80));
    if (TEXT_FORBIDDEN.scrollCue.test(line)) scrollCueLines += 1;
    if (TEXT_FORBIDDEN.versionLabel.test(line)) versionLabelLines += 1;
  }
  if (emDashLines === 0) pass('zero em-dashes in visible text');
  else fail(`${emDashLines} em-dash line(s) found, e.g. ${JSON.stringify(emDashExamples.slice(0, 2))}`);
  if (middleDotOverflowLines.length === 0) {
    pass(`middle-dot ration respected (${middleDotLines} line(s) carry 1 dot each, none over)`);
  } else {
    fail(`${middleDotOverflowLines.length} line(s) have 2+ middle-dots: ${JSON.stringify(middleDotOverflowLines.slice(0, 2))}`);
  }
  if (scrollCueLines === 0) pass('no scroll cues');
  else fail(`${scrollCueLines} scroll cue(s) found`);
  if (versionLabelLines === 0) pass('no version labels in visible text');
  else fail(`${versionLabelLines} version label line(s) found`);

  // ---- 7. Color consistency: only ONE accent ----
  // We defined --accent: #d63d6b in the CSS. Sample accent color usage.
  const accentColor = await page.evaluate(() => {
    return getComputedStyle(document.documentElement).getPropertyValue('--accent').trim();
  });
  if (accentColor === '#d63d6b') pass(`single accent locked: ${accentColor}`);
  else fail(`unexpected accent: ${accentColor}`);

  // ---- 8. No console errors ----
  if (consoleErrors.length === 0) pass('zero console errors');
  else {
    fail(`${consoleErrors.length} console error(s):`);
    for (const e of consoleErrors.slice(0, 5)) console.log('  -', e);
  }

  // ---- 9. Mobile viewport check ----
  await page.setViewport({ width: 390, height: 844 });
  await new Promise((r) => setTimeout(r, 400));
  const mobileHero = await page.$eval('.wed-hero-title', (el) => {
    const r = el.getBoundingClientRect();
    return { width: r.width, height: r.height };
  });
  if (mobileHero.width < 380) pass(`mobile hero title fits viewport (w=${Math.round(mobileHero.width)})`);
  else fail(`mobile hero title overflows (w=${Math.round(mobileHero.width)})`);
  // Scroll the mobile viewport to trigger the fade-in observers, then screenshot
  await page.evaluate(async () => {
    const h = document.body.scrollHeight;
    for (let y = 0; y < h; y += 400) { window.scrollTo(0, y); await new Promise((r) => setTimeout(r, 60)); }
    window.scrollTo(0, 0);
    await new Promise((r) => setTimeout(r, 200));
  });
  await page.screenshot({ path: join(SHOTS, 'weddings-mobile.png'), fullPage: true });
  pass('mobile screenshot saved');

  // ---- 10. Desktop screenshots ----
  await page.setViewport({ width: 1440, height: 900 });
  await new Promise((r) => setTimeout(r, 400));
  // Scroll through the desktop viewport to trigger all fade-in observers,
  // then return to top before screenshotting. Without this, sections
  // below the fold are at opacity:0 and the fullPage screenshot is dark.
  await page.evaluate(async () => {
    const h = document.body.scrollHeight;
    for (let y = 0; y < h; y += 600) { window.scrollTo(0, y); await new Promise((r) => setTimeout(r, 80)); }
    window.scrollTo(0, 0);
    await new Promise((r) => setTimeout(r, 250));
  });
  await page.screenshot({ path: join(SHOTS, 'weddings-desktop.png'), fullPage: true });
  pass('desktop full-page screenshot saved');
  await page.screenshot({ path: join(SHOTS, 'weddings-hero.png'), fullPage: false });
  pass('desktop hero screenshot saved');

  await browser.close();

  // ---- summary ----
  const passed = checks.filter((c) => c.ok).length;
  const failed = checks.length - passed;
  console.log(`\n=== ${passed} passed, ${failed} failed (${checks.length} total) ===`);
  writeFileSync('verify-screenshots/weddings-redesign-report.txt',
    checks.map((c) => `${c.ok ? 'PASS' : 'FAIL'} ${c.m}`).join('\n') + '\n');
  process.exit(failed === 0 ? 0 : 1);
})().catch((e) => {
  console.error('verify-weddings-redesign crashed:', e);
  process.exit(2);
});
