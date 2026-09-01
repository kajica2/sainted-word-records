#!/usr/bin/env node
// scripts/build-manifest.mjs — generate library/manifest.json from the actual
// files in library/ on disk. Ground-truth listing: walk the directory, emit
// one entry per file (excluding manifest.json itself and the audio/ subdir).
//
// Run with: node scripts/build-manifest.mjs
// The personaGroups field is NOT regenerated here — it's authored metadata.
// Pass --with-personas to seed it from the persona/*.png files (one group per
// persona number p16..p35, named by the second-to-last token in the filename).

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const LIBRARY = path.join(ROOT, 'library');

async function walk(dir, prefix, out) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const e of entries) {
    const full = path.join(dir, e.name);
    const rel = prefix ? `${prefix}/${e.name}` : e.name;
    if (e.isDirectory()) await walk(full, rel, out);
    else if (e.isFile()) out.push(rel);
  }
}

// Persona groupings by suffix token. Each persona PNG is named
// pNN-<family>-N.png (e.g. p26-neon-1.png). Group by family so all
// neon-1/neon-2 land in the same group. Falls back to "persona-NN" if
// we can't parse a family token.
function buildPersonaGroups(personaFiles) {
  const groups = {};
  for (const f of personaFiles) {
    const m = /persona\/p\d+-(.+?)-(\d+)\.png$/.exec(f);
    let key;
    if (m) {
      const family = m[1];
      // Map "neon"/"film"/"grid"/etc. to canonical group names
      key = family;
    } else {
      const m2 = /persona\/(p\d+)-/.exec(f);
      key = m2 ? m2[1] : 'misc';
    }
    if (!groups[key]) groups[key] = [];
    groups[key].push(f);
  }
  // Sort each group's paths for stable diffs
  for (const k of Object.keys(groups)) groups[k].sort();
  return groups;
}

async function main() {
  const files = [];
  await walk(LIBRARY, '', files);
  const visual = files
    .filter((f) => {
      if (f === 'manifest.json') return false;
      if (f.startsWith('.')) return false;
      if (f === 'audio' || f.startsWith('audio/')) return false;
      return true;
    })
    .sort();

  const out = { files: visual };
  if (process.argv.includes('--with-personas')) {
    const personaFiles = visual.filter((f) => f.startsWith('persona/'));
    out.personaGroups = buildPersonaGroups(personaFiles);
  }
  const json = JSON.stringify(out, null, 2) + '\n';
  await fs.writeFile(path.join(LIBRARY, 'manifest.json'), json, 'utf8');
  console.log(`Wrote library/manifest.json: ${visual.length} files` +
    (out.personaGroups ? `, ${Object.keys(out.personaGroups).length} persona groups` : ' (no persona groups — pass --with-personas to seed)'));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
