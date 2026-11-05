#!/usr/bin/env node
// scripts/check-generations.mjs — the living history gate.
//
// The history page is only as honest as the data it reads. This gate
// rebuilds the data from marketing/generations.json and the tree, then
// proves:
//
//   1. The authored records are sound: unique ids, known eras, a real
//      "current" generation, ISO dates.
//   2. Everything a generation claims to have shipped still exists, and the
//      media really does have a length and a bitrate (ffprobe worked).
//   3. Every archive is a well-formed zip carrying CREDITS.md and
//      MANIFEST.json, and the credits name the media it claims.
//   4. The page reads the data it is served and links the archives.
//   5. The route is wired: site-map → vercel rewrite → sitemap.
//
// Run: node scripts/check-generations.mjs

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { readZipEntries, readZipFile } from './lib/zip.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const AUTHORED = path.join(ROOT, 'marketing', 'generations.json');
const PAGE = path.join(ROOT, 'generations.html');

let failures = 0;
function assert(cond, label, detail) {
  if (cond) {
    console.log(`  ok  ${label}`);
  } else {
    failures += 1;
    console.error(`FAIL  ${label}${detail ? ` — ${detail}` : ''}`);
  }
}

// ── rebuild ──────────────────────────────────────────────────────────────────
console.log('=== rebuilding the history ===');
try {
  execFileSync(process.execPath, [path.join(ROOT, 'scripts', 'generate-generations.mjs')], {
    cwd: ROOT,
    stdio: 'pipe',
  });
  console.log('  ok  scripts/generate-generations.mjs ran');
} catch (e) {
  console.error('FAIL  the generator did not run');
  console.error(String(e.stdout || '') + String(e.stderr || ''));
  process.exit(1);
}

const authored = JSON.parse(fs.readFileSync(AUTHORED, 'utf8'));
const data = JSON.parse(fs.readFileSync(path.join(ROOT, 'generations.json'), 'utf8'));

// ── 1. the authored records ──────────────────────────────────────────────────
console.log('\n=== the authored records ===');
const ids = new Set();
let dupes = [];
for (const gen of authored.generations) {
  if (ids.has(gen.id)) dupes.push(gen.id);
  ids.add(gen.id);
}
assert(dupes.length === 0, 'every generation id is unique', dupes.join(', '));
assert(authored.generations.length > 0, 'there is at least one generation');

const eraIds = new Set((authored.meta.eras || []).map((e) => e.id));
const unknownEra = authored.generations.filter((g) => !eraIds.has(g.era));
assert(unknownEra.length === 0, 'every generation belongs to a declared era', unknownEra.map((g) => g.id).join(', '));
assert(ids.has(authored.meta.current), 'the current generation exists', authored.meta.current);
const dateRe = /^\d{4}-\d{2}-\d{2}$/;
const badDates = authored.generations.filter((g) => !dateRe.test(g.date));
assert(badDates.length === 0, 'every generation carries an ISO date', badDates.map((g) => g.id).join(', '));
const noStory = authored.generations.filter((g) => !g.story || g.story.length < 40);
assert(noStory.length === 0, 'every generation has a story', noStory.map((g) => g.id).join(', '));

// ── 2. what the generations claim to have shipped ───────────────────────────
console.log('\n=== the files behind the story ===');
let missingArtifacts = [];
let missingMedia = [];
let unmeasured = [];
for (const gen of authored.generations) {
  for (const artifact of gen.artifacts || []) {
    if (!fs.existsSync(path.join(ROOT, artifact.path))) missingArtifacts.push(`${gen.id}: ${artifact.path}`);
  }
  for (const entry of gen.media || []) {
    if (!fs.existsSync(path.join(ROOT, entry.path))) missingMedia.push(`${gen.id}: ${entry.path}`);
  }
}
assert(missingArtifacts.length === 0, 'every artifact exists', missingArtifacts.join(', '));
assert(missingMedia.length === 0, 'every media file exists', missingMedia.join(', '));

// The credits are MEASURED with ffprobe, which is an external tool. If it is
// not on PATH there is nothing to measure with, so the gate says so out
// loud and passes — the repo's env-skip convention (see AGENTS.md,
// "Env-skip pattern"). The marker is literal so a real failure still
// surfaces: when ffprobe IS present, a file that cannot be measured is a
// failure, not a skip.
const ffprobePresent = !(data.meta && data.meta.ffprobeAvailable === false);
if (!ffprobePresent) {
  console.log('(env skip: ffprobe is not installed — the media credits cannot be measured)');
} else {
  for (const gen of data.generations) {
    for (const m of gen.media) {
      if (!m.tracked) continue;
      if (!Number.isFinite(m.duration) || !Number.isFinite(m.bitrate)) {
        unmeasured.push(`${gen.id}: ${m.path}`);
      }
    }
  }
  assert(unmeasured.length === 0, 'every credited media file has a length and a bitrate', unmeasured.join(', '));
}

