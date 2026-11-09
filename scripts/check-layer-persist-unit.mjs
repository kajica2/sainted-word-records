// scripts/check-layer-persist-unit.mjs
// Staging a clip must write the page snapshot so the next visit restores
// those assets onto the stage. Layers.add used to skip the change event,
// and persist-wire only saved on control input / remap.

import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const LAYERS = readFileSync(new URL('../lib/layers.client.js', import.meta.url), 'utf8');
const PERSIST = readFileSync(new URL('../lib/persist.client.js', import.meta.url), 'utf8');
const WIRE = readFileSync(new URL('../lib/persist-wire.client.js', import.meta.url), 'utf8');

const results = [];
function check(name, fn) {
  let ok = false;
  let detail = '';
  try {
    const r = fn();
    ok = r === true;
    detail = typeof r === 'string' ? r : '';
  } catch (e) {
    detail = e && e.message ? e.message : String(e);
  }
  results.push({ name, ok, detail });
  console.log((ok ? '  PASS  ' : '  FAIL  ') + name + (detail ? ' — ' + detail : ''));
}

function makeNode(tag) {
  const n = {
    tagName: String(tag || 'div').toUpperCase(),
    children: [],
    style: {},
    className: '',
    dataset: {},
    value: '',
    parentNode: null,
    appendChild(c) { c.parentNode = this; this.children.push(c); return c; },
    removeChild(c) {
      c.parentNode = null;
      this.children = this.children.filter((x) => x !== c);
    },
    setAttribute() {},
    removeAttribute() {},
    addEventListener() {},
    removeEventListener() {},
    querySelector() { return makeNode('span'); },
    querySelectorAll() { return []; },
  };
  n.classList = {
    add() {}, remove() {}, toggle() { return false; }, contains() { return false; },
  };
  return n;
}

function loadLayers() {
  const events = [];
  const layerList = makeNode('div');
  layerList.id = 'layer-list';
  const sandbox = {
    console: { warn() {}, log() {}, info() {}, error() {} },
    setStatus() {},
    setTimeout,
    clearTimeout,
    CustomEvent: class {
      constructor(type, init) { this.type = type; this.detail = init && init.detail; }
    },
    document: {
      body: makeNode('body'),
      createElement: (tag) => makeNode(tag),
      createDocumentFragment: () => makeNode('fragment'),
      getElementById: (id) => (id === 'layer-list' ? layerList : makeNode('div')),
      querySelector: () => makeNode('div'),
      querySelectorAll: () => [],
      addEventListener(type, fn) {
        if (!this._listeners) this._listeners = {};
        (this._listeners[type] || (this._listeners[type] = [])).push(fn);
      },
      removeEventListener() {},
      dispatchEvent(ev) {
        events.push(ev);
        const list = (this._listeners && this._listeners[ev.type]) || [];
        for (const fn of list) fn(ev);
        return true;
      },
    },
  };
  sandbox.window = sandbox;
  sandbox.Image = function Image() { this.src = ''; };
  vm.createContext(sandbox);
  vm.runInContext(LAYERS, sandbox);
  return { Layers: sandbox.Layers, events, sandbox };
}

check('adding a clip fires swr-layers-changed', () => {
  const { Layers, events } = loadLayers();
  Layers.add({ id: 11, name: 'clip.mp4', type: 'video', url: 'x' });
  const hit = events.filter((e) => e.type === 'swr-layers-changed');
  if (hit.length !== 1) return 'events ' + hit.length;
  if (!hit[0].detail || hit[0].detail.count !== 1) return 'detail ' + JSON.stringify(hit[0].detail);
  return true;
});

check('removing the last clip fires the change event again', () => {
  const { Layers, events } = loadLayers();
  const layer = Layers.add({ id: 12, name: 'clip.mp4', type: 'video', url: 'x' });
  Layers.remove(layer.id);
  const hit = events.filter((e) => e.type === 'swr-layers-changed');
  if (hit.length !== 2) return 'events ' + hit.length;
  if (hit[1].detail.count !== 0) return 'count ' + hit[1].detail.count;
  return true;
});

check('a remap fires swr-layers-changed', () => {
  const { Layers, events, sandbox } = loadLayers();
  sandbox.Library = {
    items: [
      { id: 1, name: 'a', type: 'video', url: 'a', motion: 0.8, luma: 0.4, hue: 0.2 },
      { id: 2, name: 'b', type: 'video', url: 'b', motion: 0.3, luma: 0.6, hue: 0.5 },
    ],
  };
  Layers.autoMap();
  const hit = events.filter((e) => e.type === 'swr-layers-changed');
  if (hit.length < 1) return 'no change event';
  if (Layers.list.length < 1) return 'remap built nothing';
  return true;
});

