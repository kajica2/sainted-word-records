// scripts/migrate-html.mjs — Migrate HTML pages to use shared design system.
//
// Usage:
//   node scripts/migrate-html.mjs [--dry-run] [--verbose] [--force] [files...]
//
// For each page in site-map.json (or specified files):
//   1. Adds <link rel="stylesheet" href="/lib/design-tokens.css"> to <head>
//   2. Adds <link rel="stylesheet" href="/lib/components.css"> to <head>
//   3. Adds <script src="/lib/nav.client.js" defer></script> before </body>
//   4. Removes duplicate theme bootstrap scripts (keeps shared one in nav)
//   5. Optionally replaces <nav> blocks with <swr-nav> (--apply-nav flag)
//
// Pages with app-specific themes (engine.html, versions/*.html, make-video.html,
// marketplace.html, gallery.html, weddings.html) are SKIPPED by default to
// preserve their distinct designs. Pass --include-apps to migrate them too.
//
// Exit code 0 = success, 1 = error.

import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const VERBOSE = args.includes('--verbose');
const FORCE = args.includes('--force');
const APPLY_NAV = args.includes('--apply-nav');
const INCLUDE_APPS = args.includes('--include-apps');

// Extract file arguments (non-flags)
const fileArgs = args.filter(a => !a.startsWith('--'));

const SITE_MAP = 'site-map.json';

// Pages to skip (app-specific themes, would break with shared CSS)
const APP_PAGES = [
  'engine.html',
  'marketplace.html',
  'gallery.html',
  'weddings.html',
  'make-video.html',
];

// Load site-map.json
let siteMap;
try {
  siteMap = JSON.parse(fs.readFileSync(SITE_MAP, 'utf8'));
} catch (e) {
  console.error(`✗ ${SITE_MAP} missing or invalid JSON: ${e.message}`);
  process.exit(1);
}

// Build list of pages to migrate
let pagesToMigrate = [];
if (fileArgs.length > 0) {
  pagesToMigrate = fileArgs;
} else {
  // Collect all pages from site-map
  function collectPaths(items) {
    if (!Array.isArray(items)) return;
    for (const item of items) {
      if (item.href) {
        const clean = item.href.replace(/^\//, '').replace(/\/$/, '');
        if (clean) pagesToMigrate.push(clean + '.html');
      }
      if (item.children) collectPaths(item.children);
    }
  }
  collectPaths(siteMap.nav);
  collectPaths(siteMap.footer);
  if (siteMap.auth) {
    const clean = siteMap.auth.href.replace(/^\//, '').replace(/\/$/, '');
    if (clean) pagesToMigrate.push(clean + '.html');
  }
  collectPaths(siteMap.legal);
  collectPaths(siteMap.tools);
}

// Filter out app pages unless --include-apps
if (!INCLUDE_APPS) {
  pagesToMigrate = pagesToMigrate.filter(p => !APP_PAGES.includes(p));
}

if (pagesToMigrate.length === 0) {
  console.log('No pages to migrate');
  process.exit(0);
}

if (VERBOSE) {
  console.log(`Migrating ${pagesToMigrate.length} pages`);
  if (!INCLUDE_APPS) console.log(`(excluding app pages: ${APP_PAGES.join(', ')})`);
}

// Shared assets to inject
const SHARED_CSS = [
  '<link rel="stylesheet" href="/lib/design-tokens.css">',
  '<link rel="stylesheet" href="/lib/components.css">',
];
const SHARED_JS = '<script src="/lib/nav.client.js" defer></script>';

// Theme bootstrap pattern to remove (duplicated from nav.client.js)
const THEME_BOOTSTRAP_PATTERN = /<script>\s*\(function\s*\(\)\s*\{\s*try\s*\{[\s\S]*?matchMedia[\s\S]*?\}\s*catch\s*\(e\)\s*\{\}\s*\}\)\(\);\s*<\/script>\s*/g;

function migratePage(filePath) {
  if (!fs.existsSync(filePath)) {
    console.log(`⊘ ${filePath} (not found)`);
    return { skipped: true };
  }

  let html = fs.readFileSync(filePath, 'utf8');
  const original = html;
  const changes = [];

  // 1. Add shared CSS to <head>
  const headMatch = html.match(/<head>([\s\S]*?)<\/head>/);
  if (!headMatch) {
    console.log(`✗ ${filePath} (no <head> tag)`);
    return { error: true };
  }

  let head = headMatch[1];
  let needsUpdate = false;

  for (const cssTag of SHARED_CSS) {
    const hrefMatch = cssTag.match(/href="([^"]+)"/);
    const href = hrefMatch ? hrefMatch[1] : '';
    if (head.includes(href)) {
      if (VERBOSE) console.log(`  ${filePath}: ${href} already present`);
    } else {
      // Prepend to head content
      head = `\n  ${cssTag}` + head;
      changes.push(`+ ${href}`);
      needsUpdate = true;
    }
  }

  if (needsUpdate) {
    html = html.replace(headMatch[0], `<head>${head}</head>`);
  }

  // 2. Remove duplicate theme bootstrap scripts
  const beforeRemove = html;
  html = html.replace(THEME_BOOTSTRAP_PATTERN, '');
  if (html !== beforeRemove) {
    changes.push('- theme bootstrap (moved to nav.client.js)');
    needsUpdate = true;
  }

  // 3. Add shared JS before </body>
  const bodyMatch = html.match(/<\/body>/);
  if (bodyMatch) {
    if (!html.includes('/lib/nav.client.js')) {
      html = html.replace('</body>', `  ${SHARED_JS}\n</body>`);
      changes.push('+ /lib/nav.client.js');
      needsUpdate = true;
    }
  }

  // 4. Optionally replace <nav> blocks with <swr-nav>
  if (APPLY_NAV) {
    // Match existing <nav> blocks (simple regex, may need refinement)
    const navPattern = /<nav[\s\S]*?<\/nav>/g;
    const navMatches = html.match(navPattern);
    if (navMatches && navMatches.length > 0) {
      // Replace with <swr-nav> (preserves any nav not matching)
      // For now, just add <swr-nav> above the first nav block
      html = html.replace(navMatches[0], '<swr-nav></swr-nav>\n  ' + navMatches[0]);
      changes.push(`~ wrapped <nav> with <swr-nav>`);
      needsUpdate = true;
    }
  }

  // Write back if changed
  if (needsUpdate) {
    if (DRY_RUN) {
      console.log(`[dry-run] ${filePath}:`);
      for (const change of changes) console.log(`    ${change}`);
    } else {
      fs.writeFileSync(filePath, html);
      console.log(`✓ ${filePath}`);
      for (const change of changes) console.log(`    ${change}`);
    }
    return { migrated: true, changes };
  } else {
    if (VERBOSE) console.log(`⊘ ${filePath} (no changes)`);
    return { skipped: true };
  }
}

let migrated = 0;
let skipped = 0;
let errors = 0;

for (const page of pagesToMigrate) {
  const result = migratePage(page);
  if (result.error) errors++;
  else if (result.migrated) migrated++;
  else skipped++;
}

console.log(`\n${DRY_RUN ? '[dry-run] ' : ''}Summary: ${migrated} migrated, ${skipped} skipped, ${errors} errors`);

if (errors > 0) process.exit(1);
