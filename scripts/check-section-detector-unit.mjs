#!/usr/bin/env node
// scripts/check-section-detector-unit.mjs - section-detector unit gate.
//
// client/section-detector.client.js is the engine's section detector (plan
// P1.3, architecture-audit-2026-10). Its algorithm is a rolling
// self-similarity matrix over beat-aligned audio-feature rows plus a Foote
// checkerboard novelty curve; section boundaries are peaks of that curve.
//
// The fixture is a synthetic 72-beat track with three distinct sections, built
// to punish a naive energy-threshold segmenter:
//
//   A (beats 0-23)   calm   low level, bass-heavy, sparse onsets. The level
//                              ALTERNATES 0.30 / 0.10 every beat, so a
//                              delta-on-loudness rule cuts it into pieces,
//                              while the timbre vector is unchanged: a louder
//                              beat is every band louder at once, and the
//                              descriptor row is L2-normalised.
//   B (beats 24-47)  busy   bright, dense onsets, and the level DECAYSS from
//                              0.62 to 0.14 across the section. One timbre
//                              vector throughout, so a novelty detector sees
//                              no change inside it; an energy rule sees a ramp
//                              and cuts it in half.
//   C (beats 48-71)  quiet  mid-heavy, sparse onsets, at a level B had
//                              already passed through. The boundary at beat
//                              48 is a TIMBRE change, findable only by the
//                              matrix.
//
// Assertions:
//   1. the live contract automix.client.js calls exists and is well formed
//   2. both true boundaries are found, within [-2, +K+2] beats
//   3. at most 1 false positive   <- the load-bearing assertion
//   4. the old energy-threshold rule run on the SAME fixture produces more
//      than 1 false positive, i.e. the fixture really does discriminate
//   5. ingest is idempotent per timestamp (the engine loop and the automix
//      tick both pass the same live Audio.feat, so a double call must not
//      double-count)
//   6. confidence is bounded and damped while a section is young
//   7. swr-section-change fires with the { from, to, ... } detail that
//      client/section-scheduler.client.js reads
//   8. the batch entry point keeps its documented shape
//   9. reset() clears the stream and republishes an empty map
//  10. the real consumer (automix.client.js) sees real sections
//  11. the arc reads the live boundary as a soft cue
//  12. the REAL producer (lib/audio.client.js) stamps the frame's identity
//      (feat.tMs, the media clock in milliseconds), so the two production
//      callers of the same live feature object ingest the frame ONCE —
//      126 detect() calls over 63 real frames are 63 ingests, not 126.
//      A self-test proves the assertion can still fail: it strips the
//      stamp from the shipped producer source and the same check goes RED.
//
// Run:  node scripts/check-section-detector-unit.mjs
// Exit: 0 PASS, 1 FAIL.

import vm from 'node:vm';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const SRC = path.join(ROOT, 'client/section-detector.client.js');
const AUTOMIX_SRC = path.join(ROOT, 'client/automix.client.js');

let pass = 0;
const failures = [];
function assert(cond, msg, detail) {
  if (cond) {
    pass++;
    console.log('  ok  ', msg, detail != null ? `(${detail})` : '');
  } else {
    failures.push(msg);
    console.log('  FAIL', msg, detail != null ? `(${detail})` : '');
  }
}

// ── sandbox ────────────────────────────────────────────────────────────────
let clock = 0;
const listeners = {};
const win = {
  CustomEvent: function CustomEvent(type, init) {
    this.type = type;
    this.detail = (init && init.detail) || null;
  },
  dispatchEvent(ev) {
    (listeners[ev.type] || []).forEach((fn) => fn(ev));
    return true;
  },
  addEventListener(type, fn) {
    (listeners[type] = listeners[type] || []).push(fn);
  },
  removeEventListener(type, fn) {
    const arr = listeners[type] || [];
    const i = arr.indexOf(fn);
    if (i >= 0) arr.splice(i, 1);
  },
  performance: { now: () => clock },
};
const ctx = vm.createContext({ window: win, performance: win.performance, console });
vm.runInContext(fs.readFileSync(SRC, 'utf8'), ctx, { filename: 'section-detector.client.js' });

const S = win.SWR_SECTION;
const D = win.SWR_SECTION_DETECTOR;

// ── the synthetic track ────────────────────────────────────────────────────
// Timbre is a proportion vector; level is a separate multiplier, so a louder
// beat is every band louder at once and the L2-normalised descriptor row is
// unchanged. That is the property under test.
const CALM = { bass: 0.62, mid: 0.20, treble: 0.08, centroid: 0.18, onset: 0.18 };
const BUSY = { bass: 0.18, mid: 0.34, treble: 0.52, centroid: 0.78, onset: 0.85 };
const QUIET = { bass: 0.14, mid: 0.60, treble: 0.18, centroid: 0.46, onset: 0.25 };

const BEAT_MS = 500; // 120 BPM
const SUBS = 4;      // detect() is called at 125 ms, like the engine's rAF
const NOISE = 0.03;  // per-dim wobble, so the rows are not literally equal

const BOUNDS = [24, 48];
const TOTAL_BEATS = 72;

function timbreAt(beat) {
  if (beat < 24) return CALM;
  if (beat < 48) return BUSY;
  return QUIET;
}
function levelAt(beat) {
  if (beat < 24) return beat % 2 === 0 ? 0.30 : 0.10;      // accented downbeats
  if (beat < 48) return 0.62 - (beat - 24) * (0.48 / 23);  // long decrescendo
  return beat % 2 === 0 ? 0.22 : 0.12;                    // quiet, low accents
}

