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
import { depthFloorFor, depthOk } from './lib/bench-depth.mjs';

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
console.log('');
console.log(`${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.log('failures:');
  failures.forEach((m) => console.log('  - ' + m));
  process.exit(1);
}
process.exit(0);
