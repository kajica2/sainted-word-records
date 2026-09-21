#!/usr/bin/env node
// scripts/check-media-input-unit.mjs — pure-logic unit tests for the
// MediaInput foundation: client/swr-media-input.client.js +
// client/swr-camera-preview.client.js + client/swr-mic-meter.client.js.
//
// 5 sections (factory/state, codec, audio, camera-preview, mic-meter).
// Uses node:vm + browser shims; mocked navigator.mediaDevices,
// MediaRecorder, AudioContext, rAF. See scripts/check-capture-unit.mjs
// for the node:vm sandbox pattern.
//
// Run:  node scripts/check-media-input-unit.mjs
// Exit: 0 = all assertions pass, 1 = any failure, 2 = caught error.

import vm from 'node:vm';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..');
const MEDIA_INPUT_SRC = path.join(ROOT, 'client/swr-media-input.client.js');
const CAMERA_PREVIEW_SRC = path.join(ROOT, 'client/swr-camera-preview.client.js');
const MIC_METER_SRC = path.join(ROOT, 'client/swr-mic-meter.client.js');

let failures = 0;
function assert(cond, msg, detail) {
  if (cond) console.log('  ✓', msg, detail ? `(${detail})` : '');
  else { console.log('  ✗', msg, detail ? `(${detail})` : ''); failures += 1; }
}

// ---- Browser shims ----

// DOM-ish element. classList <-> className sync, appendChild / removeChild
// track parentNode, supports the subset of the DOM API the 3 modules hit.
class MockElement {
  constructor(tag) {
    this.tagName = String(tag).toUpperCase();
    this.nodeType = 1;  // ELEMENT_NODE — required by _getTarget
    this.children = []; this.parentNode = null;
    this.attrs = {}; this.style = {}; this.id = '';
    this.textContent = ''; this.type = ''; this.srcObject = null;
    this.width = 0; this.height = 0;
    this.eventListeners = {};
    this._classSet = new Set();
    const set = this._classSet;
    Object.defineProperty(this, 'className', {
      get() { return Array.from(set).join(' '); },
      set(v) {
        set.clear();
        String(v || '').split(/\s+/).filter(Boolean).forEach((c) => set.add(c));
      },
    });
    this.classList = {
      add: (c) => set.add(c), remove: (c) => set.delete(c),
      contains: (c) => set.has(c),
      toggle(c, force) {
        const has = set.has(c), next = force === undefined ? !has : !!force;
        if (next) set.add(c); else set.delete(c);
        return next;
      },
    };
  }
  appendChild(c) { if (c) { this.children.push(c); c.parentNode = this; } return c; }
  removeChild(c) { const i = this.children.indexOf(c); if (i >= 0) this.children.splice(i, 1); if (c) c.parentNode = null; return c; }
  addEventListener(e, cb) { (this.eventListeners[e] = this.eventListeners[e] || []).push(cb); }
  setAttribute(k, v) { this.attrs[k] = String(v); }
  getAttribute(k) { return k in this.attrs ? this.attrs[k] : null; }
  querySelector(sel) { return findFirst(this, sel); }
  querySelectorAll(sel) { return findAll(this, sel); }
  play() { return Promise.resolve(); }
  getContext(kind) { return kind === '2d' ? makeMockCtx(this) : null; }
}

function makeMockCtx(canvas) {
  return {
    canvas,
    fillRect() {}, beginPath() {}, moveTo() {}, lineTo() {}, stroke() {},
    fillStyle: '', strokeStyle: '', lineWidth: 1,
  };
}

// Recursive descendant search (returns first match). Skips non-element
// children (e.g. text nodes) — they have no `.children` array.
function findFirst(root, sel) {
  if (matches(root, sel)) return root;
  if (!root || !Array.isArray(root.children)) return null;
  for (const c of root.children) {
    const hit = findFirst(c, sel);
    if (hit) return hit;
  }
  return null;
}

function findAll(root, sel) {
  const out = [];
  const visit = (n) => {
    if (matches(n, sel)) out.push(n);
    if (!n || !Array.isArray(n.children)) return;
    for (const c of n.children) visit(c);
  };
  visit(root);
  return out;
}

// Selector matcher — supports .class (single), tag, and #id. The 3 modules
// only use these forms.
function matches(node, sel) {
  if (!node || typeof sel !== 'string') return false;
  if (sel.startsWith('.')) {
    const cls = sel.slice(1);
    return node._classSet && node._classSet.has(cls);
  }
  if (sel.startsWith('#')) {
    return node.id === sel.slice(1);
  }
  return node.tagName === sel.toUpperCase();
}

