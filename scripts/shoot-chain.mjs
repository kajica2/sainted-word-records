// Capture the chain view for visual review.
import puppeteer from 'puppeteer';
import { spawn } from 'node:child_process';
import fs from 'node:fs';

const PORT = 53981;
const BASE = `http://127.0.0.1:${PORT}`;
const OUT = '/workspace/chain-shots';
fs.mkdirSync(OUT, { recursive: true });

const srv = spawn('python3', ['-m', 'http.server', String(PORT)], { cwd: 'dist', stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 1200));

const browser = await puppeteer.launch({
  headless: 'new',
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--autoplay-policy=no-user-gesture-required'],
});

const shots = [
  ['desktop', 1440, 900],
  ['tablet', 768, 1024],
  ['mobile', 375, 812],
];

for (const [name, w, h] of shots) {
  const page = await browser.newPage();
  await page.setViewport({ width: w, height: h, deviceScaleFactor: 1 });
  await page.evaluateOnNewDocument(() => {
    try { localStorage.setItem('swr_app_version_seen', '2026.10.13.1'); } catch (_) {}
  });
  await page.setRequestInterception(true);
  page.on('request', (req) => {
    const u = req.url();
    if (u.startsWith(BASE) || u.startsWith('data:') || u.startsWith('blob:')) return req.continue();
    return req.abort();
  });
  await page.goto(`${BASE}/engine.html?chain=1`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForFunction(() => window.SWR_CHAIN && window.SWR_CHAIN.isEngineHooked(), { timeout: 45000 });
  await new Promise((r) => setTimeout(r, 2500));

  await page.screenshot({ path: `${OUT}/${name}.png` });
  console.log(`captured ${name} ${w}x${h}`);

  // A second shot with the chain "in use": a module off, the knob on Tube,
  // and the chain detail tab open.
  if (name === 'desktop') {
    await page.evaluate(() => {
      const C = window.SWR_CHAIN;
      C.setModule('eq', false);
      C.setMode('tube');
      C.setTab('chain');
      C.setReference(true);
    });
    await new Promise((r) => setTimeout(r, 900));
    await page.screenshot({ path: `${OUT}/${name}-chain-tab.png` });
    console.log('captured desktop chain-tab');

    await page.evaluate(() => window.SWR_CHAIN.setTab('curve'));
    await new Promise((r) => setTimeout(r, 700));
    await page.screenshot({ path: `${OUT}/${name}-tube.png` });
    console.log('captured desktop tube');
  }
  await page.close();
}

await browser.close();
srv.kill();
console.log('done →', OUT);