// Deterministic pseudo-noise: no Math.random, so a failure reproduces.
function wobble(i, k) {
  const s = Math.sin(i * 12.9898 + k * 78.233) * 43758.5453;
  return (s - Math.floor(s) - 0.5) * 2 * NOISE;
}

// Sub-sample features: the engine reads Audio.feat every frame, so the
// per-beat level is what the level knob produces and the bands follow it.
function featFor(beat, sub) {
  const t = timbreAt(beat);
  const level = levelAt(beat);
  const gain = 0.35 + level;
  const tMs = (beat * SUBS + sub) * (BEAT_MS / SUBS);
  const w = (key, k) => Math.max(0, t[key] * gain + wobble(tMs / BEAT_MS + sub * 0.25, k));
  return {
    bpm: 120,
    rms: level * (1 + wobble(beat * SUBS + sub, 7)),
    bass: w('bass', 1),
    mid: w('mid', 2),
    treble: w('treble', 3),
    centroid: w('centroid', 4),
    onset: Math.max(0, t.onset + wobble(tMs / BEAT_MS + sub * 0.25, 5)),
    beat: sub === 0 ? 1 : 0,
    onsetPulse: sub === 0 ? 1 : 0,
    tMs,
  };
}

function drive(beats, repeat = 1, onSample) {
  let last = null;
  for (let beat = 0; beat < beats; beat++) {
    for (let sub = 0; sub < SUBS; sub++) {
      clock = (beat * SUBS + sub) * (BEAT_MS / SUBS);
      const f = featFor(beat, sub);
      for (let k = 0; k < repeat; k++) last = S.detect(f);
      if (onSample) onSample(last, f);
    }
  }
  return last;
}

// Boundary matching. Late tolerance is the kernel's lookahead: a boundary
// cannot be seen until K frames of the NEW section have arrived. Early
// tolerance covers frame quantisation only.
function matchAll(detectedList, truthList, early, late) {
  const used = new Set();
  const pairs = [];
  for (const t of truthList) {
    let best = -1;
    let bestD = Infinity;
    detectedList.forEach((d, i) => {
      if (used.has(i)) return;
      const dist = Math.abs(d - t);
      if (dist < bestD) { bestD = dist; best = i; }
    });
    const ok = best >= 0 && detectedList[best] >= t - early && detectedList[best] <= t + late;
    if (ok) used.add(best);
    pairs.push({ truth: t, detected: ok ? detectedList[best] : null });
  }
  return { pairs, fps: detectedList.filter((_, i) => !used.has(i)) };
}

// ── 1. the live contract automix.client.js depends on ──────────────────────
assert(!!(win.SWR_SECTION && typeof S.detect === 'function'),
  'window.SWR_SECTION.detect exists (automix.client.js:439 calls it)');
assert(!!(win.SWR_SECTION_DETECTOR && typeof D.detectSections === 'function'),
  'window.SWR_SECTION_DETECTOR.detectSections exists (batch callers)');
assert(Array.isArray(win.SWR_SECTIONS), 'window.SWR_SECTIONS is published as an array');
assert(S.LABELS.join(',') === 'intro,verse,prechorus,chorus,breakdown,outro',
  'the label taxonomy matches the automix POOL_BIAS keys', S.LABELS.join(' / '));

// ── drive the fixture ──────────────────────────────────────────────────────
S.reset();
const events = [];
win.addEventListener('swr-section-change', (ev) => events.push(ev.detail));
drive(TOTAL_BEATS);
const firstPassEvents = events.slice();

const K = S.options.kernelHalf;
const detected = win.SWR_SECTIONS.map((s) => s.startFrame).slice(1); // 0 opens the map
const m = matchAll(detected, BOUNDS, 2, K + 2);

// ── 2. the boundaries land where they should ───────────────────────────────
for (const p of m.pairs) {
  assert(p.detected !== null,
    `the boundary at beat ${p.truth} is found`,
    p.detected === null ? `got [${detected.join(', ')}]` : `reported at beat ${p.detected}`);
}
assert(m.pairs.every((p) => p.detected === null || p.detected >= p.truth - 2),
  'no boundary is reported before the true one (the kernel is causal)');

// ── 3. the load-bearing assertion ───────────────────────────────────────────
assert(m.fps.length <= 1,
  'at most 1 false positive on a 3-section fixture',
  `false positives [${m.fps.join(', ')}] of [${detected.join(', ')}]`);
assert(detected.length <= 3, 'no more boundaries than the fixture has', `detected ${detected.length}`);

// ── 4. the old energy-threshold rule, on the same fixture ──────────────────
// The algorithm this file used to be, verbatim in shape: per-frame energy,
// min-max normalised, cut where a frame moves more than 15% of full scale
// from the running section mean, minimum 4 frames per section.
function naiveEnergyBoundaries(levels, energyThreshold = 0.15, minSectionFrames = 4) {
  const maxE = Math.max(...levels);
  const minE = Math.min(...levels);
  const norm = levels.map((v) => (maxE > minE ? (v - minE) / (maxE - minE) : 0.5));
  const starts = [];
  let cur = { startFrame: 0, energy: norm[0] };
  for (let i = 1; i < norm.length; i++) {
    const delta = Math.abs(norm[i] - cur.energy);
    if (delta > energyThreshold && i - cur.startFrame >= minSectionFrames) {
      starts.push(cur.startFrame);
      cur = { startFrame: i, energy: norm[i] };
    } else {
      cur.energy = cur.energy * 0.8 + norm[i] * 0.2;
    }
  }
  starts.push(cur.startFrame);
  return starts.slice(1);
}
const levels = [];
for (let b = 0; b < TOTAL_BEATS; b++) levels.push(levelAt(b));
const naive = naiveEnergyBoundaries(levels);
const naiveM = matchAll(naive, BOUNDS, 2, K + 2);
assert(naiveM.fps.length > 1,
  'the naive energy-threshold rule over-fires on this fixture (the fixture discriminates)',
  `naive boundaries [${naive.join(', ')}], ${naiveM.fps.length} false positives`);

