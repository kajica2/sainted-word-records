#!/usr/bin/env node
// scripts/check-automix-image-lane-unit.mjs — lane-ordered still advances vs library fallback

import vm from 'node:vm';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const KILL = path.join(ROOT, 'lib/motion-kill-switch.client.js');
const LANE = path.join(ROOT, 'lib/image-lane.client.js');
const MODE = path.join(ROOT, 'client/automix-image-mode.client.js');

let failures = 0;
function check(cond, msg, detail) {
  if (cond) console.log('  PASS', msg, detail ? '(' + detail + ')' : '');
  else { console.log('  FAIL', msg, detail ? '(' + detail + ')' : ''); failures++; }
}

function loadImageModeSandbox(opts) {
  opts = opts || {};
  var now = opts.now != null ? opts.now : 1_000_000;
  var sandbox = {
    console: { log() {}, warn() {}, error() {} },
    Math, Object, Array, Number, Boolean, String, Error, isFinite, isNaN,
    URLSearchParams,
    Date: {
      now() { return now; },
    },
    location: { search: opts.search || '' },
    LayerScheduler: {},
    SWR_TIMING: {
      attach() {},
      crossfade(layer, pick) {
        if (layer && pick) layer.asset = pick;
      },
    },
    document: {
      getElementById() { return null; },
      querySelector() { return null; },
      querySelectorAll() { return []; },
      addEventListener() {},
      dispatchEvent() { return true; },
      readyState: 'complete',
    },
    CustomEvent: function CustomEvent(type, init) {
      this.type = type;
      this.detail = init && init.detail;
    },
    requestAnimationFrame() { return 1; },
    cancelAnimationFrame() {},
    setTimeout(fn) { if (typeof fn === 'function') fn(); return 1; },
    addEventListener() {},
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  sandbox.automix = {
    enabled: true,
    frozen: false,
    locked: false,
    start() {},
    stop() {},
    _setTarget(p) { return p; },
  };
  sandbox.SWR = {
    Audio: { feat: { beatPulse: false, bass: 0.2, mid: 0.3, treble: 0.2, rms: 0.4, onset: 0 } },
    Layers: { list: [] },
    Library: { items: [] },
  };
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(KILL, 'utf8'), sandbox, { filename: 'motion-kill-switch.client.js' });
  vm.runInContext(fs.readFileSync(LANE, 'utf8'), sandbox, { filename: 'image-lane.client.js' });
  vm.runInContext(fs.readFileSync(MODE, 'utf8'), sandbox, { filename: 'automix-image-mode.client.js' });
  sandbox._advanceNow = function (ms) { now += ms; };
  return sandbox;
}

function img(id) {
  id = id || 'i1';
  return { id, type: 'image', mime: 'image/png', name: 'still.png', url: '/test/' + id + '.png' };
}

console.log('automix-image-lane: exports and dwell');
{
  const sb = loadImageModeSandbox();
  const AI = sb.SWR_AUTOMIX_IMAGE;
  check(!!AI, 'SWR_AUTOMIX_IMAGE defined');
  check(AI.MIN_STILL_DWELL_MS === 2800, 'MIN_STILL_DWELL_MS is 2800', String(AI.MIN_STILL_DWELL_MS));
  check(typeof AI.tryLaneAdvance === 'function', 'tryLaneAdvance exported');
  check(typeof AI.usesLaneOrder === 'function', 'usesLaneOrder exported');
}

console.log('automix-image-lane: lane non-empty uses stepStill');
{
  const sb = loadImageModeSandbox();
  const AI = sb.SWR_AUTOMIX_IMAGE;
  const lane = sb.SWR_IMAGE_LANE;
  lane.list = [];
  lane.add(img('a'));
  lane.add(img('b'));
  var stepCalls = 0;
  var orig = lane.stepStill.bind(lane);
  lane.stepStill = function (d) {
    stepCalls++;
    return orig(d);
  };
  check(AI.usesLaneOrder(), 'usesLaneOrder when lane has stills');
  check(AI.tryLaneAdvance('test'), 'first advance after dwell');
  check(stepCalls === 1, 'stepStill(+1) invoked once', 'calls=' + stepCalls);
  stepCalls = 0;
  check(!AI.tryLaneAdvance('test'), 'blocked before MIN_STILL_DWELL_MS');
  check(stepCalls === 0, 'no stepStill inside dwell window');
  sb._advanceNow(2800);
  check(AI.tryLaneAdvance('test'), 'advance after dwell elapsed');
  check(stepCalls === 1, 'stepStill after dwell', 'calls=' + stepCalls);
}

