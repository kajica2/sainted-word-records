#!/usr/bin/env node
// scripts/check-directors-unit.mjs — pure-logic unit tests for the Director
// system in client/engine-directors.client.js (Scene, Loop, and the
// duration-windowed Short/Medium/Long narrative trio).
//
// 5 sections: module+exports, scene, loop, structured (arc) directors,
// beat-quantized helper. Loaded through node:vm with a bare `window` shim —
// the module is a plain IIFE that attaches window.SWR_DIRECTORS.
//
// Run:  node scripts/check-directors-unit.mjs
// Exit: 0 = all assertions pass, 1 = any failure, 2 = caught error.

import vm from 'node:vm';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const ROOT = path.resolve(path.dirname(__filename), '..');
const SRC = path.join(ROOT, 'client/engine-directors.client.js');

let failures = 0;
function assert(cond, msg, detail) {
  if (cond) console.log('  ✓', msg, detail ? `(${detail})` : '');
  else { console.log('  ✗', msg, detail ? `(${detail})` : ''); failures += 1; }
}

// ---- Load the module ----------------------------------------------------

const sandbox = { window: {} };
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(SRC, 'utf8'), sandbox, { filename: 'engine-directors.client.js' });
const D = sandbox.window.SWR_DIRECTORS;

// ---- Context builder ----------------------------------------------------

function ctxWith(bar, extra = {}) {
  return Object.assign({
    layers: [], bar, beat: 0, beatPhase: 0, energy: 0, time: 0,
    audio: { bpm: 120, bass: 0, mid: 0, treble: 0, beat: 0, rms: 0 },
    fx: [], meta: {}
  }, extra);
}

// Seconds a bar budget covers at a given BPM (1 bar = 4 beats = 240/bpm s)
const secs = (bars, bpm) => bars * 240 / bpm;

// ---- Section 1: module + exports ---------------------------------------

function section1() {
  console.log('\n[1] module + exports');
  assert(typeof D === 'object', 'window.SWR_DIRECTORS is exported');
  const expected = ['sceneDirector', 'loopDirector', 'shortDirector',
    'mediumDirector', 'longDirector', 'createDirector', 'onBeat', 'DIRECTORS'];
  for (const key of expected) {
    assert(typeof D[key] === 'function' || key === 'DIRECTORS', `exports ${key}`,
      typeof D[key]);
  }
  assert(Object.keys(D.DIRECTORS).join(',') === 'scene,loop,short,medium,long',
    'DIRECTORS registry lists all five types', Object.keys(D.DIRECTORS).join(','));

  assert(D.mediumDirector({}).name === 'medium:verse-chorus-bridge-outro',
    'mediumDirector default name', D.mediumDirector({}).name);
  assert(D.longDirector({}).name === 'long:full-song',
    'longDirector default name', D.longDirector({}).name);
  assert(D.shortDirector({}).name === 'short:hook-build-drop-outro',
    'shortDirector default name', D.shortDirector({}).name);

  // Config-less construction must not throw
  for (const type of ['scene', 'loop', 'short', 'medium', 'long']) {
    let threw = null;
    try { D.createDirector(type); } catch (e) { threw = e; }
    assert(threw === null, `createDirector('${type}') with no options`);
  }

  let err = null;
  try { D.createDirector('music-video'); } catch (e) { err = e; }
  assert(err && /Unknown director: music-video/.test(err.message),
    'createDirector rejects unknown type', err && err.message);
  assert(err && /scene, loop, short, medium, long/.test(err.message),
    'error message lists every available type');
}

// ---- Section 2: scene director -----------------------------------------

function section2() {
  console.log('\n[2] scene director');
  const calls = { t1: 0, t2: 0 };
  const scenes = [
    { id: 'intro', startBar: 0, bars: 4, layers: ['A'], transitionIn: () => {} },
    { id: 'verse', startBar: 4, bars: 8, layers: ['B'], transitionIn: () => { calls.t1 += 1; } },
    { id: 'chorus', startBar: 12, bars: 8, layers: ['C'], transitionIn: () => { calls.t2 += 1; } }
  ];
  const dir = D.sceneDirector({ scenes });
  assert(dir.name === 'scene:intro', 'name uses first scene id', dir.name);

  const ctx = ctxWith(0);
  dir.setup(ctx);
  assert(ctx.layers === scenes[0].layers, 'setup installs first scene layers');
  assert(ctx._cur === 'intro', 'setup records current scene', ctx._cur);

  dir.update(ctx);
  assert(calls.t1 === 0 && ctx._cur === 'intro', 'bar 0 stays in intro (no transition)');

  ctx.bar = 5;
  dir.update(ctx);
  assert(ctx._cur === 'verse' && ctx.layers === scenes[1].layers, 'bar 5 switches to verse');
  assert(calls.t1 === 1, 'transitionIn fired once');

  dir.update(ctx);
  assert(calls.t1 === 1, 'repeat update does not re-fire transitionIn');

  ctx.bar = 12;
  dir.update(ctx);
  assert(ctx._cur === 'chorus' && calls.t2 === 1, 'bar 12 switches to chorus');

  assert(dir.includes(0) === true && dir.includes(3) === true, 'includes() covers intro bars');
  assert(dir.includes(4) === true, 'includes() hands over to the next scene at its startBar');
  assert(dir.includes(19) === true && dir.includes(20) === false,
    'includes() respects each scene length');
  assert(dir.includes(99) === false, 'includes() excludes bars past the last scene');

  const empty = D.sceneDirector({ scenes: [] });
  assert(empty.name === 'scene:empty', 'empty config names itself scene:empty', empty.name);
  const emptyCtx = ctxWith(0);
  empty.setup(emptyCtx);
  empty.update(emptyCtx);
  assert(emptyCtx.layers.length === 0, 'empty scenes update is a no-op');
}

