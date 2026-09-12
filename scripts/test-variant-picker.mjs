#!/usr/bin/env node
// scripts/test-variant-picker.mjs — unit tests over fixture audio analyses.
// Run: `node scripts/test-variant-picker.mjs`. Exit 0 on green.

import assert from 'node:assert/strict';
import { pick, bucketize, listKnownVariants } from '../lib/variant-picker.mjs';

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  \u2713 ${name}`); passed++; }
  catch (e) { console.error(`  \u2717 ${name}\n    ${e.message}`); failed++; }
}

// Helper: synthesize a 12-class Float32Array.
function chroma(weights) {
  const a = new Array(12).fill(0);
  const KEY_TO_IDX = { C:0, 'C#':1, D:2, 'D#':3, E:4, F:5, 'F#':6, G:7, 'G#':8, A:9, 'A#':10, B:11 };
  for (const [k, w] of Object.entries(weights)) a[KEY_TO_IDX[k]] = w;
  return a;
}

// === Bucketize ============================================================
test('bucketize: slow bpm -> lo', () => {
  const f = bucketize({ bpm: 70, scale: 'minor', duration: 200, onsets: new Array(20).fill(0).map((_, i) => i), chromagram: chroma({ C: 1 }) });
  assert.equal(f.bpmBucket, 'lo');
  assert.equal(f.scale, 'minor');
});

test('bucketize: dance bpm -> mid', () => {
  const f = bucketize({ bpm: 120, scale: 'major', duration: 180, onsets: new Array(150).fill(0).map((_, i) => i), chromagram: chroma({ G: 1 }) });
  assert.equal(f.bpmBucket, 'mid');
});

test('bucketize: fast bpm -> hi', () => {
  const f = bucketize({ bpm: 160, scale: 'major', duration: 200, onsets: new Array(400).fill(0).map((_, i) => i), chromagram: chroma({ A: 1 }) });
  assert.equal(f.bpmBucket, 'hi');
});

test('bucketize: onset rate drives energy bucket', () => {
  // 10 onsets / 100s = 0.1/s -> lo
  const lo = bucketize({ bpm: 100, duration: 100, onsets: new Array(10).fill(0).map((_, i) => i) });
  assert.equal(lo.energyBucket, 'lo');
  // 100 onsets / 100s = 1.0/s -> mid
  const mid = bucketize({ bpm: 100, duration: 100, onsets: new Array(100).fill(0).map((_, i) => i) });
  assert.equal(mid.energyBucket, 'mid');
  // 300 onsets / 100s = 3.0/s -> hi
  const hi = bucketize({ bpm: 100, duration: 100, onsets: new Array(300).fill(0).map((_, i) => i) });
  assert.equal(hi.energyBucket, 'hi');
});

test('bucketize: missing fields degrade gracefully', () => {
  const f = bucketize({});
  assert.equal(f.bpmBucket, 'unknown');
  // No signal -> null so picker doesn't fire scale_major/etc weights.
  assert.equal(f.scale, null);
  assert.equal(f.energyBucket, null);
});

// === Pick: specific scenarios ============================================
test('pick: slow + minor ballad -> film or smoke', () => {
  const a = { bpm: 72, scale: 'minor', duration: 200, confidence: 0.4,
               onsets: new Array(40).fill(0).map((_, i) => i), // 0.2/s = lo
               chromagram: chroma({ A: 1 }) };
  const r = pick(a);
  // Should prefer film (slow + minor) or smoke (slow + lo energy)
  assert.ok(['film', 'smoke'].includes(r.variant), `expected film/smoke, got ${r.variant}`);
});

test('pick: fast + A/E/D sharp chroma -> neon', () => {
  const a = { bpm: 160, scale: 'major', duration: 200, confidence: 0.7,
               onsets: new Array(300).fill(0).map((_, i) => i),
               chromagram: chroma({ A: 1, E: 0.8, D: 0.7 }) };
  const r = pick(a);
  assert.equal(r.variant, 'neon', JSON.stringify(r.allScores));
});

test('pick: 4-on-the-floor beat at 120bpm -> grid', () => {
  const a = { bpm: 128, scale: 'minor', duration: 240, confidence: 0.95,
               onsets: new Array(240).fill(0).map((_, i) => i), // 1/s = mid energy
               chromagram: chroma({ C: 1 }) };
  const r = pick(a);
  assert.equal(r.variant, 'grid', JSON.stringify(r.allScores));
});

test('pick: dreamy major in 80bpm -> aurora or watercolor', () => {
  const a = { bpm: 82, scale: 'major', duration: 220, confidence: 0.4,
               onsets: new Array(60).fill(0).map((_, i) => i), // 0.27/s = lo
               chromagram: chroma({ G: 1 }) };
  const r = pick(a);
  assert.ok(['aurora', 'watercolor'].includes(r.variant), `expected aurora/watercolor, got ${r.variant}`);
});

test('pick: heavy bass + many onsets -> pulse', () => {
  const a = { bpm: 85, scale: 'minor', duration: 200, confidence: 0.8,
               onsets: new Array(800).fill(0).map((_, i) => i), // 4/s = hi
               chromagram: chroma({ A: 1, E: 0.8 }) };
  const r = pick(a);
  assert.equal(r.variant, 'pulse', JSON.stringify(r.allScores));
});

test('pick: random unknown falls back to music_video', () => {
  const r = pick({}); // no features at all
  assert.equal(r.variant, 'music_video');
});

test('pick: ambiguous track returns a variant with rationale', () => {
  const r = pick({ bpm: 100, scale: 'major', duration: 100, confidence: 0.5,
                    onsets: new Array(50).fill(0).map((_, i) => i),
                    chromagram: chroma({ C: 1 }) });
  assert.ok(r.variant);
  assert.ok(r.rationale.length > 0);
  assert.ok(r.allScores[r.variant]);
});

// === Profile consistency ==================================================
test('listKnownVariants: every PROFILE entry exists as a versions/*.html file', () => {
  const known = listKnownVariants();
  const names = new Set(known.map(v => v.name));
  // No phantom profiles (a profile without an HTML file would crash render)
  for (const name of Object.keys({
    music_video:1, spectrum:1, film:1, neon:1, grid:1, smoke:1, aurora:1,
    void:1, glitch:1, chrome:1, fractal:1, collage:1, pulse:1,
    watercolor:1, eclipse:1,
  })) {
    assert.ok(names.has(name), `profile "${name}" has no versions/<name>.html`);
  }
});

test('listKnownVariants: returns non-empty title + description per variant', () => {
  const known = listKnownVariants();
  assert.ok(known.length >= 10, `expected 10+ known variants, got ${known.length}`);
  for (const v of known) {
    assert.ok(v.title.length > 0, `variant ${v.name} has no title`);
    assert.ok(v.description.length > 0, `variant ${v.name} has no description`);
  }
});

// === Summary ==============================================================
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);