// Puppeteer verify for tutorial-30s.html
// Plays through the 30s composition, records via MediaRecorder, verifies output
import puppeteer from 'puppeteer';
import { existsSync, statSync, mkdirSync, readdirSync, unlinkSync } from 'node:fs';
import { execSync } from 'node:child_process';

const URL = 'http://localhost:5174/tutorial-30s.html';
const OUT_DIR = 'verify-screenshots/tutorial-30s';
const DOWNLOADS = `${process.env.HOME}/Downloads`;

if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true });

const errors = [];
const browser = await puppeteer.launch({
  headless: 'new',
  args: [
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--autoplay-policy=no-user-gesture-required',
    '--use-fake-ui-for-media-stream',
  ],
});

try {
  const page = await browser.newPage();
  await page.setViewport({ width: 600, height: 800, deviceScaleFactor: 1 });

  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push('console.error: ' + m.text()); });

  console.log('▶', URL);
  await page.goto(URL, { waitUntil: 'networkidle0' });
  await page.evaluate(() => document.fonts.ready);
  await new Promise((r) => setTimeout(r, 500));

  // 1. Title + canvas
  const title = await page.title();
  console.log('title:', title);
  if (!/tutorial/i.test(title)) errors.push(`title unexpected: ${title}`);

  const canvas = await page.$('canvas');
  if (!canvas) { errors.push('no canvas'); }
  else {
    const dims = await canvas.evaluate((c) => ({ w: c.width, h: c.height }));
    console.log('canvas:', dims);
    if (dims.w !== 720 || dims.h !== 1280) errors.push(`canvas size wrong: ${dims.w}×${dims.h}, expected 720×1280`);
    else console.log('  ✓ canvas 720×1280 (9:16)');
  }

  // 2. 4 scenes present
  const scenes = await page.evaluate(() => window.__tutorial?.scenes?.length);
  console.log('scenes:', scenes);
  if (scenes !== 4) errors.push(`expected 4 scenes, got ${scenes}`);

  // 3. Take a snapshot of each scene (advance the timeline)
  for (let i = 0; i < 4; i++) {
    const t = i * 7.5 + 3; // mid-scene
    await page.evaluate((tt) => {
      window.__tutorial.stop();
      // Manually drive the timeline by re-rendering at time t
      const start = performance.now();
      window.__startTime = start - tt * 1000;
    }, t);
    // Call renderFrame with the desired time
    await page.evaluate((tt) => {
      // Stop the current RAF, then re-render
      const fn = window.__tutorial.renderFrame;
      fn(tt);
    }, t);
    await new Promise((r) => setTimeout(r, 200));
    const fname = `${OUT_DIR}/scene-${i + 1}.png`;
    await page.screenshot({ path: fname, fullPage: false });
    console.log(`  ✓ ${fname}`);
  }

  // 4. Record the 30s via MediaRecorder
  // The page exposes window.__tutorial.record() which starts the recorder.
  // We need to wait for it to finish (it auto-stops at 30.5s).
  console.log('\n▶ Starting 30s record...');
  const downloadPath = `${OUT_DIR}/recordings`;
  if (!existsSync(downloadPath)) mkdirSync(downloadPath, { recursive: true });
  // Configure download path
  const client = await page.target().createCDPSession();
  await client.send('Page.setDownloadBehavior', { behavior: 'allow', downloadPath });

  // Start record
  const recordStart = Date.now();
  await page.click('#record');
  // Wait for the auto-stop at ~30.5s, plus a small buffer
  console.log('  waiting 32s for recording to complete...');
  await new Promise((r) => setTimeout(r, 32_000));
  const recordElapsed = ((Date.now() - recordStart) / 1000).toFixed(1);
  console.log(`  record elapsed: ${recordElapsed}s`);

  // 5. Verify the recorded file
  // The download might go to the downloadPath, or might trigger a default download.
  // Let's check both locations.
  const homeDownloads = execSync(`ls -t ${DOWNLOADS}/*.mp4 ${DOWNLOADS}/*.webm 2>/dev/null | head -5`).toString().trim().split('\n');
  const recordingFiles = execSync(`ls -t ${downloadPath}/* 2>/dev/null | head -5`).toString().trim().split('\n').filter(Boolean);
  console.log('files in Downloads:', homeDownloads);
  console.log('files in recording dir:', recordingFiles);

  let recordedFile = null;
  for (const f of [...homeDownloads, ...recordingFiles]) {
    if (!f) continue;
    if (f.includes('swr-tutorial-30s')) { recordedFile = f; break; }
  }

  if (!recordedFile) {
    errors.push('no recorded file found in Downloads or recording dir');
  } else {
    const size = statSync(recordedFile).size;
    console.log('  ✓ recorded file:', recordedFile, `(${(size / 1024 / 1024).toFixed(1)} MB)`);
    if (size < 100_000) errors.push(`recorded file too small: ${size} bytes`);

    // 6. Verify with ffprobe
    try {
      const probe = execSync(`ffprobe -v error -show_entries format=duration,size,bit_rate,format_name -show_entries stream=codec_name,codec_type,width,height,r_frame_rate -of default=noprint_wrappers=1 "${recordedFile}"`).toString();
      console.log('  ffprobe:');
      probe.split('\n').filter(Boolean).forEach((l) => console.log('    ' + l));
      // Check duration ~30s
      const durMatch = probe.match(/duration=([\d.]+)/);
      if (durMatch) {
        const dur = parseFloat(durMatch[1]);
        if (dur < 28 || dur > 32) errors.push(`duration out of range: ${dur}s (expected ~30s)`);
        else console.log(`  ✓ duration: ${dur.toFixed(1)}s`);
      }
      // Check resolution
      const wMatch = probe.match(/width=(\d+)/);
      const hMatch = probe.match(/height=(\d+)/);
      if (wMatch && hMatch) {
        const w = parseInt(wMatch[1]);
        const h = parseInt(hMatch[1]);
        console.log(`  ✓ resolution: ${w}×${h}`);
        if (w !== 720 || h !== 1280) errors.push(`unexpected resolution: ${w}×${h}`);
      }
      // Check has video stream
      if (!/codec_type=video/.test(probe)) errors.push('no video stream in recorded file');
      else console.log('  ✓ has video stream');
    } catch (e) {
      warnings.push('ffprobe not available: ' + e.message);
    }
  }

  // 7. Final tally
  console.log('\n=== RESULTS ===');
  console.log('errors:', errors.length);
  if (errors.length) {
    errors.forEach((e) => console.log('  ✗', e));
  }
  process.exitCode = errors.length ? 1 : 0;
} finally {
  await browser.close();
}