// In-memory localStorage.
function makeStorage(initial = {}) {
  const m = new Map();
  Object.entries(initial).forEach(([k, v]) => m.set(k, String(v)));
  return {
    getItem(k) { return m.has(k) ? m.get(k) : null; },
    setItem(k, v) { m.set(k, String(v)); },
    removeItem(k) { m.delete(k); },
    clear() { m.clear(); },
    _dump() { return Object.fromEntries(m); },
  };
}

// Tracks rAF + cancel calls so we can assert idempotence without
// actually running the frame loop (which would recurse forever).
function makeRafTracker() {
  let nextId = 0;
  const cbs = new Map();
  const log = { schedules: 0, cancels: 0 };
  return {
    requestAnimationFrame(cb) {
      log.schedules += 1;
      const id = ++nextId;
      cbs.set(id, cb);
      return id;
    },
    cancelAnimationFrame(id) {
      log.cancels += 1;
      cbs.delete(id);
    },
    log,
  };
}

// Mock MediaRecorder: the constructor records its options so we can
// observe which MIME the picker landed on. isTypeSupported is a probe
// table that the test swaps between runs.
function makeMediaRecorder(initialSupported = []) {
  const rec = {
    _supported: new Set(initialSupported),
    _lastInstance: null,
    _lastOpts: null,
    isTypeSupported(m) { return rec._supported.has(m); },
    setSupported(list) { rec._supported = new Set(list); },
    clearSupported() { rec._supported.clear(); },
  };
  rec.MediaRecorder = function MediaRecorder(stream, opts) {
    rec._lastInstance = this;
    rec._lastOpts = opts || {};
    this.stream = stream;
    this.mimeType = (opts && opts.mimeType) || '';
    this.state = 'inactive';
    this.ondataavailable = null;
    this.onstop = null;
    this.start = function () { this.state = 'recording'; };
    this.stop = function () {
      this.state = 'inactive';
      if (typeof this.onstop === 'function') this.onstop();
    };
  };
  rec.MediaRecorder.isTypeSupported = rec.isTypeSupported;
  return rec;
}

// Mock AudioContext: tracks each construction so we can assert close()
// is called for owned-context unmount paths. The analyser returned has
// zero-filled buffers; callers can swap in a richer fake via
// setAnalyserFactory().
function makeAudioContext({ sampleRate = 48000 } = {}) {
  const log = { constructs: 0, closes: 0 };
  function AudioContext(opts) {
    log.constructs += 1;
    this.sampleRate = (opts && opts.sampleRate) || sampleRate;
    this.state = 'running';
    this.destination = {};
    this._closed = false;
  }
  AudioContext.prototype.createAnalyser = () => ({
    fftSize: 2048, smoothingTimeConstant: 0.8, frequencyBinCount: 1024,
    getByteFrequencyData() {}, getByteTimeDomainData() {},
  });
  AudioContext.prototype.createMediaStreamSource = () => ({ connect() {} });
  AudioContext.prototype.createGain = () => ({ gain: { value: 0 }, connect() {} });
  AudioContext.prototype.close = function () { log.closes += 1; this._closed = true; this.state = 'closed'; };
  return { AudioContext, log };
}

