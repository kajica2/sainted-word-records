// Smoke test for the click-reactive landing-page demo.
// Loads /landing.html, waits for the engine-mini custom element to mount,
// clicks it twice, and asserts:
//   - the SVG overlay gained children (primitives were acquired)
//   - click 1 changes the SVG child count or transforms
//   - click 2 changes them again (cycles to a new scene)
//   - the canvas palette / item colors actually changed too
//   - no JS errors thrown
//
// Run: node verify-landing-click-demo.mjs

import puppeteer from 'puppeteer';

const URL = process.env.SWR_URL || 'http://127.0.0.1:5174/landing.html';

const browser = await puppeteer.launch({
  headless: 'new',
  args: [
    '--no-sandbox',
    '--autoplay-policy=no-user-gesture-required',
    '--disable-background-timer-throttling',
    '--disable-renderer-backgrounding',
    '--use-gl=swiftshader',
  ],
});
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 900 });

let pageErrors = [];
page.on('pageerror', (e) => { pageErrors.push(e.message); console.log('  [pageerror]', e.message); });
page.on('console', (m) => {
  const t = m.type();
  if (t === 'error') { pageErrors.push(m.text()); console.log(`  [page ${t}]`, m.text()); }
});

console.log(`▶ loading ${URL}`);
// Persona-onboarding renders an overlay that covers the hero on first
// visit and intercepts the click. Bypass it for the test by setting
// the storage key the onboarding reads ("swr.persona.v1" — see
// persona-onboarding.js line that defines STORAGE_KEY) before the
// script boots.
await page.evaluateOnNewDocument(() => {
  try {
    localStorage.setItem('swr.persona.v1', JSON.stringify({ id: 'skipped', skippedAt: new Date().toISOString() }));
  } catch (_) {}
});
await page.goto(URL, { waitUntil: 'networkidle0', timeout: 45000 });
// As an additional safety net, call the public hide() if available.
// (No-op if onboarding already skipped itself.)
await page.evaluate(() => { try { window.SWR_PERSONA && window.SWR_PERSONA.hide(); } catch (_) {} });
// Wait for the engine-mini custom element to actually mount AND acquire primitives
await page.waitForFunction(() => {
  const el = document.querySelector('engine-mini');
  if (!el) return false;
  const svg = el.querySelector('.engine-mini__svg');
  // SVGs that are still in the process of acquiring primitives show
  // 0 children; give it 1 second to finish.
  return !!svg;
}, { timeout: 15000 });

// Give primitive acquisition time to land (the fetches are awaited but
// the SVG children get appended inside an async block)
await new Promise(r => setTimeout(r, 1500));

const before = await page.evaluate(() => {
  const el = document.querySelector('engine-mini');
  const svg = el.querySelector('.engine-mini__svg');
  // Read canvas item colors — there's no public surface for them, but
  // we can fingerprint by drawing the canvas and reading pixel data.
  // Instead, sample a single pixel near the center (engine-mini items
  // are large radial gradients so the dominant color of a center pixel
  // is a reasonable proxy for "which palette is on").
  const c = el.querySelector('canvas');
  const cx = c.getContext('2d');
  const px = cx.getImageData(Math.floor(c.width / 2), Math.floor(c.height / 2), 1, 1).data;
  return {
    childCount: svg.children.length,
    transforms: Array.from(svg.querySelectorAll('g')).map(g => g.getAttribute('transform')),
    centerPixel: `rgba(${px[0]},${px[1]},${px[2]},${px[3]})`,
    canvasSize: { w: c.width, h: c.height },
  };
});
console.log('▶ before click:', JSON.stringify(before, null, 2));

// Take a screenshot before click
await page.screenshot({ path: '/tmp/landing-click-before.png' });

// Click the engine-mini
const box = await page.$eval('engine-mini', (el) => {
  const r = el.getBoundingClientRect();
  return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
});
console.log('▶ click target:', box);
const beforeUrl = page.url();
console.log('▶ url before click:', beforeUrl);
await page.mouse.click(box.x, box.y);
await new Promise(r => setTimeout(r, 200));
const afterUrl = page.url();
console.log('▶ url 200ms after click:', afterUrl);
if (afterUrl !== beforeUrl) {
  console.error('FAIL: click navigated the page (was on a link target). aborting.');
  await browser.close();
  process.exit(1);
}

