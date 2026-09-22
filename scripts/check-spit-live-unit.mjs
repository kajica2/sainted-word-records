#!/usr/bin/env node
// scripts/check-spit-live-unit.mjs — pure-logic unit tests for the
// Spit Live feature (PR 2 + 3 of 4): client/swr-spit-fx.client.js +
// client/swr-spit-runtime.client.js.
//
// 5 sections: FX trigger+validation, FX destroyAll+concurrency, FX
// constants+exports, runtime factory+state, runtime wiring. Uses
// node:vm + browser shims (window/document/localStorage/URL/Blob/navigator/AudioContext/rAF).
//
// Run:  node scripts/check-spit-live-unit.mjs
// Exit: 0 = all assertions pass, 1 = any failure, 2 = caught error.

import vm from 'node:vm';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const ROOT = path.resolve(path.dirname(__filename), '..');
const FX_SRC = path.join(ROOT, 'client/swr-spit-fx.client.js');
const RUNTIME_SRC = path.join(ROOT, 'client/swr-spit-runtime.client.js');

let failures = 0;
function assert(cond, msg, detail) {
  if (cond) console.log('  ✓', msg, detail ? `(${detail})` : '');
  else { console.log('  ✗', msg, detail ? `(${detail})` : ''); failures += 1; }
}

// ---- Mock DOM helpers --------------------------------------------------

class MockEl {
  constructor(tag) {
    this.tagName = String(tag).toUpperCase(); this.nodeType = 1;
    this.children = []; this.parentNode = null; this.attrs = {}; this.style = {};
    this.id = ''; this.textContent = ''; this.type = ''; this.eventListeners = {};
    this._removedListeners = 0; this._classSet = new Set();
    Object.defineProperty(this, 'className', {
      get() { return Array.from(this._classSet).join(' '); },
      set(v) { this._classSet.clear(); String(v || '').split(/\s+/).filter(Boolean).forEach((c) => this._classSet.add(c)); },
    });
    this.classList = { add: (c) => this._classSet.add(c), remove: (c) => this._classSet.delete(c),
      contains: (c) => this._classSet.has(c),
      toggle: (c, f) => { const h = this._classSet.has(c), n = f === undefined ? !h : !!f; n ? this._classSet.add(c) : this._classSet.delete(c); return n; } };
  }
  appendChild(c) { if (c) { this.children.push(c); c.parentNode = this; } return c; }
  removeChild(c) { const i = this.children.indexOf(c); if (i >= 0) this.children.splice(i, 1); if (c) c.parentNode = null; return c; }
  addEventListener(e, cb) { (this.eventListeners[e] = this.eventListeners[e] || []).push(cb); }
  removeEventListener() { this._removedListeners += 1; }
  setAttribute(k, v) { this.attrs[k] = String(v); }
  getAttribute(k) { return k in this.attrs ? this.attrs[k] : null; }
  querySelector() { return null; }
  querySelectorAll() { return []; }
  play() { return Promise.resolve(); }
  pause() {}
  load() {}
  closest() { return null; }
  getContext(kind) { return kind === '2d' ? makeCtx(this) : null; }
}

function makeCtx(canvas) {
  const grad = { addColorStop() {} };
  return { canvas, fillRect() {}, beginPath() {}, moveTo() {}, lineTo() {}, stroke() {}, arc() {},
    save() {}, restore() {}, translate() {}, clearRect() {}, drawImage() {}, fillText() {},
    fillStyle: '', strokeStyle: '', lineWidth: 1, globalAlpha: 1,
    globalCompositeOperation: 'source-over', filter: 'none',
    createLinearGradient: () => grad, createRadialGradient: () => grad, measureText: () => ({ width: 0 }) };
}

function find(root, sel) {
  if (!root) return null;
  if (sel[0] === '#') return root.id === sel.slice(1) ? root : null;
  if (sel[0] === '.') return root._classSet && root._classSet.has(sel.slice(1)) ? root : null;
  return null;
}
function findAll(root, sel) {
  const out = [];
  const visit = (n) => { if (find(n, sel)) out.push(n); if (Array.isArray(n.children)) n.children.forEach(visit); };
  visit(root);
  return out;
}

