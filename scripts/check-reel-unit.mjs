#!/usr/bin/env node
// scripts/check-reel-unit.mjs — pure-logic unit tests for
// engine-reel.client.js (window.SWR_REEL), the auto-advance demo-reel
// player. Covers:
//   1.  loadReel() — manifest + set-doc fetch, state population, validation
//   2.  play()     — apply pipeline and layer-reset ordering
//   3.  layer stack never grows across tracks (reset + hero restore)
//   4.  importSet result caching (mp3s fetched once per track)
//   5.  'ended' auto-advance + ended-listener identity/cleanup
//   6.  no double-advance on repeated 'ended'
//   7.  loop wrap vs stop-at-end on auto-advance
//   8.  manual pause() never auto-advances
//   9.  next/prev/goto navigation incl. loop/clamp/restart edges
//   10. autoplay carry: a paused jump stays paused
//   11. stop() reset + listener detach + in-flight load invalidation
//   12. graceful degradation with missing globals
//   13. toolbar UI wiring (select/play/prev/next + label sync)
//
// Uses the node:vm trick from check-variant-switcher-unit.mjs (see also
// scripts/check-capture-unit.mjs): load the module source in a sandbox
// with browser shims, then drive the public API. The engine mocks follow
// the real contracts: SWR_SETS.importSet/applySet (swr-sets.js), the Audio
// bus with one 'ended' listener per loaded element (lib/audio.client.js),
// Layers.add/render + Library.items (lib/layers.client.js / library).

import vm from 'node:vm';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..');
const SRC_PATH = path.join(ROOT, 'engine-reel.client.js');

let failures = 0;
function assert(cond, msg, detail) {
  if (cond) {
    console.log('  ✓', msg, detail ? `(${detail})` : '');
  } else {
    console.log('  ✗', msg, detail ? `(${detail})` : '');
    failures += 1;
  }
}

function eq(got, expected, msg) {
  assert(got === expected, msg, `got ${JSON.stringify(got)}, expected ${JSON.stringify(expected)}`);
}

// Let every pending microtask in the vm context settle (the module uses no
// timers, so one macrotask boundary drains all of its async chains).
function settle() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

// ---------------------------------------------------------------------------
// Fixtures — a 3-track reel keeps the assertions readable. Same shape as
// marketplace/curated/slip-sets-1.reel.json (swr-reel/v1) and the v1 sets.
// ---------------------------------------------------------------------------

function makeManifest(overrides = {}) {
  return Object.assign({
    schema: 'swr-reel/v1',
    id: 'unit-reel',
    name: 'Unit Reel',
    loop: true,
    tracks: [
      { setFile: '/sets/one.swr-set.json', setId: 's1', name: 'Track A', engine: 'smoke', audio: '/a/one.mp3', durationSeconds: 10 },
      { setFile: '/sets/two.swr-set.json', setId: 's2', name: 'Track B', engine: 'film', audio: '/a/two.mp3', durationSeconds: 20 },
      { setFile: '/sets/three.swr-set.json', setId: 's3', name: 'Track C', engine: 'neon', audio: '/a/three.mp3', durationSeconds: 30 },
    ],
  }, overrides);
}

function makeSetDoc(i) {
  return JSON.stringify({
    schemaVersion: 1,
    id: 's' + (i + 1),
    name: ['Track A', 'Track B', 'Track C'][i] || 'Track ' + (i + 1),
    engine: ['smoke', 'film', 'neon'][i] || 'smoke',
    audio: { name: ['one.mp3', 'two.mp3', 'three.mp3'][i], mimeType: 'audio/mpeg', size: 1000 + i, url: '/a/' + i + '.mp3' },
    fx: { temp: i, mut: 0 },
    layers: [{
      id: 'ld1',
      name: 'Hero',
      blend: 'screen',
      opacity: 0.5,
      baseScale: 1.2,
      hue: 15,
      brightness: 1.1,
      contrast: 1.05,
      pos: { x: 1, y: 2, rot: 3 },
      rotOffset: 5,
      reactors: [{ feature: 'bass', target: 'scale', scale: 0.4 }],
      asset: { name: 'holo-' + i + '.webp', mimeType: 'image/webp', size: 500 + i, url: '/img/holo-' + i + '.webp' },
    }],
    settings: { bpm: 120, key: 'C', scale: 'major' },
  });
}

