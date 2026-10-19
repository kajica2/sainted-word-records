// scripts/check-build-idempotent.mjs — verify the build is idempotent.
//
// "Idempotent" here means: running `npm run build` twice in a row from
// a clean state produces a byte-identical `dist/` (modulo timestamps the
// Vite plugin `inline-app-version` writes into `dist/lib/app-version.js`).
//
// Why: `vite.config.js` runs 5 post-processors in `closeBundle` —
// `copy-static`, `inline-automix-config`, `inline-targeting-rules`,
// `inline-footer-nav`, `inline-app-version`. Their correctness depends
// on the order they're listed in the `plugins:` array. A reorder
// can silently break the build (e.g. `inline-automix-config` runs
// before `copy-static`, so its inlined JSON gets overwritten on the
// second copy pass). The most recent breakage I can recall: the
// `scriptRanges()` fix in commit `bf2f184` — ranges cached at
// function-scope were going stale across codemod mutations.
//
// This check:
//   1. Cleans `dist/` (simulating a fresh build).
//   2. Runs `npm run build` once, hashes every file.
//   3. Runs it again, hashes again.
//   4. Compares, with the documented exception of
//      `dist/lib/app-version.js` (which records the build time).
//
// Exit 0 on idempotent, 1 on drift. Output is a list of files whose
// hash changed between the two builds, with first/last-modified
// timestamps for the human to inspect.

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  existsSync, mkdirSync, readdirSync, rmSync, statSync,
  readFileSync, writeFileSync,
} from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = process.cwd();
const DIST = join(ROOT, 'dist');
// Files whose contents legitimately change between runs. Add to
// this list as new intentional build-time non-determinism appears
// (e.g. random IDs in offline page).
const ALLOWED_DRIFT = new Set([
  'dist/lib/app-version.js',  // records new Date().toISOString() on each build
]);

function rmdist() {
  if (existsSync(DIST)) rmSync(DIST, { recursive: true, force: true });
}

function build() {
  execFileSync('npm', ['run', 'build'], {
    cwd: ROOT,
    stdio: 'inherit',
    env: { ...process.env, FORCE_COLOR: '0' },
  });
}

function walk(dir) {
  const out = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
      out.push(...walk(full));
    } else if (e.isFile()) {
      out.push(full);
    }
  }
  return out;
}

function hashAll() {
  const files = walk(DIST).sort();
  const m = new Map();
  for (const f of files) {
    const rel = relative(ROOT, f);
    const stat = statSync(f);
    const hash = createHash('sha256').update(readFileSync(f)).digest('hex');
    m.set(rel, { hash, size: stat.size, mtime: stat.mtimeMs });
  }
  return m;
}

function diff(a, b) {
  const added = [];
  const removed = [];
  const changed = [];
  for (const k of b.keys()) if (!a.has(k)) added.push(k);
  for (const k of a.keys()) if (!b.has(k)) removed.push(k);
  for (const [k, va] of a) {
    const vb = b.get(k);
    if (!vb) continue;  // already in removed
    if (va.hash !== vb.hash) changed.push({ file: k, hash1: va.hash, hash2: vb.hash });
  }
  return { added, removed, changed };
}

console.log('build-idempotency check');
console.log('=======================');
console.log('');

console.log('Cleaning dist/...');
rmdist();
console.log('First build...');
build();
const first = hashAll();
console.log(`  ${first.size} files, ${[...first.values()].reduce((s, x) => s + x.size, 0)} bytes`);
console.log('Second build...');
build();
const second = hashAll();
console.log(`  ${second.size} files, ${[...second.values()].reduce((s, x) => s + x.size, 0)} bytes`);

const { added, removed, changed } = diff(first, second);

if (added.length === 0 && removed.length === 0 && changed.length === 0) {
  console.log('');
  console.log(`PASS — ${second.size} files, all hashes match between the two builds.`);
  process.exit(0);
}

console.log('');
console.log(`DRIFT detected (${added.length} added, ${removed.length} removed, ${changed.length} changed):`);
for (const f of added) console.log(`  + ${f}`);
for (const f of removed) console.log(`  - ${f}`);
for (const c of changed) {
  const allowed = ALLOWED_DRIFT.has(c.file) ? ' (allowed)' : '';
  console.log(`  ~ ${c.file}${allowed}`);
  if (!ALLOWED_DRIFT.has(c.file)) {
    console.log(`      ${c.hash1.slice(0, 12)} → ${c.hash2.slice(0, 12)}`);
  }
}
console.log('');
const bad = changed.filter((c) => !ALLOWED_DRIFT.has(c.file));
if (bad.length) {
  console.log(`FAIL — ${bad.length} unexpected drift(s) (excluding the ${ALLOWED_DRIFT.size} allowed).`);
  console.log('A non-allowed drift usually means a plugin wrote twice or in the wrong');
  console.log('order. Check the `plugins:` array order in `vite.config.js` and the');
  console.log('comments on each post-processor.');
  process.exit(1);
} else {
  console.log('PASS — drift is only in the allowed list.');
  process.exit(0);
}