check('persist-wire saves the stack when layers change', () => {
  if (!/swr-layers-changed/.test(WIRE)) return 'persist-wire does not listen for layer changes';
  if (!/scheduleSave/.test(WIRE)) return 'persist-wire has no scheduleSave';
  return true;
});

check('a saved stack restores the same asset ids', () => {
  const store = {};
  const sandbox = {
    console: { warn() {}, log() {}, info() {}, error() {} },
    localStorage: {
      getItem(k) { return Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null; },
      setItem(k, v) { store[k] = String(v); },
      removeItem(k) { delete store[k]; },
    },
    window: null,
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(PERSIST, sandbox);
  const P = sandbox.SWR_GRID_PERSIST;
  if (!P) return 'SWR_GRID_PERSIST missing';
  const pageId = 'engine';
  const snap = {
    pageId,
    version: 1,
    savedAt: Date.now(),
    selectedLayerId: null,
    layers: [
      { id: 'L1', assetId: 42, blend: 'screen', opacity: 1, baseScale: 1.2,
        contrast: 1, brightness: 1, alpha: 1, mutate: 0, hue: 0,
        pos: { x: 0, y: 0, rot: 0 }, rotOffset: 0, rotationEnabled: false,
        snapBeat: false, reactors: [], algo: 'none', algoIntensity: 0 },
      { id: 'L2', assetId: 7, blend: 'lighter', opacity: 0.9, baseScale: 0.8,
        contrast: 1, brightness: 1, alpha: 1, mutate: 0, hue: 0,
        pos: { x: 0, y: 0, rot: 0 }, rotOffset: 0, rotationEnabled: false,
        snapBeat: false, reactors: [], algo: 'none', algoIntensity: 0 },
    ],
    global: {},
    presets: [],
  };
  if (!P.saveEngineState(pageId, snap)) return 'save failed';
  const loaded = P.loadEngineState(pageId);
  if (!loaded || loaded.version !== 1) return 'load failed';
  if (!Array.isArray(loaded.layers) || loaded.layers.length !== 2) {
    return 'layer count ' + (loaded.layers && loaded.layers.length);
  }
  if (loaded.layers[0].assetId !== 42 || loaded.layers[1].assetId !== 7) {
    return 'asset ids ' + loaded.layers.map((l) => l.assetId).join(',');
  }
  const lib = [
    { id: 7, name: 'b.mp4', type: 'video' },
    { id: 42, name: 'a.mp4', type: 'video' },
  ];
  const restored = loaded.layers.map((ls) => ({
    id: ls.id,
    asset: lib.find((x) => x.id === ls.assetId) || null,
  }));
  if (!restored[0].asset || restored[0].asset.name !== 'a.mp4') return 'first asset missing';
  if (!restored[1].asset || restored[1].asset.name !== 'b.mp4') return 'second asset missing';
  return true;
});

check('a text layer round-trips kind and text', () => {
  if (!/kind === 'text'/.test(WIRE) && !/l\.kind === 'text'/.test(WIRE)) {
    return 'persist-wire does not write text layers';
  }
  if (!/ls\.kind === 'text'/.test(WIRE)) return 'persist-wire does not restore text layers';
  const store = {};
  const sandbox = {
    console: { warn() {}, log() {}, info() {}, error() {} },
    localStorage: {
      getItem(k) { return Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null; },
      setItem(k, v) { store[k] = String(v); },
      removeItem(k) { delete store[k]; },
    },
    window: null,
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(PERSIST, sandbox);
  const P = sandbox.SWR_GRID_PERSIST;
  const pageId = 'engine';
  const snap = {
    pageId,
    version: 1,
    savedAt: Date.now(),
    selectedLayerId: null,
    layers: [{
      id: 'T1', kind: 'text', text: 'hello stage', font: 'sans-serif',
      size: 64, weight: 700, family: 'sans-serif', color: '#fff', glow: '#000',
      assetId: null, blend: 'source-over', opacity: 1, baseScale: 1,
      contrast: 1, brightness: 1, alpha: 1, mutate: 0, hue: 0,
      pos: { x: 10, y: -4, rot: 0 }, rotOffset: 0, rotationEnabled: false,
      snapBeat: false, reactors: [], algo: 'none', algoIntensity: 0,
    }],
    global: {},
    presets: [],
  };
  if (!P.saveEngineState(pageId, snap)) return 'save failed';
  const loaded = P.loadEngineState(pageId);
  if (!loaded || !loaded.layers || loaded.layers.length !== 1) return 'load failed';
  const row = loaded.layers[0];
  if (row.kind !== 'text') return 'kind ' + row.kind;
  if (row.text !== 'hello stage') return 'text ' + row.text;
  if (row.assetId != null) return 'unexpected assetId';
  return true;
});

const fail = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - fail} passed, ${fail} failed (${results.length} checks)`);
if (fail) process.exit(1);
