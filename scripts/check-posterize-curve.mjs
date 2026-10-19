// scripts/check-posterize-curve.mjs — source check for the posterize
// shader curve in versions-presets.js.
//
// Bug: the original `mix(256.0, 3.0, u_posterize)` was perceptually
// flat — at slider=0.5 the shader still left 130 levels on screen,
// which is visually indistinguishable from the un-posterized source. The
// engine slider's full travel range covered only the top ~15% of the
// visible effect.
//
// Fix: use a geometric curve `exp(mix(log(256), log(3), t))` so the
// slider maps uniformly across the visible range — t=0.5 lands at ~28
// levels, t=0.8 at ~7, t=1.0 at 3.
//
// This script asserts the curve shape is geometric (not linear) and
// that the comment explains why.

import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC = readFileSync(join(__dirname, '..', 'versions-presets.js'), 'utf8');

let failed = 0;
function check(name, cond, detail) {
  const status = cond ? 'PASS' : 'FAIL';
  console.log(`  ${status}  ${name}${detail ? ' — ' + detail : ''}`);
  if (!cond) failed++;
}

// 1. The old linear pattern must be gone.
check('linear mix(256, 3, t) pattern is removed',
  !/mix\s*\(\s*256\.0\s*,\s*3\.0\s*,\s*u_posterize\s*\)/.test(SRC),
  'old linear pattern is still present in versions-presets.js');

// 2. The new geometric pattern is present.
check('geometric exp(mix(log, log, t)) pattern is present',
  /exp\s*\(\s*mix\s*\(\s*log\s*\(\s*256\.0\s*\)\s*,\s*log\s*\(\s*3\.0\s*\)\s*,\s*u_posterize\s*\)\s*\)/.test(SRC),
  'geometric curve is not present — the slider will still feel flat');

// 3. A comment explains why the curve is geometric.
check('comment explains the geometric-curve choice',
  /perceptually flat|geometric curve|256.*3.*slider|slider.*256/i.test(SRC),
  'no comment in versions-presets.js explains why the curve is geometric');

// 4. The slider contract is preserved: u_posterize is still 0..1.
check('u_posterize is bound to a uniform location',
  /gl\.uniform1f\(\s*u\.posterize\b/.test(SRC) ||
  /getUniformLocation\([^)]*['"]u_posterize['"]\)/.test(SRC),
  'u_posterize is not bound to a uniform location in versions-presets.js');

// 5. The posterize branch is guarded with a threshold (not always-on)
check('posterize is gated by an if (u_posterize > 0.001) guard',
  /if\s*\(\s*u_posterize\s*>\s*0\.001\s*\)/.test(SRC),
  'posterize branch is not gated by the > 0.001 threshold');

console.log('');
if (failed) {
  console.log(`FAIL — ${failed} check(s) failed`);
  process.exit(1);
} else {
  console.log('PASS — posterize curve is geometric and commented');
  process.exit(0);
}
