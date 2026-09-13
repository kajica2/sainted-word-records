// scripts/check-storyboard-shots.mjs
//
// Smoke test for storyboard-shots.client.js.

import { strict as assert } from 'node:assert';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';

const shared = { console, Math, Date, Array, Float32Array, Object, Number, JSON };
const ctx = vm.createContext(shared);
ctx.window = ctx; ctx.self = ctx;
const src = readFileSync(new URL('../client/storyboard-shots.client.js', import.meta.url), 'utf8');
vm.runInContext(src, ctx, { filename: 'storyboard-shots.client.js' });
const M = ctx.SWR_SHOTS || ctx.window.SWR_SHOTS;

const fakeLibrary = [
  { id: 'a1', src: 'a1.jpg', kind: 'image', tags: { mood: ['dark'], palette: ['cool'], motion: 'low', subject: 'portrait' } },
  { id: 'a2', src: 'a2.jpg', kind: 'image', tags: { mood: ['warm'], palette: ['warm'], motion: 'med', subject: 'landscape' } },
  { id: 'a3', src: 'a3.mp4', kind: 'video', tags: { mood: ['tense'], palette: ['cool'], motion: 'high', subject: 'abstract' } },
  { id: 'a4', src: 'a4.mp4', kind: 'video', tags: { mood: ['euphoric'], palette: ['warm'], motion: 'high', subject: 'landscape' } },
  { id: 'a5', src: 'a5.jpg', kind: 'image', tags: { mood: ['bright'], palette: ['warm'], motion: 'low', subject: 'portrait' } },
  { id: 'a6', src: 'a6.gif', kind: 'gif', tags: { mood: ['dark'], palette: ['cool'], motion: 'med' } },
];

function fakeScene(kind, startBar, endBar, opts) {
  return Object.assign({
    id: 'sc-' + kind + '-' + startBar,
    kind, startBar, endBar, startSec: startBar * 2, endSec: (endBar + 1) * 2, energy: 0.5,
    tags: { mood: 'dark', motion: 'med', palette: 'cool' },
    suggestedCutEvery: '2bar',
  }, opts || {});
}

// Test 1: pick produces a layered storyboard
{
  const scenes = [
    fakeScene('intro', 0, 3),
    fakeScene('verse', 4, 11),
    fakeScene('chorus', 12, 19, { tags: { mood: 'euphoric', motion: 'high', palette: 'warm' }, energy: 0.9 }),
    fakeScene('outro', 20, 23),
  ];
  const out = M.pick(scenes, fakeLibrary, { bpm: 120 }, [], { seed: 42 });
  assert.equal(out.length, 4);
  // Each scene must have at least one layer.
  for (const sc of out) {
    assert.ok(sc.layers.length > 0, 'scene ' + sc.id + ' has no layers');
    for (const l of sc.layers) {
      assert.ok(l.assetId, 'layer missing assetId');
      assert.ok(l.role, 'layer missing role');
      assert.ok(l.fxPresetId, 'layer missing fxPresetId');
    }
  }
  console.log('OK test 1: pick produces 4 scenes with layers — intro layers:', out[0].layers.length, 'chorus layers:', out[2].layers.length);
}

// Test 2: chorus prefers video assets
{
  const scenes = [fakeScene('chorus', 0, 7, { tags: { mood: 'euphoric', motion: 'high' }, energy: 0.95 })];
  const out = M.pick(scenes, fakeLibrary, null, [], { seed: 1 });
  // background slot requires video kind
  const bg = out[0].layers.find(l => l.role === 'background');
  assert.ok(bg, 'chorus must have a background layer');
  assert.equal(bg.kind, 'video', 'chorus background should be video');
  console.log('OK test 2: chorus background = video');
}

// Test 3: no-repeat rule across scenes
{
  const scenes = [
    fakeScene('verse', 0, 3),  // 4 bars
    fakeScene('verse', 4, 7),  // 4 bars (no repeat within 8 bars)
  ];
  const out = M.pick(scenes, fakeLibrary, null, [], { seed: 1, noRepeatBars: 8 });
  // The background slot of scene 2 should NOT be the same asset as scene 1's background.
  const bg1 = out[0].layers.find(l => l.role === 'background');
  const bg2 = out[1].layers.find(l => l.role === 'background');
  assert.notEqual(bg1.assetId, bg2.assetId, 'no-repeat should pick different background');
  console.log('OK test 3: no-repeat across adjacent scenes (bg1=' + bg1.assetId + ', bg2=' + bg2.assetId + ')');
}