function defaultRoutes() {
  return {
    '/marketplace/curated/unit.reel.json': JSON.stringify(makeManifest()),
    '/sets/one.swr-set.json': makeSetDoc(0),
    '/sets/two.swr-set.json': makeSetDoc(1),
    '/sets/three.swr-set.json': makeSetDoc(2),
  };
}

// ---------------------------------------------------------------------------
// Browser shims
// ---------------------------------------------------------------------------

class MockElement {
  constructor(tag) {
    this.tagName = String(tag).toUpperCase();
    this.children = [];
    this.style = {};
    this.value = '';
    this.textContent = '';
    this.disabled = false;
    this.title = '';
    this.className = '';
    this._listeners = {};
  }
  appendChild(child) { this.children.push(child); return child; }
  addEventListener(evt, fn) { (this._listeners[evt] = this._listeners[evt] || []).push(fn); }
  removeEventListener(evt, fn) {
    const arr = this._listeners[evt] || [];
    const i = arr.indexOf(fn);
    if (i >= 0) arr.splice(i, 1);
  }
  fire(evt) {
    for (const fn of (this._listeners[evt] || []).slice()) fn({ target: this });
  }
  listenerCount(evt) { return (this._listeners[evt] || []).length; }
}

// Media element mimicking the Audio bus contract: loadFile() creates a FRESH
// element per load, and the bus owns exactly one 'ended' listener on it.
function makeMediaEl(log, name) {
  const el = new MockElement('audio');
  el.paused = true;
  el.currentTime = 0;
  el.duration = 100;
  el.addEventListener('ended', () => log.push('bus.ended:' + name));
  return el;
}

function makeAudio(log) {
  const audio = {
    audioEl: null,
    playing: false,
    loadFile(file) {
      const name = (file && file.name) || '?';
      audio.audioEl = makeMediaEl(log, name);
      log.push('audio.loadFile:' + name);
    },
    play() {
      audio.playing = true;
      if (audio.audioEl) audio.audioEl.paused = false;
      log.push('audio.play');
    },
    pause() {
      audio.playing = false;
      if (audio.audioEl) audio.audioEl.paused = true;
      log.push('audio.pause');
    },
  };
  return audio;
}

function makeLayers(log) {
  return {
    list: [],
    selected: null,
    add(asset) {
      log.push('layers.add:' + asset.name);
      this.list.push({ id: 'L' + (this.list.length + 1), asset });
      this.render();
    },
    render() { log.push('layers.render:list=' + this.list.length); },
  };
}

function makeSets(log, win) {
  return {
    importSet(doc) {
      const parsed = typeof doc === 'string' ? JSON.parse(doc) : doc;
      log.push('importSet:' + parsed.name);
      // Mirrors swr-sets.js importSet: media Files are derived from the doc.
      return Promise.resolve({
        meta: { name: parsed.name, engine: parsed.engine },
        audio: parsed.audio ? { name: parsed.audio.name, size: parsed.audio.size } : null,
        fx: parsed.fx || {},
        layers: (parsed.layers || []).map((ld) => Object.assign({}, ld, {
          asset: ld.asset ? { name: ld.asset.name, size: ld.asset.size } : null,
        })),
        settings: parsed.settings || {},
      });
    },
    applySet(set) {
      log.push('applySet:' + set.meta.name);
      log.push('fx.setPersona:' + set.meta.name);
      const audio = (win.SWR && win.SWR.Audio) || win.Audio || null;
      if (set.audio && audio && typeof audio.loadFile === 'function') {
        audio.loadFile(set.audio); // fresh media element each load
        if (typeof audio.play === 'function') audio.play();
      }
      // Mirrors swr-sets.js applySet: library files are appended and layer
      // metadata is mapped onto the TAIL of Layers.list — a no-op on the
      // empty list the reel hands it (that's what the reset guarantees).
      const lib = win.Library;
      const layers = win.Layers;
      if (set.layers && lib && layers) {
        for (const ld of set.layers) {
          if (!ld.asset) continue;
          const known = lib.items.some((i) => i.name === ld.asset.name && i.blob && i.blob.size === ld.asset.size);
          if (!known) lib.items.push({ name: ld.asset.name, blob: ld.asset });
        }
        for (let i = 0; i < set.layers.length; i++) {
          const nl = layers.list[layers.list.length - set.layers.length + i];
          if (nl) log.push('applySet.tailMap:' + nl.id); // must NOT fire after a reset
        }
      }
      return Promise.resolve({ log: [] });
    },
  };
}

