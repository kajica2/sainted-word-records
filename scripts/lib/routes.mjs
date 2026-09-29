// scripts/lib/routes.mjs — the one file→route mapping.
//
// `routeForFile()` answers "which URL serves this shipped page?" and is the
// single source shared by:
//   scripts/check-dist-links.mjs   — does every site-map entry resolve?
//   scripts/generate-sitemap.mjs   — sitemap.xml <loc>
//   scripts/check-sitemap.mjs      — drift + coverage gate
//   scripts/check-site-chrome.mjs  — <link rel="canonical">
// sitemap.html keeps a browser-side copy (it can import nothing); when a rule
// changes here, change it there too.
//
// vercel.json sets `cleanUrls: false`, so an extensionless URL is served only
// when a rewrite points at it — a bare stem with no rewrite is a live 404 even
// though <stem>.html exists in dist/. Four families are not served by a rewrite
// of their stem (verified against dist + vercel.json 2026-09-29):
//   gallery-<name>.html  → /gallery/<name>   (the nav's canonical route)
//   atlas-<slug>.html    → /atlas/<slug>     (the Atlas TOC's route; see
//                          ATLAS_SLUGS in scripts/generate-vercel-rewrites.mjs)
//   <dir>/index.html     → /<dir>            (the directory route, WITHOUT the
//                          trailing slash: Vercel's default trailingSlash:false
//                          308s /<dir>/ → /<dir>, so the slash form is a
//                          redirect, not the address — measured live 2026-09-29
//                          on /artists/, /artists/vodolija/, /personas/v/,
//                          /shotlist/)
//   index.html/landing   → /
// A handful of pages are only reachable at their real filename (NO_REWRITE) or
// at a preserved hand-written route (ROUTE_OVERRIDES) because no rewrite points
// at their stem.

export const ATLAS_SLUGS = [
  '200-steps', 'architect', 'checklist', 'crisis', 'final-insight',
  'forge', 'integration', 'legacy', 'life-stages',
];

// Stems whose clean route is not served: the page is only reachable at
// `/<file>`. `legal/` (site-map links the .html form, _pathConventions
// "withDotHtml"), `terms` (the glossary; /terms has no rewrite), and
// `artists/vodolija` (the preserved `/artists/vodolija → …/index.html` rewrite
// serves the showcase page, not the artist profile).
export const NO_REWRITE = /^(tools\/|legal\/|landing-personas-v\d+|swr-intro-10s$|offline$|404$|director-mode-sainted-word$|versions\/music_video_mtv$|terms$|artists\/vodolija$)/;

// Pages served at a preserved hand-written route that the stem rule cannot
// express. Both routes exist in vercel.json and are what the site links to:
// /visual-languages is the nav entry for versions/index.html, and
// /versions/music-video is the hand-kept hyphen rewrite for the underscore
// file (the underscore in the filename breaks the auto-generator's
// `clean + .html` logic).
export const ROUTE_OVERRIDES = {
  'versions/index.html': '/visual-languages',
  'versions/music_video.html': '/versions/music-video',
};

const FILE_OVERRIDES = Object.fromEntries(
  Object.entries(ROUTE_OVERRIDES).map(([file, route]) => [route, file]),
);

export function routeForFile(file) {
  const f = String(file).replace(/^\.\//, '');
  if (ROUTE_OVERRIDES[f]) return ROUTE_OVERRIDES[f];
  const stem = f.replace(/\.html$/, '');
  if (stem === 'index' || stem === 'landing') return '/';
  if (/^gallery-/.test(stem)) return '/gallery/' + stem.replace(/^gallery-/, '');
  if (stem.startsWith('atlas-') && ATLAS_SLUGS.includes(stem.replace(/^atlas-/, ''))) {
    return '/atlas/' + stem.replace(/^atlas-/, '');
  }
  if (/\/index$/.test(stem)) return '/' + stem.replace(/\/index$/, '');
  if (NO_REWRITE.test(stem)) return '/' + f;
  return '/' + stem;
}

// The inverse of routeForFile(), used to prove a route resolves back to the file
// it names. Returns the repo-relative file, or null for a route that is not a
// page (a dynamic /s/:id or /personas/:id style route). Two disambiguators,
// both optional: `rewrites` (vercel.json's non-error rewrites — the first match
// wins, exactly as Vercel resolves it, which is what tells /versions →
// versions.html apart from versions/index.html) and `exists`, a probe for a
// directory index served without its trailing slash (/artists →
// artists/index.html).
export function routeToFile(route, { rewrites = [], exists = () => false } = {}) {
  const r = String(route);
  if (FILE_OVERRIDES[r]) return FILE_OVERRIDES[r];
  const hit = rewriteForRoute(r, rewrites);
  if (hit && !String(hit.destination).includes(':')) return String(hit.destination).replace(/^\/+/, '');
  if (r === '/' || r === '') return 'landing.html';
  if (/^\/gallery\/[^/]+$/.test(r)) return 'gallery-' + r.slice('/gallery/'.length) + '.html';
  if (/^\/atlas\/[^/]+$/.test(r)) {
    const slug = r.slice('/atlas/'.length);
    if (ATLAS_SLUGS.includes(slug)) return 'atlas-' + slug + '.html';
  }
  if (r.endsWith('/')) return r.replace(/^\//, '') + 'index.html';
  if (r.endsWith('.html')) return r.replace(/^\//, '');
  if (/:[A-Za-z_]+/.test(r)) return null;
  const rel = r.replace(/^\//, '');
  return exists(rel + '/index.html') ? rel + '/index.html' : rel + '.html';
}

// vercel.json rewrite sources are literal except for `:param` segments.
export function sourceRe(source) {
  return new RegExp('^' + String(source)
    .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    .replace(/:[A-Za-z_]+/g, '[^/]+') + '$');
}

// Does this rewrite destination resolve to exactly `file`? `:param` segments are
// substituted from the route positionally (Vercel substitutes the matched
// segment), which is what makes `/personas/v/:id → /personas/v/<id>.html`
// checkable against the file it actually serves.
export function destinationServesFile(destination, route, file) {
  const dest = String(destination || '');
  if (!dest.startsWith('/')) return false;
  if (!/:/.test(dest)) return dest.replace(/^\/+/, '') === file;
  const destSegs = dest.split('/');
  const routeSegs = String(route).split('/');
  if (destSegs.length !== routeSegs.length) return false;
  const probe = destSegs
    .map((seg, i) => {
      const m = seg.match(/^:([A-Za-z_]+)(.*)$/);
      return m ? routeSegs[i] + m[2] : seg;
    })
    .join('/');
  return probe.replace(/^\/+/, '') === file;
}

// The first (Vercel is first-match-wins) non-error rewrite that serves `route`.
export function rewriteForRoute(route, rewrites) {
  return (rewrites || []).find((r) => sourceRe(r.source).test(route)) || null;
}

// Is `route` served by a rewrite that lands on `file`, or is `file` itself
// reachable as a static file / directory index? `files` is the set of built
// files in dist (relative paths).
export function servesFile(route, file, { rewrites = [], files = new Set() } = {}) {
  const hit = rewriteForRoute(route, rewrites);
  if (hit) return destinationServesFile(hit.destination, route, file);
  const rel = String(route).replace(/^\/+/, '').replace(/\/$/, '');
  if (!rel) return false;
  return files.has(rel) || files.has(rel + '/index.html');
}