// Test 4: same seed → same storyboard (determinism)
{
  const scenes = [
    fakeScene('intro', 0, 3),
    fakeScene('verse', 4, 11),
    fakeScene('chorus', 12, 19),
  ];
  const a = M.pick(scenes, fakeLibrary, null, [], { seed: 123 });
  const b = M.pick(scenes, fakeLibrary, null, [], { seed: 123 });
  for (let i = 0; i < a.length; i++) {
    for (let j = 0; j < a[i].layers.length; j++) {
      assert.equal(a[i].layers[j].assetId, b[i].layers[j].assetId, 'mismatch at scene ' + i + ' layer ' + j);
    }
  }
  console.log('OK test 4: same seed = same storyboard');
}

// Test 5: different seed → likely different storyboard (statistical, not deterministic)
{
  const scenes = [
    fakeScene('verse', 0, 7),
    fakeScene('chorus', 8, 15, { tags: { mood: 'euphoric', motion: 'high', palette: 'warm' }, energy: 0.9 }),
    fakeScene('verse', 16, 23),
    fakeScene('chorus', 24, 31, { tags: { mood: 'euphoric', motion: 'high', palette: 'warm' }, energy: 0.9 }),
  ];
  // Run 3 different seeds and collect all asset IDs.
  let allSame = true;
  const first = JSON.stringify(M.pick(scenes, fakeLibrary, null, [], { seed: 1 }).map(s => s.layers.map(l => l.assetId)));
  for (const seed of [2, 3, 4, 5]) {
    const cur = JSON.stringify(M.pick(scenes, fakeLibrary, null, [], { seed }).map(s => s.layers.map(l => l.assetId)));
    if (cur !== first) { allSame = false; break; }
  }
  assert.equal(allSame, false, 'over 4 seeds, at least one should differ from seed=1');
  console.log('OK test 5: across 4 different seeds, at least one produces a different storyboard');
}

// Test 6: score increases with mood match
{
  const sc = fakeScene('verse', 0, 3, { tags: { mood: 'dark' } });
  const darkAsset = fakeLibrary[0]; // mood=dark
  const warmAsset = fakeLibrary[1]; // mood=warm
  const sDark = M.score(darkAsset, sc, {});
  const sWarm = M.score(warmAsset, sc, {});
  assert.ok(sDark > sWarm, 'matching mood should score higher: dark=' + sDark + ', warm=' + sWarm);
  console.log('OK test 6: mood match increases score (dark=' + sDark.toFixed(2) + ', warm=' + sWarm.toFixed(2) + ')');
}

// Test 7: layerStackFor
{
  const chorusStack = M.layerStackFor('chorus');
  assert.ok(chorusStack.length >= 2, 'chorus should have ≥2 layers');
  assert.ok(chorusStack.some(s => s.role === 'background'));
  console.log('OK test 7: chorus has ' + chorusStack.length + ' layer slots');
}

// Test 8: fxPresetFor picks distinct presets per kind
{
  const kinds = ['intro', 'verse', 'chorus', 'bridge', 'breakdown', 'drop', 'outro'];
  const presets = kinds.map(k => ({ k, p: M.fxPresetFor(k) }));
  const unique = new Set(presets.map(p => p.p));
  assert.ok(unique.size >= kinds.length - 2, 'presets should mostly be distinct: ' + unique.size + '/' + kinds.length);
  console.log('OK test 8: fxPresetFor returns', unique.size, 'distinct presets for', kinds.length, 'kinds');
}

// Test 9: pattern reuse — applying a pattern template overrides layers
{
  const scenes = [
    fakeScene('chorus', 0, 7, { tags: { mood: 'euphoric', motion: 'high', palette: 'warm' }, energy: 0.95 }),
  ];
  // Build a fake pattern matching the scene's shape.
  const shape = M.shapeOf(scenes[0]);
  const out1 = M.pick(scenes, fakeLibrary, null, [], { seed: 1 });
  const beforeAssetIds = out1[0].layers.map(l => l.assetId);
  // Apply a pattern with a different role layout.
  const out2 = M.pick(scenes, fakeLibrary, null, [], {
    seed: 1,
    patternTemplates: [{
      fingerprint: shape,
      template: [
        { role: 'background', fxPresetId: 'glitch', blend: 'overlay' },
      ],
    }],
  });
  assert.equal(out2[0].layers.length, 1, 'pattern should reset to 1 layer');
  assert.equal(out2[0].layers[0].role, 'background');
  assert.equal(out2[0].layers[0].fxPresetId, 'glitch');
  console.log('OK test 9: pattern template overrides layers (was ' + beforeAssetIds.length + ' layers, now 1)');
}

// Test 10: empty library returns scenes with no layers (no crash)
{
  const scenes = [fakeScene('verse', 0, 3)];
  const out = M.pick(scenes, [], null, [], { seed: 1 });
  assert.equal(out.length, 1);
  assert.equal(out[0].layers.length, 0);
  console.log('OK test 10: empty library → 0 layers, no crash');
}

console.log('---');
console.log('ALL CHECKS PASSED');
