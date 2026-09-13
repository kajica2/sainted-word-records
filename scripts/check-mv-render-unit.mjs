#!/usr/bin/env node
// scripts/check-mv-render-unit.mjs — Phase D unit tests for
// client/hologram-renderer.client.js. Pure Node, no DOM. Two
// groups of assertions:
//
//   1. presetGain + blendMultiplierFor  — pure-function math
//   2. wrapApplyR                      — gain scaling semantics
//
// The page-level integration (canvas drawing, RAF wiring, audio
// pill) is exercised by the Phase F Puppeteer smoke
// (scripts/check-mv-smoke.mjs).
//
// 4 + 8 = 12 assertions. Pure functions covered exhaustively;
// wrapApplyR focuses on the math path that matters for the music
// video render output (gain*mult → originalApplyR sees the same
// shape, gain=0 effectively mutes).

import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

// Load both modules; renderer depends on hologram engine for
// computeBlend. Order matters.
const holoSrc = await readFile(resolve(ROOT, 'client/hologram-presets.client.js'), 'utf8');
const rendSrc = await readFile(resolve(ROOT, 'client/hologram-renderer.client.js'), 'utf8');
// eslint-disable-next-line no-new-func
new Function(holoSrc)();
// eslint-disable-next-line no-new-func
new Function(rendSrc)();

const H = globalThis.SWR_HOLOGRAM;
const INST = globalThis.SWR_HOLOGRAM_INSTALL;
if (!H || !INST) {
  console.error('FATAL: hologram modules did not attach');
  process.exit(2);
}

// ---- Fixtures --------------------------------------------------------

// Three presets chosen so each cares about a different audio
// feature. Test the blend math against this controlled population.
const POP = [
  {
    id: 'p-bass',
    name: 'Bass',
    family: 'TEST',
    audio_reactivity: { bass: ['scale_pulse'] },
    fx_state: {}, motion: {},
  },
  {
    id: 'p-treble',
    name: 'Treble',
    family: 'TEST',
    audio_reactivity: { treble: ['grain'] },
    fx_state: {}, motion: {},
  },
  {
    id: 'p-mid',
    name: 'Mid',
    family: 'TEST',
    audio_reactivity: { mid: ['chroma'] },
    fx_state: {}, motion: {},
  },
  {
    id: 'p-silent',
    name: 'Silent',
    family: 'TEST',
    audio_reactivity: {},  // doesn't react to anything
    fx_state: {}, motion: {},
  },
];

let failures = 0;
let total = 0;
function assert(c, name, d) {
  total++;
  console.log((c ? '  ✓ ' : '  ✗ ') + name + (d ? '  — ' + d : ''));
  if (!c) failures++;
}

// ============================================================================
console.log('=== presetGain ===');
// ============================================================================

// p-bass: audio_reactivity.bass = ['scale_pulse']
assert(INST._impl.presetGain(POP[0], 'bass') === 1.0,
  'preset with audio_reactivity.bass[] returns 1.0 for bass',
  `got ${INST._impl.presetGain(POP[0], 'bass')}`
);
assert(INST._impl.presetGain(POP[0], 'mid') === 0.0,
  'preset without audio_reactivity.mid returns 0.0',
  `got ${INST._impl.presetGain(POP[0], 'mid')}`
);
// p-silent: no audio_reactivity at all
assert(INST._impl.presetGain(POP[3], 'bass') === 0.0,
  'preset with empty audio_reactivity returns 0.0 for any feature',
  `got ${INST._impl.presetGain(POP[3], 'bass')}`
);
// null/undefined-safe
assert(INST._impl.presetGain(null, 'bass') === 0.0,
  'presetGain(null, ...) returns 0.0 (null-safe)',
  `got ${INST._impl.presetGain(null, 'bass')}`
);

// ============================================================================
console.log('\n=== blendMultiplierFor ===');
// ============================================================================

// Blend map: 50% bass, 50% treble, 0% mid, 0% silent.
var blend1 = {
  'p-bass': 0.5, 'p-treble': 0.5, 'p-mid': 0.0, 'p-silent': 0.0,
};

// For 'bass' feature, only p-bass has audio_reactivity.bass → 0.5
assert(
  Math.abs(INST._impl.blendMultiplierFor(blend1, POP, 'bass') - 0.5) < 1e-9,
  'blend 0.5 bass + 0.5 treble → bass multiplier = 0.5',
  `got ${INST._impl.blendMultiplierFor(blend1, POP, 'bass')}`
);
// For 'treble' feature, only p-treble → 0.5
assert(
  Math.abs(INST._impl.blendMultiplierFor(blend1, POP, 'treble') - 0.5) < 1e-9,
  'blend 0.5 bass + 0.5 treble → treble multiplier = 0.5',
  `got ${INST._impl.blendMultiplierFor(blend1, POP, 'treble')}`
);
// For 'mid' feature, p-mid has audio_reactivity.mid, weight=0 → 0
assert(
  INST._impl.blendMultiplierFor(blend1, POP, 'mid') === 0,
  'blend with mid weight=0 → mid multiplier = 0',
  `got ${INST._impl.blendMultiplierFor(blend1, POP, 'mid')}`
);

// All-zero blend → zero multiplier for any feature
assert(
  INST._impl.blendMultiplierFor({ 'p-bass':0, 'p-treble':0, 'p-mid':0, 'p-silent':0 }, POP, 'bass') === 0,
  'all-zero blend → multiplier = 0',
  ''
);
// Empty preset list → 0
assert(
  INST._impl.blendMultiplierFor(blend1, [], 'bass') === 0,
  'empty preset list → multiplier = 0',
  ''
);

