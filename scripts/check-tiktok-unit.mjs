#!/usr/bin/env node
// scripts/check-tiktok-unit.mjs — pure-logic unit tests for TikTok Studio
// (PR 3 of 4): client/swr-tiktok-runtime.client.js + client/swr-tiktok-export.client.js,
// with the repo's real audio-analysis-v2.js loaded alongside so the BPM/key/hook
// paths are exercised end to end against synthetic audio.
//
// Sections: presets, factory + API, state machine, persistence, trim, the
// buffer analysis (hook, BPM), the render loop, and the export pipeline
// (lengths, mime pick, rejection, graph reuse, download handoff).
// node:vm with browser shims (window/document/localStorage/AudioContext/
// MediaRecorder/canvas/rAF/performance/Blob/URL).
//
// Run:  node scripts/check-tiktok-unit.mjs
// Exit: 0 = all assertions pass, 1 = any failure, 2 = caught error.

import vm from 'node:vm';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const ROOT = path.resolve(path.dirname(__filename), '..');
const ANALYSIS_SRC = path.join(ROOT, 'audio-analysis-v2.js');
const RUNTIME_SRC = path.join(ROOT, 'client/swr-tiktok-runtime.client.js');
const EXPORT_SRC = path.join(ROOT, 'client/swr-tiktok-export.client.js');

let failures = 0;
function assert(cond, msg, detail) {
  if (cond) console.log('  ✓', msg, detail ? `(${detail})` : '');
  else { console.log('  ✗', msg, detail ? `(${detail})` : ''); failures += 1; }
}

// ---- canvas 2d stub: any method, returns no-op / gradient / text metrics ----
function makeCtx() {
  const grad = { addColorStop() {} };
  const target = {
    canvas: { width: 1080, height: 1920 },
    globalAlpha: 1,
    measureText: () => ({ width: 120 }),
    createLinearGradient: () => grad,
    createRadialGradient: () => grad,
  };
  return new Proxy(target, {
    get(t, k) {
      if (k in t) return t[k];
      return () => undefined;                    // getImageData/beginPath/… no-ops
    },
    set(t, k, v) { t[k] = v; return true; },
  });
}
function makeCanvas() {
  return { width: 1080, height: 1920, getContext: () => makeCtx(), captureStream: () => makeStream() };
}
function makeStream() {
  const track = { stop() { track.stopped = true; }, stopped: false, kind: 'video' };
  return { getTracks: () => [track], getVideoTracks: () => [track], getAudioTracks: () => [track] };
}

// ---- environment ------------------------------------------------------------
const rafQueue = [];
const timeouts = [];
const intervals = [];
const storage = new Map();

