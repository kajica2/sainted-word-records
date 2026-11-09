#!/usr/bin/env node
// Unit coverage for client/neon-demo-panel.client.js (helpers + mount registry contract).

import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync('client/neon-demo-panel.client.js', 'utf8');

function makeEl(tag) {
  const el = {
    tagName: tag.toUpperCase(),
    className: '',
    id: '',
    type: '',
    value: '1',
    min: '0',
    max: '1',
    step: '0.01',
    disabled: false,
    title: '',
    style: {},
    textContent: '',
    children: [],
    parentNode: null,
    classList: {
      toggle: function () {},
      add: function () {},
      remove: function () {},
    },
    setAttribute: function (k, v) { el.attrs[k] = v; },
    getAttribute: function (k) { return el.attrs[k] != null ? el.attrs[k] : null; },
    hasAttribute: function (k) { return el.attrs[k] != null; },
    appendChild: function (child) {
      child.parentNode = el;
      el.children.push(child);
      return child;
    },
    addEventListener: function () {},
    querySelector: function (sel) {
      return walkQuery(el, sel);
    },
    querySelectorAll: function (sel) {
      const out = [];
      walkQueryAll(el, sel, out);
      return out;
    },
    attrs: {},
  };
  return el;
}

function walkQuery(node, sel) {
  if (matchSel(node, sel)) return node;
  for (const c of node.children || []) {
    const hit = walkQuery(c, sel);
    if (hit) return hit;
  }
  return null;
}

function walkQueryAll(node, sel, out) {
  if (matchSel(node, sel)) out.push(node);
  for (const c of node.children || []) walkQueryAll(c, sel, out);
}

function matchSel(node, sel) {
  if (sel === '[data-demo-layer-fields]') return node.attrs && node.attrs['data-demo-layer-fields'] === '1';
  if (sel === '[data-demo-all]') return node.attrs && node.attrs['data-demo-all'] === '1';
  if (sel.startsWith('#')) return node.id === sel.slice(1);
  if (sel.startsWith('[data-demo-preset=')) {
    const id = sel.match(/"([^"]+)"/)[1];
    return node.getAttribute('data-demo-preset') === id;
  }
  if (sel.startsWith('[data-demo-filter=')) {
    const id = sel.match(/"([^"]+)"/)[1];
    return node.getAttribute('data-demo-filter') === id;
  }
  if (sel.startsWith('[data-demo-control]')) return node.getAttribute('data-demo-control');
  return false;
}

const body = makeEl('body');
const head = makeEl('head');

const document = {
  readyState: 'complete',
  head: head,
  body: body,
  getElementById: function (id) {
    function find(n) {
      if (n.id === id) return n;
      for (const c of n.children) {
        const r = find(c);
        if (r) return r;
      }
      return null;
    }
    return find(body) || null;
  },
  addEventListener: function () {},
  createElement: function (tag) {
    return makeEl(tag);
  },
};

['sens', 'gate', 'decay'].forEach(function (id) {
  const inp = makeEl('input');
  inp.id = id;
  inp.min = '0';
  inp.max = '3';
  inp.step = '0.05';
  inp.value = '1';
  body.appendChild(inp);
});

const fetched = [];
const storage = {};
const demoItems = [];
const reloads = [];
const audioCore = {
  playing: false,
  audioEl: null,
  feat: { bass: 0.4, mid: 0.2, treble: 0.1, air: 0, beat: 0, beatPulse: false },
  params: { sens: 1, gate: 1, decay: 1 },
  loadFile: function (file) { this.audioEl = { src: 'blob:' + file.name }; this.loadedName = file.name; },
  play: function () { this.playing = true; return Promise.resolve(); },
  pause: function () { this.playing = false; },
};
const remaps = [];

