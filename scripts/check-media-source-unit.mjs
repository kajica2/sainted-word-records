#!/usr/bin/env node
// scripts/check-media-source-unit.mjs — unit tests for the Media Source
// playback engine (lib/audio.client.js).
//
// The engine now has ONE clock: whatever element carries the audio. These
// tests pin that down.
//
//   1. the MediaElementSourceNode is created on loadedmetadata / canplay,
//      not before the media is ready
//   2. a node is created once per element (createMediaElementSource throws
//      on the second call)
//   3. Audio.clock is the master element's currentTime
//   4. the bar counter is paced by the media clock — a frozen media freezes
//      the counter (a wall clock would keep it running)
//   5. the beat phase is measured on the media clock (the downbeat comes
//      from the offline analysis, which is media time)
//   6. the audio source routing: video / external / none
//   7. the picture is corrected onto the music, and a positive offset
//      DELAYS the audio
//   8. the transport drives both the picture and the music
//   9. the export inherits the preview's audio source (engine.html taps
//      Audio.analyser, and there is no second, export-side control)
//
// Run: node scripts/check-media-source-unit.mjs
// Exit: 0 = all assertions pass, 1 = any failure, 2 = caught error.

import vm from 'node:vm';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'lib/audio.client.js');
const ENGINE = path.join(ROOT, 'engine.html');

let failures = 0;
function assert(cond, msg, detail) {
  if (cond) console.log('  ✓', msg, detail ? `(${detail})` : '');
  else { console.log('  ✗', msg, detail ? `(${detail})` : ''); failures += 1; }
}

// ---- Fakes ---------------------------------------------------------------

function makeEl(tag) {
  return {
    tagName: String(tag).toUpperCase(),
    src: '',
    currentTime: 0,
    duration: 10,
    paused: true,
    readyState: 0,
    dataset: {},
    style: { cssText: '' },
    _listeners: {},
    addEventListener(n, fn) { (this._listeners[n] = this._listeners[n] || []).push(fn); },
    removeEventListener(n, fn) {
      const a = this._listeners[n] || [];
      const i = a.indexOf(fn);
      if (i >= 0) a.splice(i, 1);
    },
    dispatch(n) { (this._listeners[n] || []).slice().forEach((fn) => fn({ type: n })); },
    play() { this.paused = false; this.playCount = (this.playCount || 0) + 1; return Promise.resolve(); },
    pause() { this.paused = true; this.pauseCount = (this.pauseCount || 0) + 1; },
    load() { this.loadCount = (this.loadCount || 0) + 1; },
    setAttribute() {},
    removeAttribute() {},
  };
}

function makeCtx() {
  const sources = [];
  return {
    state: 'running',
    currentTime: 0,
    sampleRate: 44100,
    destination: { name: 'destination' },
    sources,
    createAnalyser() {
      return {
        fftSize: 2048,
        smoothingTimeConstant: 0.65,
        frequencyBinCount: 1024,
        getByteFrequencyData() {},
        getByteTimeDomainData() {},
        connect(t) { this._out = t; },
        disconnect(t) { if (!t || this._out === t) this._out = null; },
      };
    },
    createGain() {
      return {
        gain: { value: 1 },
        connect(t) { this._out = t; },
        disconnect(t) { if (!t || this._out === t) this._out = null; },
      };
    },
    createMediaElementSource(el) {
      if (sources.some((s) => s.el === el)) {
        // The real API throws InvalidStateError on the second call.
        throw Object.assign(new Error('InvalidStateError'), { name: 'InvalidStateError' });
      }
      const node = {
        el,
        _out: null,
        connect(t) { this._out = t; },
        disconnect(t) { if (!t || this._out === t) this._out = null; },
      };
      sources.push(node);
      return node;
    },
    resume() {},
    decodeAudioData() {
      return Promise.resolve({ duration: 10, getChannelData: () => new Float32Array(10) });
    },
  };
}

