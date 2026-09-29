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
const ADD_NAV = args.includes('--add-nav');
const APPLY_FOOTER = args.includes('--apply-footer');
const ADD_FOOTER = args.includes('--add-footer');
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

  // Also process discovered pages
  if (Array.isArray(siteMap.discovered)) {
    for (const p of siteMap.discovered) {
      if (!pagesToMigrate.includes(p)) pagesToMigrate.push(p);
    }
  }
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
const SHARED_FOOTER_JS = '<script src="/lib/footer.client.js" defer></script>';
const SHARED_FOOTER = '<swr-footer></swr-footer>';

// Every destination the shared footer (lib/footer.client.js, fed by
// site-map.json's footerNav) can serve. A bespoke footer is only replaced when
// each of its links lands in this set — otherwise the page keeps its footer and
// the run reports the links that would have been dropped.
function normalizeHref(href) {
  if (!href) return '';
  const h = String(href).trim();
  if (h.startsWith('#') || h.startsWith('mailto:') || h.startsWith('tel:') || h === '' ) return null;
  const n = h.replace(/^https?:\/\/sainted-word-records\.vercel\.app/i, '')
    .replace(/^\.\//, '')
    .replace(/\.html$/, '')
    .replace(/\/$/, '')
    .replace(/^\/(.*)$/, '$1') || '/';
  // /landing.html is the rewrite target for the site root.
  return n === 'landing' ? '/' : n;
}
function sharedFooterTargets(map) {
  const set = new Set(['/']);
  const add = (href) => { const n = normalizeHref(href); if (n !== null) set.add(n); };
  const fn = map.footerNav || {};
  for (const col of (fn.columns || [])) for (const l of (col.links || [])) add(l.href);
  for (const s of (fn.social || [])) add(s.href);
  for (const l of (map.legal || [])) add(l.href);
  for (const t of (map.tools || [])) add(t.href);
  add('/sitemap');
  return set;
}
const FOOTER_TARGETS = sharedFooterTargets(siteMap);

// Theme bootstrap pattern to remove (duplicated from nav.client.js)
const THEME_BOOTSTRAP_PATTERN = /<script>\s*\(function\s*\(\)\s*\{\s*try\s*\{[\s\S]*?matchMedia[\s\S]*?\}\s*catch\s*\(e\)\s*\{\}\s*\}\)\(\);\s*<\/script>\s*/g;

// Ranges covered by <script>…</script>, so markup inside a template string
// (engine.html builds an export document in JS) is never touched.
function scriptRanges(html) {
  const ranges = [];
  const re = /<script[\s\S]*?<\/script>/gi;
  let m;
  while ((m = re.exec(html))) ranges.push([m.index, m.index + m[0].length]);
  return ranges;
}
const inRanges = (ranges, idx) => ranges.some(([a, b]) => idx >= a && idx < b);

function footerLinks(footerHtml) {
  const hrefs = [];
  const re = /href="([^"]*)"/gi;
  let m;
  while ((m = re.exec(footerHtml))) {
    const norm = normalizeHref(m[1]);
    if (norm !== null) hrefs.push({ raw: m[1], norm });
  }
  return hrefs;
}

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

  // 3. Nav element placement — <swr-nav> renders where it sits, so a mount left
  //    at the end of <body> paints the "sticky top nav" below the content.
  //    Every mount moves to directly after <body>, exactly once.
  const ranges = scriptRanges(html);
  const navRe = /<swr-nav\b[^>]*>\s*<\/swr-nav>/g;
  const navHits = [];
  {
    let m;
    while ((m = navRe.exec(html))) {
      if (!inRanges(ranges, m.index)) navHits.push([m.index, m.index + m[0].length]);
    }
  }
  // The real <body> is the first one after </head> — a literal `<body>` can
  // otherwise appear in a head comment or a JS string and hijack the match.
  const headEnd = html.indexOf('</head>');
  const bodySearchFrom = headEnd >= 0 ? headEnd : 0;
  const bodyTagMatch = html.slice(bodySearchFrom).match(/<body[^>]*>/);
  const bodyOpen = bodyTagMatch ? [bodyTagMatch[0]] : null;
  const bodyOpenIndex = bodyTagMatch ? bodySearchFrom + bodyTagMatch.index : -1;
  if (bodyOpen && navHits.length > 0) {
    const bodyEnd = bodyOpenIndex + bodyOpen[0].length;
    const alreadyTop = navHits.length === 1 && navHits[0][0] >= bodyEnd && navHits[0][0] < bodyEnd + 40;
    if (!alreadyTop) {
      // Remove every existing mount (last first, so indices stay valid), then
      // insert one directly after <body>.
      for (let i = navHits.length - 1; i >= 0; i--) {
        html = html.slice(0, navHits[i][0]) + html.slice(navHits[i][1]);
      }
      html = html.slice(0, bodyEnd) + '\n  <swr-nav></swr-nav>' + html.slice(bodyEnd);
      changes.push(`~ <swr-nav> moved to the top of <body>`);
      needsUpdate = true;
    }
  } else if (bodyOpen && ADD_NAV && !/SWR_NAV\.mount/.test(html)) {
    const bodyEnd = bodyOpenIndex + bodyOpen[0].length;
    html = html.slice(0, bodyEnd) + '\n  <swr-nav></swr-nav>' + html.slice(bodyEnd);
    changes.push(`+ <swr-nav> (page had no mount)`);
    needsUpdate = true;
  }

  // 3b. Shared footer — replace a bespoke <footer> when every link it carries
  //     is served by the shared footer; otherwise keep it and report the links
  //     that would have been dropped (never silently lose a destination).
  if (APPLY_FOOTER || ADD_FOOTER) {
    const footRe = /<footer\b[\s\S]*?<\/footer>/gi;
    let footMatch = footRe.exec(html);
    while (footMatch && inRanges(scriptRanges(html), footMatch.index)) footMatch = footRe.exec(html);
    if (footMatch) {
      if (APPLY_FOOTER) {
        const links = footerLinks(footMatch[0]);
        const missing = links.filter(l => !FOOTER_TARGETS.has(l.norm));
        if (missing.length === 0) {
          html = html.slice(0, footMatch.index) + SHARED_FOOTER + html.slice(footMatch.index + footMatch[0].length);
          changes.push(`~ footer → <swr-footer> (${links.length} links all served by the shared footer)`);
          needsUpdate = true;
        } else {
          changes.push(`? footer kept — shared footer lacks: ${[...new Set(missing.map(m => m.raw))].join(', ')}`);
        }
      }
    } else if (ADD_FOOTER) {
      if (html.includes('<swr-footer')) {
        // already mounted
      } else if (html.includes('</body>')) {
        html = html.replace('</body>', `  ${SHARED_FOOTER}\n</body>`);
        changes.push(`+ <swr-footer> (page had no footer)`);
        needsUpdate = true;
      }
    }
  }

  // 3c. Footer script, whenever the page mounts the component.
  if (html.includes('<swr-footer') && !html.includes('/lib/footer.client.js')) {
    html = html.replace('</body>', `  ${SHARED_FOOTER_JS}\n</body>`);
    changes.push('+ /lib/footer.client.js');
    needsUpdate = true;
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