// Builds a sandbox wired with browser shims + the optional mocks. Then
// loads the 3 modules in dependency order (media-input first because
// camera-preview auto-creates an instance via window.SWR_MEDIA_INPUT).
// Returns the context handle.
function buildContext(opts = {}) {
  const {
    storage,
    mediaRecorder,
    audioContext,
    raf,
    enumerateDevices,
    getUserMedia,
    document: docOverride,
  } = opts;

  const ls = storage || makeStorage();
  const rafT = raf || makeRafTracker();
  const rec = mediaRecorder || makeMediaRecorder([
    'video/webm;codecs=vp9,opus',
    'video/webm;codecs=vp8,opus',
    'video/webm',
  ]);
  const ac = audioContext || makeAudioContext();
  const getUM = getUserMedia || (() => Promise.resolve(makeMediaStream('video')));
  const enumD = enumerateDevices || (() => Promise.resolve([
    { kind: 'videoinput', deviceId: 'fake-vid-1', label: 'Fake Cam' },
    { kind: 'audioinput', deviceId: 'fake-mic-1', label: 'Fake Mic' },
  ]));

  const win = {};
  const doc = docOverride || {
    readyState: 'complete',
    addEventListener: () => {},
    documentElement: { style: { setProperty() {}, removeProperty() {}, cssText: '' } },
    head: { appendChild(el) { return el; } },
    body: new MockElement('body'),
    createElement: (tag) => new MockElement(tag),
    createTextNode: (text) => ({ nodeType: 3, textContent: String(text), parentNode: null }),
    querySelector: (sel) => findFirst(doc.body, sel),
    querySelectorAll: (sel) => findAll(doc.body, sel),
  };

  const createdUrls = [];
  const revokedUrls = [];

  const sandbox = {
    window: win, document: doc, localStorage: ls,
    URL: {
      createObjectURL: (blob) => { const u = 'blob:mock-' + createdUrls.length; createdUrls.push({ url: u, blob }); return u; },
      revokeObjectURL: (u) => { revokedUrls.push(u); },
    },
    Blob: function (parts, init) { const text = (parts || []).join(''); return { size: text.length, type: (init && init.type) || '' }; },
    HTMLCanvasElement: function () {},
    console: { warn: () => {}, log: () => {}, error: () => {} },
    setTimeout: (cb) => { cb(); return 0; }, clearTimeout: () => {},
    requestAnimationFrame: rafT.requestAnimationFrame,
    cancelAnimationFrame: rafT.cancelAnimationFrame,
    AudioContext: ac.AudioContext,
    MediaRecorder: rec.MediaRecorder,
    MediaStream: function MediaStream(tracks) {
      const list = (tracks || []).slice();
      this.getTracks = () => list.slice();
      this.getVideoTracks = () => list.filter((t) => t && t.kind === 'video');
      this.getAudioTracks = () => list.filter((t) => t && t.kind === 'audio');
    },
    navigator: { mediaDevices: { getUserMedia: getUM, enumerateDevices: enumD } },
    Date, Math, JSON, Number, String, Object, Array, URLSearchParams, Promise,
  };

  // Mirror every sandbox global onto the window object so the IIFE can
  // resolve `window.foo` indifferently to either a direct global or a
  // property on `window`.
  win.window = win;
  for (const k of Object.keys(sandbox)) if (k !== 'window') win[k] = sandbox[k];

  vm.createContext(sandbox);
  loadInto(sandbox, MEDIA_INPUT_SRC);
  loadInto(sandbox, CAMERA_PREVIEW_SRC);
  loadInto(sandbox, MIC_METER_SRC);

  return { sandbox, win, doc, ls, rec, ac, rafT, createdUrls, revokedUrls, getUserMedia: getUM, enumerateDevices: enumD };
}

function loadInto(sandbox, srcPath) {
  const src = fs.readFileSync(srcPath, 'utf8');
  vm.runInContext(src, sandbox);
}

// Fake MediaStream — video or audio tracks, distinguishable by kind.
function makeMediaStream(kind /* 'video' | 'audio' */) {
  const stop = function () { this.stopped = true; };
  const tracks = kind === 'video'
    ? [{ kind: 'video', stopped: false, stop, getSettings: () => ({ deviceId: 'fake-vid-1', width: 1280, height: 720, facingMode: 'user' }) }]
    : [{ kind: 'audio', stopped: false, stop, getSettings: () => ({ deviceId: 'fake-mic-1' }) }];
  return {
    getTracks: () => tracks.slice(),
    getVideoTracks: () => (kind === 'video' ? tracks.slice() : []),
    getAudioTracks: () => (kind === 'audio' ? tracks.slice() : []),
  };
}

// ---- Section 1: MediaInput factory + state ----

