#!/usr/bin/env node
// scripts/check-engine-parity.mjs — the shared-module contract gate.
//
// WHY
// ---
// The modules the engine and the variant pages share are written against
// PAGE globals: `window.Audio`, `window.Layers`, `window.setStatus`,
// `window.SWR_LAST_SONG` and so on. Every module that misses a dependency
// is written defensively (`if (!x) return`), so a page that loads a module
// without publishing what it needs does not throw — it renders a feature
// that quietly does nothing. That is the drift this gate exists to catch,
// and it is invisible to every other gate in the repo.
//
// The measurement behind it is in PR-engine-neon-parity.md (section 1.3):
// the contract table, and the divergence findings it produced.
//
// HOW IT WORKS
// ------------
// 1. The UNIVERSE of interesting globals. A global is interesting only if
//    some script in the repo publishes it (`window.X =`). Browser APIs
//    (`window.location`, `window.addEventListener`, …) are published
//    nowhere, so they drop out on their own — no blacklist to maintain.
//
// 2. What each page publishes. The page's script graph: its inline
//    scripts plus every external script it loads. A module publishes its
//    own globals, so a page that loads `lib/layers.client.js` publishes
//    `window.Layers`.
//
// 3. What each module needs. A module's dependency on X is a read of X
//    where X is in the universe, X is not published by the module itself,
//    and the read is not a property access on something else. Comments and
//    string literals are stripped first — without that, every identifier
//    in prose looks like a read and the gate drowns in false positives.
//
// 4. Two severities.
//      - HARD: every read of the global is unguarded, so a page that does
//        not publish it throws a TypeError at runtime.
//      - SOFT: the reads are guarded (`window.SWR_GRADE && …`, `typeof
//        window.setStatus === 'function'`), so the module degrades — the
//        feature silently does nothing.
//
// Both are failures. A soft failure is a feature that does not work, and
// the whole point of the contract is that it should.
//
// WHAT IT DOES NOT CHECK
// ----------------------
//   - Whether a module's feature is any good. It checks the wiring, not
//     the behaviour.
//   - Bare identifiers outside the contract set. A page-local helper is
//     not a contract, and scanning for every bare global matches ordinary
//     words in prose.
//   - Pages outside the scanned set.
//
// Run: node scripts/check-engine-parity.mjs [--verbose]

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const VERBOSE = process.argv.includes('--verbose');

// The shipped surfaces that share the module layer: the engine and every
// variant page. `versions/index.html` is the catalogue, not a renderer,
// but it loads the same chrome, so it is included.
const PAGE_FILES = [
  'engine.html',
  ...fs.readdirSync(path.join(ROOT, 'versions'))
    .filter((f) => f.endsWith('.html'))
    .sort()
    .map((f) => 'versions/' + f),
];

const SCRIPT_BLOCK = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
const WINDOW_ASSIGN = /\bwindow\.([A-Za-z_$][A-Za-z0-9_$]*)\s*=(?!=)/g;
const WINDOW_READ = /\bwindow\.([A-Za-z_$][A-Za-z0-9_$]*)/g;

// The contract globals a shared module may read BARE (no `window.` prefix).
const BARE_CONTRACT = new Set([
  'Audio', 'Library', 'Layers', 'setStatus', 'A', 'Lib',
  'VersionsPresets', 'AudioAnalysisV2', 'SWRTransitions', 'VC', 'UI',
]);

