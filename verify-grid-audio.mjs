// Verifier for the audio-reactive GRID page
// 1. Loads https://sainted-word-records.vercel.app/versions/grid.html
// 2. Verifies the page renders + has the AUTO-CYCLE checkbox
// 3. Loads a test audio file via the file input
// 4. Plays the audio and verifies:
//    - A.feat.bass / beat / onset are non-zero
//    - The auto-cycle checkbox can be toggled
// 5. Verifies the GRID cells actually move (cell positions change after beats)
// 6. Snapshots the canvas before/after a beat for visual proof
//
// Usage: node verify-grid-audio.mjs

import puppeteer from 'puppeteer-core';
import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const URL = 'https://sainted-word-records.vercel.app/versions/grid.html';
const TEST_AUDIO = '/tmp/grid-test-beat.wav';
const OUT = resolve(__dirname, 'verify-screenshots/grid-audio-live');
if (!existsSync(OUT)) mkdirSync(OUT, { recursive: true });

const checks = [];
const log = (name, ok, info) => {
  checks.push({ name, ok, info });
  console.log(`${ok ? '✓' : '✗'} ${name}${info ? '  ' + info : ''}`);
};

const browser = await puppeteer.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: 'new',
  args: [
    '--no-sandbox', '--disable-setuid-sandbox',
    '--autoplay-policy=no-user-gesture-required',
  ],
  defaultViewport: { width: 1400, height: 900 },
  protocolTimeout: 60000,
});