async function section1() {
  console.log('\n=== 1. MediaInput factory + state ===');
  const ctx = buildContext();
  const SM = ctx.win.SWR_MEDIA_INPUT;

  // 1a. Factory returns an instance.
  const inst = SM.create();
  assert(inst !== null && typeof inst === 'object', 'create() returns an instance');
  assert(typeof inst.startCamera === 'function', 'instance has startCamera()');
  assert(typeof inst.startMic === 'function', 'instance has startMic()');
  assert(typeof inst.destroy === 'function', 'instance has destroy()');

  // 1b. Default values present (audio noise gates + video resolution).
  assert(inst._video.resolution && inst._video.resolution.width === 1280 && inst._video.resolution.height === 720,
    '_video.resolution defaults to {1280, 720}', JSON.stringify(inst._video.resolution));
  assert(inst._audio.sampleRate === 48000, '_audio.sampleRate default === 48000');
  assert(inst._audio.echoCancellation === false, '_audio.echoCancellation default === false');
  assert(inst._audio.noiseSuppression === false, '_audio.noiseSuppression default === false');
  assert(inst._audio.autoGainControl === false, '_audio.autoGainControl default === false');

  // 1c. Camera + mic are off until startCamera/startMic are called.
  assert(inst._video.enabled === false, '_video.enabled === false before startCamera');
  assert(inst._audio.enabled === false, '_audio.enabled === false before startMic');

  // 1d. Bad localStorage JSON doesn't crash the constructor.
  const badCtx = buildContext({ storage: makeStorage({ 'swr.media.lastDevices': '{not-json' }) });
  let crashed = false;
  try { badCtx.win.SWR_MEDIA_INPUT.create(); } catch (_) { crashed = true; }
  assert(crashed === false, 'create() does not throw on malformed localStorage JSON');
  assert(badCtx.ls.getItem('swr.media.lastDevices') === '{not-json',
    'malformed localStorage value is preserved (not auto-cleared)');

  // 1e. localStorage round-trip — set video.deviceId, call startCamera,
  //     expect the persisted entry to land in localStorage.
  const ls = makeStorage();
  const ctx2 = buildContext({ storage: ls });
  const inst2 = ctx2.win.SWR_MEDIA_INPUT.create();
  inst2._video.deviceId = 'fake-vid-1';
  await inst2.startCamera();
  const persisted = JSON.parse(ls.getItem('swr.media.lastDevices') || '{}');
  assert(persisted.videoDeviceId === 'fake-vid-1',
    "startCamera() persists videoDeviceId to 'swr.media.lastDevices'", JSON.stringify(persisted));

  // 1f. destroy() is idempotent (call 3x).
  const inst3 = ctx2.win.SWR_MEDIA_INPUT.create();
  let threwOn3x = false;
  try { inst3.destroy(); inst3.destroy(); inst3.destroy(); } catch (_) { threwOn3x = true; }
  assert(threwOn3x === false, 'destroy() called 3x does not throw');

  // 1g. After destroy(), all stream + audio refs are cleared.
  assert(inst3._video.stream === null, 'post-destroy _video.stream === null');
  assert(inst3._audio.stream === null, 'post-destroy _audio.stream === null');
  assert(inst3._audioContext === null, 'post-destroy _audioContext === null');
  assert(inst3._analyser === null, 'post-destroy _analyser === null');
  assert(inst3._destroyed === true, 'post-destroy _destroyed === true');

  // 1h. requestPermissions() returns a {camera, mic} shape on success.
  const ctx3 = buildContext();
  const inst4 = ctx3.win.SWR_MEDIA_INPUT.create();
  const perms = await inst4.requestPermissions();
  assert(perms && typeof perms.camera === 'boolean' && typeof perms.mic === 'boolean',
    'requestPermissions() returns { camera: boolean, mic: boolean }', JSON.stringify(perms));
  assert(perms.camera === true && perms.mic === true, 'requestPermissions() success → camera+mic === true');
}

// ---- Section 2: Codec selection (driven through startRecording) ----

