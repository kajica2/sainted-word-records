#!/usr/bin/env node
// scripts/check-mv-smoke.mjs — Phase A smoke for the music_video gradient page.
//
// Boots a static server on dist/, opens versions/music_video.html in
// Puppeteer, and verifies:
//   - the page loads with the MUSIC VIDEO header + no outbound nav links
//   - window.SWR_ANCHOR_MAP is exposed with 19 anchor presets
//   - the gradient canvas has cyan dot pixels (the anchor dots rendered)
//   - the synth-pill says "— no track"
//   - the depth + N sliders exist with default 0.5 and 4
//   - neighbours() returns 4 ids at the middle of the gradient

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
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.gif': 'image/gif', '.wav': 'audio/wav', '.mp3': 'audio/mpeg',
  '.mp4': 'video/mp4', '.webm': 'video/webm',
};

// Build a 30-second 16-bit mono WAV with deliberate dynamics:
//   t in [0,  5): quiet (rms ~0.1)  — intro
//   t in [5, 25): mid-loud (rms ~0.5) — middle
//   t in [25,30): peak bursts (rms ~0.9) — climax
// The narrative accumulator should react: tension ramps in the middle,
// warmth drifts toward the higher-frequency content during climax,
// peak fires on the burst edges.
function buildDynamicsWav(durationSec, sampleRate) {
  const numSamples = Math.floor(durationSec * sampleRate);
  const data = Buffer.alloc(numSamples * 2);
  for (let i = 0; i < numSamples; i++) {
    const t = i / sampleRate;
    // Two-tone carrier: 440 Hz fundamental + 880 Hz harmonic.
    const carrier = Math.sin(2 * Math.PI * 440 * t) * 0.5
                  + Math.sin(2 * Math.PI * 880 * t) * 0.3;
    let env;
    if (t < 5)        env = 0.10;
    else if (t < 25)  env = 0.45 + 0.10 * Math.sin(2 * Math.PI * 1.2 * t);
    else              env = 0.85 + 0.15 * Math.sin(2 * Math.PI * 6 * t);
    const s = Math.max(-1, Math.min(1, carrier * env));
    data.writeInt16LE(Math.round(s * 32767), i * 2);
  }
  // WAV header (PCM, mono, 16-bit, sampleRate).
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + data.length, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);          // fmt chunk size
  header.writeUInt16LE(1, 20);           // PCM
  header.writeUInt16LE(1, 22);           // channels
  header.writeUInt32LE(sampleRate, 24);  // sample rate
  header.writeUInt32LE(sampleRate * 2, 28); // byte rate
  header.writeUInt16LE(2, 32);           // block align
  header.writeUInt16LE(16, 34);          // bits per sample
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

const PORT = 5180;
let failures = 0;
function assert(cond, msg) {
  if (cond) { console.log('  ✓', msg); }
  else      { console.log('  ✗', msg); failures++; }
}

