import test from 'node:test';
import assert from 'node:assert/strict';
import { planRemix } from './remix-planner.js';
const loops = [{ id: 'a', duration: 4, energy: 0.2 }, { id: 'b', duration: 8, energy: 0.8 }];
test('deterministic candidate generation and exact target duration', () => {
  const opts = { targetDuration: 180, creativity: 0.65, candidates: 4, seed: 43172, bpm: 105 };
  const a = planRemix(loops, opts);
  assert.deepEqual(a, planRemix(loops, opts));
  assert.equal(a.length, 4);
  for (const plan of a) {
    assert.equal(plan.duration, 180);
    assert.ok(plan.events.length > 0);
    for (let i = 0; i < plan.events.length; i++) {
      const e = plan.events[i];
      assert.ok(e.duration > 0);
      if (i) assert.ok(Math.abs(e.start - (plan.events[i - 1].start + plan.events[i - 1].duration)) < 1e-7);
    }
    const last = plan.events.at(-1);
    assert.ok(Math.abs(last.start + last.duration - 180) < 1e-7);
  }
});
test('single short loop extends without gaps', () => {
  const p = planRemix([{ id: 'only', duration: 1.5 }], { targetDuration: 10, candidates: 1 })[0];
  assert.ok(p.events.length >= 7);
  assert.ok(p.events.every(e => e.sourceId === 'only'));
});
test('rejects malformed inputs', () => {
  assert.throws(() => planRemix([]));
  assert.throws(() => planRemix([{ duration: 0 }]));
  assert.throws(() => planRemix(loops, { targetDuration: Infinity }));
  assert.throws(() => planRemix(loops, { candidates: 100 }));
});
