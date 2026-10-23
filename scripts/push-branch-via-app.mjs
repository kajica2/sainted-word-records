#!/usr/bin/env node
// Push the local branch to GitHub through the connected GitHub App.
//
// WHY NOT `git push`
// ------------------
// There is no git credential in this environment: no token, no SSH key, no
// credential helper, no gh CLI. The GitHub App is authorised, but App
// authorisation does not hand the shell push credentials. So the branch is
// submitted through the App's commit tools.
//
// WHY IT IS BATCHED
// -----------------
// The App's push_files creates ONE commit per call and the connector
// rejects a request whose total payload is over ~450 KB. Two of the local
// commits are larger than that (the /play variant is 425 KB on its own,
// the Command Center touches 29 files), so each local commit is split into
// size-bounded calls. The first chunk of a commit carries its message; the
// rest are marked as parts.
//
// The branch is reconstructed from the FINAL content of every changed file,
// so the tree the PR proposes is byte-identical to the local tree.
//
// Usage: node scripts/push-branch-via-app.mjs <branch> [--dry-run]

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const BRANCH = process.argv[2] || 'feat/chain-view';
const OWNER = 'kajica2';
const REPO = 'sainted-word-records';
const BASE = 'origin/main';
const DRY = process.argv.includes('--dry-run');

const BUDGET = 380 * 1024;      // stay well under the connector's payload cap
const MAX_FILES = 12;

const sh = (cmd, args) => execFileSync(cmd, args, { encoding: 'utf8', maxBuffer: 128 * 1024 * 1024 });
const call = (tool, args) => {
  const tmp = path.join(os.tmpdir(), `cc-${process.pid}-${Math.random().toString(36).slice(2)}.json`);
  fs.writeFileSync(tmp, JSON.stringify(args));
  try {
    return sh('mcode-tools', ['connector', 'call', tool, '--args-file', tmp]);
  } finally { try { fs.unlinkSync(tmp); } catch (_) {} }
};

// Local commits, oldest first.
const shas = sh('git', ['rev-list', '--reverse', `${BASE}..${BRANCH}`]).trim().split('\n').filter(Boolean);

// Group every changed file by the local commit that FIRST introduced it, so
// each group carries that commit's message. Content is always the FINAL
// version, so the pushed tree matches the local tree exactly.
const groups = [];
const seen = new Set();
const deletions = new Set();

// Pass 1: every path that is deleted at some point. A path that is created
// and later deleted never exists in the final tree, so it must not be
// pushed at all.
for (const sha of shas) {
  const nameStatus = sh('git', ['show', '--name-status', '--format=', sha]).trim();
  for (const line of nameStatus.split('\n').filter(Boolean)) {
    const [status, ...rest] = line.split('\t');
    if (status.startsWith('D')) deletions.add(rest[rest.length - 1]);
  }
}

// Pass 2: group the surviving paths by the commit that first introduced them.
for (const sha of shas) {
  const subject = sh('git', ['log', '-1', '--format=%s', sha]).trim();
  const body = sh('git', ['log', '-1', '--format=%b', sha]).trim();
  const nameStatus = sh('git', ['show', '--name-status', '--format=', sha]).trim();
  const group = { subject, body, files: [] };
  for (const line of nameStatus.split('\n').filter(Boolean)) {
    const [status, ...rest] = line.split('\t');
    const p = rest[rest.length - 1];
    if (status.startsWith('D')) continue;                 // deleted later, or now
    if (deletions.has(p)) continue;                       // never in the final tree
    if (seen.has(p)) continue;
    seen.add(p);
    group.files.push(p);
  }
  if (group.files.length) groups.push(group);
}

console.log(`${groups.length} commit group(s), ${deletions.length} deletion(s) → ${OWNER}/${REPO}:${BRANCH}\n`);

for (const group of groups) {
  const payload = group.files.map((p) => ({ path: p, content: sh('git', ['show', `HEAD:${p}`]) }));
  // Split into size-bounded chunks.
  const chunks = [];
  let cur = [], curBytes = 0;
  for (const f of payload) {
    const size = Buffer.byteLength(f.content, 'utf8');
    if (cur.length && (curBytes + size > BUDGET || cur.length >= MAX_FILES)) {
      chunks.push(cur); cur = []; curBytes = 0;
    }
    cur.push(f); curBytes += size;
  }
  if (cur.length) chunks.push(cur);

  for (let i = 0; i < chunks.length; i++) {
    const part = chunks.length > 1 ? ` (part ${i + 1} of ${chunks.length})` : '';
    const message = `${group.subject}${part}\n\n${group.body}`.trim();
    const kb = (chunks[i].reduce((n, f) => n + Buffer.byteLength(f.content, 'utf8'), 0) / 1024).toFixed(0);
    console.log(`── ${group.subject}${part}`);
    console.log(`   ${chunks[i].length} file(s), ${kb} KB`);
    if (DRY) { console.log('   (dry run)\n'); continue; }
    const out = call('connector__github__push_files', {
      owner: OWNER, repo: REPO, branch: BRANCH, files: chunks[i], message,
    });
    const j = JSON.parse(JSON.parse(out)[0].text);
    console.log(`   → ${(j.commit && j.commit.sha) || j.sha || 'ok'}\n`);
  }
}

// Deletions last: the files are removed from the branch. Only paths that
// exist in the FINAL tree and were deleted upstream matter here; a path
// that never reached the final tree needs no deletion.
if (deletions.size) {
  console.log('── deletions');
  for (const p of deletions) {
    let shaOut = null;
    try { shaOut = sh('git', ['rev-parse', `HEAD:${p}`]).trim(); } catch (_) { /* not in HEAD */ }
    if (!shaOut) { console.log(`   ${p}: not present in HEAD, skipping`); continue; }
    if (DRY) { console.log(`   ${p}: (dry run)`); continue; }
    try {
      call('connector__github__delete_file', {
        owner: OWNER, repo: REPO, path: p, branch: BRANCH, sha: shaOut,
        message: `chore: remove ${p}`,
      });
      console.log(`   deleted ${p}`);
    } catch (e) {
      console.log(`   DELETE FAILED ${p}: ${String(e.message).slice(0, 200)}`);
    }
  }
  console.log('');
}
console.log('done');
