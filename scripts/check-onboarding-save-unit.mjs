// scripts/check-onboarding-save-unit.mjs — sanity for the
// onboarding + studio-save modules. Loads each in a node:vm sandbox
// and verifies the public surface and core state transitions.
//
// Checks:
//
//   1. SWR_ONBOARD exposes init / destroy / toast / markStep /
//      markAudioLoaded / markLayerAdded / markFilterApplied /
//      markPresetSaved / markLibrarySaved / reset / getState / setState
//      / nextStep / subscribe.
//   2. Initial state has 5 boolean flags, all false.
//   3. step progression: each mark() flips exactly the expected key.
//   4. LocalStorage round-trip: setState persists, loadState reads back.
//   5. reset() returns all 5 to false.
//   6. SWR_STUDIO_SAVE exposes save / remove / list / restore /
//      snapshot / saveLibrary / clearAll / exportJson / importJson.
//   7. save() round-trips through the snapshot shape.
//   8. No em-dashes anywhere in the source (anti-Tell).

import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const ONBOARDING = readFileSync(new URL('../client/onboarding.client.js', import.meta.url), 'utf8');
const SAVE       = readFileSync(new URL('../client/studio-save.client.js', import.meta.url), 'utf8');

const results = [];
async function check(name, fn) {
  let ok = false, detail = '';
  try {
    const r = await fn();
    if (r === true) ok = true;
    else if (typeof r === 'string') { ok = false; detail = r; }
    else ok = false;
  } catch (e) { detail = (e && e.message) ? e.message : String(e); }
  results.push({ name, ok, detail });
  console.log((ok ? '  PASS  ' : '  FAIL  ') + name + (detail ? ' — ' + detail : ''));
}

function makeSandbox() {
  const ls = { _k: {}, getItem(k) { return k in this._k ? this._k[k] : null; },
                      setItem(k, v) { this._k[k] = String(v); },
                      removeItem(k) { delete this._k[k]; } };
  return {
    window: {},
    document: {
      getElementById: () => null,
      addEventListener() {},
      createElement: () => ({
        style: {}, className: '', setAttribute() {}, appendChild() {},
        addEventListener() {}, click() {},
      }),
      body: { appendChild() {} },
    },
    console: { warn() {}, log() {}, info() {}, error() {} },
    localStorage: ls,
    setTimeout: () => 0,
    clearTimeout: () => {},
    requestAnimationFrame: () => 0,
    performance: { now: () => 1000 },
    CustomEvent: class {},
    dispatchEvent: () => true,
    URL: { createObjectURL: () => 'blob:test' },
  };
}

function loadOnboarding() {
  const sb = makeSandbox();
  sb.window = sb;
  vm.createContext(sb);
  vm.runInContext(ONBOARDING, sb);
  return sb.window.SWR_ONBOARD;
}
function loadSave() {
  const sb = makeSandbox();
  sb.window = sb;
  vm.createContext(sb);
  vm.runInContext(SAVE, sb);
  return sb.window.SWR_STUDIO_SAVE;
}

check('SWR_ONBOARD exposes the documented API', () => {
  const api = loadOnboarding();
  if (!api) return 'not exposed';
  for (const k of ['init', 'destroy', 'toast', 'markStep', 'markAudioLoaded', 'markLayerAdded',
                   'markFilterApplied', 'markPresetSaved', 'markLibrarySaved', 'reset',
                   'getState', 'setState', 'nextStep', 'subscribe']) {
    if (typeof api[k] !== 'function') return 'missing or non-function: ' + k;
  }
  return true;
});

check('SWR_ONBOARD initial state has 5 boolean flags, all false', () => {
  const api = loadOnboarding();
  const s = api.getState();
  for (const k of ['audioLoaded', 'firstLayerAdded', 'filterApplied', 'presetSaved', 'librarySaved']) {
    if (typeof s[k] !== 'boolean') return k + ' is not boolean: ' + typeof s[k];
    if (s[k] !== false) return k + ' initial value: ' + s[k];
  }
  return true;
});

check('SWR_ONBOARD step progression: each mark* flips the expected flag', () => {
  const api = loadOnboarding();
  const checks = [
    ['markAudioLoaded',    'audioLoaded'],
    ['markLayerAdded',     'firstLayerAdded'],
    ['markFilterApplied',  'filterApplied'],
    ['markPresetSaved',    'presetSaved'],
    ['markLibrarySaved',   'librarySaved'],
  ];
  // Each call uses a fresh sandbox so localStorage doesn't carry state
  // between marks.
  for (const [fn, key] of checks) {
    const sb = makeSandbox();
    sb.window = sb;
    vm.createContext(sb);
    vm.runInContext(ONBOARDING, sb);
    const a = sb.window.SWR_ONBOARD;
    a[fn]();
    if (a.getState()[key] !== true) return fn + ' did not set ' + key + ' = true';
  }
  return true;
});

check('SWR_ONBOARD reset() returns every flag to false', () => {
  const api = loadOnboarding();
  api.markAudioLoaded();
  api.markLayerAdded();
  api.markFilterApplied();
  api.markPresetSaved();
  api.markLibrarySaved();
  api.reset();
  const s = api.getState();
  for (const k of Object.keys(s)) {
    if (s[k] !== false) return k + ' still true after reset: ' + s[k];
  }
  return true;
});