(async () => {
  await new Promise(r => server.listen(PORT, r));
  console.log(`[mv-smoke] static server listening on :${PORT}`);

  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
  });
  const page = await browser.newPage();
  page.on('pageerror', e => console.log('  [page error]', e.message));
  page.on('console', m => { if (m.type() === 'error') console.log('  [console.error]', m.text()); });

  await page.goto(`http://localhost:${PORT}/versions/music_video.html`, { waitUntil: 'networkidle0', timeout: 30000 });

  console.log('\n=== page boot ===');
  const boot = await page.evaluate(() => {
    const map = window.SWR_ANCHOR_MAP;
    return {
      title: document.title,
      headerV: document.querySelector('.v')?.textContent?.trim() || '',
      synthPill: document.getElementById('synth-pill')?.textContent?.trim() || '',
      gradientCanvas: !!document.getElementById('gradient'),
      depthSlider: document.getElementById('depth')?.value,
      nSlider: document.getElementById('neighbour-count')?.value,
      depthLabel: document.getElementById('depth-v')?.textContent,
      nLabel: document.getElementById('neighbour-count-v')?.textContent,
      anchorCount: map ? map.list().length : 0,
      anchorSample: map ? map.list().slice(0, 5) : null,
      neighboursAtMiddle: map ? map.neighbours({warmth: 0.5, intensity: 0.5}, 4).map(n => n.id) : null,
      swrKeys: Object.keys(window.SWR || {}),
      hasGradient: !!window.SWR_GRADIENT,
      hologramState: window.SWR?.HologramState || null,
      outboundLinks: Array.from(document.querySelectorAll('a'))
        .map(a => a.getAttribute('href'))
        .filter(h => h && (h.endsWith('.html') || h.startsWith('/versions/') || h.startsWith('../'))),
    };
  });

  assert(boot.title === 'MUSIC VIDEO · SWR engine v1', `title is "MUSIC VIDEO" (got: "${boot.title}")`);
  assert(boot.headerV.startsWith('MUSIC VIDEO'), `header version pill says MUSIC VIDEO (got: "${boot.headerV}")`);
  assert(boot.synthPill.includes('no track'), `synth pill says "no track" before a track loads (got: "${boot.synthPill}")`);
  assert(boot.gradientCanvas, 'gradient canvas exists in the DOM');
  assert(boot.depthSlider === '0.5', `depth slider default is 0.5 (got: ${boot.depthSlider})`);
  assert(boot.nSlider === '4', `N slider default is 4 (got: ${boot.nSlider})`);
  assert(boot.depthLabel === '0.50', `depth label reads 0.50 (got: ${boot.depthLabel})`);
  assert(boot.nLabel === '4', `N label reads 4 (got: ${boot.nLabel})`);
  assert(boot.anchorCount === 19, `SWR_ANCHOR_MAP exposes 19 anchor presets (got: ${boot.anchorCount})`);
  assert(boot.anchorSample && boot.anchorSample.includes('neon'), 'neon is one of the anchor presets');
  assert(boot.neighboursAtMiddle && boot.neighboursAtMiddle.length === 4, 'neighbours() returns 4 ids at middle');
  assert(boot.hasGradient, 'window.SWR_GRADIENT is exposed');
  assert(boot.hologramState && boot.hologramState.depth === 0.5 && boot.hologramState.neighbours === 4,
    `window.SWR.HologramState is { depth: 0.5, neighbours: 4 } (got: ${JSON.stringify(boot.hologramState)})`);
  assert(boot.outboundLinks.length === 0,
    `no outbound cross-page nav links (got: ${JSON.stringify(boot.outboundLinks)})`);

  console.log('\n=== gradient canvas pixels ===');
  const pixels = await page.evaluate(() => {
    const cv = document.getElementById('gradient');
    const ctx = cv.getContext('2d');
    const data = ctx.getImageData(0, 0, cv.width, cv.height).data;
    let cyanPixels = 0, labelPixels = 0, totalNonBlack = 0;
    for (let i = 0; i < data.length; i += 4) {
      const r = data[i], g = data[i+1], b = data[i+2], a = data[i+3];
      if (r || g || b) totalNonBlack++;
      // cyan dot: G+B > 80, R < 100, alpha high
      if (g > 80 && b > 80 && r < 100) cyanPixels++;
      // label: alpha-blended over the dark bg (rgb 10,6,18) at 55%
      // alpha produces rgb ≈ (138, 130, 147) — distinguish from the
      // anchor dots (cyan) by requiring R > G (label leans pink/white,
      // cyan dots have G > R by a wide margin).
      if (r > 100 && r > g + 5 && b > 100) labelPixels++;
    }
    return { cyanPixels, labelPixels, totalNonBlack, canvasW: cv.width, canvasH: cv.height };
  });
  assert(pixels.cyanPixels > 50, `gradient has >50 cyan pixels (anchor dots — got: ${pixels.cyanPixels})`);
  assert(pixels.labelPixels > 100, `gradient has >100 light label pixels (got: ${pixels.labelPixels})`);

  console.log('\n=== depth slider movement ===');
  // Set depth to 1 via the slider, verify the label updates
  await page.evaluate(() => {
    const s = document.getElementById('depth');
    s.value = '1';
    s.dispatchEvent(new Event('input', { bubbles: true }));
  });
  const afterDepth = await page.evaluate(() => ({
    label: document.getElementById('depth-v').textContent,
    state: window.SWR.HologramState.depth,
  }));
  assert(afterDepth.label === '1.00', `depth label updates to 1.00 after slider input (got: ${afterDepth.label})`);
  assert(afterDepth.state === 1, `HologramState.depth reflects 1.0 (got: ${afterDepth.state})`);

  // ---- Stage 2: narrative accumulator integration ----
  // Drop a synthetic 30s WAV, scrub to t=20s (deep into middle section),
  // assert narrative.state evolved from accumulator behavior.
  console.log('\n=== narrative accumulator (Stage 2) ===');
  const wavPath = path.join(os.tmpdir(), 'narrative-smoke.wav');
  fs.writeFileSync(wavPath, buildDynamicsWav(30, 22050));
  try {
    const fileInput = await page.$('#song-input');
    await fileInput.uploadFile(wavPath);
    // Wait for A.el to mount + SWR_NARRATIVE to seed. The page's RAF tick
    // is the only consumer; we drive it by waiting real time and reading
    // back window.SWR_NARRATIVE.state.
    const seeded = await page.waitForFunction(
      () => window.SWR_NARRATIVE && window.SWR_NARRATIVE.state.age > 1,
      { timeout: 10000, polling: 100 }
    ).catch(() => null);
    assert(seeded !== null, 'SWR_NARRATIVE starts ticking within 10s of song drop');

    // Force the audio element to currentTime=20 so the analyser reports
    // mid-section content without us waiting 20 wall-clock seconds.
    await page.evaluate(() => {
      // The audio engine keeps a private A.el; we can't reach it without
      // a hook. So instead we drive the accumulator directly with a known
      // input sequence for the assertions below — keeps the test fast and
      // deterministic. The integration (A.feat → narrative.step) was
      // already verified via the seed tick above.
      window.SWR_NARRATIVE.reset();
      window.SWR_NARRATIVE.init(120, 30);
    });
    // Feed 20 seconds of "mid-loud" simulated features, with a beat spike
    // every 30 frames (~2s at 60fps). Stop the beat stream before
    // checking peak decay — otherwise peak stays high (just-refed beats
    // reset it back to 1.0).
    await page.evaluate(() => {
      const N = window.SWR_NARRATIVE;
      for (let i = 0; i < 1200; i++) {
        N.step({ rms: 0.5, beat: i % 30 === 0 ? 1.0 : 0, centroid: 0.6, dt: 1/60 });
      }
      // Drain: 200 frames with no beat. Peak should decay to ~0.002.
      for (let i = 0; i < 200; i++) {
        N.step({ rms: 0.5, beat: 0, centroid: 0.6, dt: 1/60 });
      }
    });
    const mid = await page.evaluate(() => {
      const n = window.SWR_NARRATIVE.state;
      return {
        age: n.age,
        tension: n.tension,
        peak: n.peak,
        driftX: n.drift.x,
        driftY: n.drift.y,
        warmth: n.warmth,
      };
    });
    assert(mid.age > 22 && mid.age < 24.5,
      `narrative.age ≈ 23.3s after 1400 frames (got ${mid.age.toFixed(2)})`);
    assert(Math.abs(mid.tension - 0.5) < 0.05,
      `narrative.tension asymptotes to 0.5 with constant rms (got ${mid.tension.toFixed(3)})`);
    assert(mid.peak < 0.1,
      `narrative.peak decays below 0.1 between beats (got ${mid.peak.toFixed(3)})`);
    assert(Math.abs(mid.driftX) > 0 || Math.abs(mid.driftY) > 0,
      `narrative.drift walks away from origin over 20s (got drift=(${mid.driftX.toFixed(3)},${mid.driftY.toFixed(3)}))`);
    assert(mid.warmth > 0.55 && mid.warmth < 0.65,
      `narrative.warmth follows centroid=0.6 input (got ${mid.warmth.toFixed(3)})`);

    // Test reset() zeroing via the public API.
    await page.evaluate(() => window.SWR_NARRATIVE.reset());
    const afterReset = await page.evaluate(() => {
      const n = window.SWR_NARRATIVE.state;
      return { tension: n.tension, peak: n.peak, driftX: n.drift.x, warmth: n.warmth, age: n.age };
    });
    assert(afterReset.tension === 0 && afterReset.peak === 0
        && afterReset.driftX === 0 && afterReset.warmth === 0.5
        && afterReset.age === 0,
      `reset() zeros state via Puppeteer-driven page.evaluate (got ${JSON.stringify(afterReset)})`);
  } finally {
    try { fs.unlinkSync(wavPath); } catch (_) {}
  }

  await browser.close();
  server.close();

  console.log('\n' + (failures === 0
    ? 'MV SMOKE: ALL GREEN'
    : `MV SMOKE: ${failures} failure(s)`));
  process.exit(failures === 0 ? 0 : 1);
})().catch(e => {
  console.error(e);
  server.close();
  process.exit(2);
});
