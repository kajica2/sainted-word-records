#!/usr/bin/env node
// scripts/check-dist-links.mjs — dist integrity gate.
//
// Catches the "shipped page points at something that was never built" class.
// Two real cases, both invisible until now (found 2026-09-27, both 404 live):
//
//   - atlas.html's TOC links to /atlas/<slug> for nine sections, but the
//     section files are hyphenated at the repo root (atlas-<slug>.html), no
//     rewrite existed, and copy-static never shipped them.
//   - those same pages reference /docs/atlas-assets/*.webp, which copy-static
//     never copied either (docs/ was not in the dirs[] table).
//
// Assertions:
//   1. Every rewrite in vercel.json that is not an error status resolves to a
//      file in dist/ (a `:param` destination must match at least one file).
//   2. Every root-relative href/src in a shipped page resolves to a file in
//      dist/, to a built <path>.html, to a built <path>/index.html, or to a
//      non-error rewrite whose destination resolves.
//
// Run: node scripts/check-dist-links.mjs
import fs from 'node:fs';
import path from 'node:path';
import { ensureDist } from './with-dist.mjs';

const DIST = 'dist';
const checks = [];
const pass = (m, d) => { checks.push({ ok: true, m }); console.log('✓', m, d ? `(${d})` : ''); };
const fail = (m, d) => { checks.push({ ok: false, m }); console.log('✗', m, d ? `(${d})` : ''); };

function htmlFiles(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) htmlFiles(p, out);
    else if (e.name.endsWith('.html')) out.push(p);
  }
  return out;
}

function isFile(p) {
  try { return fs.statSync(p).isFile(); } catch { return false; }
}

// Does a root-relative path resolve to something Vercel would serve from dist/?
function resolvesInDist(url) {
  const rel = String(url).replace(/^\/+/, '');
  if (!rel) return true;
  if (isFile(path.join(DIST, rel))) return true;
  if (isFile(path.join(DIST, rel, 'index.html'))) return true;
  // Extensionless routes are built as <path>.html unless a directory index exists.
  if (!/\.[a-z0-9]{2,5}$/i.test(rel) && isFile(`${path.join(DIST, rel)}.html`)) return true;
  return false;
}

function paramGlob(destination) {
  // /personas/v/:id.html → a RegExp matching real files on disk.
  const re = '^' + destination
    .replace(/^\/+/, '')
    .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    .replace(/:[A-Za-z_]+/g, '[^/]+') + '$';
  return new RegExp(re);
}