// A read is guarded when the code checks for the global's absence. These
// are the shapes the codebase actually uses.
const GUARD_BEFORE = [
  /\|\|\s*$/,          //  window.X || fallback
  /\?\?\s*$/,          //  window.X ?? fallback
  /&&\s*$/,            //  window.X && window.X.thing
  /typeof\s+$/,        //  typeof window.X === 'function'
  /!\s*$/,             //  if (!window.X)
  /\bif\s*\(\s*$/,     //  if (window.X)
  /\bif\s*\(\s*!\s*$/, //  if (!window.X)
];

const BARE_READ = /(^|[^.\w$])([A-Za-z_$][A-Za-z0-9_$]*)\b/g;
const LOCAL_DECL = /\b(?:var|let|const|function|class)\s+([A-Za-z_$][A-Za-z0-9_$]*)/g;

/**
 * Strip comments and string literals, keeping template interpolations
 * (they are real code). Without this, every identifier that appears in
 * prose looks like a read.
 */
function stripNoise(src) {
  let out = '';
  let i = 0;
  const n = src.length;
  while (i < n) {
    const c = src[i];
    const c2 = src[i + 1];
    if (c === '/' && c2 === '/') {
      while (i < n && src[i] !== '\n') i++;
      continue;
    }
    if (c === '/' && c2 === '*') {
      i += 2;
      while (i < n && !(src[i] === '*' && src[i + 1] === '/')) i++;
      i += 2;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') {
      const quote = c;
      out += ' ';
      i++;
      while (i < n) {
        if (src[i] === '\\') { i += 2; continue; }
        if (src[i] === quote) { i++; break; }
        if (quote === '`' && src[i] === '$' && src[i + 1] === '{') {
          let depth = 1;
          i += 2;
          const start = i;
          while (i < n && depth > 0) {
            if (src[i] === '{') depth++;
            else if (src[i] === '}') depth--;
            if (depth > 0) i++;
          }
          out += ' ' + src.slice(start, i) + ' ';
          i++;
          continue;
        }
        i++;
      }
      continue;
    }
    out += c;
    i++;
  }
  return out;
}

/**
 * The globals a module guards for — it checks for their absence somewhere
 * in the file, so it degrades rather than throwing.
 *
 * Positional analysis (is THIS read inside a guarded block?) is too fragile
 * to be worth the false alarms: a guard is often an early `if (!window.X)
 * { return; }` a hundred lines above the read, or a `typeof` test in
 * another function of the same module. What matters for the gate is the
 * question a reader actually has: does this module cope with the global
 * being absent, or does it assume it? A module that checks anywhere copes.
 */
function guardedGlobals(code) {
  const guarded = new Set();
  const patterns = [
    /typeof\s+window\.([A-Za-z_$][A-Za-z0-9_$]*)/g,
    /if\s*\([^)]*window\.([A-Za-z_$][A-Za-z0-9_$]*)/g,
    /window\.([A-Za-z_$][A-Za-z0-9_$]*)\s*(&&|\|\||\?\?)/g,
    /(&&|\|\|)\s*window\.([A-Za-z_$][A-Za-z0-9_$]*)/g,
    /!\s*window\.([A-Za-z_$][A-Za-z0-9_$]*)/g,
  ];
  for (const re of patterns) {
    let m;
    re.lastIndex = 0;
    while ((m = re.exec(code))) {
      guarded.add(m[1]);
      if (m.length > 2 && m[2]) guarded.add(m[2]);
    }
  }
  return guarded;
}

/**
 * Is the read dereferenced in place? `window.X.foo` and `window.X()` throw
 * when X is undefined; `var r = window.X` merely yields undefined, which
 * the caller can check. This is the difference between a page that breaks
 * and a page whose feature quietly does nothing.
 */
function isDereferenced(text, index, matchLength = 0) {
  const after = text.slice(index + matchLength);
  const m = /^\s*(.)\s*/.exec(after);
  if (!m) return false;
  return m[1] === '.' || m[1] === '(' || m[1] === '[';
}

function readFile(rel) {
  try {
    return fs.readFileSync(path.join(ROOT, rel), 'utf8');
  } catch (_) {
    return null;
  }
}

/** Resolve a <script src> to a repo-relative path, or null. */
function resolveSrc(src, fromPage) {
  const clean = src.split('?')[0].split('#')[0];
  if (!clean.endsWith('.js')) return null;
  if (clean.startsWith('/')) return clean.replace(/^\/+/, '');
  const rel = path.posix.join(path.posix.dirname(fromPage), clean);
  return fs.existsSync(path.join(ROOT, rel)) ? path.normalize(rel) : null;
}

/** The globals a file publishes: `window.X =` assignments. */
function publishedBy(file) {
  const body = readFile(file);
  if (body === null) return new Set();
  const out = new Set();
  let m;
  WINDOW_ASSIGN.lastIndex = 0;
  while ((m = WINDOW_ASSIGN.exec(stripNoise(body)))) out.add(m[1]);
  return out;
}

/** The external scripts a page loads, and its inline script bodies. */
function pageScripts(page) {
  const body = readFile(page);
  if (body === null) return { externals: [], inline: '' };
  const externals = [];
  let inline = '';
  let m;
  SCRIPT_BLOCK.lastIndex = 0;
  while ((m = SCRIPT_BLOCK.exec(body))) {
    const attrs = m[1] || '';
    const srcMatch = /\bsrc="([^"]+)"/.exec(attrs);
    if (srcMatch) {
      const rel = resolveSrc(srcMatch[1], page);
      if (rel) externals.push(rel);
    } else {
      inline += m[2] + '\n';
    }
  }
  return { externals, inline };
}

