#!/usr/bin/env node
// scripts/check-with-dist-unit.mjs
//
// Node-only unit tests for scripts/with-dist.mjs.
//
// Strategy:
//   Each test case writes a copy of with-dist.mjs into a tmp dir, then
//   imports it (the import URL uses a unique ?t= cache-buster per case
//   so each gets its own module instance). A fake `npm` shell script is
//   placed in a sibling bin dir and exposed via the PATH injected
//   through with-dist.mjs's `opts.env` parameter. The fake receives
//   the project's CWD via SWD_DIST_CWD (set by ensureDist before
//   execFileSync), so it can deterministically create / fail to create
//   dist/index.html relative to a known location.
//
// Pass criteria: every assertion succeeds, exit 0, last line
// `WITH DIST UNIT: ALL GREEN (N tests)`.

import { strict as assert } from 'node:assert';
import { mkdtempSync, writeFileSync, mkdirSync, existsSync, rmSync,
         chmodSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';

// Each test case creates its own scratch dir at $tmpRoot/caseN/. The
// helper module's ROOT is computed from its own __dirname at import
// time — so to make hasDist() see a fake dist/ at the right location,
// we write with-dist.mjs into caseN/with-dist.mjs AND create the fake
// dist/ at caseN/dist/. The module's `..` resolves to caseN/.
//
// We also drop a fake-bin/ directory with a fake `npm` shell script
// next to it. The fake receives SWD_DIST_CWD via env (set by
// ensureDist before execFileSync) and acts on the right path.

const tmpRoot = mkdtempSync(join(tmpdir(), 'with-dist-test-'));

const results = [];
function ok(name) { results.push('  ✓ ' + name); }
function bad(name, got) { results.push('  ✗ ' + name + ' (got: ' + got + ')'); process.exitCode = 1; }

// Set up the shared fake-bin dir with three npm variants.
function setupFakeNpm(dir) {
  const binDir = join(dir, 'fake-bin');
  mkdirSync(binDir, { recursive: true });

  // create-dist: mkdir dist + write engine.html + log invocation
  writeFileSync(join(binDir, 'npm'), `#!/bin/sh
echo "fake-npm: $@" >> "${join(dir, 'npm.log')}"
mkdir -p "$SWD_DIST_CWD/dist"
echo "<html></html>" > "$SWD_DIST_CWD/dist/engine.html"
exit 0
`);
  // exit-1: simulate npm build failure
  writeFileSync(join(binDir, 'npm-fail'), `#!/bin/sh
echo "fake-npm-fail: $@" >> "${join(dir, 'npm.log')}"
exit 1
`);
  // no-op: succeed but don't create dist/
  writeFileSync(join(binDir, 'npm-noop'), `#!/bin/sh
echo "fake-npm-noop: $@" >> "${join(dir, 'npm.log')}"
exit 0
`);

  // chmod +x
  chmodSync(join(binDir, 'npm'), 0o755);
  chmodSync(join(binDir, 'npm-fail'), 0o755);
  chmodSync(join(binDir, 'npm-noop'), 0o755);
  return binDir;
}

// Copy with-dist.mjs into the test dir (each case imports its own
// copy so the module's `ROOT` constant points to the test dir, not the
// real project root).
const REAL_HELPER = new URL('./with-dist.mjs', import.meta.url).pathname;
const helperSrc = readFileSync(REAL_HELPER, 'utf8');

async function loadHelper(caseDir) {
  writeFileSync(join(caseDir, 'with-dist.mjs'), helperSrc);
  return await import(join(caseDir, 'with-dist.mjs') + '?case=' + caseDir);
}

// ---- Tests ----------------------------------------------------------------

// 1. Skip path: dist/ exists → no rebuild, npm not invoked.
{
  const caseDir = join(tmpRoot, 'case1');
  mkdirSync(caseDir, { recursive: true });
  // Module's ROOT = tmpRoot/, so fake dist/ goes at tmpRoot/dist/
  mkdirSync(join(tmpRoot, 'dist'), { recursive: true });
  writeFileSync(join(tmpRoot, 'dist', 'engine.html'), '<html></html>');
  const binDir = setupFakeNpm(caseDir);
  const helper = await loadHelper(caseDir);

  const built = helper.ensureDist({ env: { PATH: binDir + ':' + process.env.PATH } });
  assert.strictEqual(built, false, 'skip path returns false');
  assert.strictEqual(existsSync(join(caseDir, 'npm.log')), false,
                     'npm must not be invoked when dist/ already exists');
  ok('skip path: dist/ exists → no rebuild, npm not invoked');
}

// 2. Build path: dist/ missing → npm runs, dist/index.html appears.
{
  const caseDir = join(tmpRoot, 'case2');
  mkdirSync(caseDir, { recursive: true });
  // Ensure dist/ is absent (it might be left over from case1).
  try { rmSync(join(tmpRoot, 'dist'), { recursive: true, force: true }); } catch (_) {}
  const binDir = setupFakeNpm(caseDir);
  const helper = await loadHelper(caseDir);

  const built = helper.ensureDist({ env: { PATH: binDir + ':' + process.env.PATH } });
  assert.strictEqual(built, true, 'build path returns true');
  assert.ok(existsSync(join(tmpRoot, 'dist', 'engine.html')),
            'fake npm should have created dist/engine.html');
  ok('build path: dist/ missing → npm runs, dist/ now exists');
}

// 3. Error path: npm succeeds but doesn't produce dist/index.html → throws.
{
  const caseDir = join(tmpRoot, 'case3');
  mkdirSync(caseDir, { recursive: true });
  try { rmSync(join(tmpRoot, 'dist'), { recursive: true, force: true }); } catch (_) {}
  const binDir = setupFakeNpm(caseDir);
  // Override npm with the noop variant. PATH ordering wins.
  const npmPath = join(binDir, 'npm');
  const noopPath = join(binDir, 'npm-noop');
  writeFileSync(npmPath, readFileSync(noopPath, 'utf8'));
  const helper = await loadHelper(caseDir);

  let threw = false;
  try { helper.ensureDist({ env: { PATH: binDir + ':' + process.env.PATH } }); }
  catch (e) { threw = true; assert.ok(/still missing/.test(String(e))); }
  assert.ok(threw, 'must throw when post-build sanity check fails');
  ok('error path: npm succeeded but dist/index.html missing → throws');
}

// 4. Error path: npm itself fails (exit code != 0) → throws.
{
  const caseDir = join(tmpRoot, 'case4');
  mkdirSync(caseDir, { recursive: true });
  try { rmSync(join(tmpRoot, 'dist'), { recursive: true, force: true }); } catch (_) {}
  const binDir = setupFakeNpm(caseDir);
  const npmPath = join(binDir, 'npm');
  const failPath = join(binDir, 'npm-fail');
  writeFileSync(npmPath, readFileSync(failPath, 'utf8'));
  const helper = await loadHelper(caseDir);

  let threw = false;
  try { helper.ensureDist({ env: { PATH: binDir + ':' + process.env.PATH } }); }
  catch (_) { threw = true; }
  assert.ok(threw, 'must throw when npm exits non-zero');
  ok('error path: npm exits non-zero → throws');
}

// 5. hasDist() reflects existence + non-empty.
{
  const caseDir = join(tmpRoot, 'case5');
  mkdirSync(caseDir, { recursive: true });
  try { rmSync(join(tmpRoot, 'dist'), { recursive: true, force: true }); } catch (_) {}
  const helper = await loadHelper(caseDir);

  assert.strictEqual(helper.hasDist(), false, 'no dist/ → false');
  mkdirSync(join(tmpRoot, 'dist'), { recursive: true });
  assert.strictEqual(helper.hasDist(), false, 'empty dist/ → false');
  writeFileSync(join(tmpRoot, 'dist', 'engine.html'), 'x');
  assert.strictEqual(helper.hasDist(), true, 'dist/engine.html with content → true');
  ok('hasDist() distinguishes missing / empty / populated');
}

// Cleanup.
rmSync(tmpRoot, { recursive: true, force: true });

console.log(results.join('\n'));
console.log('WITH DIST UNIT: ALL GREEN (' + results.length + ' tests)');