// scripts/check-bpm-unit.mjs — BPM detection on realistic (jittery) onsets.
//
// Regression coverage for issue #76: estimateBPM returned 0 for every
// vocal-led track because candidates were binned at 10ms and one bin had to
// hold >=50% of intervals. Real onsets jitter by ±20-30ms, so nothing ever
// passed. Measured before the fix: 240ms ±5ms -> 125, 240ms ±15ms -> 0.
//
// These cases are deterministic (seeded LCG, not Math.random) so a failure
// is reproducible rather than "sometimes red". The negative controls matter
// as much as the positives: the fix must not start inventing a tempo for
// genuinely arrhythmic input.
//
// Run: node scripts/check-bpm-unit.mjs

import { readFileSync } from 'node:fs';
import vm from 'node:vm';

// audio-analysis-v2.js is a browser global-script (it assigns window.*), so
// load it with a window shim rather than importing it as a module.
const SRC = readFileSync(new URL('../audio-analysis-v2.js', import.meta.url), 'utf8');
const sandbox = { window: {}, console };
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(SRC, sandbox);
const estimateBPM = sandbox.window.AudioAnalysisV2.estimateBPM;

if (typeof estimateBPM !== 'function') {
  console.error('BPM UNIT: estimateBPM not exposed by audio-analysis-v2.js');
  process.exit(1);
}

// Deterministic PRNG — a flaky tempo test is worse than none.
function lcg(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

// Onsets at `intervalMs` with ±`jitterMs` of scatter, seeded.
function onsetsAt(intervalMs, jitterMs, count, seed = 1) {
  const rnd = lcg(seed);
  const times = [];
  let cur = 0;
  for (let i = 0; i < count; i++) {
    times.push(cur);
    cur += (intervalMs + (rnd() * 2 - 1) * jitterMs) / 1000;
  }
  return times;
}

const results = [];
function check(name, fn) {
  let ok = false, detail = '';
  try {
    const r = fn();
    ok = r === true;
    detail = typeof r === 'string' ? r : '';
  } catch (e) {
    detail = e.message;
  }
  results.push({ name, ok, detail });
  console.log(`  ${ok ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`);
}

// ---- Jitter tolerance (the bug) -------------------------------------
// True tempos, with what the fold should map them to.
const JITTER_CASES = [
  { ms: 240, jitter: 0,  expect: 125 },
  { ms: 240, jitter: 5,  expect: 125 },
  { ms: 240, jitter: 15, expect: 125 },
  { ms: 240, jitter: 25, expect: 125 },
  { ms: 240, jitter: 35, expect: 125 },
  { ms: 120, jitter: 0,  expect: 125 },
  { ms: 120, jitter: 15, expect: 125 },
  { ms: 500, jitter: 20, expect: 120 },
];

for (const c of JITTER_CASES) {
  check(
    `${c.ms}ms ±${c.jitter}ms -> ~${c.expect} BPM`,
    () => {
      const got = estimateBPM(onsetsAt(c.ms, c.jitter, 60, c.ms + c.jitter));
      if (got === 0) return 'returned 0 (detector gave up)';
      if (Math.abs(got - c.expect) > 15) return `got ${got}, expected ~${c.expect}`;
      return true;
    },
  );
}

// ---- Octave reinforcement -------------------------------------------
// 120ms and 240ms both mean ~125 BPM. Histogramming raw intervals makes
// them competing peaks; folding first makes them reinforce.
check('interleaved 120ms + 240ms onsets -> ~125 BPM', () => {
  const times = [];
  let cur = 0;
  for (let i = 0; i < 80; i++) {
    times.push(cur);
    cur += i % 2 ? 0.24 : 0.12;
  }
  const got = estimateBPM(times);
  if (got === 0) return 'returned 0';
  return Math.abs(got - 125) <= 15 ? true : `got ${got}, expected ~125`;
});

// ---- Negative controls ----------------------------------------------
// Must NOT hallucinate a tempo for arrhythmic input.
check('random intervals -> 0 (20 seeded trials)', () => {
  let zeros = 0;
  for (let seed = 1; seed <= 20; seed++) {
    const rnd = lcg(seed);
    const times = [];
    let cur = 0;
    for (let i = 0; i < 60; i++) {
      times.push(cur);
      cur += 0.08 + rnd() * 1.9;
    }
    if (estimateBPM(times) === 0) zeros++;
  }
  return zeros === 20 ? true : `${zeros}/20 returned 0`;
});

check('empty input -> 0', () => (estimateBPM([]) === 0 ? true : 'non-zero'));
check('too few onsets (3) -> 0', () => (estimateBPM([0, 0.5, 1.0]) === 0 ? true : 'non-zero'));
check('non-array -> 0', () => (estimateBPM(null) === 0 ? true : 'non-zero'));
check('silence (no onsets) -> 0', () => (estimateBPM([]) === 0 ? true : 'non-zero'));

// ---- Range invariant -------------------------------------------------
check('result always within 60-180 when non-zero', () => {
  for (let i = 60; i <= 900; i += 17) {
    const got = estimateBPM(onsetsAt(i, 10, 50, i));
    if (got !== 0 && (got < 60 || got > 180)) return `${i}ms -> ${got} out of range`;
  }
  return true;
});

const failed = results.filter((r) => !r.ok);
console.log('');
console.log(failed.length === 0
  ? `BPM UNIT: ALL GREEN (${results.length} checks)`
  : `BPM UNIT: ${failed.length} CHECK(S) FAILED`);
process.exit(failed.length === 0 ? 0 : 1);
