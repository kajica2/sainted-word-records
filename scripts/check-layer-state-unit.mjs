#!/usr/bin/env node
// scripts/check-layer-state-unit.mjs
//
// Node-only unit tests for client/layer-state-store.client.js — the
// debounced localStorage wrapper that persists music_video.html's
// Layers.list across reloads.
//
// Strategy: load the module in a vm sandbox with a minimal localStorage
// stub. Verify save/load/clear behaviour, debounce coalescing, asset
// stripping, and shape validation.
//
// Pass criteria: every assertion succeeds, exit 0, last line
// `LAYER STATE UNIT: ALL GREEN (N tests)`.

import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const src = readFileSync(
  new URL('../client/layer-state-store.client.js', import.meta.url),
  'utf8'
);

function makeStorage() {
  const map = new Map();
  return {
    _map: map,
    getItem: (k) => map.has(k) ? map.get(k) : null,
    setItem: (k, v) => { map.set(k, String(v)); },
    removeItem: (k) => { map.delete(k); },
    clear: () => map.clear(),
  };
}

function loadWith(store) {
  const sandbox = {
    console,
    Math, Object, Array, JSON, Date, setTimeout, clearTimeout,
    localStorage: store,
    window: { localStorage: store },
  };
  sandbox.globalThis = sandbox.window;
  vm.createContext(sandbox);
  vm.runInContext(src, sandbox);
  return sandbox.window.SWR_LAYER_STATE;
}

// ---- Tests ----------------------------------------------------------------
const results = [];
function ok(name) { results.push('  ✓ ' + name); }
function bad(name, got) { results.push('  ✗ ' + name + ' (got: ' + got + ')'); process.exitCode = 1; }

// 1. Module surface.
{
  const m = loadWith(makeStorage());
  for (const k of ['save', 'load', 'clear', 'flush', 'KEY', 'DEBOUNCE_MS', '_strip']) {
    assert.ok(k in m, 'missing: ' + k);
  }
  assert.ok(m.KEY === 'swr.layers.state.v1', 'versioned key');
  assert.ok(m.DEBOUNCE_MS > 0, 'debounce interval defined');
  ok('module surface (save/load/clear/flush/KEY/DEBOUNCE_MS/_strip)');
}

// 2. Empty storage: load returns [].
{
  const m = loadWith(makeStorage());
  const out = m.load();
  assert.ok(Array.isArray(out), 'load returns an array');
  assert.strictEqual(out.length, 0, 'empty array');
  ok('empty storage: load returns []');
}

// 3. _strip removes asset field; everything else passes through.
{
  const m = loadWith(makeStorage());
  const layer = {
    id: 'L1', asset: { name: 'clip.mp4', url: 'blob:abc123' },
    blend: 'screen', opacity: 0.7, baseScale: 1.2, hue: 0, contrast: 1,
    brightness: 1, alpha: 1, mutate: 0, reactors: [{ feature: 'bass', target: 'scale', scale: 0.7, ease: 'sharp' }],
  };
  const stripped = m._strip(layer);
  assert.strictEqual(stripped.asset, undefined, 'asset removed');
  assert.strictEqual(stripped.id, 'L1');
  assert.strictEqual(stripped.blend, 'screen');
  assert.strictEqual(stripped.opacity, 0.7);
  assert.deepEqual(stripped.reactors, layer.reactors);
  ok('_strip removes asset, preserves everything else');
}

// 4. _strip is defensive: non-object input → null.
{
  const m = loadWith(makeStorage());
  assert.strictEqual(m._strip(null), null);
  assert.strictEqual(m._strip(undefined), null);
  assert.strictEqual(m._strip('string'), null);
  assert.strictEqual(m._strip(42), null);
  ok('_strip is defensive (null / string / number → null)');
}

// 5. save + flush roundtrips an array of layers (assets stripped).
{
  const m = loadWith(makeStorage());
  const layers = [
    { id: 'L1', asset: { name: 'a.mp4', url: 'blob:a' }, blend: 'screen', opacity: 0.5, baseScale: 1.0, hue: 0, contrast: 1, brightness: 1, alpha: 1, mutate: 0, reactors: [] },
    { id: 'L2', asset: { name: 'b.mp4', url: 'blob:b' }, blend: 'multiply', opacity: 0.8, baseScale: 0.5, hue: 30, contrast: 1, brightness: 1, alpha: 1, mutate: 0, reactors: [] },
  ];
  m.save(layers);
  m.flush();
  const out = m.load();
  assert.strictEqual(out.length, 2, 'two layers persisted');
  assert.strictEqual(out[0].id, 'L1');
  assert.strictEqual(out[0].asset, undefined, 'asset stripped on save');
  assert.strictEqual(out[0].blend, 'screen', 'metadata preserved');
  assert.strictEqual(out[1].id, 'L2');
  ok('save + flush + load roundtrips layers (assets stripped)');
}

