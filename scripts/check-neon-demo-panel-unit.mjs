#!/usr/bin/env node
// Unit coverage for client/neon-demo-panel.client.js (pure helpers + mount contract).

import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync('client/neon-demo-panel.client.js', 'utf8');

const document = {
  readyState: 'complete',
  head: { appendChild: function () {} },
  body: { appendChild: function () {} },
  getElementById: function () { return null; },
  addEventListener: function () {},
  createElement: function (tag) {
    return {
      tagName: tag.toUpperCase(),
      className: '',
      id: '',
      style: {},
      classList: { toggle: function () {}, add: function () {}, remove: function () {} },
      setAttribute: function () {},
      getAttribute: function () { return null; },
      appendChild: function () {},
      addEventListener: function () {},
      querySelector: function () { return null; },
      querySelectorAll: function () { return []; },
      textContent: '',
    };
  },
};

const window = {
  document: document,
  addEventListener: function () {},
  SWR_MOTION_KILL: {
    isRotationGloballyEnabled: function () { return false; },
    isZoomGloballyEnabled: function () { return false; },
    IMAGE_CLARITY_ENABLED: true,
  },
  VersionsPresets: {
    SHORTCUT_PRESETS: ['pulse', 'neon'],
    PRESETS: { neon: { label: 'NEON', temp: 0.1 } },
    setPresetOverride: function () { return true; },
    applyPreset: function (k) { return k === 'neon'; },
  },
  __swrCurrentPreset: 'pulse',
  SWR_PRESET_CYCLE: { next: function (p) { return p === 'pulse' ? 'neon' : 'pulse'; } },
  FX: { setPersona: function () {} },
  SWR_LOOK_FILTER_CYCLER: { apply: function () { return true; }, reset: function () {} },
  SWR_KEYS: { run: function () { return true; }, home: function () {}, isBlackoutActive: function () { return false; } },
};
window.window = window;

vm.runInNewContext(source, { window: window, document: document });

const api = window.SWR_NEON_DEMO;
let tests = 0;
function assert(cond, msg) {
  tests++;
  if (!cond) throw new Error('FAIL: ' + msg);
}

assert(api && typeof api.mount === 'function', 'SWR_NEON_DEMO exports mount');
assert(api.listShortcutPresets().join(',') === 'pulse,neon', 'listShortcutPresets');
assert(api.isRotationOff() === true, 'isRotationOff');
assert(api.isZoomOff() === true, 'isZoomOff');
assert(api.applyShortcutPreset('neon') === true, 'applyShortcutPreset');
assert(api.getState().activePreset === 'neon', 'active preset tracked');
assert(api.applyLookFilter(3) === true, 'applyLookFilter');

console.log('NEON DEMO PANEL UNIT: ALL GREEN (' + tests + ' tests)');
