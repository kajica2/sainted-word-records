// scripts/check-storyboard-transitions.mjs
//
// Smoke test for storyboard-transitions.client.js.

import { strict as assert } from 'node:assert';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';

const shared = { console, Math, Date, Array, Float32Array, Object, Number, JSON };
const ctx = vm.createContext(shared);
ctx.window = ctx; ctx.self = ctx;

const src = readFileSync(new URL('../client/storyboard-transitions.client.js', import.meta.url), 'utf8');
vm.runInContext(src, ctx, { filename: 'storyboard-transitions.client.js' });
const M = ctx.SWR_TRANSITIONS_PLANNER || ctx.window.SWR_TRANSITIONS_PLANNER;

function fakeScene(kind, startSec, endSec, startBar, endBar) {
  return { id: 'sc-' + kind + '-' + startSec, kind, startSec, endSec, startBar, endBar,
           energy: 0.5, tags: { mood: 'warm', motion: 'med' }, suggestedCutEvery: '2bar' };
}
function fakeProfile(bpm) {
  return {
    bpm,
    duration: 60,
    bars: [
      { idx: 0, startSec: 0, endSec: 2 },
      { idx: 1, startSec: 2, endSec: 4 },
      { idx: 2, startSec: 4, endSec: 6 },
      { idx: 3, startSec: 6, endSec: 8 },
      { idx: 4, startSec: 8, endSec: 10 },
      { idx: 5, startSec: 10, endSec: 12 },
      { idx: 6, startSec: 12, endSec: 14 },
      { idx: 7, startSec: 14, endSec: 16 },
    ],
  };
}

// Test 1: cutResolutionToBars
{
  assert.equal(M.cutResolutionToBars('bar', 120), 1);
  assert.equal(M.cutResolutionToBars('2bar', 120), 2);
  assert.equal(M.cutResolutionToBars('phrase', 120), 4);
  assert.equal(M.cutResolutionToBars('chorus', 120), 0);
  assert.equal(M.cutResolutionToBars('auto', 150), 1);
  assert.equal(M.cutResolutionToBars('auto', 70), 4);
  assert.equal(M.cutResolutionToBars('auto', 120), 2);
  console.log('OK test 1: cutResolutionToBars — all 7 cases');
}

// Test 2: verse → chorus produces flash-cover
{
  const scenes = [
    fakeScene('verse', 0, 16, 0, 7),
    fakeScene('chorus', 16, 32, 8, 15),
  ];
  const r = M.plan(scenes, fakeProfile(120), { cutResolution: 'phrase' });
  // Boundary cut: fromSceneId !== toSceneId
  const boundary = r.cuts.find(c => c.fromSceneId !== c.toSceneId);
  assert.ok(boundary, 'should have a boundary cut');
  assert.equal(boundary.type, 'flash-cover', 'verse→chorus should be flash-cover');
  assert.ok(boundary.reason.includes('verse'), 'reason should mention verse');
  console.log('OK test 2: verse → chorus = flash-cover');
}

// Test 3: → drop is glitch-block
{
  const scenes = [
    fakeScene('verse', 0, 16, 0, 7),
    fakeScene('drop', 16, 24, 8, 11),
  ];
  const r = M.plan(scenes, fakeProfile(120), { cutResolution: 'phrase' });
  const boundary = r.cuts.find(c => c.fromSceneId !== c.toSceneId);
  assert.equal(boundary.type, 'glitch-block');
  console.log('OK test 3: → drop = glitch-block');
}

// Test 4: → breakdown is dip-to-color
{
  const scenes = [
    fakeScene('verse', 0, 16, 0, 7),
    fakeScene('breakdown', 16, 24, 8, 11),
  ];
  const r = M.plan(scenes, fakeProfile(120), { cutResolution: 'phrase' });
  const boundary = r.cuts.find(c => c.fromSceneId !== c.toSceneId);
  assert.equal(boundary.type, 'dip-to-color');
  // Synthetic type normalizes to flash-cover for the CSS layer
  assert.equal(M.normalizedType('dip-to-color'), 'flash-cover');
  console.log('OK test 4: → breakdown = dip-to-color (normalized to flash-cover)');
}

