// Clean closeup — hide header overlay so .layer-head is fully visible
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

  // Temporarily hide top header buttons so they don't occlude the layer-head
  await page.evaluate(() => {
    const ids = ['save', 'load', 're-map', 'play'];
    for (const id of ids) {
      const el = document.getElementById(id);
      if (el) el.style.visibility = 'hidden';
    }
  });
  await new Promise((r) => setTimeout(r, 200));

  // Now direct element screenshot of each head
  const heads = await page.$$('.layer .layer-head');
  for (let i = 0; i < heads.length; i++) {
    await heads[i].screenshot({ path: `verify-screenshots/head-${i + 1}.png` });
  }
  // Hover state of head 1 to show pink accent
  await heads[0].hover();
  await new Promise((r) => setTimeout(r, 250));
  await heads[0].screenshot({ path: 'verify-screenshots/head-hover.png' });

  console.log('OK: clean heads written');
} catch (e) {
  console.error('FAIL:', e.message);
  process.exit(1);
} finally {
  await browser.close();
}
