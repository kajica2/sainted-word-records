#!/usr/bin/env node
// scripts/check-doc-truth.mjs - the doc-vs-code drift gate.
//
// WHY
// ---
// The 2026-10 architecture audit found 11 doc-vs-code drifts across 9
// files: three claims were factually wrong (an algorithm named as
// autocorrelation when it is an inter-onset-interval histogram, a
// "lazy-evict quota policy" that did not exist in any form, and a
// `versions/inject/<variant>.js` directory that has never existed), and
// the rest were stale counts and phantom paths. Every one of them had
// the same failure mode: a human believed a sentence, the sentence was
// wrong, and nothing in the build could tell.
//
// This is the fix. Mechanism, not prose: the claims stay prose, but CI now
// checks them against the tree, the same way check:dist-links checks that
// every rewrite in vercel.json resolves to a built file.
//
// WHAT IT CHECKS
// --------------
//   1. path  - an inline-code span that looks like a repo-relative file
//      (`lib/media-store.client.js`, `scripts/run-steps.mjs:44`) must
//      resolve on disk. A bare fragment (`run-steps.mjs` inside a sentence
//      about `scripts/`) resolves as a trailing-segment suffix, so
//      abbreviations are not false positives. A `file.js:120` citation
//      asserts the FILE, not the line number: stale line numbers are the
//      documented follow-up, because a 20-line move in a hot file would
//      red the gate for a reason nobody can act on.
//   2. dir   - a trailing-slash claim (`versions/inject/`) must be a real
//      directory. This is the check that catches a phantom module family.
//   3. glob  - `versions/_*.js` must match at least one file.
//   4. route - a root-relative span (`/lib/nav.client.js`, `/api/auth/magic`)
//      must be a shipped file, a vercel.json rewrite, or a serverless
//      handler under api/ (`<route>.js` or `<route>/index.js`).
//   5. ident - a library / API / global claim (`THREE.PropertyBinding`,
//      `navigator.storage`, `SWR_NAV`, `BroadcastChannel`) must appear in
//      the shipped source. Checked root-and-member rather than as one
//      literal string, because docs legitimately write shorthand: `FX.state`
//      means `window.FX.state`, and `THREE.NotARealBinding` still fails
//      because neither half of it is in the source.
//
// WHAT IT DELIBERATELY DOES NOT CHECK
// -----------------------------------
//   - Counts ("32 HTML files", "19 codemods", "63 steps"). Count claims
//     are a follow-up: they rot on every commit and the fix is a number,
//     not a mechanism.
//   - Prose semantics. "The engine is fast" is not verifiable and is not
//     this gate's job.
//   - Anything it cannot PROVE is wrong is skipped, never failed. A gate
//     that cries wolf gets deleted; a gate that hides what it ignores gets
//     trusted. The skip rules are enumerated below for exactly that reason.
//
// THE SKIP LIST (each rule covers real, legitimate prose)
// -------------------------------------------------------
//   - fenced code blocks: a doc shows sample output, it is not asserting
//   - sections under a future-work heading (Roadmap / Integration
//     Opportunities / Future / Backlog / TODO / Deferred): a proposal naming
//     a file that does not exist yet is the point of the section
//   - the same line as a negation ("There is no `api/health.js`"): docs
//     document absence by naming it
//   - placeholders (`<variant>.html`, `foo.js`, `YYYY-MM-DD`, `...`)
//   - globbed paths are checked AS globs, except namespace tails (`focus/*`)
//     and identifier families (`SWR_*`), which are naming conventions
//   - git branch names (`feat/...`, `fix/...`, `origin/main..HEAD`)
//   - build outputs and vendored trees (`dist/`, `node_modules/`, `.git/`)
//   - paths git ignores: their absence from a clean checkout proves
//     nothing, so a claim about one is unverifiable, not false
//   - dotted lowercase pseudocode (`l.asset.id`): a doc's own shorthand for
//     a value, not a reference into the source
//   - claims listed in ACCEPTED_DRIFT below, which prints on every run
//
// SELF-TEST
// ---------
// Once the drifts are FIXED the gate is trivially green, which is also how a
// check quietly dies. So it carries its own regression test: synthetic
// markdown through the same extractor and verifier, asserting that the
// detector still fires on the shapes the audit found and stays quiet on
// legitimate prose. `node scripts/check-doc-truth.mjs --self-test`.
//
// Run: node scripts/check-doc-truth.mjs [--verbose] [--list] [--self-test]

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// The current-state docs. Explicit, not a glob: docs/ also holds dated
// audits, sprint summaries and plan files that describe states which
// legitimately no longer exist, and a gate that fails on those gets muted.
// Adding a doc is a one-line change here.
//
// `examplesOnly` marks the two convention docs whose identifier-shaped
// tokens describe conventions and git tooling rather than shipped code:
// naming.md is made of specimens (`MAX_LAYERS`, `PascalCase`) and
// repo-hygiene.md is about branches and .git/hooks, which are untracked by
// definition. Path and route claims stay ON in both - only the identifier
// class is off, by design rather than by a pile of exceptions.
const CORPUS = [
  { doc: 'README.md' },
  { doc: 'AGENTS.md' },
  { doc: 'CLAUDE.md' },
  { doc: 'CONTRIBUTING.md' },
  { doc: 'SECURITY.md' },
  { doc: '.kai/conventions/architecture.md' },
  { doc: '.kai/conventions/coding-style.md' },
  { doc: '.kai/conventions/naming.md', examplesOnly: true },
  { doc: '.kai/conventions/repo-hygiene.md', examplesOnly: true },
  { doc: '.kai/conventions/testing.md' },
  { doc: 'docs/ARCHITECTURE.md' },
  { doc: 'docs/automix-architecture.md' },
  { doc: 'docs/DEV-SERVER.md' },
];