// In-memory fetch with origin-normalized keys (resolveRef absolutizes refs
// against window.location.href).
function makeFetch(routes, fetchLog) {
  return function fetchMock(url) {
    const key = String(url).replace(/^https?:\/\/[^/]+/, '');
    fetchLog.push(key);
    const route = routes[key];
    if (route === undefined) {
      return Promise.resolve({ ok: false, status: 404, text: () => Promise.resolve(''), json: () => Promise.reject(new Error('404')) });
    }
    const body = typeof route === 'string' ? route : JSON.stringify(route);
    return Promise.resolve({
      ok: true,
      status: 200,
      text: () => Promise.resolve(body),
      json: () => Promise.resolve(JSON.parse(body)),
    });
  };
}

// ---------------------------------------------------------------------------
// Sandbox
// ---------------------------------------------------------------------------

function buildContext(opts = {}) {
  const {
    routes = defaultRoutes(),
    withSets = true,
    withAudio = true,
    withLayers = true,
    withLibrary = true,
    withUI = false,
  } = opts;

  const log = [];
  const statuses = [];
  const fetchLog = [];
  const win = {};
  const uiEls = {};

  if (withUI) {
    for (const id of ['reel-select', 'reel-play', 'reel-prev', 'reel-next', 'reel-status']) {
      uiEls[id] = new MockElement(id === 'reel-select' ? 'select' : id === 'reel-status' ? 'span' : 'button');
    }
  }

  const audio = withAudio ? makeAudio(log) : null;
  const layers = withLayers ? makeLayers(log) : null;
  const lib = withLibrary ? { items: [] } : null;

  if (audio) {
    win.SWR = { Audio: audio };
    win.Audio = audio;
  }
  if (layers) win.Layers = layers;
  if (lib) win.Library = lib;
  if (withSets) win.SWR_SETS = makeSets(log, win);
  win.setStatus = (msg, cls) => statuses.push({ msg: String(msg), cls: cls || '' });
  win.location = { href: 'http://localhost/engine/' };

  const doc = {
    readyState: 'complete',
    addEventListener: () => {},
    getElementById: (id) => uiEls[id] || null,
    createElement: (tag) => new MockElement(tag),
    body: new MockElement('body'),
  };

  const sandbox = {
    window: win,
    document: doc,
    fetch: makeFetch(routes, fetchLog),
    URL,
    console: { warn: () => {}, log: () => {}, error: () => {} },
    JSON,
    Math,
    Number,
    Object,
    Array,
    String,
    Promise,
    Error,
    isNaN,
  };

  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(SRC_PATH, 'utf8'), sandbox);

  return { sandbox, win, doc, uiEls, log, statuses, fetchLog, audio, layers, lib };
}

function api(ctx) { return ctx.win.SWR_REEL; }

// ---------------------------------------------------------------------------
// 1. loadReel()
// ---------------------------------------------------------------------------

