#!/usr/bin/env node
// scripts/check-last-mix-unit.mjs
//
// Node-only unit tests for client/last-mix-store.client.js — the
// debounced localStorage wrapper that persists the user's last automix
// blend across reloads.
//
// Strategy: load the module in a vm sandbox with a minimal localStorage
// stub. Verify save/flush/read/clear behaviour and debounce coalescing.
//
// Pass criteria: every assertion succeeds, exit 0, last line
// `LAST MIX UNIT: ALL GREEN (N tests)`.

import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const src = readFileSync(
  new URL('../client/last-mix-store.client.js', import.meta.url),
  'utf8'
);

// localStorage stub backed by an in-memory map.
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
  return sandbox.window.SWR_LAST_MIX;
}

// ---- Tests ----------------------------------------------------------------
const results = [];
function ok(name) { results.push('  ✓ ' + name); }
function bad(name, got) { results.push('  ✗ ' + name + ' (got: ' + got + ')'); process.exitCode = 1; }

// 1. Module exposes the documented API.
{
  const m = loadWith(makeStorage());
  for (const k of ['save', 'flush', 'read', 'clear', 'KEY', 'DEBOUNCE_MS']) {
    assert.ok(k in m, 'missing: ' + k);
  }
  ok('module surface (save/flush/read/clear/KEY/DEBOUNCE_MS)');
}

// 2. read() with no prior save returns null.
{
  const m = loadWith(makeStorage());
  assert.strictEqual(m.read(), null);
  ok('empty storage: read returns null');
}

// 3. save() then flush() then read() roundtrips a mix object.
{
  const m = loadWith(makeStorage());
  const mix = {
    ts: Date.now(),
    coords: { warmth: 0.42, intensity: 0.67 },
    anchors: [{ id: 'neon', dist: 0.1 }, { id: 'film', dist: 0.2 }],
    preset: { temp: 0.5, mut: 0.4 },
  };
  m.save(mix);
  m.flush();   // synchronous write for the test
  const r = m.read();
  assert.ok(r && r.ts === mix.ts, 'ts matches');
  assert.deepEqual(r.coords, mix.coords, 'coords match');
  assert.deepEqual(r.anchors, mix.anchors, 'anchors match');
  assert.deepEqual(r.preset, mix.preset, 'preset matches');
  ok('save → flush → read roundtrip preserves shape');
}

// 4. Coalescing: 3 saves within DEBOUNCE_MS collapse to one write.
{
  const store = makeStorage();
  const m = loadWith(store);
  m.save({ ts: 1, coords: { warmth: 0.1, intensity: 0.1 }, anchors: [], preset: {} });
  m.save({ ts: 2, coords: { warmth: 0.2, intensity: 0.2 }, anchors: [], preset: {} });
  m.save({ ts: 3, coords: { warmth: 0.3, intensity: 0.3 }, anchors: [], preset: {} });
  m.flush();
  // Only one entry in the map (the last coalesced save), no stale middle.
  assert.strictEqual(store._map.size, 1, 'one entry after coalesce');
  const r = m.read();
  assert.ok(r && r.ts === 3, 'last save wins');
  ok('coalesce: 3 rapid saves → 1 write, last wins');
}

// 5. clear() removes the persisted record.
{
  const m = loadWith(makeStorage());
  m.save({ ts: 1, coords: { warmth: 0.5, intensity: 0.5 }, anchors: [], preset: {} });
  m.flush();
  assert.notStrictEqual(m.read(), null, 'saved');
  m.clear();
  assert.strictEqual(m.read(), null, 'cleared');
  ok('clear() removes persisted record');
}

// 6. clear() cancels pending writes (no later flush resurrects them).
{
  const store = makeStorage();
  const m = loadWith(store);
  m.save({ ts: 1, coords: { warmth: 0.5, intensity: 0.5 }, anchors: [], preset: {} });
  m.clear();
  m.flush();   // pending was cancelled, nothing to write
  assert.strictEqual(store._map.size, 0, 'no write after clear + flush');
  ok('clear() cancels pending debounce');
}

// 7. read() rejects malformed payloads (returns null instead of throwing).
{
  const store = makeStorage();
  const m = loadWith(store);
  store.setItem(m.KEY, '{not valid json');
  assert.strictEqual(m.read(), null, 'parse error → null');
  store.setItem(m.KEY, JSON.stringify({ ts: 1 }));  // missing fields
  assert.strictEqual(m.read(), null, 'missing fields → null');
  store.setItem(m.KEY, JSON.stringify({ ts: 'not a number', coords: {}, anchors: [], preset: {} }));
  assert.strictEqual(m.read(), null, 'wrong ts type → null');
  ok('malformed payloads are rejected, not thrown');
}

// 8. Module is idempotent — second loadWith() returns the same singleton.
{
  const sandbox = {
    console, Math, Object, Array, JSON, Date, setTimeout, clearTimeout,
    localStorage: makeStorage(),
    window: { localStorage: makeStorage() },
  };
  sandbox.globalThis = sandbox.window;
  vm.createContext(sandbox);
  vm.runInContext(src, sandbox);
  const first = sandbox.window.SWR_LAST_MIX;
  vm.runInContext(src, sandbox);
  const second = sandbox.window.SWR_LAST_MIX;
  assert.strictEqual(first, second, 'singleton');
  ok('idempotent IIFE (re-execution returns same object)');
}

console.log(results.join('\n'));
console.log('LAST MIX UNIT: ALL GREEN (' + results.length + ' tests)');