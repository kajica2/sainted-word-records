#!/usr/bin/env node
// scripts/check-dpr-ratchet-unit.mjs - unit coverage for P1.6 (auto-DPR
// ratchet reset + 30-day time decay) in engine-render.client.js.
//
// Plan: docs/PLANS/architecture-audit-2026-10.md, section 1.6. The audit
// found that the auto-DPR step-down wrote localStorage.swr.render.dprAutoLow
// and only cleared it on a successful up-step. A user who throttled a year
// ago would still be pinned at the lowered DPR, even though their hardware,
// browser, and even software load have all changed.
//
// The fix has three halves:
//   1. Each down-step writes a paired timestamp (LS_DPR_AUTO_LOW_AT) so the
//      age can be measured later.
//   2. devicePixelRatio() auto-clears a stale (>30 day) entry on every read.
//   3. A "Reset DPR" UI control (wired through SWR_SETTINGS.resetDprAuto ->
//      SWR_RENDER.clearAutoDprLow) clears both keys on demand.
//
// This test exercises the half we can verify without a real canvas: the
// localStorage shape, the staleness predicate, and the public clear() API.
// The actual frame-cost path (autoAdjustDpr() -> down-step -> timestamp)
// is exercised structurally via source inspection - the IIFE does not
// fit a node:vm sandbox cleanly because it touches window.devicePixelRatio,
// performance.now, and a ResizeObserver at module load. The structural
// half catches a typo; the API half catches a logic bug.
//
// Run:  node scripts/check-dpr-ratchet-unit.mjs
// Exit: 0 = all assertions pass, 1 = any failure.

import vm from 'node:vm';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const ROOT = path.resolve(path.dirname(__filename), '..');
const RENDER_SRC = path.join(ROOT, 'engine-render.client.js');

let failures = 0;
function check(cond, msg, detail) {
  if (cond) console.log('  PASS', msg, detail ? '(' + detail + ')' : '');
  else { console.log('  FAIL', msg, detail ? '(' + detail + ')' : ''); failures++; }
}

// ---- Sandbox helpers ------------------------------------------------------

// Minimal browser shim for the engine-render client. The IIFE only reads
// `window.SWR_RENDER` (top-of-IIFE guard) and uses window.localStorage at
// module load (NOT - that comes later, inside fit/devicePixelRatio). The
// ResizeObserver at the bottom is OK to leave undefined; we ignore the
// trailing attach attempt with an exit handler.
function buildSandbox() {
  const data = Object.create(null);
  const ls = {
    getItem(k) { return Object.prototype.hasOwnProperty.call(data, k) ? data[k] : null; },
    setItem(k, v) { data[String(k)] = String(v); },
    removeItem(k) { delete data[String(k)]; },
    clear() { for (const k of Object.keys(data)) delete data[k]; },
  };
  const win = {
    localStorage: ls,
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => true,
    devicePixelRatio: 2,
  };
  const sandbox = {
    window: win,
    // The IIFE writes `localStorage.getItem(...)` (bare) inside the device-
    // PixelRatio and autoAdjustDpr paths - bare, NOT `window.localStorage`.
    // A browser exposes `localStorage` as a global alias on `window`; the
    // vm sandbox has no such alias, so we declare one explicitly.
    localStorage: ls,
    console: { warn: () => {}, log: () => {}, error: () => {} },
    setTimeout: () => 1,
    clearTimeout: () => {},
    requestAnimationFrame: () => 1,
    performance: { now: () => Date.now() },
    Date, JSON, Promise, Object, Array, Map, Set, Number, Boolean, Math, Error,
    parseInt, parseFloat, isFinite, isNaN,
    ResizeObserver: undefined,
    // The IIFE registers a DOMContentLoaded listener at the very bottom of
    // engine-render.client.js to defer a ResizeObserver attach. Provide a
    // bare document shim so the IIFE does not throw ReferenceError on load.
    document: {
      readyState: 'complete',
      addEventListener: () => {},
      removeEventListener: () => {},
    },
  };
  vm.createContext(sandbox);
  return { sandbox, win, ls, data };
}

// ---- 1. Structural / static source inspection ----------------------------
//
// These catch a typo in the IIFE without needing to drive a frame. The
// changes are localized to the devicePixelRatio() read path and the
// down-step, so the regex set is small and exact.

console.log('dpr-ratchet: source structure (static)');
const SRC = fs.readFileSync(RENDER_SRC, 'utf8');

