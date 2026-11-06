#!/usr/bin/env node
// scripts/check-bench-depth-unit.mjs — the A/V sampling-depth floor.
//
// `scripts/check-bench-smoke.mjs` asserts "every run measured the clock":
// every run records at least one A/V sample, and the typical run records at
// least two. The second half is a floor DERIVED from the host's own
// measured frame rate, because a flat floor of 2 asks a slow machine for
// what it cannot deliver.
//
// This gate pins that rule. It is load-bearing in both directions:
//
//   * the SLOW HOST case passes — a runner whose bench page renders at
//     ~0.29 fps yields exactly one A/V sample per 3.5 s run, and that must
//     NOT fail. This is the case that reddened CI run 42024230323 on
//     2026-11-05 with [1,1,1,1,1,1,1,1,1,1];
//   * the SHALLOW HOST case still fails — a host that renders at speed but
//     records one sample per run is broken, and the gate must catch it.
//
// Zero dependencies. Node >= 18.
//
// Run command:
//   node scripts/check-bench-depth-unit.mjs
//
// Pass criteria: every assertion green, exit 0.
import { depthFloorFor, depthOk, frameSampleFloorFor, runWindowFor } from './lib/bench-depth.mjs';

let passed = 0;
let failed = 0;
const failures = [];

function assert(cond, msg) {
  if (cond) {
    passed++;
    console.log(`  ok  ${msg}`);
  } else {
    failed++;
    failures.push(msg);
    console.log(`  FAIL ${msg}`);
  }
}

function section(title) {
  console.log('');
  console.log(`── ${title} ──`);
}

const RUN_MS = 3500;

// ---------------------------------------------------------------------------
section('the floor is derived from the host frame rate');
{
  // A fast host: plenty of frames, so the floor is 2 — unchanged.
  assert(depthFloorFor(60, RUN_MS) === 2, 'a 60 fps host keeps the floor at 2');
  assert(depthFloorFor(30, RUN_MS) === 2, 'a 30 fps host keeps the floor at 2');
  // The CI runner: ~0.29 fps, so one frame per 3.5 s run.
  assert(depthFloorFor(0.286, RUN_MS) === 1, 'a 0.29 fps host gets a floor of 1');
  assert(depthFloorFor(0.5, RUN_MS) === 1, 'a 0.5 fps host gets a floor of 1');
  // The boundary: at ~0.72 fps a run reliably holds two frames.
  assert(depthFloorFor(0.72, RUN_MS) === 2, 'a 0.72 fps host gets a floor of 2');
  // Nonsense in, floor of 1 out — never a floor of 0 (which would pass
  // anything) and never above 2.
  assert(depthFloorFor(0, RUN_MS) === 1, 'a host that rendered no frames gets a floor of 1');
  assert(depthFloorFor(-5, RUN_MS) === 1, 'a negative frame rate gets a floor of 1');
  assert(depthFloorFor(NaN, RUN_MS) === 1, 'an unmeasurable frame rate gets a floor of 1');
}

// ---------------------------------------------------------------------------
section('the frame-sample floor is derived from the host frame rate');
{
  // A fast host: the flat requirement is unchanged.
  assert(frameSampleFloorFor(60, RUN_MS) === 5, 'a 60 fps host still has to carry 5 frame samples');
  assert(frameSampleFloorFor(30, RUN_MS) === 5, 'a 30 fps host still has to carry 5 frame samples');
  assert(frameSampleFloorFor(2, RUN_MS) === 5, 'a 2 fps host still has to carry 5 frame samples');
  // The CI runner of run 42118548118: 1.30 fps, so a 3.5 s run held 4
  // frame samples and the flat floor of 5 failed a sound measurement.
  assert(frameSampleFloorFor(1.304, RUN_MS) === 4, 'the 1.30 fps runner needs only 4 frame samples');
  assert(frameSampleFloorFor(0.286, RUN_MS) === 1, 'a 0.29 fps host needs only 1 frame sample');
  assert(frameSampleFloorFor(0.5, RUN_MS) === 1, 'a 0.5 fps host needs only 1 frame sample');
  // The floor never reaches 0 — that would pass an EMPTY report.
  assert(frameSampleFloorFor(0, RUN_MS) === 1, 'a host that rendered no frames still needs 1 sample');
  assert(frameSampleFloorFor(-5, RUN_MS) === 1, 'a negative frame rate still needs 1 sample');
  assert(frameSampleFloorFor(NaN, RUN_MS) === 1, 'an unmeasurable frame rate still needs 1 sample');
  assert(frameSampleFloorFor(undefined, RUN_MS) === 1, 'a missing frame rate still needs 1 sample');
  // The cap is the gate's: it is never exceeded, whatever the host claims.
  assert(frameSampleFloorFor(1000, RUN_MS) === 5, 'the floor never exceeds the flat requirement');
  assert(frameSampleFloorFor(1000, RUN_MS, 3) === 3, 'the cap is configurable');
}
// ---------------------------------------------------------------------------
section('the slow host passes — the case that reddened CI');
{
  // Exactly the numbers CI run 42024230323 produced on 2026-11-05.
  const av = [1, 1, 1, 1, 1, 1, 1, 1, 1, 1];
  const r = depthOk(av, 0.286, RUN_MS);
  assert(r.ok === true, 'ten runs of ONE sample each pass at 0.29 fps');
  assert(r.floor === 1, 'the floor was 1');
  assert(r.min === 1 && r.median === 1, 'the samples really were all 1');
}

