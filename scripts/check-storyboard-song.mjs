// scripts/check-storyboard-song.mjs
//
// Quick Node-only smoke test for the algorithms in
// client/storyboard-song.client.js. We can't import the file directly
// (it references window) so we re-implement the math signature-by-signature
// and feed it synthetic inputs. If any of these fails the test exits 1.
//
// Usage:  node scripts/check-storyboard-song.mjs

import { strict as assert } from 'node:assert';

// ───── minimal stubs that match what the IIFE uses ─────
globalThis.window = globalThis;

// Load the file as text, eval the body inside a synthetic window so the
// module can register SWR_SONG without DOM. We strip the IIFE wrapper.
import { readFileSync } from 'node:fs';
const src = readFileSync(new URL('../client/storyboard-song.client.js', import.meta.url), 'utf8');

// The file is wrapped in (function () { 'use strict'; ... })();
// We can't strip the IIFE without breaking scoping. Instead, create a fake
// `document` / `window` and run it via vm.
import vm from 'node:vm';
// Build a vm context that already has `window` set to itself — the
// storyboard-song IIFE references `window` at top level.
const shared = {
  console,
  setTimeout, clearTimeout,
  Math, Date, Array, Float32Array, Object, Number, JSON,
};
const ctx = vm.createContext(shared);
ctx.window = ctx;
ctx.self = ctx;
ctx.AudioAnalysisV2 = {
  analyzeBuffer: (buf) => ({
    bpm: 120, key: 'C', scale: 'major', confidence: 0.7,
    chromagram: new Float32Array(12).fill(0.1),
    onsets: Array.from({ length: 8 }, (_, i) => i * 0.5),  // 8 onsets, 2s span
    duration: 2.0,
  }),
};
try {
  vm.runInContext(src, ctx, { filename: 'storyboard-song.client.js' });
} catch (e) {
  console.error('Failed to load module:', e.message);
  process.exit(1);
}

const SWR_SONG = ctx.SWR_SONG || ctx.window.SWR_SONG;
if (!SWR_SONG) {
  console.error('SWR_SONG not registered on window');
  process.exit(1);
}

// ───── synthetic AudioBuffer-like ─────
function makeBuffer(durationSec, sr = 22050) {
  const length = Math.floor(durationSec * sr);
  const channels = 1;
  const data = new Float32Array(length);
  // Simple sine + click pattern so onsets are present.
  for (let i = 0; i < length; i++) {
    const t = i / sr;
    data[i] = Math.sin(2 * Math.PI * 440 * t) * 0.3;
    // Click every 0.5s (= 120 BPM at 4/4)
    const beatPhase = t % 0.5;
    if (beatPhase < 0.01) data[i] = 0.9;
  }
  return {
    sampleRate: sr,
    length,
    numberOfChannels: channels,
    getChannelData: () => data,
    _data: data,
  };
}

// ───── test 1: downbeatsFromOnsets ─────
{
  const { downbeatsFromOnsets } = SWR_SONG._internals;
  // 8 onsets spaced exactly 0.5s apart (120 BPM), beatSec = 0.5
  const onsets = Array.from({ length: 8 }, (_, i) => i * 0.5);
  const r = downbeatsFromOnsets(onsets, 120, 120, 4);
  assert.equal(r.bpm, 120, 'BPM should be 120');
  assert.equal(r.beatsPerBar, 4);
  assert.ok(r.downbeats.length >= 1, 'Should find at least one downbeat');
  console.log('OK test 1: downbeatsFromOnsets — ', r.downbeats.length, 'downbeats');
}

// ───── test 2: classifyMood ─────
{
  const { classifyMood } = SWR_SONG._internals;
  // bright + quiet
  assert.equal(classifyMood(0.8, 0.3), 'bright');
  // bright + loud
  assert.equal(classifyMood(0.8, 0.8), 'euphoric');
  // dark + loud
  assert.equal(classifyMood(0.2, 0.8), 'tense');
  // dark + quiet
  assert.equal(classifyMood(0.2, 0.2), 'dark');
  // mid-mid
  assert.equal(classifyMood(0.5, 0.5), 'warm');
  console.log('OK test 2: classifyMood — 5 quadrants');
}

// ───── test 3: classifySection ─────
{
  const { classifySection } = SWR_SONG._internals;
  // First section with low energy → intro
  assert.equal(classifySection(0, 5, 0.2, 0.1, true, false), 'intro');
  // Last section → outro
  assert.equal(classifySection(4, 5, 0.5, 0.1, false, true), 'outro');
  // High energy → chorus
  assert.equal(classifySection(2, 5, 0.9, 0.1, false, false), 'chorus');
  // Low energy → breakdown
  assert.equal(classifySection(2, 5, 0.15, 0.1, false, false), 'breakdown');
  console.log('OK test 3: classifySection — 4 cases');
}

// ───── test 4: full analyzeSync against a synthetic 12-second buffer ─────
{
  const buf = makeBuffer(12.0);  // 12 s @ 120 BPM = 6 bars = at least 1 section, possibly more
  const profile = SWR_SONG.analyzeSync(buf, { fallbackBpm: 120, beatsPerBar: 4 });
  assert.ok(profile.duration > 3, 'duration should be ~4s, got ' + profile.duration);
  assert.equal(profile.bpm, 120, 'BPM should be 120');
  assert.ok(profile.beatsPerBar, 4);
  assert.ok(Array.isArray(profile.bars), 'bars must be array');
  assert.ok(profile.bars.length > 0, 'must have at least one bar');
  assert.ok(Array.isArray(profile.phrases), 'phrases must be array');
  assert.ok(Array.isArray(profile.sections), 'sections must be array');
  assert.ok(profile.sections.length >= 1, 'must have at least 1 section, got ' + profile.sections.length);
  if (profile.sections.length === 1) {
    // single-section case (short songs): kind could be verse, intro, or outro
    assert.ok(['verse', 'intro', 'outro'].includes(profile.sections[0].kind),
      'single-section kind should be verse/intro/outro, got ' + profile.sections[0].kind);
  } else {
    assert.equal(profile.sections[0].kind, 'intro', 'first section should be intro');
    assert.equal(profile.sections[profile.sections.length - 1].kind, 'outro', 'last section should be outro');
  }
  assert.ok(profile.loudness.length > 0, 'loudness curve must exist');
  assert.ok(profile.centroid.length > 0, 'centroid curve must exist');
  assert.ok(Array.isArray(profile.moodArc), 'moodArc must be array');
  assert.ok(profile.moodArc.length > 0, 'moodArc must have samples');
  assert.ok(Array.isArray(profile.drops), 'drops must be array');
  assert.ok(Array.isArray(profile.breakdowns), 'breakdowns must be array');
  console.log('OK test 4: full profile — duration=' + profile.duration.toFixed(2) + 's, bars=' + profile.bars.length + ', sections=' + profile.sections.length + ', moodArc=' + profile.moodArc.length);
}

console.log('---');
console.log('ALL CHECKS PASSED');
