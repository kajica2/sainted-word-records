#!/usr/bin/env node
// scripts/check-no-rotate-zoom.mjs — global rotation/zoom kill-switch gate.

import vm from 'node:vm';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const KILL = path.join(ROOT, 'lib/motion-kill-switch.client.js');
const REACTORS = path.join(ROOT, 'lib/apply-reactors.js');
const ARC_SRC = path.join(ROOT, 'client/automix-arc.client.js');
const VERSIONS_DIR = path.join(ROOT, 'versions');

let failures = 0;
function check(cond, msg, detail) {
  if (cond) console.log('  PASS', msg, detail ? '(' + detail + ')' : '');
  else { console.log('  FAIL', msg, detail ? '(' + detail + ')' : ''); failures++; }
}

function loadBoth() {
  const sandbox = {
    console: { log() {}, warn() {}, error() {} },
    Math, Object, Array, Number, Boolean, String, Error, isFinite, isNaN,
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(KILL, 'utf8'), sandbox, { filename: 'motion-kill-switch.client.js' });
  vm.runInContext(fs.readFileSync(REACTORS, 'utf8'), sandbox, { filename: 'apply-reactors.js' });
  return sandbox;
}

function listVersionHtml() {
  return fs.readdirSync(VERSIONS_DIR)
    .filter((f) => f.endsWith('.html'))
    .map((f) => path.join(VERSIONS_DIR, f))
    .sort();
}

