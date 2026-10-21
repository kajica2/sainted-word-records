// scripts/check-engine-keys-digit-rotation-guard-unit.mjs
//
// Enforces the digit contract from docs/PLANS/number-key-assignment.md:
//
//   "Bare digit behaviour MUST NOT: toggle the rotationEnable checkbox on
//    any layer, mutate layer.pos / layer.rotOffset, apply any audio
//    reactor with target 'rot', or call Layers.rotate."
//
// The plan described that contract; the code now ENFORCES it. Every digit
// path runs inside withNoRotation(), which snapshots the
// REJECTED_DIGIT_TARGETS fields of every layer, runs the digit action, and
// restores anything the action touched.
//
// What we verify:
//   1. REJECTED_DIGIT_TARGETS exists and lists the five rejected fields.
//   2. withNoRotation() reverts rot / rotationEnabled / pos / rotOffset
//      / reactors that a digit action mutated.
//   3. withNoRotation() leaves a well-behaved action untouched and still
//      returns its value.
//   4. withNoRotation() restores state even when the action throws.
//   5. homeLayers() calls homeAll() on the engine family and resets the
//      "original" fields on the variant family (which has no homeAll).
//   6. engine.html has no second owner of the bare digit row (the old
//      digit -> transition handler is gone; transition #1 is "swivel",
//      a rotateY cover, and would have spun the stage from the digit row).

import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const KEYS_SRC = readFileSync(new URL('../engine-keys.client.js', import.meta.url), 'utf8');
const ENGINE_SRC = readFileSync(new URL('../engine.html', import.meta.url), 'utf8');

const results = [];
function check(name, fn) {
  let ok = false;
  let detail = '';
  try {
    const r = fn();
    if (r === true) ok = true;
    else if (typeof r === 'string') { ok = false; detail = r; }
    else if (r === undefined) { ok = false; detail = 'fn returned undefined'; }
    else { ok = false; detail = 'unexpected: ' + JSON.stringify(r); }
  } catch (e) {
    detail = (e && e.message) ? e.message : String(e);
  }
  results.push({ name, ok, detail });
  console.log((ok ? '  PASS  ' : '  FAIL  ') + name + (detail ? ' — ' + detail : ''));
}

// Pull a top-level (2-space indented) function or const out of the source
// as text, so it can be re-evaluated in isolation.
function extractFn(name, src) {
  const re = new RegExp('function ' + name + '\\b[\\s\\S]*?\\n  \\}', 'm');
  const m = src.match(re);
  return m ? m[0] : null;
}
function extractConst(name, src) {
  const re = new RegExp('const ' + name + '\\s*=\\s*\\[[^\\]]*\\];', 'm');
  const m = src.match(re);
  return m ? m[0] : null;
}

// Build a sandbox with the helpers under test in scope.
function makeSandbox(L) {
  const sandbox = {
    window: { SWR: { Layers: L } },
    console,
  };
  const parts = [
    extractConst('REJECTED_DIGIT_TARGETS', KEYS_SRC),
    extractFn('layers', KEYS_SRC),
    extractFn('snapshotRotationState', KEYS_SRC),
    extractFn('restoreRotationState', KEYS_SRC),
    extractFn('withNoRotation', KEYS_SRC),
    extractFn('homeLayers', KEYS_SRC),
  ];
  for (const p of parts) {
    if (!p) throw new Error('could not extract a helper from engine-keys.client.js');
  }
  vm.createContext(sandbox);
  vm.runInContext(parts.join('\n\n'), sandbox);
  return sandbox;
}

function layer(over) {
  return Object.assign({
    id: 'L1',
    opacity: 1,
    hue: 0,
    brightness: 1,
    contrast: 1,
    baseScale: 1,
    rotOffset: 0,
    rotationEnabled: true,
    pos: { x: 0, y: 0, rot: 0 },
    reactors: [{ feature: 'bass', target: 'scale', scale: 0.7, ease: 'sharp' }],
  }, over || {});
}

check('REJECTED_DIGIT_TARGETS is declared with the five rejected fields', () => {
  const c = extractConst('REJECTED_DIGIT_TARGETS', KEYS_SRC);
  if (!c) return 'REJECTED_DIGIT_TARGETS not found in engine-keys.client.js';
  for (const t of ['rot', 'rotationEnabled', 'pos', 'rotOffset', 'reactor']) {
    if (c.indexOf("'" + t + "'") === -1) return 'missing target: ' + t;
  }
  return true;
});

check('withNoRotation reverts rot / rotationEnabled / pos / rotOffset / reactors', () => {
  const L = { list: [layer()], render() {} };
  const sb = makeSandbox(L);
  const l = L.list[0];
  sb.withNoRotation(() => {
    l.rotOffset = 90;
    l.rotationEnabled = false;
    l.pos.rot = 45;
    l.pos.x = 120;
    l.pos.y = -30;
    l.reactors.push({ feature: 'treble', target: 'rot', scale: 3, ease: 'smooth' });
  });
  if (l.rotOffset !== 0) return 'rotOffset not restored: ' + l.rotOffset;
  if (l.rotationEnabled !== true) return 'rotationEnabled not restored: ' + l.rotationEnabled;
  if (l.pos.rot !== 0) return 'pos.rot not restored: ' + l.pos.rot;
  if (l.pos.x !== 0) return 'pos.x not restored: ' + l.pos.x;
  if (l.pos.y !== 0) return 'pos.y not restored: ' + l.pos.y;
  if (l.reactors.length !== 1) return 'reactors not restored: ' + l.reactors.length;
  if (l.reactors[0].target !== 'scale') return 'wrong reactor restored';
  return true;
});

