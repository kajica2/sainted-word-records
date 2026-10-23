// scripts/check-versions-dropdown.mjs — keeps the versions dropdown and the
// version pages in step.
//
// Three lists describe the same thing and have drifted apart twice:
//
//   1. client/looks-menu.client.js      VARIANT_CATALOG — what the dropdown
//                                          offers (every shipped version page)
//   2. client/variant-switcher.client.js VARIANTS     — what the engine can
//                                          run in place (a page with a canvas
//                                          drawFx pass)
//   3. versions/*.html                                 — what actually ships
//
// The failure this gate exists to stop: a version page ships, it never
// reaches list 1, and its own dropdown does not list it. That is exactly
// what happened to clean, simple and console — three pages the site
// advertised (cards on /versions, entries in the root catalogue) that the
// dropdown silently omitted.
//
// A green gate that can no longer detect anything is worse than no gate, so
// this script is deliberately blunt: it re-derives the truth from the files
// on disk rather than trusting a generated manifest.
//
// Run: node scripts/check-versions-dropdown.mjs

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const VERSIONS_DIR = join(ROOT, 'versions');

// ---------------------------------------------------------------------------
// Version pages that ship but are NOT version-page dropdown entries, each
// with the reason. Removing a reason here is a deliberate act; the script
// prints the exclusion list on every run so it cannot rot unnoticed.
// ---------------------------------------------------------------------------
const EXCLUSIONS = {
  'index': 'the versions index itself — it lists the others',
  'gallery': 'an art-direction grade, reachable through the Grade presets group',
  'music-video-gallery': 'a video player page with eight <video> elements, not a render pass',
  'credits-storyline': 'a plugin page, not a version',
  'temple-of-control': 'a standalone page with no render pass',
};

const results = [];
function check(name, fn) {
  let ok = false, detail = '';
  try {
    const r = fn();
    ok = r === true;
    detail = typeof r === 'string' ? r : '';
  } catch (e) {
    detail = e.message;
  }
  results.push({ name, ok, detail });
  console.log(`  ${ok ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`);
}

// ---------------------------------------------------------------------------
// 1. Read the catalogue out of client/looks-menu.client.js
// ---------------------------------------------------------------------------
const looksSrc = readFileSync(join(ROOT, 'client/looks-menu.client.js'), 'utf8');

const catalogue = [];
{
  const block = looksSrc.match(/const VARIANT_CATALOG\s*=\s*\[([\s\S]*?)\n  \];/);
  if (!block) {
    console.error('  ✗ could not find VARIANT_CATALOG in client/looks-menu.client.js');
    process.exit(1);
  }
  const entryRe = /\{\s*id:\s*'([a-z0-9_-]+)',\s*name:\s*'([^']*)'(?:\s*,\s*desc:\s*'([^']*)')?\s*\}/g;
  let m;
  while ((m = entryRe.exec(block[1])) !== null) {
    catalogue.push({ id: m[1], name: m[2], desc: m[3] || '' });
  }
}

// ---------------------------------------------------------------------------
// 2. Read the switcher's VARIANTS table out of client/variant-switcher.client.js
// ---------------------------------------------------------------------------
const switchSrc = readFileSync(join(ROOT, 'client/variant-switcher.client.js'), 'utf8');
const switcher = [];
{
  const block = switchSrc.match(/const VARIANTS\s*=\s*\[([\s\S]*?)\n  \];/);
  if (!block) {
    console.error('  ✗ could not find VARIANTS in client/variant-switcher.client.js');
    process.exit(1);
  }
  const entryRe = /\{\s*id:\s*'([a-z0-9_-]+)',\s*name:\s*'([^']*)'(?:\s*,\s*desc:\s*'([^']*)')?/g;
  let m;
  while ((m = entryRe.exec(block[1])) !== null) {
    switcher.push({ id: m[1], name: m[2], desc: m[3] || '' });
  }
}

// ---------------------------------------------------------------------------
// 3. What actually ships in versions/
// ---------------------------------------------------------------------------
const pageFiles = readdirSync(VERSIONS_DIR).filter((f) => f.endsWith('.html'));
const pageSrc = new Map();
for (const f of pageFiles) {
  pageSrc.set(f.replace(/\.html$/, ''), readFileSync(join(VERSIONS_DIR, f), 'utf8'));
}

/** A page counts as a version page if it renders something, or if the
 *  site's own catalogue surfaces present it as one. */
function isVersionPage(id) {
  if (EXCLUSIONS[id]) return false;
  const src = pageSrc.get(id);
  if (!src) return false;
  if (/<canvas[\s>]/i.test(src)) return true;
  // clean is a linear editor: a <video> timeline, no canvas. It is still a
  // shipped version, presented as one on /versions, so it counts.
  if (/<video[\s>]/i.test(src)) return true;
  return false;
}

/** The site's catalogue surfaces: the card grid on /versions/index.html and
 *  the style-card grid on the root versions.html. */
function cataloguedIds() {
  const ids = new Set();
  for (const file of ['index.html', '../versions.html']) {
    const path = join(VERSIONS_DIR, file);
    if (!existsSync(path)) continue;
    const src = readFileSync(path, 'utf8');
    const re = /href="\/versions\/([a-z0-9_-]+)(?:\.html)?"/g;
    let m;
    while ((m = re.exec(src)) !== null) ids.add(m[1]);
  }
  return ids;
}

// ---------------------------------------------------------------------------
// 4. Checks
// ---------------------------------------------------------------------------

