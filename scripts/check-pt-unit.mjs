// scripts/check-pt-unit.mjs — unit coverage for the PT license ledger
// (pt.client.js).
//
// node:vm pattern from check-invite-unlock-unit.mjs / check-last-mix-unit.mjs.
// Loads pt.client.js into a sandboxed window with a minimal localStorage
// stub and a CustomEvent/dispatchEvent shim — no Audio, no engine deps.
// Storage key is internal (`swr.license`); tests drive state exclusively
// through the SWR_PT API, so the stub only needs get/set/remove.
//
// Asserts:
//  - activate('swr-solo-...') seeds credits 50, videoSlots 10, videosRegistered 0.
//  - top-up (a second key for the same tier) adds credits AND videoSlots
//    (50→100 / 150→300 / 10→20 / 30→60) while preserving videosRegistered.
//  - registerVideos accepts 10/30/50 only; rejects 5 and 100 with
//    'invalid batch'; rejects every call when no license is active.
//  - quota wall: solo (10 slots) → register 10 ok, then 10 more → 'no slots
//    left' with remaining 0; band (30) → 10 leaves 20, then 30 is insufficient.
//  - getVideoSlots / getVideosRegistered / REGISTER_BATCHES are exposed and
//    reflect the ledger.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import vm from 'node:vm';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ptSrc = readFileSync(path.join(__dirname, '..', 'pt.client.js'), 'utf8');

let failures = 0;
function check(name, fn) {
  try {
    fn();
    console.log('  ✓', name);
  } catch (e) {
    failures++;
    console.log('  ✗', name, '\n     ', e.message);
  }
}
function assert(cond, msg) {
  if (!cond) throw new Error(msg || 'assertion failed');
}
function eq(actual, expected, label) {
  const a = JSON.stringify(actual);
  const b = JSON.stringify(expected);
  if (a !== b) throw new Error(`${label}: expected ${b}, got ${a}`);
}

// ---- sandbox: pt.client.js needs localStorage + window.dispatchEvent(CustomEvent) ----
function makeSandbox() {
  const storage = {};
  const localStorage = {
    getItem(k) { return Object.prototype.hasOwnProperty.call(storage, k) ? storage[k] : null; },
    setItem(k, v) { storage[k] = String(v); },
    removeItem(k) { delete storage[k]; },
  };
  const sb = {
    console: { log: () => {}, warn: () => {}, error: () => {} },
    Math, Object, Array, JSON, Date, Number, String, Promise, Map, Set, Symbol, WeakMap, WeakSet, Proxy, Reflect,
    localStorage,
    CustomEvent: function CustomEvent(type, init) { return { type, ...(init || {}) }; },
    dispatchEvent() { return true; },
  };
  sb.window = sb;
  vm.createContext(sb);
  return { sb, storage };
}

function loadModule(sb, src) {
  vm.runInContext(src, sb);
}

// ---- tests ----
console.log('pt unit:');

check('activate swr-solo seeds credits 50, videoSlots 10, videosRegistered 0', () => {
  const { sb } = makeSandbox();
  loadModule(sb, ptSrc);
  const res = sb.window.SWR_PT.activate('swr-solo-AAAAAAAA');
  assert(!res.error, 'activation should succeed, got: ' + (res.error || ''));
  eq(res.license.credits, 50, 'credits');
  eq(res.license.creditsTotal, 50, 'creditsTotal');
  eq(res.license.videoSlots, 10, 'videoSlots');
  eq(res.license.videosRegistered, 0, 'videosRegistered');
});

check('activate swr-band seeds credits 150, videoSlots 30, videosRegistered 0', () => {
  const { sb } = makeSandbox();
  loadModule(sb, ptSrc);
  const res = sb.window.SWR_PT.activate('swr-band-B1B2B3B4');
  assert(!res.error, 'activation should succeed');
  eq(res.license.credits, 150, 'credits');
  eq(res.license.videoSlots, 30, 'videoSlots');
  eq(res.license.videosRegistered, 0, 'videosRegistered');
});

check('top-up adds credits AND videoSlots, preserves videosRegistered', () => {
  const { sb } = makeSandbox();
  loadModule(sb, ptSrc);
  const pt = sb.window.SWR_PT;
  // band top-up: 150→300 credits, 30→60 slots
  pt.activate('swr-band-B1B2B3B4');
  pt.registerVideos(10); // use some quota first
  const res = pt.activate('swr-band-C1C2C3C4');
  assert(!res.error, 'top-up should succeed');
  eq(res.license.credits, 300, 'credits after band top-up');
  eq(res.license.creditsTotal, 300, 'creditsTotal after band top-up');
  eq(res.license.videoSlots, 60, 'videoSlots after band top-up');
  eq(res.license.videosRegistered, 10, 'videosRegistered preserved');
  // solo top-up: 50→100 credits, 10→20 slots
  const solo = pt.activate('swr-solo-AAAAAAAA');
  eq(solo.license.credits, 50, 'fresh solo credits');
  const solo2 = pt.activate('swr-solo-BBBBBBBB');
  eq(solo2.license.credits, 100, 'solo credits after top-up');
  eq(solo2.license.videoSlots, 20, 'solo videoSlots after top-up');
  eq(solo2.license.videosRegistered, 0, 'fresh solo starts at 0 registered');
});

