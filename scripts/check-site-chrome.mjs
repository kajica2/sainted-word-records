#!/usr/bin/env node
// scripts/check-site-chrome.mjs — the shared-chrome and IA gate.
//
// Every shipped public page must carry the same header and footer:
//   lib/nav.client.js    → <swr-nav>    (first element in <body>)
//   lib/footer.client.js → <swr-footer>
//   lib/design-tokens.css + lib/components.css (the styles both need)
// plus a unique <title>, a <meta name="description"> and a <main> landmark.
//
// Full-viewport app surfaces are the documented exception (a sticky marketing
// nav and a four-column footer inside a renderer fight the product). They must
// instead carry one exit link back to the site — the bug this gate was written
// after: the five core variants formed a closed loop and the two music-video
// cuts had no <a> at all, so a visitor could not reach the site.
//
// Also asserts that every site-map.json redirect has its 301 rule in vercel.json.
//
// Run: node scripts/check-site-chrome.mjs [--verbose]

import fs from 'node:fs';
import path from 'node:path';

const VERBOSE = process.argv.includes('--verbose');

const IGNORED_DIRS = new Set(['node_modules', 'dist', 'dist-dev', '_archive', 'score-app', '.git', '.worktrees', 'public', 'gallery-vintage']);

// Not deployed, not public, or deliberately chrome-free.
//   tools/ + auth/     — internal/dev tools and the auth flow: noindex, no marketing chrome
//   scripts/           — dev fixtures, never shipped (vite copyStatic skips scripts/)
//   persona-library    — internal decision memo
const IGNORED = [
  /^tools\//, /^auth\//, /^scripts\//, /^legal\//, /^shotlist\//,
];
const IGNORED_FILES = new Set([
  'offline.html',            // PWA fallback, shown by sw.js with no network
  'login.html',              // meta-refresh stub → /auth/login
  'persona-library.html',    // internal decision memo, not a public page
  'swr-intro-10s.html',      // render asset (bumper), not a page
  'market-study.html',       // deliberately not deployed (see AGENTS.md)
  'profit-plan.html',        // deliberately not deployed (see AGENTS.md)
]);

// Full-viewport app surfaces: their own chrome, one exit link required.
const APP_SURFACES = new Set([
  'engine.html',
  'dashboard.html',
]);
const VERSIONS_CONTENT = new Set(['index.html', 'console.html', 'gallery.html', 'music-video-gallery.html']);

// Pages where the shared header applies but the shared footer does not, each
// for a structural reason (measured, not assumed):
//   make-video / enhance / photo — full-viewport app shells: body{overflow:hidden}
//     and a 100vh grid, so a page footer would be unreachable. Their existing
//     <footer> elements are transport rows inside the app, not page footers.
//   ar-gif — its <footer> is the app grid's 44px status bar.
//   share-view — a full-viewport viewer opened from a link.
//   landing-personas-v* — the eleven persona landing registers cross-link each
//     other in their own footer; the shared footer cannot serve those links, so
//     they keep their bespoke one (the header is shared).
const FOOTER_OPTIONAL = new Set([
  '404.html',
  'share-view.html',
  'make-video.html',
  'enhance.html',
  'photo.html',
  'ar-gif.html',
  'spit.html',        // body{overflow:hidden} + .spit-stage{height:100vh} — an app shell
  'personas.html',    // its footer is the register index (persona-library + the 11 landing registers)
  'landing-personas-v1-editorial.html',
  'landing-personas-v2-dark.html',
  'landing-personas-v3-friendly.html',
  'landing-personas-v4-dashboard.html',
  'landing-personas-v5-brutalist.html',
  'landing-personas-v6-wireframe.html',
  'landing-personas-v7-riso.html',
  'landing-personas-v8-broadcast.html',
  'landing-personas-v9-cassette.html',
  'landing-personas-v10-neon.html',
  'landing-personas-v11-zine.html',
]);

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name.startsWith('.') && e.name !== '.') continue;
    if (e.isDirectory()) {
      if (IGNORED_DIRS.has(e.name)) continue;
      walk(path.join(dir, e.name), out);
    } else if (e.name.endsWith('.html')) {
      out.push(path.join(dir, e.name).replace(/^\.\//, ''));
    }
  }
  return out;
}

const failures = [];
const notes = [];
const fail = (file, msg) => failures.push(`${file}: ${msg}`);

