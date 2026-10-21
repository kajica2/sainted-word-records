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

// ---- server-side verification (P0.3) ----
//
// The checks above run in a sandbox with no fetch at all, which is exactly
// the "offline, no network capability" case: boot verify must no-op and leave
// the local ledger alone. The checks below add a controllable fetch so the
// verify/cache/lock paths can be driven deterministically.
function makeNetSandbox(fetchImpl) {
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
    fetch: fetchImpl,
    CustomEvent: function CustomEvent(type, init) { return { type, ...(init || {}) }; },
    dispatchEvent() { return true; },
  };
  sb.window = sb;
  vm.createContext(sb);
  return { sb, storage };
}

// A fetch that answers with one canned body and counts its calls.
function cannedFetch(body, { status = 200, throwErr = false } = {}) {
  const calls = [];
  const fn = (url, init) => {
    calls.push({ url, init });
    if (throwErr) return Promise.reject(new TypeError('Failed to fetch'));
    return Promise.resolve({ status, json: () => Promise.resolve(body) });
  };
  fn.calls = calls;
  return fn;
}

// Async twin of check(): the verify paths resolve promises.
let asyncFailures = 0;
async function acheck(name, fn) {
  try {
    await fn();
    console.log('  ✓', name);
  } catch (e) {
    asyncFailures++;
    console.log('  ✗', name, '\n     ', e.message);
  }
}

// Read the verify cache straight out of a sandbox's storage.
function verifyCacheOf(sb) {
  return sb.localStorage.getItem('swr.license.cache');
}

console.log('pt verify (client):');

await acheck('no fetch in the sandbox: boot verify no-ops, license untouched', async () => {
  const { sb, storage } = makeNetSandbox(undefined);
  loadModule(sb, ptSrc);
  const pt = sb.window.SWR_PT;
  pt.activate('swr-band-B1B2B3B4');
  const res = await pt.verifyOnBoot();
  eq(res.reason, 'skipped', 'boot verify is skipped without fetch');
  eq(pt.load().key, 'swr-band-b1b2b3b4', 'the stored license survives');
  eq(pt.isVerified(), false, 'nothing is unlocked without a server answer');
  eq(storage['swr.license.cache'], undefined, 'no cache entry is written');
});

await acheck('server valid:true unlocks and writes swr.license.cache', async () => {
  const fetchImpl = cannedFetch({ valid: true, tier: 'band', tierName: 'PT Band', creditsRemaining: 150, slotCount: 30 });
  const { sb, storage } = makeNetSandbox(fetchImpl);
  loadModule(sb, ptSrc);
  const pt = sb.window.SWR_PT;
  pt.activate('swr-band-B1B2B3B4');
  const res = await pt.verifyLicense('swr-band-B1B2B3B4');
  eq(res.ok, true, 'ok');
  eq(pt.isVerified(), true, 'unlocked');
  eq(fetchImpl.calls.length, 1, 'exactly one round-trip');
  eq(fetchImpl.calls[0].url, '/api/license/verify', 'posts to the verify route');
  eq(fetchImpl.calls[0].init.method, 'POST', 'uses POST so the key never hits a proxy log');
  eq(JSON.parse(fetchImpl.calls[0].init.body).code, 'swr-band-B1B2B3B4',
    'the posted code is the canonical form, identical to the cached key');
  const cache = JSON.parse(storage['swr.license.cache']);
  eq(cache.valid, true, 'cache valid');
  eq(cache.key, 'swr-band-B1B2B3B4', 'cache is keyed on the canonical form');
  eq(typeof cache.checkedAt, 'number', 'cache is timestamped');
  eq(pt.load().verifiedAt > 0, true, 'the license records when it was confirmed');
});

await acheck('a fresh cache hit answers without a second round-trip', async () => {
  const fetchImpl = cannedFetch({ valid: true, tier: 'band', tierName: 'PT Band', creditsRemaining: 150, slotCount: 30 });
  const { sb, storage } = makeNetSandbox(fetchImpl);
  loadModule(sb, ptSrc);
  const pt = sb.window.SWR_PT;
  pt.activate('swr-band-B1B2B3B4');
  await pt.verifyLicense('swr-band-B1B2B3B4');
  eq(fetchImpl.calls.length, 1, 'first verify hit the network');
  // Age the cache to 4 minutes: still inside the 5 minute TTL.
  const cache = JSON.parse(storage['swr.license.cache']);
  cache.checkedAt = Date.now() - (4 * 60 * 1000);
  storage['swr.license.cache'] = JSON.stringify(cache);
  const res = await pt.verifyLicense('swr-band-B1B2B3B4');
  eq(res.fromCache, true, 'served from cache');
  eq(res.ok, true, 'still unlocked');
  eq(fetchImpl.calls.length, 1, 'no second round-trip inside the TTL');
});

