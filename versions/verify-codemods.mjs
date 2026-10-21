#!/usr/bin/env node
// versions/verify-codemods.mjs - the manifest half of the codemod contract.
//
// WHY THIS EXISTS (plan P0.5, "the 'I rebuilt it' #1")
// ---------------------------------------------------
// `versions/_*.js` are hand-run, source-to-source codemods that mutate
// `versions/*.html`. There is no record of which codemod processed which
// page, so:
//
//   - A page can carry a codemod's output while the codemod's own allowlist
//     no longer claims it (and nobody notices), or
//   - A codemod can be edited years later so it no longer matches the pages
//     it was applied to, and the only symptom is that re-running it "looks
//     like it would change something". Nobody re-runs it.
//
// `scripts/check-variant-codemods.mjs` already answers a slice of this
// ("codemod says inject -> marker must be present") with the target sets
// hardcoded in the script. This adds the missing half:
//
//   1. `versions/manifest.json` - declarative record of what applied to what,
//      including the codemods that are KNOWN NOT to be applied (pending).
//   2. This verifier - reads the manifest, re-runs every codemod against a
//      throwaway copy of the tree, and fails when reality disagrees with the
//      record.
//
// WHY A SANDBOX INSTEAD OF `--dry-run`
// -----------------------------------
// Only 4 of the 19 codemods honour `--dry-run` (the ones whose authors added
// it). The other 15 write unconditionally - `_shuffle-inject.js` and
// `_blend-shuffle.js` resolve their paths from `process.cwd()`, the rest from
// `__dirname`. So "re-run in dry-run mode" is not available as a strategy.
//
// Instead each codemod gets its own temp directory seeded with a copy of
// `versions/`, `tools/` and `auth/` (the three trees any codemod reads), is
// spawned with that directory as cwd, and the resulting file hashes are
// compared to the seed. A hash delta means "this codemod would rewrite this
// file today". The temp directory is deleted whether the run passes, fails
// or throws, so the verifier has NO side effects on the working tree and is
// safe to run from a gate or in a loop.
//
// Two codemods reach outside `versions/`: `_site-exit-inject.js` also patches
// `tools/` and `auth/`. Those pages get their own top-level `extra_pages`
// block in the manifest, same shape as `variants`.
//
// SEVERITY MODEL
// --------------
// FAIL (exit 1) - the record is wrong or the tree drifted unnoticed:
//   1. manifest unreadable / wrong schema id / missing required keys
//   2. a codemod named in the manifest has no script on disk, or a
//      `versions/_*.js` on disk is absent from the manifest
//   3. a page lists a codemod in `codemods_applied` whose marker is absent
//   4. a page carries a codemod's marker but does not list it in
//      `codemods_applied` (unmanaged drift - the rebuild nobody logged)
//   5. a page lists a codemod in `skipped` whose marker IS present
//   6. a codemod would rewrite a file that is not in its `pending` list
//   7. a `pending` entry is older than `pending_max_age_days` (debt clock)
//   8. a `known_findings` entry marked `"severity": "fail"` exists
//   9. a codemod's declared marker does not appear in the codemod's own
//      source - the manifest and the script disagree about what it emits,
//      which is what happens when someone edits the script after the fact
//      (opt out per codemod with `"markers_are_derived": true`, for a marker
//      assembled at runtime that grep cannot find)
//
// WARN (exit 0) - true but non-blocking, printed so it cannot rot unnoticed:
//   - a codemod is applied outside the `engines` allowlist it declares
//   - a page is `partial`: marker present, codemod would still rewrite it
//   - a codemod reported a skip/fix-needed diagnostic while writing nothing
//   - a `known_findings` entry marked `"severity": "warn"` exists
//
// `known_findings` is the manifest block for everything a codemod TELLS us
// that the marker checks cannot express: a page that has the overlay but no
// library wiring, a codemod whose idempotency guard no longer recognises its
// own output, a codemod that is dead. Each entry names a severity and a `since`
// date, so it is tracked debt rather than a comment in a codemod header.
//
// Usage:
//   node versions/verify-codemods.mjs            # verify only, writes nothing
//   node versions/verify-codemods.mjs --verbose  # per-page detail
//   node versions/verify-codemods.mjs --update   # rewrite the manifest from
//                                               # observed reality, then verify
//
// `--update` is the only mode that writes, and it writes exactly one file
// (`versions/manifest.json`).

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.dirname(HERE);
const MANIFEST_PATH = path.join(HERE, 'manifest.json');

