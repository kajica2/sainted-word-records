// verify-new-versions.mjs — screenshot the 7 new versions to verify-screenshots/
// Loads each, takes a 1440x900 screenshot, asserts SWR_NAV_OK (no console errors).
import puppeteer from '/Users/kajicadjuric/Documents/autodashboard/magenta-dsp-procedural/node_modules/puppeteer/lib/puppeteer/puppeteer.js';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BASE = process.env.SWR_BASE || 'http://localhost:5174';
const OUT  = path.join(__dirname, 'verify-screenshots');
fs.mkdirSync(OUT, { recursive: true });

const versions = ['glitch', 'aurora', 'pulse', 'void', 'chrome', 'watercolor', 'fractal'];

const browser = await puppeteer.launch({
  headless: 'new',
  args: ['--no-sandbox', '--disable-setuid-sandbox', '--use-fake-ui-for-media-stream'],
});

let allOk = true;
const report = [];

for (const v of versions) {
  console.log('\n=== ' + v.toUpperCase() + ' ===');
  const errs = [];
  const pageErrs = [];
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  page.on('console', m => { if (m.type() === 'error') errs.push(m.text()); });
  page.on('pageerror', e => pageErrs.push(String(e)));

  try {
    const resp = await page.goto(BASE + '/versions/' + v + '.html', { waitUntil: 'networkidle0', timeout: 20000 });
    if (!resp || resp.status() !== 200) {
      console.log('  FAIL  HTTP ' + (resp ? resp.status() : 'no response'));
      allOk = false;
      report.push({ v, status: resp ? resp.status() : 'none', ok: false });
      await page.close();
      continue;
    }
    // Let the engine + draw loop spin up
    await new Promise(r => setTimeout(r, 3500));

    // Assert: page has the expected title
    const title = await page.title();
    const expected = v.toUpperCase();
    if (!title.startsWith(expected)) {
      console.log('  FAIL  title=' + JSON.stringify(title) + ' (expected to start with ' + expected + ')');
      allOk = false;
    } else {
      console.log('  title: ' + title);
    }

    // Assert: data-page attribute matches
    const page_id = await page.evaluate(() => document.body.getAttribute('data-page'));
    if (page_id !== v) {
      console.log('  FAIL  data-page=' + JSON.stringify(page_id));
      allOk = false;
    } else {
      console.log('  data-page: ' + page_id);
    }

    // Assert: visible wordmark
    const word = await page.$eval('.v', el => el.textContent.trim());
    if (!word.startsWith(expected)) {
      console.log('  FAIL  wordmark=' + JSON.stringify(word));
      allOk = false;
    } else {
      console.log('  wordmark: ' + word);
    }

    // Assert: stage canvas exists (versions use id="render", not "stage")
    const stageOk = await page.$('section.stage canvas#render');
    if (!stageOk) {
      console.log('  FAIL  no section.stage canvas#render');
      allOk = false;
    } else {
      console.log('  stage canvas present');
    }

    // Filter favicon noise
    const realErrs = errs.filter(e => !/favicon\.ico/.test(e) && !/404 \(/.test(e));
    if (realErrs.length) {
      console.log('  console errors: ' + JSON.stringify(realErrs));
      allOk = false;
    } else {
      console.log('  zero console errors');
    }
    if (pageErrs.length) {
      console.log('  page errors: ' + JSON.stringify(pageErrs));
      allOk = false;
    }

    // Screenshot
    const png = path.join(OUT, v + '.png');
    await page.screenshot({ path: png, fullPage: false });
    const stat = fs.statSync(png);
    console.log('  screenshot: ' + png + '  (' + stat.size + ' bytes)');

    report.push({ v, status: 200, ok: true, screenshot: png });
  } catch (e) {
    console.log('  THREW: ' + (e && e.message ? e.message : String(e)));
    allOk = false;
    report.push({ v, ok: false, why: String(e) });
  } finally {
    await page.close();
  }
}

await browser.close();
console.log('\n=== SUMMARY ===');
for (const r of report) {
  console.log('  ' + r.v.padEnd(12) + (r.ok ? 'OK' : 'FAIL') + '  ' + (r.why || r.status || ''));
}
process.exit(allOk ? 0 : 1);
