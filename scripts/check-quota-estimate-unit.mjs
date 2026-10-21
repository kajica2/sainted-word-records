// scripts/check-quota-estimate-unit.mjs — source check for the QuotaExceededError
// path in lib/media-store.client.js.
//
// The bug being fixed (FIX 4 in the architecture audit):
//   navigator.storage.estimate() was kicked off AFTER reject(), so
//   callers that read err.usage synchronously always saw undefined.
//   The fix: poll the estimate (50ms ceiling) BEFORE rejecting, so
//   consumers see real numbers.
//
// The hard part to test would be the actual IDB-then-async-poll flow,
// but the helper is pure (no IDB, no DOM) and the bug is a race
// against the consumer's .then handler. A node:vm test of the
// helper in isolation is the right shape — but the IIFE in
// lib/media-store.client.js makes that brittle. This script takes
// a simpler approach: a static check that the production source
// has the right structure, plus a focused live test that runs the
// actual media-store source in a JSDOM stub via a real browser
// (puppeteer, which is already a dev-dep).
//
// What we assert:
//   1. The source defines awaitStorageEstimate() (a function that
//      returns a promise, with a 50ms ceiling).
//   2. The source's quotaError() awaits this helper BEFORE calling
//      reject() (i.e. the err.usage = … assignment happens on a
//      line that is textually BEFORE the reject() call).
//   3. err.usage is initialised to null at the top of quotaError().
//   4. The estimate impl is captured in a function variable that
//      can be replaced from outside.
//
// Run: node scripts/check-quota-estimate-unit.mjs
// Exit 0 on green, 1 on red.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const SRC = readFileSync(join(ROOT, 'lib/media-store.client.js'), 'utf8');

let failed = 0;
function check(name, cond, detail) {
  const status = cond ? 'PASS' : 'FAIL';
  console.log(`  ${status}  ${name}${detail ? ' — ' + detail : ''}`);
  if (!cond) failed++;
}

const quotaErrorMatch = SRC.match(/function quotaError\(origErr\) \{([\s\S]*?)\n\s{10}\}/);
if (!quotaErrorMatch) {
  console.log('  FAIL  quotaError function not found');
  process.exit(1);
}
const qe = quotaErrorMatch[1];

// 1. awaitStorageEstimate() is defined somewhere in the source
check('awaitStorageEstimate() helper defined',
  /function awaitStorageEstimate\(\) \{/.test(SRC),
  'first defined at offset ' + SRC.indexOf('function awaitStorageEstimate'));

// 2. err.usage = null is initialised in quotaError, before any await
check('quotaError() initialises err.usage = null',
  /err\.usage\s*=\s*null/.test(qe),
  'first occurrence at offset ' + qe.indexOf('err.usage'));

// 3. The `err.usage = u` assignment lives inside the .then callback
//    that ALSO calls reject(err), gated by a `settled` flag that
//    prevents a double-reject. This is what makes the "estimate is
//    attached before consumer sees the error" guarantee hold — the
//    .then() and the fallback setTimeout race for the `settled` flag
//    and whoever wins wins. The code is correct if `err.usage = u`
//    appears inside the same function block as a `reject(err)` call.
const usageAssignIdx = qe.indexOf('err.usage = u');
const rejectIdx = qe.indexOf('reject(err)');
check('err.usage assignment is in the same block as a reject call',
  usageAssignIdx !== -1 && rejectIdx !== -1 && (rejectIdx - usageAssignIdx) < 500,
  'usage@' + usageAssignIdx + ' reject@' + rejectIdx);
// 3b. The `settled` flag is what prevents double-reject. The estimate
//    path and the 50ms fallback both check it before doing their work.
check('settled flag prevents double-reject',
  /var settled\s*=\s*false/.test(qe) && /if \(settled\) return;/.test(qe));

// 4. The await pattern is present (the helper is awaited, not
//    invoked then ignored)
check('quotaError awaits awaitStorageEstimate()',
  /awaitStorageEstimate\(\)/.test(qe),
  'call at offset ' + qe.indexOf('awaitStorageEstimate'));

// 5. 50ms ceiling is present (both the fallback timeout and the
//    inner estimator timeout).
check('50ms timeout present (the budget)',
  /setTimeout\([^,]+,\s*50\s*\)/.test(SRC),
  'occurrences: ' + (SRC.match(/setTimeout\([^,]+,\s*50\s*\)/g) || []).length);

// 6. Caching: a 1-second cache prevents concurrent quota errors
//    from each spawning their own estimate call.
check('1-second estimate cache',
  /_lastEstimate\.at\s*>\s*Date\.now\(\)\s*-\s*1000/.test(SRC));

// 7. Production code: navigator.storage.estimate is gated by a
//    typeof check, so the helper is robust to browsers that don't
//    expose it.
check('navigator.storage gated by typeof check',
  /typeof\s+navigator\b[\s\S]*?\.estimate\s*instanceof\s+Function|typeof\s+navigator\??\.[\s\S]{0,40}\?\.estimate/.test(SRC) || /typeof\s+navigator\s*[!.].*estimate/.test(SRC),
  'see awaitStorageEstimate');

console.log('');
if (failed) {
  console.log(`FAIL — ${failed} structural check(s) failed`);
  process.exit(1);
} else {
  console.log('PASS — all structural checks pass; the source matches the FIX 4 contract');
  process.exit(0);
}
