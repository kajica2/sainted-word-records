#!/usr/bin/env node
// Verify that the remote branch's tree is byte-identical to the local one.
//
// The branch was submitted through the App's commit tools, in size-bounded
// batches, so "it says it pushed" is not evidence. This reads every changed
// file back from the remote branch and compares it, byte for byte, with the
// local file.
//
// Usage: node scripts/verify-remote-branch.mjs <branch>

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';

const BRANCH = process.argv[2] || 'feat/chain-view';
const OWNER = 'kajica2';
const REPO = 'sainted-word-records';
const BASE = 'origin/main';

const sh = (cmd, args) => execFileSync(cmd, args, { encoding: 'utf8', maxBuffer: 128 * 1024 * 1024 });
const call = (tool, args) => {
  const tmp = path.join(os.tmpdir(), `vf-${process.pid}-${Math.random().toString(36).slice(2)}.json`);
  fs.writeFileSync(tmp, JSON.stringify(args));
  try { return JSON.parse(sh('mcode-tools', ['connector', 'call', tool, '--args-file', tmp])); }
  finally { try { fs.unlinkSync(tmp); } catch (_) {} }
};

// Compare against the MERGE BASE, not origin/main: main moves on while the
// branch is open, and the files main added are not this branch's proposal.
// `git diff main..branch` would list them as deletions.
const mergeBase = sh('git', ['merge-base', BASE, BRANCH]).trim();
const changed = sh('git', ['diff', '--name-only', `${mergeBase}..${BRANCH}`]).trim().split('\n').filter(Boolean);
console.log(`merge base: ${mergeBase.slice(0, 10)}`);
console.log(`verifying ${changed.length} changed file(s) on ${OWNER}/${REPO}:${BRANCH}\n`);

let ok = 0, bad = 0;
for (const p of changed) {
  const local = fs.readFileSync(p);
  const localSha = crypto.createHash('sha1').update(local).digest('hex');
  let remote = null, err = null;
  try {
    const out = call('connector__github__get_file_contents', {
      owner: OWNER, repo: REPO, path: p, ref: BRANCH,
    });
    const res = (out.find((b) => b.type === 'resource') || {}).resource;
    if (!res || typeof res.text !== 'string') throw new Error('no text in response');
    remote = Buffer.from(res.text, 'utf8');
  } catch (e) { err = e.message.slice(0, 120); }
  if (err) { console.log(`  ✗ ${p}  — ${err}`); bad++; continue; }
  const remoteSha = crypto.createHash('sha1').update(remote).digest('hex');
  if (remoteSha === localSha) { ok++; }
  else {
    console.log(`  ✗ ${p}  — content differs (local ${local.length}B sha ${localSha.slice(0, 10)} / remote ${remote.length}B sha ${remoteSha.slice(0, 10)})`);
    bad++;
  }
}

console.log(`\n${ok}/${changed.length} files byte-identical on the remote branch`);
if (bad) { console.log(`${bad} MISMATCHED`); process.exit(1); }
console.log('REMOTE TREE MATCHES LOCAL');