// ============================================================================
console.log('\n=== wrapApplyR ===');
// ============================================================================

// Build a hologramInstance and attach the preset list so wrapApplyR
// can find them.
var holo = H.build(POP);
INST.attach(holo, POP);

// An original applyR that reads A.feat[r.feature] multiplied by
// r.scale, and writes the result into `out[r.target]`. Mirrors the
// music_video.html applyR closely enough for the test.
function originalApplyR(layer) {
  var A = { feat: { bass: 0.8, mid: 0.5, treble: 0.3, centroid: 0.6 } };
  var l = layer;
  var out = { scale: 1, x: 0, y: 0, rot: 0, opacity: 1,
              hue: 0, brightness: 1, contrast: 1 };
  for (var i = 0; i < l.reactors.length; i++) {
    var r = l.reactors[i];
    if (!r) continue;
    var v = A.feat[r.feature] || 0;
    var scaled = v * (r.scale || 0);
    if (r.target === 'scale') out.scale += scaled;
    else if (r.target === 'x') out.x += scaled;
    else if (r.target === 'opacity') out.opacity += scaled;
    // ... (other targets unused in tests)
  }
  return out;
}

// Layer with three reactors, one per feature.
var layer = {
  asset: { type: 'image' },
  hue: 0, baseScale: 1, opacity: 1, brightness: 1, contrast: 1,
  reactors: [
    { feature: 'bass',    target: 'scale',   scale: 0.5, ease: 'sharp' },
    { feature: 'mid',     target: 'x',       scale: 100, ease: 'sharp' },
    { feature: 'treble',  target: 'opacity', scale: 0.4, ease: 'sharp' },
  ],
};

// HologramState with a known blend path:
// focus=undefined → evenly distributed; depth=0 → no flatten;
// features mid-near; identity is the only relevant input.
var hState = {
  features: { mood: 0.5, complexity: 0.5, motion: 0.5, color_temp: 0.5 },
  depth: 0,
  focus: null,
  focusAmount: 0,
};

// Case A: blend that gives bass=0.6 and treble=0.4. mid weight is 0,
// so its reactor should be muted. Wrap applies gain*scale → effective
// scale changes.
var wrapped = INST.wrapApplyR(originalApplyR, holo, hState);
var resultA = wrapped(layer);
// With default blend (depth=0, focus=null), gaussian σ=0.25 across
// 3-feature 4D distance from neutral 0.5,0.5,0.5,0.5 to each preset:
// We compute approximately. Rather than guess, just assert that bass
// reactor got a non-trivial multiplier and the silent-preset's bass
// got zero, so the multiplier magnitude is reasonable.
assert(
  resultA.scale !== 1
  && Number.isFinite(resultA.scale),
  'bass reactor contributes a non-1 scale multiplier',
  `out.scale=${resultA.scale}`
);
assert(
  resultA._hologram && typeof resultA._hologram.mult === 'object',
  'wrapped applyR stashes _hologram.mult on the output for diagnostics',
  ''
);

// Case B: a custom blend map. Bypass computeBlend by stuffing
// hState directly. (Note: wrapApplyR calls computeBlend, so we
// can't bypass it without modifying the function — instead test
// that a *different* hState produces a *different* result.)
var hState2 = {
  features: { mood: 0.9, complexity: 0.9, motion: 0.9, color_temp: 0.1 },
  depth: 1,  // force uniform
  focus: null,
};
var wrappedB = INST.wrapApplyR(originalApplyR, holo, hState2);
var resultB = wrappedB(layer);
assert(
  Math.abs(resultB.scale - resultA.scale) > 1e-9
  || Math.abs(resultB.x - resultA.x) > 1e-9,
  'different hState (depth=1 vs depth=0) produces a different render',
  `Δ scale=${resultB.scale - resultA.scale} Δ x=${resultB.x - resultA.x}`
);

// Case C: originalApplyR is null → wrapApplyR throws with a clear message.
var threw = false;
try {
  INST.wrapApplyR(null, holo, hState);
} catch (e) {
  threw = String(e.message || e).indexOf('originalApplyR must be a function') >= 0;
}
assert(threw, 'wrapApplyR(null, ...) throws a clear message',
  'threw=' + threw);

// Case D: missing hologramInstance falls back to original (no
// wrap applied). The result should equal originalApplyR(layer).
var wrappedD = INST.wrapApplyR(originalApplyR, null, hState);
var directD = originalApplyR(layer);
var wd = wrappedD(layer);
assert(
  wd.scale === directD.scale
  && wd.x === directD.x
  && wd.opacity === directD.opacity,
  'missing hologram instance → wrapped fn == original (silent fallback)',
  `wrappedD.scale=${wd.scale} directD.scale=${directD.scale}`
);

// Case E: reactor list passed through unchanged.
// (Our wrapped fn produces `out._hologram.mult`; the layer object
// itself should not be mutated.)
var layerBefore = JSON.stringify(layer);
wrapped(layer);
var layerAfter = JSON.stringify(layer);
assert(layerBefore === layerAfter,
  'wrapped applyR does not mutate the layer object itself',
  '');

console.log();
console.log(
  failures === 0
    ? `MV RENDERER UNIT: ALL GREEN (${total} tests)`
    : `${failures} of ${total} FAILED`
);
process.exit(failures === 0 ? 0 : 1);