function section1() {
  console.log('\n=== 1. loadReel() — fetch, state population, validation ===');
  const ctx = buildContext();
  const R = api(ctx);

  assert(!!R && !!R.state && typeof R.play === 'function', 'window.SWR_REEL exposes the public API');
  eq(R.state.total, 0, 'state.total starts at 0');

  return (async () => {
    const doc = await R.loadReel('/marketplace/curated/unit.reel.json');
    assert(doc && doc.schema === 'swr-reel/v1', 'loadReel resolves the parsed manifest');
    eq(R.state.total, 3, 'state.total = track count');
    eq(R.state.index, 0, 'state.index = 0 after load');
    eq(R.state.playing, false, 'loadReel does not start playback');
    eq(R.state.current && R.state.current.name, 'Track A', 'state.current = first track');
    eq(R.state.tracks.length, 3, 'state.tracks has one entry per track');
    eq(R.state.tracks[2].engine, 'neon', 'track info carries engine');
    eq(R.state.tracks[1].durationSeconds, 20, 'track info carries durationSeconds');

    const manifestFetches = ctx.fetchLog.filter((u) => u.endsWith('unit.reel.json')).length;
    const setFetches = ctx.fetchLog.filter((u) => u.startsWith('/sets/')).length;
    eq(manifestFetches, 1, 'manifest fetched once');
    eq(setFetches, 3, 'all three set docs fetched up front');

    // Validation
    const bad = buildContext({ routes: { '/bad.reel.json': JSON.stringify({ schema: 'swr-reel/v9', tracks: [{}] }) } });
    let threw = false;
    try { await api(bad).loadReel('/bad.reel.json'); } catch (e) { threw = true; }
    assert(threw, 'unsupported schema rejects');

    const noTracks = buildContext({ routes: { '/empty.reel.json': JSON.stringify({ schema: 'swr-reel/v1', tracks: [] }) } });
    threw = false;
    try { await api(noTracks).loadReel('/empty.reel.json'); } catch (e) { threw = true; }
    assert(threw, 'empty track list rejects');

    const noSetFile = buildContext({
      routes: { '/nosf.reel.json': JSON.stringify({ schema: 'swr-reel/v1', tracks: [{ name: 'x' }] }) },
    });
    threw = false;
    try { await api(noSetFile).loadReel('/nosf.reel.json'); } catch (e) { threw = true; }
    assert(threw, 'track without setFile rejects');

    threw = false;
    try { await R.loadReel('/missing.reel.json'); } catch (e) { threw = true; }
    assert(threw, '404 manifest rejects');
    eq(R.state.total, 3, 'failed load leaves the previous reel intact');
  })();
}

// ---------------------------------------------------------------------------
// 2-4. play() pipeline, layer reset ordering, layer stack, caching
// ---------------------------------------------------------------------------

function section2() {
  console.log('\n=== 2-4. play() pipeline · layer reset ordering · caching ===');
  const ctx = buildContext();
  const R = api(ctx);

  return (async () => {
    await R.loadReel('/marketplace/curated/unit.reel.json');
    await R.play(0);

    const iImport = ctx.log.indexOf('importSet:Track A');
    const iClear = ctx.log.indexOf('layers.render:list=0');
    const iApply = ctx.log.indexOf('applySet:Track A');
    const iAdd = ctx.log.indexOf('layers.add:holo-0.webp');
    assert(iImport >= 0, 'play(0) imports the track set');
    assert(iClear > iImport, 'layer reset happens after importSet (old hero stays up while media downloads)', `${iImport} < ${iClear}`);
    assert(iApply > iClear, 'applySet happens after the layer reset', `${iClear} < ${iApply}`);
    assert(iAdd > iApply, 'hero layer materializes after applySet', `${iApply} < ${iAdd}`);
    assert(ctx.log.indexOf('applySet.tailMap:') === -1, 'applySet tail mapping never touches stale layers');

    eq(ctx.layers.list.length, 1, 'exactly one hero layer after play(0)');
    const hero = ctx.layers.list[0];
    eq(hero.blend, 'screen', 'hero blend restored from the set');
    eq(hero.opacity, 0.5, 'hero opacity restored from the set');
    eq(hero.baseScale, 1.2, 'hero baseScale restored from the set');
    eq(hero.rotOffset, 5, 'hero rotOffset restored from the set');
    assert(Array.isArray(hero.reactors) && hero.reactors[0].feature === 'bass', 'hero reactors restored from the set');
    assert(hero.pos && hero.pos.x === 1, 'hero pos restored from the set');

    eq(ctx.win.SWR_REEL.state.playing, true, 'play(0) leaves the reel playing');
    eq(ctx.win.SWR_REEL.state.index, 0, 'state.index = 0');
    eq(ctx.win.SWR_REEL.state.current.name, 'Track A', 'state.current = Track A');
    assert(ctx.log.includes('audio.play'), 'audio started');

    // Swap to track 2 — the layer stack must not accumulate.
    await R.play(1);
    eq(ctx.layers.list.length, 1, 'still exactly one hero layer after play(1)');
    eq(ctx.layers.list[0].asset.name, 'holo-1.webp', 'hero layer is track 2\'s asset');
    assert(ctx.log.includes('audio.loadFile:two.mp3'), 'track 2 audio loaded');

    // importSet caching: replaying track 0 must reuse the imported set.
    const before = ctx.log.filter((l) => l === 'importSet:Track A').length;
    await R.play(0);
    const after = ctx.log.filter((l) => l === 'importSet:Track A').length;
    eq(after, before, 'importSet result cached — track 0 re-applies without a re-import');
    eq(ctx.fetchLog.filter((u) => u === '/sets/one.swr-set.json').length, 1, 'set doc fetched exactly once');
  })();
}

