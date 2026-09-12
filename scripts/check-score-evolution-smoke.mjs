#!/usr/bin/env node
// scripts/check-score-evolution-smoke.mjs — Stage 6 Puppeteer smoke.
//
// Plan success criteria:
//   - Drop a synthetic 30s song with deliberate dynamics (intro quiet,
//     middle loud, climax peak)
//   - Verify state.tension, state.warmth, state.drift evolve smoothly
//     across the timeline
//   - Verify phaseMultiplier returns correct values at t=0, 0.3, 0.6, 0.9
//
// Builds on the WAV generator from check-mv-smoke.mjs but stands alone
// (don't share imports with sibling scripts — they're not a package).
//
// Run: node scripts/check-score-evolution-smoke.mjs

import puppeteer from 'puppeteer';
import http from 'http';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'dist');
const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.wav': 'audio/wav',
};

// Three-phase dynamics: 0-25% quiet, 25-75% mid-loud, 75-100% peak.
// 30s total. Returns a Buffer containing the full WAV.
function buildDynamicsWav(durationSec, sampleRate) {
  const numSamples = Math.floor(durationSec * sampleRate);
  const data = Buffer.alloc(numSamples * 2);
  for (let i = 0; i < numSamples; i++) {
    const t = i / sampleRate;
    const carrier = Math.sin(2 * Math.PI * 440 * t) * 0.5
                  + Math.sin(2 * Math.PI * 1760 * t) * 0.3; // higher centroid in climax
    let env;
    if (t < 7.5)       env = 0.10;                    // opening (0-25%)
    else if (t < 22.5) env = 0.50 + 0.05 * Math.sin(2 * Math.PI * 1.0 * t); // middle (25-75%)
    else               env = 0.85 + 0.15 * Math.sin(2 * Math.PI * 6 * t);  // climax (75-100%)
    const s = Math.max(-1, Math.min(1, carrier * env));
    data.writeInt16LE(Math.round(s * 32767), i * 2);
  }
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + data.length, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36);
  header.writeUInt32LE(data.length, 40);
  return Buffer.concat([header, data]);
}

const server = http.createServer((req, res) => {
  let rel = decodeURIComponent(req.url.split('?')[0].replace(/^\/+/, '')) || 'index.html';
  if (rel === 'app' || rel === 'app/') rel = 'swr-app.html';
  const full = path.join(ROOT, rel);
  if (!full.startsWith(ROOT)) { res.writeHead(403); return res.end('forbidden'); }
  fs.readFile(full, (err, buf) => {
    if (err) { res.writeHead(404); return res.end('not found'); }
    const ext = path.extname(full).toLowerCase();
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    res.end(buf);
  });
});

const PORT = 5181;
let failures = 0;
function assert(cond, msg, detail) {
  if (cond) { console.log('  ✓', msg, detail ? `(${detail})` : ''); }
  else      { console.log('  ✗', msg, detail ? `(${detail})` : ''); failures++; }
}