// Deliberately NOT scanned, so the omission is a decision on the record:
//   docs/plans/**, docs/*-AUDIT-*, docs/CHANGELOG-*, docs/status-*,
//   docs/SPRINT-SUMMARY.md, ANALYSIS_REPORT.md, OPTIMIZATION-AUDIT.md,
//   .kai/tech-debt/register.md (a branch ledger, nothing but `feat/...`),
//   .improvements/**, marketing/personas/** (pipeline input: editing one
//   requires `npm run targeting:build`, so it is not a docs change).

// Source dirs that are neither shipped nor asserted about.
const SKIP_DIRS = new Set([
  'node_modules', '.git', 'dist', 'dist-dev', '.vite', '.worktrees',
  '_archive', '.claude', '.Codex', '.agents', '.improvements',
  'score-app', 'output', 'out', 'public', '.hermes',
]);

const BUILD_SEGMENTS = new Set(['dist', 'dist-dev', 'node_modules', '.git', '.vite']);
const BRANCH_PREFIXES = new Set([
  'feat', 'fix', 'refactor', 'chore', 'docs', 'style', 'perf', 'auto',
  'sprint', 'focus', 'main', 'master', 'origin', 'develop', 'integration',
  'backup', 'hotfix',
]);
const EXAMPLE_RE = /\b(foo|bar|baz|qux|example|placeholder|yourname|your-name|xxx)\b/i;
const PLACEHOLDER_RE = /\.\.\.|\bYYYY\b|\bMM\b|\bDD\b/;
const FUTURE_HEADING_RE = /(roadmap|future|backlog|todo|not yet|deferred|improvement|integration opportunit|phase \d|what i will not)/i;
const NEGATION_RE = /\b(no|not|never|without|removed|deleted|gone|absent|instead of|rather than|does not|doesn't|didn't|isn't|wasn't|has no|have no|unused|un-used|dropped|retired|phased out)\b/i;

