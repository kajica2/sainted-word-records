#!/usr/bin/env node
// scripts/check-song-video-layer-unit.mjs — unit tests for
// lib/song-video-layer.client.js.
//
// The module turns a video song into a layer that shares the song's OWN
// <video> element, so the picture and the sound are one clock and cannot
// drift apart. What is tested here is the module's decisions:
//
//   1. a video song adds exactly one layer
//   2. that layer's element IS the song's element (the sync guarantee)
//   3. the layer is marked songBound, so the engine's draw path leaves the
//      element to the transport
//   4. an audio song adds no layer
//   5. a new song replaces the previous song-video layer
//   6. an audio song removes a previous song-video layer
//   7. the song-loaded seam chains: a subscriber installed before this
//      module still runs
//   8. the poster frame is captured from the element
//
// Run: node scripts/check-song-video-layer-unit.mjs
// Exit: 0 = all assertions pass, 1 = any failure, 2 = caught error.

import vm from 'node:vm';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'lib/song-video-layer.client.js');

let failures = 0;
function assert(cond, msg, detail) {
  if (cond) console.log('  ✓', msg, detail ? `(${detail})` : '');
  else { console.log('  ✗', msg, detail ? `(${detail})` : ''); failures += 1; }
}

// ---- Fakes ---------------------------------------------------------------

// A stand-in for window.Layers: the parts the module touches.
function makeLayers() {
  const list = [];
  return {
    list,
    renders: 0,
    add(asset) {
      const layer = {
        id: 'L' + (list.length + 1),
        asset,
        // Deliberately NOT the values the module sets: Layers.add() picks
        // these by index, and the module is expected to override them.
        blend: 'screen',
        baseScale: 0.8,
        opacity: 1,
        pos: { x: 0, y: 0, rot: 0 },
        rotOffset: 0,
        rotationEnabled: true,
        z: list.length,
        reactors: [],
      };
      list.push(layer);
      return layer;
    },
    remove(id) {
      const i = list.findIndex((l) => l.id === id);
      if (i >= 0) list.splice(i, 1);
    },
    render() { this.renders += 1; },
  };
}

// A stand-in for the Audio namespace: only audioEl matters here.
function makeAudio(tagName) {
  const el = {
    tagName,
    src: 'blob:fake-song',
    currentSrc: 'blob:fake-song',
    readyState: 1,
    videoWidth: 640,
    videoHeight: 360,
    listeners: {},
    addEventListener(name, fn) { (this.listeners[name] = this.listeners[name] || []).push(fn); },
    removeEventListener() {},
  };
  return { audioEl: el };
}

function makeCanvas() {
  return {
    width: 0,
    height: 0,
    getContext() { return { drawImage() {} }; },
    toDataURL() { return 'data:image/jpeg;base64,POSTER'; },
  };
}

// Load the module into a fresh sandbox. `prevHook` becomes whatever was
// already installed on window.__swrOnSongLoaded.
function loadModule(prevHook) {
  const sandbox = { console: { log() {}, warn() {}, error() {} } };
  sandbox.window = sandbox;
  sandbox.document = { createElement: (tag) => (tag === 'canvas' ? makeCanvas() : {}) };
  sandbox.setTimeout = setTimeout;
  sandbox.clearTimeout = clearTimeout;
  if (prevHook) sandbox.__swrOnSongLoaded = prevHook;
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(SRC, 'utf8'), sandbox, { filename: 'song-video-layer.client.js' });
  return sandbox;
}

const VIDEO_FILE = { name: 'clip.mp4', type: 'video/mp4' };
const AUDIO_FILE = { name: 'song.mp3', type: 'audio/mpeg' };

// ---- 1. A video song becomes a layer -------------------------------------

{
  const sb = loadModule(null);
  const Layers = makeLayers();
  const Audio = makeAudio('VIDEO');
  sb.Layers = Layers;
  sb.Audio = Audio;

  sb.__swrOnSongLoaded(VIDEO_FILE, Audio);

  assert(Layers.list.length === 1, 'a video song adds exactly one layer',
    `layers=${Layers.list.length}`);
  const layer = Layers.list[0];
  assert(!!layer && layer.asset.songBound === true, 'the layer is marked songBound');
  assert(!!layer && layer.asset._el === Audio.audioEl,
    'the layer shares the song\'s own element (one clock)',
    layer && layer.asset._el === Audio.audioEl ? 'same element' : 'different element');
  assert(!!layer && layer.asset.type === 'video', 'the layer is a video layer');
  assert(!!layer && layer.blend === 'source-over', 'the layer covers the stage',
    layer && layer.blend);
  assert(!!layer && layer.baseScale === 1, 'the layer is not zoomed',
    layer && String(layer.baseScale));
  assert(!!layer && layer.asset.name === 'clip.mp4', 'the layer carries the file name');
}

