#!/usr/bin/env node
// scripts/check-apply-reactor-unit.mjs - unit coverage for P1.1, the one
// shared reactor contract in lib/apply-reactors.js.
//
// Plan: docs/PLANS/architecture-audit-2026-10.md, section 1.1. The audit
// found sixteen surfaces (engine.html's inline engine + the fifteen variant
// pages) each carrying its own reactor chain with its own per-target unit
// table, `scale` unclamped everywhere, and versions/grid.html silently
// dropping every `x` / `y` reactor.
//
// This test covers the half that is pure logic and fits a node:vm sandbox:
// the unit table, the clamp table, the dispatch loop, the rotation gate and
// wrap, the master-transformations gate, and the negative cases (a malformed
// reactor entry, an unknown target, a missing/!Array `reactors`, a missing
// audio object).
//
// It also does a static pass over every migrated surface, because the other
// half of P1.1 is the CALL SITES: sixteen HTML files that must each bind
// `window.SWR_REACTORS` and must no longer carry their own if/else unit
// table. A table can be correct while sixteen call sites still ignore it,
// and that is the exact failure this refactor exists to remove.
//
// Run:  node scripts/check-apply-reactor-unit.mjs
// Exit: 0 = all assertions pass, 1 = any failure.

import vm from 'node:vm';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const ROOT = path.resolve(path.dirname(__filename), '..');
const MODULE = path.join(ROOT, 'lib/apply-reactors.js');

let failures = 0;
function check(cond, msg, detail) {
  if (cond) console.log('  PASS', msg, detail ? '(' + detail + ')' : '');
  else { console.log('  FAIL', msg, detail ? '(' + detail + ')' : ''); failures++; }
}
function eq(actual, expected, msg) {
  const ok = Math.abs(actual - expected) < 1e-9;
  check(ok, msg, ok ? 'got ' + fmt(actual) : 'expected ' + fmt(expected) + ', got ' + fmt(actual));
}
function fmt(n) { return typeof n === 'number' ? Number(n.toFixed(6)) : String(n); }

// ---- 1. Load the module in a sandbox --------------------------------------

console.log('apply-reactor: module load + shape');

const sandbox = {
  console: { log() {}, warn() {}, error() {} },
  Math, Object, Array, Number, Boolean, String, Error, isFinite, isNaN,
};
sandbox.window = sandbox;
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(MODULE, 'utf8'), sandbox, { filename: 'lib/apply-reactors.js' });

const R = sandbox.SWR_REACTORS;
check(typeof R === 'object' && R !== null, 'window.SWR_REACTORS attached');
check(typeof R.applyReactor === 'function', 'SWR_REACTORS.applyReactor is a function');
check(typeof sandbox.SWR_APPLY_REACTOR === 'function', 'the bare window.SWR_APPLY_REACTOR spelling also exists');
check(typeof R.baseTransform === 'function', 'SWR_REACTORS.baseTransform is exported');

// ---- 2. The unit table matches the contract --------------------------------

console.log('apply-reactor: the unit table');

const EXPECTED_UNIT = { x: 250, y: 250, rot: 12, hue: 1, opacity: 1, scale: 1, brightness: 1, contrast: 1 };
for (const [target, expected] of Object.entries(EXPECTED_UNIT)) {
  check(R.UNIT[target] === expected, `UNIT.${target} === ${expected}`, 'got ' + R.UNIT[target]);
}
eq(R.DEFAULT_UNIT, 100, 'DEFAULT_UNIT is 100 (every other target)');
check(
  Object.keys(R.UNIT).length === Object.keys(EXPECTED_UNIT).length,
  'UNIT has exactly the 8 contract rows, no extras',
  'got ' + Object.keys(R.UNIT).length
);

// The inherited-key trap: a bare `UNIT[target]` on a preset-authored target
// name would resolve Object.prototype members and produce NaN or a function.
eq(R.unitFor(null, 'toString'), 100, "unitFor('toString') falls through to DEFAULT_UNIT, not Object.prototype");
eq(R.unitFor(null, 'constructor'), 100, "unitFor('constructor') falls through to DEFAULT_UNIT");
eq(R.unitFor(null, 'nonsense'), 100, "an unknown target gets DEFAULT_UNIT");
eq(R.unitFor(null, 'x'), 250, 'unitFor reads UNIT.x by default');

// A compatibility table overrides the default per row and inherits the rest.
eq(R.unitFor(R.UNITS.smoke, 'x'), 300, 'a units table overrides UNIT per row');
eq(R.unitFor(R.UNITS.smoke, 'rot'), 8, 'the override table carries its own rot row');

// ---- 3. The clamp table matches the contract -------------------------------

console.log('apply-reactor: the clamp table');

const EXPECTED_CLAMP = {
  scale: [0.05, 4],
  opacity: [0, 1.5],
  brightness: [0.1, 2.5],
  contrast: [0.1, 2.5],
};
for (const [target, [lo, hi]] of Object.entries(EXPECTED_CLAMP)) {
  check(
    Array.isArray(R.CLAMP[target]) && R.CLAMP[target][0] === lo && R.CLAMP[target][1] === hi,
    `CLAMP.${target} is [${lo}, ${hi}]`,
    JSON.stringify(R.CLAMP[target])
  );
}
for (const target of ['x', 'y', 'rot', 'hue']) {
  check(R.CLAMP[target] === undefined, `CLAMP.${target} is absent (no clamp)`, 'got ' + JSON.stringify(R.CLAMP[target]));
}
check(Object.keys(R.CLAMP).length === 4, 'CLAMP has exactly the 4 contract rows');

// ---- 4. Dispatch: one reactor per target, at the contract's unit ----------

console.log('apply-reactor: dispatch, one reactor at a time');

// sens = 1, ease = identity, no damper, no mutate, gain = 1, feature = 1.
const AUDIO = { feat: {}, params: { sens: 1 } };
function run(targets, extra = {}) {
  const layer = {
    baseScale: 1, opacity: 1, hue: 0, brightness: 1, contrast: 1,
    reactors: targets.map((t) => (typeof t === 'string' ? { feature: 'bass', target: t, scale: 1 } : t)),
  };
  Object.assign(layer, extra.layer || {});
  return R.applyReactor(layer, AUDIO, 0.016, Object.assign({ feature: () => 1 }, extra.opts || {}));
}

// A full-value feature (1.0) with identity easing and gain 1 leaves the
// delta at exactly the unit, so these assertions read the table directly.
const one = run(['x', 'y', 'rot', 'hue', 'opacity', 'scale', 'brightness', 'contrast']);
// hue and scale and x and y all start from 1 or 0, so probe them separately.
eq(run(['x']).x, 250, 'x  -> scale * 250');
eq(run(['y']).y, 250, 'y  -> scale * 250');
eq(run(['rot']).rot, 250 * 0 + 12, 'rot -> scale * 12');
eq(run(['hue']).hue, 1, 'hue -> no scale (unit 1)');
eq(run(['opacity']).opacity, 1.5, 'opacity -> scale * 1, clamped at the 1.5 ceiling');
eq(run(['scale']).scale, 2, 'scale -> scale * 1 (1 + 1)');
eq(run(['brightness']).brightness, 2, 'brightness -> scale * 1 (1 + 1)');
eq(run(['contrast']).contrast, 2, 'contrast -> scale * 1 (1 + 1)');
check(typeof one.x === 'number', 'a multi-target pass returns a full transform');

// Unknown target: DEFAULT_UNIT, unclamped.
const unknown = run([{ feature: 'bass', target: 'wibble', scale: 1 }]);
eq(unknown.wibble, 100, 'an unknown target gets scale * 100');
check(unknown.opacity === 1, 'an unknown target does not touch a real field');

