#!/usr/bin/env node
// scripts/check-loop-unit.mjs — per-track loop toggle unit tests.
//
// Mirrors the showLoop + default-loop heuristics from swr-app.html
// (handleAudioFiles + renderAudioList + the localStorage restore path).
// We test the three rules in isolation:
//
//   1. showLoop(t)           → render the loop toggle?
//   2. defaultLoop(duration) → loop = true on add / back-compat restore?
//   3. toggle               → flips bool, applies to audioEl when current.
//
// All three rules are pure functions over the track record; we replicate
// them here so a refactor of swr-app.html has to keep these semantics.
//
// Run from project root: node scripts/check-loop-unit.mjs

const LOOP_THRESHOLD_SECONDS = 30;

// Replicates the showLoop check in renderAudioList. We require a positive
// duration (i.e. probeAudioDuration succeeded) AND duration < 30.
// Safe on null/undefined — the production code passes `t && t.duration`.
function showLoop(t) {
  if (!t || typeof t.duration !== 'number') return false;
  return t.duration > 0 && t.duration < LOOP_THRESHOLD_SECONDS;
}

// Replicates handleAudioFiles' default loop heuristic AND the
// back-compat restore path. New tracks (and legacy tracks without
// a .loop key) get loop = true if duration is in the loop window.
function defaultLoop(t) {
  if (!t || typeof t.duration !== 'number') return false;
  return t.duration > 0 && t.duration < LOOP_THRESHOLD_SECONDS;
}

// Replicates the toggle handler in renderAudioList.
function toggleLoop(t) {
  t.loop = !t.loop;
  return t.loop;
}

let passed = 0;
let failed = 0;
function assert(label, cond, extra) {
  const ok = !!cond;
  if (ok) { passed++; console.log(`  ✓ ${label}`); }
  else    { failed++; console.log(`  ✗ ${label}${extra ? ' — ' + JSON.stringify(extra) : ''}`); }
}

console.log('=== showLoop: render the toggle? ===');
assert('3s track → true',     showLoop({duration: 3}) === true);
assert('15s track → true',    showLoop({duration: 15}) === true);
assert('29.9s track → true',  showLoop({duration: 29.9}) === true);
assert('30s track → false',   showLoop({duration: 30}) === false);
assert('45s track → false',   showLoop({duration: 45}) === false);
assert('180s track → false',  showLoop({duration: 180}) === false);
assert('duration 0 → false',  showLoop({duration: 0}) === false);
assert('null track → false',  showLoop(null) === false);

console.log('\n=== defaultLoop: new track + back-compat restore ===');
assert('new 15s → loop on',   defaultLoop({duration: 15}) === true);
assert('new 60s → loop off',  defaultLoop({duration: 60}) === false);
assert('new 3s → loop on',    defaultLoop({duration: 3}) === true);
assert('new 0s → loop off',   defaultLoop({duration: 0}) === false);

console.log('\n=== toggle: state mutation ===');
{
  const t = { duration: 15, loop: true };
  const after1 = toggleLoop(t);
  assert('toggle off from on', after1 === false && t.loop === false);
  const after2 = toggleLoop(t);
  assert('toggle on from off', after2 === true && t.loop === true);
}
{
  // Toggle preserves duration / other fields
  const t = { duration: 15, loop: false, name: 'x', size: 100 };
  toggleLoop(t);
  assert('toggle preserves duration', t.duration === 15);
  assert('toggle preserves name',     t.name === 'x');
  assert('toggle preserves size',     t.size === 100);
}

console.log('\n=== integration: handleAudioFiles flow ===');
// Simulate handleAudioFiles for a known-duration track
function simulateHandle(duration) {
  return {
    duration,
    loop: duration > 0 && duration < LOOP_THRESHOLD_SECONDS,
  };
}
{
  const t = simulateHandle(12);
  assert('12s auto-enables loop',     t.loop === true && showLoop(t) === true);
}
{
  const t = simulateHandle(120);
  assert('120s auto-disables loop',   t.loop === false && showLoop(t) === false);
}

console.log('\n=== integration: back-compat restore (legacy track, no .loop) ===');
// The localStorage restore path in restore() should fill in a default.
function backCompatRestore(saved) {
  return {
    ...saved,
    loop: saved.loop !== undefined ? saved.loop : defaultLoop(saved),
  };
}
{
  const restored = backCompatRestore({duration: 15}); // no .loop key
  assert('legacy 15s becomes loop=true', restored.loop === true);
}
{
  const restored = backCompatRestore({duration: 60});
  assert('legacy 60s becomes loop=false', restored.loop === false);
}
{
  const restored = backCompatRestore({duration: 15, loop: false});
  assert('explicit loop=false is preserved', restored.loop === false);
}
{
  const restored = backCompatRestore({duration: 15, loop: true});
  assert('explicit loop=true is preserved', restored.loop === true);
}
{
  // Backward compatibility: tracks added with no `duration` (unknown)
  // default to loop = false, which means showLoop won't render the
  // toggle. That's safe — user can re-add the file to populate duration.
  const restored = backCompatRestore({}); // no duration, no loop
  assert('legacy unknown-duration → loop=false', restored.loop === false);
}

console.log(`\nLOOP UNIT: ${failed === 0 ? 'ALL GREEN' : `${failed} FAILED`} (${passed + failed} tests)`);
process.exit(failed === 0 ? 0 : 1);
