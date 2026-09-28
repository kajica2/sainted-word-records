#!/usr/bin/env node
// targeting-pipeline/parse-scripts.mjs
//
// Reads marketing/scripts/0N-<audience>.md (4 audience scripts) and emits
// targeting/segments.json — the four marketing segments the classifier maps a
// persona onto.
//
// The audience label is the first `# 0N — <Label>` heading of each script; the
// id is its kebab-case form. Nothing else in the script is parsed: the bodies
// are spoken copy, not data.
//
// Usage: node targeting-pipeline/parse-scripts.mjs

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const SRC_DIR = path.join(ROOT, 'marketing/scripts');
const OUT_DIR = path.join(ROOT, 'targeting');
const OUT_PATH = path.join(OUT_DIR, 'segments.json');

export function parseSegments() {
  const files = fs.readdirSync(SRC_DIR)
    .filter((f) => /^\d\d-.+\.md$/.test(f))
    .sort();

  const segments = [];
  for (const file of files) {
    const text = fs.readFileSync(path.join(SRC_DIR, file), 'utf8');
    const m = text.match(/^#\s+\d+\s+—\s+(.+)$/m);
    if (!m) throw new Error(`${file}: missing "# 0N — <Label>" heading`);
    const label = m[1].trim();
    const id = label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    segments.push({ id, label, script: `marketing/scripts/${file}` });
  }

  const ids = new Set(segments.map((s) => s.id));
  if (ids.size !== segments.length) throw new Error('duplicate segment id detected');
  return {
    version: 'swr-targeting-segments/v1',
    source: 'marketing/scripts/0N-*.md',
    segments,
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const segs = parseSegments();
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(OUT_PATH, JSON.stringify(segs, null, 2) + '\n');
  process.stdout.write(`[parse-scripts] ${segs.segments.length} segments → ${path.relative(ROOT, OUT_PATH)}\n`);
}
