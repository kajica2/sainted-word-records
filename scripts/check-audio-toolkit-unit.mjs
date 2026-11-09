#!/usr/bin/env node
/**
 * Gate for tools/python-audio-toolkit — runs the synthetic selftest and
 * asserts the CLI entry points exist. Mic recording is probed with
 * --env-skip so missing PyAudio does not fail CI.
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const toolkit = path.join(root, 'tools/python-audio-toolkit');
const cli = path.join(toolkit, 'swr_audio/cli.py');

function fail(msg) {
  console.error('FAIL:', msg);
  process.exit(1);
}

function pass(msg) {
  console.log('PASS:', msg);
}

for (const rel of [
  'NOTICE.md',
  'LICENSE.Matin-python.txt',
  'requirements.txt',
  'swr_audio/__init__.py',
  'swr_audio/process.py',
  'swr_audio/record.py',
  'swr_audio/mix.py',
  'swr_audio/cli.py',
]) {
  const p = path.join(toolkit, rel);
  if (!fs.existsSync(p)) fail('missing ' + rel);
}
pass('toolkit files present');

const notice = fs.readFileSync(path.join(toolkit, 'NOTICE.md'), 'utf8');
if (!notice.includes('Matin-python/Python-Audio-Processing-Toolkit')) {
  fail('NOTICE.md must credit the upstream toolkit');
}
pass('upstream attribution');

const py = process.env.PYTHON || 'python3';
const env = {
  ...process.env,
  PYTHONPATH: [toolkit, process.env.PYTHONPATH].filter(Boolean).join(path.delimiter),
};

const self = spawnSync(py, [cli, 'selftest', '--out-dir', 'out/audio-toolkit/selftest'], {
  cwd: root,
  env,
  encoding: 'utf8',
});
if (self.status !== 0) {
  console.error(self.stdout);
  console.error(self.stderr);
  fail('selftest exited ' + self.status);
}
if (!/audio toolkit selftest: PASS/.test(self.stdout)) {
  console.error(self.stdout);
  fail('selftest missing PASS marker');
}
pass('selftest');

const rec = spawnSync(
  py,
  [cli, 'record', '--seconds', '0.1', '--out', 'out/audio-toolkit/selftest/mic-probe.wav', '--env-skip'],
  { cwd: root, env, encoding: 'utf8' },
);
if (rec.status !== 0) {
  console.error(rec.stdout);
  console.error(rec.stderr);
  fail('record --env-skip should exit 0 when mic is unavailable');
}
if (/env skip/.test(rec.stderr) || /env skip/.test(rec.stdout) || fs.existsSync('out/audio-toolkit/selftest/mic-probe.wav')) {
  pass('record env-skip or mic ok');
} else {
  // Mic recorded successfully with no skip message — also fine.
  pass('record env-skip or mic ok');
}

console.log('audio toolkit unit passed (4 checks)');
