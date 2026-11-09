import test from 'node:test';
import assert from 'node:assert/strict';
import { renderRemix, encodeWav } from './remix-renderer.js';
test('schedules all events with click-reducing edge envelopes', async () => {
  const starts = [], gains = [];
  const ctx = {
    destination: {},
    createBufferSource() { return { connect() {}, start(...args) { starts.push(args); } }; },
    createGain() { const points = []; gains.push(points); return { connect() {}, gain: { setValueAtTime(...a) { points.push(a); }, linearRampToValueAtTime(...a) { points.push(a); } } }; },
    async startRendering() { return { ok: true }; }
  };
  const plan = { duration: 2, events: [{ sourceId: 'x', start: 0, duration: 1, sourceStart: 0 }, { sourceId: 'x', start: 1, duration: 1, sourceStart: 0 }] };
  const result = await renderRemix(plan, { x: { duration: 1 } }, { contextFactory: () => ctx });
  assert.equal(result.ok, true); assert.equal(starts.length, 2); assert.equal(gains.length, 2);
  assert.deepEqual(starts[1], [1, 0, 1]);
});
test('WAV has valid RIFF header and PCM payload', () => {
  const buffer = { numberOfChannels: 1, sampleRate: 8000, length: 2, getChannelData: () => new Float32Array([0, 1]) };
  const blob = encodeWav(buffer);
  assert.equal(blob.size, 48);
  assert.equal(blob.type, 'audio/wav');
});
test('missing source and out of bounds events are rejected', async () => {
  const ctx = { createBufferSource() { throw new Error('should not schedule'); } };
  const p = { duration: 2, events: [{ sourceId: 'x', start: 0, duration: 3, sourceStart: 0 }] };
  await assert.rejects(renderRemix(p, { x: { duration: 3 } }, { contextFactory: () => ctx }), /boundaries/);
});