function loadEngine() {
  const sandbox = {
    console: { log() {}, warn() {}, error() {} },
    // Long timeouts are capped: the engine's fallbacks (e.g. the 4 s wait
    // for an external file's metadata) must not stall the suite.
    setTimeout: (fn, ms) => setTimeout(fn, Math.min(ms || 0, 50)),
    clearTimeout,
    URL: { createObjectURL: () => 'blob:fake-' + Math.random(), revokeObjectURL() {} },
    fetch: async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(8) }),
  };
  sandbox.window = sandbox;
  sandbox.AudioContext = function AudioContext() { return makeCtx(); };
  sandbox.webkitAudioContext = sandbox.AudioContext;
  sandbox.performance = { now: () => sandbox.__wall };
  sandbox.__wall = 0;
  sandbox.CustomEvent = class { constructor(type, init) { this.type = type; this.detail = init && init.detail; } };
  sandbox.dispatchEvent = () => true;
  sandbox.addEventListener = () => {};
  sandbox.removeEventListener = () => {};
  sandbox.setStatus = () => {};
  sandbox.escapeHtml = (s) => String(s);
  sandbox.clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  sandbox.lerp = (a, b, t) => a + (b - a) * t;
  sandbox.Library = { db: { put: async () => {}, get: async () => null, delete: async () => {} } };
  sandbox.AudioAnalysisV2 = {
    analyzeBuffer: () => ({
      bpm: 120, key: 'C', scale: 'major', confidence: 0.9,
      onsets: [0, 0.5, 1, 1.5], duration: 10,
    }),
    estimateBPM: () => 120,
  };
  const created = [];
  sandbox.document = {
    readyState: 'complete',
    createElement(tag) { const e = autoReady(makeEl(tag)); created.push(e); return e; },
    getElementById() { return null; },
    head: { appendChild() {} },
  };
  sandbox.__created = created;
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(SRC, 'utf8'), sandbox, { filename: 'audio.client.js' });
  return sandbox;
}

// A real media element reports its metadata shortly after the src is set.
// The fake does the same, so the deferred source-node creation is exercised
// the way the browser exercises it.
function autoReady(el) {
  setTimeout(() => {
    if (el.readyState >= 1) return;
    el.readyState = 1;
    el.dispatch('loadedmetadata');
  }, 0);
  return el;
}

const VIDEO = { name: 'clip.mp4', type: 'video/mp4' };
const SONG = { name: 'track.mp3', type: 'audio/mpeg' };
const tick = () => new Promise((r) => setTimeout(r, 0));

// ---- 1. The source node is created on loadedmetadata / canplay ----------

{
  const sb = loadEngine();
  const A = sb.Audio;
  A.loadFile(VIDEO);
  const el = A.audioEl;
  const created = sb.__ctx ? null : null;
  const ctx = A.ctx;

  assert(ctx.sources.length === 0,
    'no source node is created before the media is ready',
    `sources=${ctx.sources.length}`);
  assert(A.source === null, 'Audio.source is null before the media is ready');

  el.readyState = 1;
  el.dispatch('loadedmetadata');
  assert(ctx.sources.length === 1,
    'the source node is created on loadedmetadata',
    `sources=${ctx.sources.length}`);
  assert(A.source === ctx.sources[0] && ctx.sources[0]._out === A.analyser,
    'the source node feeds the analyser');

  // A second event must not create a second node.
  el.readyState = 2;
  el.dispatch('canplay');
  assert(ctx.sources.length === 1,
    'a canplay after loadedmetadata does not create a second node',
    `sources=${ctx.sources.length}`);

  // Switching the source away and back must reuse the cached node.
  A.setAudioSource('none');
  A.setAudioSource('video');
  assert(ctx.sources.length === 1,
    'switching the source back reuses the cached node',
    `sources=${ctx.sources.length}`);
  assert(A.source === ctx.sources[0] && ctx.sources[0]._out === A.analyser,
    'and the node is connected again');
}

// ---- 2. The clock is the master element --------------------------------

{
  const sb = loadEngine();
  const A = sb.Audio;
  A.loadFile(VIDEO);
  const el = A.audioEl;
  el.readyState = 1;
  el.dispatch('loadedmetadata');

  el.currentTime = 3.25;
  assert(A.clock === 3.25, 'Audio.clock is the media element\'s currentTime',
    `clock=${A.clock}`);
  assert(A.clockElement() === el, 'the media element is the clock element');
}

// ---- 3. The bar counter is paced by the media clock --------------------

