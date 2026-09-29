// versions/_fx-grade-inject.js — codemod: move each renderer's per-frame 2D
// ctx.filter grade chain onto the GPU pass in lib/gpu-grade.client.js.
//
// Why: the set renderers grade the layer with a CSS filter on the 2D context
// every frame. That chain is a full-frame software filter — measured ~19 ms of
// a ~27 ms frame on film.html, and 97.4 ms/frame vs 43.9 ms with the chain on
// the GPU. The renderers have no WebGL at all, so lib/gpu-grade.client.js is a
// dedicated grade pass (grade only — the engine's fx-postprocess.js shader is
// the persona composite and carries its own baseline look).
//
// What it does per page:
//   1. injects ../lib/gpu-grade.client.js at the end of body (marker-guarded, idempotent)
//   2. rewrites the single `ctx.filter = \`…\`` chain into FX.setGrade(…) with the
//      arguments mapped BY FILTER FUNCTION NAME (sepia / hue-rotate / brightness /
//      contrast / saturate), so order in the page does not matter.
//
// Pages whose grade is not a single plain `ctx.filter` chain (private `_ctx.`
// contexts, multiple chains, or a blur() the shader cannot match) are skipped
// and listed — they need a per-layer decision, not a codemod.
//
// Not loaded by any page. Run it manually:
//   node versions/_fx-grade-inject.js --dry-run
//   node versions/_fx-grade-inject.js
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR = path.dirname(fileURLToPath(import.meta.url));
const MARKER = '<!-- SWR-FX-GRADE-MARKER -->';
const TAG = MARKER + '\n<script src="../lib/gpu-grade.client.js"></script>';
const CHAIN_RE = /([A-Za-z-]+)\(([^()]*(?:\([^()]*\)[^()]*)*)\)/g;

const dry = process.argv.includes('--dry-run');
let changed = 0, skipped = 0;

for (const name of fs.readdirSync(DIR).filter((f) => f.endsWith('.html')).sort()) {
  const file = path.join(DIR, name);
  let src = fs.readFileSync(file, 'utf8');

  const filterLines = [...src.matchAll(/^ *([\w.$]+)\.filter = `([^`]+)`;/gm)];
  const plain = filterLines.filter((m) => /(^|\.)ctx$/.test(m[1]));
  const privateOnes = filterLines.filter((m) => /_ctx$/.test(m[1]));
  const blurs = plain.filter((m) => m[2].includes('blur('));

  if (plain.length !== 1 || privateOnes.length > 0 || blurs.length > 0) {
    const why = plain.length !== 1 ? `${plain.length} plain chain(s)` : privateOnes.length ? 'private _ctx chain' : 'blur() in chain';
    console.log(`skip: ${name} (${why})`);
    skipped++;
    continue;
  }

  const indent = plain[0][0].match(/^ */)[0];
  const chain = plain[0][2];
  const args = { sepia: '0', hue: '0', brightness: '1', contrast: '1', saturate: '1' };
  let seen = 0;
  for (const m of chain.matchAll(CHAIN_RE)) {
    const fn = m[1].toLowerCase();
    const raw = m[2].trim().replace(/deg$/, '').trim().replace(/^\$\{/, '').replace(/\}$/, '').trim();
    const key = fn === 'hue-rotate' ? 'hue' : fn === 'saturate' ? 'saturate' : fn;
    if (!(key in args)) continue;
    args[key] = raw;
    seen++;
  }
  if (seen === 0) { console.log(`skip: ${name} (no recognised filters in chain)`); skipped++; continue; }

  const call = `${indent}// GPU grade (lib/gpu-grade.client.js) — this chain used to run as a per-frame\n`
    + `${indent}// 2D ctx.filter, a full-frame software pass. Same maths, fragment shader.\n`
    + `${indent}if (window.SWR_GRADE && window.SWR_GRADE.set) window.SWR_GRADE.set(${args.sepia}, ${args.hue}, ${args.brightness}, ${args.contrast}, ${args.saturate});`;
  src = src.replace(plain[0][0], call);

  if (!src.includes(MARKER)) {
    const at = src.lastIndexOf('</body>');
    if (at === -1) { console.log(`skip: ${name} (no </body>)`); skipped++; continue; }
    src = src.slice(0, at) + TAG + '\n' + src.slice(at);
  }

  if (!dry) fs.writeFileSync(file, src);
  changed++;
  console.log(`grade: ${name}  setGrade(${args.sepia}, ${args.hue}, ${args.brightness}, ${args.contrast}, ${args.saturate})`);
}

console.log(`\n${dry ? '[dry-run] ' : ''}${changed} page(s) migrated, ${skipped} skipped`);