// ── 5. ingest is idempotent per timestamp ──────────────────────────────────
S.reset();
clock = 0;
const probe = featFor(0, 0);
S.detect(probe);
const sectionsAfterOne = S.sections.length;
S.detect(probe);
assert(S.sections.length === sectionsAfterOne,
  'calling detect() twice with the same Audio.feat does not double-count a frame');

S.reset();
const dupEvents = [];
win.addEventListener('swr-section-change', (ev) => dupEvents.push(ev.detail));
drive(TOTAL_BEATS, 2); // engine loop + automix tick, same live feat object
const dupDetected = win.SWR_SECTIONS.map((s) => s.startFrame).slice(1);
assert(dupDetected.join(',') === detected.join(','),
  'the boundaries are identical whether detect() is called once or twice per sample',
  `once [${detected.join(', ')}] vs twice [${dupDetected.join(', ')}]`);
assert(dupEvents.length === firstPassEvents.length,
  'the doubled call emits no extra swr-section-change',
  `${dupEvents.length} vs ${firstPassEvents.length}`);

// ── 6. confidence ──────────────────────────────────────────────────────────
S.reset();
let youngConfidence = null;
let firstResult = null;
const final = drive(TOTAL_BEATS, 1, (res) => {
  if (firstResult === null) firstResult = res;
  if (youngConfidence === null && res.sections >= 2 && res.confidence < 0.7) {
    youngConfidence = res.confidence;
  }
});
assert(firstResult !== null && S.LABELS.indexOf(firstResult.section) >= 0,
  'detect() returns a taxonomy label from the first frame', firstResult && firstResult.section);
assert(typeof final.confidence === 'number' && final.confidence >= 0 && final.confidence <= 1,
  'confidence is bounded 0..1', final.confidence.toFixed(3));
assert(final.frames > 0 && final.energy > 0,
  'the active section reports its length and energy',
  `frames=${final.frames} energy=${final.energy.toFixed(2)}`);
assert(youngConfidence !== null,
  'a section that has only just been cut reports damped confidence',
  youngConfidence == null ? 'never observed' : youngConfidence.toFixed(3));

// ── 7. the event section-scheduler.client.js listens for ───────────────────
assert(firstPassEvents.length >= 2, 'swr-section-change fires once per boundary',
  `${firstPassEvents.length} events`);
for (const d of firstPassEvents) {
  assert(typeof d.from === 'string' && typeof d.to === 'string' &&
    typeof d.frame === 'number' && typeof d.tMs === 'number' &&
    typeof d.novelty === 'number' && typeof d.confidence === 'number',
  'event detail carries { from, to, frame, tMs, novelty, confidence }',
    `${d.from} -> ${d.to} @${d.frame}`);
}
assert(firstPassEvents[firstPassEvents.length - 1].to !== firstPassEvents[0].to,
  'the last boundary reports a different section than the first',
  `${firstPassEvents[0].to} then ${firstPassEvents[firstPassEvents.length - 1].to}`);
assert(firstPassEvents[0].frame >= BOUNDS[0] - 2,
  'the first boundary is reported at or after the true one',
  `@${firstPassEvents[0].frame}`);
assert(win.SWR_SECTIONS.length === detected.length + 1,
  'window.SWR_SECTIONS holds one entry per section', `${win.SWR_SECTIONS.length}`);
assert(win.SWR_SECTIONS[0].startFrame === 0 && win.SWR_SECTIONS[0].name === 'intro',
  'the first section is the intro', win.SWR_SECTIONS[0].name);
const tail = win.SWR_SECTIONS[win.SWR_SECTIONS.length - 1];
assert(S.LABELS.indexOf(tail.name) >= 0,
  'the closing section carries a taxonomy label', tail.name);

// ── 8. the batch entry point keeps its shape ───────────────────────────────
// The batch path gets an AudioAnalysisV2 output: energy + onsets, no band
// features. Its descriptor is therefore the bar's intra-bar energy SHAPE,
// which is scale-invariant the same way the live descriptor is. Same idea,
// same trap: the level moves a lot, the shape changes only at the two
// boundaries.
//
//   bars 0-15   decrescendo inside each bar, level alternating 0.30 / 0.12
//   bars 16-31  the mirror image (crescendo inside the bar), level decaying
//               0.62 -> 0.18 and continuing to fall through bars 32-47, so the
//               second boundary has no level step at all to find
//   bars 32-47  flat inside the bar, sparse onsets
const BARS = 48;
const barShape = (bar) => (bar < 16 ? [1.30, 1.10, 0.90, 0.70]
  : bar < 32 ? [0.70, 0.90, 1.10, 1.30]
    : [1.15, 0.95, 1.05, 0.85]);
const barLevel = (bar) => (bar < 16 ? (bar % 2 === 0 ? 0.30 : 0.12)
  : 0.62 - (bar - 16) * (0.44 / 31));
const barOnsets = (bar) => (bar < 16 ? 1 : (bar < 32 ? 4 : 2));

