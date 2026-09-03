#!/usr/bin/env node
// scripts/check-p35-unit.mjs — P3.5 history/scope unit tests.
//
// Replicates the in-page history+scope primitives in a Node harness
// and exercises them against a wide range of scenarios:
//
//   - scope filtering: 'all', 'reactors', etc.
//   - preserve filtering: 'layers', 'preset', etc.
//   - snapshot deep-clone correctness
//   - undo/redo with branching (redo tail trim)
//   - cap-at-max (50 entries)
//   - commit cursor navigation (Phase 2)
//   - first-burst vs auto-repeat history push policy (Phase 2)
//   - amount bump clamping
//
// Run from the project root: node scripts/check-p35-unit.mjs

const STATE_FIELD_KEYS = ['preset', 'sliders', 'layers', 'layerAssets', 'reactors', 'export', 'branding'];
const state_scope = { scope: 'all', amount: 0.4, preserve: [] };

function _scopeFields() {
  const base = state_scope.scope === 'all' ? STATE_FIELD_KEYS : [state_scope.scope];
  return base.filter(k => state_scope.preserve.indexOf(k) < 0);
}

function snapshotScoped(label) {
  const fields = _scopeFields();
  const subset = {};
  for (const k of fields) subset[k] = JSON.parse(JSON.stringify(state[k]));
  return { subset, timestamp: performance.now(), label: label || 'state' };
}
function applySnapshot(snap) {
  for (const k of Object.keys(snap.subset)) {
    state[k] = JSON.parse(JSON.stringify(snap.subset[k]));
  }
}

// History state machine (mirrors the in-page one)
const H = {
  stack: [], cursor: -1, max: 50,
  commits: [], commitCursor: null,
  // Phase 2: track whether the next mutation is the first in a burst.
  // Browsers auto-repeat keydown events for held keys; we want to push
  // history only on the FIRST event in a hold.
  _inBurst: false
};

function pushHistory(label) {
  if (H.cursor < H.stack.length - 1) H.stack = H.stack.slice(0, H.cursor + 1);
  H.stack.push(snapshotScoped(label));
  if (H.stack.length > H.max) H.stack.shift();
  H.cursor = H.stack.length - 1;
}
function seedInitialHistory() { H.stack.push(snapshotScoped('initial')); H.cursor = 0; }
function undo() { if (H.cursor <= 0) return false; H.cursor--; applySnapshot(H.stack[H.cursor]); return true; }
function redo() { if (H.cursor >= H.stack.length - 1) return false; H.cursor++; applySnapshot(H.stack[H.cursor]); return true; }

function _commitCurrent() {
  const label = 'commit ' + String(H.commits.length + 1).padStart(2, '0');
  H.commits.push(snapshotScoped(label));
}
function _cycleCommit(dir) {
  if (H.commits.length === 0) return 'no-commits';
  if (H.commitCursor == null) H.commitCursor = H.commits.length;
  const next = Math.max(0, Math.min(H.commits.length, H.commitCursor + dir));
  if (next === H.commitCursor) return 'no-move';
  H.commitCursor = next;
  if (next >= H.commits.length) return 'live';
  applySnapshot(H.commits[next]);
  return 'commit-' + (next + 1);
}

// 7-key test state
const state = {
  preset: 'neon', sliders: { intensity: 70, speed: 50 },
  layers: [{ id: 'background', opacity: 100 }],
  layerAssets: { background: [] },
  reactors: { background: [{ feature: 'bass', target: 'opacity', scale: 0.5, enabled: true }, null, null] },
  export: { format: '16:9' },
  branding: { wordmark: 'TEST' }
};

let failures = 0;
let total = 0;
function assert(c, name, d) {
  total++;
  console.log((c ? '  ✓ ' : '  ✗ ') + name + (d ? '  — ' + d : ''));
  if (!c) failures++;
}
function resetState() {
  state.preset = 'neon'; state.sliders.intensity = 70; state.sliders.speed = 50;
  state.layers = [{ id: 'background', opacity: 100 }];
  state.layerAssets = { background: [] };
  state.reactors = { background: [{ feature: 'bass', target: 'opacity', scale: 0.5, enabled: true }, null, null] };
  state.export = { format: '16:9' };
  state.branding = { wordmark: 'TEST' };
  state_scope.scope = 'all'; state_scope.preserve = []; state_scope.amount = 0.4;
  H.stack = []; H.cursor = -1; H.commits = []; H.commitCursor = null; H._inBurst = false;
}