// ---------------------------------------------------------------------------
// 5-8. 'ended' auto-advance · double-advance · loop wrap · pause isolation
// ---------------------------------------------------------------------------

function section3() {
  console.log('\n=== 5-8. auto-advance on \'ended\' · double-advance · loop · pause ===');

  return (async () => {
    // --- 5. advance + listener identity --------------------------------
    const ctx = buildContext();
    const R = api(ctx);
    await R.loadReel('/marketplace/curated/unit.reel.json');
    await R.play(0);

    const el0 = ctx.audio.audioEl;
    eq(el0.listenerCount('ended'), 2, 'current element: bus listener + one reel listener');
    assert(typeof R.state === 'object', 'state exposed');

    el0.fire('ended');
    await settle();
    eq(R.state.index, 1, 'genuine \'ended\' auto-advances to track 2');
    eq(R.state.current.name, 'Track B', 'state.current follows the advance');
    eq(R.state.playing, true, 'the reel keeps rolling');
    const el1 = ctx.audio.audioEl;
    assert(el1 !== el0, 'advance loaded a fresh media element');
    eq(el0.listenerCount('ended'), 1, 'old element keeps only the bus listener (reel listener detached)');
    eq(el1.listenerCount('ended'), 2, 'new element carries the reel listener');

    // --- 6. no double-advance ------------------------------------------
    const appliesBefore = ctx.log.filter((l) => l.startsWith('applySet:')).length;
    el1.fire('ended');
    el1.fire('ended'); // second 'ended' in the same tick must be swallowed
    await settle();
    const appliesAfter = ctx.log.filter((l) => l.startsWith('applySet:')).length;
    eq(appliesAfter - appliesBefore, 1, 'two \'ended\' events advance exactly one track');
    eq(R.state.index, 2, 'state.index advanced once');

    // --- 7. loop wrap ---------------------------------------------------
    const el2 = ctx.audio.audioEl;
    el2.fire('ended'); // track 3 is the last; loop:true → wrap
    await settle();
    eq(R.state.index, 0, 'loop:true wraps from the last track to 0');
    eq(R.state.playing, true, 'wrap keeps playing');

    // loop:false — stop at end
    const ctx2 = buildContext({
      routes: Object.assign(defaultRoutes(), {
        '/marketplace/curated/unit.reel.json': JSON.stringify(makeManifest({ loop: false })),
      }),
    });
    const R2 = api(ctx2);
    await R2.loadReel('/marketplace/curated/unit.reel.json');
    await R2.goto(2);
    await settle();
    const appliesAtEnd = ctx2.log.filter((l) => l.startsWith('applySet:')).length;
    assert(appliesAtEnd > 0, 'goto(2) applied track 3');
    // goto(2) while paused does not autoplay — start it for the ended test
    await R2.resume();
    ctx2.audio.audioEl.fire('ended');
    await settle();
    eq(R2.state.playing, false, 'loop:false stops at the end of the last track');
    eq(R2.state.index, 2, 'stop-at-end leaves the index on the last track');
    eq(ctx2.log.filter((l) => l.startsWith('applySet:')).length, appliesAtEnd, 'no track applied after the reel finished');

    // --- 8. pause never advances ---------------------------------------
    const ctx3 = buildContext();
    const R3 = api(ctx3);
    await R3.loadReel('/marketplace/curated/unit.reel.json');
    await R3.play(0);
    R3.pause();
    eq(R3.state.playing, false, 'pause() clears the playing flag');
    const pausedEl = ctx3.audio.audioEl;
    const appliesPaused = ctx3.log.filter((l) => l.startsWith('applySet:')).length;
    pausedEl.fire('ended'); // straggler end while paused must be ignored
    await settle();
    eq(ctx3.log.filter((l) => l.startsWith('applySet:')).length, appliesPaused, 'paused \'ended\' does not advance');
    eq(R3.state.index, 0, 'index unchanged after paused \'ended\'');
    eq(R3.state.playing, false, 'still paused');
  })();
}