const energy = [];
for (let bar = 0; bar < BARS; bar++) {
  const shape = barShape(bar);
  for (let q = 0; q < 4; q++) {
    for (let i = 0; i < 100; i++) { // 100 Hz, so 400 samples per bar
      energy.push(barLevel(bar) * shape[q] * (1 + wobble(bar * 400 + q * 100 + i, 11) * 0.5));
    }
  }
}
const onsets = [];
for (let bar = 0; bar < BARS; bar++) {
  for (let k = 0; k < barOnsets(bar); k++) onsets.push(bar * 2 + k * 0.5);
}
const batch = D.detectSections({ bpm: 120, duration: BARS * 2, energy, onsets });
assert(Array.isArray(batch) && batch.length >= 1,
  'detectSections returns an array', `${batch.length} sections`);
assert(batch.every((s) => typeof s.startBar === 'number' && typeof s.name === 'string' &&
  typeof s.energy === 'number' && typeof s.bars === 'number'),
  'each batch section has { startBar, bars, name, energy }',
  batch.map((s) => `${s.name}@${s.startBar}`).join(' '));
assert(batch[0].startBar === 0, 'the first batch section starts at bar 0');
const batchTruth = [16, 32];
const batchStarts = batch.map((s) => s.startBar).slice(1);
for (const t of batchTruth) {
  assert(batchStarts.some((d) => d >= t - 1 && d <= t + 2),
    `the batch path finds the boundary at bar ${t}`,
    `got [${batchStarts.join(', ')}]`);
}
const batchM = matchAll(batchStarts, batchTruth, 1, 2);
assert(batchM.fps.length <= 1,
  'the batch path does not cut the level ramp into pieces',
  `false positives [${batchM.fps.join(', ')}]`);
const naiveBatch = naiveEnergyBoundaries(
  Array.from({ length: BARS }, (_, bar) => barLevel(bar)));
assert(matchAll(naiveBatch, batchTruth, 1, 2).fps.length > 1,
  'the naive energy rule over-fires on the batch fixture too',
  `naive [${naiveBatch.join(', ')}]`);
const scenes = D.sectionsToScenes(batch);
assert(Array.isArray(scenes) && scenes.length === batch.length &&
  scenes.every((s) => typeof s.id === 'string' && Array.isArray(s.layers)),
  'sectionsToScenes still maps to the Scene director shape');

// ── 9. reset ───────────────────────────────────────────────────────────────
S.reset();
assert(win.SWR_SECTIONS.length === 0, 'reset() clears the published map');
clock = 0;
assert(S.detect(featFor(0, 0)).sections === 0,
  'one sample is not yet a frame, so no section exists yet');
assert(drive(2).sections === 1, 'a fresh stream starts exactly one section');
assert(S.history.length === 0, 'reset() clears the transition history');

// The detector restarts its own stream when the material either side is not
// comparable, because a novelty curve computed across a hole is meaningless.
// Two ways that happens in the engine: playback stops (silence) and the clock
// jumps (a seek, a hidden tab). Both must clear the map.
{
  S.reset();
  drive(TOTAL_BEATS);
  assert(win.SWR_SECTIONS.length >= 3, 'the fixture produced a multi-section map',
    `${win.SWR_SECTIONS.length}`);
  for (let i = 0; i < 8 * SUBS; i++) { // 8 silent frames
    clock += BEAT_MS / SUBS;
    S.detect({ bpm: 120, rms: 0, bass: 0, mid: 0, treble: 0, centroid: 0, onset: 0, tMs: clock });
  }
  assert(win.SWR_SECTIONS.length === 0,
    'sustained silence restarts the stream and clears the published map',
    `${win.SWR_SECTIONS.length} sections left`);
  assert(S.history.length === 0, 'the restart clears the transition history');

  // A hole in the clock does the same, with no silence at all.
  S.reset();
  drive(TOTAL_BEATS);
  const before = win.SWR_SECTIONS.length;
  const jumped = { ...featFor(TOTAL_BEATS - 1, SUBS - 1), tMs: clock + 30000 };
  S.detect(jumped);
  assert(win.SWR_SECTIONS.length < before,
    'a hole in the clock restarts the stream too',
    `${before} -> ${win.SWR_SECTIONS.length}`);
  assert(drive(2).sections === 1, 'the next stream starts clean');
}

// ── 10. the real consumer sees real sections ───────────────────────────────
// client/automix.client.js:439 calls window.SWR_SECTION.detect() and falls
// back to a permanent 'verse' when it is missing. Between 2026-10-01 (when
// that global was deleted) and this rewrite, automix therefore never saw a
// section at all. Load the real automix module in the same sandbox and drive
// it with the same fixture: the point of the wiring is that this label moves.
{
  const automixSrc = AUTOMIX_SRC;
  const aCtx = vm.createContext({
    window: win, performance: win.performance, console,
    // automix only touches this inside helpers it does not call here.
    HologramState: undefined,
  });
  vm.runInContext(fs.readFileSync(AUTOMIX_SRC, 'utf8'), aCtx, { filename: 'automix.client.js' });
  const A = win.SWR_AUTOMIX;
  assert(!!(A && typeof A.tickSection === 'function'), 'SWR_AUTOMIX.tickSection loaded');

  S.reset();
  let state = null;
  const seen = new Set();
  const last = drive(TOTAL_BEATS, 1, (res, f) => {
    // tickSection applies its own hysteresis on top: a label has to repeat
    // for SECTION_HYSTERESIS_TICKS ticks before automix accepts it.
    state = A.tickSection(f, state);
    seen.add(res.section);
  });
  assert(!!(state && typeof state.current === 'string'),
    'automix holds a current section after a full pass', state && state.current);
  assert(last.section !== 'verse',
    'the detector reports a non-verse section for the busy part of the track',
    last.section);
  assert(state.current !== 'verse',
    'automix is not stuck on its static verse fallback',
    `automix=${state.current}, detector saw ${[...seen].join(' / ')}`);
}

