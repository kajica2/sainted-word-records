// Quick closeup of the per-clip rotate + randomise buttons
import puppeteer from 'puppeteer';

const URL = 'http://localhost:5174/index.html';
const browser = await puppeteer.launch({
  headless: 'new',
  args: ['--no-sandbox', '--disable-setuid-sandbox', '--autoplay-policy=no-user-gesture-required'],
});
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1400, height: 900, deviceScaleFactor: 2 });
  page.on('pageerror', () => {}); // suppress pre-existing engine bug noise
  await page.goto(URL, { waitUntil: 'networkidle0', timeout: 30000 });
  await page.evaluate(() => document.fonts.ready);
  await new Promise((r) => setTimeout(r, 800));

  // Add 3 mock layers
  await page.evaluate(() => {
    for (let i = 0; i < 3; i++) {
      window.Layers.add({ name: 'sample-' + (i + 1) + '.mp4', thumb: null });
    }
    if (window.Layers.render) window.Layers.render();
  });
  await new Promise((r) => setTimeout(r, 200));

  // Make a single layer selected so we can show the r-key behavior too
  await page.evaluate(() => {
    const layers = document.querySelectorAll('.layer');
    if (layers[0]) layers[0].click();
  });
  await new Promise((r) => setTimeout(r, 200));

  // Find the first .layer-head, scroll into view
  const head = await page.$('.layer .layer-head');
  if (!head) throw new Error('no .layer-head found');

  // Get bounding box of the first layer (full row, not just head)
  const layer = await page.$('.layer');
  const box = await layer.boundingBox();
  await page.evaluate((y) => window.scrollTo(0, y - 80), box.y);

  // Hover the first layer to show its action affordances (if any)
  await page.hover('.layer');

  await new Promise((r) => setTimeout(r, 200));
  await layer.screenshot({ path: 'verify-screenshots/clip-buttons-row.png' });

  // Wider shot of the layers panel
  const panel = await page.$('#layers');
  if (panel) {
    const pbox = await panel.boundingBox();
    await page.screenshot({
      path: 'verify-screenshots/clip-buttons-panel.png',
      clip: { x: pbox.x, y: pbox.y, width: pbox.width, height: Math.min(420, pbox.height) },
    });
  }

  console.log('OK: clip-button screenshots written');
} catch (e) {
  console.error('FAIL:', e.message);
  process.exit(1);
} finally {
  await browser.close();
}