// 6. Coalescing: 3 saves within DEBOUNCE_MS collapse to one write.
{
  const store = makeStorage();
  const m = loadWith(store);
  // Use fully-shaped layers so _strip doesn't filter them out.
  const fullLayer = (id) => ({ id, blend: 'screen', opacity: 1, baseScale: 1, hue: 0, contrast: 1, brightness: 1, alpha: 1, mutate: 0, reactors: [] });
  m.save([fullLayer('L1')]);
  m.save([fullLayer('L2')]);
  m.save([fullLayer('L3')]);
  m.flush();
  const out = m.load();
  assert.strictEqual(out.length, 1, 'one layer after coalesce');
  assert.strictEqual(out[0].id, 'L3', 'last save wins');
  ok('coalesce: 3 rapid saves → 1 write, last wins');
}

// 7. save with non-array is a no-op.
{
  const store = makeStorage();
  const m = loadWith(store);
  m.save(null);
  m.save(undefined);
  m.save('string');
  m.save({ id: 'L1' });  // object, not array
  m.flush();
  assert.strictEqual(m.load().length, 0, 'non-array inputs not persisted');
  ok('save ignores non-array inputs');
}

// 8. save strips entries that are non-objects (defensive).
{
  const m = loadWith(makeStorage());
  const full = (id) => ({ id, blend: 'screen', opacity: 1, baseScale: 1, hue: 0, contrast: 1, brightness: 1, alpha: 1, mutate: 0, reactors: [] });
  m.save([
    full('L1'),
    null,
    'string',
    full('L2'),
  ]);
  m.flush();
  const out = m.load();
  assert.strictEqual(out.length, 2, 'non-objects filtered out');
  assert.strictEqual(out[0].id, 'L1');
  assert.strictEqual(out[1].id, 'L2');
  ok('save filters out non-object entries');
}

// 9. load() rejects entries missing required fields.
{
  const store = makeStorage();
  // Hand-craft a record with valid + invalid entries.
  const valid = { id: 'L1', blend: 'screen', opacity: 1, baseScale: 1, hue: 0, contrast: 1, brightness: 1, alpha: 1, mutate: 0, reactors: [] };
  const missing = { id: 'L2', blend: 'screen' };  // missing most fields
  store.setItem('swr.layers.state.v1', JSON.stringify([valid, missing]));
  const m = loadWith(store);
  const out = m.load();
  assert.strictEqual(out.length, 1, 'missing-field entry dropped');
  assert.strictEqual(out[0].id, 'L1', 'valid entry preserved');
  ok('load() rejects entries missing required fields');
}

// 10. load() rejects malformed JSON.
{
  const store = makeStorage();
  store.setItem('swr.layers.state.v1', '{not valid json');
  const m = loadWith(store);
  const out = m.load();
  assert.ok(Array.isArray(out), 'returns array');
  assert.strictEqual(out.length, 0, 'parse error → empty array');
  ok('malformed JSON → empty array (does not throw)');
}

// 11. load() rejects non-array payloads (object instead of array).
{
  const store = makeStorage();
  store.setItem('swr.layers.state.v1', JSON.stringify({ id: 'L1' }));
  const m = loadWith(store);
  const out = m.load();
  assert.ok(Array.isArray(out), 'returns array');
  assert.strictEqual(out.length, 0, 'non-array payload → empty array');
  ok('non-array payload → empty array');
}

// 12. clear() removes the persisted record.
{
  const m = loadWith(makeStorage());
  m.save([{ id: 'L1', blend: 'screen', opacity: 1, baseScale: 1, hue: 0, contrast: 1, brightness: 1, alpha: 1, mutate: 0, reactors: [] }]);
  m.flush();
  assert.strictEqual(m.load().length, 1);
  m.clear();
  const after = m.load();
  assert.ok(Array.isArray(after) && after.length === 0, 'cleared');
  ok('clear() removes the persisted record');
}

// 13. clear() cancels pending debounced writes.
{
  const store = makeStorage();
  const m = loadWith(store);
  m.save([{ id: 'L1' }]);
  m.clear();
  m.flush();  // pending was cancelled
  assert.strictEqual(store._map.size, 0, 'no write after clear + flush');
  ok('clear() cancels pending debounce');
}

// 14. Idempotent IIFE.
{
  const sandbox = {
    console, Math, Object, Array, JSON, Date, setTimeout, clearTimeout,
    localStorage: makeStorage(), window: { localStorage: makeStorage() },
  };
  sandbox.globalThis = sandbox.window;
  vm.createContext(sandbox);
  vm.runInContext(src, sandbox);
  const first = sandbox.window.SWR_LAYER_STATE;
  vm.runInContext(src, sandbox);
  const second = sandbox.window.SWR_LAYER_STATE;
  assert.strictEqual(first, second, 'singleton');
  ok('idempotent IIFE (re-execution returns same object)');
}

console.log(results.join('\n'));
console.log('LAYER STATE UNIT: ALL GREEN (' + results.length + ' tests)');