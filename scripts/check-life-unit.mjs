#!/usr/bin/env node
// scripts/check-life-unit.mjs — pure-logic unit tests for lib/swr-life.client.js
// (window.SWR_LIFE): the shared motion bus (energy / pulse / beat / tide / flow).
//
// Loaded through node:vm with a bare window shim + a fake Audio.feat. The
// module's self-tick rAF is skipped in the sandbox, so every assertion steps
// the module with a synthetic clock — deterministic, no wall time.
//
// Run:  node scripts/check-life-unit.mjs
// Exit: 0 = all assertions pass, 1 = any failure, 2 = caught error.

import vm from 'node:vm';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const ROOT = path.resolve(path.dirname(__filename), '..');
const SRC = path.join(ROOT, 'lib/swr-life.client.js');

let failures = 0;
function assert(cond, msg, detail) {
  if (cond) console.log('  ✓', msg, detail ? `(${detail})` : '');
  else { console.log('  ✗', msg, detail ? `(${detail})` : ''); failures += 1; }
}

// ---- Load the module ----------------------------------------------------

const sandbox = { window: {}, performance: { now: () => 0 } };
sandbox.window.SWR = { Audio: { feat: { rms: 0, beat: 0, beatPulse: false }, playing: false } };
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(SRC, 'utf8'), sandbox, { filename: 'swr-life.client.js' });
const life = sandbox.window.SWR_LIFE;
const feat = sandbox.window.SWR.Audio.feat;

let clock = 0;
function step(ms) {
  clock += ms;
  life.update(clock);
  return life.values();
}

// ---- 1. API shape -------------------------------------------------------

console.log('SWR_LIFE: module + API');
assert(!!life && life.__loaded === true, 'module attaches window.SWR_LIFE');
assert(typeof life.update === 'function', 'update() exposed');
assert(typeof life.values === 'function', 'values() exposed');
assert(typeof life.stagger === 'function', 'stagger() exposed');
assert(life.stagger(0, 4) === 0 && life.stagger(2, 4) === 0.5 && life.stagger(5, 4) === 0.25,
  'stagger spreads layers across [0,1)', `0/4=${life.stagger(0, 4)} 2/4=${life.stagger(2, 4)} 5/4=${life.stagger(5, 4)}`);
assert(life.stagger(3, 0) === 0 && life.stagger(-1, 3) >= 0 && life.stagger(-1, 3) < 1,
  'stagger guards n<=0 and negative i');

// ---- 2. Silence: finite, bounded, tide moves ----------------------------

console.log('SWR_LIFE: silence');
let v = null;
for (let i = 0; i < 600; i++) v = step(1000 / 60); // ~10s at 60fps
assert(Number.isFinite(v.energy) && Number.isFinite(v.pulse) && Number.isFinite(v.beat),
  'all values finite in silence');
assert(v.energy < 0.01 && v.pulse < 0.01, 'energy + pulse rest near zero', `e=${v.energy.toFixed(4)} p=${v.pulse.toFixed(4)}`);
const tideA = v.tide;
for (let i = 0; i < 600; i++) v = step(1000 / 60);
assert(v.tide !== tideA && v.tide >= 0 && v.tide <= 1, 'tide drifts over time within [0,1]', `tide=${v.tide.toFixed(3)}`);

// ---- 3. Energy: momentum, not a jump ------------------------------------

console.log('SWR_LIFE: energy spring');
feat.rms = 0.8;
v = step(1000 / 60);
assert(v.energy < 0.2, 'energy does NOT teleport to the target in one frame', `e=${v.energy.toFixed(3)}`);
for (let i = 0; i < 90; i++) v = step(1000 / 60); // +1.5s
assert(v.energy > 0.5, 'energy reaches the target with momentum', `e=${v.energy.toFixed(3)}`);
feat.rms = 0;
v = step(1000 / 60);
assert(v.energy > 0.3, 'energy carries after the target drops (inertia)', `e=${v.energy.toFixed(3)}`);
for (let i = 0; i < 300; i++) v = step(1000 / 60); // +5s
assert(v.energy < 0.05, 'energy settles back down', `e=${v.energy.toFixed(4)}`);