await acheck('a stale cache falls through to the network', async () => {
  const fetchImpl = cannedFetch({ valid: true, tier: 'band', tierName: 'PT Band', creditsRemaining: 150, slotCount: 30 });
  const { sb, storage } = makeNetSandbox(fetchImpl);
  loadModule(sb, ptSrc);
  const pt = sb.window.SWR_PT;
  pt.activate('swr-band-B1B2B3B4');
  await pt.verifyLicense('swr-band-B1B2B3B4');
  const cache = JSON.parse(storage['swr.license.cache']);
  cache.checkedAt = Date.now() - (6 * 60 * 1000); // past the 5 minute TTL
  storage['swr.license.cache'] = JSON.stringify(cache);
  const res = await pt.verifyLicense('swr-band-B1B2B3B4');
  eq(fetchImpl.calls.length, 2, 'the stale entry is refreshed from the server');
  eq(res.fromCache, undefined, 'not served from cache');
});

await acheck('server valid:false re-locks and drops the forged license', async () => {
  const fetchImpl = cannedFetch({ valid: false, reason: 'unknown_code' });
  const { sb } = makeNetSandbox(fetchImpl);
  loadModule(sb, ptSrc);
  const pt = sb.window.SWR_PT;
  pt.activate('swr-band-B1B2B3B4');
  const res = await pt.verifyLicense('swr-band-B1B2B3B4');
  eq(res.ok, false, 'not ok');
  eq(res.reason, 'unknown_code', 'the server reason is surfaced');
  eq(pt.isVerified(), false, 'unlocked is false');
  eq(pt.load(), null, 'the localStorage license is removed, not just ignored');
  eq(pt.isActive(), false, 'the forgeable local ledger no longer claims a license');
});

await acheck('server reason:expired is preserved', async () => {
  const fetchImpl = cannedFetch({ valid: false, reason: 'expired' });
  const { sb } = makeNetSandbox(fetchImpl);
  loadModule(sb, ptSrc);
  const pt = sb.window.SWR_PT;
  pt.activate('swr-solo-AAAAAAAA');
  const res = await pt.verifyLicense('swr-solo-AAAAAAAA');
  eq(res.reason, 'expired', 'expired is distinguishable from unknown');
  eq(pt.isVerified(), false, 'unlocked is false');
});

await acheck('network failure falls back to a recent successful verify', async () => {
  const ok = cannedFetch({ valid: true, tier: 'band', tierName: 'PT Band', creditsRemaining: 150, slotCount: 30 });
  const first = makeNetSandbox(ok);
  loadModule(first.sb, ptSrc);
  first.sb.window.SWR_PT.activate('swr-band-B1B2B3B4');
  await first.sb.window.SWR_PT.verifyLicense('swr-band-B1B2B3B4');
  eq(JSON.parse(first.storage['swr.license.cache']).valid, true, 'a good answer was cached');

  // Same storage, network now dead. Age the cache past the 5 minute TTL but
  // keep it inside the stale grace window, so this exercises the fallback
  // rather than the fresh-cache short-circuit.
  const dead = cannedFetch(null, { throwErr: true });
  const { sb } = makeNetSandbox(dead);
  for (const [k, v] of Object.entries(first.storage)) sb.localStorage.setItem(k, v);
  const aged = JSON.parse(sb.localStorage.getItem('swr.license.cache'));
  aged.checkedAt = Date.now() - (30 * 60 * 1000); // 30 min: stale but recent
  sb.localStorage.setItem('swr.license.cache', JSON.stringify(aged));
  loadModule(sb, ptSrc);
  const pt = sb.window.SWR_PT;
  const res = await pt.verifyLicense('swr-band-B1B2B3B4');
  eq(res.ok, true, 'the recent successful answer is honoured offline');
  eq(res.reason, 'stale_cache', 'and it is reported as a stale cache hit');
  eq(dead.calls.length, 1, 'the dead endpoint was tried first, then the cache answered');
  eq(pt.isVerified(), true, 'a paid customer offline keeps their tier');
  eq(pt.load().key, 'swr-band-b1b2b3b4', 'the license is not confiscated by an outage');
});