// ── 11. the arc reads the live boundary as a soft cue (plan P1.3) ──────────
// The arc is built OFFLINE from a decoded buffer; the detector runs LIVE off
// the engine's features. Nothing on the data path connects them, so the
// connector is the `swr-section-change` event. Load the real arc module in
// the same sandbox and prove the three properties that make the cue safe:
// it biases only the next act transition, it is one shot, and a boundary
// with no confidence cannot arm one at all.
{
  const ARC_SRC = path.join(ROOT, 'client/automix-arc.client.js');
  // The arc guards its DOM use at load (`typeof document`), so it loads
  // clean here. Reuse `win`, whose addEventListener now carries this test's
  // own collector from section 2, so a boundary dispatched by the detector
  // below also reaches the arc exactly as it would on a real page.
  vm.runInContext(fs.readFileSync(ARC_SRC, 'utf8'), ctx, { filename: 'automix-arc.client.js' });
  const ARC = win.SWR_AUTOMIX_ARC;
  assert(!!(ARC && ARC.__loaded), 'SWR_AUTOMIX_ARC loaded in the sandbox');

  const I = ARC._internals;
  // 'pure-crossfade' is the catalog spelling of the subtle pick
  // 'cross-dissolve': fireActTransition normalizes the alias before the
  // lookup, so it is what actually lands in the fired list.
  const subtle = new Set([...I.SUBTLE, 'pure-crossfade']);
  const dynamic = new Set(I.DYNAMIC);
  assert(I.SUBTLE.length === 3 && I.DYNAMIC.length === 5,
    'the arc transition vocabulary is unchanged (3 subtle / 5 dynamic)',
    `${I.SUBTLE.length} / ${I.DYNAMIC.length}`);

  // The bias itself, as a pure read over many draws: a chorus boundary must
  // win every time even against a cold act, and a breakdown even against a
  // hot one. This is the assertion that the cue is real and not decorative.
  const allSubtle = [];
  const allDynamic = [];
  for (let i = 0; i < 200; i++) {
    allSubtle.push(I.pickTransition(0.95, 0.95, { cls: 'subtle' }));   // hot act
    allDynamic.push(I.pickTransition(0.05, 0.05, { cls: 'dynamic' })); // cold act
  }
  assert(allSubtle.every((n) => subtle.has(n)),
    'a subtle cue overrides a hot act (soft transition cue honoured)', allSubtle[0]);
  assert(allDynamic.every((n) => dynamic.has(n)),
    'a dynamic cue overrides a cold act (soft transition cue honoured)', allDynamic[0]);

  // A neutral or absent cue must leave the original warmth/intensity rule
  // exactly as it was: the cue is additive, never a replacement.
  const cold = new Set();
  const hot = new Set();
  for (let i = 0; i < 200; i++) {
    cold.add(I.pickTransition(0.1, 0.1, null));
    cold.add(I.pickTransition(0.1, 0.1, { cls: null }));
    hot.add(I.pickTransition(0.9, 0.9, null));
  }
  assert([...cold].every((n) => subtle.has(n)),
    'with no cue a cold act still picks subtle', [...cold].join(' / '));
  assert([...hot].every((n) => dynamic.has(n)),
    'with no cue a hot act still picks dynamic', [...hot].join(' / '));

  // Arming: an event-shaped detail, with and without usable confidence.
  ARC.onSectionChange({ detail: { from: 'intro', to: 'chorus', confidence: 0.8, novelty: 0.12 } });
  assert(ARC.sectionCue && ARC.sectionCue.to === 'chorus',
    'a confident chorus boundary arms the cue', ARC.sectionCue && ARC.sectionCue.to);
  assert(ARC.sectionCue && ARC.sectionCue.cls === 'dynamic',
    'the armed cue carries the class the picker reads', ARC.sectionCue && ARC.sectionCue.cls);

  // Reading does not consume.
  assert(ARC.sectionCue !== null, 'reading sectionCue does not consume it');

  ARC.onSectionChange({ detail: { from: 'chorus', to: 'verse', confidence: 0.9 } });
  assert(ARC.sectionCue && ARC.sectionCue.to === 'chorus',
    'a neutral section (verse) does not overwrite a live cue',
    ARC.sectionCue && ARC.sectionCue.to);

  ARC.onSectionChange({ detail: { from: 'chorus', to: 'breakdown', confidence: 0.1 } });
  assert(ARC.sectionCue && ARC.sectionCue.to === 'chorus',
    'a low-confidence boundary cannot arm or replace a cue',
    ARC.sectionCue && ARC.sectionCue.to);

  ARC.onSectionChange({ detail: { from: 'chorus', to: 'nonsense', confidence: 0.9 } });
  assert(ARC.sectionCue && ARC.sectionCue.to === 'chorus',
    'an unknown section name does not arm a cue',
    ARC.sectionCue && ARC.sectionCue.to);

  // One shot: consumed by an act transition, and only by one. Drive the real
  // tick() over a real three-act arc (sampleAt needs acts and a duration),
  // with a transitions stub that records what was fired. Every act is COLD
  // (warmth/intensity 0.1), so a dynamic pick can only come from the cue.
  ARC.onSectionChange({ detail: { from: 'intro', to: 'chorus', confidence: 0.8 } });
  const fired = [];
  // The catalog must actually CONTAIN the pick, or fireActTransition bails on
  // its "unknown name -> skip, never reject" guard and nothing is recorded.
  // Alias targets (pure-crossfade) are listed too, since the picker may
  // normalise 'cross-dissolve' before the lookup.
  const catalogNames = [...I.SUBTLE, ...I.DYNAMIC, 'pure-crossfade'];
  win.SWRTransitions = {
    _TRANSITIONS: catalogNames.reduce((acc, n) => { acc[n] = {}; return acc; }, {}),
    fire(name) {
      fired.push(name);
      return Promise.resolve();
    },
  };
  const coldAct = { anchorId: 'a', coords: { warmth: 0.1, intensity: 0.1 }, preset: null, rampMs: 0 };
  const arc = {
    duration: 15,
    acts: [
      Object.assign({ t0: 0, t1: 5 }, coldAct),
      Object.assign({ t0: 5, t1: 10 }, coldAct),
      Object.assign({ t0: 10, t1: 15 }, coldAct),
    ],
  };

  ARC.tick(arc, 1); // arms tracking on act 0, no boundary crossed
  ARC.tick(arc, 2); // still act 0
  assert(fired.length === 0, 'an armed cue fires nothing on its own (soft)', fired.length);
  assert(ARC.sectionCue !== null, 'the cue survives ticks that cross no boundary');

  ARC.tick(arc, 6); // crosses act 0 -> act 1: the one transition
  assert(fired.length === 1, 'the act boundary fired exactly one transition', fired.length);
  assert(dynamic.has(fired[0]),
    'the armed chorus cue made a cold act fire dynamic', fired[0]);
  assert(ARC.sectionCue === null,
    'the act transition consumed the cue (one shot)', ARC.sectionCue);

  ARC.tick(arc, 7); // still act 1, cue already spent
  assert(fired.length === 1, 'no second transition inside the same act', fired.length);

  ARC.tick(arc, 11); // crosses act 1 -> act 2 with nothing armed
  assert(fired.length === 2, 'the next act boundary fires from the plan', fired.length);
  assert(subtle.has(fired[1]),
    'with the cue spent, a cold act is subtle again', fired[1]);

  delete win.SWRTransitions;

  // End to end: boundaries published by the REAL detector on the REAL event
  // reach the arc. The fixture's boundaries land on intro -> chorus and
  // chorus -> verse; only the first has an opinion, so the armed cue must be
  // exactly that one, or null if the detector's damped confidence held it back.
  S.reset();
  ARC.onSectionChange({ detail: { from: 'x', to: 'breakdown', confidence: 0 } }); // no-op
  drive(TOTAL_BEATS, 1, () => {});
  const published = win.SWR_SECTIONS.map((s) => s.name);
  const cue = ARC.sectionCue;
  assert(!cue || published.indexOf(cue.to) >= 0,
    'the arc cue, if armed, names a section the detector actually published',
    `cue=${cue ? cue.to : 'null'} published=${published.join(' / ')}`);

  // A song swap must not leave the previous song's opinion armed. The
  // detector empties its map on reset() and says so on `swr-section-reset`,
  // which is a SEPARATE event from `swr-section-change` precisely so no
  // existing consumer has to learn to parse an empty boundary.
  const changeEvents = [];
  const resetEvents = [];
  win.addEventListener('swr-section-change', (ev) => changeEvents.push(ev.detail));
  win.addEventListener('swr-section-reset', (ev) => resetEvents.push(ev.detail));
  ARC.onSectionChange({ detail: { from: 'chorus', to: 'breakdown', confidence: 0.9 } });
  assert(ARC.sectionCue !== null, 'a cue is armed before the swap', ARC.sectionCue.to);

  S.reset();
  assert(resetEvents.length === 1, 'reset() dispatches exactly one swr-section-reset', resetEvents.length);
  assert(resetEvents[0] && resetEvents[0].reason === 'reset',
    'the reset event names its reason', resetEvents[0] && resetEvents[0].reason);
  assert(resetEvents[0] && typeof resetEvents[0].dropped === 'string',
    'the reset event names the section it dropped', resetEvents[0] && resetEvents[0].dropped);
  assert(changeEvents.length === 0,
    'reset() fires NO swr-section-change (an empty map is not a boundary)', changeEvents.length);
  assert(ARC.sectionCue === null,
    'the arc dropped the stale cue across the song swap', ARC.sectionCue);
  assert(ARC.lastResetReason === 'reset',
    'the arc records why it dropped the cue', ARC.lastResetReason);
}