// ── 3. the archives ─────────────────────────────────────────────────────────
console.log('\n=== the archives ===');
const zipDir = path.join(ROOT, 'generations');
let badZip = [];
let missingCredits = [];
let emptyArchive = [];
for (const gen of data.generations) {
  const file = path.join(zipDir, `${gen.id}.zip`);
  if (!fs.existsSync(file)) {
    badZip.push(`${gen.id}: no archive`);
    continue;
  }
  let entries;
  try {
    entries = readZipEntries(fs.readFileSync(file));
  } catch (e) {
    badZip.push(`${gen.id}: ${e.message}`);
    continue;
  }
  const names = entries.map((e) => e.name);
  if (!names.includes('CREDITS.md') || !names.includes('MANIFEST.json')) {
    missingCredits.push(`${gen.id}: ${names.filter((n) => n.startsWith('CREDITS') || n.startsWith('MANIFEST')).join(',') || 'none'}`);
  }
  if (entries.length < 3) emptyArchive.push(`${gen.id}: ${entries.length} entries`);
}
assert(badZip.length === 0, 'every archive is a readable zip', badZip.join(', '));
assert(missingCredits.length === 0, 'every archive carries CREDITS.md and MANIFEST.json', missingCredits.join(', '));
assert(emptyArchive.length === 0, 'every archive carries more than the manifest alone', emptyArchive.join(', '));

// The credits must name the media they are crediting.
let creditMismatch = [];
for (const gen of data.generations) {
  const file = path.join(zipDir, `${gen.id}.zip`);
  if (!fs.existsSync(file)) continue;
  const buf = fs.readFileSync(file);
  const entries = readZipEntries(buf);
  const creditsEntry = entries.find((e) => e.name === 'CREDITS.md');
  if (!creditsEntry) continue;
  const text = readZipFile(buf, entries, 'CREDITS.md').toString('utf8');
  for (const m of gen.media) {
    if (!m.tracked) continue;
    if (!text.includes(m.path)) creditMismatch.push(`${gen.id}: ${m.path}`);
  }
}
assert(creditMismatch.length === 0, 'the credits name every media file they credit', creditMismatch.join(', '));

// ── 4. the page ─────────────────────────────────────────────────────────────
console.log('\n=== the page ===');
const page = fs.existsSync(PAGE) ? fs.readFileSync(PAGE, 'utf8') : '';
assert(!!page, 'generations.html exists');
assert(page.includes('/generations.json'), 'the page reads the generated data');
assert(page.includes('<swr-nav>'), 'the page mounts the shared nav');
assert(page.includes('<swr-footer>'), 'the page mounts the shared footer');
assert(/<main[\s>]/.test(page), 'the page has a main landmark');
assert(
  page.includes('https://sainted-word-records.vercel.app/generations'),
  'the page has one absolute canonical on its route',
);
assert(page.includes('og:image'), 'the page has an og:image');
// Every archive the data offers must be linked from the page's own data.
assert(
  data.generations.every((g) => g.credits.archive === `generations/${g.id}.zip`),
  'every generation points at its archive',
);

// ── 5. the route ────────────────────────────────────────────────────────────
console.log('\n=== the route ===');
const siteMap = JSON.parse(fs.readFileSync(path.join(ROOT, 'site-map.json'), 'utf8'));
const navHits = JSON.stringify(siteMap.nav).includes('/generations');
assert(navHits, 'site-map.json carries the route');
const vercel = JSON.parse(fs.readFileSync(path.join(ROOT, 'vercel.json'), 'utf8'));
const rewrite = (vercel.rewrites || []).some((r) => r.source === '/generations' && r.destination === '/generations.html');
assert(rewrite, 'vercel.json rewrites /generations to the page');
const sitemap = fs.existsSync(path.join(ROOT, 'sitemap.xml')) ? fs.readFileSync(path.join(ROOT, 'sitemap.xml'), 'utf8') : '';
assert(sitemap.includes('/generations<'), 'the sitemap lists the route');

console.log('\n' + (failures === 0
  ? 'GENERATIONS: ALL GREEN'
  : `GENERATIONS: ${failures} failure(s)`));
process.exit(failures === 0 ? 0 : 1);
