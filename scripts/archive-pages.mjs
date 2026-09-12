// scripts/archive-pages.mjs — Move archived pages to _archive/ directory.
//
// Usage:
//   node scripts/archive-pages.mjs [--dry-run] [--verbose] [--force]
//
// Reads site-map.json, finds all files in the "archived" array, moves them
// to _archive/<original-path>/ preserving directory structure, updates
// site-map.json to remove archived entries, and ensures _archive/ is in
// .gitignore (matches _candidates/ convention).
//
// Exit code 0 = success, 1 = error.

import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const VERBOSE = args.includes('--verbose');
const FORCE = args.includes('--force');

const SITE_MAP = 'site-map.json';
const ARCHIVE_DIR = '_archive';
const GITIGNORE = '.gitignore';

let siteMap;
try {
  siteMap = JSON.parse(fs.readFileSync(SITE_MAP, 'utf8'));
} catch (e) {
  console.error(`✗ ${SITE_MAP} missing or invalid JSON: ${e.message}`);
  process.exit(1);
}

if (!Array.isArray(siteMap.archived) || siteMap.archived.length === 0) {
  console.log('No archived pages in site-map.json');
  process.exit(0);
}

// Ensure _archive/ directory exists
if (!DRY_RUN && !fs.existsSync(ARCHIVE_DIR)) {
  fs.mkdirSync(ARCHIVE_DIR, { recursive: true });
  if (VERBOSE) console.log(`Created ${ARCHIVE_DIR}/`);
}

// Update .gitignore to exclude _archive/
if (!DRY_RUN) {
  let gitignore = '';
  if (fs.existsSync(GITIGNORE)) {
    gitignore = fs.readFileSync(GITIGNORE, 'utf8');
  }
  if (!gitignore.includes('_archive/')) {
    const updated = gitignore.trim() + '\n_archive/\n';
    fs.writeFileSync(GITIGNORE, updated);
    if (VERBOSE) console.log(`Added _archive/ to ${GITIGNORE}`);
  }
}

// Move files
let moved = 0;
let skipped = 0;
const toRemove = [];

for (const archived of siteMap.archived) {
  const src = archived;
  if (!fs.existsSync(src)) {
    if (VERBOSE) console.log(`⊘ ${src} (not found, skipping)`);
    skipped++;
    continue;
  }

  const dst = path.join(ARCHIVE_DIR, archived);
  const dstDir = path.dirname(dst);

  if (fs.existsSync(dst) && !FORCE) {
    if (VERBOSE) console.log(`⊘ ${src} → ${dst} (already exists, use --force)`);
    skipped++;
    continue;
  }

  if (DRY_RUN) {
    console.log(`[dry-run] Would move: ${src} → ${dst}`);
    moved++;
    continue;
  }

  // Create destination directory
  fs.mkdirSync(dstDir, { recursive: true });

  // Move file
  fs.renameSync(src, dst);
  if (VERBOSE) console.log(`✓ Moved: ${src} → ${dst}`);
  moved++;
  toRemove.push(archived);
}

// Update site-map.json: remove archived entries that were successfully moved
if (!DRY_RUN) {
  siteMap.archived = siteMap.archived.filter(p => !toRemove.includes(p));
  // Update meta
  siteMap.meta = siteMap.meta || {};
  siteMap.meta.archivedPages = siteMap.archived.length;
  siteMap.meta.lastUpdated = new Date().toISOString().split('T')[0];

  fs.writeFileSync(SITE_MAP, JSON.stringify(siteMap, null, 2) + '\n');
  if (VERBOSE) console.log(`Updated ${SITE_MAP}`);
}

console.log(`✓ Archived ${moved} pages (${skipped} skipped)`);
if (!DRY_RUN && moved > 0) {
  console.log(`  Next: run scripts/generate-vercel-rewrites.mjs to update vercel.json`);
}