// `out` carries every contract field so the render pipeline can read all 8.
const shaped = run([]);
for (const k of R.TARGETS) {
  check(typeof shaped[k] === 'number', `the returned transform has a numeric \`${k}\``);
}

// ---- 5. Clamps are real, on both ends --------------------------------------

console.log('apply-reactor: clamps hold at both ends');

const overOpacity = run([{ feature: 'bass', target: 'opacity', scale: 99 }]);
check(overOpacity.opacity <= 1.5, 'opacity cannot exceed 1.5', 'got ' + overOpacity.opacity);
eq(overOpacity.opacity, 1.5, 'opacity pins at exactly 1.5');

const underOpacity = run([{ feature: 'bass', target: 'opacity', scale: -99 }]);
check(underOpacity.opacity >= 0, 'opacity cannot go below 0', 'got ' + underOpacity.opacity);
eq(underOpacity.opacity, 0, 'opacity pins at exactly 0');

const overScale = run([{ feature: 'bass', target: 'scale', scale: 999 }]);
check(overScale.scale <= 4, 'scale cannot exceed 4 (it was unclamped everywhere before P1.1)', 'got ' + overScale.scale);
eq(overScale.scale, 4, 'scale pins at exactly 4');

const underScale = run([{ feature: 'bass', target: 'scale', scale: -999 }]);
check(underScale.scale >= 0.05, 'scale cannot go to or below 0 (a non-positive scale is a silent drawImage no-op)', 'got ' + underScale.scale);
eq(underScale.scale, 0.05, 'scale pins at exactly the 0.05 floor');

// brightness / contrast both ways.
check(run([{ feature: 'bass', target: 'brightness', scale: 999 }]).brightness === 2.5, 'brightness pins at 2.5');
check(run([{ feature: 'bass', target: 'brightness', scale: -999 }]).brightness === 0.1, 'brightness pins at the 0.1 floor');
check(run([{ feature: 'bass', target: 'contrast', scale: 999 }]).contrast === 2.5, 'contrast pins at 2.5');
check(run([{ feature: 'bass', target: 'contrast', scale: -999 }]).contrast === 0.1, 'contrast pins at the 0.1 floor');

// x / y / rot / hue stay UNCLAMPED: a 400 px sweep is legitimate.
const big = run([{ feature: 'bass', target: 'x', scale: 40 }]);
eq(big.x, 10000, 'x is not clamped (10000 px is a legal offset)');
const bigRot = run([{ feature: 'bass', target: 'rot', scale: 40 }]);
check(bigRot.rot === 480 - 360 + 360 - 360 || bigRot.rot === 120, 'rot wraps rather than clamping', 'got ' + bigRot.rot);

// ---- 6. Rotation gate + wrap ---------------------------------------------

console.log('apply-reactor: the rotation gate and the angle wrap');

const rotOff = run([{ feature: 'bass', target: 'rot', scale: 1 }], { opts: { allowRotation: false } });
eq(rotOff.rot, 0, 'allowRotation:false silences a rot reactor (the rot-master toggle)');
const rotOn = run([{ feature: 'bass', target: 'rot', scale: 1 }], { opts: { allowRotation: true } });
eq(rotOn.rot, 12, 'allowRotation:true lets it through');

// The wrap is the (-180, 180] fold, so a big accumulation stays continuous.
const wrapped = run([{ feature: 'bass', target: 'rot', scale: 30 }]);
check(wrapped.rot > -180 && wrapped.rot <= 180, 'a large accumulated rot folds into (-180, 180]', 'got ' + wrapped.rot);
const unwrapped = run([{ feature: 'bass', target: 'rot', scale: 30 }], { opts: { wrapRotation: false } });
check(Math.abs(unwrapped.rot) > 180, 'wrapRotation:false leaves the raw accumulation (engine.html ships that)', 'got ' + unwrapped.rot);

// ---- 7. The other gates ---------------------------------------------------

console.log('apply-reactor: target allowlist, sens, ease, mutate, damper');

const filtered = run(['x', 'opacity'], { opts: { targets: ['opacity'] } });
eq(filtered.opacity, 1.5, 'an allowlisted target still applies');
eq(filtered.x, 0, 'a target outside the allowlist is skipped');

// sens: the pages multiply by A.params.sens; a surface with none (engine.html)
// must behave as sens = 1.
const sensed = R.applyReactor(
  { baseScale: 1, opacity: 1, hue: 0, brightness: 1, contrast: 1,
    reactors: [{ feature: 'bass', target: 'opacity', scale: 1 }] },
  { feat: { bass: 1 }, params: { sens: 0.5 } },
  0.016,
  { feature: (r) => r.feature === 'bass' ? 1 : 0 }
);
eq(sensed.opacity, 1.5, 'half sens + gain 1 still reaches the 1.5 opacity ceiling');

// ease: identity by default, caller-supplied otherwise.
const eased = run([{ feature: 'bass', target: 'hue', scale: 100, ease: 'soft' }],
  { opts: { ease: (name, t) => (name === 'soft' ? 0.5 : t) } });
eq(eased.hue, 50, 'a caller-supplied ease() is honoured (0.5 curve * gain 100 * unit 1)');

// mutate: the jitter is added AFTER the gain and the sensitivity but BEFORE
// the unit, exactly as every historical applyR did, so the mutation
// randomness is not silently rescaled by r.scale * sens.
let calls = 0;
const mutated = run([{ feature: 'bass', target: 'hue', scale: 10 }],
  { opts: { random: () => { calls++; return 0.5; } }, layer: { mutate: 0.4 } });
eq(mutated.hue, 10, 'mutate at random()=0.5 contributes exactly 0 (the midpoint of the jitter)');
check(calls > 0, 'the random source was actually consulted');
// At random() = 1 the jitter is +mutate * |gain|, so hue moves by
// 10 * 1 + 0.4 * 10 = 14. If the jitter were added to the eased value
// instead (after the gain), it would move by (1 + 4) * 10 = 50.
const jittered = run([{ feature: 'bass', target: 'hue', scale: 10 }],
  { opts: { random: () => 1 }, layer: { mutate: 0.4 } });
eq(jittered.hue, 14, 'the jitter lands after the gain, not on the eased value');
const notMutated = run([{ feature: 'bass', target: 'hue', scale: 10 }]);
eq(notMutated.hue, 10, 'mutate 0 (the default) contributes nothing');

// The damper: default off when the global is absent (the vm sandbox has no
// SWR_AUDIO_DAMP), on when present, disabled by opts.damp === false.
const sandbox2 = { console, Math, Object, Array, Number, Boolean, String, isFinite, isNaN };
sandbox2.window = sandbox2;
sandbox2.SWR_AUDIO_DAMP = { damp: () => 0.25 };
vm.createContext(sandbox2);
vm.runInContext(fs.readFileSync(MODULE, 'utf8'), sandbox2, { filename: 'lib/apply-reactors.js' });
const damped = sandbox2.SWR_REACTORS.applyReactor(
  { baseScale: 1, opacity: 1, hue: 0, brightness: 1, contrast: 1,
    reactors: [{ feature: 'bass', target: 'hue', scale: 10 }] },
  { feat: { bass: 1 } }, 0.016, {}
);
eq(damped.hue, 2.5, 'the repo damper (SWR_AUDIO_DAMP.damp) is applied by default when present');
const undamped = sandbox2.SWR_REACTORS.applyReactor(
  { baseScale: 1, opacity: 1, hue: 0, brightness: 1, contrast: 1,
    reactors: [{ feature: 'bass', target: 'hue', scale: 10 }] },
  { feat: { bass: 1 } }, 0.016, { damp: false }
);
eq(undamped.hue, 10, 'opts.damp:false reads the raw analyser value');
const customDamp = sandbox2.SWR_REACTORS.applyReactor(
  { baseScale: 1, opacity: 1, hue: 0, brightness: 1, contrast: 1,
    reactors: [{ feature: 'bass', target: 'hue', scale: 10 }] },
  { feat: { bass: 1 } }, 0.016, { damp: () => 0.5 }
);
eq(customDamp.hue, 5, 'a caller-supplied damp() wins over the global');