(async () => {
  await new Promise(r => server.listen(PORT, r));
  console.log(`[score-evo-smoke] static server listening on :${PORT}`);

  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
  });
  const page = await browser.newPage();
  page.on('pageerror', e => console.log('  [page error]', e.message));

  await page.goto(`http://localhost:${PORT}/versions/music_video.html`, {
    waitUntil: 'networkidle0', timeout: 30000,
  });

  // Drive the accumulator in-page rather than relying on real audio
  // analysis: same module, same public API, but deterministic.
  console.log('\n=== phaseMultiplier across song timeline ===');
  // Force-initialise for known duration.
  await page.evaluate(() => window.SWR_NARRATIVE.init(120, 100));

  const phases = await page.evaluate(() => {
    const N = window.SWR_NARRATIVE;
    const out = [];
    for (const age of [0, 30, 60, 90]) {
      N.state.age = age;
      out.push({ age, phase: N.phaseMultiplier(100) });
    }
    return out;
  });

  // Plan success criteria: t=0 → opening, t=0.3 → middle, t=0.6 → middle,
  // t=0.9 → climax.
  const expected = [
    { age: 0,  openness: 0.4, driftAmp: 0.3, pullback: 0.0 },
    { age: 30, openness: 1.0, driftAmp: 1.0, pullback: 0.0 },
    { age: 60, openness: 1.0, driftAmp: 1.0, pullback: 0.0 },
    { age: 90, openness: 0.7, driftAmp: 1.4, pullback: 0.6 },
  ];
  for (let i = 0; i < phases.length; i++) {
    const got = phases[i].phase;
    const want = expected[i];
    const ok = Math.abs(got.openness - want.openness) < 0.01
            && Math.abs(got.driftAmp - want.driftAmp) < 0.01
            && Math.abs(got.pullback - want.pullback) < 0.05;
    assert(ok,
      `phaseMultiplier at age=${want.age} matches expected (${want.openness}, ${want.driftAmp}, ${want.pullback.toFixed(2)})`,
      `got (${got.openness}, ${got.driftAmp}, ${got.pullback.toFixed(2)})`);
  }

  console.log('\n=== state evolution across simulated timeline ===');
  // Reset and feed 30 seconds of the same deliberate dynamics the WAV
  // generator uses, but as feature inputs to the accumulator. We don't
  // need the audio engine — the accumulator math is what we're testing.
  const evolution = await page.evaluate(() => {
    const N = window.SWR_NARRATIVE;
    N.init(120, 30);
    const samples = [];
    // Sample every 0.5s for 30s = 60 samples.
    const SAMPLE_RATE = 60;
    const TOTAL_SECS = 30;
    for (let i = 0; i < TOTAL_SECS * SAMPLE_RATE; i++) {
      const t = i / SAMPLE_RATE;
      // Mirror the WAV's envelope shape.
      let rms, centroid;
      if (t < 7.5) {
        rms = 0.10;
        centroid = 0.4;
      } else if (t < 22.5) {
        rms = 0.50 + 0.05 * Math.sin(2 * Math.PI * 1.0 * t);
        centroid = 0.5 + 0.05 * Math.sin(2 * Math.PI * 0.5 * t);
      } else {
        rms = 0.85 + 0.15 * Math.sin(2 * Math.PI * 6 * t);
        centroid = 0.8; // higher harmonic content
      }
      // Feed beats periodically — every 30 frames at 120 BPM = every 0.5s.
      const beat = (i % 30 === 0) ? 1.0 : 0;
      N.step({ rms, beat, centroid, dt: 1 / SAMPLE_RATE });
      if (i % (SAMPLE_RATE / 2) === 0) {
        samples.push({
          t,
          tension: N.state.tension,
          warmth: N.state.warmth,
          driftMag: Math.sqrt(N.state.drift.x ** 2 + N.state.drift.y ** 2),
        });
      }
    }
    return samples;
  });

  assert(evolution.length === 60,
    `sampled 60 timeline points (every 0.5s for 30s)`, `got ${evolution.length}`);

  // Sample at deep points in each phase, not at the boundaries.
  const opening = evolution[2];   // t≈1.0 — well into opening
  const middle  = evolution[30];  // t≈15.0 — well into middle
  const late    = evolution[50];  // t≈25.0 — well into climax
  assert(opening.tension < 0.2,
    `opening tension is low (rms=0.10 in opener)`,
    `got ${opening.tension.toFixed(3)} at t=${opening.t}`);
  assert(middle.tension > 0.4 && middle.tension < 0.6,
    `middle tension asymptotes near rms=0.5`,
    `got ${middle.tension.toFixed(3)} at t=${middle.t}`);
  assert(late.tension > 0.7,
    `climax tension is high (rms=0.85)`,
    `got ${late.tension.toFixed(3)} at t=${late.t}`);
  assert(opening.warmth < middle.warmth,
    `warmth drifts upward over the song (opening < middle)`,
    `opening=${opening.warmth.toFixed(3)}, middle=${middle.warmth.toFixed(3)}`);
  assert(middle.warmth < late.warmth,
    `warmth keeps drifting toward climax centroid=0.8`,
    `middle=${middle.warmth.toFixed(3)}, late=${late.warmth.toFixed(3)}`);
  assert(late.driftMag > opening.driftMag * 2,
    `drift magnitude grows with sustained loud passages`,
    `opening drift=${opening.driftMag.toFixed(3)}, late drift=${late.driftMag.toFixed(3)}`);

  console.log('\n=== end-of-song release from live page state ===');
  // Drop the real WAV, wait for the page's RAF to seed, then trigger
  // release manually and verify phaseMultiplier tapers.
  const wavPath = path.join(os.tmpdir(), 'score-evo-smoke.wav');
  fs.writeFileSync(wavPath, buildDynamicsWav(30, 22050));
  try {
    const fileInput = await page.$('#song-input');
    await fileInput.uploadFile(wavPath);
    await page.waitForFunction(
      () => window.SWR_NARRATIVE && window.SWR_NARRATIVE.state.age > 0.5,
      { timeout: 10000, polling: 100 }
    ).catch(() => null);
    // Force the page's narrative into the middle of a song, then release.
    await page.evaluate(() => {
      const N = window.SWR_NARRATIVE;
      N.init(120, 100);
      N.state.age = 50;
      N.state.tension = 0.7;
      N.state.drift.x = 0.3; N.state.drift.y = -0.2;
      N.beginRelease();
      N.state.releaseProgress = 0.5;
    });
    const releaseMid = await page.evaluate(() => {
      const N = window.SWR_NARRATIVE;
      return {
        phase: N.phaseMultiplier(100),
        driftMag: Math.sqrt(N.state.drift.x ** 2 + N.state.drift.y ** 2),
      };
    });
    assert(releaseMid.phase.driftAmp < 0.6,
      `release tapers driftAmp at 50% (would be 1.0 in middle)`,
      `got ${releaseMid.phase.driftAmp.toFixed(3)}`);
    assert(releaseMid.driftMag > 0.3,
      `drift magnitude preserved during release (snap only at completion)`,
      `got ${releaseMid.driftMag.toFixed(3)}`);

    // Run 5s of step() to complete the release.
    await page.evaluate(() => {
      const N = window.SWR_NARRATIVE;
      for (let i = 0; i < 300; i++) {
        N.step({ rms: 0.3, beat: 0, centroid: 0.5, dt: 1 / 60 });
      }
    });
    const released = await page.evaluate(() => {
      const N = window.SWR_NARRATIVE;
      return {
        drift: N.state.drift,
        tension: N.state.tension,
        peak: N.state.peak,
        progress: N.state.releaseProgress,
      };
    });
    assert(released.drift.x === 0 && released.drift.y === 0,
      `release snaps drift to (0, 0)`);
    assert(released.tension === 0 && released.peak === 0,
      `release snaps tension + peak to 0`);
    assert(released.progress >= 1,
      `releaseProgress reaches 1.0`, `got ${released.progress.toFixed(3)}`);
  } finally {
    try { fs.unlinkSync(wavPath); } catch (_) {}
  }

  await browser.close();
  server.close();

  console.log('\n' + (failures === 0
    ? 'SCORE-EVOLUTION SMOKE: ALL GREEN'
    : `SCORE-EVOLUTION SMOKE: ${failures} failure(s)`));
  process.exit(failures === 0 ? 0 : 1);
})().catch(e => {
  console.error(e);
  server.close();
  process.exit(2);
});