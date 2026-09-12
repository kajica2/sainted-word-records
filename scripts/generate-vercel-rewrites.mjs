// scripts/generate-vercel-rewrites.mjs — Generate vercel.json rewrites from
// site-map.json. Preserves manual rewrites (auth redirects, special cases)
// and header rules.
//
// Usage:
//   node scripts/generate-vercel-rewrites.mjs [--dry-run] [--verbose]
//
// Reads site-map.json, generates rewrite rules for every entry (nav, footer,
// auth, legal, tools), adds 404 rules for archived pages, and writes
// vercel.json. Preserves existing header rules and special-case rewrites.
//
// Exit code 0 = success, 1 = error.

import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const VERBOSE = args.includes('--verbose');

const SITE_MAP = 'site-map.json';
const VERCEL_JSON = 'vercel.json';

// Load site-map.json
let siteMap;
try {
  siteMap = JSON.parse(fs.readFileSync(SITE_MAP, 'utf8'));
} catch (e) {
  console.error(`✗ ${SITE_MAP} missing or invalid JSON: ${e.message}`);
  process.exit(1);
}

// Load existing vercel.json (if any) to preserve header rules
let existing = { headers: [], rewrites: [] };
if (fs.existsSync(VERCEL_JSON)) {
  try {
    existing = JSON.parse(fs.readFileSync(VERCEL_JSON, 'utf8'));
    if (!existing.headers) existing.headers = [];
    if (!existing.rewrites) existing.rewrites = [];
  } catch (e) {
    console.error(`✗ ${VERCEL_JSON} is invalid JSON: ${e.message}`);
    process.exit(1);
  }
}

// Generate rewrite rules from site-map
function generateRewrites(map) {
  const rules = [];

  // Root → landing.html
  rules.push({ source: '/', destination: '/landing.html' });

  // Helper to add rewrite for a path
  function addPath(href) {
    if (!href || !href.startsWith('/')) return;
    const cleanHref = href.replace(/\/$/, '');
    // Convert /gallery/music to /gallery-music.html (hyphen, not slash)
    // Convert /artists to /artists/index.html
    let htmlPath;
    if (cleanHref === '') {
      htmlPath = '/landing.html';
    } else if (cleanHref.endsWith('.html')) {
      // Already has .html (e.g., /legal/privacy.html)
      htmlPath = cleanHref;
    } else if (cleanHref.startsWith('/gallery/')) {
      // Gallery subpages use hyphenated names: /gallery/music → /gallery-music.html
      const name = cleanHref.replace('/gallery/', '');
      htmlPath = `/gallery-${name}.html`;
    } else if (cleanHref.startsWith('/artists/')) {
      // Artists subpages use direct paths: /artists/foo → /artists/foo.html
      htmlPath = `${cleanHref}.html`;
    } else {
      htmlPath = `${cleanHref}.html`;
    }

    // Skip if it's already /index.html (handled by vercel default)
    if (htmlPath === '/index.html') return;

    // Add both /path and /path/ variants
    rules.push({ source: cleanHref || '/', destination: htmlPath });
    if (cleanHref !== '' && cleanHref !== '/') {
      rules.push({ source: `${cleanHref}/`, destination: htmlPath });
    }
  }

  // Process nav items (including children)
  function processItems(items) {
    if (!Array.isArray(items)) return;
    for (const item of items) {
      addPath(item.href);
      if (item.children) processItems(item.children);
    }
  }

  processItems(map.nav);
  processItems(map.footer);
  processItems(map.legal);
  processItems(map.tools);

  // Auth
  if (map.auth) {
    addPath(map.auth.href);
    addPath('/auth/login');
    addPath('/auth/verify');
  }

  // Special cases: /personas/:id → /personas?id=:id
  rules.push({ source: '/personas/v/:id', destination: '/personas.html' });
  rules.push({ source: '/personas/v/:id/', destination: '/personas.html' });
  rules.push({ source: '/personas/v/index', destination: '/personas.html' });
  rules.push({ source: '/personas/v/index/', destination: '/personas.html' });
  rules.push({ source: '/personas/:id', destination: '/personas.html' });
  rules.push({ source: '/personas/:id/', destination: '/personas.html' });

  // Archived pages → 404
  if (Array.isArray(map.archived)) {
    for (const archived of map.archived) {
      const cleanArchived = archived.replace(/\.html$/, '').replace(/\/$/, '');
      rules.push({
        source: `/${cleanArchived}`,
        destination: `/${archived}`,
        statusCode: 404,
      });
    }
  }

  // Special case: /persona-demo.html → redirect to /personas (merged)
  rules.push({
    source: '/persona-demo.html',
    destination: '/personas.html',
    statusCode: 301,
  });

  return rules;
}

const generatedRewrites = generateRewrites(siteMap);

// Preserve existing header rules (don't regenerate)
const headers = existing.headers || [];

// Merge: prefer generated rewrites, but preserve any existing rewrites that
// reference special destinations (e.g., /tools/hf-publish, /api/* routes)
const specialPatterns = [
  /^\/api\//,
  /^\/tools\//,
  /^\/marketplace\/curated\//,
  /^\/_curator-runner\.html$/,
  /^\/curator-runner\.html$/,
];
const preservedRewrites = (existing.rewrites || []).filter(r =>
  specialPatterns.some(p => p.test(r.source))
);

const finalRewrites = [...generatedRewrites, ...preservedRewrites];

if (VERBOSE) {
  console.log(`Generated ${generatedRewrites.length} rewrites from site-map`);
  console.log(`Preserved ${preservedRewrites.length} special-case rewrites`);
  console.log(`Total: ${finalRewrites.length} rewrite rules`);
}

const vercelConfig = {
  outputDirectory: existing.outputDirectory || 'dist',
  buildCommand: existing.buildCommand || 'npm run build',
  cleanUrls: existing.cleanUrls !== undefined ? existing.cleanUrls : false,
  trailingSlash: existing.trailingSlash !== undefined ? existing.trailingSlash : false,
  headers,
  rewrites: finalRewrites,
};

if (DRY_RUN) {
  console.log(`[dry-run] Would write ${VERCEL_JSON} with ${finalRewrites.length} rewrites`);
  if (VERBOSE) {
    console.log(JSON.stringify(vercelConfig, null, 2));
  }
  process.exit(0);
}

try {
  fs.writeFileSync(VERCEL_JSON, JSON.stringify(vercelConfig, null, 2) + '\n');
  console.log(`✓ ${VERCEL_JSON} generated (${finalRewrites.length} rewrites)`);
} catch (e) {
  console.error(`✗ Failed to write ${VERCEL_JSON}: ${e.message}`);
  process.exit(1);
}