// Give the morph + converge animation time to complete (700ms morph + 900ms converge)
await new Promise(r => setTimeout(r, 1200));

const afterClick1 = await page.evaluate(() => {
  const el = document.querySelector('engine-mini');
  const svg = el && el.querySelector('.engine-mini__svg');
  if (!el || !svg) {
    return { error: 'engine-mini or its svg not found', hasEl: !!el, url: location.href, body: document.body.children.length };
  }
  const c = el.querySelector('canvas');
  const cx = c.getContext('2d');
  const px = cx.getImageData(Math.floor(c.width / 2), Math.floor(c.height / 2), 1, 1).data;
  return {
    childCount: svg.children.length,
    transforms: Array.from(svg.querySelectorAll('g')).map(g => g.getAttribute('transform')),
    centerPixel: `rgba(${px[0]},${px[1]},${px[2]},${px[3]})`,
  };
});
console.log('▶ after click 1:', JSON.stringify(afterClick1, null, 2));
await page.screenshot({ path: '/tmp/landing-click-after1.png' });

// Second click — confirm it cycles to a DIFFERENT scene
await page.mouse.click(box.x, box.y);
await new Promise(r => setTimeout(r, 1200));

const afterClick2 = await page.evaluate(() => {
  const el = document.querySelector('engine-mini');
  const svg = el.querySelector('.engine-mini__svg');
  const c = el.querySelector('canvas');
  const cx = c.getContext('2d');
  const px = cx.getImageData(Math.floor(c.width / 2), Math.floor(c.height / 2), 1, 1).data;
  return {
    childCount: svg.children.length,
    transforms: Array.from(svg.querySelectorAll('g')).map(g => g.getAttribute('transform')),
    centerPixel: `rgba(${px[0]},${px[1]},${px[2]},${px[3]})`,
  };
});
console.log('▶ after click 2:', JSON.stringify(afterClick2, null, 2));
await page.screenshot({ path: '/tmp/landing-click-after2.png' });

await browser.close();

// ---- Assertions ----
const errors = [];
if (before.childCount === 0) errors.push(`SVG had 0 children before any click — primitive acquisition didn't land`);
if (afterClick1.childCount === 0) errors.push(`SVG has 0 children after click 1`);
if (afterClick2.childCount === 0) errors.push(`SVG has 0 children after click 2`);
// Transforms must change between scenes (gyromorph + converge)
const sigChanged = (a, b) => JSON.stringify(a) !== JSON.stringify(b);
if (!sigChanged(before.transforms, afterClick1.transforms)) {
  errors.push(`transforms unchanged after click 1 — gyromorph did not run`);
}
if (!sigChanged(afterClick1.transforms, afterClick2.transforms)) {
  errors.push(`transforms unchanged between click 1 and click 2 — scene cycle stuck`);
}
// Canvas pixel must change between scenes (palette swap)
if (before.centerPixel === afterClick1.centerPixel && afterClick1.centerPixel === afterClick2.centerPixel) {
  errors.push(`canvas center pixel unchanged across both clicks — palette did not swap`);
}
if (pageErrors.length) errors.push(`page errors: ${pageErrors.join('; ')}`);

if (errors.length) {
  console.error('\nFAIL:');
  errors.forEach(e => console.error('  -', e));
  process.exit(1);
}

console.log('\n✅ PASS — landing demo reacts to clicks.');
console.log(`   before:  ${before.childCount} primitives, pixel ${before.centerPixel}`);
console.log(`   click 1: ${afterClick1.childCount} primitives, pixel ${afterClick1.centerPixel}`);
console.log(`   click 2: ${afterClick2.childCount} primitives, pixel ${afterClick2.centerPixel}`);
console.log(`   screenshots: /tmp/landing-click-before.png /tmp/landing-click-after1.png /tmp/landing-click-after2.png`);