async function section2() {
  console.log('\n=== 2. MediaInput codec selection ===');
  const ctx = buildContext();
  const SM = ctx.win.SWR_MEDIA_INPUT;

  // 2a. RECORDING_MIME_PREFERENCE ordering — the first entry is vp9+opus.
  assert(SM.RECORDING_MIME_PREFERENCE[0] === 'video/webm;codecs=vp9,opus',
    "RECORDING_MIME_PREFERENCE[0] === 'video/webm;codecs=vp9,opus'", SM.RECORDING_MIME_PREFERENCE[0]);
  assert(Array.isArray(SM.RECORDING_MIME_PREFERENCE) && SM.RECORDING_MIME_PREFERENCE.length >= 2,
    'RECORDING_MIME_PREFERENCE has >= 2 entries', String(SM.RECORDING_MIME_PREFERENCE.length));

  // 2b. Both vp9+opus + plain webm supported → first wins.
  let ctx2 = buildContext({
    mediaRecorder: makeMediaRecorder(['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm']),
  });
  let inst = ctx2.win.SWR_MEDIA_INPUT.create();
  inst._video.stream = makeMediaStream('video');
  const r2 = await inst.startRecording();
  assert(r2.success === true && r2.mimeType === 'video/webm;codecs=vp9,opus',
    'when vp9+opus supported → picks video/webm;codecs=vp9,opus', r2.mimeType);

  // 2c. Only plain webm supported → that one wins.
  ctx2 = buildContext({ mediaRecorder: makeMediaRecorder(['video/webm']) });
  inst = ctx2.win.SWR_MEDIA_INPUT.create();
  inst._video.stream = makeMediaStream('video');
  const r3 = await inst.startRecording();
  assert(r3.success === true && r3.mimeType === 'video/webm',
    'when only plain webm supported → picks video/webm', r3.mimeType);

  // 2d. Nothing supported → mimeType falls back to ''.
  ctx2 = buildContext({ mediaRecorder: makeMediaRecorder([]) });
  inst = ctx2.win.SWR_MEDIA_INPUT.create();
  inst._video.stream = makeMediaStream('video');
  const r4 = await inst.startRecording();
  assert(r4.success === true && r4.mimeType === '',
    'when nothing supported → mimeType is empty string', String(r4.mimeType));
}

// ---- Section 3: Audio features (mocked analyser, getAudioData shape) ----

async function section3() {
  console.log('\n=== 3. MediaInput audio features ===');
  const ctx = buildContext();
  const SM = ctx.win.SWR_MEDIA_INPUT;

  // 3a. getAudioData() returns null when there's no analyser.
  const inst = SM.create();
  assert(inst.getAudioData() === null, 'getAudioData() === null with no analyser');

  // 3b. Inject a rich analyser and verify the 8-field shape.
  const freqCalls = { freq: 0, time: 0 };
  inst._analyser = {
    frequencyBinCount: 1024,
    getByteFrequencyData(buf) {
      freqCalls.freq += 1;
      // Steady bass-only signal: bins 0..9 = 100, rest 0.
      for (let i = 0; i < buf.length; i++) buf[i] = i < 10 ? 100 : 0;
    },
    getByteTimeDomainData(buf) {
      freqCalls.time += 1;
      // Square wave around 128 with regular crossings — non-DC + non-silent.
      for (let i = 0; i < buf.length; i++) buf[i] = (i % 16 < 8) ? 200 : 50;
    },
  };
  // _detectPitch reads self._audioContext.sampleRate; without it, pitch
  // detection short-circuits to 0 regardless of the time-domain signal.
  inst._audioContext = { sampleRate: 48000 };

  const data = inst.getAudioData();
  assert(data !== null, 'getAudioData() returns object when analyser is present');
  const expectedKeys = ['bass', 'lowMid', 'mid', 'high', 'presence', 'energy', 'voiceFundamental', 'transient'];
  const missing = expectedKeys.filter((k) => !(k in data));
  assert(missing.length === 0, 'getAudioData() has all 8 expected keys', missing.length ? 'missing ' + missing.join(',') : 'all present');

  // 3c. Every numeric value is finite.
  const allFinite = expectedKeys.every((k) => Number.isFinite(data[k]));
  assert(allFinite, 'all 8 numeric fields are finite (no NaN/Infinity)');

  // 3d. Bass band is 100 (steady). With our injected signal, bass band
  //     is 100, lowMid/mid/etc are 0 → energy = average(0..200) =
  //     average of [100*10, 0*190] = 5.
  assert(data.bass === 100, 'bass band averages 100', String(data.bass));
  assert(data.lowMid === 0, 'lowMid band averages 0', String(data.lowMid));

  // 3e. transient === 0 on a steady signal — call twice; the first call
  //     seeds _lastTransient, the second call diff === 0.
  const data2 = inst.getAudioData();
  assert(data2.transient === 0, 'transient === 0 on steady signal (second call)', String(data2.transient));

  // 3f. voiceFundamental > 0 for non-DC signal (square wave has crossings).
  assert(data.voiceFundamental > 0, 'voiceFundamental computed (non-zero for non-DC)', String(data.voiceFundamental));
  assert(freqCalls.freq >= 2 && freqCalls.time >= 2, 'analyser get* methods were actually called', `freq=${freqCalls.freq} time=${freqCalls.time}`);
}

// ---- Section 4: Camera Preview mount/unmount ----

