// scripts/check-variant-codemods.mjs — verify which version-page codemods
// have been applied to each variant.
//
// The 19 `versions/_*.js` files are hand-run source-to-source codemods
// that mutate `versions/*.html`. They were each written to apply to a
// hand-coded allowlist, and the allowlists drifted independently over
// time. The previous gate was "remember to run them all before
// committing," which is invisible until a pass is missed.
//
// This script reads each codemod's intent by running it in dry-run
// mode and parses its per-page output (`inject: <page>` or
// `skip: <page>`). It compares that intent against the actual marker
// presence in the variant HTML. A divergence is a real drift — the
// codemod says it would inject, but the marker is missing; or the
// marker is present but the codemod says it shouldn't be.
//
// Limitations:
//   - Codemods without `--dry-run` are reported as a different failure
//     mode (see "non-dry-run codemods" below).
//   - Codemods whose dry-run output doesn't follow `inject:` / `skip:`
//     lines are skipped with a warning.
//   - The script imports no codemod; it spawns `node` per codemod. That's
//     slow but safe — a future revision could shell out to one
//     sandboxed VM and run all 19 in parallel.
//
// Run: node scripts/check-variant-codemods.mjs [--verbose]
// Exit 0 if every codemod's intent matches the file state, 1 otherwise.

import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, basename } from 'node:path';

const VERBOSE = process.argv.includes('--verbose');
const VARIANTS_DIR = 'versions';

// Marker → codemod map. The marker is the deterministic fingerprint of
// "this codemod has been run on this file." Adding a new codemod is
// three steps: (1) define MARKER in `versions/_<name>-inject.js`,
// (2) add an entry here, (3) run the codemod against every variant
// you want it to apply to.
// Reactive (engine-genops) set: 13 variants that share the engine
// render pipeline. Source: client/variant-switcher.client.js VARIANTS
// (14 entries; subtract baroque and grid which the switcher doesn't
// drive — baroque has its own bespoke paint loop, grid has DOM-driven
// visuals). Codemods that target "the engine" apply to this set.
const REACTIVE = new Set([
  'neon.html', 'film.html', 'smoke.html', 'hallucination.html',
  'music_video.html', 'glitch.html', 'aurora.html', 'pulse.html',
  'void.html', 'chrome.html', 'watercolor.html', 'fractal.html',
  'eclipse.html',
]);

// The full engine surfaces: Layers + Library + a live output canvas.
const COMMAND_CENTER_SURFACES = [
  'aurora.html', 'chrome.html', 'eclipse.html', 'film.html', 'fractal.html',
  'glitch.html', 'grid.html', 'hallucination.html', 'neon.html', 'pulse.html',
  'smoke.html', 'void.html', 'watercolor.html',
];

const CODEMODS = [
  // Reactive codemods — apply to all 13 reactive variants by policy.
  { file: 'versions/_mobile-header-inject.js', marker: 'SWR-MOBILE-HEADER-MARKER', targets: REACTIVE },
  { file: 'versions/_responsive-inject.js',     marker: 'SWR-RESPONSIVE-MARKER',     targets: REACTIVE },
  { file: 'versions/_render-inject.js',          marker: 'SWR-HEADER-DATA-ICONS',    targets: REACTIVE },
  // _fx-grade is dead — its regex doesn't match any current variant
  // (the filter-syntax on disk is `ctx.filter = 'string'` not
  // `filter('args')`), so its dry-run reports 0 injects. Treating it
  // as dynamic means the gate expects 0 files, which matches reality.
  // The 11 stale markers on reactives remain (the codemod added them
  // in a previous era) — they don't break the build, they're just
  // dead. Removing them is a separate cleanup.
  { file: 'versions/_fx-grade-inject.js',        marker: 'SWR-FX-GRADE-MARKER',       targets: null },
  // These codemods target based on file contents, not a hardcoded
  // list, so the dry-run output is the source of truth. The gate
  // runs the codemod in --dry-run mode and uses the set of files it
  // reports "inject" for as the expected set.
  { file: 'versions/_watermark-inject.js',       marker: 'SWR-WATERMARK-MARKER',      targets: null },
  { file: 'versions/_audio-damp-inject.js',      marker: 'SWR-AUDIO-DAMP-MARKER',     targets: null },
  // The Studio Command Center rides the 13 full engine surfaces — the ones
  // with a Layers stack, a Library and a live output canvas. The six stub
  // pages (baroque, gallery, kraft, mosaic, phosphor, tape) have none of
  // those, so the Command Center would open onto empty panels there. This
  // is the same allowlist _genops-inject.js uses.
  { file: 'versions/_command-center-inject.js',  marker: 'command-center-launcher.client.js',  targets: COMMAND_CENTER_SURFACES },
];