// ---- Section 3: loop director ------------------------------------------

function section3() {
  console.log('\n[3] loop director');
  const layers = [{ id: 'a' }, null, { id: 'c' }];
  const dir = D.loopDirector({ bars: 4, layers, seamFade: 0.1 });
  assert(dir.name === 'loop:4bars', 'name reflects bar count', dir.name);

  const ctx = ctxWith(0, { beat: 0, audio: { bpm: 140, bass: 255, rms: 0 } });
  dir.setup(ctx);
  assert(ctx.layers === layers, 'setup installs the layer stack');
  assert(ctx._loopLen === 16, 'setup derives 16 beats from 4 bars', String(ctx._loopLen));

  dir.update(ctx);
  assert(ctx.phase === 0, 'beat 0 → phase 0', String(ctx.phase));
  assert(ctx.seam === true, 'phase 0 is inside the seam window');
  const expectEnergy = 255 / 255 * 0.6 + 0 / 255 * 0.4;
  assert(Math.abs(ctx.energy - expectEnergy) < 1e-9, 'energy = 0.6*bass + 0.4*rms',
    ctx.energy.toFixed(3));

  ctx.beat = 8;
  dir.update(ctx);
  assert(Math.abs(ctx.phase - 0.5) < 1e-9, 'beat 8 of 16 → phase 0.5', String(ctx.phase));
  assert(ctx.seam === false, 'mid-loop is not a seam');
  assert(layers[0].phase === 0.5, 'phase propagates to layers');
  assert(layers[1] === null, 'null layer slots are tolerated');

  // Wrap-around: beat beyond the loop length still lands inside 0..1
  ctx.beat = 17;
  dir.update(ctx);
  assert(ctx.phase >= 0 && ctx.phase < 1, 'phase wraps past the loop length',
    String(ctx.phase));

  // No audio features yet (BPM falls back to 120) must not throw
  const bareCtx = { layers: [], bar: 0, beat: 0, energy: 0, fx: [] };
  const fresh = D.loopDirector({ bars: 2 });
  fresh.setup(bareCtx);
  fresh.update(bareCtx);
  assert(Number.isFinite(bareCtx.phase), 'update works without ctx.audio',
    String(bareCtx.phase));
}

// ---- Section 4: structured (arc) directors ------------------------------

const WINDOWS = {
  short: { bpm: 120, min: 30, max: 60, last: 'outro', defaultTemplate: 'hook-build-drop-outro' },
  medium: { bpm: 120, min: 60, max: 120, last: 'outro', defaultTemplate: 'verse-chorus-bridge-outro' },
  long: { bpm: 120, min: 120, max: 300, last: 'end', defaultTemplate: 'full-song' }
};