function makeRafTracker() {
  let id = 0;
  const log = { schedules: 0, cancels: 0 };
  return { requestAnimationFrame() { log.schedules += 1; return ++id; }, cancelAnimationFrame() { log.cancels += 1; }, log };
}

function makeTimeoutShim() {
  let id = 0;
  const log = { calls: 0 };
  return { setTimeout() { log.calls += 1; return ++id; }, clearTimeout() {}, log };
}

function makeAudioContext() {
  return function () {
    this.sampleRate = 48000; this.state = 'running'; this.destination = {};
    this.close = function () { this.state = 'closed'; };
    this.decodeAudioData = function (ab, onOK) { onOK && onOK({ duration: 2.0, sampleRate: 44100, length: 88200 }); };
    this.createMediaElementSource = () => ({ connect: () => ({ connect: () => ({ connect: () => {} }) }) });
    this.createAnalyser = () => ({ fftSize: 1024, smoothingTimeConstant: 0.8, frequencyBinCount: 512,
      getByteFrequencyData() {}, getByteTimeDomainData() {}, disconnect() {} });
    this.createMediaStreamSource = () => ({ connect: () => ({ connect: () => {} }) });
    this.createGain = () => ({ gain: { value: 0 }, connect: () => ({ connect: () => {} }) });
  };
}

function makeMediaInputMock() {
  const calls = { startMic: 0, stopMic: 0, startRecording: 0, stopRecording: 0, destroy: 0 };
  const inst = {
    _video: { stream: null, enabled: false, deviceId: null },
    _audio: { stream: null, enabled: false, sampleRate: 48000 },
    _analyser: { frequencyBinCount: 512, getByteFrequencyData() {}, getByteTimeDomainData() {} },
    getAudioData: () => ({ bass: 80, lowMid: 40, mid: 20, high: 10, presence: 5, energy: 30, voiceFundamental: 0, transient: 0 }),
    startCamera: () => Promise.resolve({ success: true }),
    stopCamera: () => Promise.resolve({ success: true }),
    startMic() { calls.startMic += 1; this._audio.enabled = true; return Promise.resolve({ success: true }); },
    stopMic() { calls.stopMic += 1; this._audio.enabled = false; return Promise.resolve({ success: true }); },
    startMonitor: () => Promise.resolve({ success: true }),
    startRecording() { calls.startRecording += 1; return Promise.resolve({ success: true, state: 'recording', mimeType: 'video/webm' }); },
    stopRecording() { calls.stopRecording += 1; return Promise.resolve({ blob: { size: 12345, type: 'video/webm' }, url: 'blob:mock-recording', size: 12345, duration: 5.0 }); },
    destroy() { calls.destroy += 1; },
  };
  return { create: () => inst, calls, inst };
}

// ---- Sandbox builders --------------------------------------------------

function buildFxContext() {
  const win = {}, rafT = makeRafTracker(), toT = makeTimeoutShim();
  const mockCanvas = new MockEl('canvas'); mockCanvas.width = 1080; mockCanvas.height = 1920;
  const body = new MockEl('body');
  const doc = { readyState: 'complete', addEventListener: () => {},
    documentElement: { style: { setProperty() {}, removeProperty() {}, cssText: '' } },
    head: { appendChild: (e) => e }, body, createElement: (t) => new MockEl(t),
    createTextNode: (t) => ({ nodeType: 3, textContent: String(t), parentNode: null }),
    querySelector: () => null, querySelectorAll: () => [] };
  const sandbox = { window: win, document: doc, console: { warn: () => {}, log: () => {}, error: () => {} },
    setTimeout: toT.setTimeout, clearTimeout: toT.clearTimeout,
    requestAnimationFrame: rafT.requestAnimationFrame, cancelAnimationFrame: rafT.cancelAnimationFrame,
    performance: { now: () => 0 }, Date, Math, JSON, Number, String, Object, Array, URLSearchParams, Promise };
  win.window = win; Object.assign(win, sandbox);
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(FX_SRC, 'utf8'), sandbox);
  return { sandbox, win, doc, rafT, toT, mockCanvas };
}