await acheck('network failure with no cache locks rather than guessing', async () => {
  const dead = cannedFetch(null, { throwErr: true });
  const { sb } = makeNetSandbox(dead);
  loadModule(sb, ptSrc);
  const pt = sb.window.SWR_PT;
  pt.activate('swr-band-B1B2B3B4');
  const res = await pt.verifyLicense('swr-band-B1B2B3B4');
  eq(res.ok, false, 'no verdict, no unlock');
  eq(res.reason, 'unverified', 'reason is unverified');
  eq(pt.isVerified(), false, 'unlocked stays false');
});

await acheck('a non-200 answer is not read as invalid', async () => {
  // e.g. the route has not deployed to this origin yet. Confiscating a paid
  // license over a 404 would be the worst possible failure mode.
  const fetchImpl = cannedFetch({ valid: false, reason: 'unknown_code' }, { status: 404 });
  const { sb } = makeNetSandbox(fetchImpl);
  loadModule(sb, ptSrc);
  const pt = sb.window.SWR_PT;
  pt.activate('swr-band-B1B2B3B4');
  const res = await pt.verifyLicense('swr-band-B1B2B3B4');
  eq(res.reason, 'unverified', 'a 404 is inconclusive, not a rejection');
  eq(pt.isVerified(), false, 'unlocked stays false');
  eq(pt.load() !== null, true, 'the license record is left in place to retry later');
});

await acheck('the server credit grant is reported but never written back', async () => {
  // There is no server-side credit ledger: creditsRemaining is the static
  // tier grant. Applying it after a local debit would refund the debit on
  // every verify, i.e. infinite free credits. The route still returns it.
  const fetchImpl = cannedFetch({ valid: true, tier: 'band', tierName: 'PT Band', creditsRemaining: 150, slotCount: 30 });
  const { sb } = makeNetSandbox(fetchImpl);
  loadModule(sb, ptSrc);
  const pt = sb.window.SWR_PT;
  pt.activate('swr-band-B1B2B3B4');
  pt.consumeForRender(120, '1080p'); // 2 minutes at 1 credit/min leaves 148
  eq(pt.load().credits, 148, 'the local ledger was debited');
  await pt.verifyLicense('swr-band-B1B2B3B4');
  eq(pt.load().credits, 148, 'the debit survives the verify');
  eq(pt.load().creditsTotal, 150, 'creditsTotal is untouched');
  eq(pt.load().videoSlots, 30, 'slotCount from the server IS applied (it is a quota)');
  const cache = JSON.parse(verifyCacheOf(sb));
  eq(cache.creditsRemaining, 150, 'the server value is still recorded in the cache for diagnostics');
});

await acheck('an oversized server slotCount corrects the local quota', async () => {
  const fetchImpl = cannedFetch({ valid: true, tier: 'band', tierName: 'PT Band', creditsRemaining: 150, slotCount: 60 });
  const { sb } = makeNetSandbox(fetchImpl);
  loadModule(sb, ptSrc);
  const pt = sb.window.SWR_PT;
  pt.activate('swr-band-B1B2B3B4');
  await pt.verifyLicense('swr-band-B1B2B3B4');
  eq(pt.load().videoSlots, 60, 'slotCount lifted');
});

await acheck('CACHE_TTL_MS is 5 minutes and is exposed', async () => {
  const { sb } = makeNetSandbox(cannedFetch({ valid: true, tier: 'solo', creditsRemaining: 50, slotCount: 10 }));
  loadModule(sb, ptSrc);
  eq(sb.window.SWR_PT.CACHE_TTL_MS, 5 * 60 * 1000, 'CACHE_TTL_MS');
  eq(sb.window.SWR_PT.VERIFY_URL, '/api/license/verify', 'VERIFY_URL');
});

const failedCount = failures + asyncFailures;
console.log('\n' + (failedCount ? `pt unit: ${failedCount} FAILED` : 'pt unit: all assertions passed'));
process.exit(failedCount ? 1 : 0);