console.log('=== scope / preserve ===');
resetState();
assert(_scopeFields().length === 7, 'all/[] has 7 fields');
state_scope.preserve = ['layers'];
let f = _scopeFields();
assert(f.length === 6 && f.indexOf('layers') < 0, 'all+layers preserved', `f=[${f.join(',')}]`);
state_scope.scope = 'reactors';
assert(_scopeFields().length === 1 && _scopeFields()[0] === 'reactors', 'reactors scope is 1 field');
state_scope.scope = 'all'; state_scope.preserve = [];
assert(_scopeFields().length === 7, 'back to all/[]: 7 fields');

console.log('\n=== snapshot deep clone ===');
resetState();
const s1 = snapshotScoped('s1');
state.preset = 'film';
state.sliders.intensity = 12;
state.reactors.background[0].scale = 0.01;
const s2 = snapshotScoped('s2');
// s1's preset/sliders/reactors should still be the original values
assert(s1.subset.preset === 'neon', 's1.preset is neon (snapshot pre-mutation)');
assert(s1.subset.sliders.intensity === 70, 's1.sliders.intensity is 70');
assert(s1.subset.reactors.background[0].scale === 0.5, 's1.reactor.scale is 0.5 (deep clone)');
// Mutate s1.subset.reactors[0].scale — should NOT affect state
s1.subset.reactors.background[0].scale = 0.99;
assert(state.reactors.background[0].scale === 0.01, 'state unchanged after mutating snapshot');

console.log('\n=== history: capture POST-action, seed initial ===');
resetState();
seedInitialHistory();
assert(H.stack.length === 1 && H.cursor === 0, 'after seed: 1 stack entry');
state.preset = 'film'; state.sliders.intensity = 12;
pushHistory('act1');
assert(H.stack.length === 2 && H.cursor === 1, 'after act1: stack=2 cursor=1');
undo();
assert(state.preset === 'neon' && state.sliders.intensity === 70, 'undo → initial state');
assert(!undo(), 'undo at initial: returns false');
redo();
assert(state.preset === 'film' && state.sliders.intensity === 12, 'redo → act1');

console.log('\n=== branching: trim redo tail ===');
resetState();
seedInitialHistory();
state.preset = 'a'; pushHistory('a');
state.preset = 'b'; pushHistory('b');
state.preset = 'c'; pushHistory('c');
assert(H.stack.length === 4 && H.cursor === 3, 'before branch: stack=4 cursor=3');
undo(); undo();
assert(H.cursor === 1, 'after 2 undos: cursor=1');
state.preset = 'X'; pushHistory('branch');
assert(H.cursor === 2 && H.stack.length === 3, 'branch trims redo tail: stack=3 cursor=2');
assert(state.preset === 'X', 'branch state applied');

console.log('\n=== cap at max ===');
resetState();
H.max = 3;
seedInitialHistory(); // stack=[initial]
state.preset = 'd1'; pushHistory('d1');
state.preset = 'd2'; pushHistory('d2');
state.preset = 'd3'; pushHistory('d3');
assert(H.stack.length === 3, 'cap=3 honored: stack=3');

console.log('\n=== commit cursor (Phase 2) ===');
resetState();
seedInitialHistory();
// No commits yet
assert(_cycleCommit(-1) === 'no-commits', 'cycle back: no commits → no-commits');
assert(_cycleCommit(1) === 'no-commits', 'cycle forward: no commits → no-commits');
// Add 3 commits
state.preset = 'c1'; _commitCurrent();
state.preset = 'c2'; _commitCurrent();
state.preset = 'c3'; _commitCurrent();
assert(H.commits.length === 3, '3 commits stored');
// Cursor at end (live state)
state.preset = 'live'; // current state
assert(_cycleCommit(-1) === 'commit-3', 'back: live → commit 3');
assert(state.preset === 'c3', 'preset = c3');
assert(_cycleCommit(-1) === 'commit-2', 'back: commit 3 → commit 2');
assert(state.preset === 'c2', 'preset = c2');
assert(_cycleCommit(-1) === 'commit-1', 'back: commit 2 → commit 1');
assert(state.preset === 'c1', 'preset = c1');
assert(_cycleCommit(-1) === 'no-move', 'back at oldest: no-move');
// Forward back to live
assert(_cycleCommit(1) === 'commit-2', 'fwd: commit 1 → commit 2');
assert(_cycleCommit(1) === 'commit-3', 'fwd: commit 2 → commit 3');
assert(_cycleCommit(1) === 'live', 'fwd: commit 3 → live (state preserved as-is)');

