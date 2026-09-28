#!/usr/bin/env node
// targeting-pipeline/parse-personas.mjs
//
// Reads marketing/personas/full/<NNN>-<slug>.md (28 persona narratives) and
// emits targeting/ontology.json — the machine-readable persona list the
// runtime classifier keys off.
//
// Why this exists: the persona files are free-form markdown written for humans
// (Who they are / What they're trying to do / The surfaces they live in /
// A typical session) and there is no existing reader for them anywhere in the
// repo. This is the first one. Only the three structured header lines are
// parsed — **Slug:**, **Surfaces:**, **One-line:** — because those are the only
// lines the files actually guarantee.
//
// Usage: node targeting-pipeline/parse-personas.mjs

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const SRC_DIR = path.join(ROOT, 'marketing/personas/full');
const OUT_DIR = path.join(ROOT, 'targeting');
const OUT_PATH = path.join(OUT_DIR, 'ontology.json');

const NON_PERSONA = new Set(['README.md', 'CURRENT-STATE-MAP.md']);

function firstMatch(text, re) {
  const m = text.match(re);
  return m ? m[1].trim() : null;
}

export function parsePersonas() {
  const files = fs.readdirSync(SRC_DIR)
    .filter((f) => f.endsWith('.md') && !NON_PERSONA.has(f))
    .sort();

  const personas = [];
  for (const file of files) {
    const text = fs.readFileSync(path.join(SRC_DIR, file), 'utf8');
    const label = firstMatch(text, /^#\s+(.+)$/m);
    const slug = firstMatch(text, /^\*\*Slug:\*\*\s*(.+)$/m);
    const surfacesRaw = firstMatch(text, /^\*\*Surfaces:\*\*\s*(.+)$/m);
    const oneLine = firstMatch(text, /^\*\*One-line:\*\*\s*(.+)$/m);
    if (!slug) throw new Error(`${file}: missing **Slug:** line`);
    if (!surfacesRaw) throw new Error(`${file}: missing **Surfaces:** line`);
    const surfaces = surfacesRaw.split(',').map((s) => s.trim()).filter(Boolean);
    personas.push({
      id: slug,
      slug,
      label: label || slug,
      surfaces,
      oneLine,
      file: `marketing/personas/full/${file}`,
    });
  }

  const ids = new Set(personas.map((p) => p.id));
  if (ids.size !== personas.length) {
    throw new Error('duplicate persona slug detected');
  }
  return {
    version: 'swr-targeting-ontology/v1',
    source: 'marketing/personas/full/*.md',
    personas,
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const ontology = parsePersonas();
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(OUT_PATH, JSON.stringify(ontology, null, 2) + '\n');
  process.stdout.write(`[parse-personas] ${ontology.personas.length} personas → ${path.relative(ROOT, OUT_PATH)}\n`);
}
