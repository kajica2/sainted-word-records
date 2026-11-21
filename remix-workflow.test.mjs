import test from 'node:test';
import assert from 'node:assert/strict';
import { measureLoopEnergy, validateLoopFiles, describeLoop } from './remix-workflow.js';

test('energy reflects silence and square wave at finite scale', () => {
  const buffer = (samples) => ({
    duration: 1, numberOfChannels: 1, getChannelData: () => Float32Array.from(samples),
  });
  assert.equal(measureLoopEnergy(buffer([0, 0, 0])), 0);
  assert.equal(measureLoopEnergy(buffer([1, -1, 1, -1])), 1);
  assert.ok(measureLoopEnergy(buffer([0.1, 0.1, 0.1])) < 0.5);
});
test('audio file validation rejects oversized and non-audio inputs', () => {
  assert.equal(validateLoopFiles([{ name: 'one.wav', size: 100, type: 'audio/wav' }]).length, 1);
  assert.throws(() => validateLoopFiles([{ name: 'file.html', size: 100, type: 'text/html' }]));
  assert.throws(() => validateLoopFiles([{ name: 'x.wav', size: 50000001, type: '' }]));
  assert.throws(() => validateLoopFiles([]));
});
test('loop metadata rejects too-long decoded media', () => {
  assert.deepEqual(describeLoop('test', { duration: 1, numberOfChannels: 1, getChannelData: () => Float32Array.of(0) }),
    { id: 'test', duration: 1, energy: 0 });
  assert.throws(() => describeLoop('bad', { duration: 200 }));
});
