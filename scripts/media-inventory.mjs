#!/usr/bin/env node
// Walk the repo and record every media file, grouped by top-level directory.
//
// Feeds contact-sheet.html. Writes media/inventory.json.
//
// Build output, dependency trees and other agents' worktrees are NOT media
// the user owns — but they are reported under `excluded` rather than dropped
// silently, so the page can never quietly understate what is on disk.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'media', 'inventory.json');

const EXTS = new Set(['.webp', '.png', '.jpg', '.jpeg', '.avif', '.gif', '.mp4', '.webm', '.mp3', '.wav', '.m4a']);

const EXCLUDE = new Map([
  ['node_modules', 'dependency tree'],
  ['dist', 'build output'],
  ['dist-dev', 'build output'],
  ['out', 'scratch output'],
  ['worktrees', "another agent's worktree"],
  ['.worktrees', "another agent's worktree"],
  ['.hermes', 'agent scratch'],
  ['.git', 'vcs'],
  ['verify-screenshots', 'test artifacts'],
]);

const kindOf = (ext) => {
  if (['.mp4', '.webm'].includes(ext)) return 'video';
  if (['.mp3', '.wav', '.m4a'].includes(ext)) return 'audio';
  return 'image';
};

const groups = new Map();   // dir -> {files:[]}
const excluded = new Map(); // dir -> {reason, files, bytes}

function walk(dir, top) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) { walk(full, top); continue; }
    if (!e.isFile()) continue;
    const ext = path.extname(e.name).toLowerCase();
    if (!EXTS.has(ext)) continue;

    let bytes;
    try { bytes = fs.statSync(full).size; } catch { continue; }

    const rel = '/' + path.relative(ROOT, full).split(path.sep).join('/');
    const rec = { p: rel, b: bytes, k: kindOf(ext) };

    const ex = EXCLUDE.get(top);
    if (ex) {
      const g = excluded.get(top) || { reason: ex, files: 0, bytes: 0 };
      g.files++; g.bytes += bytes;
      excluded.set(top, g);
      continue;
    }
    const g = groups.get(top) || { files: [] };
    g.files.push(rec);
    groups.set(top, g);
  }
}

for (const e of fs.readdirSync(ROOT, { withFileTypes: true })) {
  if (!e.isDirectory()) continue;
  walk(path.join(ROOT, e.name), e.name);
}

const dirList = [...groups.entries()].map(([dir, g]) => {
  const byKind = {};
  let bytes = 0;
  for (const f of g.files) { bytes += f.b; byKind[f.k] = (byKind[f.k] || 0) + 1; }
  return { dir, files: g.files.length, bytes, byKind, items: g.files };
}).sort((a, b) => b.bytes - a.bytes);

const totalFiles = dirList.reduce((s, d) => s + d.files, 0);
const totalBytes = dirList.reduce((s, d) => s + d.bytes, 0);
const exList = [...excluded.entries()].map(([dir, v]) => ({ dir, ...v })).sort((a, b) => b.bytes - a.bytes);

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify({
  generated: new Date().toISOString().slice(0, 10),
  totalFiles, totalBytes,
  groups: dirList,
  excluded: exList,
}, null, 0));

const mb = (n) => (n / 1048576).toFixed(1);
console.log(`media-inventory: ${totalFiles} files / ${mb(totalBytes)} MB across ${dirList.length} groups`);
console.log(`  -> ${path.relative(ROOT, OUT)}`);
if (exList.length) {
  console.log(`  excluded (reported, not counted):`);
  for (const e of exList) console.log(`    ${e.dir.padEnd(20)} ${String(e.files).padStart(4)} files  ${mb(e.bytes).padStart(7)} MB  — ${e.reason}`);
}