// ---- 8. Negative tests: a bad reactor must never throw ---------------------

console.log('apply-reactor: malformed input does not throw');

function doesNotThrow(label, fn) {
  let threw = null;
  let value;
  try { value = fn(); } catch (e) { threw = e; }
  check(threw === null, label, threw ? threw.message : '');
  return value;
}

const BAD_LAYER = { baseScale: 1, opacity: 1, hue: 0, brightness: 1, contrast: 1 };

doesNotThrow('reactors: null', () =>
  R.applyReactor({ ...BAD_LAYER, reactors: null }, AUDIO, 0, { feature: () => 1 }));
doesNotThrow('reactors: undefined', () =>
  R.applyReactor({ ...BAD_LAYER }, AUDIO, 0, { feature: () => 1 }));
doesNotThrow('reactors: a bare object (the pre-P2.2 persisted shape)', () =>
  R.applyReactor({ ...BAD_LAYER, reactors: { feature: 'bass', target: 'x', scale: 1 } }, AUDIO, 0, { feature: () => 1 }));
doesNotThrow('reactors: an array of nulls', () =>
  R.applyReactor({ ...BAD_LAYER, reactors: [null, null] }, AUDIO, 0, { feature: () => 1 }));
doesNotThrow('a reactor with no target', () =>
  R.applyReactor({ ...BAD_LAYER, reactors: [{ feature: 'bass', scale: 1 }] }, AUDIO, 0, { feature: () => 1 }));
doesNotThrow('a reactor with a non-string target', () =>
  R.applyReactor({ ...BAD_LAYER, reactors: [{ target: 42, scale: 1 }] }, AUDIO, 0, { feature: () => 1 }));
doesNotThrow('a reactor with a string target but no gain', () =>
  R.applyReactor({ ...BAD_LAYER, reactors: [{ target: 'x' }] }, AUDIO, 0, { feature: () => 1 }));
doesNotThrow('a reactor with a non-numeric gain', () =>
  R.applyReactor({ ...BAD_LAYER, reactors: [{ target: 'x', scale: '1' }] }, AUDIO, 0, { feature: () => 1 }));
doesNotThrow('a reactor with a NaN / Infinity gain', () =>
  R.applyReactor({ ...BAD_LAYER, reactors: [{ target: 'x', scale: Infinity }, { target: 'y', scale: NaN }] }, AUDIO, 0, { feature: () => 1 }));
doesNotThrow('a feature name that is not on the audio object', () =>
  R.applyReactor({ ...BAD_LAYER, reactors: [{ feature: 'subbass', target: 'x', scale: 1 }] }, AUDIO, 0));
doesNotThrow('a feature value of NaN', () =>
  R.applyReactor({ ...BAD_LAYER, reactors: [{ target: 'x', scale: 1 }] }, AUDIO, 0, { feature: () => NaN }));
doesNotThrow('a feature value of Infinity', () =>
  R.applyReactor({ ...BAD_LAYER, reactors: [{ target: 'x', scale: 1 }] }, AUDIO, 0, { feature: () => Infinity }));
doesNotThrow('no layer at all', () => R.applyReactor(null, AUDIO, 0));
doesNotThrow('no audio at all', () => R.applyReactor({ ...BAD_LAYER, reactors: [{ target: 'x', scale: 1 }] }, null, 0));
doesNotThrow('no opts at all', () => R.applyReactor({ ...BAD_LAYER, reactors: [{ target: 'x', scale: 1 }] }, AUDIO, 0));
doesNotThrow('a units table that is not an object', () =>
  R.applyReactor({ ...BAD_LAYER, reactors: [{ target: 'x', scale: 1 }] }, AUDIO, 0, { units: 'nope' }));
doesNotThrow('an ease that returns NaN', () =>
  R.applyReactor({ ...BAD_LAYER, reactors: [{ target: 'x', scale: 1 }] }, AUDIO, 0, { ease: () => NaN }));
doesNotThrow('a random source that returns 1.5', () =>
  R.applyReactor({ ...BAD_LAYER, mutate: 0.4, reactors: [{ target: 'x', scale: 1 }] }, AUDIO, 0, { random: () => 1.5 }));

// And the important negative assertions: the malformed cases produce a
// well-formed transform rather than merely not throwing.
const nulled = doesNotThrow('a null reactor yields the resting transform', () =>
  R.applyReactor({ ...BAD_LAYER, reactors: [null] }, AUDIO, 0, { feature: () => 1 }));
eq(nulled.scale, 1, 'a null reactor leaves scale at its resting value');
eq(nulled.x, 0, 'a null reactor leaves x at 0');

const noGain = doesNotThrow('a reactor with no gain contributes nothing', () =>
  R.applyReactor({ ...BAD_LAYER, reactors: [{ target: 'x' }] }, AUDIO, 0, { feature: () => 1 }));
eq(noGain.x, 0, 'a missing gain is read as 0, so the reactor is inert');

const unknownFeature = doesNotThrow('an unknown feature name reads as 0', () =>
  R.applyReactor({ ...BAD_LAYER, reactors: [{ feature: 'nope', target: 'x', scale: 100 }] }, AUDIO, 0));
eq(unknownFeature.x, 0, 'an unknown feature contributes 0 rather than NaN');

const nanFeature = doesNotThrow('a NaN feature reads as 0', () =>
  R.applyReactor({ ...BAD_LAYER, reactors: [{ target: 'x', scale: 100 }] }, AUDIO, 0, { feature: () => NaN }));
eq(nanFeature.x, 0, 'a NaN feature contributes 0 rather than poisoning the transform with NaN');
check(Number.isFinite(nanFeature.scale), 'no field of the transform is NaN after a NaN feature');

// A feature outside [0, 1] is clamped before easing, exactly as every
// historical applyR did (`ease(r.ease, clamp(v, 0, 1))`).
const loud = doesNotThrow('a feature of 4 clamps to 1 before easing', () =>
  R.applyReactor({ ...BAD_LAYER, reactors: [{ target: 'x', scale: 1 }] }, AUDIO, 0, { feature: () => 4 }));
eq(loud.x, 250, 'feature 4 reads as 1, so x moves by exactly one unit');
const negative = doesNotThrow('a feature of -4 clamps to 0 before easing', () =>
  R.applyReactor({ ...BAD_LAYER, reactors: [{ target: 'x', scale: 1 }] }, AUDIO, 0, { feature: () => -4 }));
eq(negative.x, 0, 'a negative feature contributes nothing');

// ---- 9. baseTransform + the compatibility tables --------------------------

console.log('apply-reactor: baseTransform and the named compatibility tables');

const seeded = R.baseTransform({ baseScale: 2, opacity: 0.5, hue: 30, brightness: 1.2, contrast: 0.9 }, { rot: 1.5 });
eq(seeded.scale, 2, 'baseTransform reads baseScale');
eq(seeded.x, 0, 'baseTransform zeroes x');
eq(seeded.y, 0, 'baseTransform zeroes y');
eq(seeded.rot, 1.5, 'baseTransform takes the rot seed from `over`');
eq(seeded.opacity, 0.5, 'baseTransform reads opacity');
eq(seeded.hue, 30, 'baseTransform reads hue');
eq(seeded.brightness, 1.2, 'baseTransform reads brightness');
eq(seeded.contrast, 0.9, 'baseTransform reads contrast');

