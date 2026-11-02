// Regression tests for the browser-native scenes persistence contract.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';

const source = readFileSync(new URL('../client/scenes.client.js', import.meta.url), 'utf8');

function setup(failWrite = false) {
  const storage = new Map();
  const events = [];
  const window = {
    dispatchEvent(event) { events.push(event.type); },
  };
  const localStorage = {
    getItem(key) { return storage.get(key) ?? null; },
    setItem(key, value) {
      if (failWrite) throw new Error('QuotaExceededError');
      storage.set(key, value);
    },
  };
  const document = { getElementById() { return null; } };
  const context = { window, document, localStorage, Date, Event: class {}, CustomEvent: class { constructor(type) { this.type = type; } }, setTimeout, clearTimeout };
  vm.runInNewContext(source, context);
  return { scenes: window.SWR_SCENES, events, storage };
}

test('scene save persists and emits a change event', () => {
  const { scenes, events, storage } = setup();
  assert.equal(scenes.save(0), true);
  assert.equal(JSON.parse(storage.get(scenes.STORAGE_KEY))[0].snapshot.presetOverride, 'neon');
  assert.deepEqual(events, ['swr-scenes-changed']);
  assert.equal(scenes.recall(0), true);
});

test('scene save reports storage failure without emitting success event', () => {
  const { scenes, events } = setup(true);
  assert.equal(scenes.save(0), false);
  assert.deepEqual(events, []);
});

test('invalid scene index does not write or emit event', () => {
  const { scenes, events, storage } = setup();
  assert.equal(scenes.save(-1), false);
  assert.equal(scenes.save(4), false);
  assert.equal(storage.size, 0);
  assert.deepEqual(events, []);
});