// ---------------------------------------------------------------------------
// 9-10. Navigation + autoplay carry
// ---------------------------------------------------------------------------

function section4() {
  console.log('\n=== 9-10. next/prev/goto · loop edges · autoplay carry ===');
  const ctx = buildContext();
  const R = api(ctx);

  return (async () => {
    await R.loadReel('/marketplace/curated/unit.reel.json');

    await R.next(); // playing=false → paused jump
    eq(R.state.index, 1, 'next() moves forward');
    eq(R.state.playing, false, 'next() while stopped stays paused (autoplay carry)');
    assert(ctx.log.includes('audio.pause'), 'applySet autoplay undone by the paused jump');

    await R.prev();
    eq(R.state.index, 0, 'prev() moves back');

    await R.prev(); // at 0, loop:true → wrap to the last track
    eq(R.state.index, 2, 'prev() at 0 wraps to the last track when loop:true');

    await R.next(); // at last, loop:true → wrap to 0
    eq(R.state.index, 0, 'next() at the last track wraps to 0 when loop:true');

    await R.goto(2);
    eq(R.state.index, 2, 'goto(2) jumps to track 3');
    await R.goto(99);
    eq(R.state.index, 2, 'goto(99) clamps to the last track');
    await R.goto(-5);
    eq(R.state.index, 0, 'goto(-5) clamps to 0');

    // loop:false edge behavior for manual nav
    const ctx2 = buildContext({
      routes: Object.assign(defaultRoutes(), {
        '/marketplace/curated/unit.reel.json': JSON.stringify(makeManifest({ loop: false })),
      }),
    });
    const R2 = api(ctx2);
    await R2.loadReel('/marketplace/curated/unit.reel.json');
    await R2.goto(2);
    const atEnd = R2.state.index;
    await R2.next();
    eq(R2.state.index, atEnd, 'next() at the last track stays put when loop:false');
    assert(ctx2.statuses.some((s) => s.msg === 'end of reel'), 'end-of-reel status surfaced');
    await R2.goto(0);
    const appliesBefore = ctx2.log.filter((l) => l.startsWith('applySet:')).length;
    await R2.prev();
    eq(R2.state.index, 0, 'prev() at 0 stays on track 0 when loop:false');
    assert(ctx2.log.filter((l) => l.startsWith('applySet:')).length > appliesBefore, 'prev() at 0 restarts the current track');

    // autoplay carry: a rolling reel keeps rolling through next()
    await R.play(0);
    R.state.playing = true;
    await R.next();
    eq(R.state.playing, true, 'next() while rolling keeps playing');
    assert(ctx.audio.playing === true, 'audio running after rolling next()');
  })();
}

// ---------------------------------------------------------------------------
// 11. stop()
// ---------------------------------------------------------------------------