const ARGS = process.argv.slice(2);
const UPDATE = ARGS.includes('--update');
const VERBOSE = ARGS.includes('--verbose');

// Trees a codemod may read or write. Copied into every sandbox. `versions/`
// is the codemod dir itself; `tools/` and `auth/` exist for
// _site-exit-inject.js, the one codemod that patches outside versions/.
const SANDBOX_TREES = ['versions', 'tools', 'auth'];

// Codemods run concurrently, each against its own temp dir. 4 is enough to
// hide the I/O without making a loaded CI runner thrash.
const CONCURRENCY = 4;

// Diagnostic lines a codemod prints when it declines a page. These are the
// codemod TELLING us it cannot handle the page - the opposite of drift -
// so they are surfaced as notes, never as failures.
const DIAGNOSTIC_RE = /(pattern not found|manual fix needed|not in scope|no recognised|no matchable|already patched|already has|skipped|skip:|not loaded by any page|anchor missing|no tone consumer)/i;

// ---------------------------------------------------------------- helpers

const failures = [];
const warnings = [];
// Low-priority context that would drown the WARN list if interleaved with it
// (e.g. one codemod applied to 11 pages its allowlist omits). Always printed
// after the failures so the actionable lines come first.
const notes = [];

function fail(msg) { failures.push(msg); }
function warn(msg) { warnings.push(msg); }

function readManifest() {
  if (!fs.existsSync(MANIFEST_PATH)) {
    fail(`no manifest at ${path.relative(ROOT, MANIFEST_PATH)} - run: node versions/verify-codemods.mjs --update`);
    return null;
  }
  let m;
  try {
    m = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
  } catch (e) {
    fail(`manifest is not valid JSON: ${e.message}`);
    return null;
  }
  if (m.schema !== 'swr-codemod-manifest/v1') {
    fail(`manifest schema is "${m.schema}", expected "swr-codemod-manifest/v1"`);
    return null;
  }
  for (const key of ['generated_at', 'ENGINES', 'codemods', 'variants']) {
    if (m[key] === undefined) { fail(`manifest is missing required key "${key}"`); return null; }
  }
  if (!Array.isArray(m.ENGINES) || typeof m.codemods !== 'object' || typeof m.variants !== 'object') {
    fail('manifest has the right keys but the wrong shapes (ENGINES must be an array, codemods/variants objects)');
    return null;
  }
  return m;
}

// sha1 per file, keyed by path relative to the tree root.
function hashTree(dir) {
  const out = new Map();
  const walk = (rel) => {
    const abs = path.join(dir, rel);
    for (const entry of fs.readdirSync(abs, { withFileTypes: true })) {
      const r = rel ? path.posix.join(rel, entry.name) : entry.name;
      if (entry.isDirectory()) {
        if (entry.name === 'node_modules' || entry.name === '.git') continue;
        walk(r);
      } else if (entry.isFile()) {
        out.set(r, crypto.createHash('sha1').update(fs.readFileSync(path.join(dir, r))).digest('hex'));
      }
    }
  };
  walk('');
  return out;
}

// Seed a throwaway tree. Returns its directory; caller removes it.
function seedSandbox() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'swr-codemod-'));
  for (const t of SANDBOX_TREES) {
    const src = path.join(ROOT, t);
    if (fs.existsSync(src)) fs.cpSync(src, path.join(dir, t), { recursive: true });
  }
  return dir;
}

