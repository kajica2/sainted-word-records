#!/usr/bin/env node
// scripts/check-narrative-unit.mjs — score-evolution Stage 1 unit tests.
//
// Validates client/narrative-state.client.js in isolation, using vm to
// load the browser-targeted IIFE in a Node context. Each test
// corresponds to one bullet from the plan's Stage 1 success criteria.
//
// Run: node scripts/check-narrative-unit.mjs

import vm from 'node:vm';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..');
const SRC = fs.readFileSync(path.join(ROOT, 'client/narrative-state.client.js'), 'utf8');

let failures = 0;
function assert(cond, msg, detail) {
  if (cond) {
    console.log('  ✓', msg, detail ? `(${detail})` : '');
  } else {
    console.log('  ✗', msg, detail ? `(${detail})` : '');
    failures += 1;
  }
}

// Load module into a fresh window-like sandbox.
function loadModule() {
  const sandbox = { window: {} };
  vm.createContext(sandbox);
  vm.runInContext(SRC, sandbox);
  return sandbox.window.SWR_NARRATIVE;
}

function approx(a, b, eps) {
  return Math.abs(a - b) <= (eps || 1e-6);
}

console.log('=== score-evolution Stage 1 — narrative-state unit tests ===\n');

// 1. tension asymptotes to a fixed value when fed constant RMS.
{
  const N = loadModule();
  N.init(120, 180);
  for (let i = 0; i < 4000; i++) N.step({ rms: 0.5, dt: 1 / 60 });
  assert(approx(N.state.tension, 0.5, 1e-3),
    `tension asymptotes to 0.5 with constant rms`, `got ${N.state.tension.toFixed(6)}`);
}

// 2. peak decays smoothly.
{
  const N = loadModule();
  N.init(120, 180);
  N.step({ rms: 0.4, beat: 1.0, dt: 1 / 60 }); // spike
  const peakAfter = N.state.peak;
  // Sample decay over 200 frames.
  let prev = peakAfter;
  let monotonic = true;
  for (let i = 0; i < 200; i++) {
    N.step({ rms: 0.4, beat: 0, dt: 1 / 60 });
    if (N.state.peak > prev + 1e-9) monotonic = false;
    prev = N.state.peak;
  }
  assert(peakAfter > 0.9, `peak spikes to ~1.0 from beat=1.0`, `got ${peakAfter.toFixed(4)}`);
  assert(N.state.peak < 0.05,
    `peak decays below 0.05 within 200 frames`, `got ${N.state.peak.toFixed(4)}`);
  assert(monotonic, `peak decay is monotonically non-increasing with beat=0`);
}

// 3. drift walker stays bounded in [-1, +1] over 1000 steps.
{
  const N = loadModule();
  N.init(180, 240); // high BPM for more motion
  let maxAbs = 0;
  for (let i = 0; i < 1000; i++) {
    N.step({ rms: 0.5, dt: 1 / 60 });
    maxAbs = Math.max(maxAbs, Math.abs(N.state.drift.x), Math.abs(N.state.drift.y));
  }
  assert(maxAbs <= 1.0,
    `drift stays bounded in [-1, +1] over 1000 steps`, `max abs = ${maxAbs.toFixed(4)}`);
  // Also: with quiet input, drift should pull back toward 0.
  for (let i = 0; i < 5000; i++) N.step({ rms: 0, dt: 1 / 60 });
  assert(Math.abs(N.state.drift.x) < 0.5 && Math.abs(N.state.drift.y) < 0.5,
    `drift mean-reverts toward 0 in quiet passages`,
    `drift=(${N.state.drift.x.toFixed(3)},${N.state.drift.y.toFixed(3)})`);
}

// 4. drift_step scales with bpm.
{
  // Same RNG seed path: init(120) vs init(180) and step the same way.
  // Compare RMS-accumulated x after N frames; higher bpm → larger |x|
  // on average. We use enough frames for the mean to dominate noise.
  function avgAbsDrift(bpm) {
    const N = loadModule();
    N.init(bpm, 180);
    let total = 0;
    for (let i = 0; i < 4000; i++) {
      N.step({ rms: 0.5, dt: 1 / 60 });
      total += Math.abs(N.state.drift.x) + Math.abs(N.state.drift.y);
    }
    return total / 4000;
  }
  const low = avgAbsDrift(60);   // half-tempo
  const high = avgAbsDrift(180); // 3x tempo
  assert(high > low * 1.3,
    `drift magnitude grows with bpm (180 > 60)`,
    `low=${low.toFixed(4)} high=${high.toFixed(4)} ratio=${(high/low).toFixed(2)}x`);
}