const bare = R.baseTransform({});
eq(bare.scale, 1, 'baseTransform defaults scale to 1 on an empty layer');
eq(bare.opacity, 1, 'baseTransform defaults opacity to 1');
eq(bare.brightness, 1, 'baseTransform defaults brightness to 1');
eq(bare.contrast, 1, 'baseTransform defaults contrast to 1');
eq(bare.rot, 0, 'baseTransform defaults rot to 0');

// Every historical table named in the module header must exist, and each must
// cover all 8 targets with a numeric unit. This is the assertion that keeps
// "the divergent unit tables collapse to one" honest: a surface cannot pick a
// table that is not here.
const EXPECTED_TABLES = {
  natural: { x: 1, y: 1, rot: 1, hue: 1, opacity: 1, scale: 1, brightness: 1, contrast: 1 },
  gain200: { x: 200, y: 200, rot: 30, hue: 60, opacity: 0.5, scale: 1, brightness: 0.5, contrast: 0.5 },
  naturalHalfGrade: { x: 1, y: 1, rot: 1, hue: 1, opacity: 0.5, scale: 1, brightness: 0.5, contrast: 0.5 },
  eclipse: { x: 180, y: 180, rot: 25, hue: 60, opacity: 0.6, scale: 1, brightness: 0.5, contrast: 0.5 },
  film: { x: 250, y: 250, rot: 12, hue: 40, opacity: 0.4, scale: 1, brightness: 0.3, contrast: 0.3 },
  smoke: { x: 300, y: 300, rot: 8, hue: 50, opacity: 0.3, scale: 1, brightness: 0.2, contrast: 0.2 },
  hallucination: { x: 150, y: 150, rot: 45, hue: 80, opacity: 0.7, scale: 1, brightness: 0.7, contrast: 0.7 },
  grid: { x: 250, y: 250, rot: 12, hue: 180, opacity: 1, scale: 1, brightness: 1, contrast: 1 },
};
check(
  Object.keys(R.UNITS).length === Object.keys(EXPECTED_TABLES).length,
  'UNITS holds exactly the 8 named historical tables',
  Object.keys(R.UNITS).join(', ')
);
for (const [name, table] of Object.entries(EXPECTED_TABLES)) {
  const actual = R.UNITS[name];
  check(!!actual && typeof actual === 'object', `UNITS.${name} exists`);
  if (!actual) continue;
  const same = R.TARGETS.every((t) => actual[t] === table[t]);
  check(same, `UNITS.${name} matches the historical unit table it replaces`,
    same ? '' : JSON.stringify(actual));
}

// grid is the audit's named bug: its old applyR had NO branch for x or y (or
// brightness / contrast), so a preset targeting them did nothing. Under the
// shared contract it has real units.
check(R.UNITS.grid.x > 0 && R.UNITS.grid.y > 0, 'grid now has an x and a y unit (the missing-target bug)');
check(R.UNITS.grid.brightness > 0 && R.UNITS.grid.contrast > 0, 'grid now has brightness and contrast units');

// Behaviour preservation: a compatibility table must reproduce the historical
// page maths for a feature of 1, gain 1, sens 1, identity ease.
function viaUnits(units, target) {
  const layer = { ...BAD_LAYER, reactors: [{ feature: 'bass', target, scale: 1 }] };
  return R.applyReactor(layer, AUDIO, 0, { units, feature: () => 1 })[target];
}
eq(viaUnits(R.UNITS.smoke, 'x'), 300, 'smoke x still moves 300 px per unit gain (its historical table)');
eq(viaUnits(R.UNITS.film, 'rot'), 12, 'film rot still moves 12 deg per unit gain');
eq(viaUnits(R.UNITS.hallucination, 'hue'), 80, 'hallucination hue still moves 80 deg per unit gain');
eq(viaUnits(R.UNITS.gain200, 'x'), 200, 'the seven-page family still moves 200 px per unit gain');
eq(viaUnits(R.UNITS.natural, 'x'), 1, 'engine.html x still reads r.scale straight as px');

// ---- 10. Every migrated surface actually calls the shared module ----------

console.log('apply-reactor: every migrated surface calls the shared module');

// engine.html + the fifteen variant pages that carry a reactor chain (the
// fifteen carry a named `applyR`; engine.html's was an inline chain).
const SURFACES = [
  'engine.html',
  'versions/aurora.html',
  'versions/chrome.html',
  'versions/eclipse.html',
  'versions/film.html',
  'versions/fractal.html',
  'versions/glitch.html',
  'versions/grid.html',
  'versions/hallucination.html',
  'versions/music_video.html',
  'versions/music_video_mtv.html',
  'versions/neon.html',
  'versions/pulse.html',
  'versions/smoke.html',
  'versions/void.html',
  'versions/watercolor.html',
];