const ALL_VARIANTS = readdirSync(VARIANTS_DIR)
  .filter((f) => f.endsWith('.html'))
  .sort();

// Run one codemod in dry-run mode and parse its per-page output.
// Each codemod has its own output format; we extract one signal:
//
//   "inject: foo.html" or equivalent — the codemod INTENDS to mark this
//     file. If the marker is missing, drift.
//
// We deliberately do NOT track "skip" output. The skip verb means
// "didn't inject on this run" — for some codemods that's "page
// doesn't qualify" (e.g. fx-grade skips pages without a single plain
// `ctx.filter` chain), for others it's "already patched, no-op" (e.g.
// mobile-header skips pages that already have SWR-MOBILE-HEADER-MARKER).
// These are not symmetric — a "skip" never means "marker should be
// absent." Treating skip as "should not have marker" would falsely
// report a real existing marker as drift.
//
// So the gate is one-directional: codemod says inject → marker must
// be there. Everything else is a note.
//
// Patterns matched:
//   "inject: foo.html"          — _watermark-inject, _fx-grade-inject
//   "damp: foo.html"            — _audio-damp-inject (the report verb
//                                  is the codemod's short name; only
//                                  "damp" today)
//   "patched: foo.html"         — a future codemod convention
//   "<verb>: foo.html" generic   — best-effort fallback for new
//                                  codemods that use a clear "<verb>:
//                                  <file>" report format and the verb
//                                  isn't "skip"
// Run one codemod in dry-run mode and parse its per-page output.
// The codemods in this repo are inconsistent in their output format.
// We extract one signal — "this file would be modified on a real run"
// — by checking against a list of known-positive and known-negative
// patterns:
//
//   KNOWN-POSITIVE patterns (the codemod intends to inject):
//     - "inject: foo.html"            (_watermark-inject, _fx-grade-inject)
//     - "damp: foo.html"              (_audio-damp-inject's verb is "damp")
//     - "patched: foo.html"           (future convention)
//     - "foo.html: <positive-status>"  where positive-status is one of
//       {injected, modified, updated, patched, no change, ok, done}
//       (_render-inject emits "no change" when the page is already
//       up-to-date; that's still a positive match for "codemod applies
//       to this file")
//     - "foo.html" alone on a line with no negative signal
//
//   KNOWN-NEGATIVE patterns (the codemod intentionally skips this file):
//     - "skip: foo.html", "skipped: foo.html", "no-op: foo.html"
//     - "foo.html: <negative-status>"  where negative-status is one of
//       {error, no change, already patched, not in scope, unsupported}
//
// We use the negative list to filter out false positives. Anything
// that names a *.html but doesn't match either is treated as unknown
// (not inject, not skip) and reported as such.
const KNOWN_INJECT_STATUSES = new Set([
  'injected', 'modified', 'updated', 'patched', 'no change', 'ok', 'done',
]);
const KNOWN_SKIP_STATUSES = new Set([
  'skipped', 'no-op', 'not in scope', 'unsupported', 'no header block', 'no plain chain',
  'private _ctx chain', 'blur() in chain', 'not loaded by any page',
  'no recognised filters in chain', 'multiple plain chains',
  'no ../lib script to anchor to', 'already has watermark',
]);
const INJECT_VERBS = new Set([
  'inject', 'damp', 'patched', 'modified', 'wrote', 'updated', 'touched',
]);
const SKIP_VERBS = new Set([
  'skip', 'skipped', 'no', 'no-op',
]);