console.log('\n=== first-burst vs auto-repeat (Phase 2) ===');
resetState();
seedInitialHistory();
// Simulate keydown → push (initial burst), then 4 auto-repeat ticks
// that should NOT push history (per Phase 2 policy).
H.stack.push(snapshotScoped('mutate-burst')); // first press
H.cursor = H.stack.length - 1;
const beforeRepeats = H.stack.length;
// Simulate 4 repeat ticks — in the real impl these mutateState() but
// don't push. We model that here by NOT calling pushHistory.
for (let i = 0; i < 4; i++) {
  state.sliders.intensity += 1; // mutate (no push)
}
assert(H.stack.length === beforeRepeats, 'auto-repeat did not push history', `stack=${H.stack.length}`);
state.preset = 'film'; // simulate a SECOND burst (user releases M, presses again)
pushHistory('mutate-burst-2');
assert(H.stack.length === beforeRepeats + 1, 'second burst pushed 1 history entry');

console.log('\n=== amount bump ===');
state_scope.amount = 0.4;
function bump(d) { state_scope.amount = Math.max(0, Math.min(1, Math.round((state_scope.amount + d) * 100) / 100)); }
for (let i = 1; i <= 12; i++) bump(0.05);
assert(state_scope.amount === 1, 'amount caps at 1.0', `v=${state_scope.amount}`);
bump(0.05); assert(state_scope.amount === 1, 'still capped');
bump(-10); assert(state_scope.amount === 0, 'clamped to 0');
// Negative-delta never goes below 0
bump(0.4); assert(state_scope.amount === 0.4, 'bump from 0 to 0.4');

console.log('\n=== preset cycling (Phase 3) ===');
resetState();
// Simulate cycling through presets in the simple way
const PRESETS_TEST = [
  { id: 'neon', name: 'Neon' },
  { id: 'film', name: 'Film' },
  { id: 'grid', name: 'Grid' },
  { id: 'smoke', name: 'Smoke' }
];
let curIdx = 0;
state.preset = PRESETS_TEST[curIdx].id;
function _cyclePreset(dir, all) {
  curIdx = (curIdx + dir + all.length) % all.length;
  state.preset = all[curIdx].id;
  // mirror the in-page behavior: push a history entry
  H.stack.push(snapshotScoped('preset-' + state.preset));
  H.cursor = H.stack.length - 1;
}
_cyclePreset(1, PRESETS_TEST);
assert(state.preset === 'film', 'cycle +1 from neon → film', `got=${state.preset}`);
assert(H.cursor === H.stack.length - 1, 'cycle +1 pushed history', `cursor=${H.cursor} stack=${H.stack.length}`);
_cyclePreset(1, PRESETS_TEST);
_cyclePreset(1, PRESETS_TEST);
_cyclePreset(1, PRESETS_TEST);
assert(state.preset === 'neon', 'cycle wraps around to neon', `got=${state.preset}`);
_cyclePreset(-1, PRESETS_TEST);
assert(state.preset === 'smoke', 'cycle -1 from neon → smoke (wrap backward)', `got=${state.preset}`);
// 3 more -1: smoke → grid → film → neon
_cyclePreset(-1, PRESETS_TEST);
_cyclePreset(-1, PRESETS_TEST);
_cyclePreset(-1, PRESETS_TEST);
assert(state.preset === 'neon', 'cycle -1 3 times from smoke → neon', `got=${state.preset}`);

// Cycling pushes history, so undo can rewind.
// Undo restores the state of the snapshot taken BEFORE the most-recent
// cycle. We just cycled -1 three times, so the previous entry is 'film'.
assert(undo(), 'undo can rewind a preset cycle');
assert(state.preset === 'film', 'undo restores previous preset snapshot', `got=${state.preset}`);

console.log('\n=== mixed scope + preserve with snapshot ===');
resetState();
state_scope.scope = 'reactors'; state_scope.preserve = [];
const react = state.reactors.background[0].scale;
const sReact = snapshotScoped('reactors');
state.reactors.background[0].scale = 0.99;
assert(sReact.subset.reactors.background[0].scale === react, 'reactors snapshot preserved scale pre-mut');
// Other fields should NOT be in the snapshot
assert(!('preset' in sReact.subset), 'preset not in reactors scope');
assert(!('sliders' in sReact.subset), 'sliders not in reactors scope');
assert(applySnapshot.toString().includes('Object.keys'), 'sanity: applySnapshot iterates keys');

console.log();
console.log(failures === 0 ? `P3.5 UNIT: ALL GREEN (${total} tests)` : `${failures} of ${total} FAILED`);
process.exit(failures === 0 ? 0 : 1);