// ── 12. the REAL producer stamps the frame, so two callers ingest it once ─
// The detector dedupes on the frame's timestamp, so the stamp has to come
// from the PRODUCER. lib/audio.client.js stamps feat.tMs (the media clock,
// in milliseconds) on every frame. Before that stamp existed the detector
// fell back to performance.now(), which differs between the engine's rAF
// call and the automix runtime's tick, so every audio frame was ingested
// TWICE.
//
// This section drives the REAL producer (lib/audio.client.js) and the REAL
// detector in one sandbox: a fake media element whose clock advances half a
// second a frame, and a fake analyser that emits a non-silent spectrum, so
// the frames are genuine producer frames and not hand-built fixtures.
const AUDIO_SRC = path.join(ROOT, 'lib/audio.client.js');

function fakeAudioContext() {
  return {
    state: 'running',
    currentTime: 0,
    sampleRate: 44100,
    destination: {},
    createAnalyser() {
      return {
        fftSize: 2048,
        smoothingTimeConstant: 0.65,
        frequencyBinCount: 1024,
        connect(t) { this._out = t; },
        disconnect(t) { if (!t || this._out === t) this._out = null; },
        // A real, non-silent spectrum: the detector drops silent frames.
        getByteFrequencyData(arr) {
          for (let i = 0; i < arr.length; i++) arr[i] = 60 + ((i * 7) % 120);
        },
        getByteTimeDomainData(arr) {
          for (let i = 0; i < arr.length; i++) arr[i] = 128 + (((i % 32) - 16) * 4);
        },
      };
    },
    createGain() {
      return { gain: { value: 1 }, connect(t) { this._out = t; }, disconnect() {} };
    },
    resume() {},
  };
}