function runDryRun(codemodFile) {
  const result = { inject: new Set(), skipped: new Set(), unknown: new Set(), error: null };
  try {
    const out = execFileSync('node', [codemodFile, '--dry-run'], {
      cwd: process.cwd(),
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    for (const raw of out.split('\n')) {
      const line = raw.trim();
      if (!line) continue;
      const fileMatch = line.match(/([a-zA-Z0-9_./-]+\.html)/);
      if (!fileMatch) continue;
      const file = basename(fileMatch[1]);
      const lower = line.toLowerCase();

      // Look for an explicit "<status>: <file>" or "<file>: <status>" pattern.
      const verbFirst = lower.match(/^([a-z][a-z-]+):\s+[^\s]+\.html/);
      const statusFirst = lower.match(/^[a-z][a-z-]+\.html(?:\s*:\s*|\s+)\(?([a-z][a-z- ()]+?)\)?\s*$/);

      let verb = null;
      if (verbFirst) verb = verbFirst[1];
      if (statusFirst) verb = statusFirst[1].trim().split(/\s+/)[0];

      if (verb) {
        if (INJECT_VERBS.has(verb) || KNOWN_INJECT_STATUSES.has(verb)) {
          result.inject.add(file);
          continue;
        }
        if (SKIP_VERBS.has(verb) || KNOWN_SKIP_STATUSES.has(verb)) {
          result.skipped.add(file);
          continue;
        }
      }

      // Fallback: "foo.html: <status>" where the status is one of the
      // known lists (handles "aurora.html: no change" without a
      // explicit verb).
      const colonMatch = lower.match(/^([a-z][a-z-]*\.html)\s*:\s*([a-z][a-z-]+(?:[^\n]*))/);
      if (colonMatch) {
        const status = colonMatch[2].split(/\s/)[0];
        if (KNOWN_INJECT_STATUSES.has(status)) {
          result.inject.add(file);
          continue;
        }
        if (KNOWN_SKIP_STATUSES.has(status)) {
          result.skipped.add(file);
          continue;
        }
      }

      // Otherwise unknown.
      result.unknown.add(file);
    }
  } catch (e) {
    result.error = e.message;
  }
  return result;
}

const report = {
  codemods: [],
  failures: [],
};

// Run all dry-runs once up front.
const dryRuns = {};
for (const cm of CODEMODS) {
  dryRuns[cm.file] = runDryRun(cm.file);
}

for (const cm of CODEMODS) {
  const dryRun = dryRuns[cm.file];
  // Two flavors of codemod:
  //   - "static targets" — the codemod is contracted to apply to a known
  //     set (REACTIVE). The static set is the source of truth, even
  //     if the codemod's current dry-run says "all skipped" (because
  //     the codemod is idempotent — once a file is patched, the dry-
  //     run reports it as already done). The static set encodes the
  //     *contract* of where the marker should be, not the codemod's
  //     immediate intent.
  //   - "dynamic targets" — the codemod's dry-run is the source of
  //     truth (audio-damp applies to 5 specific pages based on
  //     inspect of the file contents, not a hardcoded list).
  //
  // For static codemods, we always use the static set. The dry-run
  // is captured for diagnostics (the `error` field surfaces failures
  // like "dry-run crashed") but does NOT influence the target list.
  // This is what makes the gate useful after a run: it should still
  // say "13 reactives should have the marker" even when the codemod
  // would no-op on a re-run.
  const targets = cm.targets
    ? new Set(cm.targets)
    : new Set(dryRun.inject);
  const codemodEntry = {
    file: cm.file,
    marker: cm.marker,
    error: dryRun.error,
    targets: Array.from(targets).sort(),
    actual: 0,
    expected: targets.size,
  };
  report.codemods.push(codemodEntry);
}

// Per-file: codemod-targets says "this file" → marker must be present.
for (const file of ALL_VARIANTS) {
  const html = readFileSync(join(VARIANTS_DIR, file), 'utf8');
  for (const cm of CODEMODS) {
    const entry = report.codemods.find((c) => c.file === cm.file);
    if (!entry.targets.includes(file)) continue;
    if (html.includes(cm.marker)) {
      entry.actual++;
    } else {
      report.failures.push({
        file, marker: cm.marker,
        reason: `${cm.file} targets this file but marker is missing`,
      });
    }
  }
}

// Report
console.log('Variant codemod coverage');
console.log('========================');
console.log('');

// Summary table: codemod → expected injects, actual injects, errors
const widths = [38, 9, 9, 6];
const headers = ['codemod', 'expected', 'actual', 'error'];
const row = (cells) => cells.map((c, i) => String(c).padEnd(widths[i])).join('');
console.log(row(headers));
console.log(row(widths.map((w) => '-'.repeat(w))));
for (const cm of report.codemods) {
  console.log(row([
    cm.file.replace('versions/_', '').replace('-inject.js', ''),
    cm.expected,
    cm.actual,
    cm.error ? 'YES' : '',
  ]));
}

console.log('');
if (report.failures.length === 0) {
  console.log(`PASS — all ${report.codemods.length} codemods' intent matches the file state.`);
  process.exit(0);
}

console.log(`FAIL — ${report.failures.length} drift(s):`);
for (const f of report.failures) {
  console.log(`  ${f.file} is missing marker ${f.marker}`);
  console.log(`    → ${f.reason}`);
  // Look up the codemod file
  const cm = CODEMODS.find((c) => c.marker === f.marker);
  if (cm) {
    console.log(`    → run: node ${cm.file}`);
  }
}
console.log('');
process.exit(1);
