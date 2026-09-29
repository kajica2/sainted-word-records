#!/usr/bin/env node
// scripts/check-register-data.mjs — the persona-register data gate.
//
// Every `landing-personas-v<name>.html` register renders its 8 personas from an
// inline `<script type="application/json" id="personas-data">` node (the copies
// are inlined rather than fetched so the registers work offline, matching the
// PWA shell ethos). Nothing stopped those copies from drifting away from
// `personas.json` — and they did: v5/v6 spelled `best_fit: false` where the
// canonical data omits the key, v1/v7..v11 add a local `byline`, v3 adds a
// local `tagline`, v5 adds seven local `sample_*` fields.
//
// This gate pins the part that must NOT drift: the canonical fields of all 8
// personas, in order. Register-local extras are allowed and stay allowed.
//
// Run: node scripts/check-register-data.mjs [--verbose]

import fs from 'node:fs';
import { execFileSync } from 'node:child_process';

const VERBOSE = process.argv.includes('--verbose');

// The fields personas.json owns. A register may add fields (byline, tagline,
// primitive, sample_* — local flavour) but may not change these.
const CANONICAL_FIELDS = ['name', 'body', 'icon', 'best_fit', 'tool'];

// `best_fit` is only present on the two fan favourites, so the canonical value
// of an absent key is `false` — v5/v6 spelling it out is not drift.
const canonValue = (persona, field) => (field === 'best_fit' ? Boolean(persona[field]) : persona[field]);
const project = (personas) =>
  personas.map((p) => JSON.stringify(CANONICAL_FIELDS.map((f) => canonValue(p, f))));

let canonical;
try {
  canonical = JSON.parse(fs.readFileSync('personas.json', 'utf8'));
} catch (e) {
  console.error(`✗ personas.json missing or invalid JSON: ${e.message}`);
  process.exit(1);
}
const canonPersonas = canonical.personas || [];
if (!canonPersonas.length) {
  console.error('✗ personas.json has no `personas` array');
  process.exit(1);
}
const expected = project(canonPersonas);

let registers = [];
try {
  registers = execFileSync('git', ['ls-files', 'landing-personas-v*.html'], { encoding: 'utf8' })
    .trim()
    .split('\n')
    .filter(Boolean)
    .sort();
} catch (e) {
  console.error(`✗ could not list registers: ${e.message}`);
  process.exit(1);
}
if (!registers.length) {
  console.log('(env skip: no landing-personas registers tracked)');
  process.exit(0);
}

const failures = [];
let checked = 0;
for (const file of registers) {
  // A register that was archived still lives in git history until the branch
  // lands, so only gate the ones that are present on disk.
  if (!fs.existsSync(file)) {
    if (VERBOSE) console.log(`⊘ ${file} (not checked out — skipped)`);
    continue;
  }
  const html = fs.readFileSync(file, 'utf8');
  checked++;
  const m = html.match(/<script type="application\/json" id="personas-data">([\s\S]*?)<\/script>/);
  if (!m) {
    failures.push(`${file}: no inline personas-data node`);
    continue;
  }
  let data;
  try {
    data = JSON.parse(m[1]);
  } catch (e) {
    failures.push(`${file}: personas-data is not valid JSON (${e.message})`);
    continue;
  }
  const got = project(data.personas || []);
  if (got.length !== expected.length) {
    failures.push(`${file}: ${got.length} personas, personas.json has ${expected.length}`);
    continue;
  }
  const diff = [];
  for (let i = 0; i < expected.length; i++) {
    if (got[i] === expected[i]) continue;
    const fields = CANONICAL_FIELDS.filter((f, k) => JSON.parse(got[i])[k] !== JSON.parse(expected[i])[k]);
    diff.push(`#${i + 1} "${canonPersonas[i].name}" differs in ${fields.join(', ')}`);
  }
  if (diff.length) failures.push(`${file}: ${diff.join('; ')}`);
  else if (VERBOSE) console.log(`✓ ${file} — 8 personas match personas.json (canonical fields)`);
}

if (failures.length) {
  console.error(`✗ register data drift (${failures.length}/${registers.length}):`);
  for (const f of failures) console.error(`    ${f}`);
  console.error('  Fix: copy the canonical fields from personas.json into the register\'s');
  console.error('  inlined personas-data node (local extras like byline/tagline may stay).');
  process.exit(1);
}
console.log(`✓ all ${checked} checked persona register(s) carry personas.json's 8 personas (canonical fields)${checked < registers.length ? ` — ${registers.length - checked} tracked file(s) not on disk (archived)` : ''}`);