// Test 5: 'bar' cutResolution produces sub-cuts inside the verse
{
  const scenes = [
    fakeScene('verse', 0, 16, 0, 7),  // 8 bars
  ];
  const r = M.plan(scenes, fakeProfile(120), { cutResolution: 'bar' });
  // Should have cuts at bars 1, 2, 3, 4, 5, 6, 7 (after the first)
  const subs = r.cuts.filter(c => c.reason && c.reason.includes('sub-resolution'));
  assert.ok(subs.length >= 6, 'expected >=6 sub-cuts, got ' + subs.length);
  console.log('OK test 5: bar resolution gives ' + subs.length + ' sub-cuts');
}

// Test 6: 'phrase' cutResolution produces fewer sub-cuts than 'bar'
{
  const scenes = [fakeScene('verse', 0, 16, 0, 7)];
  const phraseRes = M.plan(scenes, fakeProfile(120), { cutResolution: 'phrase' });
  const barRes = M.plan(scenes, fakeProfile(120), { cutResolution: 'bar' });
  const phraseSubs = phraseRes.cuts.filter(c => c.reason && c.reason.includes('sub-resolution'));
  const barSubs = barRes.cuts.filter(c => c.reason && c.reason.includes('sub-resolution'));
  assert.ok(phraseSubs.length < barSubs.length, 'phrase (' + phraseSubs.length + ') should produce fewer sub-cuts than bar (' + barSubs.length + ')');
  assert.ok(phraseSubs.length >= 0);
  console.log('OK test 6: phrase (' + phraseSubs.length + ' subs) < bar (' + barSubs.length + ' subs)');
}

// Test 6b: 'chorus' cutResolution produces zero sub-cuts
{
  const scenes = [fakeScene('verse', 0, 16, 0, 7)];
  const r = M.plan(scenes, fakeProfile(120), { cutResolution: 'chorus' });
  const subs = r.cuts.filter(c => c.reason && c.reason.includes('sub-resolution'));
  assert.equal(subs.length, 0, 'chorus resolution should not sub-cut');
  console.log('OK test 6b: chorus resolution gives 0 sub-cuts');
}

// Test 7: cuts sorted by atSec
{
  const scenes = [
    fakeScene('verse', 0, 8, 0, 3),
    fakeScene('chorus', 8, 24, 4, 11),
    fakeScene('verse', 24, 32, 12, 15),
    fakeScene('outro', 32, 40, 16, 19),
  ];
  const r = M.plan(scenes, fakeProfile(120), { cutResolution: 'phrase' });
  for (let i = 1; i < r.cuts.length; i++) {
    assert.ok(r.cuts[i].atSec >= r.cuts[i - 1].atSec, 'cuts not sorted at index ' + i);
  }
  console.log('OK test 7: cuts sorted by atSec');
}

// Test 8: activeCutAt
{
  const cuts = [
    { atSec: 5, durationMs: 1000, type: 'flash-cover' },
    { atSec: 10, durationMs: 500, type: 'glitch-block' },
  ];
  let a = M.activeCutAt(cuts, 4.9);
  assert.equal(a, null);
  a = M.activeCutAt(cuts, 5.0);
  assert.ok(a, 'cut at exactly 5.0s should be active');
  assert.equal(a.cut.type, 'flash-cover');
  assert.equal(a.progress, 0);
  a = M.activeCutAt(cuts, 5.5);
  assert.equal(a.progress, 0.5);
  a = M.activeCutAt(cuts, 10.2);
  assert.equal(a.cut.type, 'glitch-block');
  a = M.activeCutAt(cuts, 10.6);
  assert.equal(a, null);
  console.log('OK test 8: activeCutAt handles before/during/after');
}

// Test 9: isNativeTransition
{
  assert.equal(M.isNativeTransition('flash-cover'), true);
  assert.equal(M.isNativeTransition('warp-dissolve'), true);
  assert.equal(M.isNativeTransition('cut'), false);
  assert.equal(M.isNativeTransition('dip-to-color'), false);
  assert.equal(M.isNativeTransition('made-up'), false);
  console.log('OK test 9: isNativeTransition');
}

console.log('---');
console.log('ALL CHECKS PASSED');