function buildRuntimeContext() {
  const win = {}, rafT = makeRafTracker(), toT = makeTimeoutShim();
  const ls = new Map(); const objectUrls = [];
  const lsShim = { getItem: (k) => ls.has(k) ? ls.get(k) : null, setItem: (k, v) => ls.set(k, String(v)),
    removeItem: (k) => ls.delete(k), clear: () => ls.clear() };
  const miMock = makeMediaInputMock();
  const body = new MockEl('body');
  const ids = ['beat-status', 'mic-status', 'rec-status', 'btn-load-beat', 'btn-mic-check',
    'btn-rec', 'btn-rec-transport', 'beat-drop', 'beat-loaded', 'beat-waveform-canvas',
    'beat-bpm', 'beat-key', 'beat-duration', 'btn-beat-prev', 'btn-beat-play', 'btn-beat-next',
    'mic-source', 'mic-gain', 'mic-monitor', 'mic-vocal-enhance', 'spit-canvas', 'layer-indicators',
    'lyric-overlay', 'punch-fx', 'spit-prev', 'spit-back', 'spit-play', 'spit-forward',
    'spit-next', 'spit-time', 'spit-save'];
  for (const id of ids) {
    const el = new MockEl(id === 'spit-canvas' ? 'canvas' : 'div'); el.id = id;
    if (id === 'spit-canvas') { el.width = 1080; el.height = 1920; }
    body.appendChild(el);
  }
  for (const fx of ['punch', 'flow', 'ride', 'stutter', 'echo', 'black']) {
    const b = new MockEl('button'); b.className = 'spit-fx-btn'; b.setAttribute('data-fx', fx); body.appendChild(b);
  }
  const doc = { readyState: 'complete', addEventListener: () => {},
    documentElement: { style: { setProperty() {}, removeProperty() {}, cssText: '' } },
    head: { appendChild: (e) => e }, body, createElement: (t) => new MockEl(t),
    createTextNode: (t) => ({ nodeType: 3, textContent: String(t), parentNode: null }),
    querySelector(sel) { return findAll(body, sel)[0] || null; },
    querySelectorAll(sel) { return findAll(body, sel); },
    getElementById(id) { return findAll(body, '#' + id)[0] || null; } };
  const analysisV2 = { analyzeBuffer: (b) => ({ bpm: 92, key: 'C', scale: 'minor', duration: b.duration || 2.0 }) };
  const AudioContext = makeAudioContext();
  const sandbox = { window: win, document: doc, localStorage: lsShim,
    URL: { createObjectURL: (b) => { const u = 'blob:mock-' + objectUrls.length; objectUrls.push({ u, b }); return u; }, revokeObjectURL() {} },
    Blob: function (parts, init) { const t = (parts || []).join(''); return { size: t.length, type: (init && init.type) || '' }; },
    HTMLCanvasElement: function () {}, console: { warn: () => {}, log: () => {}, error: () => {} },
    setTimeout: toT.setTimeout, clearTimeout: toT.clearTimeout,
    requestAnimationFrame: rafT.requestAnimationFrame, cancelAnimationFrame: rafT.cancelAnimationFrame,
    AudioContext, AudioAnalysisV2: analysisV2,
    SWR_MEDIA_INPUT: miMock,
    SWR_CAMERA_PREVIEW: { mount: () => null, unmount: () => false },
    SWR_MIC_METER: { mount: () => null, unmount: () => false },
    SWR_SPIT_FX: null, performance: { now: () => 0 },
    navigator: { mediaDevices: { getUserMedia: () => Promise.resolve({ getTracks: () => [], getVideoTracks: () => [], getAudioTracks: () => [] }),
      enumerateDevices: () => Promise.resolve([]) } },
    Date, Math, JSON, Number, String, Object, Array, URLSearchParams, Promise };
  win.window = win; Object.assign(win, sandbox);
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(FX_SRC, 'utf8'), sandbox);
  vm.runInContext(fs.readFileSync(RUNTIME_SRC, 'utf8'), sandbox);
  return { sandbox, win, doc, lsShim, rafT, toT, miMock, objectUrls, docBody: body };
}

// ---- Section 1: SWR_SPIT_FX trigger + validation -----------------------

