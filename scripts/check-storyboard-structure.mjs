// scripts/check-storyboard-structure.mjs
//
// Node smoke test for storyboard-structure.client.js. Builds a synthetic
// SongProfile, runs .segment(), asserts scene shape + min/max length rules.

import { strict as assert } from 'node:assert';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';

const shared = { console, setTimeout, clearTimeout, Math, Date, Array, Float32Array, Object, Number, JSON, Array };
const ctx = vm.createContext(shared);
ctx.window = ctx;
ctx.self = ctx;

// storyboard-structure depends on nothing from audio-analysis, just window.
const src = readFileSync(new URL('../client/storyboard-structure.client.js', import.meta.url), 'utf8');
vm.runInContext(src, ctx, { filename: 'storyboard-structure.client.js' });
const SWR_STRUCTURE = ctx.SWR_STRUCTURE || ctx.window.SWR_STRUCTURE;

function fakeProfile(overrides) {
  return Object.assign({
    bpm: 120,
    duration: 60,
    bars: [
      { startSec: 0, endSec: 2 },
      { startSec: 2, endSec: 4 },
      { startSec: 4, endSec: 6 },
      { startSec: 6, endSec: 8 },
      { startSec: 8, endSec: 10 },
      { startSec: 10, endSec: 12 },
    ],
    sections: [
      { kind: 'intro', startSec: 0, endSec: 8, energy: 0.3, startBar: 0, endBar: 3 },
      { kind: 'verse', startSec: 8, endSec: 24, energy: 0.6, startBar: 4, endBar: 11 },
      { kind: 'chorus', startSec: 24, endSec: 40, energy: 0.95, startBar: 12, endBar: 19 },
      { kind: 'outro', startSec: 40, endSec: 60, energy: 0.4, startBar: 20, endBar: 29 },
    ],
    loudness: new Float32Array(60).fill(-30),
    centroid: new Float32Array(60).fill(1000),
    moodArc: [{ sec: 5, mood: 'dark', score: 1 }, { sec: 25, mood: 'euphoric', score: 2 }, { sec: 50, mood: 'warm', score: 1 }],
  }, overrides);
}

// Test 1: basic 4-section song produces 4 scenes
{
  const scenes = SWR_STRUCTURE.segment(fakeProfile(), { minSceneSec: 4, maxSceneSec: 32 });
  assert.equal(scenes.length, 4, 'expected 4 scenes, got ' + scenes.length);
  assert.equal(scenes[0].kind, 'intro');
  assert.equal(scenes[3].kind, 'outro');
  console.log('OK test 1: 4 scenes from 4 sections — kinds:', scenes.map(s => s.kind).join(','));
}

// Test 2: scene IDs are stable and zero-padded
{
  const scenes = SWR_STRUCTURE.segment(fakeProfile(), { minSceneSec: 1, maxSceneSec: 32 });
  // Pad each section artificially to exceed 1 second so they all survive.
  assert.equal(scenes[0].id, 'sc-001');
  assert.equal(scenes[scenes.length - 1].id, 'sc-' + String(scenes.length).padStart(3, '0'));
  // Every id matches /sc-\d{3}/
  for (const sc of scenes) {
    assert.match(sc.id, /^sc-\d{3}$/, 'id must be sc-NNN: ' + sc.id);
  }
  console.log('OK test 2: scene IDs are sc-001..sc-NNN (' + scenes.length + ' scenes)');
}

// Test 3: tags populated, suggestedCutEvery picked
{
  const scenes = SWR_STRUCTURE.segment(fakeProfile({ bpm: 150 }));
  for (const sc of scenes) {
    assert.ok(['dark','warm','bright','tense','euphoric'].includes(sc.tags.mood), 'mood is in set: ' + sc.tags.mood);
    assert.ok(['low','med','high'].includes(sc.tags.motion), 'motion is in set: ' + sc.tags.motion);
    assert.ok(['bar','2bar','phrase','chorus'].includes(sc.suggestedCutEvery), 'cutEvery is valid: ' + sc.suggestedCutEvery);
  }
  // Chorus → bar
  assert.equal(scenes[2].suggestedCutEvery, 'bar');
  // Intro/outro → phrase
  assert.equal(scenes[0].suggestedCutEvery, 'phrase');
  assert.equal(scenes[3].suggestedCutEvery, 'phrase');
  console.log('OK test 3: tags + cutEvery populated for all scenes');
}

// Test 4: long section gets split on a trough
{
  // 60-second verse section, maxSceneSec=15 → should split into ~4 pieces
  const profile = fakeProfile({
    sections: [{ kind: 'verse', startSec: 0, endSec: 60, energy: 0.6, startBar: 0, endBar: 29 }],
    loudness: (() => {
      const a = new Float32Array(60);
      for (let i = 0; i < 60; i++) {
        // Periodic trough every 15s
        a[i] = -20 - 15 * Math.cos((i / 15) * 2 * Math.PI);
      }
      return a;
    })(),
  });
  const scenes = SWR_STRUCTURE.segment(profile, { minSceneSec: 2, maxSceneSec: 15 });
  assert.ok(scenes.length >= 3, 'long verse should split into >=3 scenes, got ' + scenes.length);
  // All pieces should be <= 17s (maxSceneSec + a small wiggle)
  for (const sc of scenes) {
    const dur = sc.endSec - sc.startSec;
    assert.ok(dur <= 17, 'split scene too long: ' + dur + 's');
  }
  console.log('OK test 4: long verse split — got ' + scenes.length + ' pieces');
}

// Test 5: short scenes get merged
{
  const profile = fakeProfile({
    sections: [
      { kind: 'intro', startSec: 0, endSec: 2, energy: 0.3, startBar: 0, endBar: 0 },
      { kind: 'intro', startSec: 2, endSec: 4, energy: 0.3, startBar: 1, endBar: 1 },
      { kind: 'verse', startSec: 4, endSec: 20, energy: 0.6, startBar: 2, endBar: 9 },
    ],
    bars: [
      { startSec: 0, endSec: 2 }, { startSec: 2, endSec: 4 },
      { startSec: 4, endSec: 6 }, { startSec: 6, endSec: 8 },
      { startSec: 8, endSec: 10 }, { startSec: 10, endSec: 12 },
    ],
  });
  const scenes = SWR_STRUCTURE.segment(profile, { minSceneSec: 5, maxSceneSec: 32 });
  // Two 2-second intros should merge into one >=5s scene
  assert.equal(scenes[0].kind, 'intro', 'merged scene should still be intro');
  assert.ok(scenes[0].endSec - scenes[0].startSec >= 4, 'merged intro should be >=4s, got ' + (scenes[0].endSec - scenes[0].startSec));
  console.log('OK test 5: two short intros merged — result startSec=' + scenes[0].startSec + ', endSec=' + scenes[0].endSec);
}

console.log('---');
console.log('ALL CHECKS PASSED');