check('registerVideos accepts 10/30/50, rejects 5 and 100', () => {
  const { sb } = makeSandbox();
  loadModule(sb, ptSrc);
  const pt = sb.window.SWR_PT;
  // Each accepted batch gets its own license so a full row fits the quota.
  pt.activate('swr-solo-AAAAAAAA');  // 10 slots
  const r10 = pt.registerVideos(10);
  assert(r10.ok, 'batch 10 should be accepted: ' + (r10.error || ''));
  pt.activate('swr-band-B1B2B3B4');  // 30 slots
  const r30 = pt.registerVideos(30);
  assert(r30.ok, 'batch 30 should be accepted: ' + (r30.error || ''));
  pt.activate('swr-label-L1L2L3L4');  // 50 slots
  const r50 = pt.registerVideos(50);
  assert(r50.ok, 'batch 50 should be accepted: ' + (r50.error || ''));
  for (const n of [5, 100]) {
    const res = pt.registerVideos(n);
    assert(!res.ok, `batch ${n} should be rejected`);
    assert(res.error.indexOf('invalid batch') === 0, `batch ${n} error should be invalid batch, got: ` + res.error);
  }
});

check('registerVideos rejects with \'no license\' when none active', () => {
  const { sb } = makeSandbox();
  loadModule(sb, ptSrc);
  const res = sb.window.SWR_PT.registerVideos(10);
  assert(!res.ok, 'should fail without a license');
  assert(res.error === 'no license', 'error should be no license, got: ' + res.error);
});

check('quota wall: solo (10 slots) — 10 ok, second 10 → no slots left, remaining 0', () => {
  const { sb } = makeSandbox();
  loadModule(sb, ptSrc);
  const pt = sb.window.SWR_PT;
  pt.activate('swr-solo-AAAAAAAA');
  const first = pt.registerVideos(10);
  assert(first.ok, 'first 10 should succeed: ' + (first.error || ''));
  eq(first.remaining, 0, 'remaining after first');
  eq(first.total, 10, 'total');
  const second = pt.registerVideos(10);
  assert(!second.ok, 'second 10 should be rejected');
  assert(second.error === 'no slots left', 'error should be no slots left, got: ' + second.error);
  eq(second.remaining, 0, 'remaining 0 at the wall');
  eq(pt.getVideosRegistered(), 10, 'ledger stays at 10');
});

check('quota wall: band (30 slots) — 10 leaves 20, then 30 is insufficient', () => {
  const { sb } = makeSandbox();
  loadModule(sb, ptSrc);
  const pt = sb.window.SWR_PT;
  pt.activate('swr-band-B1B2B3B4');
  const res10 = pt.registerVideos(10);
  assert(res10.ok, 'first 10 should succeed: ' + (res10.error || ''));
  eq(res10.remaining, 20, '20 left');
  const res30 = pt.registerVideos(30);
  assert(!res30.ok, '30 over quota should be rejected');
  assert(res30.error === 'no slots left', 'error should be no slots left, got: ' + res30.error);
  eq(res30.remaining, 20, 'remaining unchanged at 20');
  eq(pt.getVideosRegistered(), 10, 'ledger unchanged');
});

check('getVideoSlots / getVideosRegistered / REGISTER_BATCHES exposed', () => {
  const { sb } = makeSandbox();
  loadModule(sb, ptSrc);
  const pt = sb.window.SWR_PT;
  eq(pt.REGISTER_BATCHES, [10, 30, 50], 'REGISTER_BATCHES');
  assert(typeof pt.registerVideos === 'function', 'registerVideos is a function');
  assert(typeof pt.getVideoSlots === 'function', 'getVideoSlots is a function');
  assert(typeof pt.getVideosRegistered === 'function', 'getVideosRegistered is a function');
  eq(pt.getVideoSlots(), 0, 'slots before activation');
  eq(pt.getVideosRegistered(), 0, 'registered before activation');
  pt.activate('swr-solo-AAAAAAAA');
  eq(pt.getVideoSlots(), 10, 'slots after activation');
  eq(pt.getVideosRegistered(), 0, 'registered after activation');
  pt.registerVideos(10);
  eq(pt.getVideosRegistered(), 10, 'registered after registering');
});

const failedCount = failures;
console.log('\n' + (failedCount ? `pt unit: ${failedCount} FAILED` : 'pt unit: all assertions passed'));
process.exit(failedCount ? 1 : 0);