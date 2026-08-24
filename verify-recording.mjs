// Verify the engine's recording feature works without loading a song.
import puppeteer from 'puppeteer-core';
import { existsSync, statSync, readdirSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const URL = 'https://sainted-word-records.vercel.app/engine';
const DL_DIR = '/tmp/swr-rec-dl';
mkdirSync(DL_DIR, { recursive: true });

const browser = await puppeteer.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: 'new',
  args: ['--no-sandbox', '--disable-setuid-sandbox', '--use-angle=swiftshader', '--use-gl=angle', '--enable-webgl', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required'],
});

const results = [];
const pass = (m) => results.push({ ok: true, m });
const fail = (m) => results.push({ ok: false, m });

try {
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  const client = await page.target().createCDPSession();
  await client.send('Page.setDownloadBehavior', { behavior: 'allow', downloadPath: DL_DIR });

  const errs = [];
  page.on('pageerror', (e) => errs.push('PAGE: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errs.push('CONSOLE: ' + m.text()); });

  await page.goto(URL, { waitUntil: 'networkidle2', timeout: 30000 });
  await new Promise(r => setTimeout(r, 3000));

  // 1) Buttons are enabled at page load (no song loaded)
  const recEnabled = await page.$eval('#rec', el => !el.disabled);
  const exportEnabled = await page.$eval('#export-video', el => !el.disabled);
  if (recEnabled) pass('REC button enabled at page load');
  else fail('REC button still disabled at page load');
  if (exportEnabled) pass('Export video button enabled at page load');
  else fail('Export video button still disabled at page load');

  // Capture the initial button text
  const initialRecText = await page.$eval('#rec', el => el.textContent.trim());
  if (initialRecText.includes('REC')) pass(`initial REC button text: "${initialRecText}"`);
  else fail(`unexpected initial REC text: "${initialRecText}"`);

  // 2) Click REC and verify it changes to STOP (recording started)
  await page.click('#rec');
  await new Promise(r => setTimeout(r, 800));
  const recTextDuring = await page.$eval('#rec', el => el.textContent.trim());
  const recHasLiveClass = await page.$eval('#rec', el => el.classList.contains('live'));
  if (recHasLiveClass && recTextDuring.includes('STOP')) {
    pass(`recording active · button text="${recTextDuring}" · has 'live' class`);
  } else {
    fail(`recording did not start · text="${recTextDuring}" · live=${recHasLiveClass}`);
  }

  // 3) Wait 4s — let it capture some frames
  await new Promise(r => setTimeout(r, 4000));
  const statusDuring = await page.$eval('#status-pill', el => el ? el.textContent.trim() : '');
  pass(`status during recording: "${statusDuring.slice(0, 100)}"`);

  // 4) Click REC again to stop
  const beforeFiles = new Set(readdirSync(DL_DIR));
  await page.click('#rec');

  // 5) Wait for the download to land
  let downloaded = null;
  for (let i = 0; i < 40; i++) {
    await new Promise(r => setTimeout(r, 500));
    const afterFiles = readdirSync(DL_DIR);
    const newFiles = afterFiles.filter(f => !beforeFiles.has(f) && !f.endsWith('.crdownload'));
    const inProgress = afterFiles.filter(f => f.endsWith('.crdownload'));
    if (newFiles.length > 0) {
      downloaded = join(DL_DIR, newFiles[0]);
      if (statSync(downloaded).size > 0) break;
    }
    if (inProgress.length === 0 && i > 5) break; // gave up waiting
  }

  if (downloaded && existsSync(downloaded)) {
    const size = statSync(downloaded).size;
    const mb = (size / 1024 / 1024).toFixed(2);
    if (size > 50000) pass(`downloaded: ${downloaded.split('/').pop()} (${mb} MB, ${size} bytes)`);
    else fail(`download too small: ${size} bytes`);
  } else {
    fail('no download appeared after stopping recording');
  }

  // 6) Verify the file is a valid WebM (magic bytes: 1A 45 DF A3)
  if (downloaded && existsSync(downloaded)) {
    const { readFileSync } = await import('node:fs');
    const head = readFileSync(downloaded).subarray(0, 4);
    const isWebm = head[0] === 0x1A && head[1] === 0x45 && head[2] === 0xDF && head[3] === 0xA3;
    if (isWebm) pass('downloaded file has valid WebM magic bytes (EBML)');
    else fail(`not a WebM — magic bytes: ${[...head].map(b => b.toString(16).padStart(2, '0')).join(' ')}`);
  }

  // 7) Recorder is back to idle
  await new Promise(r => setTimeout(r, 500));
  const recTextAfter = await page.$eval('#rec', el => el.textContent.trim());
  const recHasLiveAfter = await page.$eval('#rec', el => el.classList.contains('live'));
  if (!recHasLiveAfter && recTextAfter.includes('REC')) {
    pass(`recorder idle · text="${recTextAfter}" · no 'live' class`);
  } else {
    fail(`recorder not idle · text="${recTextAfter}" · live=${recHasLiveAfter}`);
  }

  // 8) No console/page errors
  if (errs.length === 0) pass('no console/page errors during full recording cycle');
  else fail(`errors: ${errs.slice(0, 3).join(' | ')}`);

  // 9) Last-video link is now visible (the recorder exposed the download)
  const lastVideoVisible = await page.$eval('#last-video', el => !el.hidden);
  pass(`last-video link visible: ${lastVideoVisible}`);

  await page.screenshot({ path: '/tmp/swr-engine-recording.png', fullPage: false });

} catch (e) {
  fail(`exception: ${e.message}`);
} finally {
  await browser.close();
}

console.log('\n=== Recording Verify ===');
results.forEach(r => console.log(`${r.ok ? '✓' : '✗'} ${r.m}`));
const allOk = results.every(r => r.ok);
console.log(`\nResult: ${allOk ? 'GREEN ✓' : 'RED ✗'}`);
process.exit(allOk ? 0 : 1);