check('the catalogue parsed out of looks-menu.client.js', () => {
  if (catalogue.length === 0) return 'no entries parsed';
  return true;
});

check('the switcher table parsed out of variant-switcher.client.js', () => {
  if (switcher.length === 0) return 'no entries parsed';
  return true;
});

check('the catalogue has no duplicate ids', () => {
  const seen = new Set();
  const dupes = [];
  for (const v of catalogue) {
    if (seen.has(v.id)) dupes.push(v.id);
    seen.add(v.id);
  }
  return dupes.length ? `duplicated: ${dupes.join(', ')}` : true;
});

check('every catalogue entry has a versions/<id>.html page', () => {
  const missing = catalogue.filter((v) => !pageSrc.has(v.id)).map((v) => v.id);
  return missing.length ? `no page for: ${missing.join(', ')}` : true;
});

check('every catalogue page mounts the looks dropdown', () => {
  const missing = catalogue
    .filter((v) => pageSrc.has(v.id) && !/data-looks-mount/.test(pageSrc.get(v.id)))
    .map((v) => v.id);
  return missing.length
    ? `no data-looks-mount on: ${missing.join(', ')} — the dropdown cannot reach them`
    : true;
});

check('every catalogue page has a vercel.json rewrite for /versions/<id>', () => {
  const vercel = JSON.parse(readFileSync(join(ROOT, 'vercel.json'), 'utf8'));
  const sources = new Set((vercel.rewrites || []).map((r) => r.source));
  const missing = catalogue
    .filter((v) => !sources.has(`/versions/${v.id}`) && !sources.has(`/versions/${v.id}/`))
    .map((v) => v.id);
  return missing.length
    ? `extensionless /versions/<id> would 404 for: ${missing.join(', ')}`
    : true;
});

check('every switcher variant is in the catalogue', () => {
  const inCatalogue = new Set(catalogue.map((v) => v.id));
  const missing = switcher.filter((v) => !inCatalogue.has(v.id)).map((v) => v.id);
  return missing.length ? `not in the catalogue: ${missing.join(', ')}` : true;
});

check('catalogue and switcher agree on name and description', () => {
  const byId = new Map(switcher.map((v) => [v.id, v]));
  const drift = [];
  for (const v of catalogue) {
    const s = byId.get(v.id);
    if (!s) continue;
    if (s.name !== v.name) drift.push(`${v.id}: name "${v.name}" vs "${s.name}"`);
    if ((s.desc || '') !== (v.desc || '')) drift.push(`${v.id}: desc "${v.desc}" vs "${s.desc}"`);
  }
  return drift.length ? drift.join('; ') : true;
});

check('every switcher variant page carries a real drawFx pass', () => {
  const missing = switcher
    .filter((v) => pageSrc.has(v.id) && !/function drawFx\s*\(/.test(pageSrc.get(v.id)))
    .map((v) => v.id);
  return missing.length ? `no drawFx on: ${missing.join(', ')}` : true;
});

check('every shipped version page is in the catalogue', () => {
  const inCatalogue = new Set(catalogue.map((v) => v.id));
  const missing = [...pageSrc.keys()]
    .filter((id) => isVersionPage(id) && !inCatalogue.has(id))
    .sort();
  return missing.length
    ? `shipped but not in the dropdown: ${missing.join(', ')}`
    : true;
});

check('every catalogued page in the site surfaces is in the catalogue', () => {
  const inCatalogue = new Set(catalogue.map((v) => v.id));
  const missing = [...cataloguedIds()]
    .filter((id) => pageSrc.has(id) && !inCatalogue.has(id) && !EXCLUSIONS[id])
    .sort();
  return missing.length
    ? `linked from /versions but not in the dropdown: ${missing.join(', ')}`
    : true;
});

check('every /versions/<id> link in the catalogue surfaces resolves to a file', () => {
  const broken = [];
  for (const file of ['index.html', '../versions.html']) {
    const path = join(VERSIONS_DIR, file);
    if (!existsSync(path)) continue;
    const src = readFileSync(path, 'utf8');
    const re = /href="\/versions\/([a-z0-9_-]+)(?:\.html)?"/g;
    let m;
    while ((m = re.exec(src)) !== null) {
      const id = m[1];
      if (pageSrc.has(id)) continue;
      // Not a file: fine if vercel.json rewrites it, otherwise it 404s.
      const vercel = JSON.parse(readFileSync(join(ROOT, 'vercel.json'), 'utf8'));
      const sources = new Set((vercel.rewrites || []).map((r) => r.source));
      if (sources.has(`/versions/${id}`) || sources.has(`/versions/${id}/`)) continue;
      broken.push(`${file} -> /versions/${id}`);
    }
  }
  return broken.length ? `no page and no rewrite: ${broken.join('; ')}` : true;
});

check('the exclusion list only names pages that exist', () => {
  const stale = Object.keys(EXCLUSIONS).filter((id) => !pageSrc.has(id));
  return stale.length ? `excluded but not shipped: ${stale.join(', ')}` : true;
});

// ---------------------------------------------------------------------------

const failed = results.filter((r) => !r.ok);
console.log('');
console.log(`  catalogue: ${catalogue.length} entries · switcher: ${switcher.length} entries · pages: ${pageSrc.size}`);
console.log('');
console.log(failed.length === 0
  ? `VERSIONS-DROPDOWN: ALL GREEN (${results.length} checks)`
  : `VERSIONS-DROPDOWN: ${failed.length} CHECK(S) FAILED`);
process.exit(failed.length === 0 ? 0 : 1);
