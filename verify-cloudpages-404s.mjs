// Find the exact 404 URLs on the live site
import puppeteer from 'puppeteer';

const BASE = 'https://8njt2nb31rmfu.space.minimax.io';
const PAGES_TO_INSPECT = ['/index.html', '/personas.html', '/landing-personas-v4-dashboard.html'];

const browser = await puppeteer.launch({
  headless: 'new',
  args: ['--no-sandbox', '--disable-setuid-sandbox'],
});
try {
  for (const p of PAGES_TO_INSPECT) {
    const page = await browser.newPage();
    const four04 = [];
    page.on('response', (resp) => {
      if (resp.status() === 404) four04.push(resp.url());
    });
    page.on('requestfailed', (req) => {
      if (req.failure() && req.failure().errorText) {
        four04.push(req.url() + '  [failed: ' + req.failure().errorText + ']');
      }
    });
    await page.goto(BASE + p, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(e => console.log('  goto warn:', e.message));
    await new Promise(r => setTimeout(r, 3000));
    console.log(`\n=== ${p} ===`);
    for (const u of four04) console.log('  404:', u);
    await page.close();
  }
} finally {
  await browser.close();
}
