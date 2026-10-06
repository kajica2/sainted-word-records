#!/usr/bin/env node
// scripts/check-webm-clips-unit.mjs — pure-logic unit exercise for the WebM
// clip pipeline in scripts/generate-media-pack.mjs (--clips-dir / --clip-max /
// --webm-only / --pack-id).
//
// Runs in node WITHOUT ffmpeg/zip: the ffprobe probe, ffmpeg spawnSync, and
// filesystem reads (readdir / stat) are injected mocks, so nothing is
// executed and no temp media is needed. Mirrors the
// check-zip-reader-unit.mjs conventions (per-check log + failing exit code).

import path from 'node:path';
import {
  parseArgs,
  validateArgs,
  resolveClipMax,
  probeDuration,
  normalizeWebmClip,
  discoverClips,
  uniqueName,
  normalizeClips,
} from './generate-media-pack.mjs';

let failures = 0;
function check(name, cond, detail) {
  if (cond) { console.log(`  ✓ ${name}`); }
  else { failures++; console.error(`  ✗ ${name}${detail ? ' — ' + detail : ''}`); }
}

function deepEqual(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

console.log('webm-clips unit:');

// --- parseArgs: new flags ---------------------------------------------------
const a = parseArgs(['--audio', 'song.wav', '--clips-dir', '/tmp/shots', '--clip-max', '12', '--webm-only', '--pack-id', 'wedding', '--output', 'out/x']);
check('clips-dir parsed', a.clipsDir === '/tmp/shots');
check('clip-max parsed', a.clipMax === 12);
check('webm-only parsed', a.webmOnly === true);
check('pack-id parsed', a.packId === 'wedding');
check('existing flags still parse', a.audio === 'song.wav' && a.output === 'out/x');

// --- clip-max default (resolveClipMax) --------------------------------------
check('clip-max defaults to 15', resolveClipMax({}) === 15);
check('clip-max honors explicit value', resolveClipMax({ clipMax: 20 }) === 20);
check('clip-max ignores non-positive values', resolveClipMax({ clipMax: -3 }) === 15 && resolveClipMax({ clipMax: 0 }) === 15);

// --- clips-dir + packs mutual exclusion -------------------------------------
check('clips-dir + packs rejected', /mutually exclusive/.test(validateArgs({ clipsDir: '/c', packs: 'neon' }) || ''));
check('clips-dir alone ok', validateArgs({ clipsDir: '/c' }) === null);
check('packs alone ok', validateArgs({ packs: 'neon' }) === null);
check('invalid clip-max rejected', /positive/.test(validateArgs({ clipsDir: '/c', clipMax: -1 }) || ''));

// --- normalizeWebmClip arg construction (probe + spawn + stat mocked) -------
const fakeStat = () => ({ size: 4096 });
const fakeSpawnRecorder = [];
const fakeSpawn = (cmd, args) => { fakeSpawnRecorder.push({ cmd, args }); return { status: 0, stderr: Buffer.from('') }; };

const long = normalizeWebmClip({ src: '/c/long.webm', dest: '/o/long-15s.webm', maxSec: 15, probe: () => 30, spawn: fakeSpawn, stat: fakeStat });
check('long clip gets -t 15', long.args.includes('-t') && long.args.includes('15'));
check('long clip flagged trimmed', long.trimmed === true);
check('vp9 + opus flags present', ['-c:v', 'libvpx-vp9', '-crf', '32', '-b:v', '0', '-c:a', 'libopus', '-b:a', '96k', '-shortest'].every(f => long.args.includes(f)));
check('dest is trailing arg', long.args[long.args.length - 1] === '/o/long-15s.webm');

const short = normalizeWebmClip({ src: '/c/short.webm', dest: '/o/short.webm', maxSec: 15, probe: () => 3, spawn: fakeSpawn, stat: fakeStat });
check('short clip omits -t (pass-through)', !short.args.includes('-t'));
check('short clip flagged untrimmed', short.trimmed === false);

const unknown = normalizeWebmClip({ src: '/c/unknown.webm', dest: '/o/unknown-15s.webm', maxSec: 15, probe: () => null, spawn: fakeSpawn, stat: fakeStat });
check('unknown duration still capped', unknown.trimmed === true && unknown.args.includes('-t') && unknown.args.includes('15'));

const fail = normalizeWebmClip({ src: '/c/bad.webm', dest: '/o/bad.webm', maxSec: 15, probe: () => 5, spawn: () => ({ status: 1, stderr: Buffer.from('boom\nlast error line') }), stat: fakeStat });
check('failed encode -> ok false', fail.ok === false);
check('failed encode surfaces last stderr line', /last error line/.test(fail.error));

const missingDest = normalizeWebmClip({ src: '/c/ghost.webm', dest: '/o/ghost.webm', maxSec: 15, probe: () => 5, spawn: () => ({ status: 0, stderr: Buffer.from('') }), stat: () => { throw new Error('enoent'); } });
check('status 0 with no output file -> ok false', missingDest.ok === false);

// --- probeDuration ----------------------------------------------------------
check('probeDuration parses ffprobe output', probeDuration('/x.webm', { exec: () => '12.34' }) === 12.34);
check('probeDuration null on probe failure', probeDuration('/x.webm', { exec: () => { throw new Error('no'); } }) === null);
check('probeDuration null on garbage output', probeDuration('/x.webm', { exec: () => 'N/A' }) === null);

// --- discoverClips: deterministic sort + extension filter -------------------
const found = discoverClips('/dir', { readDir: () => ['b.webm', 'Z.WEBM', 'a.mp4', 'note.txt', 'a.webm', 'clip.MP4'] });
check('webm/mp4 (any case) discovered', found.length === 5);
check('deterministic ASCII sort', deepEqual(found.map(n => path.basename(n)), ['Z.WEBM', 'a.mp4', 'a.webm', 'b.webm', 'clip.MP4']));
check('missing dir -> empty list', discoverClips('/nope', { readDir: () => { throw new Error('enoent'); } }).length === 0);

// --- uniqueName -------------------------------------------------------------
check('uniqueName passthrough on first use', uniqueName('shot.webm', new Set()) === 'shot.webm');
check('uniqueName collision suffix', uniqueName('shot.webm', new Set(['shot.webm'])) === 'shot-2.webm');
check('uniqueName keeps extension + chains', uniqueName('shot-15s.webm', new Set(['shot-15s.webm', 'shot-15s-2.webm'])) === 'shot-15s-3.webm');

// --- normalizeClips: naming + failure-skip (batch keeps going) --------------
const batchCalls = [];
const batchSpawn = (cmd, args) => {
  batchCalls.push(args);
  // Match the ffmpeg input source (`-i /c/bad.webm`) so the failure branch
  // actually fires — `args.includes('bad.webm')` can't match a full path.
  return args.some((a) => a.includes('bad.webm'))
    ? { status: 1, stderr: Buffer.from('encode blew up') }
    : { status: 0, stderr: Buffer.from('') };
};
const batchProbe = f => (f.includes('long') ? 30 : f.includes('short') ? 3 : 30);
const res = normalizeClips({
  clips: ['/c/long.webm', '/c/bad.webm', '/c/short.webm'],
  destDir: '/o',
  maxSec: 15,
  probe: batchProbe,
  spawn: batchSpawn,
  stat: fakeStat,
});
check('normalized keeps only passing clips', res.normalized.length === 2);
check('trimmed clip gets <-15s> name', res.normalized.some(n => n.name === 'long-15s.webm'));
check('trimmed entry flagged', (res.normalized.find(n => n.name === 'long-15s.webm') || {}).trimmed === true);
check('short clip keeps stem name (untouched)', res.normalized.some(n => n.name === 'short.webm'));
check('failed clip skipped, batch not aborted', res.skipped.length === 1 && res.skipped[0].src === '/c/bad.webm' && res.normalized.length === 2);
check('every clip attempted once', batchCalls.length === 3);

console.log(failures === 0 ? '\nall webm-clips checks passed' : `\n${failures} check(s) FAILED`);
process.exit(failures === 0 ? 0 : 1);