async function section1() {
  console.log('\n=== 1. SWR_SPIT_FX trigger + validation ===');
  const { win, mockCanvas } = buildFxContext();
  const FX = win.SWR_SPIT_FX;
  const mockCtx = mockCanvas.getContext('2d');

  for (const fx of FX.FX_NAMES) {
    const r = FX.trigger(fx, mockCtx);
    assert(r && r.success === true, `trigger('${fx}') returns success:true`);
    assert(r.fx === fx, `trigger('${fx}') echoes fx name`);
    assert(typeof r.duration === 'number' && r.duration > 0, `trigger('${fx}') duration > 0`, String(r.duration));
    assert(typeof r.id === 'number' && r.id > 0, `trigger('${fx}') id > 0`, String(r.id));
  }

  FX.destroyAll();
  assert(FX.trigger('punch', mockCtx).duration === 220, 'punch duration === 220ms');
  assert(FX.trigger('ride', mockCtx).duration === 500, 'ride duration === 500ms');
  assert(FX.trigger('stutter', mockCtx).duration === 240, 'stutter duration === 240ms');
  assert(FX.trigger('echo', mockCtx).duration === 400, 'echo duration === 400ms');
  assert(FX.trigger('black', mockCtx).duration === 800, 'black duration === 800ms');
  assert(FX.trigger('flow', mockCtx).duration === 700, 'flow duration === 700ms (default)');

  const rBad = FX.trigger('not-a-fx', mockCtx);
  assert(rBad && rBad.success === false && rBad.error === 'unknown_fx',
    "trigger('not-a-fx') → { success:false, error:'unknown_fx' }");
  assert(FX.trigger('punch', null).error === 'no_canvas_context',
    "trigger('punch', null) → no_canvas_context");
  assert(FX.trigger('punch', {}).error === 'no_canvas_context',
    "trigger('punch', {}) → no_canvas_context (ctx.canvas missing)");

  assert(Array.isArray(FX.FX_NAMES) && FX.FX_NAMES.length === 6,
    'FX_NAMES has exactly 6 entries', String(FX.FX_NAMES.length));
  assert(FX.FX_NAMES.join(',') === 'punch,flow,ride,stutter,echo,black',
    'FX_NAMES is in canonical order');
}

// ---- Section 2: SWR_SPIT_FX destroyAll + concurrency -------------------

async function section2() {
  console.log('\n=== 2. SWR_SPIT_FX destroyAll + concurrency ===');
  const { win, mockCanvas, rafT, toT } = buildFxContext();
  const FX = win.SWR_SPIT_FX;
  const mockCtx = mockCanvas.getContext('2d');

  let threw = false;
  try { FX.destroyAll(); } catch (_) { threw = true; }
  assert(threw === false, 'destroyAll() on empty registry does not throw');

  const r1 = FX.trigger('punch', mockCtx);
  FX.destroyAll();
  const r2 = FX.trigger('punch', mockCtx);
  assert(r2.success && r2.id > r1.id, 'trigger after destroyAll returns new id', `${r1.id} → ${r2.id}`);

  FX.destroyAll();
  const rA = FX.trigger('punch', mockCtx);
  const rB = FX.trigger('punch', mockCtx);
  assert(rA.success && rB.success && rA.id !== rB.id,
    'two concurrent trigger() return different ids', `${rA.id} vs ${rB.id}`);

  const cancelsBefore = rafT.log.cancels;
  FX.destroyAll();
  assert(rafT.log.cancels - cancelsBefore === 2,
    'destroyAll() processed 2 concurrent FX entries (cancel delta === 2)',
    String(rafT.log.cancels - cancelsBefore));

  FX.destroyAll();
  const toBefore = toT.log.calls;
  FX.trigger('flow', mockCtx); FX.trigger('stutter', mockCtx); FX.trigger('echo', mockCtx);
  assert(toT.log.calls - toBefore === 3,
    '3 triggers scheduled 3 cleanup timers (setTimeout delta === 3)',
    String(toT.log.calls - toBefore));
}

// ---- Section 3: SWR_SPIT_FX constants + exports ------------------------