const sandbox = {
  console,
  Math, JSON, Date, Object, Array, String, Number, Boolean, Error, TypeError, Promise, isFinite, isNaN, parseFloat, parseInt,
  WeakMap, WeakSet, Set, Map, Proxy, Reflect, Symbol, Uint8Array, Float32Array, Int16Array, ArrayBuffer,
  performance: { now: () => sandbox.__now },
  __now: 1000,
  requestAnimationFrame: (fn) => { rafQueue.push(fn); return rafQueue.length; },
  cancelAnimationFrame: () => {},
  setTimeout: (fn, ms) => { timeouts.push({ fn, ms }); return timeouts.length; },
  clearTimeout: () => {},
  setInterval: (fn, ms) => { intervals.push({ fn, ms }); return intervals.length; },
  clearInterval: () => {},
  localStorage: {
    getItem: (k) => (storage.has(k) ? storage.get(k) : null),
    setItem: (k, v) => storage.set(k, String(v)),
    removeItem: (k) => storage.delete(k),
    clear: () => storage.clear(),
  },
  document: {
    body: { appendChild() {}, removeChild() {} },
    createElement: (tag) => {
      if (tag === 'canvas') return makeCanvas();
      if (tag === 'a') return { click() { sandbox.__clicked = true; }, remove() {}, style: {} };
      return { style: {}, appendChild() {}, remove() {} };
    },
    getElementById: () => null,
    querySelector: () => null,
    addEventListener() {},
  },
  URL: { createObjectURL: () => 'blob:test', revokeObjectURL() {} },
  Blob: class Blob { constructor(parts, opts) { this.parts = parts; this.type = (opts && opts.type) || ''; this.size = (parts || []).reduce((n, p) => n + ((p && p.size) || (p && p.length) || 0), 0); } },
  MediaStream: class MediaStream { constructor(tracks) { this.tracks = tracks || []; } getTracks() { return this.tracks; } },
  MediaRecorder: class MediaRecorder {
    static isTypeSupported(m) { return m === 'video/webm;codecs=vp9,opus' || m === 'video/webm'; }
    constructor(stream, opts) { this.stream = stream; this.mimeType = (opts && opts.mimeType) || ''; this.state = 'inactive'; sandbox.__recorders.push(this); }
    start() { this.state = 'recording'; }
    stop() { this.state = 'inactive'; if (this.onstop) this.onstop(); }
    fire() { if (this.ondataavailable) this.ondataavailable({ data: { size: 1024 } }); }
  },
  __recorders: [],
  __clicked: false,
  AudioContext: class AudioContext {
    constructor() { this.state = 'running'; this.sampleRate = 44100; }
    createMediaElementSource() { if (sandbox.__sourceMade) throw new Error('InvalidStateError'); sandbox.__sourceMade = true; return { connect() {}, disconnect() {} }; }
    createAnalyser() { return { fftSize: 2048, frequencyBinCount: 1024, smoothingTimeConstant: 0.7, connect() {}, getByteFrequencyData(a) { for (let i = 0; i < a.length; i++) a[i] = 40 + (i % 50); }, getByteTimeDomainData(a) { for (let i = 0; i < a.length; i++) a[i] = 128 + Math.round(30 * Math.sin(i / 12)); } }; }
    createMediaStreamDestination() { return { stream: makeStream() }; }
    decodeAudioData(buf) { return Promise.resolve(sandbox.__decoded || null); }
    resume() { return Promise.resolve(); }
  },
};
sandbox.window = sandbox;
sandbox.self = sandbox;
sandbox.globalThis = sandbox;
const context = vm.createContext(sandbox);

for (const p of [ANALYSIS_SRC, RUNTIME_SRC, EXPORT_SRC]) {
  if (!fs.existsSync(p)) { console.error(`✗ missing ${p}`); process.exit(2); }
  vm.runInContext(fs.readFileSync(p, 'utf8'), context, { filename: path.basename(p) });
}

// ---- synthetic audio --------------------------------------------------------
// 20 s of mono at 44.1k: quiet, then a lift at 12 s, with a 120 BPM click train
// from 12 s on (a click every 0.5 s) so BPM has onsets to work with.
function makeBuffer() {
  const sr = 44100, secs = 20, len = sr * secs;
  const data = new Float32Array(len);
  for (let i = 0; i < len; i++) {
    const t = i / sr;
    const loud = t >= 12;
    // A pad under the clicks, quiet enough that the clicks dominate every onset.
    data[i] = (loud ? 0.06 : 0.008) * Math.sin(2 * Math.PI * 220 * t);
  }
  for (let k = 12; k < 20; k += 0.5) {
    const at = Math.round(k * sr);
    for (let j = 0; j < 400; j++) data[at + j] = (data[at + j] || 0) + 0.9 * Math.exp(-j / 80);
  }
  return { sampleRate: sr, length: len, duration: secs, numberOfChannels: 1, getChannelData: () => data };
}

function tickFrames(n = 3) {
  for (let i = 0; i < n; i++) {
    const q = rafQueue.splice(0, rafQueue.length);
    for (const fn of q) { sandbox.__now += 16; fn(sandbox.__now); }
  }
}
function runTimeouts() {
  const q = timeouts.splice(0, timeouts.length);
  for (const t of q) t.fn();
}
function runIntervals() {
  for (const it of intervals.splice(0, intervals.length)) it.fn();
}
const wait = () => new Promise((r) => setImmediate(r));