// An extension means "this token names a file", which is what separates a
// path claim from an identifier claim.
const SOURCE_EXT_RE = /\.(?:js|mjs|cjs|jsx|ts|tsx|html|css|json|md|sh|py|yml|yaml|toml|svg|webp|png|jpg|gif|webmanifest|txt|lock|xml)$/i;
// Only these are read (and joined) to check identifier claims. Markdown is
// deliberately excluded: it would triple the string for no gain, since the
// docs being checked are not the evidence for what the code uses.
const CONTENT_EXT_RE = /\.(?:js|mjs|cjs|jsx|ts|html|json)$/i;
// Dot-separated identifier, no slash: `engine.html`, `err.usage`, `FX.state`.
const DOTTED_SHAPE_RE = /^[A-Za-z_$][A-Za-z0-9_$]*(?:\.[A-Za-z0-9_$]+)*$/;
const SWR_GLOBAL_RE = /^SWR_[A-Z0-9_]+$/;
// Roots whose dotted form is a real web-platform reference rather than a
// doc's own pseudocode for a local variable.
const GLOBAL_ROOTS = new Set([
  'navigator', 'window', 'document', 'location', 'history', 'crypto',
  'caches', 'localStorage', 'sessionStorage', 'performance', 'console',
  'fetch', 'URL', 'Request', 'Response', 'Headers', 'Blob', 'File',
  'FileReader', 'Worker', 'Notification', 'WebSocket', 'EventSource',
]);
// Web platform APIs a doc may name as load-bearing. Curated rather than
// extracted: any ALL_CAPS token in a naming-convention doc is an EXAMPLE
// (`MAX_LAYERS`), not a claim, and guessing wrong there is a false positive
// the gate would carry forever.
const WEB_APIS = new Set([
  'BroadcastChannel', 'URLSearchParams', 'MediaRecorder', 'MediaStream',
  'getUserMedia', 'requestAnimationFrame', 'cancelAnimationFrame',
  'ResizeObserver', 'IntersectionObserver', 'MutationObserver',
  'PerformanceObserver', 'structuredClone', 'TextEncoder', 'TextDecoder',
  'AudioContext', 'OfflineAudioContext', 'AnalyserNode',
  'CanvasRenderingContext2D', 'WebGL2RenderingContext', 'IDBDatabase',
  'IDBTransaction', 'IDBObjectStore', 'indexedDB', 'localStorage',
  'sessionStorage', 'caches', 'crypto', 'navigator', 'location', 'history',
  'document', 'ImageBitmap', 'OffscreenCanvas', 'WritableStream',
]);

// Known-and-accepted drift. Each entry is a claim the gate CAN prove wrong
// but that is a backlog item rather than a doc bug, with the reason inline.
// Entries print on every run, so the ledger cannot quietly rot into "we
// fixed it": the reason has to keep making sense.
const ACCEPTED_DRIFT = [
  {
    // `doc` omitted means "this claim, in any scanned doc".
    doc: null,
    claim: 'TRUSTED_PROXIES',
    reason: 'documented-but-unimplemented env var; the audit files the mechanism as P3 (docs/PLANS/architecture-audit-2026-10.md)',
  },
];

// ---------------------------------------------------------------------------
// Tree index.
//
// Prefer `git ls-files`: "is this file in the repo" is exactly the question
// a doc claim asks, it is the same answer in CI and on a laptop, and it keeps
// local scratch files and node_modules out of the evidence. The filesystem
// walk is the fallback for a tarball with no .git, where "tracked" is not a
// question that can be answered. Content is read lazily and only for source
// extensions, so the path-only path stays cheap.
// ---------------------------------------------------------------------------

const files = new Set();
const dirs = new Set();
const byBase = new Map();      // 'run-steps.mjs'        -> [paths...]
const byTail2 = new Map();     // 'lib/verify-runner.mjs' -> [paths...]
let sourceText = null;

function addTo(map, key, value) {
  const list = map.get(key);
  if (list) list.push(value);
  else map.set(key, [value]);
}

function addFile(rel) {
  if (files.has(rel)) return;
  files.add(rel);
  const parts = rel.split('/');
  addTo(byBase, parts[parts.length - 1], rel);
  if (parts.length > 1) addTo(byTail2, parts.slice(-2).join('/'), rel);
  for (let i = 1; i < parts.length; i++) dirs.add(parts.slice(0, i).join('/'));
}

function walk(dir) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    if (SKIP_DIRS.has(e.name)) continue;
    const abs = path.join(dir, e.name);
    const rel = path.relative(ROOT, abs);
    if (e.isDirectory()) {
      dirs.add(rel);
      walk(abs);
    } else if (e.isFile()) {
      addFile(rel);
    }
  }
}

