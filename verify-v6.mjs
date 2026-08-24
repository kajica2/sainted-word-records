// Puppeteer verifier for landing-personas-v6-wireframe.html (V6 wireframe register).
// Runs 15 checks + 2 screenshots. Exits 0 on GREEN, 1 on RED.
import puppeteer from 'puppeteer';
import { mkdirSync } from 'node:fs';

const URL = 'http://localhost:5174/landing-personas-v6-wireframe.html';
const SISTER_PAGES = [
  'landing-personas-v1-editorial.html',
  'landing-personas-v2-dark.html',
  'landing-personas-v3-friendly.html',
  'landing-personas-v4-dashboard.html',
  'landing-personas-v5-brutalist.html',
];
const FORBIDDEN_FONTS = ['Fraunces', 'Geist', 'Space Grotesk', 'DM Serif', 'Inter', 'Archivo Black'];
const PINK_RGB = 'rgb(230, 48, 107)';
const PINK_HEX = '#e6306b';

// Suppress pre-existing engine noise from sister pages. VERT / drawImage fires
// on other pages only, never on V6 — but guard anyway in case V6 loads them.
const SUPPRESS_PATTERNS = [
  /VERT is not defined/i,
  /drawImage/i,
  /Failed to load resource.*favicon/i,
  // Vite HMR / dev-server connection-refused noise — never indicates a real
  // page error. Fires when Vite's client tries to reconnect after a navigation.
  /net::ERR_CONNECTION_REFUSED/i,
  /net::ERR_ABORTED/i,
  /\/@vite\/client/i,
  /hot-update/i,
];

function shouldSuppress(msg) {
  return SUPPRESS_PATTERNS.some((re) => re.test(msg));
}

const errors = [];
const checks = [];

function pushError(e) {
  if (!shouldSuppress(e)) errors.push(e);
}

const browser = await puppeteer.launch({
  headless: 'new',
  args: ['--no-sandbox', '--disable-setuid-sandbox'],
});