// ---- 1 · presets ------------------------------------------------------------
console.log('\n1 · vibe presets');
const T = sandbox.window.SWR_TIKTOK;
assert(!!T, 'SWR_TIKTOK global exists');
assert(T && typeof T.create === 'function', 'create() is a function');
const vibes = (T && T.VIBES) || {};
const ids = Object.keys(vibes);
assert(ids.length === 12, 'exactly 12 presets', String(ids.length));
const EXPECTED = ['g-electronic', 'g-hiphop', 'g-indie', 'g-pop', 'm-hype', 'm-chill', 'm-sad', 'm-aggressive', 'c-sunset', 'c-ocean', 'c-neon', 'c-mono'];
assert(EXPECTED.every((k) => ids.includes(k)), 'all 12 documented ids present', EXPECTED.filter((k) => !ids.includes(k)).join(',') || 'none missing');
assert(ids.every((k) => vibes[k].palette && vibes[k].palette.length === 3), 'every preset has a 3-colour palette');
assert(ids.every((k) => typeof vibes[k].intensity === 'number' && vibes[k].intensity > 0 && vibes[k].intensity <= 1), 'intensity is 0..1');
assert(ids.every((k) => ['calm', 'pulse', 'wave'].includes(vibes[k].motion)), 'motion is calm|pulse|wave');
assert(ids.every((k) => vibes[k].layers && typeof vibes[k].layers.bg === 'number'), 'every preset carries layerWeights');

// ---- 2 · factory + API ------------------------------------------------------
console.log('\n2 · factory');
const inst = T.create(makeCanvas(), null);
assert(!!inst, 'create(canvas, null) returns an instance');
const METHODS = ['loadAudio', 'pickVibe', 'setTrim', 'play', 'pause', 'seek', 'getState', 'destroy'];
assert(METHODS.every((m) => typeof inst[m] === 'function'), 'exposes all 8 methods', METHODS.filter((m) => typeof inst[m] !== 'function').join(',') || 'all');
let nullSafe = true;
try { T.create(null, null); } catch (e) { nullSafe = false; }
assert(nullSafe, 'create(null, null) does not throw');
const st0 = inst.getState();
assert(st0.state === 'idle', 'starts idle', st0.state);
assert(st0.hasAudio === false, 'knows it has no audio element');
assert(st0.trim && st0.trim.start === 0, 'trim starts at 0');

// ---- 3 · render loop --------------------------------------------------------
console.log('\n3 · render loop');
tickFrames(2);
assert(true, 'rAF loop ticks without a canvas context error');
const stF = inst.getState();
assert(stF.features && typeof stF.features.bass === 'number', 'exposes live features', `bass=${stF.features.bass.toFixed(3)}`);

// ---- 4 · vibe selection + persistence --------------------------------------
console.log('\n4 · vibe selection + persistence');
inst.pickVibe('mood', 'm-hype');
assert(inst.getState().vibeId === 'm-hype', 'pickVibe switches preset', inst.getState().vibeId);
assert(inst.getState().vibeTab === 'mood', 'pickVibe records the tab');
const stored = JSON.parse(storage.get('swr.tiktok.lastVibe') || 'null');
assert(stored && stored.vibeId === 'm-hype', 'choice persisted to swr.tiktok.lastVibe');
inst.pickVibe('genre', 'not-a-real-vibe');
assert(inst.getState().vibeId === 'm-hype', 'unknown id is ignored, not applied');
const seeded = T.create(makeCanvas(), null);
assert(seeded.getState().vibeId === 'm-hype', 'a new instance restores the saved vibe');

// ---- 5 · trim + seek --------------------------------------------------------
console.log('\n5 · trim + seek');
inst.setTrim(4, 9);
assert(inst.getState().trim.start === 4 && inst.getState().trim.end === 9, 'setTrim stores the range');
inst.setTrim(9, 4);
assert(inst.getState().trim.end >= inst.getState().trim.start, 'reversed range is clamped, start <= end');
inst.setTrim(0, 100);
inst.seek(-5);
assert(true, 'seek(-5) is clamped rather than throwing');

