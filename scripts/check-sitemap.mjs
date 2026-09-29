#!/usr/bin/env node
// scripts/check-sitemap.mjs — the sitemap gate.
//
// sitemap.xml is generated (scripts/generate-sitemap.mjs) and this is the gate
// that keeps it honest. It is in the `check` group, so any IA change that adds
// or removes a page fails here until the file is regenerated.
//
// Assertions:
//   1. no drift — regenerating from site-map.json + the shipped dist/ produces
//      the committed file byte for byte (`npm run build:sitemap`);
//   2. every <loc> is an absolute https URL on the site origin, with no query
//      string or fragment, and no <loc> appears twice;
//   3. no <loc> is a URL site-map.json redirects or archives — the defect that
//      motivated the generator (nine 301s and five archived registers were
//      advertised by the hand-maintained file);
//   4. every shipped content page appears exactly once, and nothing else does:
//      a committed <loc> that is not a page the generator would emit is named,
//      with the reason the generator excluded the page if it knows it.
//
// Run: node scripts/check-sitemap.mjs

import fs from 'node:fs';
import { sitemapEntries, renderSitemap, SITE, OUT } from './generate-sitemap.mjs';

const failures = [];
const fail = (msg) => failures.push(msg);

const siteMap = JSON.parse(fs.readFileSync('site-map.json', 'utf8'));

if (!fs.existsSync(OUT)) {
  console.log(`✗ ${OUT} is missing — run npm run build:sitemap`);
  process.exit(1);
}
const committed = fs.readFileSync(OUT, 'utf8');

// 1. drift
const { entries, excluded } = await sitemapEntries();
const expected = renderSitemap(entries);
if (committed !== expected) {
  fail(`${OUT} is out of date — run npm run build:sitemap`);
  const a = committed.split('\n');
  const b = expected.split('\n');
  let shown = 0;
  let differing = 0;
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if (a[i] === b[i]) continue;
    differing++;
    if (shown++ >= 5) continue;
    console.log(`    line ${i + 1}:`);
    if (a[i] !== undefined) console.log(`      committed: ${a[i]}`);
    if (b[i] !== undefined) console.log(`      generated: ${b[i]}`);
  }
  console.log(`    ${differing} differing line(s)`);
}

// 2. shape
const locs = [...committed.matchAll(/<loc>([^<]*)<\/loc>/g)].map((m) => m[1]);
const seen = new Set();
for (const loc of locs) {
  if (!loc.startsWith(SITE + '/') && loc !== SITE) fail(`${loc} is not an absolute ${SITE} URL`);
  else {
    const route = loc.slice(SITE.length);
    if (route.includes('?') || route.includes('#')) fail(`${loc} carries a query string or fragment`);
  }
  if (seen.has(loc)) fail(`${loc} appears more than once`);
  seen.add(loc);
}
const lastmods = [...committed.matchAll(/<lastmod>([^<]*)<\/lastmod>/g)].map((m) => m[1]);
for (const d of lastmods) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) fail(`<lastmod>${d}</lastmod> is not a YYYY-MM-DD date`);
}
if (locs.length !== (committed.match(/<url>/g) || []).length) {
  fail(`${committed.match(/<url>/g) || []} <url> entries but ${locs.length} <loc> entries`);
}

// 3. redirected / archived URLs must not be advertised
const redirects = new Set();
for (const r of siteMap.redirects || []) {
  if (!r || !r.from) continue;
  const clean = String(r.from).replace(/^\//, '').replace(/\.html$/, '').replace(/\/$/, '');
  for (const s of [`/${clean}`, `/${clean}/`, `/${clean}.html`]) redirects.add(s);
}
const archived = new Set((siteMap.archived || []).map((f) => {
  const stem = String(f).replace(/\.html$/, '').replace(/\/$/, '');
  return `/${stem}`;
}));
for (const loc of locs) {
  const route = loc.slice(SITE.length);
  if (redirects.has(route)) fail(`${loc} is a site-map.json redirect — a 301 must not be advertised`);
  const bare = route.replace(/\.html$/, '').replace(/\/$/, '');
  if (archived.has(bare)) fail(`${loc} is an archived page (site-map.json "archived")`);
}

// 4. coverage: exactly the shipped content pages, once each
const expectedLocs = new Set(entries.map((e) => SITE + e.route));
const committedLocs = new Set(locs);
const reasonFor = new Map(excluded.map((e) => [e.file, e.reason]));
for (const e of entries) {
  if (!committedLocs.has(SITE + e.route)) fail(`${e.file} (${SITE}${e.route}) is missing from ${OUT}`);
}
for (const loc of committedLocs) {
  if (expectedLocs.has(loc)) continue;
  const route = loc.slice(SITE.length);
  const rel = route.replace(/^\//, '');
  const candidate = reasonFor.has(rel) ? rel : reasonFor.has(rel + '.html') ? rel + '.html' : null;
  fail(`${loc} is not a page the generator emits${candidate ? ` (${candidate}: ${reasonFor.get(candidate)})` : ''}`);
}

console.log(`${locs.length} URLs checked against ${entries.length} shipped content pages (${excluded.length} excluded)`);
console.log(`${failures.length === 0 ? '✓ all sitemap checks passed' : '✗ ' + failures.length + ' problem(s)'}`);
if (failures.length) {
  for (const f of failures) console.log('  ✗ ' + f);
  process.exit(1);
}