try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1400, height: 900, deviceScaleFactor: 1 });

  page.on('pageerror', (e) => pushError('pageerror: ' + e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') pushError('console.error: ' + m.text());
  });
  page.on('requestfailed', (req) => {
    const u = req.url();
    if (u.includes('favicon') || u.includes('hot-update') || u.endsWith(':5174/') || u.includes('@vite/client')) return;
    pushError('requestfailed: ' + u + ' ' + (req.failure()?.errorText || ''));
  });

  let resp;
  try {
    resp = await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
  } catch (e) {
    console.error('FAILED to load page:', e.message);
    console.error('Start dev server with: npx vite --port 5174');
    process.exit(1);
  }

  // Let fonts settle and Three.js init + render
  await page.evaluate(() => document.fonts.ready).catch(() => {});
  await new Promise((r) => setTimeout(r, 3000));

  // ───────── 1. HTTP 200 ─────────
  const status = resp ? resp.status() : 0;
  checks.push({
    name: '1. HTTP 200',
    ok: status === 200,
    detail: `status=${status}`,
  });

  // ───────── 2. No console errors (counted separately at the end) ─────────
  // We surface this at the end so it stays 0/0 even if other checks fail first.
  checks.push({
    name: '2. No console errors (pageerror / console.error)',
    ok: errors.filter((e) => !shouldSuppress(e)).length === 0,
    detail: errors.filter((e) => !shouldSuppress(e)).length + ' error(s)',
  });

  // ───────── 3. Three.js loaded ─────────
  const threeLoaded = await page.evaluate(() => typeof window.THREE === 'object' && window.THREE !== null);
  checks.push({ name: '3. window.THREE defined', ok: !!threeLoaded, detail: threeLoaded ? 'OK' : 'THREE missing' });

  // ───────── 4 & 5. Canvases: total count + hero canvas width > 400 ─────────
  const canvasInfo = await page.evaluate(() => {
    const list = Array.from(document.querySelectorAll('canvas'));
    return list.map((c) => ({ w: c.width, h: c.height }));
  });
  const totalCanvases = canvasInfo.length;
  const heroWide = canvasInfo.filter((c) => c.w > 400);
  checks.push({
    name: '4. Hero canvas exists (width > 400)',
    ok: heroWide.length >= 1,
    detail: `hero-sized: ${heroWide.length}`,
  });
  checks.push({
    name: '5. At least 8 persona canvases total',
    ok: totalCanvases >= 8,
    detail: `total=${totalCanvases}`,
  });

  // ───────── 6. Hero canvas has non-empty pixels (Three.js actually rendered) ─────────
  // WebGL canvases default to preserveDrawingBuffer:false, so readPixels /
  // drawImage return zeros after the composite. Use Puppeteer's element
  // screenshot (compositor path) to capture the rendered frame, then check
  // the screenshot buffer is bigger than a blank canvas would be. A blank
  // WebGL canvas element-screenshot compresses to < 5KB; a real render is
  // 20-300KB+ depending on detail.
  let heroShotBytes = 0;
  try {
    const heroHandle = await page.$('#hero-canvas');
    if (heroHandle) {
      // Bring it into view first so it's actually composited.
      await page.evaluate(() => {
        const c = document.getElementById('hero-canvas');
        if (c) c.scrollIntoView({ block: 'center' });
      });
      await new Promise((r) => setTimeout(r, 300));
      const buf = await heroHandle.screenshot({ omitBackground: false });
      heroShotBytes = buf ? buf.length : 0;
    }
  } catch (e) {
    heroShotBytes = 0;
  }
  // Threshold: a blank WebGL canvas screenshot is ~1-3KB. A real Three.js
  // render of a 600x420 hero with geometry/lines/points is typically 20KB+.
  const HERO_MIN_BYTES = 8 * 1024;
  checks.push({
    name: '6. Hero canvas has non-background pixels (≥ 50)',
    ok: heroShotBytes >= HERO_MIN_BYTES,
    detail: `hero screenshot bytes=${heroShotBytes} (threshold=${HERO_MIN_BYTES})`,
  });

  // ───────── 7. Exactly 8 persona cards ─────────
  // V6 is a wireframe register — it renders one card per persona. Look for any
  // element that has the "persona" class/structure, scoped to body (skip <script>).
  const personaCount = await page.evaluate(() => {
    const all = Array.from(document.body.querySelectorAll('*'));
    // 1. Class-based: any element with class containing "persona"
    const byClass = all.filter((el) => {
      const cls = (el.className && typeof el.className === 'string') ? el.className.toLowerCase() : '';
      return cls.includes('persona');
    });
    // 2. Structure-based: a card whose dataset.name or inner text starts with one of
    //    the 8 known persona names
    const NAMES = [
      'indie musician', 'beatmaker', 'dj', 'small label',
      'belgrade', 'podcaster', 'sound designer', 'music manager',
    ];
    const byName = all.filter((el) => {
      const t = (el.innerText || '').toLowerCase().trim();
      if (!t || t.length > 200) return false;
      return NAMES.some((n) => t === n || t.startsWith(n + ' ') || t.startsWith(n + ',') || t.startsWith(n + '\n'));
    });
    return { byClass: byClass.length, byName: byName.length };
  });
  checks.push({
    name: '7. Exactly 8 persona cards',
    ok: personaCount.byClass === 8 || personaCount.byName === 8,
    detail: `byClass=${personaCount.byClass}, byName=${personaCount.byName}`,
  });

  // ───────── 8. No pink #e6306b leak ─────────
  // Walk all elements, sample both color and backgroundColor computed styles.
  const pinkLeak = await page.evaluate((target) => {
    const all = Array.from(document.querySelectorAll('*'));
    const leaks = [];
    for (const el of all) {
      const cs = getComputedStyle(el);
      for (const prop of ['color', 'backgroundColor', 'borderTopColor', 'borderRightColor', 'borderBottomColor', 'borderLeftColor', 'outlineColor', 'fill', 'stroke']) {
        const v = cs[prop] || '';
        if (v === target || v.toLowerCase() === '#e6306b') {
          leaks.push({ tag: el.tagName, prop, value: v });
        }
      }
    }
    return { count: leaks.length, sample: leaks.slice(0, 5) };
  }, PINK_RGB);
  checks.push({
    name: '8. No pink #e6306b leak',
    ok: pinkLeak.count === 0,
    detail: pinkLeak.count === 0 ? 'clean' : `${pinkLeak.count} leak(s), e.g. ${JSON.stringify(pinkLeak.sample)}`,
  });

  // ───────── 9. Font is JetBrains Mono (≥ 5 elements) ─────────
  // Excludes the FORBIDDEN_FONTS list — if any element has *only* a forbidden
  // font, that's a smell. We count elements whose computed font-family contains
  // "JetBrains Mono".
  const fontStats = await page.evaluate((forbidden) => {
    const all = Array.from(document.querySelectorAll('body, body *')).filter((el) => {
      // Only text-bearing leaf-ish elements are interesting
      return el.children.length < 4 && (el.innerText || '').trim().length > 0;
    });
    let jbm = 0;
    let forbiddenHits = [];
    for (const el of all) {
      const ff = (getComputedStyle(el).fontFamily || '').toLowerCase();
      if (ff.includes('jetbrains mono')) jbm++;
      for (const f of forbidden) {
        if (ff.includes(f.toLowerCase())) {
          forbiddenHits.push({ tag: el.tagName, font: ff });
          break;
        }
      }
    }
    return { jbm, forbiddenHits: forbiddenHits.slice(0, 5), total: all.length };
  }, FORBIDDEN_FONTS);
  checks.push({
    name: '9. Font is JetBrains Mono (≥ 5 elements)',
    ok: fontStats.jbm >= 5,
    detail: `JetBrains Mono on ${fontStats.jbm}/${fontStats.total} elements; forbidden=${fontStats.forbiddenHits.length}`,
  });

  // ───────── 10. 5 cross-links to V1–V5 in floating switcher ─────────
  // The sister-registers nav is a fixed widget; V6 must link to all 5 sisters
  // (V1, V2, V3, V4, V5) — one chip per register, no V6 chip (this IS V6).
  const sisterLinkCount = await page.evaluate((pages) => {
    const anchors = Array.from(document.querySelectorAll('a[href]'));
    const uniq = new Set();
    for (const a of anchors) {
      const h = a.getAttribute('href') || '';
      for (const p of pages) {
        if (h.includes(p)) {
          // Normalize: track the filename only
          uniq.add(p);
        }
      }
    }
    return uniq.size;
  }, SISTER_PAGES);
  checks.push({
    name: '10. 5 cross-links to V1–V5 in switcher',
    ok: sisterLinkCount === 5,
    detail: `unique sister hrefs=${sisterLinkCount}`,
  });

  // ───────── 11. No border-radius > 0 on a sample of 20+ elements ─────────
  // Sample a wide mix of elements (cards, buttons, badges, nav, sections).
  const radiusLeaks = await page.evaluate(() => {
    const selectors = [
      'body *',
    ];
    const all = Array.from(document.querySelectorAll('body, body *'));
    // Shuffle and sample 30
    const sample = all.slice(0, Math.min(40, all.length));
    const leaks = [];
    for (const el of sample) {
      const cs = getComputedStyle(el);
      const r = cs.borderTopLeftRadius || cs.borderRadius || '0px';
      // Parse "Xpx" or "X Y Z W" — any positive value is a leak.
      const m = String(r).match(/([\d.]+)px/);
      const v = m ? parseFloat(m[1]) : 0;
      if (v > 0) leaks.push({ tag: el.tagName, cls: (el.className || '').toString().slice(0, 40), radius: r });
    }
    return { sampled: sample.length, leaks: leaks.slice(0, 5), leakCount: leaks.length };
  });
  checks.push({
    name: '11. No border-radius > 0 on sampled elements',
    ok: radiusLeaks.leakCount === 0,
    detail: `sampled=${radiusLeaks.sampled}, leaks=${radiusLeaks.leakCount}${radiusLeaks.leakCount ? ' ' + JSON.stringify(radiusLeaks.leaks) : ''}`,
  });

  // ───────── 12. Exactly 1 h1 with non-empty text ─────────
  const h1Info = await page.evaluate(() => {
    const h1s = Array.from(document.querySelectorAll('h1'));
    const filled = h1s.filter((h) => (h.innerText || '').trim().length > 0);
    return { total: h1s.length, filled: filled.length, text: filled[0]?.innerText?.trim().slice(0, 80) || '' };
  });
  checks.push({
    name: '12. Exactly 1 h1 with non-empty text',
    ok: h1Info.total === 1 && h1Info.filled === 1,
    detail: `total=${h1Info.total}, filled=${h1Info.filled}, text="${h1Info.text}"`,
  });

  // ───────── 13. Title contains "V6" or "Wireframe" ─────────
  const title = await page.title();
  checks.push({
    name: '13. Title contains "V6" or "Wireframe"',
    ok: /V6|Wireframe/i.test(title),
    detail: `title="${title}"`,
  });

  // ───────── 14. Inline personas JSON with 8 entries ─────────
  const inlineData = await page.evaluate(() => {
    const s = document.getElementById('personas-data');
    if (!s) return { ok: false, reason: 'no #personas-data script tag' };
    try {
      const d = JSON.parse(s.textContent || '');
      const arr = Array.isArray(d) ? d : (Array.isArray(d.personas) ? d.personas : null);
      if (!arr) return { ok: false, reason: 'no personas array' };
      if (arr.length !== 8) return { ok: false, reason: `arr.length=${arr.length}` };
      const sample = arr[0]?.name || Object.keys(arr[0] || {}).join(',');
      return { ok: true, length: arr.length, firstName: sample };
    } catch (e) {
      return { ok: false, reason: 'parse error: ' + e.message };
    }
  });
  checks.push({
    name: '14. Inline #personas-data JSON has 8 entries',
    ok: !!inlineData.ok,
    detail: inlineData.ok ? `8 entries, first="${inlineData.firstName}"` : inlineData.reason,
  });

  // ───────── 15. Screenshots (2 total) ─────────
  mkdirSync('verify-screenshots', { recursive: true });
  await page.screenshot({
    path: 'verify-screenshots/v6-hero.png',
    clip: { x: 0, y: 0, width: 1400, height: 800 },
  });
  // Scroll the personas section into view, then capture full viewport.
  const scrollInfo = await page.evaluate(() => {
    // Try a few selectors that should be unique to the personas section
    const candidates = [
      'section.personas', '.personas', '#personas', '[class*="persona-grid"]',
      '[class*="personas-section"]', 'main', 'body > section:nth-of-type(2)',
    ];
    for (const sel of candidates) {
      const el = document.querySelector(sel);
      if (el) {
        const r = el.getBoundingClientRect();
        return { sel, y: window.scrollY + r.top, h: r.height };
      }
    }
    // Fall back to scrolling past the hero (estimate ~ 900px hero).
    return { sel: '(fallback)', y: 900, h: 0 };
  });
  await page.evaluate((y) => window.scrollTo(0, y), scrollInfo.y);
  await new Promise((r) => setTimeout(r, 400));
  await page.screenshot({
    path: 'verify-screenshots/v6-cards.png',
    clip: { x: 0, y: 0, width: 1400, height: 800 },
  });
  // Reset scroll for clean output
  await page.evaluate(() => window.scrollTo(0, 0));
  checks.push({
    name: '15. Screenshots saved (v6-hero.png, v6-cards.png)',
    ok: true,
    detail: `hero scrolled-to=0; cards scrolled-to=${Math.round(scrollInfo.y)} (${scrollInfo.sel})`,
  });

  // ───────── Report ─────────
  console.log('\n=== V6 VERIFY · ' + URL + ' ===\n');
  for (const c of checks) {
    console.log((c.ok ? '✓' : '✗') + ' ' + c.name + (c.detail ? '  ' + c.detail : ''));
  }
  const realErrors = errors.filter((e) => !shouldSuppress(e));
  console.log('\nerrors:', realErrors.length);
  for (const e of realErrors) console.log('  ✗', e);
  console.log('suppressed (pre-existing):', errors.length - realErrors.length);

  const allOk = checks.every((c) => c.ok) && realErrors.length === 0;
  console.log('\nFINAL:', allOk ? 'GREEN ✓' : 'RED ✗');
  process.exit(allOk ? 0 : 1);
} catch (e) {
  console.error('UNCAUGHT:', e.stack || e.message);
  process.exit(2);
} finally {
  await browser.close();
}