function bodyOffset(html) {
  const headEnd = html.indexOf('</head>');
  const m = html.slice(headEnd >= 0 ? headEnd : 0).match(/<body[^>]*>/);
  return m ? (headEnd >= 0 ? headEnd : 0) + m.index + m[0].length : -1;
}
function countOutsideScripts(html, re) {
  const ranges = [];
  const sre = /<script[\s\S]*?<\/script>/gi;
  let m;
  while ((m = sre.exec(html))) ranges.push([m.index, m.index + m[0].length]);
  let count = 0;
  const fre = new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g');
  while ((m = fre.exec(html))) {
    if (!ranges.some(([a, b]) => m.index >= a && m.index < b)) count++;
  }
  return count;
}

const pages = walk('.').sort();
const siteMap = JSON.parse(fs.readFileSync('site-map.json', 'utf8'));

let checked = 0;
let appChecked = 0;

for (const file of pages) {
  if (IGNORED.some(re => re.test(file)) || IGNORED_FILES.has(file)) continue;
  const html = fs.readFileSync(file, 'utf8');
  const isVersionRenderer = file.startsWith('versions/') && !VERSIONS_CONTENT.has(file.slice('versions/'.length));
  const isApp = APP_SURFACES.has(file) || isVersionRenderer;

  if (isApp) {
    appChecked++;
    const hasExit = html.includes('swr-site-exit') ||
      /<a[^>]+href="(\/|\.\.\/|\.\.\/versions\.html|\/engine)"[^>]*>/i.test(html);
    if (!hasExit) fail(file, 'app surface has no exit link back to the site');
    continue;
  }

  checked++;

  // Header
  const navCount = countOutsideScripts(html, /<swr-nav\b[^>]*>\s*<\/swr-nav>/g);
  if (navCount === 0) fail(file, 'no <swr-nav> mount');
  else if (navCount > 1) fail(file, `${navCount} <swr-nav> mounts`);
  else {
    const at = bodyOffset(html);
    const navAt = html.indexOf('<swr-nav');
    if (at < 0) fail(file, 'no <body>');
    else if (navAt - at > 600) fail(file, `<swr-nav> is ${navAt - at} chars after <body> — it renders below the content`);
  }

  // Footer
  if (!FOOTER_OPTIONAL.has(file)) {
    if (!html.includes('<swr-footer')) fail(file, 'no <swr-footer> mount');
    if (!html.includes('/lib/footer.client.js')) fail(file, 'footer script not loaded');
  }

  // Shared styles + scripts
  for (const asset of ['/lib/design-tokens.css', '/lib/components.css', '/lib/nav.client.js']) {
    if (!html.includes(asset)) fail(file, `missing ${asset}`);
  }

  // Landmark + metadata
  if (!/<main[\s>]/.test(html)) fail(file, 'no <main> landmark');
  const title = (html.match(/<title>([^<]*)<\/title>/) || [, ''])[1].trim();
  if (!title) fail(file, 'empty <title>');
  const desc = (html.match(/<meta\s+name="description"\s+content="([^"]*)"/) || [, ''])[1].trim();
  if (!desc) fail(file, 'no meta description');
}

// Unique titles across the checked set
const byTitle = new Map();
for (const file of pages) {
  if (IGNORED.some(re => re.test(file)) || IGNORED_FILES.has(file)) continue;
  const t = (fs.readFileSync(file, 'utf8').match(/<title>([^<]*)<\/title>/) || [, ''])[1].trim();
  if (!t) continue;
  byTitle.set(t, [...(byTitle.get(t) || []), file]);
}
for (const [t, files] of byTitle) {
  if (files.length > 1) fail(files.slice(1).join(', '), `duplicate <title> "${t}" (also on ${files[0]})`);
}

// Redirect map must be live in vercel.json
const vercel = JSON.parse(fs.readFileSync('vercel.json', 'utf8'));
const sources = new Set(vercel.rewrites.map(r => r.source));
for (const r of (siteMap.redirects || [])) {
  const clean = r.from.replace(/^\//, '').replace(/\.html$/, '');
  for (const s of [`/${clean}`, `/${clean}/`, `/${clean}.html`]) {
    if (!sources.has(s)) fail('vercel.json', `missing redirect ${s} → ${r.to}`);
  }
}

console.log(`${checked} content pages + ${appChecked} app surfaces checked`);
console.log(`${failures.length === 0 ? '✓ all chrome checks passed' : '✗ ' + failures.length + ' problem(s)'}`);
if (failures.length) {
  for (const f of failures) console.log('  ✗ ' + f);
  process.exit(1);
}
if (VERBOSE) for (const n of notes) console.log('  · ' + n);
