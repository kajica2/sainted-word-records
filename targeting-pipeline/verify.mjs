#!/usr/bin/env node
// targeting-pipeline/verify.mjs — the gate for the targeting artifacts.
//
// Exits non-zero if ANY of the following is false. Mirrors preset-pipeline/
// verify.mjs in shape (generate → verify → commit) and check-dist-links.mjs in
// spirit (assert the generated surface actually agrees with the repo).
//
//   1. ontology has exactly 28 personas
//   2. segments has exactly 4 segments
//   3. every persona has a segment entry (total mapping) — and every segment
//      is claimed by at least one persona
//   4. every persona has a variant ordering that is a permutation of the
//      canonical #variant ids read from client/variant-switcher.client.js
//   5. every pinned transition id exists in engine-transitions.client.js
//   5b. personaToTransitions is total over the ontology: every persona has an
//      array entry, and an empty array is the explicit "no pins, default
//      order" fallback (no persona is silently uncovered)
//   6. every variant/transition referenced anywhere exists (0 orphans)
//   7. voice-lint.banned equals a fresh extraction from
//      marketing/scripts/README.md (drift detection, NFR-9)
//   8. every persona/segment banner note passes voice lint and carries a
//      CTA line containing "free" + "no signup" (PRD FR-19)
//   9. artifact sizes are inside the NFR-2 budget (≤ 200 KB combined)
//
// Usage: node targeting-pipeline/verify.mjs

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildRules, readVariantIds, readTransitionIds, surfaceCodes } from './build-rules.mjs';
import { buildVoiceLint } from './build-voice-lint.mjs';

const SURFACE_CODE = surfaceCodes();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const OUT_DIR = path.join(ROOT, 'targeting');

const EXPECTED_PERSONAS = 28;
const EXPECTED_SEGMENTS = 4;
const SIZE_BUDGET = 200 * 1024; // NFR-2

let failures = 0;
const ok = (msg, detail) => console.log('  ✓', msg, detail ? `(${detail})` : '');
const bad = (msg, detail) => { console.log('  ✗', msg, detail ? `(${detail})` : ''); failures += 1; };
const check = (cond, msg, detail) => (cond ? ok(msg, detail) : bad(msg, detail));

const readJSON = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));