// ---- 4. Pulse: edge-kicked, rings down ----------------------------------

console.log('SWR_LIFE: pulse');
feat.beatPulse = true;
v = step(1000 / 60);
assert(v.pulse > 0.01, 'a beat edge kicks the pulse', `p=${v.pulse.toFixed(3)}`);
let peak = v.pulse;
for (let i = 0; i < 30; i++) { v = step(1000 / 60); peak = Math.max(peak, v.pulse); }
assert(peak > 0.1, 'the pulse rings up like a struck surface', `peak=${peak.toFixed(3)}`);
assert(v.pulse < peak, 'and starts decaying', `now=${v.pulse.toFixed(3)}`);
feat.beatPulse = false;
for (let i = 0; i < 180; i++) v = step(1000 / 60); // +3s
assert(v.pulse < 0.05, 'pulse rings down to rest', `p=${v.pulse.toFixed(4)}`);

// held beatPulse (no edge) must NOT re-kick
feat.beatPulse = true;
for (let i = 0; i < 120; i++) v = step(1000 / 60);
feat.beatPulse = true; // still held
const before = v.pulse;
for (let i = 0; i < 60; i++) v = step(1000 / 60);
assert(v.pulse <= before + 0.001, 'a HELD beatPulse does not re-kick (edge-only)', `before=${before.toFixed(4)} now=${v.pulse.toFixed(4)}`);
feat.beatPulse = false;

// ---- 5. Hostile inputs: NaN, out-of-range, clock jumps ------------------

console.log('SWR_LIFE: defensive bounds');
feat.rms = NaN;
v = step(1000 / 60);
assert(Number.isFinite(v.energy), 'NaN rms keeps energy finite', `e=${v.energy}`);
feat.rms = 5;
for (let i = 0; i < 300; i++) v = step(1000 / 60);
assert(v.energy <= 1.5, 'rms > 1 clamps at the ceiling', `e=${v.energy.toFixed(3)}`);
feat.rms = 0;
clock += 100000; // a 100s jump (backgrounded tab)
v = life.values();
life.update(clock);
v = life.values();
assert(Number.isFinite(v.energy) && Number.isFinite(v.pulse) && v.dt <= 0.1,
  'a huge clock jump clamps dt (no teleport, still finite)', `dt=${v.dt.toFixed(3)}`);
assert(v.tide >= 0 && v.tide <= 1, 'tide stays bounded after the jump', `tide=${v.tide.toFixed(3)}`);

// ---- 6. Wave propagation ------------------------------------------------

console.log('SWR_LIFE: wave');
feat.beatPulse = true; feat.beat = 1;
step(16);                          // the spike lands in the history
feat.beatPulse = false;
const w0now = life.wave(0);
const w2now = life.wave(2);
for (let i = 0; i < 12; i++) { feat.beat *= 0.7; step(16); } // ~190ms later
const w2later = life.wave(2);
assert(w0now > 0.9, 'wave(0) sees the beat immediately', `w0=${w0now.toFixed(2)}`);
assert(w2now < 0.2, 'wave(2) is still pre-beat at the hit (delayed)', `w2=${w2now.toFixed(2)}`);
assert(w2later > 0.9, 'wave(2) feels the beat ~190ms later — the ripple travels', `w2=${w2later.toFixed(2)}`);
assert(life.wave(0, 90) >= 0 && life.wave(0, 90) <= 1, 'wave output bounded');
assert(life.wave(-1) === life.wave(0), 'wave guards negative indices');

// ---- 7. Singleton -------------------------------------------------------

console.log('SWR_LIFE: singleton');
vm.runInContext(fs.readFileSync(SRC, 'utf8'), sandbox, { filename: 'swr-life.client.js' });
assert(sandbox.window.SWR_LIFE === life, 're-evaluation keeps the same instance');

console.log(failures === 0 ? '\nALL GREEN' : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