async function section4() {
  console.log('\n=== 4. Camera Preview mount/unmount ===');
  const ctx = buildContext();
  const CP = ctx.win.SWR_CAMERA_PREVIEW;
  assert(typeof CP.mount === 'function', 'SWR_CAMERA_PREVIEW.mount is a function');
  assert(typeof CP.unmount === 'function', 'SWR_CAMERA_PREVIEW.unmount is a function');

  const host = new MockElement('div');
  const getUMCalls = { count: 0 };
  const ctxGetUM = ctx.getUserMedia;
  // Wrap to track calls.
  ctx.win.navigator.mediaDevices.getUserMedia = function (c) {
    getUMCalls.count += 1;
    return ctxGetUM(c);
  };

  // 4a. mount returns { id, mediaInput, videoEl, controls }.
  const handles = CP.mount(host, { autoStart: false });
  assert(handles !== null, 'mount() returns a handle (not null)');
  assert(typeof handles.id === 'string' && handles.id.indexOf('swrcp-') === 0, 'handles.id is "swrcp-N"', handles.id);
  assert(handles.mediaInput && typeof handles.mediaInput.startCamera === 'function', 'handles.mediaInput is a SWRMediaInput instance');
  assert(handles.videoEl && handles.videoEl.tagName === 'VIDEO', 'handles.videoEl is a <video>');
  assert(handles.controls !== null, 'handles.controls is present (showControls default true)');

  // 4b. Wrapper has both base + size class. videoEl has 'mirrored' by default.
  const wrapper = host.children[0];
  assert(wrapper.classList.contains('swr-camera-preview'), 'wrapper has .swr-camera-preview class');
  assert(wrapper.classList.contains('swr-cam-medium'), 'wrapper has .swr-cam-medium class (default size)');
  assert(handles.videoEl.classList.contains('mirrored'), 'videoEl has .mirrored class (default)');

  // 4c. autoStart:false → getUserMedia was NOT called for camera.
  assert(getUMCalls.count === 0, 'autoStart:false → startCamera not invoked', `count=${getUMCalls.count}`);

  // 4d. unmount(id) returns true; second call returns false.
  assert(CP.unmount(handles.id) === true, 'unmount(id) returns true on first call');
  assert(CP.unmount(handles.id) === false, 'unmount(id) returns false on second call');

  // 4e. After unmount, wrapper removed from host.
  assert(host.children.length === 0, 'wrapper removed from host DOM');
  assert(wrapper.parentNode === null, 'wrapper.parentNode === null after unmount');

  // 4f. Owned mediaInput is destroyed after unmount (since auto-created).
  assert(handles.mediaInput._destroyed === true, 'owned mediaInput destroyed on unmount');

  // 4g. autoStart:true → getUserMedia called for camera.
  const host2 = new MockElement('div');
  const before = getUMCalls.count;
  const handles2 = CP.mount(host2);  // default autoStart
  // Wait for the .then to settle (autoStart kicks off startCamera).
  await new Promise((r) => setTimeout(r, 0));
  assert(getUMCalls.count > before, 'autoStart:true (default) → startCamera invoked', `count=${getUMCalls.count}`);
  CP.unmount(handles2.id);

  // 4h. Caller-managed mediaInput is NOT destroyed on unmount.
  const host3 = new MockElement('div');
  const externalMI = ctx.win.SWR_MEDIA_INPUT.create();
  const handles3 = CP.mount(host3, { mediaInput: externalMI, autoStart: false });
  assert(handles3.mediaInput === externalMI, 'caller-managed mediaInput is the same instance');
  CP.unmount(handles3.id);
  assert(externalMI._destroyed === false, 'caller-managed mediaInput is NOT destroyed on unmount');
}

// ---- Section 5: Mic Meter mount/unmount ----