// The producer and the detector in ONE sandbox, so they share a window.
function loadProducerAndDetector(producerSource) {
  const listeners = {};
  const win = {
    CustomEvent: function CustomEvent(type, init) {
      this.type = type;
      this.detail = (init && init.detail) || null;
    },
    dispatchEvent(ev) {
      (listeners[ev.type] || []).forEach((fn) => fn(ev));
      return true;
    },
    addEventListener(type, fn) { (listeners[type] = listeners[type] || []).push(fn); },
    removeEventListener(type, fn) {
      const arr = listeners[type] || [];
      const i = arr.indexOf(fn);
      if (i >= 0) arr.splice(i, 1);
    },
    performance: { now: () => 0 },
    AudioContext: function AudioContext() { return fakeAudioContext(); },
  };
  const ctx = vm.createContext({
    window: win,
    performance: win.performance,
    CustomEvent: win.CustomEvent,
    document: { getElementById: () => null },
    console,
  });
  vm.runInContext(fs.readFileSync(SRC, 'utf8'), ctx, { filename: 'section-detector.client.js' });
  vm.runInContext(producerSource, ctx, { filename: 'lib/audio.client.js' });
  return { win, ctx };
}

// One run of the real producer + the real detector. `frames` real audio
// frames are produced, and each one is read by the two production callers
// (the engine's rAF loop and the automix runtime's tick), both passing the
// SAME live feature object - exactly what engine.html does.
function runProducerScenario(producerSource, frames) {
  const { win } = loadProducerAndDetector(producerSource);
  const A = win.Audio;
  const S = win.SWR_SECTION;
  A.unlock();

  // The media element that carries the audio IS the clock: its currentTime
  // advances half a second per frame.
  const media = {
    currentTime: 0,
    duration: 600,
    paused: false,
    addEventListener() {},
    removeEventListener() {},
  };
  A.audioEl = media;

  // A wall clock, the way performance.now() behaves: it moves on. The
  // engine's rAF call and the automix runtime's tick are two DIFFERENT
  // instants (the runtime ticks on its own interval), so without a frame
  // timestamp the detector sees two different frames where there is one.
  let wall = 0;
  win.performance.now = () => wall;

  // How many times did the detector ABSORB a frame? The detector reads the
  // frame's band values exactly once per ingest, inside its per-timestamp
  // dedupe guard, so one read of an accumulated band value IS an ingest.
  // Two independent fields are counted so the probe cannot silently depend
  // on one of them: the detector accumulates bass and rms once each per
  // ingest.
  let bassReads = 0;
  let rmsReads = 0;
  const live = new Proxy(A.feat, {
    get(target, prop) {
      if (prop === 'bass') bassReads++;
      else if (prop === 'rms') rmsReads++;
      return target[prop];
    },
  });

  for (let i = 0; i < frames; i++) {
    // The frame: the media clock advances half a second, the producer
    // re-samples, and the wall clock moves on to the next animation frame.
    media.currentTime = (i + 1) * 0.5;
    wall += 16;
    A.sample();

    wall += 8;                     // the automix tick lands a beat later
    S.detect(live);                // engine rAF loop
    wall += 8;                     // ... and the runtime's own tick, later still
    S.detect(live);                // automix runtime tick
  }
  return {
    ingests: bassReads,
    bassReads,
    rmsReads,
    frames,
    calls: frames * 2,
    rows: S.novelty.length,
    stamped: A.feat.tMs,
    mediaTime: media.currentTime,
  };
}

// The load-bearing expectation: 63 real audio frames, each read by the two
// production callers, are ingested 63 times - not 126.
function ingestCheck(run) {
  const failures = [];
  if (run.ingests !== run.frames) {
    failures.push(`expected ${run.frames} ingests over ${run.frames} real frames, got ${run.ingests}`);
  }
  return failures;
}

// A pause is the other half of the clock decision, and it is the reason the
// stamp is a MEDIA clock and not a wall clock.
//
// The engine's loop (engine.html) calls Audio.sample() only while
// Audio.playing, but it calls SWR_SECTION.detect(Audio.feat) on EVERY frame.
// So while the media is paused the feature object is FROZEN — the producer
// is not re-sampling it — and a wall clock would keep handing the detector a
// brand new timestamp for that frozen frame, so the detector would keep
// ingesting the same frozen audio, over and over, corrupting the
// self-similarity matrix with duplicate rows.
//
// The media clock does not move while the media is paused, so the frame's
// timestamp does not move either, and the detector's dedupe guard holds the
// analysis still: a pause freezes the analysis instead of feeding it.
//
// The scenario mirrors the engine exactly: play (sample + detect), pause
// (detect only, the feature object frozen), resume (sample + detect).
function runPauseScenario(producerSource) {
  const { win } = loadProducerAndDetector(producerSource);
  const A = win.Audio;
  const S = win.SWR_SECTION;
  A.unlock();
  const media = {
    currentTime: 0,
    duration: 600,
    paused: false,
    addEventListener() {},
    removeEventListener() {},
  };
  A.audioEl = media;
  let wall = 0;
  win.performance.now = () => wall;
  let resets = 0;
  win.addEventListener('swr-section-reset', (ev) => {
    if (ev.detail && ev.detail.reason === 'gap') resets++;
  });
  let ingests = 0;
  const live = new Proxy(A.feat, {
    get(target, prop) {
      if (prop === 'bass') ingests++;
      return target[prop];
    },
  });

  // Play: the engine samples and detects, once per frame.
  A.playing = true;
  for (let i = 0; i < 20; i++) {
    media.currentTime += 0.5;
    wall += 16;
    A.sample();
    S.detect(live);
  }
  const playedRows = S.novelty.length;
  const ingestsAfterPlay = ingests;

  // Pause: the engine stops sampling (Audio.playing is false) but keeps
  // calling detect() with the frozen feature object. The wall clock runs on.
  A.playing = false;
  media.paused = true;
  for (let i = 0; i < 100; i++) {
    wall += 16;
    S.detect(live);
  }
  const ingestsDuringPause = ingests - ingestsAfterPlay;
  const resetsAfterPause = resets;

  // Resume.
  A.playing = true;
  media.paused = false;
  for (let i = 0; i < 20; i++) {
    media.currentTime += 0.5;
    wall += 16;
    A.sample();
    S.detect(live);
  }
  return {
    ingests,
    ingestsAfterPlay,
    ingestsDuringPause,
    resetsAfterPause,
    totalResets: resets,
    playedRows,
    rows: S.novelty.length,
  };
}

