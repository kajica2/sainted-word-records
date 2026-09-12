// scripts/generate-site-manifest.mjs — Auto-discover HTML pages and populate
// site-map.json with entries that aren't already manually categorized.
//
// Usage:
//   node scripts/generate-site-manifest.mjs [--dry-run] [--verbose]
//
// Scans the repo for *.html files (excluding _archive/, _candidates/,
// node_modules/, dist*/). For each file not in site-map.json, adds a
// default entry under a "discovered" bucket. Manual entries in site-map.json
// (nav, footer, auth, legal, tools, archived) are preserved as-is.
//
// Exit code 0 = success, 1 = error.

import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const VERBOSE = args.includes('--verbose');

const SITE_MAP = 'site-map.json';
const SKIP_DIRS = ['node_modules', 'dist', 'dist-dev', '.vite', '_archive', '_candidates'];
const SKIP_PREFIXES = ['_candidates'];

// Load existing site-map.json
let siteMap;
try {
  siteMap = JSON.parse(fs.readFileSync(SITE_MAP, 'utf8'));
} catch (e) {
  console.error(`✗ ${SITE_MAP} missing or invalid JSON: ${e.message}`);
  process.exit(1);
}

// Build set of known paths (anything in nav, footer, auth, legal, tools, archived)
const knownPaths = new Set();
function collectPaths(items, base = '') {
  if (!Array.isArray(items)) return;
  for (const item of items) {
    if (item.href) knownPaths.add(item.href.replace(/^\//, ''));
    if (item.children) collectPaths(item.children);
  }
}
collectPaths(siteMap.nav);
collectPaths(siteMap.footer);
if (siteMap.auth) knownPaths.add(siteMap.auth.href.replace(/^\//, ''));
collectPaths(siteMap.legal);
collectPaths(siteMap.tools);
(siteMap.archived || []).forEach(p => knownPaths.add(p));

// Scan repo for HTML files
function walkDir(dir, files = []) {
  if (!fs.existsSync(dir)) return files;
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const e of entries) {
    if (SKIP_DIRS.includes(e.name)) continue;
    if (SKIP_PREFIXES.some(p => e.name.startsWith(p))) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      walkDir(full, files);
    } else if (e.isFile() && e.name.endsWith('.html')) {
      files.push(full);
    }
  }
  return files;
}

const htmlFiles = walkDir('.');
const discovered = [];
for (const f of htmlFiles) {
  const rel = f.replace(/^\.\//, '');
  if (knownPaths.has(rel)) continue;
  discovered.push(rel);
}

// Initialize discovered array if needed
if (!siteMap.discovered) siteMap.discovered = [];

// Add new discoveries
let added = 0;
for (const f of discovered) {
  if (!siteMap.discovered.includes(f)) {
    siteMap.discovered.push(f);
    added++;
  }
}

// Update meta
siteMap.meta = siteMap.meta || {};
siteMap.meta.version = '1.0.0';
siteMap.meta.lastUpdated = new Date().toISOString().split('T')[0];
siteMap.meta.totalPages = htmlFiles.length;
siteMap.meta.corePages = siteMap.meta.totalPages - (siteMap.archived || []).length;
siteMap.meta.archivedPages = (siteMap.archived || []).length;

if (VERBOSE) {
  console.log(`Scanned ${htmlFiles.length} HTML files`);
  console.log(`Known paths: ${knownPaths.size}`);
  console.log(`Discovered: ${discovered.length} new pages`);
  console.log(`Added: ${added}`);
}

if (DRY_RUN) {
  console.log(`[dry-run] Would add ${added} pages to site-map.json:`);
  for (const f of discovered.slice(0, 20)) console.log(`  - ${f}`);
  if (discovered.length > 20) console.log(`  ...and ${discovered.length - 20} more`);
  process.exit(0);
}

// Write back
try {
  fs.writeFileSync(SITE_MAP, JSON.stringify(siteMap, null, 2) + '\n');
  console.log(`✓ ${SITE_MAP} updated (+${added} pages, ${htmlFiles.length} total)`);
} catch (e) {
  console.error(`✗ Failed to write ${SITE_MAP}: ${e.message}`);
  process.exit(1);
}
