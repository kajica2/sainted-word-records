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
    } else if (fs.existsSync(path.join(cleanHref.replace(/^\//, ''), 'index.html'))) {
      // Directory-style routes are served by their index.html, NOT by
      // <name>.html. /personas/v lives at personas/v/index.html, so the
      // generic rule below would emit a rewrite to a non-existent
      // personas/v.html — and because this loop runs before the explicit
      // rules, that bad rewrite would shadow the correct one and make the
      // whole gallery unreachable.
      htmlPath = `${cleanHref}/index.html`;
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

  // Pages the legacy /nav.client.js linked to. They exist at the repo root but
  // were never in site-map.json, so copy-static never shipped them and their
  // routes 404'd from the header nav. Now built (see vite.config.js rootFiles)
  // and routed here so the links resolve instead of being deleted.
  rules.push({ source: '/enhance', destination: '/enhance.html' });
  rules.push({ source: '/enhance/', destination: '/enhance.html' });
  rules.push({ source: '/video_single.html', destination: '/video_single.html' });

  // Persona variant gallery. Each /personas/v/<id> must resolve to its OWN
  // page under personas/v/. These previously all mapped to /personas.html,
  // which made the entire 24-page gallery unreachable in production — every
  // URL silently served the marketing page instead, so the variants could
  // not be visited even by typing the address.
  //
  // Declared before the /personas/:id catch-all below: that rule would
  // otherwise shadow them (it matches /personas/v too).
  rules.push({ source: '/personas/v/:id', destination: '/personas/v/:id.html' });
  rules.push({ source: '/personas/v/:id/', destination: '/personas/v/:id.html' });
  rules.push({ source: '/personas/v', destination: '/personas/v/index.html' });
  rules.push({ source: '/personas/v/', destination: '/personas/v/index.html' });
  rules.push({ source: '/personas/v/index', destination: '/personas/v/index.html' });
  rules.push({ source: '/personas/v/index/', destination: '/personas/v/index.html' });

  // Catch-all for the marketing personas page: /personas/<anything> renders
  // the persona overview. Note this is a soft-404 (any unknown subpath shows
  // this page) — deliberate for now, but it must stay LAST so it cannot
  // shadow a real sub-path.
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
  // /visual-languages maps to /versions/index.html because that file
  // exists; the auto-generated /visual-languages.html does not. PR #99.
  /^\/visual-languages\/?$/,
  // /artists maps to /artists/index.html (directory + index) because
  // that file is the canonical landing page; /artists.html does not
  // exist.
  /^\/artists\/?$/,
  // /versions/music-video → /versions/music_video.html (the underscore
  // in the filename breaks the auto-generator's `clean + .html` logic).
  /^\/versions\/music-video\/?$/,
  // /versions/echo-manifold has no site-map entry but is reachable
  // from /versions.html style cards.
  /^\/versions\/echo-manifold\/?$/,
  // /atlas exists as atlas.html but isn't in site-map; reachable from
  // the atlas-* exploratory pages.
  /^\/atlas\/?$/,
  // /artists/<name> → /artists/<name>.html for individual artist pages.
  // Not in site-map nav but linked from /artists/index.html cards.
  /^\/artists\/(ana-maric|dusan-popov|kira-lindqvist|marko-ilic|nina-volkova|vodolija)\/?$/,
  // /versions/<name> → /versions/<name>.html for the 22 variants and
  // index pages. The auto-generator doesn't emit subdirectory rewrites
  // under /versions/ (only under /artists/), so we preserve manually.
  /^\/versions\/(?!index$)[a-z_-]+\/?$/,
];
const preservedRewrites = (existing.rewrites || []).filter(r =>
  specialPatterns.some(p => p.test(r.source))
);

// Dedupe preservedRewrites by source — last occurrence wins. This protects
// against double-stacking if the script is run multiple times in a row
// (each run used to append preserved rules on top of existing).
const preservedBySource = new Map();
for (const r of preservedRewrites) preservedBySource.set(r.source, r);
const dedupedPreserved = [...preservedBySource.values()];

// Build a set of sources that will be handled by preserved rewrites so we
// can drop the auto-generated equivalents (Vercel uses first-match-wins,
// so a preserved rule appended after the generated one wouldn't take
// effect).
const preservedSources = new Set(dedupedPreserved.map(r => r.source));
const filteredGenerated = generatedRewrites.filter(
  r => !preservedSources.has(r.source)
);

// Preserved rules go FIRST so they win on first-match.
const finalRewrites = [...dedupedPreserved, ...filteredGenerated];

if (VERBOSE) {
  console.log(`Generated ${generatedRewrites.length} rewrites from site-map`);
  console.log(`Preserved ${dedupedPreserved.length} special-case rewrites`);
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
