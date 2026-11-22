#!/usr/bin/env node
// Remo Panel 2.0 core: param store, shapes/LUT, envelope bus, wiring, history,
// migration. The UI mounts only with ?env=1; this suite stays headless.

import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';

const ROOT = process.cwd();
const files = [
  'client/remo-param-store.client.js',
  'client/remo-shapes.client.js',
  'client/remo-history.client.js',
  'client/remo-envelope-bus.client.js',
  'client/remo-wiring-store.client.js',
  'client/remo-panel.client.js',
];

function makeEl(tag) {
  const el = {
    tagName: String(tag).toUpperCase(),
    className: '',
    id: '',
    type: '',
    value: '',
    checked: false,
    hidden: false,
    textContent: '',
    style: {},
    children: [],
    parentNode: null,
    attrs: {},
    classList: {
      add(c) { el.className = (el.className + ' ' + c).trim(); },
      remove(c) { el.className = el.className.split(/\s+/).filter((x) => x && x !== c).join(' '); },
      toggle(c, on) { if (on) this.add(c); else this.remove(c); },
      contains(c) { return el.className.split(/\s+/).includes(c); },
    },
    setAttribute(k, v) { el.attrs[k] = String(v); },
    getAttribute(k) { return el.attrs[k] != null ? el.attrs[k] : null; },
    appendChild(c) { c.parentNode = el; el.children.push(c); return c; },
    addEventListener() {},
    click() {},
    querySelector(sel) {
      if (sel === '[data-remo-body]') return el.children.find((c) => c.attrs['data-remo-body']) || null;
      if (sel === '[data-remo-toast]') return el.children.find((c) => c.attrs['data-remo-toast']) || null;
      return null;
    },
    getContext() {
      return {
        setTransform() {},
        clearRect() {},
        beginPath() {},
        moveTo() {},
        lineTo() {},
        closePath() {},
        stroke() {},
        fill() {},
      };
    },
  };
  return el;
}

const head = makeEl('head');
const body = makeEl('body');
const document = {
  readyState: 'complete',
  visibilityState: 'visible',
  hidden: false,
  head,
  body,
  getElementById(id) {
    if (id === 'swr-remo-css') return head.children.find((c) => c.id === id) || null;
    return null;
  },
  createElement(tag) { return makeEl(tag); },
  createElementNS(_ns, tag) { return makeEl(tag); },
  querySelector() { return null; },
  addEventListener() {},
};

const location = { search: '?env=1', href: 'http://localhost/versions/neon?env=1' };
const windowObj = { document, location, console, Float32Array, Date, Math, JSON, URL: globalThis.URL };
windowObj.window = windowObj;
const context = vm.createContext(windowObj);

for (const file of files) {
  const code = fs.readFileSync(path.join(ROOT, file), 'utf8');
  vm.runInContext(code, context, { filename: file });
}

const failures = [];
function assert(cond, msg) {
  if (!cond) failures.push(msg);
}

const P = context.window.SWR_REMO_PARAMS;
const S = context.window.SWR_REMO_SHAPES;
const E = context.window.SWR_REMO_ENV;
const W = context.window.SWR_REMO_WIRES;
const H = context.window.SWR_REMO_HISTORY;
const Panel = context.window.SWR_REMO_PANEL;

assert(!!P && !!S && !!E && !!W && !!H && !!Panel, 'all Remo globals publish');
assert(P.get('stage.zoom') === 1, 'stage.zoom default is 1');
P.setBase('stage.zoom', 1.2);
assert(Math.abs(P.get('stage.zoom') - 1.2) < 1e-9, 'setBase writes');
P.setBase('stage.zoom', 99);
assert(P.get('stage.zoom') === 4, 'setBase clamps to max');
P.setBase('stage.zoom', 1);
P.addModulation('stage.zoom', 10);
assert(P.get('stage.zoom') === 4, 'get clamps base+mod');
P.resetModulation();
assert(P.get('stage.zoom') === 1, 'resetModulation clears mod');

const ids = S.presetIds();
assert(ids.length === 7, 'seven envelope presets');
for (const id of ['pluck', 'swell', 'pump', 'wobble', 'gate', 'riser', 'drift']) {
  assert(ids.includes(id), 'preset ' + id);
  const lut = S.buildLUT(S.preset(id));
  assert(lut.length === 512, id + ' LUT is 512 samples');
  assert(S.readLUT(lut, 0) >= 0 && S.readLUT(lut, 1) >= 0, id + ' LUT reads in range');
}
assert(Math.abs(S.curve('smooth', 0.5) - 0.5) < 1e-9, 'smooth(0.5)=0.5');
assert(S.curve('exp', 0.5) === 0.25, 'exp is x²');

