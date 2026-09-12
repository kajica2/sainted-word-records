#!/usr/bin/env node
// scripts/check-chapter-states-unit.mjs — Chapter-states (P3.9) unit tests.
//
// Validates the static visual-identity lookup in
// client/chapter-states.client.js. Runs the module through a vm context
// seeded with a minimal `window` + a synthesized SWR_ANCHOR_MAP so we can
// confirm every anchor name resolves to a real preset in the registry.
//
//   node scripts/check-chapter-states-unit.mjs

import vm from 'node:vm';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..');
const SRC_PATH = path.join(ROOT, 'client/chapter-states.client.js');
const ANCHOR_SRC_PATH = path.join(ROOT, 'client/preset-anchor-map.client.js');

const REQUIRED_SECTIONS = ['intro', 'verse', 'prechorus', 'chorus', 'breakdown', 'outro'];
const REQUIRED_KEYS = ['anchors', 'chroma', 'grain', 'glow', 'motion', 'rotation', 'bloom'];
const UNIT_KEYS = ['chroma', 'grain', 'glow', 'motion', 'bloom']; // 0..1
const KNOWN_ANCHORS = [
  'film', 'grid', 'neon', 'smoke', 'hallucination', 'eclipse', 'aurora',
  'chrome', 'fractal', 'glitch', 'pulse', 'void', 'watercolor', 'baroque',
  'gallery', 'kraft', 'mosaic', 'phosphor', 'tape',
];

let failures = 0;
function assert(cond, msg, detail) {
  if (cond) {
    console.log('  ✓', msg, detail ? `(${detail})` : '');
  } else {
    console.log('  ✗', msg, detail ? `(${detail})` : '');
    failures += 1;
  }
}

function loadInContext() {
  const ctx = {
    window: {},
    console,
  };
  ctx.window.window = ctx.window;

  // Seed a minimal SWR_ANCHOR_MAP so chapter-states.client.js uses the
  // same global-script pattern as the rest of the engine.
  ctx.window.SWR_ANCHOR_MAP = {
    list: () => KNOWN_ANCHORS.slice(),
    get: (id) => (KNOWN_ANCHORS.includes(id) ? { id } : null),
  };

  vm.createContext(ctx);

  const src = fs.readFileSync(SRC_PATH, 'utf8');
  vm.runInContext(src, ctx);

  const ch = ctx.window.SWR_CHAPTERS;
  if (!ch) throw new Error('SWR_CHAPTERS not exposed on window');
  return ch;
}

function main() {
  // Sanity: anchor registry file must exist (we're testing integration with it).
  assert(fs.existsSync(ANCHOR_SRC_PATH),
    'preset-anchor-map.client.js present at expected path');

  const chapters = loadInContext();

  console.log('\n=== 1. Each canonical section exists ===');
  for (const section of REQUIRED_SECTIONS) {
    assert(chapters.STATES[section] !== undefined,
      `${section} present in STATES`);
  }
  assert(typeof chapters.get === 'function', 'get(section) is a function');
  assert(typeof chapters.list === 'function', 'list() is a function');
  const listed = chapters.list();
  assert(listed.length === REQUIRED_SECTIONS.length,
    `list() returns ${REQUIRED_SECTIONS.length} sections (got ${listed.length})`);
  for (const s of REQUIRED_SECTIONS) {
    assert(listed.includes(s), `list() includes ${s}`);
  }

  console.log('\n=== 2. Each entry has every required key ===');
  for (const section of REQUIRED_SECTIONS) {
    const entry = chapters.get(section);
    assert(entry !== null, `${section}.get() returns non-null`);
    for (const key of REQUIRED_KEYS) {
      assert(Object.prototype.hasOwnProperty.call(entry, key),
        `${section} has key '${key}'`);
    }
  }

  console.log('\n=== 3. Numeric channels are inside [0,1] (rotation excluded) ===');
  for (const section of REQUIRED_SECTIONS) {
    const entry = chapters.get(section);
    for (const key of UNIT_KEYS) {
      const v = entry[key];
      assert(typeof v === 'number' && v >= 0 && v <= 1,
        `${section}.${key} ∈ [0,1]`, `got ${v}`);
    }
    const rot = entry.rotation;
    assert(typeof rot === 'number' && rot >= -3 && rot <= 3,
      `${section}.rotation ∈ [-3,3]`, `got ${rot}`);
  }

  console.log('\n=== 4. Anchors are 3–4 strings, all registered in the preset map ===');
  for (const section of REQUIRED_SECTIONS) {
    const entry = chapters.get(section);
    const anchors = entry.anchors;
    assert(Array.isArray(anchors), `${section}.anchors is an array`);
    assert(anchors.length === 3 || anchors.length === 4,
      `${section}.anchors has 3–4 entries`, `got ${anchors.length}`);
    for (const a of anchors) {
      assert(typeof a === 'string' && a.length > 0,
        `${section}.anchors contains non-empty string`, `got ${JSON.stringify(a)}`);
      assert(KNOWN_ANCHORS.includes(a),
        `${section} anchor '${a}' exists in SWR_ANCHOR_MAP`);
    }
    // Anchors within a section should be distinct to avoid degenerate blends.
    const unique = new Set(anchors);
    assert(unique.size === anchors.length,
      `${section}.anchors are unique`, `got ${anchors.length - unique.size} dup(s)`);
  }

  console.log('\n=== 5. Emotional-arc progression (numerical sense) ===');
  const intro = chapters.get('intro');
  const verse = chapters.get('verse');
  const prechorus = chapters.get('prechorus');
  const chorus = chapters.get('chorus');
  const breakdown = chapters.get('breakdown');
  const outro = chapters.get('outro');
  // Peak energy: chorus chroma > prechorus > verse > intro.
  assert(chorus.chroma > prechorus.chroma,
    'chorus chroma > prechorus chroma',
    `${chorus.chroma} > ${prechorus.chroma}`);
  assert(prechorus.chroma > verse.chroma,
    'prechorus chroma > verse chroma',
    `${prechorus.chroma} > ${verse.chroma}`);
  assert(verse.chroma > intro.chroma,
    'verse chroma > intro chroma',
    `${verse.chroma} > ${intro.chroma}`);
  // Motion climbs then collapses.
  assert(chorus.motion > verse.motion,
    'chorus motion > verse motion',
    `${chorus.motion} > ${verse.motion}`);
  assert(breakdown.motion < intro.motion,
    'breakdown motion < intro motion (collapsed)',
    `${breakdown.motion} < ${intro.motion}`);
  // Outro eases back, lower than chorus but ≥ breakdown.
  assert(outro.motion < chorus.motion,
    'outro motion < chorus motion (resolving)',
    `${outro.motion} < ${chorus.motion}`);
  assert(outro.motion >= breakdown.motion,
    'outro motion ≥ breakdown motion (not dead-stop)',
    `${outro.motion} ≥ ${breakdown.motion}`);

  console.log('\n' + (failures === 0
    ? 'CHAPTER STATES UNIT: ALL GREEN (5 tests)'
    : `CHAPTER STATES UNIT: ${failures} failure(s)`));
  process.exit(failures === 0 ? 0 : 1);
}

try {
  main();
} catch (e) {
  console.error('CAUGHT:', e.stack);
  process.exit(2);
}
