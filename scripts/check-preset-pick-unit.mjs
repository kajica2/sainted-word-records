#!/usr/bin/env node
// scripts/check-preset-pick-unit.mjs
//
// Node-only unit tests for client/preset-pick-store.client.js — the
// localStorage wrapper that persists the user's last manual preset
// pick (Tab / Shift+Tab cycle or neighbour-list click) across reloads.
//
// Strategy: load the module in a vm sandbox with a minimal localStorage
// stub. Verify save / load / clear behaviour, validation, and the
// SHORTCUT_PRESETS gating that prevents legacy values from pointing
// at non-existent anchors.
//
// Pass criteria: every assertion succeeds, exit 0, last line
// `PRESET PICK UNIT: ALL GREEN (N tests)`.

import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const src = readFileSync(
  new URL('../client/preset-pick-store.client.js', import.meta.url),
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

function loadWith(store, shorcuthPresets) {
  const sandbox = {
    console,
    Math, Object, Array, JSON, Date,
    localStorage: store,
    window: {
      localStorage: store,
      VersionsPresets: Array.isArray(shorcuthPresets) ? { SHORTCUT_PRESETS: shorcuthPresets } : undefined,
    },
  };
  sandbox.globalThis = sandbox.window;
  vm.createContext(sandbox);
  vm.runInContext(src, sandbox);
  return sandbox.window.SWR_PRESET_PICK;
}

const SHORTCUTS = ['pulse','neon','grid','eclipse','smoke','aurora','film','glitch','void'];

// ---- Tests ----------------------------------------------------------------
const results = [];
function ok(name) { results.push('  ✓ ' + name); }
function bad(name, got) { results.push('  ✗ ' + name + ' (got: ' + got + ')'); process.exitCode = 1; }

// 1. Module surface.
{
  const m = loadWith(makeStorage());
  for (const k of ['save', 'load', 'clear', 'KEY']) {
    assert.ok(k in m, 'missing: ' + k);
  }
  assert.ok(m.KEY === 'swr.preset.manual.v1', 'versioned key');
  ok('module surface (save/load/clear/KEY)');
}

// 2. Empty storage: load returns null.
{
  const m = loadWith(makeStorage());
  assert.strictEqual(m.load(), null);
  ok('empty storage: load returns null');
}

// 3. save + load roundtrips a known id.
{
  const m = loadWith(makeStorage(), SHORTCUTS);
  m.save('film');
  assert.strictEqual(m.load(), 'film', 'save → load roundtrip');
  ok('save / load roundtrips a known id');
}

// 4. save ignores non-string / empty / null.
{
  const m = loadWith(makeStorage(), SHORTCUTS);
  m.save(null);
  m.save(undefined);
  m.save('');
  m.save(42);
  m.save({ id: 'film' });
  assert.strictEqual(m.load(), null, 'non-string inputs not persisted');
  ok('save ignores non-string / empty / null');
}

// 5. Legacy / hand-edited value (numeric or non-string stored in
//    localStorage by hand) is rejected — load() expects a string.
//    Simulate by stubbing getItem to return a non-string.
{
  const store = makeStorage();
  store.getItem = () => 42;  // pretend localStorage returned a number
  const m = loadWith(store, SHORTCUTS);
  assert.strictEqual(m.load(), null, 'non-string stored value rejected');
  ok('non-string value in localStorage is rejected');
}

// 6. Empty string in localStorage is rejected (load() returns null).
{
  const store = makeStorage();
  store.setItem('swr.preset.manual.v1', '');
  const m = loadWith(store, SHORTCUTS);
  assert.strictEqual(m.load(), null, 'empty string rejected');
  ok('empty string in localStorage is rejected');
}

// 7. Non-SHORTCUT_PRESETS ids ARE persisted (neighbour list can reach
//    all 19 anchors, not just the 9 shortcut slots). Earlier design
//    gated against SHORTCUT_PRESETS — that was over-eager.
{
  const m = loadWith(makeStorage(), SHORTCUTS);
  m.save('tape');  // not in SHORTCUT_PRESETS
  assert.strictEqual(m.load(), 'tape', 'non-shortcut id roundtrips');
  ok('non-SHORTCUT_PRESETS ids roundtrip (neighbour-list reach)');
}

// 8. clear() removes the persisted record.
{
  const m = loadWith(makeStorage(), SHORTCUTS);
  m.save('film');
  assert.strictEqual(m.load(), 'film');
  m.clear();
  assert.strictEqual(m.load(), null, 'cleared');
  ok('clear() removes the persisted record');
}

// 9. Idempotent IIFE: re-execution returns the same object.
{
  const sandbox = {
    console, Math, Object, Array, JSON, Date,
    localStorage: makeStorage(),
    window: { localStorage: makeStorage(), VersionsPresets: { SHORTCUT_PRESETS: SHORTCUTS } },
  };
  sandbox.globalThis = sandbox.window;
  vm.createContext(sandbox);
  vm.runInContext(src, sandbox);
  const first = sandbox.window.SWR_PRESET_PICK;
  vm.runInContext(src, sandbox);
  const second = sandbox.window.SWR_PRESET_PICK;
  assert.strictEqual(first, second, 'singleton');
  ok('idempotent IIFE (re-execution returns same object)');
}

console.log(results.join('\n'));
console.log('PRESET PICK UNIT: ALL GREEN (' + results.length + ' tests)');