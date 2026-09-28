#!/usr/bin/env node
// targeting-pipeline/build-voice-lint.mjs
//
// Emits targeting/voice-lint.json — the banned-phrase list the runtime voice
// guard uses on targeting-originated copy (PRD §7.6), extracted from the brand
// voice section of marketing/scripts/README.md.
//
// Extraction rule: every quoted span on a `- No "…"` bullet in the README.
// That is the README's own encoding of "these words are banned", so the
// artifact cannot drift from the source of truth without verify.mjs noticing
// (it re-runs the extraction and compares).
//
// Usage: node targeting-pipeline/build-voice-lint.mjs

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'marketing/scripts/README.md');
const OUT_DIR = path.join(ROOT, 'targeting');
const OUT_PATH = path.join(OUT_DIR, 'voice-lint.json');

export function extractBanned() {
  const text = fs.readFileSync(SRC, 'utf8');
  const banned = new Set();
  for (const line of text.split('\n')) {
    if (!/^-\s+No\s+["“]/.test(line)) continue;
    for (const m of line.matchAll(/["“]([^"”]+)["”]/g)) {
      const term = m[1].replace(/[.,;:]+$/, '').trim().toLowerCase();
      if (term) banned.add(term);
    }
  }
  if (banned.size === 0) throw new Error('no banned phrases extracted from marketing/scripts/README.md');
  return [...banned].sort();
}

export function buildVoiceLint() {
  return {
    version: 'swr-targeting-voice/v1',
    source: 'marketing/scripts/README.md',
    banned: extractBanned(),
    requiredIfCta: ['free', 'no signup'],
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const vl = buildVoiceLint();
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(OUT_PATH, JSON.stringify(vl, null, 2) + '\n');
  process.stdout.write(`[build-voice-lint] ${vl.banned.length} banned phrases → ${path.relative(ROOT, OUT_PATH)}\n`);
}
