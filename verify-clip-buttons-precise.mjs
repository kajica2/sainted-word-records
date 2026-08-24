// Precise closeup of the per-clip ↻ + 🎲 buttons
import puppeteer from 'puppeteer';

const browser = await puppeteer.launch({
  headless: 'new',
  args: ['--no-sandbox', '--disable-setuid-sandbox', '--autoplay-policy=no-user-gesture-required'],
});
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1400, height: 900, deviceScaleFactor: 2 });
  page.on('pageerror', () => {});
  await page.goto('http://localhost:5174/index.html', { waitUntil: 'networkidle0' });
  await page.evaluate(() => document.fonts.ready);
  await new Promise((r) => setTimeout(r, 800));
  await page.evaluate(() => {
    for (let i = 0; i < 3; i++) window.Layers.add({ name: 'sample-' + (i + 1) + '.mp4', thumb: null });
    window.Layers.render();
  });
  await new Promise((r) => setTimeout(r, 300));

  // Direct screenshot of each .layer-head, scaled 4x for visibility
  const heads = await page.$$('.layer .layer-head');
  for (let i = 0; i < heads.length; i++) {
    await heads[i].screenshot({ path: `verify-screenshots/clip-head-${i + 1}.png` });
  }

  // Also: hover-state shot of head 0 to show pink accent on hover
  await heads[0].hover();
  await new Promise((r) => setTimeout(r, 200));
  await heads[0].screenshot({ path: 'verify-screenshots/clip-head-hover.png' });

  // Stack the 3 heads vertically with labels
  await page.screenshot({
    path: 'verify-screenshots/clip-heads-zoom.png',
    clip: { x: 1120, y: 95, width: 280, height: 100 },
  });

  console.log('OK: wrote', heads.length, 'layer-head screenshots + zoom');
} catch (e) {
  console.error('FAIL:', e.message);
  process.exit(1);
} finally {
  await browser.close();
}
