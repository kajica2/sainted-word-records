#!/usr/bin/env node
// scripts/check-section-detector-unit.mjs — section-detector unit gate.
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
//
// Run:  node scripts/check-section-detector-unit.mjs
// Exit: 0 PASS, 1 FAIL.

import vm from 'node:vm';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const SRC = path.join(__dirname, 'client/section-detector.client.js');

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
  for (let beat = 0; beat < beats; beat++) {
    for (let sub = 0; sub < SUBS; sub++) {
      clock = (beat * SUBS + sub) * (BEAT_MS / SUBS);
      const f = featFor(beat, sub);
      for (let k = 0; k < repeat; k++) S.detect(f);
      if (onSample) onSample(f);
    }
  }
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
assert(dupEvents.length === events.length,
  'the doubled call emits no extra swr-section-change',
  `${dupEvents.length} vs ${events.length}`);

// ── 6. confidence ──────────────────────────────────────────────────────────
S.reset();
let youngConfidence = null;
let calm = null;
drive(TOTAL_BEATS, 1, () => {
  const r = S.detect(featFor(0, 0)); // re-read state without advancing the clock
  if (calm === null && S.sections.length >= 1) calm = r;
  if (youngConfidence === null && S.sections.length >= 2 && r.confidence < 0.7) {
    youngConfidence = r.confidence;
  }
});
const final = S.detect(featFor(TOTAL_BEATS - 1, SUBS - 1));
assert(typeof final.section === 'string' && S.LABELS.indexOf(final.section) >= 0,
  'detect() returns a taxonomy label', final.section);
assert(typeof final.confidence === 'number' && final.confidence >= 0 && final.confidence <= 1,
  'confidence is bounded 0..1', final.confidence.toFixed(3));
assert(final.frames > 0 && final.energy > 0,
  'the active section reports its length and energy',
  `frames=${final.frames} energy=${final.energy.toFixed(2)}`);
assert(youngConfidence !== null,
  'a section that has only just been cut reports damped confidence',
  youngConfidence == null ? 'never observed' : youngConfidence.toFixed(3));

// ── 7. the event section-scheduler.client.js listens for ───────────────────
assert(events.length >= 2, 'swr-section-change fires once per boundary', `${events.length} events`);
for (const d of events) {
  assert(typeof d.from === 'string' && typeof d.to === 'string' &&
    typeof d.frame === 'number' && typeof d.tMs === 'number' &&
    typeof d.novelty === 'number' && typeof d.confidence === 'number',
  'event detail carries { from, to, frame, tMs, novelty, confidence }',
    `${d.from} -> ${d.to} @${d.frame}`);
}
assert(events[events.length - 1].to !== events[0].to,
  'the last boundary reports a different section than the first',
  `${events[0].to} then ${events[events.length - 1].to}`);
assert(win.SWR_SECTIONS.length === detected.length + 1,
  'window.SWR_SECTIONS holds one entry per section', `${win.SWR_SECTIONS.length}`);
assert(win.SWR_SECTIONS[0].startFrame === 0 && win.SWR_SECTIONS[0].name === 'intro',
  'the first section is the intro', win.SWR_SECTIONS[0].name);
const tail = win.SWR_SECTIONS[win.SWR_SECTIONS.length - 1];
assert(S.LABELS.indexOf(tail.name) >= 0,
  'the closing section carries a taxonomy label', tail.name);

// ── 8. the batch entry point keeps its shape ───────────────────────────────
const energy = [];
for (let i = 0; i < 720; i++) {
  energy.push(levelAt(Math.floor(i / 5))); // 100 Hz series over a 72 s track
}
const onsets = [];
for (let beat = 0; beat < TOTAL_BEATS; beat++) onsets.push(beat * 0.5);
const batch = D.detectSections({ bpm: 120, duration: 72, energy, onsets });
assert(Array.isArray(batch) && batch.length >= 1,
  'detectSections returns an array', `${batch.length} sections`);
assert(batch.every((s) => typeof s.startBar === 'number' && typeof s.name === 'string' &&
  typeof s.energy === 'number' && typeof s.bars === 'number'),
  'each batch section has { startBar, bars, name, energy }',
  batch.map((s) => `${s.name}@${s.startBar}`).join(' '));
assert(batch[0].startBar === 0, 'the first batch section starts at bar 0');
const batchTruth = BOUNDS.map((b) => Math.floor(b / 4)); // beats -> bars
const batchStarts = batch.map((s) => s.startBar).slice(1);
const batchHits = batchTruth.filter((t) =>
  batchStarts.some((d) => d >= t - 1 && d <= t + 4));
assert(batchHits.length === batchTruth.length,
  'the batch path finds the same two boundaries, bar-aligned',
  `expected near [${batchTruth}], got [${batchStarts}]`);
const scenes = D.sectionsToScenes(batch);
assert(Array.isArray(scenes) && scenes.length === batch.length &&
  scenes.every((s) => typeof s.id === 'string' && Array.isArray(s.layers)),
  'sectionsToScenes still maps to the Scene director shape');

// ── 9. reset ───────────────────────────────────────────────────────────────
S.reset();
assert(win.SWR_SECTIONS.length === 0, 'reset() clears the published map');
clock = 0;
assert(S.detect(featFor(0, 0)).sections === 1, 'a fresh stream starts one section');
assert(S.history.length === 0, 'reset() clears the transition history');

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