/** What a script body needs from the page, split by severity. */
function dependenciesOf(body, selfPublished, universe) {
  const code = stripNoise(body);
  const declared = new Set();
  let m;
  LOCAL_DECL.lastIndex = 0;
  while ((m = LOCAL_DECL.exec(code))) declared.add(m[1]);

  // Severity:
  //   HARD — the read is dereferenced in place (`window.X.foo`) and the
  //          module never checks whether the global exists, so a page
  //          that does not publish it throws a TypeError at runtime.
  //   SOFT — the module checks for the global somewhere, so it degrades:
  //          the feature silently does nothing.
  const guarded = guardedGlobals(code);
  const reads = new Map(); // name → { hard, soft }

  const note = (name, dereferenced) => {
    if (!universe.has(name)) return;
    if (selfPublished.has(name)) return;
    if (!reads.has(name)) reads.set(name, { hard: false, soft: false });
    const bucket = reads.get(name);
    if (guarded.has(name)) bucket.soft = true;
    else if (dereferenced) bucket.hard = true;
    else bucket.soft = true;
  };

  WINDOW_READ.lastIndex = 0;
  while ((m = WINDOW_READ.exec(code))) {
    note(m[1], isDereferenced(code, m.index, m[0].length));
  }

  // Bare reads count only for the contract globals — anything else is a
  // page-local helper, and scanning for those blindly matches ordinary
  // words in prose.
  BARE_READ.lastIndex = 0;
  while ((m = BARE_READ.exec(code))) {
    const name = m[2];
    if (!BARE_CONTRACT.has(name)) continue;
    if (declared.has(name)) continue;
    note(name, isDereferenced(code, m.index + m[1].length, m[2].length));
  }

  const hard = [];
  const soft = [];
  for (const [name, bucket] of reads) {
    if (bucket.hard) hard.push(name);
    else if (bucket.soft) soft.push(name);
  }
  return { hard: hard.sort(), soft: soft.sort() };
}

// The surfaces that carry the contract. The engine and the variant pages
// share one module layer; these two are the ones the parity work covers
// (PR-engine-neon-parity.md). The other variant pages are missing the
// contract too — the gate reports them, but making them green is their
// own job, not this gate's.
const CONTRACT_PAGES = new Set(['engine.html', 'versions/neon.html']);

// Dependencies a surface deliberately does not publish, and why. Each one
// is a decision, not an oversight — that is the difference between this
// list and the findings below it.
const ACCEPTED = [
  {
    page: 'engine.html',
    dep: 'SWR_RENDER',
    reason:
      'the engine has its own renderer (window.SWR.Renderer). Loading ' +
      'engine-render.client.js here would open a second render core; ' +
      'engine-settings.client.js reads it defensively and says so.',
  },
  {
    page: 'engine.html',
    dep: 'SWR_GRADE',
    reason:
      'the engine grades through its own FX context. ' +
      'lib/gpu-grade.client.js would open a second WebGL context; the ' +
      'watermark falls back to FX.outputCanvas.',
  },
  {
    page: 'engine.html',
    dep: 'SWR_GENOPS',
    reason:
      'the engine ships no generative-ops UI and has its own seeded RNG. ' +
      'The three modules that read it tolerate its absence.',
  },
  // The next three are capability probes, not contracts: engine-keys asks
  // whether the page HAS a JPG surface, an image lane or a host-rotate
  // binding, and acts accordingly. The pages that do not have those
  // features deliberately do not load their modules.
  {
    page: 'engine.html',
    dep: 'SWR_JPG',
    reason:
      'the engine ships no JPG surface. The module probes for it as a ' +
      'capability; the JPG surface lives on jpg.html and versions/play.html.',
  },
  {
    page: 'versions/neon.html',
    dep: 'SWR_JPG',
    reason:
      'neon ships no JPG surface. The module probes for it as a ' +
      'capability; the JPG surface lives on jpg.html and versions/play.html.',
  },
  {
    page: 'versions/neon.html',
    dep: 'SWR_IMAGE_LANE',
    reason:
      'the image lane is the engine still-image lane. Neon has no lane UI, ' +
      'and the module probes for it as a capability.',
  },
  {
    page: 'versions/neon.html',
    dep: 'SWR_KEYS_HOST_ROTATE',
    reason:
      'the engine publishes its own host-rotate binding so engine-keys can ' +
      'bind "R". Neon has no host to rotate.',
  },
];

const acceptedKey = (page, dep) => `${page}|${dep}`;

// ── build the universe ─────────────────────────────────────────────────────
// Every global any script in the repo publishes. Walk the whole tree: the
// publishers are not all under client/ or lib/ (versions-presets.js,
// audio-analysis-v2.js and engine-transitions.client.js live at the root).