// ------------------------------------------------------- codemod execution

// Runs one codemod against a private sandbox and reports what it would write.
// Never touches the working tree.
function runCodemodSandboxed(name, entry) {
  const sandbox = seedSandbox();
  try {
    const before = hashTree(sandbox);
    const scriptRel = entry.script;
    if (!fs.existsSync(path.join(sandbox, scriptRel))) {
      return { changed: [], exitCode: 1, stdout: '', error: `script not found: ${scriptRel}` };
    }
    // `--dry-run` is passed unconditionally: 4 codemods honour it, the rest
    // ignore the unknown flag and are contained by the sandbox either way.
    const r = spawnSync(process.execPath, [path.join(sandbox, scriptRel), '--dry-run'], {
      cwd: sandbox, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 60_000,
    });
    const after = hashTree(sandbox);
    const changed = [];
    for (const [rel, h] of after) if (before.get(rel) !== h) changed.push(rel);
    for (const rel of before.keys()) if (!after.has(rel)) changed.push(rel);
    return {
      changed: [...new Set(changed)].sort(),
      exitCode: r.status === null ? -1 : r.status,
      stdout: `${r.stdout || ''}${r.stderr || ''}`,
      error: r.status === null ? `timed out or killed by signal (${r.signal || 'unknown'})` : '',
    };
  } finally {
    fs.rmSync(sandbox, { recursive: true, force: true });
  }
}

async function mapPool(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      out[i] = await fn(items[i], i);
    }
  }));
  return out;
}

// -------------------------------------------------------------- reality

// The manifest has two page sections and they resolve against different
// roots: `variants` keys are filenames relative to versions/ (the codemod
// dir), `extra_pages` keys are repo-root-relative (`tools/hf-publish.html`).
const SECTION_BASE = { variants: HERE, extra_pages: ROOT };
const SECTIONS = ['variants', 'extra_pages'];

function absPage(section, key) {
  return path.join(SECTION_BASE[section], key);
}

function allPages(manifest) {
  const out = [];
  for (const s of SECTIONS) {
    for (const key of Object.keys(manifest[s] || {})) out.push({ section: s, key });
  }
  return out;
}

// Which codemods' markers does this file actually carry?
function appliedCodemods(entry, src) {
  const list = Array.isArray(entry.markers) ? entry.markers : [entry.markers];
  const hit = (mk) => Boolean(mk) && src.includes(mk);
  return entry.marker_mode === 'any' ? list.some(hit) : list.every(hit);
}

// Which codemods is this page CONTRACTED to have? Only the codemods whose
// declared `engines` allowlist names it. A `scope: "*"` codemod (one that
// decides for itself by inspecting the file) is deliberately excluded: for
// those, "not applied" is the codemod's own content-based decision and saying
// so on all 32 pages would be 32 copies of the same non-information. The
// marker checks cover those cases anyway.
//
// So `skipped` reads as "the contract covers this page and N codemods did not
// run here", which is empty on a fully-processed engine and non-empty only
// where something is genuinely outstanding.
function inScope(entry, pageKey) {
  if (!entry.engines || !entry.engines.length) return false;
  return entry.engines.includes(pageKey.replace(/\.html$/, ''));
}

function readPage(section, key) {
  const abs = absPage(section, key);
  if (!fs.existsSync(abs)) return null;
  return fs.readFileSync(abs, 'utf8');
}

// ----------------------------------------------------------------- checks