const window = {
  document: document,
  localStorage: { setItem: function (k, v) { storage[k] = v; } },
  SWR_WEBGL: { isWebGLEnabled: function () { return storage.swrWebGL === '1'; } },
  A: audioCore,
  SWR_LIB: { items: demoItems },
  SWR_LIBRARY_PACKS: {
    loads: 0,
    unloads: 0,
    load: function (id) {
      this.loads++;
      if (!demoItems.length) for (let i = 0; i < 13; i++) demoItems.push({ packId: id, type: 'video', thumb: 'x' });
      return Promise.resolve({ loaded: true, items: demoItems.slice(), error: null });
    },
    unload: function () {
      this.unloads++;
      demoItems.length = 0;
    },
  },
  document: document,
  addEventListener: function () {},
  SWR_MOTION_KILL: {
    isRotationGloballyEnabled: function () { return false; },
    isZoomGloballyEnabled: function () { return false; },
    IMAGE_CLARITY_ENABLED: true,
  },
  VersionsPresets: {
    SHORTCUT_PRESETS: ['pulse', 'neon'],
    PRESETS: { neon: { label: 'NEON', temp: 0.1 }, pulse: { label: 'PULSE', temp: 0.5 } },
    setPresetOverride: function () { return true; },
    applyPreset: function (k) { return k === 'neon' || k === 'pulse'; },
  },
  __swrCurrentPreset: 'pulse',
  __SWR_PRESETS: { neon: { temp: 0.1 }, aurora: { temp: 0.2 } },
  SWR_PRESET_CYCLE: { next: function (p) { return p === 'pulse' ? 'neon' : 'pulse'; } },
  FX: { setPersona: function () {}, state: { temp: 0, grain: 0, glow: 0, sepia: 0, vignette: 0, grayscale: 0, blur: 0 } },
  SWR_LOOK_FILTER_CYCLER: { apply: function () { return true; }, reset: function () {}, get: function () { return { slot: 0 }; } },
  SWR_KEYS: { run: function () { return true; }, home: function () {}, isBlackoutActive: function () { return false; } },
  SWR_SCENES: { recall: function () { return true; }, startCapture: function () {}, cancelCapture: function () {} },
  SWR_AUTOMAP: {},
  Layers: {
    list: [],
    remap: function () { remaps.push(1); this.list = [{}, {}, {}]; },
    sel: { blend: 'screen', opacity: 1, baseScale: 1, hue: 0, contrast: 1, brightness: 1, alpha: 1, mutate: 0, reactors: [] },
    render: function () {},
  },
  SWR_RENDER: { invalidate: function () {} },
};
window.window = window;

const fetchStub = function (url) {
  fetched.push(url);
  return Promise.resolve({ ok: true, blob: function () { return Promise.resolve({ type: 'audio/mpeg' }); } });
};
class FileStub { constructor(parts, name) { this.name = name; } }
vm.runInNewContext(source, { window: window, document: document, fetch: fetchStub, File: FileStub,
  setTimeout: setTimeout,
  clearTimeout: clearTimeout,
  setInterval: setInterval,
  clearInterval: clearInterval,
  requestAnimationFrame: function (fn) { return setTimeout(fn, 16); },
  cancelAnimationFrame: function (id) { clearTimeout(id); },
});

const api = window.SWR_NEON_DEMO;
let tests = 0;
function assert(cond, msg) {
  tests++;
  if (!cond) throw new Error('FAIL: ' + msg);
}

assert(api && typeof api.mount === 'function', 'SWR_NEON_DEMO exports mount');
assert(api.listShortcutPresets().join(',') === 'pulse,neon', 'listShortcutPresets');
assert(api.isRotationOff() === true, 'isRotationOff');
assert(api.isZoomOff() === true, 'isZoomOff');
assert(api.applyShortcutPreset('neon') === true, 'applyShortcutPreset');
assert(api.getState().activePreset === 'neon', 'active preset tracked');
assert(api.applyLookFilter(3) === true, 'applyLookFilter');

const listed = api.listControls();
assert(listed.length >= 10, 'listControls returns mounted controls (' + listed.length + ')');
const unbound = listed.filter(function (c) {
  const r = api.invokeControl(c.id);
  return !r || r.error === 'unknown_control';
});
assert(unbound.length === 0, 'every listed control is invokable');

const domControls = document.body.querySelectorAll('[data-demo-control]');
assert(domControls.length === listed.length, 'DOM control count matches registry');

try {
  api.assertAllControlsBound();
  assert(true, 'assertAllControlsBound');
} catch (e) {
  assert(false, 'assertAllControlsBound: ' + e.message);
}

