// Capture swr-app.html at 4 viewports and save to /tmp for visual review
import puppeteer from 'puppeteer';
import fs from 'fs';

const URL = 'https://sainted-word-records.vercel.app/swr-app.html';
const VIEWPORTS = [
  { name: 'desktop-1440', w: 1440, h: 900 },
  { name: 'tablet-900',   w: 900,  h: 1200 },
  { name: 'mobile-414',   w: 414,  h: 896 },
  { name: 'mobile-small', w: 360,  h: 740 },
];

const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
try {
  for (const v of VIEWPORTS) {
    const page = await browser.newPage();
    await page.setViewport({ width: v.w, height: v.h, deviceScaleFactor: 1 });
    await page.goto(URL + '?cb=' + Date.now(), { waitUntil: 'networkidle0', timeout: 30000 });
    // Dismiss onboarding if visible
    await page.evaluate(() => {
      const btn = document.querySelector('button[data-onboard="dismiss"]');
      if (btn) btn.click();
    });
    // Wait a tick for the layout to settle
    await new Promise(r => setTimeout(r, 800));
    const path = `/tmp/responsive-${v.name}.png`;
    await page.screenshot({ path, fullPage: false });
    console.log(`${v.name}: ${path}`);
    await page.close();
  }
} finally {
  await browser.close();
}
