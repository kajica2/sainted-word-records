#!/usr/bin/env node
// scripts/check-image-lane-unit.mjs — dedicated image lane for engine / play

import vm from 'node:vm';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const KILL = path.join(ROOT, 'lib/motion-kill-switch.client.js');
const LANE = path.join(ROOT, 'lib/image-lane.client.js');
const LAYERS = path.join(ROOT, 'lib/layers.client.js');

let failures = 0;
function check(cond, msg, detail) {
  if (cond) console.log('  PASS', msg, detail ? '(' + detail + ')' : '');
  else { console.log('  FAIL', msg, detail ? '(' + detail + ')' : ''); failures++; }
}

function loadSandbox() {
  const sandbox = {
    console: { log() {}, warn() {}, error() {} },
    Math, Object, Array, Number, Boolean, String, Error, isFinite, isNaN, performance: { now: () => 0 },
    document: {
      getElementById() { return null; },
      querySelector() { return null; },
      querySelectorAll() { return []; },
      addEventListener() {},
      dispatchEvent() { return true; },
      readyState: 'complete',
    },
    CustomEvent: function CustomEvent() {},
    requestAnimationFrame(fn) { return 1; },
    cancelAnimationFrame() {},
    setTimeout(fn) { if (typeof fn === 'function') fn(); return 1; },
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(KILL, 'utf8'), sandbox, { filename: 'motion-kill-switch.client.js' });
  vm.runInContext(fs.readFileSync(LANE, 'utf8'), sandbox, { filename: 'image-lane.client.js' });
  return sandbox;
}

console.log('image-lane: module API');
const sb = loadSandbox();
const IL = sb.SWR_IMAGE_LANE;
const MK = sb.SWR_MOTION_KILL;
check(IL && Array.isArray(IL.list), 'SWR_IMAGE_LANE exposes list');
check(IL.stackOrder === 'above', 'default stack order is above video');
check(typeof IL.migrateFromVideoStack === 'function', 'migrateFromVideoStack exported');
check(typeof IL.drawStack === 'function', 'drawStack exported');

const imgAsset = { id: 'a1', type: 'image', mime: 'image/png', name: 'still.png' };
const vidAsset = { id: 'v1', type: 'video', mime: 'video/mp4', name: 'clip.mp4' };
IL.list = [];
const added = IL.add(imgAsset);
check(added && IL.list.length === 1, 'add() accepts still image');
check(added.reactors && added.reactors.length >= 1, 'image lane layer gets automix reactors');
check(added.baseScale === 1 && added.rotationEnabled === false, 'image lane clamps motion');
check(!added.reactors.some((r) => r.target === 'rot' || r.target === 'scale'), 'no rot/scale reactors');

console.log('image-lane: Layers.add routing (partial load)');
const sb2 = loadSandbox();
sb2.Layers = { list: [], render() {} };
sb2.window.Layers = sb2.Layers;
vm.runInContext(fs.readFileSync(LAYERS, 'utf8').replace(
  /function Audio\(\)/,
  'function Audio(){return null;}'
), sb2, { filename: 'layers.client.js' });
// layers.client.js attaches window.Layers - use minimal stub instead
const layersSrc = fs.readFileSync(LAYERS, 'utf8');
check(layersSrc.includes('SWR_IMAGE_LANE') && layersSrc.includes('isImageAsset'),
  'layers.client.js routes images to image lane');

console.log('image-lane: migrate from video stack');
sb.Layers = {
  list: [
    { id: 'L1', asset: vidAsset, kind: undefined, pos: { x: 0, y: 0, rot: 0 }, rotOffset: 5, reactors: [] },
    { id: 'L2', asset: imgAsset, pos: { x: 1, y: 0, rot: 10 }, rotOffset: 3, reactors: [{ target: 'scale' }] },
  ],
  render() {},
  visibleList() { return this.list; },
};
sb.window.Layers = sb.Layers;
IL.list = [];
const moved = IL.migrateFromVideoStack();
check(moved === 1 && sb.Layers.list.length === 1, 'migrate moves one image off video stack');
check(IL.list.length === 1 && IL.list[0].pos.rot === 0, 'migrated layer clears rotation');

console.log('image-lane: automix shouldRun when lane has stills');
const amSrc = fs.readFileSync(path.join(ROOT, 'client/automix-image-mode.client.js'), 'utf8');
check(amSrc.includes('hasImageLaneStills'), 'automix image mode checks image lane');
check(amSrc.includes('SWR_IMAGE_LANE'), 'automix image mode reads lane list');

console.log('image-lane: ship wiring');
const engineHtml = fs.readFileSync(path.join(ROOT, 'engine.html'), 'utf8');
const playHtml = fs.readFileSync(path.join(ROOT, 'versions/play.html'), 'utf8');
check(engineHtml.includes('image-lane.client.js'), 'engine.html loads image-lane');
check(engineHtml.includes('image-lane-panel.client.js'), 'engine.html loads image lane panel');
check(engineHtml.includes('SWR_IMAGE_LANE') || engineHtml.includes('drawStack'), 'engine render uses image lane');
check(playHtml.includes('image-lane.client.js'), 'play.html loads image-lane');
check(playHtml.includes('image-lane-panel'), 'play.html mounts stills lane UI');

const projSrc = fs.readFileSync(path.join(ROOT, 'project.js'), 'utf8');
check(projSrc.includes('imageLane'), 'project save/load carries imageLane');

const mkSrc = fs.readFileSync(KILL, 'utf8');
check(mkSrc.includes('SWR_IMAGE_LANE') && mkSrc.includes('sanitizeAllLayerStacks'),
  'motion kill sanitizes image lane stack');

if (failures === 0) {
  console.log('\nALL GREEN (image-lane)');
  process.exit(0);
}
console.log('\n' + failures + ' FAILED (image-lane)');
process.exit(1);