function checkManifestAgainstTree(manifest) {
  // 2. codemod inventory: manifest <-> disk, both directions.
  const onDisk = fs.readdirSync(HERE)
    .filter((f) => f.startsWith('_') && f.endsWith('.js'))
    .map((f) => f.replace(/\.js$/, ''))
    .sort();
  const declared = Object.keys(manifest.codemods).sort();
  for (const name of declared) {
    const entry = manifest.codemods[name];
    if (!fs.existsSync(path.join(ROOT, entry.script))) {
      fail(`codemod "${name}" declares script "${entry.script}" but that file does not exist`);
    }
    if (!entry.markers || (Array.isArray(entry.markers) && !entry.markers.length)) {
      fail(`codemod "${name}" has no marker - the manifest cannot verify it without one`);
    }
    // The marker must be something the script actually emits. If it is not in
    // the source, someone edited the codemod after the manifest was written.
    if (!entry.markers_are_derived) {
      const src = fs.readFileSync(path.join(ROOT, entry.script), 'utf8');
      for (const mk of [].concat(entry.markers || [])) {
        if (mk && !src.includes(mk)) {
          fail(`codemod "${name}" declares marker "${mk}" but that string is not in ${entry.script} - the manifest and the script disagree about what this codemod emits`);
        }
      }
    }
  }
  for (const name of onDisk) {
    if (!declared.includes(name)) {
      fail(`versions/${name}.js exists on disk but is not in the manifest - add it, then: node versions/verify-codemods.mjs --update`);
    }
  }

  // 3 / 4 / 5 + stale markers, per page.
  for (const { section, key: page } of allPages(manifest)) {
    const rec = manifest[section][page];
    const src = readPage(section, page);
    if (src === null) {
      fail(`page "${page}" is in the manifest but not on disk`);
      continue;
    }
    const entry = manifest.codemods;
    for (const name of rec.codemods_applied || []) {
      const cm = entry[name];
      if (!cm) { fail(`${page}: codemods_applied names unknown codemod "${name}"`); continue; }
      if (!appliedCodemods(cm, src)) {
        const mk = Array.isArray(cm.markers) ? cm.markers.join(' + ') : cm.markers;
        fail(`${page}: manifest says "${name}" applied but marker is MISSING -> ${mk}   (fix: node ${cm.script})`);
      }
    }
    for (const name of rec.skipped || []) {
      const cm = entry[name];
      if (!cm) { fail(`${page}: skipped names unknown codemod "${name}"`); continue; }
      if (appliedCodemods(cm, src)) {
        warn(`${page}: listed as skipped for "${name}" but the marker IS present - move it to codemods_applied (fix: node versions/verify-codemods.mjs --update)`);
      }
    }
    // 4. unmanaged drift, the case this gate exists for.
    for (const [name, cm] of Object.entries(entry)) {
      if ((rec.codemods_applied || []).includes(name)) continue;
      if (appliedCodemods(cm, src)) {
        fail(`${page}: carries "${name}" marker but the manifest does not list it in codemods_applied - unmanaged codemod output`);
      }
    }
  }

  // WARN: applied outside the codemod's own declared allowlist. Collected and
  // reported once per codemod rather than once per page: the historical
  // reality is that most of these codemods reached further than their
  // allowlist, and 40 near-identical lines would bury the findings that
  // actually need a human.
  for (const [name, cm] of Object.entries(manifest.codemods)) {
    if (cm.scope === '*' || !cm.engines || !cm.engines.length) continue;
    const strays = (cm.variants_processed || []).filter((p) => !cm.engines.includes(p.replace(/\.html$/, '')));
    if (strays.length) notes.push(`${name}: applied to ${strays.length} page(s) outside its engines list - ${strays.join(', ')}`);
  }
}

// Sandbox paths are repo-root-relative (`versions/neon.html`); manifest page
// keys are not (`neon.html` in `variants`, `tools/hf-publish.html` in
// `extra_pages`). One map, shared by the update and the verify path, so the
// two can never disagree about what a file is called.
function asKeys(manifest, changed) {
  const map = new Map(allPages(manifest).map((p) => [
    path.posix.join(p.section === 'variants' ? 'versions' : '.', p.key), p.key,
  ]));
  return changed.map((rel) => (map.has(rel) ? map.get(rel) : rel));
}