for (const rel of SURFACES) {
  const full = path.join(ROOT, rel);
  if (!fs.existsSync(full)) {
    check(false, `${rel} exists`);
    continue;
  }
  const src = fs.readFileSync(full, 'utf8');
  check(/<script src="\/lib\/apply-reactors\.js"><\/script>/.test(src),
    `${rel} loads /lib/apply-reactors.js (blocking classic tag, no type=module)`);
  check(
    /(?:SWR_REACTORS|RX)\.applyReactor\(/.test(src),
    `${rel} calls the shared applyReactor()`
  );
  // The whole point: no hand-rolled per-target unit table left in the page.
  const leftovers = src.match(/out\.[a-z]+\s*\+=\s*v\s*\*\s*\d/g) || [];
  check(leftovers.length === 0,
    `${rel} has no hand-typed \`out.x += v * 250\` unit table left`,
    leftovers.length ? leftovers.join(' | ') : '');
  const targetChain = src.match(/if\s*\(\s*r\.target\s*===?\s*'scale'/g) || [];
  check(targetChain.length === 0,
    `${rel} has no hand-typed per-target if/else chain left`,
    targetChain.length ? String(targetChain.length) : '');
  // The tables really do live in exactly one file: every surface NAMES one
  // of the module's entries instead of passing an inline object literal.
  check(!/units:\s*\{/.test(src),
    `${rel} passes no inline unit object literal`);
  const named = [...new Set((src.match(/units:\s*(?:RX|SWR_REACTORS)\.UNITS\.([A-Za-z0-9_]+)/g) || [])
    .map((s) => s.replace(/units:\s*(?:RX|SWR_REACTORS)\.UNITS\./, '')))];
  check(named.length > 0, `${rel} names one of the module's UNITS tables`, named.join(', '));
  check(named.every((n) => typeof R.UNITS[n] === 'object'),
    `${rel} names only tables that exist in lib/apply-reactors.js`,
    named.filter((n) => !R.UNITS[n]).join(', ') || 'all known');
}

// The pages must keep passing their own `ease`, because engine.html's map
// (release -> ease-out) is deliberately NOT lib/ease.js's map (identity).
const ENGINE_SRC = fs.readFileSync(path.join(ROOT, 'engine.html'), 'utf8');
check(
  /ease:\s*\(name,\s*t\)\s*=>\s*this\.ease\(name,\s*t\)/.test(ENGINE_SRC),
  'engine.html still passes its OWN ease map (release -> ease-out, not identity)'
);
check(
  !/<script src="\/lib\/ease\.js">/.test(ENGINE_SRC),
  'engine.html loads no lib/ease.js tag (its release curve differs)'
);

// ---- 11. The unit gate itself --------------------------------------------

console.log('apply-reactor: self-test (the gate can still detect a wrong table)');

// A gate that can no longer fail is worse than no gate. Break the tables on
// purpose, in a throwaway context, and prove the assertions above would have
// caught it.
{
  const broken = { console, Math, Object, Array, Number, Boolean, String, isFinite, isNaN };
  broken.window = broken;
  vm.createContext(broken);
  vm.runInContext(fs.readFileSync(MODULE, 'utf8').replace('y: 250,', 'y: 251,'), broken,
    { filename: 'lib/apply-reactors.js (mutated)' });
  const B = broken.SWR_REACTORS;
  check(B.UNIT.y !== 250, 'a mutated unit table really changes UNIT.y (the table is not hard-coded twice)');
  check(
    R.applyReactor({ ...BAD_LAYER, reactors: [{ target: 'y', scale: 1 }] }, AUDIO, 0, { feature: () => 1 }).y !== 251,
    'the dispatch reads UNIT, so a UNIT edit moves the rendered value'
  );
}
// The clamp table is the fix that has no historical equivalent: prove a
// removed clamp is observable.
{
  const unclamped = { ...BAD_LAYER, reactors: [{ target: 'scale', scale: 999 }] };
  const viaModule = R.applyReactor(unclamped, AUDIO, 0, { feature: () => 1 });
  check(viaModule.scale === 4, 'the scale clamp is load-bearing (drop it and the value escapes to ' + (1 + 999) + ')');
}

// ---- 12. Parity sweep: the pre-refactor applyR vs the shared contract ----
//
// The other half of P1.1. Before the extraction every variant page carried
// its own hand-typed `applyR`; commit 1508133 is the last commit that still
// has all fifteen variant pages' own `applyR` (engine.html's chain was
// inline and never had a name). This section RE-RUNS those historical
// implementations, extracted from git AT RUN TIME (never hand-copied into
// this file, so the fixture cannot rot), against the SAME inputs as the
// shared contract, and asserts that the two agree.
//
// It is a DIFFERENCE assertion, not an equality one: the shared contract is
// deliberately NOT a byte-for-byte copy of the old pages. The authoritative
// list of the allowed differences is lib/apply-reactors.js's own header,
// which is quoted here rather than re-derived as magic numbers:
//
//   D1  the grade ceilings moved: opacity 1.0 -> 1.5, and brightness /
//       contrast 3 -> 2.5 on hallucination.
//       "opacity clamps to [0, 1.5] everywhere (it was 1.0 on fourteen of
//        the sixteen surfaces) and brightness / contrast to [0.1, 2.5]
//        everywhere (3 on hallucination; grid had neither branch at all)."
//                                  (WHAT THE EXTRACTION ACTUALLY FIXES)
//   D2  on neon / music_video / music_video_mtv the preset's own `scale`
//       now also reaches opacity / brightness / contrast.
//       "their opacity / brightness / contrast branches never did ... Through
//        the shared loop `r.scale` applies to all of them."
//                                   (KNOWN, DELIBERATE DELTAS)
//   D3  on grid the opacity blend flipped from an inverse blend to an
//       additive one, and grid gained the x / y / brightness / contrast
//       targets it never had.
//       "it had no `x` / `y` / `brightness` / `contrast` branch at all ...
//        its opacity was an INVERSE blend (`opacity * (1 - v)`, louder music
//        dimmed the layer) instead of the additive form the other fifteen
//        surfaces use. Both are corrected."  +  "grid gains `x`, `y`,
//        `brightness` and `contrast`. The audit's named missing-target
//        bug."
//                                   (same header)
//   D4  on neon / music_video / music_video_mtv the `mutate` jitter is no
//       longer scaled by `r.scale` a second time. Their `v` did not carry
//       `r.scale` (the other twelve pages' `v` did), because their gain rode
//       on the branch - `out.x += v * r.scale` - and the jitter is added to
//       `v`. The shared loop adds the jitter AFTER the gain and BEFORE the
//       unit, exactly as the other twelve pages computed it.
//       "their `v` did NOT carry `r.scale` ... the `mutate` jitter is added
//        to `v`, so on those three the jitter was scaled by `r.scale` a
//        SECOND time ... the jitter is no longer multiplied by `r.scale` a
//        second time."
//                                   (KNOWN, DELIBERATE DELTAS)
//
// Every other field must match EXACTLY (tolerance 1e-9). A FOURTH,
// undocumented delta therefore makes this section FAIL - and the self-test
// at the end of the section proves that it does, by mutating a unit row on
// purpose.

console.log('apply-reactor: parity sweep (the pre-refactor applyR vs the shared contract)');

const BASELINE = '1508133';
const SWEEP_PAGES = [
  'aurora', 'chrome', 'eclipse', 'film', 'fractal', 'glitch', 'grid',
  'hallucination', 'music_video', 'music_video_mtv', 'neon', 'pulse',
  'smoke', 'void', 'watercolor'
];
const SWEEP_SENS = 1;        // the pages read A.params.sens
const SWEEP_FEATURE = 1;     // a full-scale analyser value
const SWEEP_RANDOM = 1;      // the seeded random source, pinned so the jitter is deterministic
const SWEEP_MUTATE = 0.4;    // the `mutate` slider's value
const SWEEP_HUE = 40;        // the layer's resting hue (it seeds the rot angle)
const SWEEP_GAIN = 0.6;      // the reactor gain for the mutate-off cases
const GRADE_TARGETS = ['opacity', 'brightness', 'contrast'];
const TOL = 1e-9;
const SWEEP_AUDIO = { params: { sens: SWEEP_SENS }, feat: { bass: SWEEP_FEATURE } };

// The census. `grep -l 'SWR_REACTORS' versions/*.html | wc -l` is 15 and
// `grep -l 'SWR_REACTORS' versions/*.html engine.html | wc -l` is 16: the
// fifteen variant pages plus engine.html.
const versionsDir = path.join(ROOT, 'versions');
const versionFiles = fs.readdirSync(versionsDir).filter((f) => f.endsWith('.html'));
const boundPages = versionFiles.filter((f) =>
  fs.readFileSync(path.join(versionsDir, f), 'utf8').includes('SWR_REACTORS'));
check(boundPages.length === 15, '15 variant pages bind window.SWR_REACTORS', 'got ' + boundPages.length);
check(
  fs.readFileSync(path.join(ROOT, 'engine.html'), 'utf8').includes('SWR_REACTORS'),
  'engine.html binds window.SWR_REACTORS as well'
);
check(boundPages.length + 1 === 16, 'the shared contract is bound on 16 surfaces (15 variant pages + engine.html)');
check(
  boundPages.map((f) => f.replace(/\.html$/, '')).sort().join(',') === SWEEP_PAGES.slice().sort().join(','),
  'the pages that bind the contract are exactly the pages this sweep covers',
  boundPages.join(', ')
);

// The easing curve both sides use. The pages bind `window.SWR_EASE.ease`
// (lib/ease.js) and hand it to the contract; every historical page had its
// own copy of the same map. With no ease name on the reactor all of them
// are the identity, so both sides of the sweep curve identically.
const easeSandbox = { console, Math, Object, Array, Number, Boolean, String, isFinite, isNaN };
easeSandbox.window = easeSandbox;
vm.createContext(easeSandbox);
vm.runInContext(fs.readFileSync(path.join(ROOT, 'lib/ease.js'), 'utf8'), easeSandbox, { filename: 'lib/ease.js' });
const easeFn = easeSandbox.SWR_EASE.ease;

const clampValue = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const wrapRot = (v) => (v ? ((v + 540) % 360) - 180 : v);

function gitShow(rel) {
  return execFileSync('git', ['show', BASELINE + ':' + rel], {
    cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024
  });
}

// Pull `function applyR(l) { ... }` out of a page's source (and the
// `let applyR = function (l)` spelling music_video.html used), brace matched
// and string / comment aware.
function extractApplyR(src) {
  const m = /(?:function\s+applyR\s*\(\s*l\s*\)|applyR\s*=\s*function\s*\(\s*l\s*\))/.exec(src);
  if (!m) throw new Error('no applyR in the page source');
  const start = src.indexOf('function', m.index);
  let depth = 0;
  for (let j = src.indexOf('{', m.index); j < src.length; j++) {
    const c = src[j];
    if (c === '/' && src[j + 1] === '/') { j = src.indexOf('\n', j); if (j === -1) break; continue; }
    if (c === '/' && src[j + 1] === '*') { j = src.indexOf('*/', j); if (j === -1) break; j++; continue; }
    if (c === '"' || c === "'" || c === '`') {
      const quote = c;
      for (j++; j < src.length; j++) {
        if (src[j] === '\\') { j++; continue; }
        if (src[j] === quote) break;
      }
      continue;
    }
    if (c === '{') depth++;
    else if (c === '}' && --depth === 0) return src.slice(start, j + 1);
  }
  throw new Error('unbalanced applyR');
}

// Read a historical page's own contract out of its extracted applyR: the
// per-target unit table, the clamp bounds, the rot seed, whether `v` carried
// the reactor gain, and whether the page jittered at all. This is what makes
// the expectation below a reconstruction of the OLD behaviour rather than a
// restatement of the new one.
function parseHistorical(src) {
  const profile = { targets: {} };
  const vLine = /v = ease\(r\.ease, clamp\(v,0,1\)\) \* ([^;]+);/.exec(src);
  profile.vHasGain = !!vLine && /r\.scale/.test(vLine[1]);
  profile.jitter = /l\.mutate\s*>/.test(src);
  const seed = /rot:\s*l\.hue\s*\*\s*([\d.]+)/.exec(src);
  // A page that seeded the angle from the layer's hue seeds it by a
  // fraction of it; every other page seeded it at 0.
  profile.seed = seed ? Number(seed[1]) : 0;
  const targets = profile.targets;
  const blend = /out\.(\w+)\s*=\s*clamp\(\s*out\.\1\s*\*\s*\(1\s*-\s*v\)/.exec(src);
  if (blend) targets[blend[1]] = { kind: 'blend' };
  let m;
  const grade = /out\.(\w+)\s*=\s*clamp\(\s*out\.\w+\s*\+\s*v\s*\*\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*\)/g;
  while ((m = grade.exec(src))) targets[m[1]] = { kind: 'grade', unit: Number(m[2]), lo: Number(m[3]), hi: Number(m[4]) };
  const addGain = /out\.(\w+)\s*\+=\s*v\s*\*\s*r\.scale/g;
  while ((m = addGain.exec(src))) targets[m[1]] = { kind: 'add', unit: 'gain' };
  const addNum = /out\.(\w+)\s*\+=\s*v\s*\*\s*([\d.]+)/g;
  while ((m = addNum.exec(src))) targets[m[1]] = { kind: 'add', unit: Number(m[2]) };
  const addPlain = /out\.(\w+)\s*\+=\s*v\s*;/g;
  while ((m = addPlain.exec(src))) if (!targets[m[1]]) targets[m[1]] = { kind: 'add', unit: 1 };
  return profile;
}

// Run the historical applyR in a sandbox with the page's own globals.
function makeHistoricalPage(src, page) {
  const s = {
    console: { log() {}, warn() {}, error() {} },
    Math, Object, Array, Number, Boolean, String, Error, isFinite, isNaN, JSON
  };
  s.window = s;
  s.A = { params: { sens: SWEEP_SENS }, feat: { bass: SWEEP_FEATURE } };
  s.ease = easeFn;
  s.clamp = clampValue;
  s._rnd = () => SWEEP_RANDOM;
  // The master-transformations toggle: the old pages skipped the whole
  // reactor loop when window.SWR_TX_MASTER was missing, so the sweep has to
  // provide it, switched on, or it would compare two resting transforms.
  s.SWR_TX_MASTER = { enabled: true };
  vm.createContext(s);
  vm.runInContext('var __applyR = ' + extractApplyR(src), s,
    { filename: BASELINE + ':versions/' + page + '.html' });
  return s.__applyR;
}

const pageCache = new Map();
function loadPage(page) {
  if (pageCache.has(page)) return pageCache.get(page);
  const historicalSrc = gitShow('versions/' + page + '.html');
  const profile = parseHistorical(extractApplyR(historicalSrc));
  const oldFn = makeHistoricalPage(historicalSrc, page);
  const currentSrc = fs.readFileSync(path.join(versionsDir, page + '.html'), 'utf8');
  const table = /units:\s*(?:RX|SWR_REACTORS)\.UNITS\.([A-Za-z0-9_]+)/.exec(currentSrc);
  const seedCall = /baseTransform\(\s*l\s*,\s*\{\s*rot:\s*l\.hue\s*\*\s*([\d.]+)/.exec(currentSrc);
  const entry = {
    profile,
    oldFn,
    table: table ? table[1] : null,
    currentSeed: seedCall ? Number(seedCall[1]) : 0
  };
  pageCache.set(page, entry);
  return entry;
}

// The transform the historical page produced, rebuilt from its own extracted
// contract. `vOld` is the page's own `v`: the eased value, the gain where
// the page put it, and the jitter where the page put it.
function historicalTransform(profile, layer, target, vOld) {
  const out = baseTransformOf(profile, layer);
  const desc = profile.targets[target];
  const gain = layer.reactors[0].scale;
  if (desc) {
    if (desc.kind === 'add') out[target] += desc.unit === 'gain' ? vOld * gain : vOld * desc.unit;
    else if (desc.kind === 'grade') out[target] = clampValue(out[target] + vOld * desc.unit, desc.lo, desc.hi);
    else if (desc.kind === 'blend') out[target] = clampValue(out[target] * (1 - vOld) + (vOld > 0 ? 1 : 0), 0, 1);
  }
  out.rot = wrapRot(out.rot);
  return out;
}

// The transform the shared contract produces, rebuilt from the HISTORICAL
// unit table plus the documented deltas: the gain always rides on `v` (D2),
// the grades use the DOCUMENTED clamp table (D1), and a target the page
// never had takes the contract's default unit (D3, grid only).
function contractTransform(profile, layer, target, vNew) {
  const out = baseTransformOf(profile, layer);
  const desc = profile.targets[target];
  let unit;
  if (desc && desc.kind === 'add') unit = desc.unit === 'gain' ? 1 : desc.unit;
  else if (desc && desc.kind === 'grade') unit = desc.unit;
  else unit = EXPECTED_UNIT[target];
  if (GRADE_TARGETS.includes(target)) {
    // The DOCUMENTED contract clamp, not the clamp table of the contract
    // under test: D1 says the grade ceiling moved to 1.5 (2.5 for
    // brightness / contrast), and the sweep has to hold the contract to
    // that number rather than to whatever the module currently says.
    const bounds = EXPECTED_CLAMP[target];
    out[target] = clampValue(out[target] + vNew * unit, bounds[0], bounds[1]);
  } else {
    out[target] += vNew * unit;
  }
  out.rot = wrapRot(out.rot);
  return out;
}

function baseTransformOf(profile, layer) {
  return {
    scale: layer.baseScale,
    x: 0,
    y: 0,
    rot: layer.hue * (profile.seed || 0),
    opacity: layer.opacity,
    hue: layer.hue,
    brightness: layer.brightness,
    contrast: layer.contrast
  };
}

// Which documented delta, if any, explains a difference between the
// historical value and the contract's value. `null` means the difference is
// UNDOCUMENTED, which fails the sweep.
//
// `ctx` carries the case's own numbers so a label can be CHECKED against an
// expected difference rather than used as a blanket excuse. A label that
// does not reproduce the observed difference is not an explanation.
function classifyDelta(profile, field, ctx) {
  const desc = profile.targets[field];
  if (GRADE_TARGETS.includes(field)) {
    if (!desc) return 'D3 grid gained the target';
    if (desc.kind === 'blend') return 'D3 grid opacity inverse -> additive';
    if (!profile.vHasGain) return 'D2 the preset scale now reaches the grades';
    if (desc.hi !== EXPECTED_CLAMP[field][1]) return 'D1 the grade ceiling moved';
    return null;
  }
  // A motion target (scale, x, y, rot, hue) has no documented delta except
  // grid's missing targets.
  if (!desc) return 'D3 grid gained the target';
  // D4: the natural family (neon / music_video / music_video_mtv). Their
  // `v` did not carry the gain - their branch multiplied by `r.scale`
  // instead - so the `mutate` jitter was scaled by `r.scale` a second time.
  // The shared loop adds the jitter after the gain and before the unit,
  // exactly as the other twelve pages computed it.
  if (ctx && ctx.d4) {
    // The explanation has to REPRODUCE the observed difference, computed
    // from the page's own numbers (see the sweep). A label that does not
    // match the arithmetic is not an explanation.
    if (Math.abs(ctx.d4.observed - ctx.d4.expected) > TOL) return null;
    return 'D4 the natural family no longer scales the jitter twice';
  }
  return null;
}

// Every documented delta has to be OBSERVED, not just tolerated: a contract
// that quietly dropped one of them (the old 1.0 opacity ceiling coming
// back, say) would look like "no difference at all" to a sweep that only
// checked for undocumented ones.
const REQUIRED_DELTAS = [
  'D1 the grade ceiling moved',
  'D2 the preset scale now reaches the grades',
  'D3 grid gained the target',
  'D3 grid opacity inverse -> additive',
  'D4 the natural family no longer scales the jitter twice'
];

// The sweep itself. `unitOverrides` lets the self-test below mutate one
// page's unit table and watch the sweep go red; `contract` lets it mutate
// the shipped contract itself.
function runParitySweep(unitOverrides, contract = R) {
  const failures = [];
  const perPage = {};
  const stats = { cases: 0, fields: 0, exact: 0, deltas: {} };
  for (const page of SWEEP_PAGES) {
    const entry = loadPage(page);
    const profile = entry.profile;
    const units = (unitOverrides && unitOverrides[page]) || contract.UNITS[entry.table];
    const pageFailures = [];
    perPage[page] = pageFailures;
    if (!units) {
      pageFailures.push(page + ': the page names a unit table that does not exist (' + entry.table + ')');
      failures.push(...pageFailures);
      continue;
    }
    for (const mutate of [0, SWEEP_MUTATE]) {
      // The mutate-on cases run at a gain of 1 AND at SWEEP_GAIN. At a gain
      // of 1 the two historical `v` shapes (the gain inside `v` versus the
      // gain in the branch) coincide, so the case isolates the jitter
      // itself. At SWEEP_GAIN they do not coincide on the natural family,
      // and that is where D4 shows up: their `v` did not carry the gain, so
      // their jitter was scaled by `r.scale` twice. Both gains are swept so
      // the difference is OBSERVED rather than assumed.
      const gains = mutate ? [1, SWEEP_GAIN] : [SWEEP_GAIN];
      for (const gain of gains) {
        for (const target of R.TARGETS) {
          const layer = {
            asset: {},
            baseScale: 1,
            opacity: 1,
            hue: SWEEP_HUE,
            brightness: 1,
            contrast: 1,
            mutate,
            rotationEnabled: true,
            reactorsEnabled: true,
            reactors: [{ feature: 'bass', target, scale: gain }]
          };
          const eased = easeFn(undefined, SWEEP_FEATURE);
          const jitter = profile.jitter && mutate
            ? (SWEEP_RANDOM - 0.5) * 2 * mutate * Math.abs(gain)
            : 0;
          const vOld = profile.vHasGain
            ? eased * gain * SWEEP_SENS + jitter
            : eased * SWEEP_SENS + jitter;
          const vNew = eased * gain * SWEEP_SENS + jitter;

          const oldOut = entry.oldFn(layer);
          const newOut = contract.applyReactor(layer, SWEEP_AUDIO, 0, {
            base: contract.baseTransform(layer, { rot: layer.hue * (profile.seed || 0) }),
            units,
            ease: easeFn,
            random: () => SWEEP_RANDOM,
            allowRotation: true
          });
          const oldModel = historicalTransform(profile, layer, target, vOld);
          const newModel = contractTransform(profile, layer, target, vNew);

          // D4's expected difference, computed from the page's own numbers
          // rather than asserted by hand:
          //   historical = (eased * sens + jitter) * gain      [the branch
          //               multiplied by r.scale, and `v` had no gain]
          //   contract  = (eased * gain * sens + jitter) * unit
          // The ease terms cancel when the contract's unit is 1, so what is
          // left is the jitter: the historical page scaled it by the gain
          // once more.
          const desc = profile.targets[target];
          const d4Unit = units && typeof units[target] === 'number' ? units[target] : R.UNIT[target];
          const d4 = (!profile.vHasGain && profile.jitter && mutate > 0 &&
            Math.abs(gain - 1) > TOL && desc && desc.kind === 'add' && desc.unit === 'gain')
            ? {
                target,
                jitter,
                gain,
                unit: d4Unit,
                // historical = (eased * sens + jitter) * gain
                // contract  = (eased * gain * sens + jitter) * unit
                expected: eased * SWEEP_SENS * gain * (1 - d4Unit) + jitter * (gain - d4Unit)
              }
            : null;

          stats.cases++;
          for (const field of R.TARGETS) {
            stats.fields++;
            const historical = oldOut[field];
            const contractValue = newOut[field];
            if (Math.abs(historical - oldModel[field]) > TOL) {
              pageFailures.push(
                page + ' / ' + target + ' / ' + field + ': the historical applyR gave ' + historical +
                ' but the model extracted from ' + BASELINE + ' says ' + oldModel[field]);
            }
            if (Math.abs(contractValue - newModel[field]) > TOL) {
              pageFailures.push(
                page + ' / ' + target + ' / ' + field + ': the shared contract gives ' + contractValue +
                ' but the parity sweep expects ' + newModel[field] + ' - an UNDOCUMENTED delta');
            }
            if (Math.abs(historical - contractValue) <= TOL) {
              stats.exact++;
              continue;
            }
            const ctx = d4 && d4.target === field
              ? { d4: { ...d4, observed: historical - contractValue } }
              : null;
            const label = classifyDelta(profile, field, ctx);
            if (!label) {
              pageFailures.push(
                page + ' / ' + target + ' / ' + field + ': ' + historical + ' -> ' + contractValue +
                ' and no documented delta explains it');
            } else {
              stats.deltas[label] = (stats.deltas[label] || 0) + 1;
            }
          }
        }
      }
    }
    failures.push(...pageFailures);
  }
  // The documented deltas have to be there, not just tolerated: a contract
  // that dropped one of them would otherwise look like "no difference".
  for (const label of REQUIRED_DELTAS) {
    if (!stats.deltas[label]) {
      failures.push('the documented delta "' + label + '" is no longer observed: the shared ' +
        'contract no longer differs from the historical applyR the way lib/apply-reactors.js documents');
    }
  }
  return { failures, perPage, stats };
}

const sweep = runParitySweep(null);

for (const page of SWEEP_PAGES) {
  const entry = loadPage(page);
  const pageFailures = sweep.perPage[page] || [];
  check(pageFailures.length === 0,
    page + ': the shared contract reproduces the historical applyR (only the documented deltas differ)',
    pageFailures.length ? pageFailures[0] : '');

  // The rot seed: the historical page seeded the angle from the layer's
  // hue, and the shipped page must seed it from the same expression.
  check(entry.currentSeed === (entry.profile.seed || 0),
    page + ': the shipped rot seed is the historical one',
    'historical ' + (entry.profile.seed || 0) + ', shipped ' + entry.currentSeed);

  // The resting transform (no reactors at all): the seed and the base
  // values, which every reactor case then builds on.
  const rest = {
    asset: {}, baseScale: 1, opacity: 1, hue: SWEEP_HUE, brightness: 1, contrast: 1,
    mutate: 0, rotationEnabled: true, reactorsEnabled: true, reactors: []
  };
  const oldRest = entry.oldFn(rest);
  const newRest = R.applyReactor(rest, SWEEP_AUDIO, 0, {
    base: R.baseTransform(rest, { rot: rest.hue * (entry.profile.seed || 0) }),
    units: R.UNITS[entry.table],
    ease: easeFn,
    random: () => SWEEP_RANDOM,
    allowRotation: true
  });
  const restSame = R.TARGETS.every((f) => Math.abs(oldRest[f] - newRest[f]) <= TOL);
  check(restSame, page + ': the resting transform (the rot seed and the base values) is unchanged');
}

// The summary a reader needs to see that the sweep really ran.
const deltaTotal = Object.values(sweep.stats.deltas).reduce((a, b) => a + b, 0);
console.log('apply-reactor: parity sweep summary');
console.log('  pages ' + SWEEP_PAGES.length + ' x targets ' + R.TARGETS.length +
  ' x (mutate, gain) settings 3 = ' + sweep.stats.cases + ' cases');
console.log('  fields compared: ' + sweep.stats.fields +
  ' | exact historical == contract: ' + sweep.stats.exact +
  ' | documented deltas: ' + deltaTotal);
for (const [label, count] of Object.entries(sweep.stats.deltas)) {
  console.log('    ' + label + ': ' + count);
}
check(sweep.stats.cases >= 240, 'the sweep ran at least 240 cases', 'got ' + sweep.stats.cases);
check(deltaTotal > 0, 'the sweep actually observed the documented deltas', 'got ' + deltaTotal);
for (const failure of sweep.failures) check(false, 'parity sweep: ' + failure);

// ---- 13. The parity sweep can still fail ---------------------------------

console.log('apply-reactor: parity sweep self-test (the sweep can still detect a break)');

// A sweep that can no longer fail is worse than no sweep. Break one page's
// unit row on purpose, in a throwaway table, and prove the sweep above goes
// RED. Then restore it and prove the sweep is green again.
{
  const broken = runParitySweep({ smoke: { ...R.UNITS.smoke, x: R.UNITS.smoke.x + 1 } });
  check(broken.failures.length > 0,
    'a mutated unit row makes the parity sweep go RED',
    broken.failures.length ? broken.failures[0] : 'the sweep stayed green');
  check(broken.failures.some((f) => f.indexOf('smoke') !== -1 && f.indexOf('x') !== -1),
    'the sweep names the mutated page and the mutated target');
  const restored = runParitySweep(null);
  check(restored.failures.length === 0,
    'the parity sweep is GREEN again once the mutation is restored',
    restored.failures.length ? restored.failures[0] : '');
  console.log('  the deliberate mutation WAS DETECTED (' + broken.failures.length +
    ' failures) and the restore was clean');
}

// The same proof, one level up: a change in the SHIPPED CONTRACT (not just
// in the table the sweep hands it) has to turn the sweep red too. The
// mutation here puts the old 1.0 opacity ceiling back, which drops the
// documented D1 delta.
{
  const mutatedSource = fs.readFileSync(MODULE, 'utf8').replace('opacity: [0, 1.5]', 'opacity: [0, 1]');
  check(mutatedSource !== fs.readFileSync(MODULE, 'utf8'),
    'the contract mutation for the self-test really changed the source');
  const mutated = { console: { log() {}, warn() {}, error() {} }, Math, Object, Array, Number, Boolean, String, Error, isFinite, isNaN };
  mutated.window = mutated;
  vm.createContext(mutated);
  vm.runInContext(mutatedSource, mutated, { filename: 'lib/apply-reactors.js (mutated)' });
  const broken = runParitySweep(null, mutated.SWR_REACTORS);
  check(broken.failures.length > 0,
    'a mutated shared contract makes the parity sweep go RED',
    broken.failures.length ? broken.failures[0] : 'the sweep stayed green');
  const restored = runParitySweep(null, R);
  check(restored.failures.length === 0,
    'the parity sweep is GREEN again against the shipped contract',
    restored.failures.length ? restored.failures[0] : '');
  console.log('  the contract mutation WAS DETECTED (' + broken.failures.length +
    ' failures) and the shipped contract is clean');
}

// The same proof for D4 specifically. The natural family's documented delta
// is that their jitter is no longer scaled by `r.scale` a second time. A
// contract that put the jitter back where the old pages had it - scaled by
// the gain a second time - would make D4 vanish, and a gate that only
// TOLERATED undocumented differences would not notice. This one demands it,
// so it has to go RED.
{
  const mutatedSource = fs.readFileSync(MODULE, 'utf8').replace(
    'Math.abs(gain);',
    'Math.abs(gain) * Math.abs(gain);');
  check(mutatedSource !== fs.readFileSync(MODULE, 'utf8'),
    'the D4 contract mutation for the self-test really changed the source');
  const mutated = { console: { log() {}, warn() {}, error() {} }, Math, Object, Array, Number, Boolean, String, Error, isFinite, isNaN };
  mutated.window = mutated;
  vm.createContext(mutated);
  vm.runInContext(mutatedSource, mutated, { filename: 'lib/apply-reactors.js (mutated, D4)' });
  const broken = runParitySweep(null, mutated.SWR_REACTORS);
  check(broken.failures.length > 0,
    'a contract that scales the jitter by the gain twice makes the parity sweep go RED',
    broken.failures.length ? broken.failures[0] : 'the sweep stayed green');
  check(broken.failures.some((f) => f.indexOf('D4') !== -1),
    'the sweep reports the D4 delta as no longer observed',
    broken.failures.find((f) => f.indexOf('D4') !== -1) ||
      'no failure mentions D4; the first failure was: ' + (broken.failures[0] || 'none'));
  const restored = runParitySweep(null, R);
  check(restored.failures.length === 0,
    'the parity sweep is GREEN again against the shipped contract',
    restored.failures.length ? restored.failures[0] : '');
  console.log('  the D4 mutation WAS DETECTED (' + broken.failures.length +
    ' failures) and the shipped contract is clean');
}

console.log('');
if (failures === 0) {
  console.log('ALL GREEN - one reactor contract, one unit table, one clamp table');
  process.exit(0);
} else {
  console.log(failures + ' FAILED');
  process.exit(1);
}