// ---------------------------------------------------------------------------
section('the shallow host still fails — the gate keeps its teeth');
{
  // A host that renders at speed but records only one sample per run is
  // broken: it COULD have measured more. This must not be excused.
  const r = depthOk([1, 1, 1, 1, 1, 1, 1, 1, 1, 1], 30, RUN_MS);
  assert(r.ok === false, 'one sample per run FAILS at 30 fps');
  assert(r.floor === 2, 'the floor was 2');

  // A host that measures nothing at all fails at every frame rate.
  assert(depthOk([0, 0, 0], 60, RUN_MS).ok === false, 'a run that measured nothing fails at 60 fps');
  assert(depthOk([0, 0, 0], 0.286, RUN_MS).ok === false, 'a run that measured nothing fails at 0.29 fps');
  assert(depthOk([], 60, RUN_MS).ok === false, 'no runs at all fails');
}

// ---------------------------------------------------------------------------
section('a healthy host passes');
{
  const r = depthOk([12, 14, 13, 15, 13], 30, RUN_MS);
  assert(r.ok === true, 'a host with a dozen samples per run passes');
  assert(r.floor === 2, 'the floor was 2');
  assert(r.median === 13, 'the median was computed');
  // One unlucky run among good ones is not a failure.
  assert(depthOk([1, 12, 13, 14, 15], 30, RUN_MS).ok === true, 'one shallow run among deep ones still passes');
}


// ---------------------------------------------------------------------------
// The RUN WINDOW: how long a run has to be, given the host's frame rate.
//
// `runTest` ends on a wall-clock timer, but the measurement arrives at the
// host's frame rate — the sampler primes on one rAF callback and records
// an interval on the next, and the A/V samples come from the same render
// loop. So a window shorter than the host's frame time collects NOTHING,
// `scoreReport` returns `invalid`, and the advisor has no grade. CI run
// 42219635267 hit exactly that.
//
// The window is derived from the host's own measured rate.
section('a fast host gets the window the gate always asked for');
{
  assert(runWindowFor(60, 3, 3500, 20000) === 3500, 'a 60 fps host keeps the base window');
  assert(runWindowFor(30, 3, 3500, 20000) === 3500, 'a 30 fps host keeps the base window');
  assert(runWindowFor(24, 3, 3500, 20000) === 3500, 'a 24 fps host keeps the base window');
}

section('a slow host is given the window it needs');
{
  // 3 frames at 1.3 fps takes 2308ms — still inside the base window.
  assert(runWindowFor(1.3, 3, 3500, 20000) === 3500, '1.3 fps still fits the base window');
  // 3 frames at 0.3 fps takes 10000ms — the window has to grow.
  assert(runWindowFor(0.3, 3, 3500, 20000) === 10000, '0.3 fps gets a 10s window');
  assert(runWindowFor(0.29, 3, 3500, 20000) === 10345, '0.29 fps gets a longer window');
  // The window grows with the host's slowness, monotonically.
  assert(runWindowFor(0.1, 3, 3500, 20000) > runWindowFor(0.3, 3, 3500, 20000), 'a slower host gets a longer window');
}

section('the window is bounded, and an unknown host keeps the base');
{
  // A broken host cannot hang the gate.
  assert(runWindowFor(0.0001, 3, 3500, 20000) === 20000, 'the ceiling holds');
  assert(runWindowFor(0, 3, 3500, 20000) === 3500, 'an unmeasured host keeps the base window');
  assert(runWindowFor(NaN, 3, 3500, 20000) === 3500, 'a NaN host keeps the base window');
  assert(runWindowFor(undefined, 3, 3500, 20000) === 3500, 'a missing host keeps the base window');
  assert(runWindowFor(-1, 3, 3500, 20000) === 3500, 'a negative rate keeps the base window');
  // A cap below the base is nonsense, and the base wins.
  assert(runWindowFor(0.3, 3, 3500, 1000) === 3500, 'a cap below the base does not shrink the window');
}

// ---------------------------------------------------------------------------
console.log('');
console.log(`${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.log('failures:');
  failures.forEach((m) => console.log('  - ' + m));
  process.exit(1);
}
process.exit(0);