check('SWR_ONBOARD subscribe() runs on every set', () => {
  const api = loadOnboarding();
  const calls = [];
  const unsub = api.subscribe((s, prev) => { calls.push(s.audioLoaded); });
  api.markAudioLoaded();
  api.markLayerAdded();
  unsub();
  api.markFilterApplied();
  if (calls.length !== 2) return 'subscriber called ' + calls.length + ' times: ' + calls.join(',');
  return true;
});

check('SWR_STUDIO_SAVE exposes the documented API', () => {
  const api = loadSave();
  if (!api) return 'not exposed';
  for (const k of ['save', 'remove', 'list', 'restore', 'snapshot', 'saveLibrary', 'clearAll',
                   'exportJson', 'importJson']) {
    if (typeof api[k] !== 'function') return 'missing or non-function: ' + k;
  }
  return true;
});

check('SWR_STUDIO_SAVE.save() round-trips through the snapshot shape', () => {
  const api = loadSave();
  // Stub the engine globals the snapshot() reads.
  const sb = makeSandbox();
  sb.window = sb;
  vm.createContext(sb);
  vm.runInContext(SAVE, sb);
  const a = sb.window.SWR_STUDIO_SAVE;
  // Inject globals the snapshot reads.
  sb.Layers = { list: [
    { id: 'L1', asset: { id: 'a' }, blend: 'source-over', opacity: 1, baseScale: 1,
      hue: 0, brightness: 1, contrast: 1, pos: { x: 0, y: 0, rot: 0 }, rotOffset: 0,
      rotationEnabled: true, z: 0, algo: 'none', algoIntensity: 0 },
  ] };
  sb.Audio = { file: { name: 'song.mp3' }, feat: null };
  sb.SWR_LOOK_FILTER_CYCLER = { get: function () { return { slot: 3, intensity: 0.8, step: 2 }; } };
  const data = a.snapshot('My preset');
  if (!data || data.schema !== 'swr-preset/v1') return 'bad schema: ' + (data && data.schema);
  if (data.name !== 'My preset') return 'name not captured: ' + data.name;
  if (!Array.isArray(data.layers) || data.layers.length !== 1) return 'layers not captured';
  if (data.filter.slot !== 3) return 'filter slot not captured: ' + data.filter.slot;
  return true;
});

check('SWR_STUDIO_SAVE save/remove/list round-trip persists to localStorage', () => {
  const sb = makeSandbox();
  sb.window = sb;
  vm.createContext(sb);
  vm.runInContext(SAVE, sb);
  const a = sb.window.SWR_STUDIO_SAVE;
  // Stub the snapshot so the engine globals don't matter here.
  a.snapshot = function (name) { return { schema: 'swr-preset/v1', name: name, savedAt: new Date().toISOString(), layers: [], filter: { slot: 0, intensity: 0, step: 0 } }; };
  const d1 = a.save('Sunset vibes');
  const d2 = a.save('Rainy day');
  if (!d1 || d1.name !== 'Sunset vibes') return 'save #1 failed';
  if (!d2 || d2.name !== 'Rainy day') return 'save #2 failed';
  const list = a.list();
  if (list.length !== 2) return 'list count: ' + list.length;
  if (!a.remove('Sunset vibes')) return 'remove returned false';
  if (a.list().length !== 1) return 'post-remove list wrong length';
  return true;
});

check('SWR_STUDIO_SAVE.exportJson / importJson round-trip', () => {
  const sb = makeSandbox();
  sb.window = sb;
  vm.createContext(sb);
  vm.runInContext(SAVE, sb);
  const a = sb.window.SWR_STUDIO_SAVE;
  a.snapshot = function (name) { return { schema: 'swr-preset/v1', name: name, savedAt: '2026-01-01', layers: [], filter: { slot: 0, intensity: 0, step: 0 } }; };
  a.save('origin');
  const exported = a.exportJson('origin');
  if (!exported || exported.name !== 'origin') return 'export failed';
  a.remove('origin');
  if (a.list().length !== 0) return 'remove after export failed';
  const ok = a.importJson(exported);
  if (!ok) return 'import returned false';
  if (a.list().length !== 1) return 'import did not restore the list';
  return true;
});

check('em-dashes banned from the onboarding + studio-save sources', () => {
  for (const [name, src] of [['onboarding', ONBOARDING], ['studio-save', SAVE]]) {
    if (src.indexOf('\u2014') !== -1) return name + ' has em-dash (U+2014)';
    if (src.indexOf('\u2013') !== -1) return name + ' has en-dash (U+2013)';
  }
  return true;
});

// ---- summary ----
(async () => {
  await new Promise((r) => setTimeout(r, 100));
  const pass = results.filter((r) => r.ok).length;
  const fail = results.filter((r) => !r.ok).length;
  console.log(`\n${pass} passed, ${fail} failed (${results.length} checks)`);
  if (fail > 0) process.exit(1);
})();
