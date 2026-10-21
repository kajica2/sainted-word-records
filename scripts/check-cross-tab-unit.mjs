#!/usr/bin/env node
// scripts/check-cross-tab-unit.mjs - unit coverage for P1.5 (cross-tab
// broadcast fallback) in lib/media-store.client.js.
//
// Plan: docs/PLANS/architecture-audit-2026-10.md, section 1.5. The audit
// found that the README claimed a localStorage fallback for browsers
// without BroadcastChannel; the code did not have one. The fix: when
// `new BroadcastChannel(name)` is missing or throws at construction
// (private-mode contexts in some browsers), cross-tab sync still works
// via a `storage` event + sentinel localStorage key. The fallback must:
//   1. fire when BroadcastChannel is missing - bare typeof check.
//   2. fire when BroadcastChannel is present but its constructor throws.
//   3. NOT install a storage listener when BC is up (dead weight).
//   4. write a sentinel key with a JSON envelope when emitting.
//   5. bridge any storage event for that sentinel into the same in-process
//      callback the BC path uses (so a host subscribed via onChange() does
//      not need to care which transport carried the event).
//   6. ignore storage events for unrelated keys or non-JSON values.
//
// Loaded in a node:vm sandbox with a stub window. The IIFE only references
// `window.SWR_MEDIA` at load time and `window.localStorage` /
// `window.addEventListener` from inside the cross-tab broadcast block we
// care about, so the sandbox needs no IDB / no navigator / no DOM.
//
// Run:  node scripts/check-cross-tab-unit.mjs
// Exit: 0 = all assertions pass, 1 = any failure.

import vm from 'node:vm';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const ROOT = path.resolve(path.dirname(__filename), '..');
const SRC_TEXT = fs.readFileSync(path.join(ROOT, 'lib/media-store.client.js'), 'utf8');

let failures = 0;
function check(cond, msg, detail) {
  if (cond) console.log('  PASS', msg, detail ? '(' + detail + ')' : '');
  else { console.log('  FAIL', msg, detail ? '(' + detail + ')' : ''); failures++; }
}

// ---- Static source checks (cheap, survive an env skip) ------------------
// The behavioural half below needs a vm; these do not, so a typo in the
// fallback contract is still caught on a machine with a different vm.