const universe = new Set();
const allScripts = [];
(function collect(dir, base) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name.startsWith('.') || e.name === 'node_modules' || e.name === 'dist') continue;
    const rel = base ? base + '/' + e.name : e.name;
    if (e.isDirectory()) collect(path.join(dir, e.name), rel);
    else if (e.name.endsWith('.js')) allScripts.push(rel);
  }
})(ROOT, '');

for (const file of allScripts) {
  for (const g of publishedBy(file)) {
    // `_`- and `__`-prefixed names are private (a debug override, a host
    // hook, a signal between two modules that know each other), not part
    // of the contract between a page and a module.
    if (g.startsWith('_')) continue;
    universe.add(g);
  }
}

// ── what each page publishes ───────────────────────────────────────────────

const pageGraphs = new Map();
for (const page of PAGE_FILES) {
  const { externals, inline } = pageScripts(page);
  const published = new Set();
  for (const g of publishedBy(page)) published.add(g);
  let m;
  WINDOW_ASSIGN.lastIndex = 0;
  while ((m = WINDOW_ASSIGN.exec(stripNoise(inline)))) published.add(m[1]);
  for (const ext of externals) {
    for (const g of publishedBy(ext)) published.add(g);
  }
  pageGraphs.set(page, { externals, published });
}

// ── the check ──────────────────────────────────────────────────────────────

const failures = [];
let moduleCount = 0;
let dependencyCount = 0;

for (const [page, graph] of pageGraphs) {
  for (const mod of graph.externals) {
    const body = readFile(mod);
    if (body === null) continue;
    const selfPublished = publishedBy(mod);
    const { hard, soft } = dependenciesOf(body, selfPublished, universe);
    if (!hard.length && !soft.length) continue;
    moduleCount++;
    dependencyCount += hard.length + soft.length;
    for (const dep of hard) {
      if (graph.published.has(dep)) continue;
      failures.push({
        severity: 'HARD',
        page,
        module: mod,
        dep,
        why: 'every read of it is unguarded, so the module throws a TypeError on this page',
      });
    }
    for (const dep of soft) {
      if (graph.published.has(dep)) continue;
      failures.push({
        severity: 'SOFT',
        page,
        module: mod,
        dep,
        why: 'the reads are guarded, so the feature silently does nothing on this page',
      });
    }
  }
}

// ── report ─────────────────────────────────────────────────────────────────

const acceptedKeys = new Set(ACCEPTED.map((a) => acceptedKey(a.page, a.dep)));
const open = failures.filter((f) => !acceptedKeys.has(acceptedKey(f.page, f.dep)));
const hard = open.filter((f) => f.severity === 'HARD');
const soft = open.filter((f) => f.severity === 'SOFT');
const backlog = open.filter((f) => !CONTRACT_PAGES.has(f.page));

if (VERBOSE) {
  console.log(`pages: ${PAGE_FILES.length}  module graphs: ${moduleCount}  dependencies: ${dependencyCount}`);
  console.log(`universe: ${universe.size} published globals`);
}

const onContract = open.filter((f) => CONTRACT_PAGES.has(f.page));

if (onContract.length) {
  console.log(`\nShared-module contract violations on the contract surfaces: ${onContract.length}\n`);
  for (const f of onContract) {
    console.log(`  ${f.severity === 'HARD' ? '✗' : '·'} ${f.page}  ${f.module} → window.${f.dep}`);
  }
  console.log('');
  console.log('  HARD — the read is dereferenced and the module never checks for it, so the page throws.');
  console.log('  SOFT — the module checks for it, so the feature quietly does nothing.');
  console.log('');
} else {
  console.log('✓ the contract surfaces publish everything their modules read');
  console.log(`  (${[...CONTRACT_PAGES].join(', ')} — ${moduleCount} module graphs, ${dependencyCount} dependencies)`);
}

if (ACCEPTED.length) {
  console.log(`Accepted on purpose (${ACCEPTED.length}):`);
  for (const a of ACCEPTED) {
    console.log(`  · ${a.page} → window.${a.dep}: ${a.reason}`);
  }
  console.log('');
}

if (backlog.length) {
  const pages = new Set(backlog.map((f) => f.page));
  console.log(`Backlog — the other variant pages are missing the contract too (${backlog.length} findings across ${pages.size} pages).`);
  console.log('  Not a failure: making those pages carry the contract is their own job.');
  console.log('');
}

process.exit(onContract.length ? 1 : 0);