check('withNoRotation leaves a well-behaved action untouched and returns its value', () => {
  const L = { list: [layer()], render() {} };
  const sb = makeSandbox(L);
  const r = sb.withNoRotation(() => 'ok');
  if (r !== 'ok') return 'return value lost: ' + r;
  if (L.list[0].rotOffset !== 0) return 'rotOffset changed';
  if (L.list[0].pos.rot !== 0) return 'pos.rot changed';
  return true;
});

check('withNoRotation restores state even when the action throws', () => {
  const L = { list: [layer()], render() {} };
  const sb = makeSandbox(L);
  const l = L.list[0];
  let threw = false;
  try {
    sb.withNoRotation(() => { l.rotOffset = 33; throw new Error('boom'); });
  } catch (_) { threw = true; }
  if (!threw) return 'action did not throw';
  if (l.rotOffset !== 0) return 'rotOffset not restored after throw: ' + l.rotOffset;
  return true;
});

check('withNoRotation is a no-op when the page has no Layers', () => {
  const sb = makeSandbox(null);
  let ran = false;
  const r = sb.withNoRotation(() => { ran = true; return 7; });
  if (!ran) return 'action did not run';
  if (r !== 7) return 'return value lost: ' + r;
  return true;
});

check('homeLayers calls homeAll() on the engine family', () => {
  let called = 0;
  const L = { list: [layer()], homeAll(ms) { called = ms; } };
  const sb = makeSandbox(L);
  const r = sb.homeLayers(L);
  if (r !== true) return 'homeLayers returned ' + r;
  if (called !== 480) return 'homeAll not called with 480: ' + called;
  return true;
});

check('homeLayers resets the original fields on the variant family (no homeAll)', () => {
  let rendered = 0;
  const l = layer({ opacity: 0.3, hue: 120, brightness: 1.6, contrast: 0.4, rotOffset: 45 });
  l.pos = { x: 10, y: 20, rot: 30 };
  const L = { list: [l], render() { rendered++; } };
  const sb = makeSandbox(L);
  const r = sb.homeLayers(L);
  if (r !== true) return 'homeLayers returned ' + r;
  if (l.opacity !== 1) return 'opacity not reset: ' + l.opacity;
  if (l.hue !== 0) return 'hue not reset: ' + l.hue;
  if (l.brightness !== 1) return 'brightness not reset: ' + l.brightness;
  if (l.contrast !== 1) return 'contrast not reset: ' + l.contrast;
  if (l.rotOffset !== 0) return 'rotOffset not reset: ' + l.rotOffset;
  if (l.pos.x !== 0 || l.pos.y !== 0 || l.pos.rot !== 0) return 'pos not reset';
  if (l.baseScale !== 1) return 'baseScale must stay at the layer design value';
  if (rendered !== 1) return 'render() not called: ' + rendered;
  return true;
});

check('engine.html has no second owner of the bare digit row', () => {
  // The old handler mapped 1-9 to the transition dropdown (index 0 =
  // "whip-blur", index 1 = "swivel" — a rotateY(0->90->180) cover).
  if (/SWRTransitions\.fire\(opt\.value\)/.test(ENGINE_SRC)) {
    return 'engine.html still fires a transition from the digit row';
  }
  if (/addEventListener\('keydown'[\s\S]{0,400}?SWRTransitions\.fire/.test(ENGINE_SRC)) {
    return 'engine.html still binds a digit keydown to SWRTransitions.fire';
  }
  return true;
});

check('both digit paths in engine-keys.client.js run inside withNoRotation()', () => {
  const bare = /if \(!action && !ev\.shiftKey[\s\S]{0,400}?withNoRotation\(function \(\) \{ applyFilterFromDigit\(slot\); \}\);/.test(KEYS_SRC);
  if (!bare) return 'bare 1..9 path is not wrapped in withNoRotation()';
  const tPrefix = /if \(!action && \/\^Digit\[0-9\]\$[\s\S]{0,400}?withNoRotation\(function \(\) \{[\s\S]{0,200}?SWR_LOOK_FILTER_CYCLER\.apply\(slot\)/.test(KEYS_SRC);
  if (!tPrefix) return 'T+0..9 path is not wrapped in withNoRotation()';
  return true;
});

check('the key-0 handler uses homeLayers()', () => {
  if (!/key === '0'[\s\S]{0,1200}?homeLayers\(L\);/.test(KEYS_SRC)) {
    return 'key 0 does not call homeLayers()';
  }
  return true;
});

// ---- summary ----
const pass = results.filter((r) => r.ok).length;
const fail = results.filter((r) => !r.ok).length;
console.log(`\n${pass} passed, ${fail} failed (${results.length} checks)`);
if (fail > 0) process.exit(1);