// 5. warmth follows a smooth curve.
{
  const N = loadModule();
  N.init(120, 180);
  N.step({ rms: 0.4, centroid: 0.9, dt: 1 / 60 });
  assert(approx(N.state.warmth, 0.5 + (0.9 - 0.5) * 0.02, 1e-6),
    `warmth lerps 2% toward centroid=0.9`,
    `got ${N.state.warmth.toFixed(6)}`);
  // Smooth curve: no jumps larger than the lerp step (0.02 per frame).
  let prev = N.state.warmth;
  let maxJump = 0;
  for (let i = 0; i < 200; i++) {
    N.step({ rms: 0.4, centroid: 0.1, dt: 1 / 60 });
    maxJump = Math.max(maxJump, Math.abs(N.state.warmth - prev));
    prev = N.state.warmth;
  }
  assert(maxJump <= 0.02 + 1e-9,
    `warmth jumps ≤ 0.02 per frame`, `max jump = ${maxJump.toFixed(6)}`);
  assert(approx(N.state.warmth, 0.1, 0.02),
    `warmth asymptotes toward centroid=0.1`, `got ${N.state.warmth.toFixed(4)}`);
}

// 6. reset() zeros all state.
{
  const N = loadModule();
  N.init(120, 180);
  for (let i = 0; i < 200; i++) N.step({ rms: 0.7, beat: 1.0, centroid: 0.8, dt: 1 / 60 });
  N.reset();
  assert(N.state.tension === 0, `reset() zeros tension`);
  assert(N.state.peak === 0, `reset() zeros peak`);
  assert(N.state.drift.x === 0 && N.state.drift.y === 0,
    `reset() zeros drift`);
  assert(N.state.warmth === 0.5, `reset() resets warmth to 0.5`,
    `got ${N.state.warmth}`);
  assert(N.state.age === 0, `reset() zeros age`);
}

// Bonus (Stage 3 hook): phaseMultiplier returns sensible shape.
{
  const N = loadModule();
  N.init(120, 100); // 100s expected duration
  N.state.age = 0;
  let p = N.phaseMultiplier(100);
  assert(p.openness === 0.4 && p.driftAmp === 0.3 && p.pullback === 0,
    `phaseMultiplier at t=0 → opening`, JSON.stringify(p));
  N.state.age = 50;
  p = N.phaseMultiplier(100);
  assert(p.openness === 1.0 && p.driftAmp === 1.0 && p.pullback === 0,
    `phaseMultiplier at t=0.5 → middle`, JSON.stringify(p));
  N.state.age = 90;
  p = N.phaseMultiplier(100);
  assert(p.driftAmp === 1.4 && approx(p.pullback, 0.6, 1e-6) && p.openness === 0.7,
    `phaseMultiplier at t=0.9 → climax`, JSON.stringify(p));
}

// Bonus: deterministic — same init args produce same drift sequence.
{
  function driftTrace() {
    const N = loadModule();
    N.init(124, 217); // unique seed
    const trace = [];
    for (let i = 0; i < 50; i++) {
      N.step({ rms: 0.5, dt: 1 / 60 });
      trace.push(N.state.drift.x);
    }
    return trace;
  }
  const a = driftTrace();
  const b = driftTrace();
  let match = a.length === b.length;
  for (let i = 0; i < a.length && match; i++) match = approx(a[i], b[i], 1e-12);
  assert(match, `same init args → identical drift sequence (deterministic)`);
}

// Stage 4: beat-locked micro-evolution.
// Plan success criterion: "with a synthetic 120 BPM beat stream, after
// 8 beats the beat counter is 8, every 4th beat fires microAmp=1.5,
// and peak is bumped to >=0.6 on those beats."
{
  const N = loadModule();
  N.init(120, 180);
  // 8 beats at 60fps = 8 beat-pulses with intervening no-beat frames.
  // 120 BPM = 2 beats/sec = 1 beat every 30 frames.
  let fireCount = 0;
  let lastPeakBeforeFire = 0;
  for (let i = 0; i < 240; i++) {
    const isBeat = (i % 30 === 0);
    const r = N.onBeat(isBeat);
    if (isBeat && r.count > 0 && r.count % 4 === 0) {
      fireCount += 1;
      lastPeakBeforeFire = N.state.peak;
    }
  }
  assert(fireCount === 2,
    `every-4th-beat fires exactly twice over 8 beats`, `got ${fireCount}`);
  assert(N.state.peak >= 0.6,
    `peak is bumped to >=0.6 on a fired beat`, `got ${N.state.peak.toFixed(3)}`);
  // microAmp should be close to 1.0 after many decay frames.
// Decay rate 0.06 per frame; asymptote is 1.0, never exact. After 240
// frames from 1.5, microAmp ≈ 1.08 (the decay is geometric). Allow a
// loose tolerance — the test asserts microAmp is *heading back* to 1.0,
// not that it has converged.
  assert(N.getMicroAmp() < 1.1,
    `microAmp decays back toward 1.0`, `got ${N.getMicroAmp().toFixed(3)}`);
}

// Stage 4 reset() also clears beat counter.
{
  const N = loadModule();
  N.init(120, 180);
  N.onBeat(true);
  N.onBeat(true);
  N.reset();
  // After reset, fire count starts over.
  let fired = false;
  for (let i = 0; i < 120; i++) {
    const r = N.onBeat(i % 30 === 0);
    if (r.count === 4) fired = true;
  }
  assert(fired, `reset() zeros beat counter (4 beats after reset fires microAmp)`);
}

console.log(`\nNARRATIVE UNIT: ${failures === 0 ? 'ALL GREEN' : `${failures} FAILURES`}`);
process.exit(failures === 0 ? 0 : 1);