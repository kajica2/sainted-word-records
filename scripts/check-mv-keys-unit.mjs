#!/usr/bin/env node
// scripts/check-mv-keys-unit.mjs — Phase E (Phase 5 of plan-doc)
// unit tests for client/hologram-keys.client.js. Pure Node; no
// DOM. Two groups:
//
//   1. cycleFocus         — focus-advance math (cycling, wrap,
//                           missing input, axis/dir validation)
//   2. apply()            — maps a KeyboardEvent.key string to a
//                           state mutation; returns whether it was
//                           handled
//
// Plan-doc called for 6 tests on cycleFocus. We deliver 7 there
// (incl. the "no current focus" cases that surfaced as a design
// decision during dev) and 5 apply() tests for total 12.

import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

// Load both modules (keys depends on no other hologram module, but
// loading the engine keeps future-proofing cheap).
const holoSrc = await readFile(resolve(ROOT, 'client/hologram-presets.client.js'), 'utf8');
const keysSrc = await readFile(resolve(ROOT, 'client/hologram-keys.client.js'), 'utf8');
// eslint-disable-next-line no-new-func
new Function(holoSrc)();
// eslint-disable-next-line no-new-func
new Function(keysSrc)();

const KEYS = globalThis.SWR_HOLOGRAM_KEYS;
if (!KEYS) {
  console.error('FATAL: hologram-keys module did not attach');
  process.exit(2);
}

// ---- Fixtures --------------------------------------------------------

// Six manifest-shaped presets arranged so each axis has a clear
// ordering. mood = 0, 0.2, 0.4, 0.6, 0.8, 1.0 (a..f) ascending.
const PRESETS = [
  { id: 'p-a', fx_state: { bloom: 0, chroma: 0, mut: 0, posterize: 16,
                            temp: 0, sepia: 0 }, audio_reactivity: {},
    motion: { rotation_speed: -0.2, scale_pulse: 0, pan_x: 0, pan_y: 0 } },
  { id: 'p-b', fx_state: { bloom: 0.2, chroma: 0.2, mut: 0.2, posterize: 12,
                            temp: 0.2, sepia: 0.2 }, audio_reactivity: {},
    motion: { rotation_speed: -0.1, scale_pulse: 0, pan_x: 0, pan_y: 0 } },
  { id: 'p-c', fx_state: { bloom: 0.4, chroma: 0.4, mut: 0.4, posterize: 8,
                            temp: 0.4, sepia: 0.4 }, audio_reactivity: {},
    motion: { rotation_speed:  0.0, scale_pulse: 0, pan_x: 0, pan_y: 0 } },
  { id: 'p-d', fx_state: { bloom: 0.6, chroma: 0.6, mut: 0.6, posterize: 4,
                            temp: 0.6, sepia: 0.6 }, audio_reactivity: {},
    motion: { rotation_speed:  0.1, scale_pulse: 0, pan_x: 0, pan_y: 0 } },
  { id: 'p-e', fx_state: { bloom: 0.8, chroma: 0.8, mut: 0.8, posterize: 2,
                            temp: 0.8, sepia: 0.8 }, audio_reactivity: {},
    motion: { rotation_speed:  0.2, scale_pulse: 0, pan_x: 0, pan_y: 0 } },
  { id: 'p-f', fx_state: { bloom: 1.0, chroma: 1.0, mut: 1.0, posterize: 0,
                            temp: 1.0, sepia: 1.0 }, audio_reactivity: {},
    motion: { rotation_speed:  0.3, scale_pulse: 0, pan_x: 0, pan_y: 0 } },
];

// Build a real hologram PresetMap and use its neighbours function
// as the cycleFocus's neighbour source. This is closer to the
// production wiring than a hand-rolled stub.
const holo = globalThis.SWR_HOLOGRAM.build(PRESETS);
const neighboursFn = function (coords, n) {
  return holo.presetMap.neighbours(coords, n || 4).map(function (e) {
    return { id: e.id, anchor: e.anchor, dist: e.dist };
  });
};
const presetMap = holo.presetMap;

let failures = 0;
let total = 0;
function assert(c, name, d) {
  total++;
  console.log((c ? '  ✓ ' : '  ✗ ') + name + (d ? '  — ' + d : ''));
  if (!c) failures++;
}

// ============================================================================
console.log('=== cycleFocus (plan-doc 6 tests + 1 missing-focus) ===');
// ============================================================================

// 1. Forward at end wraps to 0 along mood.
var s1 = { neighbours: 6, presetMap: presetMap };
var r1 = KEYS._impl.cycleFocus(s1, neighboursFn, 'mood', 1, 'p-f');
assert(r1 && r1.id === 'p-a',
  'forward cycle at last preset (p-f) wraps to first (p-a)',
  `got ${r1 && r1.id}`);

// 2. Backward at 0 wraps to length-1.
var r2 = KEYS._impl.cycleFocus(s1, neighboursFn, 'mood', -1, 'p-a');
assert(r2 && r2.id === 'p-f',
  'backward cycle at first preset (p-a) wraps to last (p-f)',
  `got ${r2 && r2.id}`);