function section5() {
  console.log('\n=== 5. Mic Meter mount/unmount ===');
  const ctx = buildContext();
  const MM = ctx.win.SWR_MIC_METER;
  assert(typeof MM.mount === 'function', 'SWR_MIC_METER.mount is a function');
  assert(typeof MM.unmount === 'function', 'SWR_MIC_METER.unmount is a function');

  // 5a. mount returns { id, meter, canvas, levelsEl, clipEl }.
  const host = new MockElement('div');
  const analyser = { frequencyBinCount: 1024,
    getByteTimeDomainData(buf) { /* zeros */ } };
  const handles = MM.mount(host, { analyser, autoStart: false });
  assert(handles !== null, 'mount() returns a handle');
  assert(typeof handles.id === 'string' && handles.id.indexOf('swrmm-') === 0, 'handles.id is "swrmm-N"', handles.id);
  assert(handles.meter && typeof handles.meter.start === 'function', 'handles.meter has start()');
  assert(handles.canvas && handles.canvas.tagName === 'CANVAS', 'handles.canvas is a <canvas>');
  assert(handles.levelsEl, 'handles.levelsEl is present');
  assert(handles.clipEl, 'handles.clipEl is present');

  // 5b. 11 .swr-mic-level-bar children rendered, last has .peak class.
  const bars = handles.levelsEl.children;
  assert(bars.length === 11, '11 .swr-mic-level-bar children rendered', `got ${bars.length}`);
  const last = bars[bars.length - 1];
  assert(last.classList.contains('peak'), 'last bar has .peak class');

  // 5c. meter.start() is idempotent — two calls schedule only one rAF.
  const beforeSched = ctx.rafT.log.schedules;
  handles.meter.start();
  handles.meter.start();
  handles.meter.start();
  const afterSched = ctx.rafT.log.schedules;
  assert(afterSched - beforeSched === 1, 'meter.start() idempotent (1 rAF scheduled across 3 calls)', `scheduled ${afterSched - beforeSched}`);

  // 5d. meter.stop() is idempotent — first cancels, second is a no-op.
  const beforeCancel = ctx.rafT.log.cancels;
  handles.meter.stop();
  handles.meter.stop();
  const afterCancel = ctx.rafT.log.cancels;
  assert(afterCancel - beforeCancel === 1, 'meter.stop() idempotent (1 cancel across 2 calls)', `cancelled ${afterCancel - beforeCancel}`);

  // 5e. meter.setAnalyser(newAnalyser) swaps without crashing.
  let swapped = false;
  try {
    const newAnalyser = { frequencyBinCount: 2048, getByteTimeDomainData() {} };
    handles.meter.setAnalyser(newAnalyser);
    swapped = true;
  } catch (_) { swapped = false; }
  assert(swapped === true, 'meter.setAnalyser(newAnalyser) swaps without throwing');

  // 5f. getState() returns the documented shape (or superset).
  const st = handles.meter.getState();
  const required = ['running', 'hasAnalyser', 'rms', 'peak', 'clipCount', 'lastBarCount'];
  const missing = required.filter((k) => !(k in st));
  assert(missing.length === 0, 'getState() returns {running, hasAnalyser, rms, peak, clipCount, lastBarCount}', missing.length ? 'missing ' + missing.join(',') : 'all present');
  assert(st.hasAnalyser === true, 'getState().hasAnalyser === true after setAnalyser()');

  // 5g. unmount(id) returns true + cancels rAF (only if a frame was
  //     scheduled — autoStart:false skipped start, so we call start()
  //     explicitly to put a rAF in flight, then verify unmount cancels
  //     exactly once and is idempotent on the second call).
  handles.meter.start();
  const cancelBefore = ctx.rafT.log.cancels;
  assert(MM.unmount(handles.id) === true, 'unmount(id) returns true on first call');
  assert(MM.unmount(handles.id) === false, 'unmount(id) returns false on second call');
  assert(ctx.rafT.log.cancels - cancelBefore === 1, 'unmount cancels the in-flight rAF (1 cancel call)');

  // 5h. Stream-owned mode (mode 3) closes its AudioContext on unmount.
  const acCtx = makeAudioContext();
  const ctx2 = buildContext({ audioContext: acCtx });
  const MM2 = ctx2.win.SWR_MIC_METER;
  const host2 = new MockElement('div');
  const stream = makeMediaStream('audio');
  const acBefore = acCtx.log.constructs;
  const closesBefore = acCtx.log.closes;
  const h2 = MM2.mount(host2, { stream, autoStart: false });
  assert(acCtx.log.constructs === acBefore + 1, 'stream mode constructs 1 AudioContext');
  MM2.unmount(h2.id);
  assert(acCtx.log.closes === closesBefore + 1, 'owned AudioContext closed on unmount');
}

// ---- Run ----

async function main() {
  await section1();
  await section2();
  await section3();
  await section4();
  await section5();

  console.log('\n' + (failures === 0
    ? 'MEDIA-INPUT UNIT: all assertions passed'
    : `MEDIA-INPUT UNIT: ${failures} failure(s)`));
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error('CAUGHT:', e.stack);
  process.exit(2);
});