async function section3() {
  console.log('\n=== 3. SWR_SPIT_FX constants + exports ===');
  const { win } = buildFxContext();
  const FX = win.SWR_SPIT_FX;
  assert(FX.FX_PUNCH === 'punch', "FX_PUNCH === 'punch'");
  assert(FX.FX_FLOW === 'flow', "FX_FLOW === 'flow'");
  assert(FX.FX_RIDE === 'ride', "FX_RIDE === 'ride'");
  assert(FX.FX_STUTTER === 'stutter', "FX_STUTTER === 'stutter'");
  assert(FX.FX_ECHO === 'echo', "FX_ECHO === 'echo'");
  assert(FX.FX_BLACK === 'black', "FX_BLACK === 'black'");
  assert(FX.HOLD_MS === 700, 'HOLD_MS === 700', String(FX.HOLD_MS));
  assert(FX.HOLD_MS_PUNCH === 220, 'HOLD_MS_PUNCH === 220', String(FX.HOLD_MS_PUNCH));
  assert(FX.HOLD_MS_BLACK === 800, 'HOLD_MS_BLACK === 800', String(FX.HOLD_MS_BLACK));
}

// ---- Section 4: SWR_SPIT runtime factory + state -----------------------

async function section4() {
  console.log('\n=== 4. SWR_SPIT runtime factory + state ===');
  const { win, doc, miMock } = buildRuntimeContext();
  const SR = win.SWR_SPIT;
  const mockCanvas = doc.getElementById('spit-canvas');

  const inst = SR.create(mockCanvas, {});
  assert(inst !== null && typeof inst === 'object', 'create() returns an instance');
  for (const m of ['loadBeat', 'playBeat', 'pauseBeat', 'seekBeat', 'toggleMic',
    'triggerFx', 'startRecording', 'stopRecording', 'getState', 'destroy']) {
    assert(typeof inst[m] === 'function', `instance has ${m}()`);
  }
  assert(inst.getState().state === 'ready', "create() _boot() → state === 'ready'");

  const keys = ['state', 'hasBeat', 'beatInfo', 'micOn', 'cameraOn', 'recording', 'fxQueue', 'lastError'];
  assert(keys.every((k) => k in inst.getState()), 'getState() returns all 8 documented keys');
  assert(SR.STATES && SR.STATES.LOADING === 'loading' && SR.STATES.READY === 'ready'
    && SR.STATES.RECORDING === 'recording' && SR.STATES.SAVED === 'saved',
    'STATES export has LOADING/READY/RECORDING/SAVED');

  const fakeBlob = { name: 'fake-beat.mp3', type: 'audio/mpeg',
    arrayBuffer: () => Promise.resolve(new Uint8Array(2048).buffer) };
  const lb = await inst.loadBeat(fakeBlob);
  assert(lb && lb.success === true, 'loadBeat(fakeBlob) → success:true');
  assert(lb.bpm === 92, 'loadBeat returns bpm', String(lb.bpm));
  assert(lb.key === 'C', 'loadBeat returns key', lb.key);
  assert(lb.scale === 'minor', 'loadBeat returns scale', lb.scale);
  assert(typeof lb.duration === 'number' && lb.duration > 0, 'loadBeat returns duration > 0', String(lb.duration));
  assert(inst.getState().hasBeat === true && inst.getState().beatInfo.bpm === 92,
    'post-loadBeat: hasBeat=true, beatInfo.bpm=92');

  const lbBad = await inst.loadBeat({ name: 'x.txt', type: 'text/plain',
    arrayBuffer: () => Promise.resolve(new Uint8Array(8).buffer) });
  assert(lbBad && lbBad.success === false && lbBad.error === 'unsupported_type',
    "loadBeat(non-audio) → { success:false, error:'unsupported_type' }");

  const tm = await inst.toggleMic();
  assert(tm && tm.success === true && tm.enabled === true,
    'toggleMic() → { success:true, enabled:true }', JSON.stringify(tm));
  assert(inst.getState().micOn === true, 'post-toggleMic: micOn === true');
  const tmOff = await inst.toggleMic();
  assert(tmOff && tmOff.success === true && tmOff.enabled === false,
    'second toggleMic() → { success:true, enabled:false }');

  const fxOn = inst.triggerFx('punch');
  assert(fxOn && fxOn.success === true && fxOn.fx === 'punch',
    "triggerFx('punch') → { success:true, fx:'punch' }");

  // Runtime's triggerFx always returns { success:true, fx } when FX module
  // is loaded; the underlying FX failure surfaces via onFxTrigger.
  let onFxResult = null;
  const inst2 = SR.create(doc.getElementById('spit-canvas'), {
    onFxTrigger: (evt) => { onFxResult = evt; },
  });
  const fxBad = inst2.triggerFx('not-a-fx');
  assert(fxBad && fxBad.success === true && fxBad.fx === 'not-a-fx',
    "triggerFx('not-a-fx') runtime: { success:true, fx:'not-a-fx' }", JSON.stringify(fxBad));
  assert(onFxResult && onFxResult.result && onFxResult.result.success === false
    && onFxResult.result.error === 'unknown_fx',
    'triggerFx surfaces underlying FX failure via onFxTrigger');
  inst2.destroy();

  const fxQueue = inst.getState().fxQueue;
  assert(Array.isArray(fxQueue) && fxQueue.length > 0 && fxQueue.some((q) => q.name === 'punch'),
    'getState().fxQueue records triggerFx calls', String(fxQueue.length) + ' entries');

  let threw = false;
  try { inst.destroy(); inst.destroy(); inst.destroy(); } catch (_) { threw = true; }
  assert(threw === false, 'destroy() called 3x does not throw');
  assert(inst._destroyed === true, 'post-destroy: _destroyed === true');
}

