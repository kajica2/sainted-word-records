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

if (failures === 0) {
  console.log('\nALL GREEN (no-rotate-zoom)');
  process.exit(0);
}
console.log('\n' + failures + ' FAILED (no-rotate-zoom)');
process.exit(1);
