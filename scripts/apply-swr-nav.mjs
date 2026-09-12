// scripts/apply-swr-nav.mjs — Replace existing <nav> blocks with <swr-nav>.
//
// Usage:
//   node scripts/apply-swr-nav.mjs [--dry-run] [--verbose] [files...]
//
// For each migrated page, finds the first <nav>...</nav> block and replaces
// it with <swr-nav></swr-nav>. The <swr-nav> Web Component (from
// /lib/nav.client.js) renders the unified navigation with theme toggle.
//
// Pages with app-specific nav (engine, marketplace, gallery, weddings,
// make-video) are excluded by default. Pass --include-apps to migrate them.
//
// Exit code 0 = success, 1 = error.

import fs from 'node:fs';

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const VERBOSE = args.includes('--verbose');
const INCLUDE_APPS = args.includes('--include-apps');

const fileArgs = args.filter(a => !a.startsWith('--'));

// App pages to skip
const APP_PAGES = [
  'engine.html', 'marketplace.html', 'gallery.html',
  'weddings.html', 'make-video.html', 'swr-app.html',
  'director-mode-sainted-word.html',
];

// Get list of files to process
let files = fileArgs;
if (files.length === 0) {
  // Find all HTML files that have both design-tokens.css AND a <nav> block
  const { execSync } = await import('node:child_process');
  const all = execSync('find . -name "*.html" -not -path "./node_modules/*" -not -path "./dist*/*" -not -path "./_archive/*"')
    .toString().trim().split('\n');
  files = all.filter(f => {
    const content = fs.readFileSync(f, 'utf8');
    return content.includes('design-tokens.css') && /<nav[\s>]/i.test(content);
  });
}

if (!INCLUDE_APPS) {
  files = files.filter(f => !APP_PAGES.includes(f.replace(/^\.\//, '')));
}

let replaced = 0;
let skipped = 0;

for (const file of files) {
  if (!fs.existsSync(file)) {
    if (VERBOSE) console.log(`⊘ ${file} (not found)`);
    skipped++;
    continue;
  }

  let html = fs.readFileSync(file, 'utf8');

  // Skip if already has <swr-nav>
  if (/<swr-nav/i.test(html)) {
    if (VERBOSE) console.log(`⊘ ${file} (already has <swr-nav>)`);
    skipped++;
    continue;
  }

  // Find first <nav ...>...</nav> block (non-greedy, handles nested)
  const navMatch = html.match(/<nav\b[^>]*>[\s\S]*?<\/nav>/i);
  if (!navMatch) {
    if (VERBOSE) console.log(`⊘ ${file} (no <nav> block)`);
    skipped++;
    continue;
  }

  const oldNav = navMatch[0];
  const newNav = '<swr-nav></swr-nav>';

  if (oldNav === newNav) {
    skipped++;
    continue;
  }

  html = html.replace(oldNav, newNav);

  if (DRY_RUN) {
    console.log(`[dry-run] ${file}: replace <nav> with <swr-nav>`);
  } else {
    fs.writeFileSync(file, html);
    console.log(`✓ ${file}`);
  }
  replaced++;
}

console.log(`\n${DRY_RUN ? '[dry-run] ' : ''}Summary: ${replaced} replaced, ${skipped} skipped`);
