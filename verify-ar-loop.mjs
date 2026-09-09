// verify-ar-loop.mjs — Puppeteer smoke test for engine-ar-loop.html.
//
// Boots a static server against dist/ via npm run preview, opens the
// AR Loop page in headless Chrome, grants fake camera + microphone
// permissions via CDP, uploads a 1×1 transparent PNG, asserts the
// state pill transitions to 'ready', then asserts the Reset button works.
//
// Exit code 0 = pass, 1 = fail.

import { exec } from 'node:child_process';
import { setTimeout as wait } from 'node:timers/promises';
import { writeFile } from 'node:fs/promises';
import puppeteer from 'puppeteer';

function step(msg) { console.log('• ' + msg); }
function fail(msg) { console.error('✗ ' + msg); process.exit(1); }

const port = 4174;
const baseUrl = 'http://127.0.0.1:' + port;

step('Starting preview server on :' + port);
const server = exec('npm run preview -- --port ' + port + ' --strictPort', {
  cwd: process.cwd(),
});
let serverReady = false;
server.stdout.on('data', d => { if (String(d).includes('Local:')) serverReady = true; });
server.stderr.on('data', d => { if (String(d).includes('Local:')) serverReady = true; });

for (let i = 0; i < 30 && !serverReady; i++) await wait(1000);
if (!serverReady) { server.kill(); fail('Preview server did not become ready in 30s'); }
step('Preview server up.');

const browser = await puppeteer.launch({
  headless: 'new',
  args: [
    '--use-fake-ui-for-media-stream',
    '--use-fake-device-for-media-stream',
    '--no-sandbox',
  ],
});
const page = await browser.newPage();

const context = browser.defaultBrowserContext();
await context.overridePermissions(baseUrl, ['camera', 'microphone']);

const consoleErrors = [];
page.on('console', msg => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });
page.on('pageerror', err => consoleErrors.push(String(err)));

step('Loading /engine-ar-loop.html');
await page.goto(baseUrl + '/engine-ar-loop.html', { waitUntil: 'domcontentloaded' });

step('Waiting for SWR_AR_LOOP to register');
await page.waitForFunction(() => !!window.SWR_AR_LOOP, { timeout: 10_000 });
step('SWR_AR_LOOP registered.');

step('Asserting initial phase = idle');
const initialPhase = await page.evaluate(() => window.SWR_AR_LOOP.state.phase);
if (initialPhase !== 'idle') { await browser.close(); server.kill(); fail('initial phase was ' + initialPhase); }

step('Uploading a 1×1 PNG via input change');
// Smallest valid PNG (transparent 1×1)
const PNG_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';
const buf = Buffer.from(PNG_BASE64, 'base64');
const tmpPath = '/tmp/ar-loop-test.png';
await writeFile(tmpPath, buf);

const fileInput = await page.$('#fileInput');
await fileInput.uploadFile(tmpPath);

// Wait up to 5s for the state to become 'ready'.
let phaseAfterUpload = 'idle';
for (let i = 0; i < 50; i++) {
  phaseAfterUpload = await page.evaluate(() => window.SWR_AR_LOOP.state.phase);
  if (phaseAfterUpload === 'ready') break;
  await wait(100);
}
if (phaseAfterUpload !== 'ready') {
  await browser.close(); server.kill();
  fail('phase after upload was ' + phaseAfterUpload);
}
step('Phase transitioned to ready.');

step('Clicking Reset');
await page.click('#resetBtn');
await page.waitForFunction(() => window.SWR_AR_LOOP.state.phase === 'idle', { timeout: 5000 });
const phaseAfterReset = await page.evaluate(() => window.SWR_AR_LOOP.state.phase);
if (phaseAfterReset !== 'idle') {
  await browser.close(); server.kill();
  fail('phase after reset was ' + phaseAfterReset);
}
step('Reset returned to idle.');

if (consoleErrors.length) {
  const filtered = consoleErrors.filter(e =>
    // Ignore A-Frame warnings about AR.js markerless not detecting (expected in headless).
    !/AR.js|MARKER|aframe/i.test(e)
  );
  if (filtered.length) {
    await browser.close(); server.kill();
    fail('Console errors detected:\n' + filtered.join('\n'));
  }
  step('Only AR.js/aframe warnings present (expected in headless).');
} else {
  step('No console errors.');
}

await browser.close();
server.kill();
console.log('---');
console.log('verify-ar-loop PASSED');