function buildIndex() {
  if (!gitAvailable()) { walk(ROOT); return; }
  let listed = '';
  try {
    listed = execFileSync('git', ['ls-files', '-z'], { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  } catch { walk(ROOT); return; }
  for (const rel of listed.split('\0')) if (rel) addFile(rel);
}

function corpusText() {
  if (sourceText !== null) return sourceText;
  const parts = [];
  for (const rel of files) {
    if (!CONTENT_EXT_RE.test(rel)) continue;
    // This file is excluded because it is the evidence under test: the
    // self-test fixtures name phantom identifiers, and a gate that can
    // prove itself right by quoting itself proves nothing.
    if (rel === path.relative(ROOT, fileURLToPath(import.meta.url))) continue;
    try { parts.push(fs.readFileSync(path.join(ROOT, rel), 'utf8')); } catch { /* unreadable */ }
  }
  sourceText = parts.join('\n');
  return sourceText;
}

const isFile = (rel) => files.has(rel);
const isDir = (rel) => dirs.has(rel);

// `run-steps.mjs` written inside a sentence about `scripts/` is a fragment of
// `scripts/run-steps.mjs`. Resolve trailing segments so abbreviations are not
// false positives; the doc is still wrong about where the file lives, but the
// claim "this module exists" is true, and that is what is being asserted.
function resolveFragment(rel) {
  if (isFile(rel)) return true;
  const parts = rel.split('/');
  if (parts.length > 1 && byTail2.has(parts.slice(-2).join('/'))) return true;
  return byBase.has(parts[parts.length - 1]);
}

function resolveFragmentDir(rel) {
  if (isDir(rel)) return true;
  const last = rel.split('/').pop();
  for (const d of dirs) if (d.split('/').pop() === last) return true;
  return false;
}

// A glob matches either a repo-relative path or a bare basename, because
// `recorder*` inside a sentence about `lib/` is the same claim as
// `lib/recorder*.js`.
function globMatches(pattern) {
  const star = pattern.indexOf('*');
  const pre = pattern.slice(0, star);
  const post = pattern.slice(star + 1);
  if (pattern.includes('/')) {
    for (const f of files) if (f.startsWith(pre) && f.endsWith(post)) return true;
    return false;
  }
  for (const base of byBase.keys()) if (base.startsWith(pre) && base.endsWith(post)) return true;
  return false;
}

let gitOk = null;
function gitAvailable() {
  if (gitOk === null) {
    try {
      execFileSync('git', ['rev-parse', '--git-dir'], { cwd: ROOT, stdio: 'ignore' });
      gitOk = true;
    } catch { gitOk = false; }
  }
  return gitOk;
}

const ignoreMemo = new Map();
// A claim about a path the repo deliberately ignores cannot be disproved from
// a clean checkout: the file may sit on the author's machine and still be
// absent in CI. Unverifiable is not the same as false.
function isIgnored(rel) {
  if (!gitAvailable()) return true;
  if (ignoreMemo.has(rel)) return ignoreMemo.get(rel);
  let ignored = false;
  try {
    execFileSync('git', ['check-ignore', '-q', '--', rel], { cwd: ROOT, stdio: 'ignore' });
    ignored = true;
  } catch { ignored = false; }
  ignoreMemo.set(rel, ignored);
  return ignored;
}

// ---------------------------------------------------------------------------
// Route claims: a served URL is a file, a rewrite, or a serverless handler.
// ---------------------------------------------------------------------------

let rewrites = null;
function getRewrites() {
  if (rewrites) return rewrites;
  rewrites = [];
  try {
    const v = JSON.parse(fs.readFileSync(path.join(ROOT, 'vercel.json'), 'utf8'));
    for (const r of v.rewrites || []) {
      if (typeof r.source !== 'string' || typeof r.destination !== 'string') continue;
      // :param and :param* both mean "one or more path segments here".
      const src = '^' + r.source
        .replace(/[.+?^${}()|[\]\\]/g, '\\$&')
        .replace(/:[A-Za-z_]+\*?/g, '[^/]+') + '/?$';
      rewrites.push(new RegExp(src));
    }
  } catch { /* no vercel.json: route claims fall back to files + handlers */ }
  return rewrites;
}

function routeResolves(url) {
  const rel = url.replace(/^\/+/, '').replace(/\/$/, '');
  if (!rel) return true;
  if (isFile(rel) || isFile(rel + '.html')) return true;
  if (isDir(rel) && isFile(rel + '/index.html')) return true;
  if (getRewrites().some((re) => re.test(url))) return true;
  if (rel.startsWith('api/')) {
    const base = rel.slice(4);
    return isFile(`api/${base}.js`) || isFile(`api/${base}/index.js`);
  }
  return false;
}

// ---------------------------------------------------------------------------
// Extraction
// ---------------------------------------------------------------------------

const TOKEN = /`([^`\n]{1,160})`/g;

/**
 * Classify one inline-code span into a claim, or null when it is prose.
 * Every `return null` here is a documented skip: see THE SKIP LIST above.
 */
function classify(raw, ctx = {}) {
  const trimmed = raw.trim();
  if (!trimmed || /\s/.test(trimmed)) return null;       // commands and phrases
  if (/^(https?:|mailto:|data:|npm |node |git |curl |cd |#|\$)/.test(trimmed)) return null;
  if (/[{}()|&$'"`?]/.test(trimmed)) return null;        // brace lists, queries, prose
  if (PLACEHOLDER_RE.test(trimmed)) return null;
  if (EXAMPLE_RE.test(trimmed)) return null;
  if (trimmed.includes('..')) return null;               // git ranges, path traversal
  if (trimmed.startsWith('.') || trimmed.startsWith('#')) return null;   // CSS classes, anchors
  if (trimmed.split('/').some((s) => s.includes(':'))) return null;      // npm scripts: check:syntax

  const t = trimmed.replace(/[.,;:)\]]+$/, '');
  const segments = t.split('/');
  if (segments.some((s) => /^\d+$/.test(s))) return null;   // `swr-edl/1` is an id
  if (segments.some((s) => BUILD_SEGMENTS.has(s))) return null;
  if (segments.length > 1 && BRANCH_PREFIXES.has(segments[0])) return null;

  // One wildcard is a claim about a family of paths, and a <templated>
  // segment is the same thing spelled differently. Two or more is not
  // resolvable here, so it is unproven rather than false.
  const wild = (t.match(/\*/g) || []).length;
  if (wild > 1) return null;
  let token = /<[^>]+>/.test(t) ? t.replace(/<[^>]+>/g, '*') : t;
  if (token.includes('*')) {
    if (token.slice(0, token.indexOf('*')).includes('.')) return null;  // `window.SWR_*`
    const trimmedSlash = token.endsWith('/') ? token.slice(0, -1) : token;
    if (trimmedSlash.includes('/')) {
      const tail = trimmedSlash.slice(trimmedSlash.lastIndexOf('/') + 1);
      if (tail === '*') return null;                       // a namespace (`focus/*`)
      return { kind: 'glob', value: trimmedSlash };
    }
    if (/^\*\./.test(token)) return null;                  // any extension (`*.sh`)
    if (SWR_GLOBAL_RE.test(token) || /^[A-Z]/.test(token)) return null;  // an identifier family
    return { kind: 'glob', value: token };                 // a basename family
  }
  if (token.includes('<')) return null;

  if (token.startsWith('/')) {
    if (token === '/' || token.startsWith('//')) return null;
    return { kind: 'route', value: token };
  }

  if (!token.includes('/')) {
    if (SWR_GLOBAL_RE.test(token) || WEB_APIS.has(token)) return { kind: 'ident', value: token };
    // An ALL_CAPS_WITH_UNDERSCORES token is either an env var or a config key
    // the doc says the code reads (`TRUSTED_PROXIES`, `SMTP_HOST`), so it is
    // checked - unless this doc is a naming-convention doc, where every such
    // token is a specimen.
    if (!ctx.examplesOnly && /^[A-Z][A-Z0-9]*_[A-Z0-9_]+$/.test(token)) return { kind: 'ident', value: token };
    if (token.includes('.') && DOTTED_SHAPE_RE.test(token)) {
      if (SOURCE_EXT_RE.test(token)) return pathClaim(token);   // engine.html, ci.yml
      const root = token.split('.')[0];
      // A lowercase root is the doc's own shorthand for a local value
      // (`l.asset.id`), not a reference into the source. A bare word with
      // no dot (`Makefile`, `PascalCase`) is prose about a naming
      // convention, not a reference at all.
      if (!/^[A-Z]/.test(root) && !GLOBAL_ROOTS.has(root)) return null;
      return { kind: 'ident', value: token };
    }
    return null;
  }

  if (token.endsWith('/')) {
    const bare = token.slice(0, -1);
    if (bare.split('/').pop() === '*') return null;        // `SWRC_DATA_DIR/storage/*/`
    return { kind: 'dir', value: bare };
  }

  const last = segments[segments.length - 1];
  if (last.startsWith('.')) return null;                   // an extension-only token
  if (!last.includes('.')) return null;                    // a bare name is not a path
  return pathClaim(token);
}