// ---- Section 5: SWR_SPIT runtime wiring --------------------------------

async function section5() {
  console.log('\n=== 5. SWR_SPIT runtime wiring ===');
  const { win, doc, miMock } = buildRuntimeContext();
  const SR = win.SWR_SPIT;
  const mockCanvas = doc.getElementById('spit-canvas');

  const inst = SR.create(mockCanvas, {});
  let threw = false;
  try { inst.playBeat(); inst.pauseBeat(); inst.seekBeat(0); inst.seekBeat(5); } catch (_) { threw = true; }
  assert(threw === false, 'playBeat/pauseBeat/seekBeat on fresh instance do not throw');
  assert(typeof inst.playBeat() === 'boolean', 'playBeat() returns a boolean');

  assert(Array.isArray(inst._handlers) && inst._handlers.length > 0,
    'after _boot(): _handlers has entries', String(inst._handlers.length));
  const fxHandlers = inst._handlers.filter((h) => h.el && h.el._classSet && h.el._classSet.has('spit-fx-btn'));
  assert(fxHandlers.length === 6, '6 FX button click handlers registered', String(fxHandlers.length));

  const rec = await inst.startRecording();
  assert(rec && rec.success === true, 'startRecording() → success:true');
  assert(rec.state === 'recording', 'startRecording returns state="recording"');
  assert(miMock.calls.startRecording === 1, 'mediaInput.startRecording called once', String(miMock.calls.startRecording));
  assert(inst.getState().recording === true, 'post-startRecording: recording === true');

  const stop = await inst.stopRecording();
  assert(stop && stop.success === true, 'stopRecording() → success:true');
  assert(stop.blob && typeof stop.blob.size === 'number', 'stopRecording returns blob with size');
  assert(typeof stop.url === 'string' && stop.url.indexOf('blob:') === 0, 'stopRecording returns blob URL');
  assert(typeof stop.size === 'number' && stop.size > 0, 'stopRecording returns size > 0');
  assert(typeof stop.duration === 'number', 'stopRecording returns duration');
  assert(miMock.calls.stopRecording === 1, 'mediaInput.stopRecording called once');

  inst.destroy();
  assert(inst._handlers.length === 0, 'post-destroy: _handlers is empty (unwired)');
  const totalRemoves = doc.body.children.reduce((a, e) => a + (e._removedListeners || 0), 0);
  assert(totalRemoves > 0, 'post-destroy: removeEventListener invoked', String(totalRemoves));
}

// ---- Run ----

async function main() {
  await section1();
  await section2();
  await section3();
  await section4();
  await section5();

  console.log('\n' + (failures === 0
    ? 'SPIT-LIVE UNIT: all assertions passed'
    : `SPIT-LIVE UNIT: ${failures} failure(s)`));
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error('CAUGHT:', e.stack);
  process.exit(2);
});
