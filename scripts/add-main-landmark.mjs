#!/usr/bin/env node
// scripts/add-main-landmark.mjs — give pages a <main> landmark.
//
// Usage:
//   node scripts/add-main-landmark.mjs [--dry-run] [--verbose] [files...]
//
// The shared nav's skip link targets #main (lib/nav.client.js assigns it to the
// first <main>), and the chrome gate (scripts/check-site-chrome.mjs) requires
// the landmark on every shipped content page. Most pages were written as a
// single top-level content wrapper — this converts THAT wrapper's tag pair
// rather than wrapping content in a new element, so no layout rule changes:
// the classes, ids and CSS selectors all stay exactly as they were.
//
// Candidates, in order: the first top-level <div class="wrap">, then
// <div class="container">, then <div id="app">. Pages with none of those are
// reported for manual handling and left untouched.
//
// Idempotent: pages that already have <main> are skipped.

import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const VERBOSE = args.includes('--verbose');
const fileArgs = args.filter(a => !a.startsWith('--'));

const IGNORED_DIRS = new Set(['node_modules', 'dist', 'dist-dev', '_archive', 'score-app', '.git', '.worktrees', 'public']);

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name.startsWith('.')) continue;
    if (e.isDirectory()) {
      if (IGNORED_DIRS.has(e.name)) continue;
      walk(path.join(dir, e.name), out);
    } else if (e.name.endsWith('.html')) out.push(path.join(dir, e.name).replace(/^\.\//, ''));
  }
  return out;
}

// Finds the matching </div> for the <div …> that starts at `start`, by depth.
function matchingDivClose(html, start) {
  const re = /<div\b|<\/div>/gi;
  re.lastIndex = start;
  let depth = 0;
  let m;
  while ((m = re.exec(html))) {
    if (m[0].startsWith('</')) {
      depth--;
      if (depth === 0) return m.index;
    } else depth++;
  }
  return -1;
}

const CANDIDATES = [
  /<div class="wrap"[^>]*>/,
  /<div class="container"[^>]*>/,
  /<div id="app"[^>]*>/,
];

// The variants and music-video cuts are full-viewport app surfaces: their #app
// wrapper carries page CSS (including `body > div` rules in some variants), and
// no landmark is required there — the chrome gate checks them for an exit link
// instead. Only these four files under versions/ are ordinary content pages.
const VERSIONS_CONTENT = new Set([
  'versions/index.html', 'versions/console.html',
  'versions/gallery.html', 'versions/music-video-gallery.html',
]);

const files = fileArgs.length ? fileArgs : walk('.').filter(f =>
  !(f.startsWith('versions/') && !VERSIONS_CONTENT.has(f)));
let converted = 0, skipped = 0, manual = [];

for (const file of files) {
  if (!fs.existsSync(file)) { manual.push(`${file} (missing)`); continue; }
  const html = fs.readFileSync(file, 'utf8');
  if (/<main[\s>]/.test(html)) { skipped++; continue; }

  let done = false;
  for (const re of CANDIDATES) {
    // Only the first occurrence — the top-level content wrapper.
    const m = html.match(re);
    if (!m) continue;
    const openAt = html.indexOf(m[0]);
    const closeAt = matchingDivClose(html, openAt);
    if (closeAt < 0) continue;
    const openTag = m[0].replace(/^<div/, '<main');
    const out = html.slice(0, openAt) + openTag + html.slice(openAt + m[0].length, closeAt) + '</main>' + html.slice(closeAt + '</div>'.length);
    // The wrapper must contain the page's headings — otherwise it is a stray
    // fragment (e.g. a modal template) and converting it would be wrong.
    const inner = out.slice(openAt + openTag.length, closeAt);
    if (!/<h1[\s>]/.test(inner) && !/<h2[\s>]/.test(inner)) continue;
    if (DRY_RUN) {
      console.log(`[dry-run] ${file}: <div${m[0].includes('id=') ? m[0].match(/id="[^"]*"/) : m[0].match(/class="[^"]*"/)}> → <main …>`);
    } else {
      fs.writeFileSync(file, out);
      console.log(`✓ ${file}: ${openTag.match(/(class|id)="[^"]*"/)[0]} is now <main>`);
    }
    converted++;
    done = true;
    break;
  }
  if (!done && !/<main[\s>]/.test(html)) manual.push(file);
}

console.log(`\n${DRY_RUN ? '[dry-run] ' : ''}${converted} converted, ${skipped} already had <main>, ${manual.length} need manual handling`);
if (manual.length && VERBOSE) console.log('  manual: ' + manual.join('\n  manual: '));