function pathClaim(token) {
  const m = /^(.*?):(\d+(?:-\d+)?)$/.exec(token);
  return { kind: 'path', value: m ? m[1] : token, cite: m ? m[2] : null };
}

function proseLines(md) {
  const out = [];
  let inFence = false;
  let fence = '';
  let futureLevel = null;
  for (const [i, text] of md.split('\n').entries()) {
    const fenceMatch = /^\s*(`{3,}|~{3,})/.exec(text);
    if (fenceMatch) {
      if (!inFence) { inFence = true; fence = fenceMatch[1][0]; }
      else if (fenceMatch[1][0] === fence) { inFence = false; }
      out.push(null);
      continue;
    }
    if (inFence) { out.push(null); continue; }
    const heading = /^(#{1,6})\s+(.*)$/.exec(text);
    if (heading) {
      const level = heading[1].length;
      if (futureLevel !== null && level <= futureLevel) futureLevel = null;
      if (FUTURE_HEADING_RE.test(heading[2])) futureLevel = level;
    }
    out.push({ line: i + 1, text, future: futureLevel !== null });
  }
  return out.filter(Boolean);
}

function extract(md, ctx = {}) {
  const claims = [];
  for (const { line, text, future } of proseLines(md)) {
    if (future) continue;
    if (NEGATION_RE.test(text)) continue;   // "There is no `api/health.js`"
    TOKEN.lastIndex = 0;
    let m;
    while ((m = TOKEN.exec(text))) {
      const claim = classify(m[1], ctx);
      if (claim) claims.push({ line, ...claim });
    }
  }
  return claims;
}

// ---------------------------------------------------------------------------
// Verification. Returns null when the claim holds, or a reason when it is
// provably wrong.
// ---------------------------------------------------------------------------

function verify(claim) {
  const value = claim.value;
  if (!value) return null;
  switch (claim.kind) {
    case 'path':
      if (resolveFragment(value)) return null;
      if (isIgnored(value)) return null;
      return `no such file: ${value}${claim.cite ? ` (cited :${claim.cite})` : ''}`;
    case 'dir':
      if (resolveFragmentDir(value)) return null;
      if (isIgnored(value)) return null;
      return `no such directory: ${value}`;
    case 'glob':
      if (globMatches(value)) return null;
      if (isIgnored(value.replace(/\*/g, 'x'))) return null;
      return `glob matches nothing: ${value}`;
    case 'route':
      if (routeResolves(value)) return null;
      if (isIgnored(value.replace(/^\//, ''))) return null;
      return `nothing serves this route: ${value}`;
    case 'ident': {
      // Root and member are checked separately, because `FX.state` is the
      // doc's shorthand for `window.FX.state`. Both halves must be real.
      const src = corpusText();
      for (const part of value.split('.')) {
        if (!src.includes(part)) return `identifier not found in the shipped source: ${value}`;
      }
      return null;
    }
    default:
      return null;
  }
}

function scan() {
  const drifts = [];
  const known = [];
  let checked = 0;
  const perDoc = new Map();
  for (const entry of CORPUS) {
    const doc = entry.doc;
    let md;
    try { md = fs.readFileSync(path.join(ROOT, doc), 'utf8'); } catch { continue; }
    let claims = 0;
    for (const claim of extract(md, entry)) {
      const reason = verify(claim);
      if (!reason) { checked++; claims++; continue; }
      const entry = { doc, line: claim.line, claim: claim.value, kind: claim.kind, reason };
      if (ACCEPTED_DRIFT.some((a) => (a.doc === null || a.doc === doc) && a.claim === claim.value)) known.push(entry);
      else drifts.push(entry);
    }
    perDoc.set(doc, claims);
  }
  return { drifts, known, checked, perDoc };
}

// ---------------------------------------------------------------------------
// Self-test: the detector's own regression test. Without it, fixing the audit
// drifts would leave a permanently green gate that may no longer detect
// anything - the worst outcome a CI check can have.
// ---------------------------------------------------------------------------

function selfTest() {
  const cases = [
    ['phantom directory (audit drift 3: versions/inject/)',
      'Per-variant behaviour comes from `versions/inject/`.', 'drift'],
    ['phantom templated path (audit drift 3, spelled the other way)',
      'Per-variant behaviour comes from `versions/inject/<variant>.js`.', 'drift'],
    ['phantom file (a renamed module)',
      'See `lib/tempo-detector.client.js` for the algorithm.', 'drift'],
    ['phantom library (an unimplemented API)',
      'The renderer calls `THREE.NotARealBinding` to bind the layer.', 'drift'],
    ['phantom route (a route nothing serves)',
      'The client posts to `/api/telemetry/ingest` for metrics.', 'drift'],
    ['real file (control: must stay quiet)',
      'See `lib/media-store.client.js` for the store.', 'ok'],
    ['real glob (control: must stay quiet)',
      'The codemods live in `versions/_*.js`.', 'ok'],
    ['bare basename glob (control: must stay quiet)',
      'The recorders live in `lib/`, named `recorder*`.', 'ok'],
    ['real route (control: must stay quiet)',
      'The nav fetches `/site-map.json` and links `/engine/`.', 'ok'],
    ['negated claim (control: must stay quiet)',
      'There is no `api/health.js`; the probe moved into `api/manifest.js`.', 'ok'],
    ['templated path (control: must stay quiet)',
      'Each `versions/<variant>.html` loads `engine-*.client.js`.', 'ok'],
    ['branch name (control: must stay quiet)',
      'Shipped from `feat/automix-arc`, not from `origin/main..HEAD`.', 'ok'],
    ['future-work section (control: must stay quiet)',
      '## Improvement Roadmap\n\nAdd a `client/automix-transitions.client.js` bridge.\n', 'ok'],
    ['pseudocode (control: must stay quiet)',
      'The composer sorts by `layer.reactors[0].target` and `l.asset.id`.', 'ok'],
  ];
  const failures = [];
  for (const [name, md, want] of cases) {
    const claims = extract(md);
    const fired = claims.some((claim) => verify(claim) !== null);
    if (fired !== (want === 'drift')) {
      failures.push(`${name}: expected ${want}, detector ${fired ? 'fired' : 'stayed quiet'}` +
        (claims.length ? ` (claims: ${claims.map((c) => `${c.kind}:${c.value}`).join(', ')})` : ' (no claims extracted)'));
    }
  }
  if (failures.length) {
    console.error('doc-truth self-test FAILED:');
    for (const f of failures) console.error('  x ' + f);
    return false;
  }
  const fires = cases.filter((c) => c[2] === 'drift').length;
  console.log(`\u2713 doc-truth self-test: ${cases.length} cases (${fires} must fire, ${cases.length - fires} must stay quiet)`);
  return true;
}

// ---------------------------------------------------------------------------

const argv = process.argv.slice(2);
const VERBOSE = argv.includes('--verbose');
const LIST = argv.includes('--list');

buildIndex();

if (argv.includes('--self-test')) process.exit(selfTest() ? 0 : 1);

if (LIST) {
  for (const entry of CORPUS) {
    let md;
    try { md = fs.readFileSync(path.join(ROOT, entry.doc), 'utf8'); } catch { continue; }
    for (const claim of extract(md, entry)) {
      console.log(`${entry.doc}:${claim.line}  ${claim.kind.padEnd(5)} ${claim.value}`);
    }
  }
  process.exit(0);
}

const { drifts, known, checked, perDoc } = scan();

if (VERBOSE) {
  for (const [doc, n] of perDoc) console.log(`  ${String(n).padStart(3)} claims  ${doc}`);
}
if (known.length) {
  console.log(`\nAccepted drift (${known.length}) - real, documented, not this commit's problem:`);
  for (const k of known) {
    const why = ACCEPTED_DRIFT.find((a) => (a.doc === null || a.doc === k.doc) && a.claim === k.claim);
    console.log(`  ~ ${k.doc}:${k.line}  ${k.claim}  (${why ? why.reason : 'accepted'})`);
  }
}

console.log(`\ndoc-truth: ${checked} claims verified across ${CORPUS.length} docs`);
if (drifts.length) {
  console.error(`\n${drifts.length} doc claim(s) contradicted by the source tree:\n`);
  for (const d of drifts) {
    console.error(`  x ${d.doc}:${d.line}  ${d.claim}`);
    console.error(`      ${d.reason}`);
    console.error('      Fix the doc. If the code really is gone on purpose, remove the claim;');
    console.error('      if it is a known backlog item, add it to ACCEPTED_DRIFT with a reason.');
  }
  process.exit(1);
}
console.log('doc-truth: every checked claim matches the source tree');