console.log('automix-image-lane: empty lane falls back to library mode flag');
{
  const sb = loadImageModeSandbox();
  const AI = sb.SWR_AUTOMIX_IMAGE;
  sb.SWR_IMAGE_LANE.list = [];
  check(!AI.usesLaneOrder(), 'usesLaneOrder false when lane empty');
  sb.SWR.Layers.list = [{ asset: img('L0'), kind: undefined }];
  sb.SWR.Library.items = [img('L0'), img('L1'), img('L2')];
  sb.SWR.Audio.feat.beatPulse = true;
  var swapped = AI.libraryRandomSwapOnBeat();
  check(swapped === true, 'libraryRandomSwapOnBeat picks from library on beat');
}

console.log('automix-image-lane: beatCutSwap skips library when lane order active');
{
  const sb = loadImageModeSandbox();
  const AI = sb.SWR_AUTOMIX_IMAGE;
  const lane = sb.SWR_IMAGE_LANE;
  lane.list = [];
  var a = img('x');
  var b = img('y');
  lane.add(a);
  lane.add(b);
  sb.SWR_LAYER_SCHEDULER = sb.LayerScheduler = {
    swapLayerAsset() { throw new Error('library swap should not run'); },
  };
  sb.SWR.Library.items = [a, b, img('z')];
  sb.SWR.Audio.feat.beatPulse = true;
  var vis = lane.visibleList();
  var beforeId = vis[0] && vis[0].asset && vis[0].asset.id;
  AI.beatCutSwap();
  var afterId = vis[0] && vis[0].asset && vis[0].asset.id;
  check(beforeId === afterId, 'beatCutSwap leaves still when lane order (no library pick)');
}

console.log('automix-image-lane: frozen and locked hold still');
{
  const sb = loadImageModeSandbox();
  const AI = sb.SWR_AUTOMIX_IMAGE;
  const lane = sb.SWR_IMAGE_LANE;
  lane.list = [];
  lane.add(img('f1'));
  lane.add(img('f2'));
  var stepCalls = 0;
  var orig = lane.stepStill.bind(lane);
  lane.stepStill = function (d) { stepCalls++; return orig(d); };
  sb.automix.frozen = true;
  check(AI.automixHoldStill(), 'automixHoldStill when frozen');
  check(!AI.tryLaneAdvance('test'), 'tryLaneAdvance blocked when frozen');
  check(stepCalls === 0, 'no stepStill when frozen');
  sb.automix.frozen = false;
  sb.automix.locked = true;
  check(!AI.tryLaneAdvance('test'), 'tryLaneAdvance blocked when locked');
  check(stepCalls === 0, 'no stepStill when locked');
  sb.automix.locked = false;
  check(AI.tryLaneAdvance('test'), 'advance when unfrozen/unlocked');
  check(stepCalls === 1, 'stepStill after unlock');
}

console.log('automix-image-lane: URL automix-image=library forces library path');
{
  const sb = loadImageModeSandbox({ search: '?automix-image=library' });
  const AI = sb.SWR_AUTOMIX_IMAGE;
  const lane = sb.SWR_IMAGE_LANE;
  lane.list = [];
  lane.add(img('u1'));
  lane.add(img('u2'));
  check(AI.resolveSwapMode() === 'library', 'resolveSwapMode library from query');
  check(!AI.usesLaneOrder(), 'usesLaneOrder false when forced library');
}

if (failures) {
  console.error('\nAUTOMIX IMAGE LANE UNIT: ' + failures + ' failure(s)');
  process.exit(1);
}
console.log('\nAUTOMIX IMAGE LANE UNIT: ALL GREEN');