function reportDrift(name, cm, run, changedKeys) {
  const pendingSet = new Set((cm.pending || []).map((p) => (typeof p === 'string' ? p : p.file)));
  const partialSet = new Set(cm.partial || []);
  const processed = new Set(cm.variants_processed || []);
  const pendingNow = [];
  const partialNow = [];

  for (const key of changedKeys) {
    // Recorded as partial: the marker is present but the codemod would still
    // rewrite the page. Non-blocking, but it means the page is not actually
    // the codemod's output any more - a hand-edit landed between them.
    if (partialSet.has(key)) {
      partialNow.push(key);
      continue;
    }
    // Unmanaged partial application: the page looks done (marker present)
    // but the codemod disagrees, and nobody logged it.
    if (processed.has(key)) {
      fail(`${name}: "${key}" carries the marker yet a re-run would still rewrite it (partial application) and the manifest records no partial entry - fix the page, then: node versions/verify-codemods.mjs --update`);
      continue;
    }
    // Recorded as pending: known drift, not yet applied. Non-blocking, and
    // collapsed into one line per codemod below.
    if (pendingSet.has(key)) { pendingNow.push(key); continue; }
    fail(`${name}: would rewrite ${key} but the manifest records no pending drift for it - either run the codemod (node ${cm.script}) or record it: node versions/verify-codemods.mjs --update`);
  }
  if (pendingNow.length) {
    warn(`${name}: would rewrite ${pendingNow.length} file(s) registered as pending (known drift, not yet applied): ${pendingNow.join(', ')}`);
  }
  if (partialNow.length) {
    warn(`${name}: ${partialNow.length} file(s) are PARTIAL - marker present but a re-run would still rewrite them: ${partialNow.join(', ')}`);
  }

  // Bookkeeping that has gone stale: an entry registered as pending or partial
  // for a file the codemod no longer touches.
  for (const key of pendingSet) {
    if (!changedKeys.includes(key)) {
      warn(`${name}: pending entry "${key}" no longer drifts - refresh the manifest: node versions/verify-codemods.mjs --update`);
    }
  }
  for (const key of partialSet) {
    if (!changedKeys.includes(key)) {
      warn(`${name}: partial entry "${key}" no longer partially applies - refresh the manifest: node versions/verify-codemods.mjs --update`);
    }
    if (!processed.has(key)) {
      warn(`${name}: partial entry "${key}" is not in variants_processed - refresh the manifest: node versions/verify-codemods.mjs --update`);
    }
  }
  if (run.error) fail(`${name}: sandbox run failed - ${run.error}`);
  if (run.exitCode !== 0) {
    const diagnostics = run.stdout.split('\n').map((l) => l.trim()).filter((l) => DIAGNOSTIC_RE.test(l));
    if (diagnostics.length) {
      warn(`${name}: exit ${run.exitCode}, reported ${diagnostics.length} diagnostic line(s), first: ${diagnostics[0]}`);
    } else {
      warn(`${name}: exit ${run.exitCode} with no diagnostic line (first output: ${(run.stdout.split('\n').filter((l) => l.trim())[0] || '<none>').slice(0, 90)})`);
    }
  }
}

// ------------------------------------------------------------------- main

