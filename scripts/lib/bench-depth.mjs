// scripts/lib/bench-depth.mjs — the A/V sampling-depth floor for the bench gate.
//
// WHY THIS EXISTS
// ---------------
// `scripts/check-bench-smoke.mjs` asserts "every run measured the clock":
// every run must record at least one A/V sample, and the typical run must
// record at least two.
//
// The second half used to be a flat 2. That is right for a HOST which
// samples once per run — but it is not right for a slow MACHINE, and the
// gate conflated the two. On a CI runner measured on 2026-11-05 (run
// 42024230323) EVERY run produced exactly ONE A/V sample
// ([1,1,1,1,1,1,1,1,1,1]), because the bench page renders at ~0.29 fps
// there and a 3.5 s run can only contain one frame. The flat floor of 2
// asked for what the runner cannot deliver, and it failed a gate whose
// MEASUREMENT was perfect — the injected lag read 12.0 ms, the clean run
// read 0.0 ms, and both interpolation assertions passed.
//
// So the depth floor is derived from the host's OWN measured frame rate. A
// run of RUN_MS can only hold as many samples as the host can draw frames,
// and one frame's worth of phase slack is allowed, because a run's first
// frame can land just after recording starts.
//
//   framesPerRun = round(fps * runMs / 1000) - 1     (phase-tolerant)
//   depthFloor   = min(2, max(1, framesPerRun))
//
// Where the host is fast enough for two samples the floor is STILL 2, so a
// host that renders at speed but samples only once per run still fails. The
// gate keeps its teeth exactly where they are needed.
//
// Zero dependencies. Node >= 18.

/**
 * The minimum median A/V sample count a run set must reach, given the
 * host's measured frame rate.
 *
 * @param {number} fps      the host's measured average frame rate
 * @param {number} runMs    the length of one run, in milliseconds
 * @returns {number} 1 or 2
 */
export function depthFloorFor(fps, runMs) {
  const f = Number(fps);
  const ms = Number(runMs);
  if (!Number.isFinite(f) || !Number.isFinite(ms) || f <= 0 || ms <= 0) return 1;
  // One frame of phase slack: a run's first frame can land just after
  // recording starts, so a run reliably holds (frames - 1) samples.
  const framesPerRun = Math.round((f * ms) / 1000) - 1;
  return Math.min(2, Math.max(1, framesPerRun));
}

/**
 * Whether a set of per-run A/V sample counts satisfies the depth floor.
 *
 * @param {number[]} samples  the A/V sample count of each run
 * @param {number}   fps      the host's measured average frame rate
 * @param {number}   runMs    the length of one run, in milliseconds
 * @returns {{ok:boolean, floor:number, min:number, median:number}}
 */
export function depthOk(samples, fps, runMs) {
  const list = Array.isArray(samples) ? samples.map(Number).filter(Number.isFinite) : [];
  const floor = depthFloorFor(fps, runMs);
  if (!list.length) return { ok: false, floor, min: 0, median: 0 };
  const sorted = list.slice().sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  const median = sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  const min = sorted[0];
  // Every run must have recorded SOMETHING — a run that measured nothing
  // is a broken host, whatever its frame rate.
  return { ok: min >= 1 && median >= floor, floor, min, median };
}