(async () => {
  await ensureDist();
  if (!fs.existsSync(DIST)) {
    fail('dist/ exists after ensureDist');
    console.error('✗ dist/ is missing — cannot audit links');
    process.exit(1);
  }

  const vercel = JSON.parse(fs.readFileSync('vercel.json', 'utf8'));
  const rewrites = (vercel.rewrites || []).filter((r) => !r.statusCode || r.statusCode < 400);
  const allFiles = [];
  (function walk(d) {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p); else allFiles.push(p.replace(/^dist[\\/]/, ''));
    }
  })(DIST);

  // 1. rewrite destinations
  const brokenRewrites = [];
  for (const r of rewrites) {
    const dest = r.destination;
    if (!dest || !dest.startsWith('/')) continue; // external / same-source
    if (dest.includes(':')) {
      const re = paramGlob(dest);
      if (!allFiles.some((f) => re.test(f))) brokenRewrites.push(`${r.source} → ${dest} (no file matches)`);
      continue;
    }
    if (!resolvesInDist(dest)) brokenRewrites.push(`${r.source} → ${dest}`);
  }
  if (brokenRewrites.length) {
    fail('every rewrite destination resolves in dist', `${brokenRewrites.length} broken`);
    for (const b of brokenRewrites.slice(0, 20)) console.log('   ', b);
  } else {
    pass('every rewrite destination resolves in dist', `${rewrites.length} rewrites`);
  }

  // 2. static links in shipped pages
  const pages = htmlFiles(DIST);
  const broken = new Map();
  let skippedTemplates = 0;
  // Attributes only: a JS assignment like `img.src = '/shop-designs/' + file`
  // is a URL *prefix*, not a static link, so `(?<![.\w])` excludes `.src=`/`.href=`.
  const LINK_RE = /(?<![.\w])(?:href|src)\s*=\s*["'](\/[^"'#?\s]*)["']/g;
  for (const page of pages) {
    const src = fs.readFileSync(page, 'utf8');
    let m;
    while ((m = LINK_RE.exec(src))) {
      const url = m[1];
      if (url.startsWith('//')) continue;
      if (url.includes('${')) { skippedTemplates++; continue; } // runtime-templated
      if (resolvesInDist(url)) continue;
      const hit = rewrites.find((r) => {
        const re = new RegExp('^' + r.source.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/:[A-Za-z_]+/g, '[^/]+') + '$');
        return re.test(url);
      });
      if (hit && resolvesInDist(hit.destination)) continue;
      if (!broken.has(url)) broken.set(url, new Set());
      broken.get(url).add(page.replace(/^dist\//, ''));
    }
  }
  if (broken.size) {
    fail('every internal link resolves in dist', `${broken.size} target(s)`);
    for (const [url, from] of broken) {
      console.log(`    ${url}  ← ${[...from].slice(0, 3).join(', ')}${from.size > 3 ? ` (+${from.size - 3})` : ''}`);
    }
  } else {
    pass('every internal link resolves in dist', `${pages.length} pages, ${skippedTemplates} templated skipped`);
  }

  // 3. site-map.json ships to dist and is fetched at runtime by sitemap.html
  //    (and lib/nav.client.js), which turn its entries into links. A stale
  //    entry is therefore a live dead link even though no HTML contains it —
  //    `discovered: ["weddings.html"]` rendered a /weddings link that 404'd.
  const siteMap = JSON.parse(fs.readFileSync('site-map.json', 'utf8'));
  const hrefs = new Map(); // href → where it came from
  function collectHrefs(items, where) {
    if (!Array.isArray(items)) return;
    for (const item of items) {
      if (item && item.href) hrefs.set(item.href, where);
      if (item && item.children) collectHrefs(item.children, where);
    }
  }
  collectHrefs(siteMap.nav, 'nav');
  collectHrefs(siteMap.footer, 'footer');
  collectHrefs(siteMap.legal, 'legal');
  collectHrefs(siteMap.tools, 'tools');
  if (siteMap.auth && siteMap.auth.href) hrefs.set(siteMap.auth.href, 'auth');
  for (const file of siteMap.discovered || []) {
    if (typeof file === 'string') hrefs.set('/' + file.replace(/\.html$/, ''), 'discovered');
  }
  const deadMapEntries = [];
  for (const [href, where] of hrefs) {
    if (!href.startsWith('/')) continue;
    if (resolvesInDist(href)) continue;
    if (!/\.[a-z0-9]{2,5}$/i.test(href) && resolvesInDist(`${href}.html`)) continue;
    const hit = rewrites.find((r) => {
      const re = new RegExp('^' + r.source.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/:[A-Za-z_]+/g, '[^/]+') + '$');
      return re.test(href);
    });
    if (hit && resolvesInDist(hit.destination)) continue;
    deadMapEntries.push(`${href}  (site-map ${where})`);
  }
  if (deadMapEntries.length) {
    fail('every site-map entry resolves in dist', `${deadMapEntries.length} dead`);
    for (const d of deadMapEntries.slice(0, 20)) console.log('   ', d);
  } else {
    pass('every site-map entry resolves in dist', `${hrefs.size} entries`);
  }

  // 4. relative refs in pages served at a NON-root path. A rewrite like
  //    /gallery/vintage → /gallery-vintage.html serves the page from the
  //    /gallery/ directory, so a "./x" ref resolves to /gallery/x — not /x.
  //    gallery-vintage.html's "./gallery-vintage/*.webp" refs thus 404'd every
  //    image on the deployed page while resolving fine at the canonical route.
  const servedAt = new Map(); // dist-relative page → Set<served dir>
  for (const r of rewrites) {
    if (r.source.includes(':') || r.source.includes('*')) continue;
    const dir = r.source.slice(0, r.source.lastIndexOf('/') + 1);
    if (dir === '/') continue;
    const dest = r.destination.replace(/^\/+/, '');
    if (!dest.endsWith('.html')) continue;
    if (!servedAt.has(dest)) servedAt.set(dest, new Set());
    servedAt.get(dest).add(dir);
  }
  const REL_RE = /\b(?:href|src|data-audio|poster)\s*=\s*["'](\.\/[^"'#?\s]*)["']/g;
  const relBroken = [];
  for (const [page, dirs] of servedAt) {
    const abs = path.join(DIST, page);
    if (!isFile(abs)) continue;
    const source = fs.readFileSync(abs, 'utf8');
    let m;
    REL_RE.lastIndex = 0;
    while ((m = REL_RE.exec(source))) {
      const rel = m[1].slice(2); // strip the leading "./"
      for (const dir of dirs) {
        if (resolvesInDist('/' + dir.replace(/^\/+/, '') + rel)) continue;
        relBroken.push(`${m[1]}  ← ${page} (served at ${dir})`);
      }
    }
  }
  if (relBroken.length) {
    const uniq = [...new Set(relBroken)];
    fail('relative refs resolve from every served path', `${uniq.length} broken`);
    for (const b of uniq.slice(0, 20)) console.log('   ', b);
  } else {
    pass('relative refs resolve from every served path', `${servedAt.size} aliased pages`);
  }

  const failed = checks.filter((c) => !c.ok).length;
  console.log(failed ? `\n✗ ${failed}/${checks.length} checks failed` : `\n✓ all ${checks.length} checks passed`);
  process.exit(failed ? 1 : 0);
})();