function main() {
  const ontology = readJSON(path.join(OUT_DIR, 'ontology.json'));
  const segments = readJSON(path.join(OUT_DIR, 'segments.json'));
  const rules = readJSON(path.join(OUT_DIR, 'rules.json'));
  const voice = readJSON(path.join(OUT_DIR, 'voice-lint.json'));

  console.log('\n=== 1–2. artifact shape ===');
  check(ontology.personas.length === EXPECTED_PERSONAS,
    `${EXPECTED_PERSONAS} personas`, `got ${ontology.personas.length}`);
  check(segments.segments.length === EXPECTED_SEGMENTS,
    `${EXPECTED_SEGMENTS} segments`, `got ${segments.segments.length}`);

  console.log('\n=== 3. segment coverage (total + non-empty) ===');
  const segmentIds = segments.segments.map((s) => s.id);
  const missingMapping = ontology.personas.filter((p) => !(p.id in rules.personaToSegment)).map((p) => p.id);
  check(missingMapping.length === 0, 'every persona has a segment entry', missingMapping.join(', '));
  for (const seg of segmentIds) {
    const n = Object.values(rules.personaToSegment).filter((v) => v === seg).length;
    check(n >= 1, `segment "${seg}" has ≥1 persona`, `${n}`);
  }
  const badSeg = Object.entries(rules.personaToSegment)
    .filter(([, v]) => v !== null && !segmentIds.includes(v));
  check(badSeg.length === 0, 'no persona points at an unknown segment', badSeg.map(([k, v]) => `${k}→${v}`).join(', '));

  console.log('\n=== 4–6. variant + transition integrity (0 orphans) ===');
  const canonicalVariants = readVariantIds().sort();
  const canonicalTransitions = new Set(readTransitionIds());
  check(canonicalVariants.length > 0, 'variant ids read from variant-switcher', canonicalVariants.join(','));

  let orderBad = 0;
  for (const [pid, order] of Object.entries(rules.personaToVariants)) {
    const sorted = [...order].sort();
    if (sorted.length !== canonicalVariants.length || sorted.join(',') !== canonicalVariants.join(',')) {
      orderBad += 1;
    }
  }
  check(orderBad === 0, 'every persona variant ordering is a permutation of the canonical list', `${orderBad} bad`);

  const orphanVariants = Object.values(rules.personaToVariants)
    .flat().filter((v) => !canonicalVariants.includes(v));
  check(orphanVariants.length === 0, '0 orphan variants', [...new Set(orphanVariants)].join(', '));

  const orphanTransitions = Object.values(rules.personaToTransitions)
    .flat().filter((t) => !canonicalTransitions.has(t));
  check(orphanTransitions.length === 0, '0 orphan transitions', [...new Set(orphanTransitions)].join(', '));

  console.log('\n=== 4b. transition coverage (total, explicit fallback) ===');
  const missingTx = ontology.personas.filter((p) => !(p.id in rules.personaToTransitions)).map((p) => p.id);
  check(missingTx.length === 0, 'every persona has a transition entry', missingTx.join(', '));
  const badTxShape = Object.entries(rules.personaToTransitions).filter(([, v]) => !Array.isArray(v));
  check(badTxShape.length === 0, 'every transition entry is an array (empty = default order)',
    badTxShape.map(([k]) => k).join(', '));
  const pinnedCount = Object.values(rules.personaToTransitions).filter((v) => v.length > 0).length;
  check(pinnedCount >= 1, '≥1 persona pins transitions',
    `${pinnedCount} pinned, ${EXPECTED_PERSONAS - pinnedCount} use the empty default`);

  console.log('\n=== 7. voice-lint drift ===');
  const fresh = buildVoiceLint();
  check(JSON.stringify(fresh.banned) === JSON.stringify(voice.banned),
    'voice-lint matches README extraction',
    `${voice.banned.length} terms`);
  check(JSON.stringify(rules.banned) === JSON.stringify(voice.banned),
    'rules.banned mirrors voice-lint.banned (runtime copy is in sync)');
  check(Object.keys(rules.personaSurfaces || {}).length === EXPECTED_PERSONAS,
    'personaSurfaces covers every persona',
    `${Object.keys(rules.personaSurfaces || {}).length}`);
  const unmapped = [];
  for (const p of ontology.personas) {
    for (const w of p.surfaces) {
      if (!SURFACE_CODE[w]) unmapped.push(`${p.id}:${w}`);
    }
  }
  check(unmapped.length === 0, 'every persona surface word maps to a runtime code', unmapped.join(', '));

  console.log('\n=== 8. banner voice + CTA contract (FR-19) ===');
  const banned = voice.banned;
  let noteFail = 0;
  for (const [pid, note] of Object.entries(rules.personaToNote)) {
    if (!note) continue;
    const lower = note.toLowerCase();
    const hit = banned.find((b) => lower.includes(b));
    if (hit) { bad(`note for ${pid} contains banned term "${hit}"`); noteFail += 1; continue; }
    if (!(lower.includes('free') && lower.includes('no signup'))) {
      bad(`note for ${pid} missing "free" + "no signup" CTA`); noteFail += 1;
    }
  }
  check(noteFail === 0, 'every banner note passes voice + CTA lint',
    `${Object.values(rules.personaToNote).filter(Boolean).length} notes`);

  console.log('\n=== 9. NFR-2 size budget ===');
  let total = 0;
  for (const f of ['ontology.json', 'segments.json', 'rules.json', 'voice-lint.json']) {
    const bytes = fs.statSync(path.join(OUT_DIR, f)).size;
    total += bytes;
    ok(`${f}`, `${(bytes / 1024).toFixed(1)} KB`);
  }
  check(total <= SIZE_BUDGET, `combined ≤ ${(SIZE_BUDGET / 1024).toFixed(0)} KB`, `${(total / 1024).toFixed(1)} KB`);

  console.log('\n=== 10. regenerate-and-compare (build is deterministic) ===');
  const freshRules = buildRules();
  check(JSON.stringify(freshRules) === JSON.stringify(rules), 'rules.json matches a fresh build');

  console.log('\n' + (failures === 0
    ? 'TARGETING VERIFY: ALL GREEN'
    : `TARGETING VERIFY: ${failures} failure(s)`));
  process.exit(failures === 0 ? 0 : 1);
}

main();
