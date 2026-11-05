#!/usr/bin/env node
// scripts/check-fx-doc-drift.mjs — the WebGL FX doc-vs-code drift gate.
//
// WHY
// ---
// README.md claims a number of WebGL effects and names them. The code has
// a canonical list — the uniform state block in fx-postprocess.js. When the
// two disagree, the README is a lie that a human believes, and nothing in
// the build can tell. That is the same failure mode check-doc-truth.mjs
// was built for, except check-doc-truth.mjs deliberately does NOT check
// counts ("they rot on every commit"), which is exactly why the FX count
// drifted in the first place.
//
// The nightly job in .github/workflows/factory.yml used to shell out to
// `grep -c 'class=' engine.html` as a proxy for the FX count. That counts
// markup classes — it returned 347 against a claimed 14, and it was never
// a proxy for anything. This script is the real check.
//
// WHAT IT CHECKS
// --------------
//   1. The README's "N WebGL FX" claim parses, and N matches the number of
//      names it lists (a self-inconsistent claim is a broken claim).
//   2. Every FX the README names exists in the code (fx-postprocess.js
//      state uniform, or an engine.html FX slider). A named effect that is
//      not there = a false claim = FAIL.
//   3. Every count claim in the README that mentions the FX pipeline agrees
//      with the first one ("14 WebGL FX" vs "WebGL 14-FX pipeline").
//   4. Effects the code has but the README does not mention = WARNING, not
//      failure. A doc that is incomplete is worth a line in the report; a
//      doc that is wrong is worth a red build.
//
// WHAT IT DELIBERATELY DOES NOT CHECK
// -----------------------------------
//   - The "20 stackable CSS filters" claim. There is no canonical list of
//     CSS filters in the tree to compare against, so nothing here can say
//     anything true about it. It stays unchecked on purpose — a check that
//     cannot fail is noise.
//
// Exit code 0 = no false claims, 1 = the README claims something the code
// does not have.

import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const README = resolve(ROOT, 'README.md');
const FX_SOURCE = resolve(ROOT, 'fx-postprocess.js');
const ENGINE = resolve(ROOT, 'engine.html');

let failed = 0;
let warned = 0;

const ok = (msg) => console.log(`✓ ${msg}`);
const bad = (msg) => {
  console.error(`✗ ${msg}`);
  failed++;
};
const warn = (msg) => {
  console.warn(`! ${msg}`);
  warned++;
};

if (!existsSync(README)) {
  console.error(`✗ README.md not found at ${README}`);
  process.exit(1);
}
if (!existsSync(FX_SOURCE)) {
  console.error(`✗ fx-postprocess.js not found at ${FX_SOURCE}`);
  process.exit(1);
}

const readme = readFileSync(README, 'utf8');
const fxSource = readFileSync(FX_SOURCE, 'utf8');
const engine = existsSync(ENGINE) ? readFileSync(ENGINE, 'utf8') : '';

// ------------------------------------------------------- the code's truth ---

// The uniform state block is the canonical list of what the FX pipeline
// can actually drive.
const stateStart = fxSource.indexOf('const state = {');
let codeFx = [];
if (stateStart === -1) {
  bad('could not find the `const state = {` block in fx-postprocess.js');
} else {
  const block = fxSource.slice(stateStart, fxSource.indexOf('};', stateStart));
  codeFx = [...block.matchAll(/^\s{4}([a-zA-Z][a-zA-Z0-9_]*):/gm)].map((m) => m[1]);
  ok(`fx-postprocess.js declares ${codeFx.length} state keys`);
}

// The sliders the engine actually exposes are a second source of truth:
// an effect with a slider in the UI is an effect a user can reach.
const sliderIds = new Set(
  [...engine.matchAll(/<input[^>]*\bid="([a-zA-Z][\w-]*)"[^>]*type="range"|<input[^>]*type="range"[^>]*\bid="([a-zA-Z][\w-]*)"/g)].map(
    (m) => m[1] || m[2],
  ),
);
const engineFxIds = new Set([...sliderIds].map((id) => id.replace(/-fx$/, '')));

// --------------------------------------------------- the README's claim ---

// "**14 WebGL FX** on a fullscreen quad: posterize, vignette, …"
const claim = readme.match(/\*\*(\d+)\s+WebGL FX\*\*[^\n:]*:\s*([^\n]+)/i);
if (!claim) {
  bad('could not find the "**N WebGL FX**: names" claim in README.md');
  console.error(`\n${failed} drift check(s) failed`);
  process.exit(1);
}

const claimedCount = Number(claim[1]);
const claimedNames = claim[2]
  .split(',')
  .map((s) => s.trim().replace(/[.`]/g, ''))
  .filter(Boolean);

ok(`README claims ${claimedCount} WebGL FX: ${claimedNames.join(', ')}`);

// 1. self-consistency: the count must match the number of names listed
if (claimedNames.length !== claimedCount) {
  bad(`README says ${claimedCount} WebGL FX but lists ${claimedNames.length} names`);
} else {
  ok(`the claim is self-consistent (${claimedCount} names listed)`);
}

// 2. every other count claim about the FX pipeline must agree
const pipelineClaims = [...readme.matchAll(/(\d+)-FX pipeline/g)].map((m) => Number(m[1]));
for (const n of pipelineClaims) {
  if (n !== claimedCount) {
    bad(`README says "WebGL ${n}-FX pipeline" in the file tree but "${claimedCount} WebGL FX" in the feature list`);
  }
}
if (pipelineClaims.length) {
  ok(`the file-tree claim (${pipelineClaims.join(', ')}-FX pipeline) agrees`);
}

// 3. every named effect must exist in the code
const known = new Set([...codeFx, ...engineFxIds]);
const missing = claimedNames.filter((name) => !known.has(name));
if (missing.length) {
  bad(`README names ${missing.length} effect(s) that the code does not have: ${missing.join(', ')}`);
} else {
  ok(`every claimed effect exists in the code`);
}

// 4. the reverse: code effects the README does not mention (warning only).
// Audio bands and engine switches share the state block with the effects —
// they are not effects, so they are not part of the claim.
const NOT_EFFECTS = new Set(['enabled', 'audioReact', 'time', 'bass', 'mid', 'treble', 'beat']);
const unmentioned = codeFx.filter((name) => !claimedNames.includes(name) && !NOT_EFFECTS.has(name));
if (unmentioned.length) {
  warn(`the code drives ${unmentioned.length} effect(s) the README does not mention: ${unmentioned.join(', ')}`);
} else {
  ok('the README names every effect the code drives');
}

// ------------------------------------------------------------------ verdict ---

if (failed) {
  console.error(`\n${failed} FX doc-drift check(s) failed — the README claims something the code does not have`);
  process.exit(1);
}
console.log(
  `✓ FX doc-drift OK — README and fx-postprocess.js agree on ${claimedCount} WebGL FX${warned ? ` (${warned} warning(s))` : ''}`,
);
