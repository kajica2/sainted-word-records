// Screenshot a live SWR surface for design reference.
import puppeteer from 'puppeteer';
import fs from 'node:fs';

const OUT = '/workspace/chain-shots/live';
fs.mkdirSync(OUT, { recursive: true });

const urls = process.argv.slice(2);
const browser = await puppeteer.launch({
  headless: 'new',
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--ignore-certificate-errors'],
});

for (const u of urls) {
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  await page.evaluateOnNewDocument(() => {
    try { localStorage.setItem('swr_app_version_seen', '2026.10.13.1'); } catch (_) {}
  });
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message.slice(0, 90)));
  try {
    await page.goto(u, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await new Promise((r) => setTimeout(r, 6000));
    const name = u.replace(/[^a-z0-9]+/gi, '_').slice(-42);
    await page.screenshot({ path: `${OUT}/${name}.png` });
    const info = await page.evaluate(() => ({
      title: document.title,
      ids: [...document.querySelectorAll('[id]')].map((n) => n.id).slice(0, 40),
      bodyClass: document.body.className,
      canvases: [...document.querySelectorAll('canvas')].map((c) => ({ id: c.id, w: c.width, h: c.height })),
      scripts: [...document.querySelectorAll('script[src]')].map((s) => s.getAttribute('src')).slice(0, 20),
    }));
    console.log(`\n=== ${u}`);
    console.log('  title:', info.title);
    console.log('  bodyClass:', info.bodyClass);
    console.log('  canvases:', JSON.stringify(info.canvases));
    console.log('  scripts:', JSON.stringify(info.scripts));
    console.log('  pageerrors:', errs.length ? errs.slice(0, 3) : 'none');
    fs.writeFileSync(`${OUT}/${name}.json`, JSON.stringify(info, null, 1));
  } catch (e) {
    console.log(`\n=== ${u}\n  FAILED: ${e.message.slice(0, 120)}`);
  }
  await page.close();
}
await browser.close();