function isAllowedMotionLine(line) {
  const t = line.trim();
  if (!t || t.startsWith('//') || t.startsWith('*')) return true;
  if (t.includes('SWR_MOTION_KILL.gateRotate') || t.includes('SWR_MOTION_KILL.gateScale')) return true;
  if (t.includes('text-transform') || t.includes('viewport') || t.includes('initial-scale')) return true;
  if (/transform:\s*scaleX?\(-1\)|transform:\s*scale\(-1/.test(t)) return true;
  if (t.includes('transform: translate')) return true;
  if (/setTransform\(\s*(m\.)?dpr|setTransform\(\s*1,\s*0,\s*0,\s*1/.test(t)) return true;
  if (t.includes('motion-kill: allow')) return true;
  if (/rc\.rotate\s*\(\s*a\.rotation/.test(t)) return true;
  if (/@keyframes\s+heartbeat/.test(t)) return true;
  if (/\.rotate\(/.test(t)) return false;
  if (/\.scale\(/.test(t) && !/gateScale/.test(t)) {
    if (/scale\(-1|scaleX\(-1|scaleY\(-1/.test(t)) return true;
    return false;
  }
  return true;
}

console.log('no-rotate-zoom: kill-switch defaults');
const sb = loadBoth();
const MK = sb.SWR_MOTION_KILL;
const R = sb.SWR_REACTORS;
check(MK && MK.isRotationGloballyEnabled() === false, 'rotation globally disabled by default');
check(MK && MK.isZoomGloballyEnabled() === false, 'zoom globally disabled by default');
check(!MK.isCssFxAllowed('zoom-pulse'), 'zoom-pulse CSS FX blocked');
check(!MK.isCssFxAllowed('kenburns'), 'kenburns CSS FX blocked');
check(MK.isCssFxAllowed('vhs'), 'non-zoom CSS FX still allowed (vhs)');
check(!MK.isTransitionAllowed('zoom-through'), 'zoom-through transition blocked');
check(MK.isTransitionAllowed('fade-to-black'), 'fade-to-black transition allowed');

const catalog = MK.filterCssFxCatalog([
  { name: 'zoom-pulse', label: 'Z' },
  { name: 'crt', label: 'C' },
]);
check(catalog.length === 1 && catalog[0].name === 'crt', 'filterCssFxCatalog drops zoom-pulse');

console.log('no-rotate-zoom: canvas gate helpers');
const fakeCtx = { calls: [], rotate(r) { this.calls.push(['rotate', r]); }, scale(a, b) { this.calls.push(['scale', a, b]); } };
MK.gateRotate(fakeCtx, 0.5);
MK.gateScale(fakeCtx, 2, 2);
check(fakeCtx.calls.length === 0, 'gateRotate/gateScale no-op when globally off');

console.log('no-rotate-zoom: applyReactor inert paths');
const layer = {
  baseScale: 1,
  opacity: 1,
  hue: 0,
  brightness: 1,
  contrast: 1,
  pos: { x: 0, y: 0, rot: 5 },
  rotOffset: 10,
  rotationEnabled: true,
  reactors: [
    { feature: 'rms', target: 'rot', scale: 90, ease: 'linear' },
    { feature: 'rms', target: 'scale', scale: 2, ease: 'linear' },
  ],
};
const audio = { feat: { rms: 1 } };
const out = R.applyReactor(layer, audio, 0, {
  base: R.baseTransform(layer, { rot: layer.pos.rot + layer.rotOffset }),
  allowRotation: true,
  wrapRotation: false,
  damp: false,
});
check(out.rot === 0, 'rot reactor silenced when global rotation off', 'rot=' + out.rot);
check(Math.abs(out.scale - 1) < 1e-6, 'scale reactor silenced when global zoom off', 'scale=' + out.scale);

const dirty = {
  rotationEnabled: true,
  rotOffset: 45,
  pos: { rot: 30 },
  reactors: [{ feature: 'bass', target: 'rot', scale: 1 }],
  modulators: [{ target: 'scale' }],
};
MK.sanitizeLayer(dirty);
check(dirty.rotationEnabled === false, 'sanitizeLayer forces rotationEnabled false');
check(dirty.rotOffset === 0, 'sanitizeLayer clears rotOffset');
check(dirty.pos.rot === 0, 'sanitizeLayer clears pos.rot');
check(dirty.reactors.length === 0, 'sanitizeLayer strips rot reactors');
check(dirty.modulators.length === 0, 'sanitizeLayer strips scale modulators');

console.log('no-rotate-zoom: every versions/*.html loads kill-switch');
const versionHtml = listVersionHtml();
check(versionHtml.length >= 30, 'versions html inventory', 'count=' + versionHtml.length);
for (const f of versionHtml) {
  const rel = path.relative(ROOT, f);
  const txt = fs.readFileSync(f, 'utf8');
  const killIdx = txt.indexOf('motion-kill-switch.client.js');
  check(killIdx >= 0, rel + ' loads motion-kill-switch');
  if (txt.includes('apply-reactors.js')) {
    const reactIdx = txt.indexOf('apply-reactors.js');
    check(killIdx < reactIdx, rel + ' kill-switch before apply-reactors');
  }
  const lines = txt.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!isAllowedMotionLine(line)) {
      check(false, rel + ' ungated motion at line ' + (i + 1), line.trim().slice(0, 80));
    }
  }
}

console.log('no-rotate-zoom: script load order on engine surfaces');
let htmlFiles = [];
try {
  htmlFiles = execFileSync('rg', ['-l', '--glob', '*.html', 'apply-reactors\\.js', path.join(ROOT, 'engine.html'), VERSIONS_DIR], { encoding: 'utf8' })
    .trim().split('\n').filter(Boolean);
} catch {
  htmlFiles = [];
}
check(htmlFiles.length >= 15, 'found HTML surfaces with apply-reactors', 'count=' + htmlFiles.length);
for (const f of htmlFiles) {
  const rel = path.relative(ROOT, f);
  const txt = fs.readFileSync(f, 'utf8');
  const killIdx = txt.indexOf('motion-kill-switch.client.js');
  const reactIdx = txt.indexOf('apply-reactors.js');
  check(killIdx >= 0 && killIdx < reactIdx, rel + ' loads motion-kill-switch before apply-reactors');
}

const engineHtml = fs.readFileSync(path.join(ROOT, 'engine.html'), 'utf8');
check(engineHtml.includes('filterCssFxCatalog'), 'engine.html CSSFX uses filterCssFxCatalog');
check(engineHtml.includes('isCssFxAllowed'), 'engine.html CSSFX guards _apply with isCssFxAllowed');

console.log('no-rotate-zoom: automix transition pools and layer sanitize');
const arcCtx = {
  console: { log() {}, warn() {}, error() {} },
  Math, Object, Array, Number, Boolean, String, Error, isFinite, isNaN,
  document: {
    addEventListener() {},
    createElement() { return { src: '', onload: null, onerror: null }; },
    head: { appendChild() {} },
  },
  window: {},
  setInterval() {},
  clearInterval() {},
  CustomEvent: function CustomEvent() {},
};
arcCtx.window = arcCtx;
arcCtx.globalThis = arcCtx;
vm.createContext(arcCtx);
vm.runInContext(fs.readFileSync(KILL, 'utf8'), arcCtx, { filename: 'motion-kill-switch.client.js' });
vm.runInContext(fs.readFileSync(ARC_SRC, 'utf8'), arcCtx, { filename: 'automix-arc.client.js' });
const ARC = arcCtx.window.SWR_AUTOMIX_ARC;
const MK2 = arcCtx.window.SWR_MOTION_KILL;
const I = ARC && ARC._internals;
check(!!I, 'automix-arc _internals loaded');
const blocked = new Set(MK2.BLOCKED_TRANSITIONS);
const subtleFiltered = MK2.filterTransitionPool(I.SUBTLE);
check(!subtleFiltered.includes('warp-dissolve'), 'SUBTLE pool drops warp-dissolve under kill-switch');
check(subtleFiltered.length >= 2, 'SUBTLE pool still has allowed entries', 'len=' + subtleFiltered.length);
let badPick = null;
for (let n = 0; n < 120; n++) {
  const pick = I.pickTransition(0.2, 0.2, { cls: 'subtle' });
  if (blocked.has(pick)) { badPick = pick; break; }
}
check(!badPick, '120 subtle automix transition picks are allowed', badPick || '');
const fired = [];
arcCtx.window.SWRTransitions = {
  _TRANSITIONS: {
    'fade-to-black': {}, 'cross-dissolve': {}, 'pure-crossfade': {},
    'glitch-burst': {}, 'chromatic-split': {}, 'circle-wipe': {},
    'linear-wipe-lr': {}, 'vhs-tracking': {},
  },
  fire(name) {
    if (!MK2.isTransitionAllowed(name)) {
      check(false, 'automix arc fire attempted blocked transition', name);
    }
    fired.push(name);
    return Promise.resolve();
  },
};
const coldAct = {
  anchorId: 'a', coords: { warmth: 0.1, intensity: 0.1 }, preset: { temp: 0 }, rampMs: 0,
};
const arcObj = {
  duration: 10,
  acts: [
    Object.assign({ t0: 0, t1: 5, name: 'intro' }, coldAct),
    Object.assign({ t0: 5, t1: 10, name: 'peak' }, coldAct),
  ],
  _lastActIndex: 0,
};
for (let t = 0; t < 8; t++) {
  ARC.tick(arcObj, 1 + t * 1.2);
}
check(fired.every((name) => MK2.isTransitionAllowed(name)),
  'automix arc act-boundary fires only allowed transitions',
  fired.join(', ') || '(none)');

const automixLayer = {
  rotationEnabled: true,
  rotOffset: 22,
  baseScale: 1.8,
  pos: { rot: 15 },
  reactors: [
    { feature: 'bass', target: 'scale', scale: 1 },
    { feature: 'treble', target: 'rot', scale: 3 },
  ],
  modulators: [{ target: 'scale' }],
};
MK2.sanitizeLayer(automixLayer);
check(automixLayer.baseScale === 1, 'sanitizeLayer clamps automix baseScale');
check(automixLayer.reactors.length === 0, 'sanitizeLayer strips automix rot/scale reactors');

console.log('no-rotate-zoom: versions pages must not reference _SWR_MOTION_KILL');
for (const f of versionHtml) {
  const rel = path.relative(ROOT, f);
  const txt = fs.readFileSync(f, 'utf8');
  check(!txt.includes('_SWR_MOTION_KILL'), rel + ' has no _SWR_MOTION_KILL typo');
}

console.log('no-rotate-zoom: play.html EXIF orientation bypasses gateRotate');
const playPath = path.join(VERSIONS_DIR, 'play.html');
const playTxt = fs.readFileSync(playPath, 'utf8');
check(!playTxt.includes('_SWR_MOTION_KILL'), 'play.html has no _SWR_MOTION_KILL typo');
const exifMarker = 'motion-kill: allow EXIF/tkhd orientation';
const exifIdx = playTxt.indexOf(exifMarker);
check(exifIdx >= 0, 'play.html documents EXIF orientation exception');
const exifSlice = exifIdx >= 0 ? playTxt.slice(exifIdx, exifIdx + 400) : '';
check(/rc\.rotate\s*\(\s*a\.rotation/.test(exifSlice),
  'play.html EXIF block uses rc.rotate(a.rotation) not gateRotate');
check(!/gateRotate\s*\(\s*rc\s*,\s*a\.rotation/.test(exifSlice),
  'play.html EXIF block does not gate EXIF rotation');

console.log('no-rotate-zoom: watercolor/smoke gateRotate is guarded');
for (const name of ['watercolor.html', 'smoke.html']) {
  const txt = fs.readFileSync(path.join(VERSIONS_DIR, name), 'utf8');
  check(txt.includes('window.SWR_MOTION_KILL'), name + ' uses window.SWR_MOTION_KILL');
  check(/typeof\s+\w+\.gateRotate\s*===\s*['"]function['"]/.test(txt),
    name + ' guards gateRotate before call');
}

console.log('no-rotate-zoom: automix entry starts with zero rotation');
const fxDirty = { temp: 0.2, mut: 0.95, mutAlgo: 0, liquid: 0.4 };
MK.sanitizeFxPreset(fxDirty);
check(fxDirty.mut === 0 && fxDirty.mutAlgo === 1,
  'sanitizeFxPreset zeros mut and remaps vortex mutAlgo under kill-switch');
check(fxDirty.liquid === 0, 'sanitizeFxPreset zeros liquid under zoom kill-switch');
const stackLayer = {
  rotationEnabled: true,
  rotOffset: 33,
  baseScale: 1.6,
  pos: { rot: 12 },
  reactors: [{ feature: 'treble', target: 'rot', scale: 3 }],
};
const stackSb = {
  console: { log() {}, warn() {}, error() {} },
  Math, Object, Array, Number, Boolean, String, Error, isFinite, isNaN,
  document: { getElementById() { return null; }, querySelector() { return null; } },
  SWR: { Layers: { list: [stackLayer] }, _fxOverride: { mut: 0.8, mutAlgo: 3 } },
};
stackSb.window = stackSb;
stackSb.globalThis = stackSb;
vm.createContext(stackSb);
vm.runInContext(fs.readFileSync(KILL, 'utf8'), stackSb, { filename: 'motion-kill-switch.client.js' });
const MK3 = stackSb.SWR_MOTION_KILL;
MK3.sanitizeAutomixEntry();
check(stackLayer.rotOffset === 0 && stackLayer.reactors.length === 0,
  'sanitizeAutomixEntry clears layer rotation before automix runs');
check(stackSb.SWR._fxOverride.mut === 0,
  'sanitizeAutomixEntry clears live _fxOverride mut spin');
const runtimeSrc = fs.readFileSync(path.join(ROOT, 'client/automix-runtime.client.js'), 'utf8');
check(runtimeSrc.includes('sanitizeAutomixEntry'), 'automix start() calls sanitizeAutomixEntry');
check(runtimeSrc.includes('sanitizeFxPreset'), 'automix _setTarget sanitizes FX presets');
const compSrc = fs.readFileSync(path.join(ROOT, 'client/automix-composition.client.js'), 'utf8');
check(compSrc.includes('sanitizeAllLayerStacks'), 'automix composition apply() sanitizes layers');
const naturalSrc = fs.readFileSync(path.join(ROOT, 'lib/swr-natural.client.js'), 'utf8');
check(naturalSrc.includes('isRotationGloballyEnabled'), 'natural mirror respects rotation kill-switch');

console.log('no-rotate-zoom: FX vortex mutAlgo path disabled by default');
check(typeof MK.isVortexGloballyEnabled === 'function' && MK.isVortexGloballyEnabled() === false,
  'vortex is off by default');
check(MK.coerceMutAlgo(0) === 1 && MK.coerceMutAlgo(2) === 2,
  'coerceMutAlgo remaps vortex (0) to glitch (1)');
const fxSrc = fs.readFileSync(path.join(ROOT, 'fx-postprocess.js'), 'utf8');
check(fxSrc.includes('uniform float u_vortexEnabled'), 'fx shader declares u_vortexEnabled');
check(/u_vortexEnabled\s*<\s*0\.5/.test(fxSrc), 'fx mutate() skips vortex when u_vortexEnabled is off');
check(fxSrc.includes('coerceMutAlgo'), 'fx setAlgo/setPersona coerce mutAlgo');
const killUi = fs.readFileSync(KILL, 'utf8');
check(killUi.includes('#mut-algo') && killUi.includes('isVortexGloballyEnabled'),
  'motion kill UI hides vortex mut-algo option when disabled');
const mkRotOn = {
  console: { log() {}, warn() {}, error() {} },
  Math, Object, Array, Number, Boolean, String, Error, isFinite, isNaN,
  document: { getElementById() { return null; }, querySelector() { return null; },
    querySelectorAll() { return []; }, addEventListener() {}, readyState: 'complete' },
};
mkRotOn.window = mkRotOn;
mkRotOn.globalThis = mkRotOn;
vm.createContext(mkRotOn);
const killSrcRot = fs.readFileSync(KILL, 'utf8')
  .replace('var VORTEX_GLOBALLY_ENABLED = false;', 'var VORTEX_GLOBALLY_ENABLED = true;')
  .replace('var ROTATION_GLOBALLY_ENABLED = false;', 'var ROTATION_GLOBALLY_ENABLED = true;');
vm.runInContext(killSrcRot, mkRotOn, { filename: 'motion-kill-vortex-on.js' });
check(mkRotOn.SWR_MOTION_KILL.coerceMutAlgo(0) === 0, 'coerceMutAlgo allows vortex when enabled');

if (failures === 0) {
  console.log('\nALL GREEN (no-rotate-zoom)');
  process.exit(0);
}
console.log('\n' + failures + ' FAILED (no-rotate-zoom)');
process.exit(1);