function section5() {
  console.log('\n=== 11. stop() — reset, listener detach, in-flight invalidation ===');
  const ctx = buildContext();
  const R = api(ctx);

  return (async () => {
    await R.loadReel('/marketplace/curated/unit.reel.json');
    await R.play(1);
    const el = ctx.audio.audioEl;
    eq(R.state.index, 1, 'on track 2 before stop');

    R.stop();
    eq(R.state.playing, false, 'stop() pauses the reel');
    eq(R.state.index, 0, 'stop() resets to track 0');
    eq(R.state.current.name, 'Track A', 'stop() resets state.current');
    eq(el.listenerCount('ended'), 1, 'stop() detaches the reel \'ended\' listener');

    const appliesBefore = ctx.log.filter((l) => l.startsWith('applySet:')).length;
    el.fire('ended'); // detached + paused → nothing may happen
    await settle();
    eq(ctx.log.filter((l) => l.startsWith('applySet:')).length, appliesBefore, '\'ended\' after stop() never advances');

    // In-flight invalidation: a slow import must not apply after stop().
    const ctx2 = buildContext();
    const R2 = api(ctx2);
    await R2.loadReel('/marketplace/curated/unit.reel.json');
    let releaseImport = null;
    const gate = new Promise((resolve) => { releaseImport = resolve; });
    const origImport = ctx2.win.SWR_SETS.importSet;
    ctx2.win.SWR_SETS.importSet = (doc) => gate.then(() => origImport(doc));

    const playP = R2.play(0);
    await settle();
    R2.stop();
    releaseImport();
    await playP;
    await settle();
    assert(!ctx2.log.some((l) => l.startsWith('applySet:')), 'superseded track load never applies after stop()');
    eq(R2.state.playing, false, 'stop() wins over the stale load');
    eq(R2.state.index, 0, 'index stays at the stop() reset value');

    // destroy() drops subscribers
    const ctx3 = buildContext();
    const R3 = api(ctx3);
    let calls = 0;
    const unsub = R3.subscribe(() => { calls += 1; });
    await R3.loadReel('/marketplace/curated/unit.reel.json');
    assert(calls > 0, 'subscribe() receives state updates');
    const seen = calls;
    unsub();
    await R3.play(0);
    eq(calls, seen, 'unsubscribe() stops updates');
    let calls2 = 0;
    R3.subscribe(() => { calls2 += 1; });
    R3.destroy();
    await R3.goto(0);
    eq(calls2, 1, 'destroy() drops subscribers (only the destroy notify arrives)');
  })();
}

// ---------------------------------------------------------------------------
// 12. Missing globals
// ---------------------------------------------------------------------------

function section6() {
  console.log('\n=== 12. graceful degradation with missing globals ===');

  return (async () => {
    const noSets = buildContext({ withSets: false });
    const R = api(noSets);
    await R.loadReel('/marketplace/curated/unit.reel.json');
    let threw = false;
    try { await R.play(0); } catch (e) { threw = true; }
    assert(!threw, 'play() without SWR_SETS does not throw');
    eq(R.state.playing, false, 'play() without SWR_SETS does not claim to play');
    assert(noSets.statuses.length > 0, 'a status message was surfaced');

    const noAudio = buildContext({ withAudio: false });
    const R2 = api(noAudio);
    await R2.loadReel('/marketplace/curated/unit.reel.json');
    threw = false;
    try { await R2.play(0); } catch (e) { threw = true; }
    assert(!threw, 'play() without an Audio bus does not throw');
    eq(R2.state.playing, false, 'track without playable audio stays paused');
    assert(noAudio.statuses.some((s) => /no audio/.test(s.msg)), 'missing audio surfaced as a warning');
    eq(noAudio.layers.list.length, 1, 'hero layer still restored without audio');

    const noLayers = buildContext({ withLayers: false, withLibrary: false });
    const R3 = api(noLayers);
    await R3.loadReel('/marketplace/curated/unit.reel.json');
    threw = false;
    try { await R3.play(0); } catch (e) { threw = true; }
    assert(!threw, 'play() without Layers/Library does not throw');
    eq(R3.state.playing, true, 'audio-only playback still works without Layers');

    threw = false;
    try { await api(buildContext()).play(0); } catch (e) { threw = true; }
    assert(!threw, 'play() with no reel loaded does not throw');
  })();
}

// ---------------------------------------------------------------------------
// 13. Toolbar UI wiring — runs against the REAL Slip Sets 1 artifacts, so
// this doubles as a contract check on the committed reel + set docs.
// ---------------------------------------------------------------------------