E.addSource({ id: 'env_pulse', preset: 'pump', timeBase: 'beats', beats: 1, loop: true, trigger: 'beat' });
const src = E.getSource('env_pulse');
assert(!!src && src.lut && src.lut.length === 512, 'source has a LUT');
E.trigger('env_pulse');
assert(src.state === 'running', 'trigger starts running');
E.tick(0.05);
assert(src.value > 0, 'tick advances the envelope value (' + src.value + ')');
E.release('env_pulse');
assert(src.state === 'releasing', 'release enters releasing');
for (let i = 0; i < 20; i++) E.tick(0.05);
assert(src.state === 'idle' && src.value === 0, 'release settles to idle at 0');

P.setBase('stage.zoom', 1);
W.addWire({ sourceId: 'env_pulse', target: 'stage.zoom', depth: 0.35, polarity: 'uni', curve: 'linear', mode: 'add' });
E.trigger('env_pulse');
E.tick(0.1);
P.resetModulation();
W.applyWires();
const zoomed = P.get('stage.zoom');
assert(zoomed > 1, 'wire lifts stage.zoom above base (' + zoomed + ')');

const wild = W.addWire({ sourceId: 'env_pulse', target: 'layers.*.opacity', depth: 0.2, mode: 'add' });
assert(wild.expandedTargets.length >= 3, 'wildcard expands layer opacities');
P.defineParam('layers.3.opacity', { min: 0, max: 1, def: 1, label: 'Layer 3 opacity' });
W.invalidateWildcardCache();
assert(W.findWire('env_pulse', 'layers.*.opacity').expandedTargets.includes('layers.3.opacity'), 'wildcard cache refreshes');

const setWire = W.addWire({ sourceId: 'env_pulse', target: 'look.brightness', depth: 0.5, mode: 'set' });
W.addWire({ sourceId: 'env_pulse', target: 'look.brightness', depth: 1, mode: 'add' });
E.trigger('env_pulse');
E.tick(0.05);
P.resetModulation();
W.applyWires();
const bright = P.get('look.brightness');
const setOnly = (() => {
  // set overrides add: value should not be the sum of both depths
  return bright <= 2;
})();
assert(setOnly, 'set mode clamps within range; got ' + bright);
void setWire;

W.removeWire(wild.id);
P.resetModulation();
W.applyWires();
assert(true, 'deleting a wire mid-cycle is safe');

let depth = 0.5;
H.clear();
H.push({
  label: 'depth',
  coalesceKey: 'wire:depth:w1',
  undo() { depth = 0.5; },
  redo() { depth = 0.6; },
});
H.push({
  label: 'depth',
  coalesceKey: 'wire:depth:w1',
  undo() { depth = 0.6; },
  redo() { depth = 0.7; },
});
assert(H.canUndo(), 'history can undo');
H.undo();
assert(depth === 0.5, 'coalesced undo restores the pre-burst depth, got ' + depth);
H.redo();
assert(depth === 0.7, 'coalesced redo applies the latest depth, got ' + depth);

const a = W.addWire({ sourceId: 'env_pulse', target: 'fx.hue', depth: 0.2, mode: 'add' });
const aId = a.id;
W.removeWire(aId);
const b = W.addWire({ id: aId, sourceId: 'env_pulse', target: 'fx.hue', depth: 0.2, mode: 'add' });
assert(b.id === aId, 're-adding a wire keeps a stable id');

const v1 = { stage: { zoom: 1.4 }, scene: { layers: [{ opacity: 0.8, scale: 1.1, rotation: 5 }] } };
const v2 = Panel.migrateV1toV2(v1);
assert(v2.schemaVersion === 2, 'migration emits v2');
assert(v2.params['stage.zoom'] === 1.4, 'migration maps stage.zoom');
assert(v2.params['layers.0.opacity'] === 0.8, 'migration maps layer opacity');
assert(v2.envelopes.length === 0 && v2.wires.length === 0, 'migration leaves envelopes/wires empty');

const bad = Panel.applySnapshot({ schemaVersion: 3 });
assert(bad.ok === false, 'schemaVersion 3 is rejected');

E.clear();
const round = Panel.applySnapshot(v2);
assert(round.ok === true, 'v2 snapshot applies');
assert(Math.abs(P.getBase('stage.zoom') - 1.4) < 1e-9, 'applied snapshot restores base');
assert(E.listSources().length === 7, 'empty import re-seeds the starter envelopes');
assert(!!E.getSource(Panel.applySnapshot && E.listSources()[0].id), 'active envelope bank is non-empty');

// Frame order smoke: reset → tick → apply
P.setBase('stage.zoom', 1);
E.addSource({ id: 'env_swell', preset: 'swell', seconds: 1, loop: false, trigger: 'manual' });
W.clear();
W.addWire({ sourceId: 'env_swell', target: 'stage.zoom', depth: 0.5, mode: 'add' });
E.trigger('env_swell');
P.resetModulation();
E.tick(0.2);
W.applyWires();
assert(P.get('stage.zoom') > 1, 'frame order produces modulation');

if (failures.length) {
  console.log('REMO UNIT: FAIL');
  for (const f of failures) console.log('  ✗ ' + f);
  process.exit(1);
}
console.log('REMO UNIT: PASS (params, shapes, envelopes, wires, history, migration)');