function section4() {
  console.log('\n[4] structured directors (short / medium / long)');

  for (const [kind, spec] of Object.entries(WINDOWS)) {
    console.log(`  — ${kind}`);
    const dir = D.createDirector(kind, {});

    // Arc + budget are installed on setup
    const ctx = ctxWith(0);
    dir.setup(ctx);
    assert(Array.isArray(ctx.arc) && ctx.arc.length > 0, `${kind}: setup exposes the arc`,
      `${ctx.arc.length} segments`);
    assert(ctx.layers.length === 0, `${kind}: setup installs baseLayers`);

    // Duration window: default, far-under and far-over requests all clamp
    const clamps = [undefined, 1, 100000];
    for (const bars of clamps) {
      const d = D.createDirector(kind, bars === undefined ? {} : { bars });
      const c = ctxWith(0, { audio: { bpm: spec.bpm, bass: 0, rms: 0 } });
      d.setup(c);
      d.update(c);
      const seconds = secs(c._bars, spec.bpm);
      assert(seconds >= spec.min && seconds <= spec.max,
        `${kind}: bars=${bars} lands inside ${spec.min}-${spec.max}s`,
        `${c._bars} bars = ${seconds}s`);
    }

    // Low BPM keeps the window too
    const low = D.createDirector(kind, { bars: 1 });
    const lowCtx = ctxWith(0, { audio: { bpm: 60, bass: 0, rms: 0 } });
    low.setup(lowCtx); low.update(lowCtx);
    const lowSecs = secs(lowCtx._bars, 60);
    assert(lowSecs >= spec.min && lowSecs <= spec.max,
      `${kind}: window holds at 60 BPM`, `${lowCtx._bars} bars = ${lowSecs}s`);

    // Section walk: bar 0 → first section, final bar → final section
    const walk = D.createDirector(kind, {});
    const walkCtx = ctxWith(0, { audio: { bpm: spec.bpm, bass: 0, rms: 0 } });
    walk.setup(walkCtx);
    walk.update(walkCtx);
    assert(walkCtx.section === walkCtx.arc[0].name,
      `${kind}: bar 0 → first section`, walkCtx.section);

    const endCtx = ctxWith(walkCtx._bars - 1, { audio: { bpm: spec.bpm, bass: 0, rms: 0 } });
    walk.setup(endCtx);
    walk.update(endCtx);
    assert(endCtx.section === spec.last,
      `${kind}: final bar reaches the closing section`, endCtx.section);

    // Energy: arc value at bar 0, exact when audio contributes nothing
    const zeroAudio = ctxWith(0, { audio: { bpm: spec.bpm, bass: 0, rms: 0 }, fx: [{}, {}] });
    walk.setup(zeroAudio);
    walk.update(zeroAudio);
    assert(Math.abs(zeroAudio.energy - walkCtx.arc[0].energy) < 1e-9,
      `${kind}: silent audio leaves arc energy untouched`, zeroAudio.energy.toFixed(3));
    assert(zeroAudio.fx.every((f) => f.intensity === zeroAudio.energy),
      `${kind}: every FX slot mirrors ctx.energy`);

    // Audio boost is added and clamped to 1
    const hot = ctxWith(0, { audio: { bpm: spec.bpm, bass: 255, rms: 255 }, fx: [{}] });
    walk.setup(hot);
    walk.update(hot);
    const boost = walkCtx.arc[0].energy + 0.3 + 0.2;
    assert(hot.energy === Math.min(1, boost),
      `${kind}: bass+loudness boost applied`, hot.energy.toFixed(3));
    assert(hot.energy <= 1 && hot.fx[0].intensity === hot.energy,
      `${kind}: energy clamped and pushed to FX`, String(hot.energy));

    // Unknown template falls back to the default arc, not a crash
    const fallback = D.createDirector(kind, { template: 'does-not-exist' });
    assert(fallback.name === `${kind}:${spec.defaultTemplate}`,
      `${kind}: unknown template falls back`, fallback.name);
    const fbCtx = ctxWith(0);
    fallback.setup(fbCtx);
    assert(fbCtx.arc[0].name !== undefined && fbCtx.arc.length > 0,
      `${kind}: fallback loads a real arc`, fbCtx.arc[0].name);
  }

  // Progression: energy actually moves through the arc (not stuck flat),
  // and the closing section holds a real slice of the piece.
  const dir = D.createDirector('long', {});
  const probe = ctxWith(0, { audio: { bpm: 120, bass: 0, rms: 0 } });
  dir.setup(probe);
  const lastBar = probe._bars - 1;
  const barsToSample = [];
  for (let bar = 0; bar <= lastBar; bar += 4) barsToSample.push(bar);
  if (barsToSample[barsToSample.length - 1] !== lastBar) barsToSample.push(lastBar);

  const samples = barsToSample.map((bar) => {
    const c = ctxWith(bar, { audio: { bpm: 120, bass: 0, rms: 0 } });
    dir.setup(c);
    dir.update(c);
    return c.section;
  });
  const unique = [...new Set(samples)];
  assert(unique.length >= 5, 'long arc walks through multiple sections', unique.join(' → '));
  assert(unique[0] === 'intro' && unique[unique.length - 1] === 'end',
    'long arc starts at intro and ends at end', `${unique[0]} → ${unique[unique.length - 1]}`);
  const endShare = samples.filter((s) => s === 'end').length / samples.length;
  assert(endShare >= 0.05, 'closing section is more than a single bar',
    `${(endShare * 100).toFixed(0)}% of sampled bars`);
}

// ---- Section 5: beat-quantized helper ----------------------------------

function section5() {
  console.log('\n[5] onBeat helper');
  assert(D.onBeat({ beatPhase: 0.05 }) === true, 'beatPhase 0.05 → on beat');
  assert(D.onBeat({ beatPhase: 0.5 }) === false, 'beatPhase 0.5 → off beat');
  assert(D.onBeat({ beatPhase: 0.3 }, 0.5) === true, 'custom threshold honored');
  assert(D.onBeat({ beatPhase: 0.5 }, 0) === false,
    'falsy threshold falls back to the 0.1 default');
  assert(D.onBeat({}) === false, 'missing beatPhase → false, no throw');
}

// ---- Run ----------------------------------------------------------------

function main() {
  section1();
  section2();
  section3();
  section4();
  section5();

  console.log('\n' + (failures === 0
    ? 'DIRECTORS UNIT: all assertions passed'
    : `DIRECTORS UNIT: ${failures} failure(s)`));
  process.exit(failures === 0 ? 0 : 1);
}

try {
  main();
} catch (e) {
  console.error('CAUGHT:', e.stack);
  process.exit(2);
}