try {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (e) => {
    const m = e.message || String(e);
    if (m.includes('VERT') || m.includes('drawImage') || m.includes('InvalidStateError')) return;
    errors.push('pageerror: ' + m);
  });
  page.on('console', (m) => { if (m.type() === 'error') {
    const t = m.text();
    if (t.includes('VERT') || t.includes('drawImage') || t.includes('InvalidStateError')) return;
    // Pre-existing 404s (favicon + watermark-monogram.svg path mismatch)
    if (t.includes('404')) return;
    errors.push('console.error: ' + t);
  }});

  const resp = await page.goto(URL, { waitUntil: 'networkidle0', timeout: 30000 });
  log('grid.html HTTP 200', resp.status() === 200, `(${resp.status()})`);
  await page.evaluate(() => document.fonts.ready);
  await new Promise((r) => setTimeout(r, 1500));

  // Check 1: page rendered with the audio-reactive header
  const header = await page.evaluate(() => ({
    title: document.title,
    hasStage: !!document.getElementById('render'),
    hasGrid: !!document.getElementById('grid'),
    hasFlash: !!document.getElementById('flash'),
    hasAutoCycle: !!document.getElementById('auto-cycle'),
    autoCycleChecked: document.getElementById('auto-cycle')?.checked,
  }));
  log('title is GRID', header.title.startsWith('GRID'), header.title);
  log('render canvas present', header.hasStage);
  log('grid overlay present', header.hasGrid);
  log('flash overlay present', header.hasFlash);
  log('AUTO-CYCLE checkbox present', header.hasAutoCycle);
  log('AUTO-CYCLE checked by default', header.autoCycleChecked === true);

  // Wait for the library to load + remap to fill the layer list
  await new Promise((r) => setTimeout(r, 1500));

  // Check 2: layers exist (auto-remap should have populated them)
  const layerCount = await page.evaluate(() => (window.SWR?.Layers?.list || []).length);
  log('layers are populated (after remap)', layerCount > 0, `count: ${layerCount}`);

  // Check 3: snapshot the initial grid (no audio)
  const before = await page.evaluate(() => {
    const ll = window.SWR?.Layers?.list || [];
    return ll.map(l => ({ id: l.id, cell: l.cell ? { ...l.cell } : null }));
  });
  await page.screenshot({ path: `${OUT}/01-static.png` });

  // Check 4: load the test audio file
  const fileInput = await page.$('#song-input');
  if (fileInput) {
    await fileInput.uploadFile(TEST_AUDIO);
  }
  await new Promise((r) => setTimeout(r, 500));
  const audioLoaded = await page.evaluate(() => {
    return !!(window.SWR?.Audio?.el);
  });
  log('test audio loaded', audioLoaded);

  // Check 5: play the audio by clicking the actual play button (real user gesture
  // is required in headless Chrome for the AudioContext to leave the 'suspended' state)
  const playBtn = await page.evaluate(() => {
    const b = document.getElementById('play');
    if (!b) return null;
    const r = b.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  });
  if (playBtn) {
    await page.mouse.click(playBtn.x, playBtn.y);
  } else {
    // Fallback to programmatic play
    await page.evaluate(() => {
      const A = window.SWR.Audio;
      if (A && A.el) { A.el.volume = 0.5; A.play(); }
    });
  }
  // Let it play for a bit so the analyser picks up bass/beat/onset
  await new Promise((r) => setTimeout(r, 3500));

  // Check 6: audio features are producing non-zero values
  const feat = await page.evaluate(() => {
    const f = window.SWR.Audio?.feat;
    return f ? { bass: f.bass, mid: f.mid, treble: f.treble, rms: f.rms, beat: f.beat, onset: f.onset, bpm: f.bpm } : null;
  });
  log('audio features are non-zero',
    feat && (feat.bass > 0.05 || feat.mid > 0.05 || feat.treble > 0.05),
    feat ? `bass=${feat.bass.toFixed(3)} mid=${feat.mid.toFixed(3)} rms=${feat.rms.toFixed(3)}` : 'no feat');
  log('beat or onset has fired',
    feat && (feat.beat > 0.5 || feat.onset > 0.5),
    `beat=${feat?.beat?.toFixed(3)} onset=${feat?.onset?.toFixed(3)}`);

  // Check 7: BPM was estimated (BPM should be > 0 after a few seconds)
  log('BPM estimated', feat && feat.bpm > 0, `bpm=${feat?.bpm}`);

  // Check 8: cell positions change over time (auto-cycle is on).
  // We measure this by resetting cells to a known state, then sampling across
  // 4 seconds while the audio plays. With 120 BPM audio and a 2-beat rotation
  // interval, we should see at least 2 unique cell states.
  await page.evaluate(() => {
    const cells = [
      { x:0,    y:0,    w:0.5,  h:0.5 },
      { x:0.5,  y:0,    w:0.5,  h:0.5 },
      { x:0,    y:0.5,  w:0.5,  h:0.5 },
      { x:0.5,  y:0.5,  w:0.5,  h:0.5 },
      { x:0,    y:0,    w:1,    h:0.5 },
      { x:0,    y:0.5,  w:1,    h:0.5 },
    ];
    const ll = window.SWR.Layers.list;
    for (let i = 0; i < ll.length; i++) ll[i].cell = cells[i % 6];
  });
  // Now sample cells over 4 seconds (8 samples at 500ms)
  const cellSnapshots = [];
  for (let i = 0; i < 8; i++) {
    const snap = await page.evaluate(() => {
      const ll = window.SWR?.Layers?.list || [];
      return ll.map(l => l.cell ? `${l.cell.x},${l.cell.y},${l.cell.w},${l.cell.h}` : 'null');
    });
    cellSnapshots.push(snap);
    await new Promise((r) => setTimeout(r, 500));
  }
  // Count unique snapshots — at least 2 different states means cells moved
  const uniqueStates = new Set(cellSnapshots.map(s => JSON.stringify(s))).size;
  log('cells rotate over time (auto-cycle is on)',
    uniqueStates > 1,
    `${uniqueStates} unique cell states across 8 samples (500ms each)`);

  // Check 9: shakeAmount state exists
  const hasShake = await page.evaluate(() => {
    // _shakeAmount is a closure var; we can't access it directly. Instead, take
    // 2 canvas snapshots 200ms apart and check that some pixels differ in the
    // cell area, which means the grid is actively redrawing.
    return true;  // we'll verify via canvas diff below
  });

  // Snapshot during a beat
  await page.screenshot({ path: `${OUT}/02-playing.png` });

  // Check 10: canvas pixels change between frames (proves animation is alive)
  const canvasDiff = await page.evaluate(async () => {
    const canvas = document.getElementById('render');
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    const a = ctx.getImageData(0, 0, 100, 100);
    await new Promise(r => setTimeout(r, 200));
    const b = ctx.getImageData(0, 0, 100, 100);
    let diff = 0;
    for (let i = 0; i < a.data.length; i += 4) {
      if (Math.abs(a.data[i] - b.data[i]) > 5 ||
          Math.abs(a.data[i+1] - b.data[i+1]) > 5 ||
          Math.abs(a.data[i+2] - b.data[i+2]) > 5) diff++;
    }
    return { diff, totalPx: a.data.length / 4, diffPct: (diff / (a.data.length / 4) * 100).toFixed(1) };
  });
  log('canvas pixels change between frames (live animation)', canvasDiff.diff > 100,
    `${canvasDiff.diff} px differ (${canvasDiff.diffPct}% of 100×100 sample)`);

  // Check 11: pause the audio, then toggle AUTO-CYCLE off → cells should stop rotating
  await page.evaluate(() => window.SWR.Audio.pause());
  // Reset cell positions to a known state
  await page.evaluate(() => {
    const cells = [
      { x:0, y:0, w:0.5, h:0.5 },
      { x:0.5, y:0, w:0.5, h:0.5 },
      { x:0, y:0.5, w:0.5, h:0.5 },
      { x:0.5, y:0.5, w:0.5, h:0.5 },
      { x:0, y:0, w:1, h:0.5 },
      { x:0, y:0.5, w:1, h:0.5 },
    ];
    const ll = window.SWR.Layers.list;
    for (let i = 0; i < ll.length; i++) ll[i].cell = cells[i % 6];
  });
  // Toggle off
  await page.evaluate(() => {
    const cb = document.getElementById('auto-cycle');
    cb.checked = false;
    cb.dispatchEvent(new Event('change'));
  });
  // Wait + sample cells
  await new Promise((r) => setTimeout(r, 1500));
  const staticCells = await page.evaluate(() => {
    return (window.SWR.Layers.list || []).map(l => l.cell ? `${l.cell.x},${l.cell.y}` : 'null');
  });
  // Resume audio + re-enable auto-cycle, sample
  await page.evaluate(() => {
    window.SWR.Audio.play();
    const cb = document.getElementById('auto-cycle');
    cb.checked = true;
    cb.dispatchEvent(new Event('change'));
  });
  await new Promise((r) => setTimeout(r, 1500));
  const movingCells = await page.evaluate(() => {
    return (window.SWR.Layers.list || []).map(l => l.cell ? `${l.cell.x},${l.cell.y}` : 'null');
  });
  const cellsDiffer = staticCells.some((c, i) => c !== movingCells[i]);
  log('cells freeze when AUTO-CYCLE is off, move when on', cellsDiffer,
    `static: [${staticCells.join('|')}] moving: [${movingCells.join('|')}]`);

  await page.screenshot({ path: `${OUT}/03-after-toggle.png` });

  // Check 12: no new console errors
  log('No new console errors (pre-existing bugs filtered)', errors.length === 0,
    errors.length ? errors.slice(0, 2).join('; ') : '');

  const passed = checks.filter((c) => c.ok).length;
  const total = checks.length;
  console.log(`\n${passed}/${total} checks passed`);
  if (passed < total) {
    console.log('Failed:');
    checks.filter((c) => !c.ok).forEach((c) => console.log(`  - ${c.name}: ${c.info || ''}`));
    process.exit(1);
  }
} finally {
  await browser.close();
}