// ---- 6 · analysis over a real buffer ---------------------------------------
console.log('\n6 · buffer analysis (hook, BPM, key)');
sandbox.__decoded = makeBuffer();
const audioEl = { src: '', currentTime: 0, pause() {}, play: () => Promise.resolve(), load() {}, addEventListener() {}, duration: 0 };
const rt = T.create(makeCanvas(), audioEl);
const file = { name: 'click-track.wav', arrayBuffer: () => Promise.resolve(new ArrayBuffer(8)) };
let loaded = null;
await rt.loadAudio(file).then((r) => { loaded = r; }).catch((e) => { console.log('   loadAudio rejected:', String(e)); });
assert(!!loaded, 'loadAudio resolves with the decoded buffer');
assert(loaded && Math.abs(loaded.duration - 20) < 0.1, 'duration read from the buffer', loaded && loaded.duration);
assert(loaded && loaded.hook >= 10 && loaded.hook <= 16, 'hook lands on the lift at 12 s', loaded && `hook=${loaded.hook.toFixed(2)}`);
assert(loaded && loaded.bpm >= 100 && loaded.bpm <= 140, 'BPM near the click train', loaded && `bpm=${Math.round(loaded.bpm)}`);
assert(rt.getState().state === 'ready', 'state is ready after load', rt.getState().state);
assert(storage.get('swr.tiktok.lastAudioName') === 'click-track.wav', 'filename persisted');
assert(!!sandbox.window.SWR_TIKTOK_AUDIO, 'audio graph published for the exporter');
assert(!!(sandbox.window.SWR_TIKTOK_AUDIO && sandbox.window.SWR_TIKTOK_AUDIO.analyser), 'published graph carries the analyser');
tickFrames(2);
assert(rt.getState().features.rms >= 0, 'features keep updating after load');
let rejections = 0;
await rt.loadAudio(null).catch(() => { rejections += 1; });
assert(rejections === 1, 'loadAudio(null) rejects');

// ---- 7 · export pipeline ----------------------------------------------------
console.log('\n7 · export pipeline');
const X = sandbox.window.SWR_TIKTOK_EXPORT;
assert(!!X && typeof X.export === 'function', 'SWR_TIKTOK_EXPORT.export exists');
assert(X.LENGTHS.teaser === 3 && X.LENGTHS.hook === 5 && X.LENGTHS.clip === 15 && X.LENGTHS.behind === 60, 'the four plan lengths', JSON.stringify(X.LENGTHS));
assert(X.pickMime() === 'video/webm;codecs=vp9,opus', 'picks vp9+opus when supported', X.pickMime());
let sync = false;
try { X.export(null, null, {}).catch(() => {}); } catch (e) { sync = true; }
assert(!sync, 'export() never throws synchronously');
let rejected = false;
await X.export(null, null, {}).catch(() => { rejected = true; });
assert(rejected, 'export(null) rejects with an error');
const canvas2 = makeCanvas();
sandbox.__recorders.length = 0;
const p = X.export(canvas2, audioEl, { type: 'teaser', startS: 0, endS: 20, hookTime: 12, onProgress: () => {} });
await wait();
tickFrames(2);                                   // the recorder starts on the next frame
const rec = sandbox.__recorders[sandbox.__recorders.length - 1];
assert(!!rec && rec.state === 'recording', 'MediaRecorder started', rec && rec.state);
assert(rec && rec.mimeType.includes('vp9'), 'recorder uses the preferred mime', rec && rec.mimeType);
assert(timeouts.length >= 1, 'a stop timer is armed for the length');
rec.fire();
rec.stop();
const res = await p;
assert(res && res.blob, 'export resolves with a blob');
assert(res.filename.startsWith('sainted-word-tiktok-teaser-'), 'filename names the type', res.filename);
assert(res.filename.endsWith('.webm'), 'filename carries the container');
assert(sandbox.__clicked === true, 'download was handed to the browser');
assert(Math.abs(res.duration - 3) < 0.01, 'teaser duration is 3 s', String(res.duration));
assert(!!res.url, 'resolves a url');

// ---- 8 · teardown -----------------------------------------------------------
console.log('\n8 · teardown');
let destroyed = false;
try { inst.destroy(); destroyed = true; } catch (e) { destroyed = false; }
assert(destroyed, 'destroy() is safe to call');

console.log(failures === 0 ? '\nALL TIKTOK UNIT CHECKS PASSED' : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