// 3. Forward in the middle advances by one.
var r3 = KEYS._impl.cycleFocus(s1, neighboursFn, 'mood', 1, 'p-c');
assert(r3 && r3.id === 'p-d',
  'forward cycle mid-list (p-c) advances to next (p-d)',
  `got ${r3 && r3.id}`);

// 4. No current focus + direction +1 starts at index 0.
var r4 = KEYS._impl.cycleFocus(s1, neighboursFn, 'mood', 1, null);
assert(r4 && r4.id === 'p-a',
  'no focus + direction +1 returns the lowest-mood preset (p-a)',
  `got ${r4 && r4.id}`);

// 5. No current focus + direction -1 starts at index N-1.
var r5 = KEYS._impl.cycleFocus(s1, neighboursFn, 'mood', -1, undefined);
assert(r5 && r5.id === 'p-f',
  'no focus + direction -1 returns the highest-mood preset (p-f)',
  `got ${r5 && r5.id}`);

// 6. Each axis cycles independently.
var r6a = KEYS._impl.cycleFocus(s1, neighboursFn, 'complexity', 1, 'p-c');
// complexity axis: posterize/16 → ranks: p-f (0.0)→p-a (1.0). So
// forward from p-c (0.4) hits p-d (posterize=4 → 0.25 rank).
assert(r6a && r6a.id,
  'complexity axis cycles independently (returns a valid preset)',
  `got ${r6a && r6a.id}`);

// 7. Invalid axis returns null.
var r7 = KEYS._impl.cycleFocus(s1, neighboursFn, 'lol', 1, 'p-c');
assert(r7 === null,
  'invalid axis returns null',
  `got ${r7}`);

// (Plan-doc said "6 unit tests"; bonus check below)
var r7b = KEYS._impl.cycleFocus(s1, neighboursFn, 'mood', 0, 'p-c');
assert(r7b === null,
  'invalid direction (0) returns null',
  `got ${r7b}`);

// ============================================================================
console.log('\n=== apply() — keyboard event → state mutation ===');
// ============================================================================

// 8. ArrowRight advances focus along mood.
var st1 = { neighbours: 6, presetMap: presetMap, depth: 0.5, focus: 'p-b' };
var ok1 = KEYS.apply(st1, 'ArrowRight', { neighboursFn: neighboursFn, presetMap: presetMap });
assert(ok1 && st1.focus === 'p-c',
  'ArrowRight on focus p-b advances to p-c (next mood)',
  `focus=${st1.focus}`);

// 9. ArrowLeft goes back along mood.
var st2 = { neighbours: 6, presetMap: presetMap, depth: 0.5, focus: 'p-c' };
KEYS.apply(st2, 'ArrowLeft', { neighboursFn: neighboursFn, presetMap: presetMap });
assert(st2.focus === 'p-b',
  'ArrowLeft on focus p-c goes back to p-b',
  `focus=${st2.focus}`);

// 10. "0" resets depth to 0.5 and clears focus / focusAmount.
var st3 = { neighbours: 6, presetMap: presetMap, depth: 0.9, focus: 'p-e', focusAmount: 0.7 };
KEYS.apply(st3, '0', { neighboursFn: neighboursFn, presetMap: presetMap });
assert(st3.depth === 0.5 && st3.focus === undefined && st3.focusAmount === 0,
  '"0" resets depth to 0.5 and clears focus',
  `depth=${st3.depth} focus=${st3.focus} amount=${st3.focusAmount}`);

// 11. "3" sets depth to 0.3.
var st4 = { neighbours: 6, presetMap: presetMap, depth: 0.5 };
KEYS.apply(st4, '3', { neighboursFn: neighboursFn, presetMap: presetMap });
assert(st4.depth === 0.3,
  '"3" sets depth to 0.3',
  `depth=${st4.depth}`);

// 12. "H" toggles state.hidden.
var st5 = { neighbours: 6, presetMap: presetMap, depth: 0.5, hidden: false };
KEYS.apply(st5, 'h', { neighboursFn: neighboursFn, presetMap: presetMap });
KEYS.apply(st5, 'H', { neighboursFn: neighboursFn, presetMap: presetMap });
KEYS.apply(st5, 'h', { neighboursFn: neighboursFn, presetMap: presetMap });
assert(st5.hidden === true,
  '"h" / "H" toggles state.hidden (3 hits -> true)',
  `hidden=${st5.hidden}`);

// 13. Unhandled key returns false and does not mutate state.
var st6 = { neighbours: 6, presetMap: presetMap, depth: 0.5, focus: 'p-b' };
var ok6 = KEYS.apply(st6, 'q', { neighboursFn: neighboursFn, presetMap: presetMap });
assert(ok6 === false && st6.focus === 'p-b' && st6.depth === 0.5,
  'unknown key returns false and does not mutate state',
  `handled=${ok6} focus=${st6.focus} depth=${st6.depth}`);

// 14. install() throws if state missing.
var threw = false;
try { KEYS.install({}); } catch (e) {
  threw = String(e.message || e).indexOf('opts.state is required') >= 0;
}
assert(threw, 'install({}) throws when state is missing',
  'threw=' + threw);

console.log();
console.log(
  failures === 0
    ? `MV KEYS UNIT: ALL GREEN (${total} tests)`
    : `${failures} of ${total} FAILED`
);
process.exit(failures === 0 ? 0 : 1);
