#!/usr/bin/env node
// scripts/generate-sitemap.mjs — generate sitemap.xml from the shipped surface.
//
// The sitemap used to be hand-maintained, so it drifted: 114 <loc> entries with
// a single invented lastmod, nine of them URLs that site-map.json 301s away
// (/persona-demo, /gallery-director-mode, /engine-ar-loop, /video_single, the
// five swr-* launch docs) and five more the IA archives. Nothing generated it.
//
// The shipped surface is `dist` (what copy-static actually deploys) — not a
// guess from the file list — and the exclusions come from the IA:
//
//   * `site-map.json` `redirects` — a URL that 301s must never be advertised;
//   * `site-map.json` `archived` — archived pages are not pages any more;
//   * the non-public surfaces the chrome gate documents (`tools/`, `auth/`,
//     the PWA shell, the login stub, the render bumper) plus the two pages
//     AGENTS.md records as deliberately not deployed (market-study.html,
//     profit-plan.html — absent from dist as well);
//   * any page that declares `<meta name="robots" content="noindex">` — a
//     sitemap that lists a page asking not to be indexed contradicts itself.
//
// Routes come from scripts/lib/routes.mjs (the one file→route mapping), and
// every entry is proved to serve the file it names before it is written.
//
// <lastmod> is site-map.json's `meta.lastUpdated` — the IA's own stamp. A
// per-file `git log` date would be more granular but not reproducible: CI
// checks out with actions/checkout@v4's default fetch-depth of 1, where
// `git log -1 -- <file>` is empty for every file the tip commit did not touch,
// so the committed file and the regenerated one would differ and the drift gate
// (scripts/check-sitemap.mjs) would flake.
//
// Usage:
//   node scripts/generate-sitemap.mjs [--out <path>] [--dry-run]
//
// Exit code 0 = success, 1 = error.

import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { ensureDist } from './with-dist.mjs';
import { routeForFile, servesFile } from './lib/routes.mjs';

export const SITE = 'https://sainted-word-records.vercel.app';
export const OUT = 'sitemap.xml';
const DIST = 'dist';

// Surfaces that ship but are not public pages. The first two are the chrome
// gate's documented "internal/dev tools and the auth flow" (noindex, no
// marketing chrome); `packs/covers/` is the chrome gate's other documented
// non-public surface — standalone paused-timeline cover animations (media-pack
// / NFT cover art) that `packs/` ships wholesale from SOURCE_DIRS but that are
// render assets, not navigable pages, exactly like the intro bumper; the files
// are the PWA shell, the meta-refresh login stub, the intro render bumper and
// the two deliberately-not-deployed pages.
const NON_PUBLIC_DIRS = [/^tools\//, /^auth\//, /^scripts\//, /^packs\/covers\//];
const NON_PUBLIC_FILES = new Set([
  'offline.html',
  'login.html',
  'swr-intro-10s.html',
  'market-study.html',
  'profit-plan.html',
]);
const NOINDEX_RE = /<meta\s+name="robots"[^>]*content="[^"]*noindex/i;

function distFiles() {
  const out = [];
  (function walk(dir) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else out.push(p.replace(/^dist[\\/]/, ''));
    }
  })(DIST);
  return out;
}

// site-map `redirects` are written as routes; normalise to the shapes a file
// could collide with (`/x`, `/x/`, `/x.html`).
function redirectSources(siteMap) {
  const set = new Set();
  for (const r of siteMap.redirects || []) {
    if (!r || !r.from) continue;
    const clean = String(r.from).replace(/^\//, '').replace(/\.html$/, '').replace(/\/$/, '');
    for (const s of [clean, clean + '/', clean + '.html']) set.add(s);
  }
  return set;
}

// The pages that belong in the sitemap, each proved to be served at its route.
// Returns { entries, excluded } — `excluded` carries the reason so the gate can
// print why a shipped page is absent.
export async function sitemapEntries() {
  await ensureDist();
  if (!fs.existsSync(DIST)) throw new Error(`${DIST}/ is missing after ensureDist()`);

  const siteMap = JSON.parse(fs.readFileSync('site-map.json', 'utf8'));
  const lastmod = siteMap.meta && siteMap.meta.lastUpdated;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(lastmod))) {
    throw new Error('site-map.json meta.lastUpdated is missing or not a YYYY-MM-DD date');
  }
  const vercel = JSON.parse(fs.readFileSync('vercel.json', 'utf8'));
  const rewrites = (vercel.rewrites || []).filter((r) => !r.statusCode || r.statusCode < 400);

  const files = new Set(distFiles());
  const redirects = redirectSources(siteMap);
  const archived = new Set((siteMap.archived || []).map((f) => String(f).replace(/\.html$/, '')));

  const entries = [];
  const excluded = [];
  for (const file of [...files].filter((f) => f.endsWith('.html')).sort()) {
    const route = routeForFile(file);
    const stem = file.replace(/\.html$/, '');
    if (archived.has(stem)) { excluded.push({ file, reason: 'site-map archived' }); continue; }
    if (redirects.has(stem) || redirects.has(route.replace(/^\//, ''))) {
      excluded.push({ file, reason: 'site-map redirect' });
      continue;
    }
    if (NON_PUBLIC_DIRS.some((re) => re.test(file)) || NON_PUBLIC_FILES.has(file)) {
      excluded.push({ file, reason: 'not a public page' });
      continue;
    }
    const html = fs.readFileSync(path.join(DIST, file), 'utf8');
    if (NOINDEX_RE.test(html)) { excluded.push({ file, reason: 'noindex' }); continue; }
    if (!servesFile(route, file, { rewrites, files })) {
      throw new Error(`${file}: route ${route} does not serve this file — fix routeForFile() in scripts/lib/routes.mjs`);
    }
    entries.push({ file, route, lastmod });
  }
  entries.sort((a, b) => a.route.localeCompare(b.route));
  return { entries, excluded };
}

export function renderSitemap(entries) {
  const lines = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<!-- Generated by scripts/generate-sitemap.mjs from site-map.json + the shipped dist/. Do not edit by hand. -->',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
  ];
  for (const e of entries) {
    lines.push(`  <url><loc>${SITE}${e.route}</loc><lastmod>${e.lastmod}</lastmod></url>`);
  }
  lines.push('</urlset>');
  return lines.join('\n') + '\n';
}

async function main() {
  const args = process.argv.slice(2);
  const outIdx = args.indexOf('--out');
  const out = outIdx >= 0 ? args[outIdx + 1] : OUT;
  const { entries, excluded } = await sitemapEntries();
  const xml = renderSitemap(entries);
  if (args.includes('--dry-run')) {
    process.stdout.write(xml);
    return;
  }
  fs.writeFileSync(out, xml);
  console.log(`✓ ${out}: ${entries.length} URLs (${excluded.length} shipped pages excluded)`);
  if (args.includes('--verbose')) {
    for (const e of excluded) console.log(`  · ${e.file} — ${e.reason}`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => {
    console.error(`✗ ${e.message}`);
    process.exit(1);
  });
}