console.log('cross-tab: source structure (static)');
check(
  /typeof\s+BroadcastChannel\s*===\s*['"]function['"]/.test(SRC_TEXT),
  'the BC feature check uses typeof (private-mode safe)'
);
check(
  /\btry\s*\{\s*return\s+new\s+BroadcastChannel\(/.test(SRC_TEXT),
  'BC construction is wrapped in try/catch (private-mode context where the API throws)'
);
check(
  /window\.localStorage\.setItem\(BC_STORAGE_KEY\s*,/.test(SRC_TEXT) ||
    /localStorage\.setItem\(BC_STORAGE_KEY/.test(SRC_TEXT),
  'BC-missing path writes a sentinel localStorage key'
);
check(
  /addEventListener\(\s*['"]storage['"]/.test(SRC_TEXT),
  'BC-missing path installs a storage event listener'
);
check(
  /BC_STORAGE_KEY/.test(SRC_TEXT) && /swr\.bc\.swr-media/.test(SRC_TEXT),
  'sentinel key is namespaced (swr.bc.swr-media)'
);
check(
  /JSON\.stringify\(\s*\{\s*at:\s*Date\.now\(\)\s*,\s*evt:/.test(SRC_TEXT),
  'write payload uses an envelope { at, evt } so JSON-parse failures are localized'
);
check(
  /hasBroadcast:\s*_hasBroadcast/.test(SRC_TEXT),
  'hasBroadcast is exposed and reflects the runtime BC availability'
);
check(
  /!\s*bc\s*&&\s*typeof\s+window/.test(SRC_TEXT),
  'storage listener is gated on BC actually being missing (not always-on)'
);

// ---- Sandbox helpers ------------------------------------------------------

// Build a window stub with a fake localStorage + addEventListener that we
// can drive from the test. dispatchEvent() iterates the listeners arrays and
// invokes them synchronously, matching how a browser dispatches a StorageEvent.
function buildWindow() {
  const data = Object.create(null);
  const ls = {
    getItem(k) { return Object.prototype.hasOwnProperty.call(data, k) ? data[k] : null; },
    setItem(k, v) { data[String(k)] = String(v); },
    removeItem(k) { delete data[String(k]); },
    clear() { for (const k of Object.keys(data)) delete data[k]; },
  };
  const listenersByName = Object.create(null);
  const win = {
    localStorage: ls,
    addEventListener(name, fn) {
      const arr = (listenersByName[name] || (listenersByName[name] = []));
      arr.push(fn);
      win['_' + name + 'Listeners'] = arr;
    },
    removeEventListener(name, fn) {
      const arr = listenersByName[name];
      if (!arr) return;
      const i = arr.indexOf(fn);
      if (i !== -1) arr.splice(i, 1);
    },
    dispatchEvent(ev) {
      const arr = win['_' + ev.type + 'Listeners'];
      if (!arr) return true;
      for (const fn of arr.slice()) {
        try { fn(ev); } catch (e) { /* listener throw mirrors a browser warn */ }
      }
      return true;
    },
  };
  return { win, ls, data };
}

function makeSandbox(extra) {
  const { win, ls } = buildWindow();
  const sandbox = Object.assign({
    window: win,
    console: { warn: () => {}, log: () => {}, error: () => {} },
    setTimeout: () => 1,
    clearTimeout: () => {},
    performance: { now: () => Date.now() },
    Date, JSON, Promise, Object, Array, String, Number, Boolean, Math, Error,
    parseInt, parseFloat, isFinite, isNaN,
  }, extra || {});
  vm.createContext(sandbox);
  return { sandbox, win, ls };
}

// ---- 1. Module loads with BroadcastChannel absent; storage listener set up

console.log('cross-tab: module load (BroadcastChannel absent)');
const { sandbox: sBCAbsent, win: wBCAbsent } = makeSandbox(); // no BroadcastChannel
vm.runInContext(SRC_TEXT, sBCAbsent, { filename: 'media-store.client.js (no BC)' });
const M = sBCAbsent.window.SWR_MEDIA;

check(typeof M === 'object' && M !== null, 'window.SWR_MEDIA attached');
check(typeof M.onChange === 'function', 'onChange() exposed');
check(typeof M.hasBroadcast === 'boolean', 'hasBroadcast exposed');
check(M.hasBroadcast === false, 'hasBroadcast === false (BC absent)');
check(
  Array.isArray(wBCAbsent._storageListeners) && wBCAbsent._storageListeners.length === 1,
  'exactly one `storage` listener attached when BC is missing'
);

// ---- 2. onChange registers an in-process listener -------------------------

console.log('cross-tab: in-process listener registration');
const received = [];
const off = M.onChange((e) => received.push(e));
check(typeof off === 'function', 'onChange returns an unsubscribe function');

// ---- 3. Storage event with the sentinel key + a JSON envelope fires the cb -

console.log('cross-tab: storage event delivers payload to listener');
const receivedBefore = received.length;
const syntheticEvent = {
  type: 'storage',
  key: 'swr.bc.swr-media',
  newValue: JSON.stringify({ at: Date.now(), evt: { type: 'added', count: 2, ids: ['x', 'y'] } }),
  oldValue: null,
  storageArea: wBCAbsent.localStorage,
};
wBCAbsent.dispatchEvent(syntheticEvent);
check(received.length === receivedBefore + 1, 'listener fired once for the storage event', 'received=' + received.length);
check(received[received.length - 1] && received[received.length - 1].type === 'added', 'nested event payload came through', JSON.stringify(received[received.length - 1]));
check(received[received.length - 1] && received[received.length - 1].count === 2, 'count field preserved', JSON.stringify(received[received.length - 1]));
check(received[received.length - 1] && received[received.length - 1].ids && received[received.length - 1].ids[0] === 'x', 'ids array preserved', JSON.stringify(received[received.length - 1]));

// ---- 4. Multiple listeners all fire from the same storage event -----------

console.log('cross-tab: multiple listeners on one storage event');
const alsoReceived = [];
const off2 = M.onChange((e) => alsoReceived.push(e));
const multiEvent = {
  type: 'storage',
  key: 'swr.bc.swr-media',
  newValue: JSON.stringify({ at: 1, evt: { type: 'deleted', id: 'z' } }),
  oldValue: null,
  storageArea: wBCAbsent.localStorage,
};
wBCAbsent.dispatchEvent(multiEvent);
check(received.length === 3 && alsoReceived.length === 1, 'both listeners fired for one event', `received=${received.length} also=${alsoReceived.length}`);

// ---- 5. Unsubscribe stops delivery ----------------------------------------

console.log('cross-tab: unsubscribe stops delivery');
off();
off2();
const receivedBeforeUnsub = received.length;
const alsoBeforeUnsub = alsoReceived.length;
wBCAbsent.dispatchEvent({
  type: 'storage',
  key: 'swr.bc.swr-media',
  newValue: JSON.stringify({ at: 1, evt: { type: 'cleared' } }),
  oldValue: null,
  storageArea: wBCAbsent.localStorage,
});
check(received.length === receivedBeforeUnsub, 'first listener does not fire after unsubscribe', `received=${received.length} before=${receivedBeforeUnsub}`);
check(alsoReceived.length === alsoBeforeUnsub, 'second listener does not fire after unsubscribe', `also=${alsoReceived.length} before=${alsoBeforeUnsub}`);

// ---- 6. Listener guards: unrelated keys, empty newValue, bad JSON ---------

console.log('cross-tab: guards on what gets bridged');
const before = received.length;
const unrelatedKey = {
  type: 'storage',
  key: 'swr.render.dprAutoLow', // an existing `swr.` key the codebase writes
  newValue: '1.5',
  oldValue: null,
  storageArea: wBCAbsent.localStorage,
};
wBCAbsent.dispatchEvent(unrelatedKey);
check(received.length === before, 'storage event for unrelated swr.* key is ignored', 'received=' + received.length);

const noValue = {
  type: 'storage',
  key: 'swr.bc.swr-media',
  newValue: null, // removal / clear branch
  oldValue: JSON.stringify({ at: 1, evt: { type: 'x' } }),
  storageArea: wBCAbsent.localStorage,
};
wBCAbsent.dispatchEvent(noValue);
check(received.length === before, 'storage event with null newValue is ignored', 'received=' + received.length);

const badJson = {
  type: 'storage',
  key: 'swr.bc.swr-media',
  newValue: 'not json {{',
  oldValue: null,
  storageArea: wBCAbsent.localStorage,
};
wBCAbsent.dispatchEvent(badJson);
check(received.length === before, 'non-JSON sentinel value is silently dropped', 'received=' + received.length);

const jsonNoEvt = {
  type: 'storage',
  key: 'swr.bc.swr-media',
  newValue: '{"at":1}', // well-formed JSON but missing the evt envelope
  oldValue: null,
  storageArea: wBCAbsent.localStorage,
};
wBCAbsent.dispatchEvent(jsonNoEvt);
check(received.length === before, 'JSON without the evt envelope is dropped', 'received=' + received.length);

// After this stretch of ignored events, a valid event should still come through.
const recoveryEvent = {
  type: 'storage',
  key: 'swr.bc.swr-media',
  newValue: JSON.stringify({ at: 2, evt: { type: 'added', count: 0, ids: [] } }),
  oldValue: null,
  storageArea: wBCAbsent.localStorage,
};
wBCAbsent.dispatchEvent(recoveryEvent);
check(received.length === before + 1, 'a valid event AFTER bad ones still fires the listener', 'received=' + received.length);

// ---- 7. When BroadcastChannel IS available, NO storage listener is wired --

console.log('cross-tab: BroadcastChannel present -> no storage listener');
const { sandbox: sBC, win: wBC, ls: lsBC } = makeSandbox({
  // BC constructor returns an object with a no-op postMessage. The point of
  // this test is to confirm the IIFE never installs a storage listener when
  // BC is present.
  BroadcastChannel: function () { return { postMessage: () => {}, close: () => {}, addEventListener: () => {}, removeEventListener: () => {} }; },
});
vm.runInContext(SRC_TEXT, sBC, { filename: 'media-store.client.js (BC present)' });
const MBC = sBC.window.SWR_MEDIA;
check(typeof MBC === 'object' && MBC !== null, 'module attaches when BroadcastChannel is available');
check(MBC.hasBroadcast === true, 'hasBroadcast === true on BC-capable browsers');
check(!wBC._storageListeners, 'no storage listener installed when BC is up', '_storageListeners present=' + !!wBC._storageListeners);

// ---- 8. When BroadcastChannel constructor throws (private mode), fall back -

console.log('cross-tab: BroadcastChannel constructor throws -> storage fallback installed');
const { sandbox: sThrow, win: wThrow } = makeSandbox({
  BroadcastChannel: function () { throw new Error('BroadcastChannel disabled in private mode'); },
});
vm.runInContext(SRC_TEXT, sThrow, { filename: 'media-store.client.js (BC throws)' });
const MThrow = sThrow.window.SWR_MEDIA;
check(typeof MThrow === 'object' && MThrow !== null, 'module attaches when BC constructor throws');
check(MThrow.hasBroadcast === false, 'hasBroadcast reflects construction failure');
check(
  Array.isArray(wThrow._storageListeners) && wThrow._storageListeners.length === 1,
  'storage fallback installed when BC throws'
);

console.log('');
if (failures === 0) {
  console.log('ALL GREEN - cross-tab broadcast storage-event fallback works under all three runtimes');
  process.exit(0);
} else {
  console.log(failures + ' FAILED');
  process.exit(1);
}