async function main() {
  let manifest = readManifest();
  if (!manifest) return emit(null);

  // Re-run every codemod against a throwaway tree. This is read-only with
  // respect to the repo, so it happens on both the verify and --update paths.
  const names = Object.keys(manifest.codemods);
  const runs = await mapPool(names, CONCURRENCY, (name) =>
    [name, runCodemodSandboxed(name, manifest.codemods[name])]);
  const runsBy = new Map(runs.map(([name, run]) => [name, run]));

  if (UPDATE) {
    // Reuse the sandbox runs we already paid for. Pending entries carry a
    // `since` stamp so the debt clock in the verify path can age them out; an
    // entry without `since` is bookkeeping only and never fails on age.
    const stamp = new Date().toISOString();
    const pages = allPages(manifest);

    for (const [name, run] of runsBy) {
      const cm = manifest.codemods[name];
      const processed = [];
      for (const { section, key } of pages) {
        const src = readPage(section, key);
        if (src !== null && appliedCodemods(cm, src)) processed.push(key);
      }
      cm.variants_processed = processed.sort();
      const changed = asKeys(manifest, run.changed);
      // pending  = the codemod would write it AND it carries no marker at all
      //            (never applied, or the output was reverted)
      // partial  = the codemod would write it AND the marker IS there
      //            (the anchor drifted from the codemod's own output, so a
      //            re-run is not a no-op even though the page looks done)
      cm.pending = changed
        .filter((key) => !processed.includes(key))
        .sort()
        .map((key) => ({ file: key, since: stamp, reason: cm.pending_reason || '' }));
      cm.partial = changed.filter((key) => processed.includes(key)).sort();
      cm.dry_run_flag = run.stdout.includes('[dry-run]') || run.stdout.includes('dry run');
    }

    // Reconcile the page sections with the tree BEFORE deriving records, in
    // both directions: add any versions/*.html that appeared since the last
    // update, drop any key whose file is gone. Prune by existence, NOT by
    // directory listing - only `variants` shares its key space with a
    // directory, `extra_pages` is a hand-listed set of repo-root-relative
    // paths (tools/, auth/) that a directory listing would never produce.
    if (manifest.variants) {
      for (const f of fs.readdirSync(HERE).filter((f) => f.endsWith('.html')).sort()) {
        if (!manifest.variants[f]) {
          manifest.variants[f] = { codemods_applied: [], skipped: [], last_verified: stamp };
        }
      }
    }
    for (const section of SECTIONS) {
      if (!manifest[section]) continue;
      manifest[section] = Object.fromEntries(
        Object.entries(manifest[section]).filter(([k, v]) => v && fs.existsSync(absPage(section, k))),
      );
    }

    // Per-page applied / skipped, per section (the two sections resolve
    // against different roots and must not be merged).
    for (const section of SECTIONS) {
      if (!manifest[section]) continue;
      for (const key of Object.keys(manifest[section])) {
        const src = readPage(section, key);
        if (src === null) continue;
        const applied = [];
        const skipped = [];
        for (const [name, cm] of Object.entries(manifest.codemods)) {
          const on = appliedCodemods(cm, src);
          if (on) applied.push(name);
          else if (inScope(cm, key)) skipped.push(name);
        }
        manifest[section][key] = {
          codemods_applied: applied.sort(),
          skipped: skipped.sort(),
          last_verified: stamp,
        };
      }
    }

    manifest.generated_at = stamp;
    manifest.generated_by = 'node versions/verify-codemods.mjs --update';
    if (typeof manifest.pending_max_age_days !== 'number') manifest.pending_max_age_days = 30;
    manifest.ENGINES = [...manifest.ENGINES].sort();
    fs.writeFileSync(MANIFEST_PATH, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
    console.log(`manifest rewritten: ${path.relative(ROOT, MANIFEST_PATH)}`);
    // The freshly written manifest is now the truth; re-read it so the
    // verification below runs against the file that will be committed.
    manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
    failures.length = 0;
    warnings.length = 0;
    notes.length = 0;
  }

  checkManifestAgainstTree(manifest);

  // 6 + 7: sandbox drift vs registered pending.
  const maxAge = typeof manifest.pending_max_age_days === 'number' ? manifest.pending_max_age_days : 30;
  const now = Date.now();
  for (const [name, run] of runsBy) {
    const cm = manifest.codemods[name];
    reportDrift(name, cm, run, asKeys(manifest, run.changed));
    for (const rel of cm.pending || []) {
      const rec = (typeof rel === 'string') ? null : rel;
      const since = rec && rec.since ? Date.parse(rec.since) : NaN;
      if (Number.isNaN(since)) continue; // recorded without a debt clock: a note, not a failure
      const days = (now - since) / 86_400_000;
      if (days > maxAge) {
        fail(`${name}: pending "${rec.file || rel}" is ${Math.floor(days)}d old (budget ${maxAge}d) - run the codemod (node ${cm.script}) or extend the budget deliberately`);
      }
    }
  }

  // 8: tracked findings. Everything a codemod reports that marker checks
  // cannot express lives here so it is a manifest entry with an owner and an
  // age, not a comment in a codemod header nobody reads.
  for (const f of manifest.known_findings || []) {
    const line = `finding "${f.id}": ${f.detail}`;
    if (f.severity === 'fail') fail(line);
    else warn(line);
    if (f.since && Number.isFinite(Date.parse(f.since))) {
      const days = (now - Date.parse(f.since)) / 86_400_000;
      if (days > maxAge) {
        fail(`finding "${f.id}" is ${Math.floor(days)}d old (budget ${maxAge}d)${f.escalate_to ? ` and is declared to escalate to fail` : ''}`);
      }
    }
  }

  emit(manifest, runsBy, maxAge);
}

function emit(manifest, runsBy, maxAge) {
  const line = '='.repeat(74);
  console.log('Codemod manifest verification');
  console.log(line);

  if (manifest) {
    const rows = Object.entries(manifest.codemods).map(([name, cm]) => ({
      name: name.replace(/^_/, '').replace(/-inject$/, ''),
      applied: (cm.variants_processed || []).length,
      partial: (cm.partial || []).length,
      pending: (cm.pending || []).length,
      dirty: runsBy && runsBy.get(name) ? runsBy.get(name).changed.length : 0,
    }));
    const w = [26, 9, 9, 9, 12];
    const cell = (c, i) => String(c).padEnd(w[i]);
    console.log(cell('codemod', 0) + cell('applied', 1) + cell('partial', 2) + cell('pending', 3) + cell('would-write', 4));
    console.log(w.map((x) => '-'.repeat(x)).join(''));
    for (const r of rows) {
      console.log(cell(r.name, 0) + cell(r.applied, 1) + cell(r.partial, 2) + cell(r.pending, 3) + cell(r.dirty, 4));
    }
    console.log('');
    const nExtra = Object.keys(manifest.extra_pages || {}).length;
    console.log(`manifest: ${path.relative(ROOT, MANIFEST_PATH)}  (${Object.keys(manifest.variants || {}).length} variants, ${nExtra} extra pages, generated ${manifest.generated_at})`);
    if (maxAge !== undefined) console.log(`pending budget: ${maxAge}d`);
  }

  if (VERBOSE && manifest) {
    console.log('');
    for (const { key, section } of allPages(manifest)) {
      const rec = manifest[section][key];
      console.log(`  ${key}: ${(rec.codemods_applied || []).length} applied, ${(rec.skipped || []).length} skipped`);
      console.log(`    applied: ${(rec.codemods_applied || []).join(', ') || '(none)'}`);
      if (rec.skipped && rec.skipped.length) console.log(`    skipped: ${rec.skipped.join(', ')}`);
    }
  }

  console.log('');
  for (const f of failures) console.log(`FAIL  ${f}`);
  if (failures.length) console.log('');

  for (const w of warnings) console.log(`WARN  ${w}`);
  if (warnings.length) console.log('');

  if (notes.length) {
    console.log(`NOTE  ${notes.length} contextual line(s):`);
    for (const n of notes) console.log(`      ${n}`);
    console.log('');
  }

  console.log(line);
  if (failures.length === 0) {
    const n = warnings.length;
    console.log(`PASS - manifest matches the tree (${n} warning${n === 1 ? '' : 's'})`);
    process.exit(0);
  }
  console.log(`FAIL - ${failures.length} problem${failures.length === 1 ? '' : 's'}`);
  console.log('  rebuild the record: node versions/verify-codemods.mjs --update');
  process.exit(1);
}

await main();