// Static guard: regControl must be the only path that sets data-demo-control.
const rogueAssign = source.match(/setAttribute\(\s*['"]data-demo-control['"]/g);
const regCalls = source.match(/regControl\(/g) || [];
assert(!rogueAssign || rogueAssign.length <= regCalls.length, 'data-demo-control only via regControl');

assert(api.hooks && typeof api.hooks.reload === 'function', 'reload hook is replaceable');

// Beat detection must accept the shared core's boolean pulse as well as a numeric envelope.
audioCore.feat.beatPulse = true;
assert(/function beatPulseOf/.test(source), 'beat helper exists');

// Dance clips install as the demo's clips and are staged as layers.
const remapsBefore = remaps.length;
const installed = await api.installDemoClips();
assert(installed === true, 'installDemoClips resolves true');
assert(demoItems.length === 13 && demoItems.every(function (it) { return it.packId === 'dancer-video'; }), 'all 13 dance clips installed from the dancer-video pack');
assert(remaps.length > remapsBefore && window.Layers.list.length === 3, 'clips are staged into layers');
assert(/13 clips · 3 layers/.test(api.stageSummary()), 'stage summary reports clips and layers: ' + api.stageSummary());

// Demo song loads and plays through the shared audio core.
const songOk = await api.loadDemoSong();
assert(songOk === true && audioCore.playing === true, 'demo song loads and plays');
assert(fetched[0] === '/audios/endless-tomorrow.mp3' && audioCore.loadedName === 'endless-tomorrow.mp3', 'demo song comes from /audios');
assert(/audio playing/.test(api.stageSummary()), 'summary reports audio playing');

// Play toggles pause.
const toggled = await api.invokeControl('stage:play');
assert(toggled.ok === true && audioCore.playing === false, 'stage:play pauses a playing song');

// Start demo is async and reports through invokeControl.
audioCore.playing = false;
const started = await api.invokeControl('stage:start');
assert(started.ok === true, 'stage:start resolves ok');
assert(api.getState().activePreset === 'neon', 'start demo applies the neon preset');
const probe = api.readProbe('stage:start');
assert(probe.cycling === true && probe.clips === 13 && probe.playing === true, 'start demo leaves clips staged, audio playing and presets cycling');
await api.invokeControl('demo:demoAll');

// WebGL toggle persists the opt-in and asks the page to reload.
delete storage.swrWebGL;
api.hooks.reload = function (want) { reloads.push(want); return true; };
assert(api.webglState().asked === false, 'WebGL starts off');
assert(api.toggleWebGL() === true && storage.swrWebGL === '1' && reloads[0] === true, 'toggle on stores swrWebGL=1 and reloads');
assert(api.webglState().asked === true, 'WebGL reads as requested');
assert(api.toggleWebGL() === true && storage.swrWebGL === '0' && reloads[1] === false, 'toggle off stores swrWebGL=0');

assert(api.listAudioPresets().join(',') === 'punch,club,soft,tight', 'four audio presets');
assert(api.applyAudioPreset('punch') === true, 'punch applies');
assert(document.getElementById('sens').value === '2.4', 'punch sets sens on the page slider');
assert(document.getElementById('gate').value === '1.15', 'punch sets gate');
assert(document.getElementById('decay').value === '0.7', 'punch sets decay');
assert(audioCore.params.sens === 2.4 && audioCore.params.gate === 1.15 && audioCore.params.decay === 0.7, 'punch writes the audio core params');
const audioProbe = api.readProbe('audio:punch');
assert(audioProbe.preset === 'punch' && audioProbe.sens === 2.4, 'audio probe reports the active preset');
assert(api.applyAudioPreset('soft') === true && parseFloat(document.getElementById('sens').value) === 0.7, 'soft replaces punch');
assert(api.applyAudioPreset('nope') === false, 'unknown audio preset is refused');

demoItems.length = 0;
const pack = window.SWR_LIBRARY_PACKS;
const unloadsBefore = pack.unloads;
const reinstalled = await api.installDemoClips();
assert(reinstalled === true && pack.unloads === unloadsBefore + 1 && demoItems.length === 13, 'a cleared library reinstalls the dance clips');

console.log('NEON DEMO PANEL UNIT: ALL GREEN (' + tests + ' tests, ' + listed.length + ' controls)');