// ---- 2. An audio song adds no layer -------------------------------------

{
  const sb = loadModule(null);
  const Layers = makeLayers();
  const Audio = makeAudio('AUDIO');
  sb.Layers = Layers;
  sb.Audio = Audio;

  sb.__swrOnSongLoaded(AUDIO_FILE, Audio);
  assert(Layers.list.length === 0, 'an audio song adds no layer',
    `layers=${Layers.list.length}`);
}

// ---- 3. A new song replaces the previous song-video layer -----------------

{
  const sb = loadModule(null);
  const Layers = makeLayers();
  const first = makeAudio('VIDEO');
  const second = makeAudio('VIDEO');
  sb.Layers = Layers;

  sb.__swrOnSongLoaded(VIDEO_FILE, first);
  sb.__swrOnSongLoaded(VIDEO_FILE, second);

  const songLayers = Layers.list.filter((l) => l.asset && l.asset.songBound);
  assert(songLayers.length === 1, 'a new song leaves exactly one song-video layer',
    `songLayers=${songLayers.length}`);
  assert(songLayers[0] && songLayers[0].asset._el === second.audioEl,
    'the song-video layer is bound to the new song\'s element');
}

// ---- 4. An audio song removes a previous song-video layer ----------------

{
  const sb = loadModule(null);
  const Layers = makeLayers();
  const video = makeAudio('VIDEO');
  const audio = makeAudio('AUDIO');
  sb.Layers = Layers;

  sb.__swrOnSongLoaded(VIDEO_FILE, video);
  sb.__swrOnSongLoaded(AUDIO_FILE, audio);
  assert(Layers.list.length === 0, 'an audio song removes the song-video layer',
    `layers=${Layers.list.length}`);
}

// ---- 5. The seam chains ---------------------------------------------------

{
  let prevCalls = 0;
  const prev = function () { prevCalls += 1; };
  const sb = loadModule(prev);
  const Layers = makeLayers();
  const Audio = makeAudio('VIDEO');
  sb.Layers = Layers;

  sb.__swrOnSongLoaded(VIDEO_FILE, Audio);
  assert(prevCalls === 1, 'a subscriber installed earlier still runs',
    `calls=${prevCalls}`);
  assert(Layers.list.length === 1, 'and this module still adds its layer',
    `layers=${Layers.list.length}`);
}

// ---- 6. The poster frame is captured -------------------------------------

{
  const sb = loadModule(null);
  const Layers = makeLayers();
  const Audio = makeAudio('VIDEO');
  Audio.audioEl.readyState = 2;   // a frame is decoded
  sb.Layers = Layers;

  sb.__swrOnSongLoaded(VIDEO_FILE, Audio);
  const layer = Layers.list[0];
  assert(!!layer && typeof layer.asset.thumb === 'string' && layer.asset.thumb.length > 0,
    'the poster frame is captured from the element',
    layer && layer.asset.thumb ? layer.asset.thumb.slice(0, 24) : 'none');
  assert(Layers.renders > 0, 'the layer panel is repainted with the poster');
}

// ---- 7. The public API ---------------------------------------------------

{
  const sb = loadModule(null);
  const Layers = makeLayers();
  const Audio = makeAudio('VIDEO');
  sb.Layers = Layers;

  sb.__swrOnSongLoaded(VIDEO_FILE, Audio);
  const api = sb.SWR_SONG_VIDEO_LAYER;
  assert(!!api, 'window.SWR_SONG_VIDEO_LAYER is exposed');
  assert(!!api && api.layer() && api.layer().asset.songBound,
    'layer() returns the song-video layer');
  assert(!!api && api.remove() === true, 'remove() takes the layer off the stack');
  assert(Layers.list.length === 0, 'the stack is empty after remove()',
    `layers=${Layers.list.length}`);
  assert(!!api && api.remove() === false, 'remove() on an empty stack is a no-op');
}

console.log(failures ? `\nSONG VIDEO LAYER UNIT: FAILED (${failures})` : '\nSONG VIDEO LAYER UNIT: PASSED');
process.exit(failures ? 1 : 0);
