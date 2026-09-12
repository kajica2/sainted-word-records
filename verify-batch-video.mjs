#!/usr/bin/env node
// verify-batch-video.mjs — smoke test for the batch-video CLI.
//
// Runs:
//   - unit tests for lib/variant-picker.mjs (via node scripts/test-variant-picker.mjs)
//   - batch-video.mjs --analyze-only on a small fixture set
//   - asserts every pick has a known variants/*.html file backing it
//   - asserts summary.json is written and well-formed
//
// Run: `node verify-batch-video.mjs`. Exits 0 on green, 1 on any failure.

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';

const ROOT = process.cwd();
const TMP = '/tmp/swr-verify-batch-video';
const FIXTURE_DIR = path.join(TMP, 'input');
const OUT_DIR = path.join(TMP, 'output');

function run(cmd, args, opts = {}) {
  return execFileSync(cmd, args, { encoding: 'utf8', cwd: ROOT, ...opts });
}

function step(name, fn) {
  try {
    fn();
    console.log(`  \u2713 ${name}`);
  } catch (e) {
    console.error(`  \u2717 ${name}\n    ${e.message}`);
    process.exitCode = 1;
  }
}

// 1. Picker unit tests still green.
step('picker unit tests (15/15)', () => {
  const out = run('node', ['scripts/test-variant-picker.mjs']);
  assert.match(out, /15 passed, 0 failed/);
});

// 2. batch-video.mjs --analyze-only produces a valid summary.json.
step('--analyze-only writes summary.json with picks', () => {
  fs.rmSync(TMP, { recursive: true, force: true });
  fs.mkdirSync(FIXTURE_DIR, { recursive: true });

  // Make 3 short fixtures from real audio (use the user's smrt files
  // we already analyzed in the picker coverage test). Trimming to 5s
  // each keeps the analyze step fast.
  const candidates = [
    '/Users/kaidejuricmasscmbook/Downloads/adoresoundcloudver (4).wav',
    '/Users/kaidejuricmasscmbook/Downloads/ohwowvocaled (3).wav',
    '/Users/kaidejuricmasscmbook/Downloads/smrt [vocals] (Cover) (Remastered).wav',
  ];
  for (const src of candidates) {
    if (!fs.existsSync(src)) continue;
    const base = path.basename(src).replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 30);
    const dst = path.join(FIXTURE_DIR, `${base}.wav`);
    // Trim to 5s via ffmpeg so the analyze step stays under 30s.
    execFileSync('ffmpeg', ['-y', '-ss', '0', '-t', '5', '-i', src, '-loglevel', 'error', dst]);
  }
  const inputs = fs.readdirSync(FIXTURE_DIR).map((f) => path.join(FIXTURE_DIR, f));
  assert.ok(inputs.length > 0, 'no fixtures produced');

  run('node', ['scripts/batch-video.mjs', '--input', FIXTURE_DIR, '--output', OUT_DIR, '--analyze-only']);

  const summaryPath = path.join(OUT_DIR, 'summary.json');
  assert.ok(fs.existsSync(summaryPath), `summary.json not written at ${summaryPath}`);
  const summary = JSON.parse(fs.readFileSync(summaryPath, 'utf8'));
  assert.equal(summary.length, inputs.length, `expected ${inputs.length} picks, got ${summary.length}`);

  // Every pick must be a valid variants/*.html file.
  for (const s of summary) {
    assert.ok(s.input, 'pick missing input');
    assert.ok(s.pick, 'pick missing pick object');
    assert.ok(s.pick.variant, `pick missing variant for ${s.input}`);
    assert.ok(s.analysis, 'pick missing analysis');
    assert.equal(s.render, null, '--analyze-only must not render');
    const variantPath = path.join(ROOT, 'versions', `${s.pick.variant}.html`);
    assert.ok(fs.existsSync(variantPath), `picked variant ${s.pick.variant} has no versions/${s.pick.variant}.html`);
  }
});

// 3. batch-video.mjs --help exits 0 and lists the new flags.
step('--help lists the operator UX flags', () => {
  const out = run('node', ['scripts/batch-video.mjs', '--help']);
  assert.match(out, /--analyze-only/);
  assert.match(out, /--skip-existing/);
  assert.match(out, /--retry/);
  assert.match(out, /--parallel/);
});

// 4. Unknown flag rejects with exit 2 (was the silent-drop bug).
step('unknown --flag exits 2 (regression net for the silent-drop bug)', () => {
  try {
    run('node', ['scripts/batch-video.mjs', '--input', '/tmp', '--output', '/tmp', '--bogus-flag']);
    throw new Error('expected exit 2, got exit 0');
  } catch (e) {
    // execFileSync throws on non-zero exit. The status is in e.status.
    if (e.status !== 2) {
      throw new Error(`expected exit 2, got ${e.status}`);
    }
    assert.match(e.stderr || e.stdout || '', /unknown flag|bogus-flag/);
  }
});

// 5. --manifest honors per-input variant override.
step('--manifest per-input variant override beats picker', () => {
  fs.rmSync(path.join(TMP, 'manifest-out'), { recursive: true, force: true });
  // Use the first fixture from step 2 (whatever it is — the manifest
  // path doesn't depend on what the picker would choose).
  const firstFixture = fs.readdirSync(FIXTURE_DIR)[0];
  const manifestPath = path.join(TMP, 'manifest.json');
  fs.writeFileSync(manifestPath, JSON.stringify([
    { input: path.join(FIXTURE_DIR, firstFixture), variant: 'film' },
  ]));
  run('node', [
    'scripts/batch-video.mjs',
    '--manifest', manifestPath,
    '--output', path.join(TMP, 'manifest-out'),
    '--analyze-only',
  ]);
  const summary = JSON.parse(fs.readFileSync(path.join(TMP, 'manifest-out', 'summary.json'), 'utf8'));
  assert.equal(summary.length, 1);
  assert.equal(summary[0].pick.variant, 'film', `manifest override ignored: got ${summary[0].pick.variant}`);
  assert.match(summary[0].pick.rationale, /manifest-override/);
});

// 6. --manifest with non-existent input rejects with exit 2.
step('--manifest with missing input rejects with exit 2', () => {
  const manifestPath = path.join(TMP, 'bad-manifest.json');
  fs.writeFileSync(manifestPath, JSON.stringify([
    { input: '/nonexistent/foo.mp3', variant: 'film' },
  ]));
  try {
    run('node', [
      'scripts/batch-video.mjs',
      '--manifest', manifestPath,
      '--output', '/tmp',
      '--analyze-only',
    ]);
    throw new Error('expected exit 2, got exit 0');
  } catch (e) {
    if (e.status !== 2) {
      throw new Error(`expected exit 2, got ${e.status}`);
    }
    assert.match(e.stderr || e.stdout || '', /missing or invalid input/);
  }
});

if (process.exitCode) {
  console.log('\nverify-batch-video: FAIL');
} else {
  console.log('\nverify-batch-video: green');
}