const FRAMES = 63;
const shippedSource = fs.readFileSync(AUDIO_SRC, 'utf8');
const shippedRun = runProducerScenario(shippedSource, FRAMES);
assert(shippedRun.stamped === shippedRun.mediaTime * 1000,
  'the real producer stamps the frame with the media clock in milliseconds',
  `${shippedRun.stamped} vs ${shippedRun.mediaTime * 1000}`);
assert(shippedRun.ingests === FRAMES,
  'two callers of ONE real audio frame ingest it once',
  `${shippedRun.ingests} ingests over ${shippedRun.calls} detect() calls`);
assert(shippedRun.rmsReads === shippedRun.bassReads,
  'the ingest count does not depend on which accumulated field is counted',
  `bass ${shippedRun.bassReads} vs rms ${shippedRun.rmsReads}`);
const oneFrameRun = runProducerScenario(shippedSource, 1);
assert(oneFrameRun.ingests === 1,
  'one real audio frame read by both callers is ingested exactly once',
  `${oneFrameRun.ingests} ingest(s) over ${oneFrameRun.calls} detect() calls`);
assert(shippedRun.rows > 0,
  'the real producer frames are loud enough to be committed, not dropped as silence',
  `${shippedRun.rows} descriptor rows`);
const shippedIngest = ingestCheck(shippedRun);
assert(shippedIngest.length === 0,
  'the real producer stamps the frame: 126 detect() calls over 63 frames ingest 63 frames',
  shippedIngest[0]);

// The pause: while the media is paused the engine stops sampling but keeps
// calling detect() with the frozen feature object. A media clock holds the
// analysis still; a wall clock would keep ingesting the same frozen frame.
const shippedPause = runPauseScenario(shippedSource);
assert(shippedPause.ingestsDuringPause === 0,
  'a paused media clock freezes the analysis instead of re-ingesting the frozen frame',
  `${shippedPause.ingestsDuringPause} ingest(s) during the pause`);
assert(shippedPause.resetsAfterPause === 0,
  'a paused media clock does not trip the detector\'s gap restart',
  `${shippedPause.resetsAfterPause} gap reset(s) during the pause`);
assert(shippedPause.rows >= shippedPause.playedRows,
  'the section map survives a pause',
  `${shippedPause.playedRows} rows before the pause, ${shippedPause.rows} after`);

// The same proof one level up: the assertion has to be able to fail. Strip
// the producer's frame timestamp - the exact pre-fix state, no tMs field and
// no stamp - and the same scenario must go RED. Then restore and go GREEN.
{
  const strippedSource = shippedSource
    .replace(/^[ \t]*tMs: 0,\n/m, '')
    .replace(/^[ \t]*this\.feat\.tMs = this\.clock \* 1000;\n/gm, '');
  assert(strippedSource !== shippedSource,
    'the self-test mutation really changed the producer source');
  const brokenRun = runProducerScenario(strippedSource, FRAMES);
  const brokenIngest = ingestCheck(brokenRun);
  assert(brokenIngest.length > 0,
    'a producer WITHOUT the frame stamp makes the ingest assertion go RED',
    brokenIngest[0]);
  assert(brokenIngest.some((f) => /ingests?/.test(f)),
    'the RED failure names the ingest assertion',
    brokenIngest[0]);
  assert(brokenRun.ingests === FRAMES * 2,
    'a producer WITHOUT the frame stamp ingests every frame twice',
    `${brokenRun.ingests} ingests over ${brokenRun.calls} detect() calls`);
  const brokenPause = runPauseScenario(strippedSource);
  assert(brokenPause.ingestsDuringPause > 0,
    'a producer WITHOUT the frame stamp keeps ingesting the frozen frame through a pause',
    `${brokenPause.ingestsDuringPause} ingest(s) during the pause`);
  const restoredIngest = ingestCheck(runProducerScenario(shippedSource, FRAMES));
  assert(restoredIngest.length === 0,
    'the shipped producer is GREEN again once the mutation is restored',
    restoredIngest[0]);
  console.log('  the producer mutation WAS DETECTED (' + brokenIngest.length +
    ' failures) and the shipped producer is clean');
}

// ── summary ────────────────────────────────────────────────────────────────
console.log('');
console.log(`PASS: ${pass}`);
console.log(`FAIL: ${failures.length}`);
if (failures.length) {
  console.log('Failures:');
  for (const f of failures) console.log('  -', f);
  process.exit(1);
}
process.exit(0);