{
  const sb = loadEngine();
  const A = sb.Audio;
  A.loadFile(VIDEO);
  const el = A.audioEl;
  el.readyState = 1;
  el.dispatch('loadedmetadata');
  await tick();
  await tick();

  A.feat.bpm = 60;               // the engine's counter ticks once per beat
  A.playing = true;
  A.resetBarCounter();
  assert(A.bar === 0, 'the bar counter starts at zero', `bar=${A.bar}`);

  el.currentTime = 4.2;          // 4.2 beats at 60 bpm
  A._tickBar();
  assert(A.bar === 4, 'the bar counter follows the media clock', `bar=${A.bar}`);

  // A wall clock would keep the counter running while the media is frozen.
  const frozen = A.bar;
  sb.__wall += 10000;             // ten seconds of wall time
  A._tickBar();
  assert(A.bar === frozen,
    'a frozen media freezes the bar counter (no independent wall clock)',
    `bar=${A.bar}`);

  // A seek must not run the counter backwards.
  el.currentTime = 0.1;
  A._tickBar();
  assert(A.bar >= frozen, 'a seek does not run the bar counter backwards',
    `bar=${A.bar}`);
}

// ---- 4. The beat phase is measured on the media clock -------------------

{
  const sb = loadEngine();
  const A = sb.Audio;
  A.loadFile(VIDEO);
  const el = A.audioEl;
  el.readyState = 1;
  el.dispatch('loadedmetadata');
  await tick();
  await tick();

  A.feat.bpm = 120;              // beat 0.5 s, bar 2 s (4/4)
  A._downbeatTime = 0;           // media time, from the offline analysis
  A.ctx.currentTime = 999;       // the AudioContext clock is NOT the media
  el.currentTime = 0.5;          // the second beat of the bar
  A.sample();
  assert(Math.abs(A.feat.beatPhase - 0.25) < 0.02,
    'the beat phase is measured on the media clock',
    `phase=${A.feat.beatPhase}`);
  assert(A.feat.beatInBar === 2, 'and the beat in bar agrees', `inBar=${A.feat.beatInBar}`);
}

// ---- 5. The audio source routing ---------------------------------------

{
  const sb = loadEngine();
  const A = sb.Audio;
  A.loadFile(VIDEO);
  const el = A.audioEl;
  el.readyState = 1;
  el.dispatch('loadedmetadata');
  const ctx = A.ctx;
  const mediaNode = ctx.sources[0];

  // 'none' — the element is captured (so its audio cannot reach the
  // speakers) but nothing is connected to the analyser.
  A.setAudioSource('none');
  assert(A.source === null, 'Audio source = none disconnects the analyser');
  assert(mediaNode._out === null, 'and the media element is not connected');
  assert(A._sourceNodes.get(el) === mediaNode,
    'the media element still has a source node (its audio is captured)');

  // 'video' — the media element's own track.
  A.setAudioSource('video');
  assert(A.source === mediaNode && mediaNode._out === A.analyser,
    'Audio source = video connects the media element');
}

// ---- 6. An external audio file becomes the clock ------------------------

{
  const sb = loadEngine();
  const A = sb.Audio;
  A.loadFile(VIDEO);
  const el = A.audioEl;
  el.readyState = 1;
  el.dispatch('loadedmetadata');
  const ctx = A.ctx;

  await A.loadExternalAudio(SONG);
  const ext = A.externalEl;
  assert(!!ext, 'the external file gets its own element');
  assert(A.audioSource === 'external', 'the source becomes external');
  assert(ctx.sources.length === 2, 'the external element gets its own node',
    `sources=${ctx.sources.length}`);
  const extNode = ctx.sources.find((s) => s.el === ext);
  assert(A.source === extNode && extNode._out === A.analyser,
    'the external file feeds the analyser (the export inherits it)');
  const mediaNode = ctx.sources.find((s) => s.el === el);
  assert(mediaNode && mediaNode._out === null,
    "the video's own audio is muted while the external file plays");

  ext.currentTime = 7.5;
  assert(A.clock === 7.5, 'the clock follows the external file', `clock=${A.clock}`);
  assert(A.clockElement() === ext, 'the external element is the clock element');
}

// ---- 7. The picture is corrected onto the music ------------------------