check(
  /LS_DPR_AUTO_LOW_AT\s*=\s*['"]swr\.render\.dprAutoLowAt['"]/.test(SRC),
  'paired-timestamp LS key is declared'
);
check(
  /DPR_AUTO_LOW_TTL_MS\s*=\s*30\s*\*\s*24\s*\*\s*60\s*\*\s*60\s*\*\s*1000/.test(SRC),
  'the staleness threshold is 30 days in ms'
);
check(
  /function\s+isAutoDprLowStale\b/.test(SRC),
  'isAutoDprLowStale() helper is defined'
);
check(
  /function\s+clearAutoDprLow\b/.test(SRC),
  'clearAutoDprLow() helper is defined'
);
// The down-step must write BOTH the value and the timestamp.
check(
  /localStorage\.setItem\(LS_DPR_AUTO_LOW\s*,\s*String\(next\)\)/.test(SRC),
  'down-step still writes the value to LS_DPR_AUTO_LOW'
);
check(
  /localStorage\.setItem\(LS_DPR_AUTO_LOW_AT\s*,\s*String\(Date\.now\(\)\)\)/.test(SRC),
  'down-step now writes a timestamp to LS_DPR_AUTO_LOW_AT'
);
// The read path must auto-clear a stale entry.
check(
  /isAutoDprLowStale\(\)\s*\)?\s*clearAutoDprLow\(/.test(SRC),
  'devicePixelRatio() auto-clears when the bound is stale'
);
// setAutoDpr(false) must clean both keys too (a user disabling autoDPR
// expects the bound to actually go away, not stay behind with a timestamp).
check(
  /function\s+setAutoDpr\b[\s\S]{0,400}?clearAutoDprLow\(\)/.test(SRC),
  'setAutoDpr(false) calls clearAutoDprLow() to wipe both keys'
);
// The up-step must also clear the timestamp so a future down-step starts
// fresh.
check(
  /if\s*\(\s*next\s*>=\s*target\s*\)\s*\{[\s\S]*?clearAutoDprLow\(/.test(SRC),
  'up-step to the natural cap also clears (via clearAutoDprLow, which removes the timestamp)'
);
// Public API exposed.
check(
  /isAutoDprLowStale,\s*clearAutoDprLow/.test(SRC),
  'SWR_RENDER exports isAutoDprLowStale and clearAutoDprLow'
);

// ---- 2. Behavioural: load the module in a vm sandbox ----------------------

// Trickier than the cross-tab test: engine-render.client.js uses
// `const`/`let` (not just `var`), reads window.devicePixelRatio, and ends
// with a ResizeObserver attach that we have to handle. The IIFE itself is
// self-contained; we run it with minimal stubs and read the global it
// produces.

console.log('dpr-ratchet: module load + shape');
const { sandbox, win, ls, data } = buildSandbox();
vm.runInContext(fs.readFileSync(RENDER_SRC, 'utf8'), sandbox, { filename: 'engine-render.client.js' });
const R = sandbox.window.SWR_RENDER;
check(typeof R === 'object' && R !== null, 'window.SWR_RENDER attached');
check(typeof R.isAutoDprLowStale === 'function', 'SWR_RENDER.isAutoDprLowStale exported');
check(typeof R.clearAutoDprLow === 'function', 'SWR_RENDER.clearAutoDprLow exported');
check(typeof R.devicePixelRatio === 'function', 'SWR_RENDER.devicePixelRatio exported');
check(typeof R.setAutoDpr === 'function', 'SWR_RENDER.setAutoDpr exported');

// ---- 3. The timestamp is the source of truth for "is stale?" -------------

console.log('dpr-ratchet: isAutoDprLowStale()');

R.clearAutoDprLow();
ls.clear();
// No timestamp at all -> not stale (no entry, nothing to clear).
check(R.isAutoDprLowStale() === false, 'no entry -> not stale');

data['swr.render.dprAutoLowAt'] = String(Date.now() - 1000);
check(R.isAutoDprLowStale() === false, '1 second old -> not stale', '(should be < 30 day TTL)');

data['swr.render.dprAutoLowAt'] = String(Date.now() - (29 * 24 * 60 * 60 * 1000)); // 29 days
check(R.isAutoDprLowStale() === false, '29 days old -> not stale');

data['swr.render.dprAutoLowAt'] = String(Date.now() - (31 * 24 * 60 * 60 * 1000)); // 31 days
check(R.isAutoDprLowStale() === true, '31 days old -> STALE');

data['swr.render.dprAutoLowAt'] = String(Date.now() - (60 * 24 * 60 * 60 * 1000)); // 60 days
check(R.isAutoDprLowStale() === true, '60 days old -> STALE');

// A garbage timestamp must NOT report stale (so a stray localStorage entry
// from a different feature does not silently wipe the real auto-bound).
data['swr.render.dprAutoLowAt'] = 'not a number';
check(R.isAutoDprLowStale() === false, 'non-numeric timestamp -> not stale (defensive)');

data['swr.render.dprAutoLowAt'] = '0';
check(R.isAutoDprLowStale() === false, 'zero timestamp -> not stale (defensive)');

// ---- 4. devicePixelRatio() auto-clears stale; honours fresh --------------

console.log('dpr-ratchet: devicePixelRatio() honours fresh, auto-clears stale');

ls.clear();
R.clearAutoDprLow();

// Sanity: no entries -> natural DPR (= window.devicePixelRatio, 2 in the
// sandbox).
const dprNatural = R.devicePixelRatio();
check(dprNatural === 2, 'fresh state returns the natural DPR (2)', 'got=' + dprNatural);

// Fresh bound: 5 minutes ago, value = 1.5. Should pin DPR at 1.5.
data['swr.render.dprAutoLow'] = '1.5';
data['swr.render.dprAutoLowAt'] = String(Date.now() - 5 * 60 * 1000);
check(R.devicePixelRatio() === 1.5, 'fresh 1.5-bound pins DPR at 1.5', 'got=' + R.devicePixelRatio());
// Stale bound: 35 days ago, same value. Should NOT pin.
data['swr.render.dprAutoLowAt'] = String(Date.now() - 35 * 24 * 60 * 60 * 1000);
check(R.devicePixelRatio() === 2, 'stale 1.5-bound auto-clears and falls back to natural', 'got=' + R.devicePixelRatio());
check(
  data['swr.render.dprAutoLow'] === undefined && data['swr.render.dprAutoLowAt'] === undefined,
  'both keys were removed by the auto-clear'
);

// Fresh bound again to confirm the path recovers (not just stays cleared).
data['swr.render.dprAutoLow'] = '1.25';
data['swr.render.dprAutoLowAt'] = String(Date.now());
check(R.devicePixelRatio() === 1.25, 'after the auto-clear, a NEW fresh entry still pins DPR');

// ---- 5. clearAutoDprLow() wipes both keys, idempotent ---------------------

console.log('dpr-ratchet: clearAutoDprLow() is the user-controlled reset');

ls.clear();
R.clearAutoDprLow();
check(
  data['swr.render.dprAutoLow'] === undefined && data['swr.render.dprAutoLowAt'] === undefined,
  'clear is a no-op when nothing was set (no errors)'
);

data['swr.render.dprAutoLow'] = '1.75';
data['swr.render.dprAutoLowAt'] = String(Date.now());
R.clearAutoDprLow();
check(
  data['swr.render.dprAutoLow'] === undefined,
  'clear removes the value key'
);
check(
  data['swr.render.dprAutoLowAt'] === undefined,
  'clear ALSO removes the paired timestamp (so a stale-entry auto-clear cannot resurrect a dead entry)'
);
// Idempotent on already-cleared state.
R.clearAutoDprLow();
check(data['swr.render.dprAutoLow'] === undefined && data['swr.render.dprAutoLowAt'] === undefined, 'clear is idempotent');

// ---- 6. setAutoDpr(false) wipes both keys too -----------------------------

console.log('dpr-ratchet: setAutoDpr(false) wipes the ratchet + its timestamp');

ls.clear();
data['swr.render.dprAutoLow'] = '1.5';
data['swr.render.dprAutoLowAt'] = String(Date.now());
R.setAutoDpr(false);
check(
  data['swr.render.dprAutoLow'] === undefined && data['swr.render.dprAutoLowAt'] === undefined,
  'disabling autoDpr clears both keys (was previously only the value)'
);

console.log('');
if (failures === 0) {
  console.log('ALL GREEN - DPR ratchet has a working reset (UI + time-decay)');
  process.exit(0);
} else {
  console.log(failures + ' FAILED');
  process.exit(1);
}
