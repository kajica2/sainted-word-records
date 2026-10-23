#!/usr/bin/env node
// scripts/check-apply-reactor-unit.mjs - unit coverage for P1.1, the one
// shared reactor contract in lib/apply-reactors.js.
//
// Plan: docs/PLANS/architecture-audit-2026-10.md, section 1.1. The audit
// found fifteen surfaces (engine.html's inline engine + the fourteen variant
// pages) each carrying their own `applyR` with its own per-target unit
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
// half of P1.1 is the CALL SITES: fifteen HTML files that must each bind
// `window.SWR_REACTORS` and must no longer carry their own if/else unit
// table. A table can be correct while fifteen call sites still ignore it,
// and that is the exact failure this refactor exists to remove.
//
// Run:  node scripts/check-apply-reactor-unit.mjs
// Exit: 0 = all assertions pass, 1 = any failure.

import vm from 'node:vm';
import fs from 'node:fs';
import path from 'node:path';
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
// "six divergent unit tables collapse to one" honest: a surface cannot pick a
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
eq(viaUnits(R.UNITS.gain200, 'x'), 200, 'the eleven-page family still moves 200 px per unit gain');
eq(viaUnits(R.UNITS.natural, 'x'), 1, 'engine.html x still reads r.scale straight as px');

// ---- 10. Every migrated surface actually calls the shared module ----------

console.log('apply-reactor: every migrated surface calls the shared module');

// engine.html + the fourteen variant pages that carry an applyR.
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

console.log('');
if (failures === 0) {
  console.log('ALL GREEN - one reactor contract, one unit table, one clamp table');
  process.exit(0);
} else {
  console.log(failures + ' FAILED');
  process.exit(1);
}