{
  const sb = loadEngine();
  const A = sb.Audio;
  A.loadFile(VIDEO);
  const el = A.audioEl;
  el.readyState = 1;
  el.dispatch('loadedmetadata');
  await A.loadExternalAudio(SONG);
  const ext = A.externalEl;

  el.paused = false;
  ext.paused = false;
  ext.currentTime = 5;
  el.currentTime = 5;

  // No offset: the picture sits on the music.
  A.setOffsetMs(0);
  A._syncMedia();
  assert(Math.abs(el.currentTime - ext.currentTime) < 0.001,
    'without an offset the picture sits on the music',
    `media=${el.currentTime} audio=${ext.currentTime}`);

  // A positive offset puts the picture AHEAD — the audio is heard later.
  A.setOffsetMs(500);
  el.currentTime = 5;
  A._syncMedia();
  assert(Math.abs(el.currentTime - (ext.currentTime + 0.5)) < 0.001,
    'a positive offset delays the audio (the picture runs ahead)',
    `media=${el.currentTime} audio=${ext.currentTime}`);

  // A negative offset advances the audio.
  A.setOffsetMs(-250);
  el.currentTime = 5;
  A._syncMedia();
  assert(Math.abs(el.currentTime - (ext.currentTime - 0.25)) < 0.001,
    'a negative offset advances the audio',
    `media=${el.currentTime} audio=${ext.currentTime}`);

  // A drift under the threshold is left alone (no jitter).
  A.setOffsetMs(0);
  el.currentTime = ext.currentTime + 0.04;
  A._syncMedia();
  assert(Math.abs(el.currentTime - (ext.currentTime + 0.04)) < 0.001,
    'a drift under 80 ms is not corrected (no jitter)');

  // Sync off: the picture free-runs.
  A.setSync(false);
  el.currentTime = 1;
  A._syncMedia();
  assert(el.currentTime === 1, 'with sync off the picture is not corrected');
  A.setSync(true);
}

// ---- 8. The transport drives the picture and the music ------------------

{
  const sb = loadEngine();
  const A = sb.Audio;
  A.loadFile(VIDEO);
  const el = A.audioEl;
  el.readyState = 1;
  el.dispatch('loadedmetadata');
  await A.loadExternalAudio(SONG);
  const ext = A.externalEl;

  A.play();
  assert(el.paused === false, 'play starts the picture');
  assert(ext.paused === false, 'play starts the music');
  A.pause();
  assert(el.paused === true, 'pause stops the picture');
  assert(ext.paused === true, 'pause stops the music');

  // A seek moves the music, and the picture follows it with the offset.
  A.setOffsetMs(300);
  ext.duration = 20;
  el.duration = 20;
  A.seek(0.5);
  assert(Math.abs(ext.currentTime - 10) < 0.001, 'a seek moves the music',
    `audio=${ext.currentTime}`);
  assert(Math.abs(el.currentTime - 10.3) < 0.001,
    'the picture follows the music with the offset',
    `media=${el.currentTime}`);
}

// ---- 9. The export inherits the preview's audio source ------------------

{
  const engine = fs.readFileSync(ENGINE, 'utf8');
  const starts = engine.match(/SWR_RECORDER\.start\(/g) || [];
  const taps = engine.match(/audioSource:\s*\(?window\.A\s*&&\s*window\.A\.analyser\)?|audioSource:\s*Audio\.analyser/g) || [];
  assert(starts.length >= 3, 'the engine has three export paths', `starts=${starts.length}`);
  assert(taps.length === starts.length,
    'every export path records the analyser (so it carries the current source)',
    `taps=${taps.length}/${starts.length}`);
  assert(/Audio\.analyser\.connect\(dest\)/.test(engine),
    'the MediaRecorder export path taps the analyser too');
  assert(!/export-sync|export-audio-source|rec-audio-source/.test(engine),
    'there is no separate export-side audio source or sync control');
  assert(/id="media-source"/.test(engine),
    'the Media Source panel is mounted in the engine');
}

console.log(failures ? `\nMEDIA SOURCE UNIT: FAILED (${failures})` : '\nMEDIA SOURCE UNIT: PASSED');
process.exit(failures ? 1 : 0);
