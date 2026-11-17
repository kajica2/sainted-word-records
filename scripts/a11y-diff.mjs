#!/usr/bin/env node
// scripts/a11y-diff.mjs — compare two accessibility snapshots page by page.
//
// WHY
// ---
// scripts/check-a11y.mjs compares per-rule TOTALS against a baseline. A
// total is the wrong granularity for the question "did the code change the
// accessibility of the site?": 148 pages summed into one number cannot tell
// a real change on two pages from the same wobble spread thinly over 148.
//
// This script compares two snapshots (scripts/a11y-snapshot.mjs) and reports
// what moved, PER PAGE, with the elements that moved. It answers:
//   - which rule changed on which route
//   - by how many instances
//   - which elements the instances are (so a change can be located, not
//     just counted)
//
// It is a diagnosis tool, not a gate: it exits 0 whatever it finds.
//
// Usage:
//   node scripts/a11y-diff.mjs before.json after.json
//   node scripts/a11y-diff.mjs before.json after.json --rule label-content-name-mismatch
import { readFileSync } from 'node:fs';

const args = process.argv.slice(2);
const files = args.filter(a => !a.startsWith('--'));
const ruleIndex = args.indexOf('--rule');
const ONLY_RULE = ruleIndex >= 0 ? args[ruleIndex + 1] : null;

if (files.length < 2) {
  console.error('usage: node scripts/a11y-diff.mjs <before.json> <after.json> [--rule <id>]');
  process.exit(2);
}

const before = JSON.parse(readFileSync(files[0], 'utf8'));
const after = JSON.parse(readFileSync(files[1], 'utf8'));

console.log(`before: ${files[0]} — ${before.probed} pages measured, ${(before.skipped || []).length} skipped`);
console.log(`after:  ${files[1]} — ${after.probed} pages measured, ${(after.skipped || []).length} skipped`);

const routes = new Set([...Object.keys(before.pages || {}), ...Object.keys(after.pages || {})]);
const perRule = {};   // rule -> { before, after, delta, pages: [{route, before, after, delta, samples}] }
let moved = 0;

for (const route of routes) {
  const b = (before.pages || {})[route] || {};
  const a = (after.pages || {})[route] || {};
  const rules = new Set([...Object.keys(b), ...Object.keys(a)]);
  for (const id of rules) {
    if (ONLY_RULE && id !== ONLY_RULE) continue;
    const bn = b[id] ? b[id].n : 0;
    const an = a[id] ? a[id].n : 0;
    if (bn === an) continue;
    moved++;
    const r = (perRule[id] ||= { before: 0, after: 0, delta: 0, pages: [] });
    r.before += bn;
    r.after += an;
    r.delta += an - bn;
    r.pages.push({
      route,
      before: bn,
      after: an,
      delta: an - bn,
      beforeSamples: (b[id] && b[id].samples || []).map(s => s.target),
      afterSamples: (a[id] && a[id].samples || []).map(s => s.target),
    });
  }
}

if (!moved) {
  console.log('');
  console.log('NOTHING MOVED — the two snapshots agree page by page.');
  process.exit(0);
}

console.log('');
console.log(`${moved} page/rule pair(s) moved:`);
for (const [id, r] of Object.entries(perRule)) {
  console.log('');
  console.log(`  ${id}: ${r.before} -> ${r.after} (${r.delta >= 0 ? '+' : ''}${r.delta}) on ${r.pages.length} page(s)`);
  for (const p of r.pages) {
    console.log(`    ${p.route}: ${p.before} -> ${p.after} (${p.delta >= 0 ? '+' : ''}${p.delta})`);
    if (p.beforeSamples.length) console.log(`      before: ${p.beforeSamples.join(' | ')}`);
    if (p.afterSamples.length) console.log(`      after:  ${p.afterSamples.join(' | ')}`);
  }
}

// A rule that moved on EVERY page is a measurement artefact (a palette, a
// font, a theme), not a code change on any one page. Say so, because the
// difference matters when reading the numbers.
console.log('');
for (const [id, r] of Object.entries(perRule)) {
  if (r.pages.length > 10 && r.pages.length >= Math.min(before.probed, after.probed) * 0.8) {
    console.log(`  NOTE: ${id} moved on ${r.pages.length} pages — that is a site-wide measurement shift, not a localised change.`);
  }
}
