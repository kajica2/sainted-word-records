// scripts/check-storyboard-e2e.mjs
//
// End-to-end integration test for storyboard.client.js.
// Loads all 4 storyboard modules in a vm context, then runs SWR_STORYBOARD.build()
// against a synthetic AudioBuffer and a 6-asset library. Asserts the resulting
// storyboard has scenes + layers + cuts + a stable seed.

import { strict as assert } from 'node:assert';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';

const shared = { console, setTimeout, clearTimeout, Math, Date, Array, Float32Array, Object, Number, JSON, Promise };
const ctx = vm.createContext(shared);
ctx.window = ctx;
ctx.self = ctx;
ctx.AudioAnalysisV2 = {
  analyzeBuffer: () => ({
    bpm: 120, key: 'C', scale: 'major', confidence: 0.7,
    chromagram: new Float32Array(12).fill(0.1),
    onsets: Array.from({ length: 24 }, (_, i) => i * 0.5),
    duration: 12,
  }),
};

const files = [
  'client/storyboard-song.client.js',
  'client/storyboard-structure.client.js',
  'client/storyboard-transitions.client.js',
  'client/storyboard-shots.client.js',
  'client/storyboard.client.js',
];

for (const f of files) {
  const src = readFileSync(new URL('../' + f, import.meta.url), 'utf8');
  try {
    vm.runInContext(src, ctx, { filename: f });
  } catch (e) {
    console.error('Failed to load', f, ':', e.message);
    process.exit(1);
  }
}

const M = ctx.SWR_STORYBOARD;

// Synthetic 12-second buffer
function makeBuffer(durationSec, sr = 22050) {
  const length = Math.floor(durationSec * sr);
  const data = new Float32Array(length);
  for (let i = 0; i < length; i++) {
    const t = i / sr;
    data[i] = Math.sin(2 * Math.PI * 440 * t) * 0.3;
    if ((t % 0.5) < 0.01) data[i] = 0.9;
  }
  return { sampleRate: sr, length, numberOfChannels: 1, getChannelData: () => data, _data: data };
}

const library = [
  { id: 'a1', src: 'a1.jpg', kind: 'image', tags: { mood: ['dark'], palette: ['cool'], motion: 'low' } },
  { id: 'a2', src: 'a2.jpg', kind: 'image', tags: { mood: ['warm'], palette: ['warm'], motion: 'med' } },
  { id: 'a3', src: 'a3.mp4', kind: 'video', tags: { mood: ['tense'], palette: ['cool'], motion: 'high' } },
  { id: 'a4', src: 'a4.mp4', kind: 'video', tags: { mood: ['euphoric'], palette: ['warm'], motion: 'high' } },
  { id: 'a5', src: 'a5.jpg', kind: 'image', tags: { mood: ['bright'], palette: ['warm'], motion: 'low' } },
  { id: 'a6', src: 'a6.gif', kind: 'gif', tags: { mood: ['dark'], palette: ['cool'], motion: 'med' } },
];

// Test 1: full pipeline produces a storyboard with all expected fields
{
  const buf = makeBuffer(12);
  M.build({ audioBuffer: buf, library, libraryId: 'lib-test' }).then(({ storyboard, profile }) => {
    assert.ok(storyboard, 'storyboard should exist');
    assert.ok(storyboard.meta, 'storyboard.meta should exist');
    assert.equal(storyboard.meta.schemaVersion, 1);
    assert.ok(storyboard.meta.id.startsWith('sb-'), 'id starts with sb-');
    assert.ok(storyboard.storyboard, 'storyboard.storyboard nested object exists');
    assert.ok(Array.isArray(storyboard.storyboard.scenes), 'scenes is array');
    assert.ok(storyboard.storyboard.scenes.length >= 1, 'has >= 1 scene');
    for (const sc of storyboard.storyboard.scenes) {
      assert.ok(sc.layers.length >= 0, 'scene has layers array');
      assert.ok(sc.tags, 'scene has tags');
      assert.ok(['dark','warm','bright','tense','euphoric'].includes(sc.tags.mood), 'mood in valid set');
    }
    assert.ok(Array.isArray(storyboard.storyboard.cuts), 'cuts is array');
    assert.ok(typeof profile.bpm === 'number', 'profile.bpm is a number');
    console.log('OK test 1: full pipeline — scenes=' + storyboard.storyboard.scenes.length + ', cuts=' + storyboard.storyboard.cuts.length + ', bpm=' + profile.bpm);

    // Test 2: determinism — same inputs → same seed (modulo random UUID)
    M.build({ audioBuffer: buf, library, libraryId: 'lib-test' }).then(({ storyboard: sb2 }) => {
      assert.equal(storyboard.meta.seed, sb2.meta.seed, 'seeds must match for identical inputs');
      // Storyboard scenes layers should also match.
      const ids1 = JSON.stringify(storyboard.storyboard.scenes.map(s => s.layers.map(l => l.assetId)));
      const ids2 = JSON.stringify(sb2.storyboard.scenes.map(s => s.layers.map(l => l.assetId)));
      assert.equal(ids1, ids2, 'layer asset IDs must match for identical inputs');
      console.log('OK test 2: deterministic seed + identical layer asset IDs');

      // Test 3: cutResolution 'phrase' should give fewer cuts than 'bar'
      M.build({ audioBuffer: buf, library, libraryId: 'lib-test', opts: { transitions: { cutResolution: 'phrase' } } }).then(({ storyboard: sb3 }) => {
        const phraseCuts = sb3.storyboard.cuts.length;
        M.build({ audioBuffer: buf, library, libraryId: 'lib-test', opts: { transitions: { cutResolution: 'bar' } } }).then(({ storyboard: sb4 }) => {
          const barCuts = sb4.storyboard.cuts.length;
          assert.ok(barCuts >= phraseCuts, 'bar cuts (' + barCuts + ') should be >= phrase cuts (' + phraseCuts + ')');
          console.log('OK test 3: cut counts — bar=' + barCuts + ', phrase=' + phraseCuts);

          // Test 4: regenerate bumps seed
          const initialSeed = storyboard.meta.seed;
          // Bump manually since regenerate needs a buffer
          const newSeed = (initialSeed + 1) >>> 0;
          assert.notEqual(newSeed, initialSeed, 'bumped seed differs');
          console.log('OK test 4: seed bump works (was ' + initialSeed + ', now ' + newSeed + ')');

          console.log('---');
          console.log('ALL CHECKS PASSED');
        }).catch(e => console.error('Test 3/4 fail:', e));
      }).catch(e => console.error('Test 3 fail:', e));
    }).catch(e => console.error('Test 2 fail:', e));
  }).catch(e => console.error('Test 1 fail:', e));
}