function realSlipRoutes() {
  const routes = {};
  const manifestRaw = fs.readFileSync(path.join(ROOT, 'marketplace/curated/slip-sets-1.reel.json'), 'utf8');
  const manifest = JSON.parse(manifestRaw);
  routes['/marketplace/curated/slip-sets-1.reel.json'] = manifestRaw;
  for (const t of manifest.tracks) {
    routes[t.setFile] = fs.readFileSync(path.join(ROOT, t.setFile.replace(/^\//, '')), 'utf8');
  }
  return routes;
}

function section7() {
  console.log('\n=== 13. toolbar UI wiring (real Slip Sets 1 artifacts) ===');
  const ctx = buildContext({ withUI: true, routes: realSlipRoutes() });
  const R = api(ctx);
  const sel = ctx.uiEls['reel-select'];
  const playBtn = ctx.uiEls['reel-play'];
  const label = ctx.uiEls['reel-status'];

  return (async () => {
    eq(sel.children.length, R.CATALOG.length + 1, 'select lists the catalog + a placeholder');
    eq(sel.children[0].textContent, '— Demo reels —', 'placeholder option first');
    eq(sel.children[1].textContent, 'Slip Sets 1', 'catalog entries listed');
    eq(label.textContent, 'no reel', 'idle label before any reel');
    eq(playBtn.textContent, '▶ Play', 'idle play button label');

    // Picking a reel loads AND plays it (hands-off playlist).
    sel.value = R.CATALOG[0].url;
    sel.fire('change');
    await settle();
    await settle();
    assert(ctx.fetchLog.some((u) => u.endsWith('slip-sets-1.reel.json')), 'catalog manifest fetched on select');
    eq(R.state.total, 7, 'Slip Sets 1 has 7 tracks');
    eq(R.state.index, 0, 'selection starts at track 1');
    eq(R.state.playing, true, 'selection starts playback');
    eq(label.textContent, '1/7 · Bebop Blue', 'label shows N/total · track name');
    eq(playBtn.textContent, '❚❚ Pause', 'play button flips while rolling');

    playBtn.fire('click');
    eq(R.state.playing, false, 'button click pauses the reel');
    eq(label.textContent, '❚❚ 1/7 · Bebop Blue', 'paused label is prefixed');
    eq(playBtn.textContent, '▶ Play', 'play button flips back');

    playBtn.fire('click');
    await settle();
    eq(R.state.playing, true, 'button click resumes the reel');
    eq(playBtn.textContent, '❚❚ Pause', 'play button flips while rolling again');

    ctx.uiEls['reel-next'].fire('click');
    await settle();
    eq(R.state.index, 1, 'next button advances');
    eq(label.textContent, '2/7 · Bebop Blue · Take 2', 'label shows the exact "2/7 · name" format');

    ctx.uiEls['reel-prev'].fire('click');
    await settle();
    eq(R.state.index, 0, 'prev button moves back');
  })();
}

// ---------------------------------------------------------------------------
// 14. Real artifact audio paths resolve
// ---------------------------------------------------------------------------
// check:dist-links only walks HTML and verify-reel never fetches audio, so a
// manifest that points at an MP3 missing from the repo passed every gate
// while /engine/ 404'd on first play. Assert here, against the real files.

function section8() {
  console.log('\n=== 14. Slip Sets 1 audio paths exist on disk ===');
  const isAbsolute = (u) => /^https?:\/\//.test(u);
  const exists = (u) => isAbsolute(u) || fs.existsSync(path.join(ROOT, u.replace(/^\//, '')));
  const reelPath = path.join(ROOT, 'marketplace/curated/slip-sets-1.reel.json');
  const reel = JSON.parse(fs.readFileSync(reelPath, 'utf8'));
  for (const t of reel.tracks) {
    if (t.audio) assert(exists(t.audio), `reel track "${t.name}" audio exists`, t.audio);
    const setPath = path.join(ROOT, t.setFile.replace(/^\//, ''));
    assert(fs.existsSync(setPath), `reel track "${t.name}" setFile exists`, t.setFile);
    if (!fs.existsSync(setPath)) continue;
    const set = JSON.parse(fs.readFileSync(setPath, 'utf8'));
    const url = set.audio && set.audio.url;
    if (url) assert(exists(url), `set "${t.name}" audio.url exists`, url);
  }
  return Promise.resolve();
}

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------

async function main() {
  await section1();
  await section2();
  await section3();
  await section4();
  await section5();
  await section6();
  await section7();
  await section8();

  console.log('\n' + (failures === 0
    ? 'REEL UNIT: all assertions passed'
    : `REEL UNIT: ${failures} failure(s)`));
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error('CAUGHT:', e.stack);
  process.exit(2);
});
