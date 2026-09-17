// scripts/_shot-pl.mjs — capture a page at 1440px (top viewport + full page)
// for before/after visual comparison. Usage: node scripts/_shot-pl.mjs <url> <prefix>
import puppeteer from 'puppeteer';

const [, , url, prefix] = process.argv;
if (!url || !prefix) { console.error('usage: node scripts/_shot-pl.mjs <url> <prefix>'); process.exit(1); }

const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
const errors = [];
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text().slice(0, 200)); });
  page.on('requestfailed', r => errors.push('reqfail: ' + r.url().slice(0, 140)));
  await page.goto(url, { waitUntil: 'networkidle0', timeout: 45000 });
  await new Promise(r => setTimeout(r, 1500));
  await page.screenshot({ path: `/tmp/${prefix}-top.png` });
  // scroll through the page to trigger IntersectionObserver reveals
  await page.evaluate(async () => {
    const h = document.body.scrollHeight;
    for (let y = 0; y < h; y += 700) { window.scrollTo(0, y); await new Promise(r => setTimeout(r, 60)); }
    window.scrollTo(0, 0);
  });
  await new Promise(r => setTimeout(r, 1200));
  await page.screenshot({ path: `/tmp/${prefix}-full.png`, fullPage: true });
  const dims = await page.evaluate(() => ({ h: document.body.scrollHeight, title: document.title }));
  console.log(JSON.stringify({ ok: true, dims, errors }, null, 2));
} catch (e) {
  console.log(JSON.stringify({ ok: false, error: e.message, errors }, null, 2));
} finally {
  await browser.close();
}
