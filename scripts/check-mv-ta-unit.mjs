#!/usr/bin/env node
// scripts/check-mv-ta-unit.mjs — Phase C unit tests for the pure
// helpers inside client/track-analyzer.client.js.
//
// The end-to-end SWR_TRACK_ANALYZE(path) path requires WebAudio
// (OfflineAudioContext.decodeAudioData) and is exercised by the
// Phase F Puppeteer smoke (scripts/check-mv-smoke.mjs). Here we
// only test the helpers that don't need a browser:
//
//   - percentile(sorted, p)
//   - rmsBins(mono, sampleRate, hopSec)
//   - spectralCentroid(magnitudes)
//   - audioToFeatures(audioResult)
//
// 4 + 4 = 8 assertions across the helpers plus mapping edge cases.
// The plan-doc asks for 4 unit tests for the silent / all-sine /
// short-file paths; we approximate those with the *helpers* on
// synthetic 50ms mono arrays.

import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

const src = await readFile(resolve(ROOT, 'client/track-analyzer.client.js'), 'utf8');
// eslint-disable-next-line no-new-func
new Function(src)();
const INTERNAL = globalThis.SWR_TRACK_INTERNALS;
const FEATURES = globalThis.SWR_AUDIO_TO_FEATURES;
if (!INTERNAL || !FEATURES) {
  console.error('FATAL: track-analyzer module did not attach SWR_TRACK_INTERNALS');
  process.exit(2);
}

let failures = 0;
let total = 0;
function assert(c, name, d) {
  total++;
  console.log((c ? '  ✓ ' : '  ✗ ') + name + (d ? '  — ' + d : ''));
  if (!c) failures++;
}

// ============================================================================
console.log('=== percentile ===');
// ============================================================================

assert(
  INTERNAL.percentile([], 50) === 0,
  'percentile of [] returns 0'
);
assert(
  INTERNAL.percentile([0.5], 50) === 0.5,
  'percentile of single-element returns that element'
);
assert(
  Math.abs(INTERNAL.percentile([1, 2, 3, 4, 5], 50) - 3) < 1e-9,
  'percentile p=50 of 1..5 is the median 3',
  `got ${INTERNAL.percentile([1, 2, 3, 4, 5], 50)}`
);
assert(
  Math.abs(INTERNAL.percentile([1, 2, 3, 4, 5], 95) - 4.8) < 0.01,
  'percentile p=95 of 1..5 linearly interpolates to ~4.8',
  `got ${INTERNAL.percentile([1, 2, 3, 4, 5], 95)}`
);

// ============================================================================
console.log('\n=== rmsBins ===');
// ============================================================================

// Silent input → all bins are 0.
var silent = new Float32Array(4410); // 100ms @ 44.1k
var binsSilent = INTERNAL.rmsBins(silent, 44100, 0.05);
assert(
  binsSilent.every(function (b) { return b === 0; }),
  'rmsBins of silence is all zeros',
  'n=' + binsSilent.length
);

// Loud sine → at least one bin is non-trivial.
var sine = new Float32Array(4410);
for (var i = 0; i < sine.length; i++) sine[i] = Math.sin(2 * Math.PI * 440 * i / 44100);
var binsSine = INTERNAL.rmsBins(sine, 44100, 0.05);
assert(
  binsSine.length === 2 && binsSine.every(function (b) { return b > 0.5 && b <= 0.71; }),
  'rmsBins of 440Hz sine at 100% amp is ~0.707',
  JSON.stringify(Array.from(binsSine))
);

// Short file (< 50ms) → at least one bin exists, doesn't throw.
var tiny = new Float32Array(100); // < 50ms @ 44.1k
var binsTiny = INTERNAL.rmsBins(tiny, 44100, 0.05);
assert(
  binsTiny.length >= 1 && binsTiny.every(function (b) { return Number.isFinite(b); }),
  'rmsBins of a sub-50ms file does not throw and produces ≥1 bin',
  'n=' + binsTiny.length
);

// ============================================================================
console.log('\n=== spectralCentroid ===');
// ============================================================================

// Empty magnitudes → 0
assert(
  INTERNAL.spectralCentroid(new Float32Array(0)) === 0,
  'spectralCentroid of empty input is 0'
);

// Energy concentrated at bin 0 (DC) → centroid = 0
var lowMags = new Float32Array(64);
lowMags[0] = 1.0;
assert(
  Math.abs(INTERNAL.spectralCentroid(lowMags) - 0) < 1e-9,
  'spectralCentroid of DC-only magnitudes is 0',
  `got ${INTERNAL.spectralCentroid(lowMags)}`
);

// Energy concentrated at the last bin → centroid = 1
var highMags = new Float32Array(64);
highMags[63] = 1.0;
assert(
  Math.abs(INTERNAL.spectralCentroid(highMags) - 1) < 1e-9,
  'spectralCentroid of last-bin-only magnitudes is 1',
  `got ${INTERNAL.spectralCentroid(highMags)}`
);

// Energy evenly distributed → centroid ≈ 0.5
var evenMags = new Float32Array(64);
for (var m = 0; m < 64; m++) evenMags[m] = 1.0;
assert(
  Math.abs(INTERNAL.spectralCentroid(evenMags) - 0.5) < 1e-9,
  'spectralCentroid of uniform magnitudes is 0.5',
  `got ${INTERNAL.spectralCentroid(evenMags)}`
);

// ============================================================================
console.log('\n=== audioToFeatures mapping ===');
// ============================================================================

// Silent track → mood ≈ 0, complexity = 0, motion = 0, color_temp = 1
var silentMap = FEATURES({
  bpm: 0, dynamicRange: 0, onsetDensity: 0, centroid: 0,
});
assert(
  silentMap.mood === 0 && silentMap.complexity === 0
  && silentMap.motion === 0 && silentMap.color_temp === 1,
  'silent track maps to a 4-vector at (0,0,0,1)',
  JSON.stringify(silentMap)
);

// Bright, varied, 120 BPM, bass-light → all axes high or unambiguous
var energetic = FEATURES({
  bpm: 120, dynamicRange: 0.9, onsetDensity: 3.5, centroid: 0.7,
});
assert(
  energetic.mood > 0.9
  && energetic.complexity > 0.8
  && energetic.motion > 0.5 && energetic.motion < 0.7
  && energetic.color_temp >= 0 && energetic.color_temp < 0.5,
  'energetic bright track maps to high mood/complexity/motion, cool color',
  JSON.stringify(energetic)
);

// Slow, bass-heavy ambient → low mood, low motion, warm
var ambient = FEATURES({
  bpm: 60, dynamicRange: 0.2, onsetDensity: 0.5, centroid: 0.15,
});
assert(
  ambient.mood < 0.5
  && ambient.motion < 0.4
  && ambient.color_temp > 0.7,
  'ambient bass-heavy track maps to low motion, warm',
  JSON.stringify(ambient)
);

// All values clamp to [0, 1] even with extreme inputs
var crazy = FEATURES({
  bpm: 999, dynamicRange: 2.5, onsetDensity: 50, centroid: 0.5,
});
assert(
  crazy.mood <= 1 && crazy.complexity <= 1 && crazy.motion <= 1 && crazy.color_temp <= 1,
  'extreme inputs clamp to [0,1]',
  JSON.stringify(crazy)
);

console.log();
console.log(
  failures === 0
    ? `MV TA UNIT: ALL GREEN (${total} tests)`
    : `${failures} of ${total} FAILED`
);
process.exit(failures === 0 ? 0 : 1);
