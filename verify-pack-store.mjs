#!/usr/bin/env node
// verify-pack-store.mjs
//
// Contract spec for the 13 pack-* sets published into the curated marketplace.
//
// The marketplace installs a curated set by fetching the file named in
// index.json and reading its layers — so this asserts the whole chain end to
// end: index -> set doc -> asset URLs actually serving real bytes. A set whose
// layer URL 404s renders as an empty engine and is exactly the failure a
// manifest-only test would miss.
//
//   node verify-pack-store.mjs
//   BASE=https://sainted-word-records.vercel.app node verify-pack-store.mjs

import fs from 'node:fs';

const BASE = (process.env.BASE || 'http://127.0.0.1:5177').replace(/\/$/, '');

let failed = 0;
const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok: !!ok, detail });
  if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
}

const idx = await fetch(`${BASE}/marketplace/curated/index.json`)
  .then((r) => r.json());
const packEntries = idx.sets.filter((s) => /pack-.*\.swr-set\.json$/.test(s.file));

check('index count matches the number of entries', idx.count === idx.sets.length,
  `count=${idx.count} sets=${idx.sets.length}`);
check('13 pack sets are listed', packEntries.length === 13, `${packEntries.length} pack sets`);

// The marketplace page reads these exact files; make sure every one is
// reachable and parses before we talk about what is inside it.
const docs = [];
let unreachable = [];
for (const e of packEntries) {
  const r = await fetch(`${BASE}${e.file}`).catch(() => null);
  if (!r || !r.ok) { unreachable.push(`${e.file} HTTP ${r ? r.status : 'fetch failed'}`); continue; }
  docs.push({ entry: e, doc: await r.json() });
}
check('every pack set file is reachable', unreachable.length === 0, unreachable.join(' | '));
check('every pack set parses', docs.length === packEntries.length, `${docs.length}/${packEntries.length}`);

check('index id + name agree with the set file', docs.every(({ entry, doc }) =>
  entry.id === doc.id && entry.name === doc.name && entry.engine === doc.engine),
  docs.filter(({ entry, doc }) => entry.id !== doc.id || entry.name !== doc.name).map(d => d.entry.name).join(' | '));

const noLayers = docs.filter(({ doc }) => !Array.isArray(doc.layers) || !doc.layers.length);
check('every set has layers', noLayers.length === 0, noLayers.map(d => d.entry.name).join(' | '));

// The load-bearing check: layer assets must actually serve.
let assetBad = [];
let layerCount = 0;
for (const { entry, doc } of docs) {
  for (const l of doc.layers) {
    layerCount++;
    const r = await fetch(`${BASE}${l.asset.url}`, { method: 'HEAD' }).catch(() => null);
    if (!r || !r.ok) { assetBad.push(`${entry.name}: ${l.asset.url} HTTP ${r ? r.status : 'no response'}`); continue; }
    const size = Number(r.headers.get('content-length'));
    if (l.asset.size && size && size !== l.asset.size) {
      assetBad.push(`${entry.name}: ${l.asset.name} size ${l.asset.size} != ${size}`);
    }
  }
  const ar = await fetch(`${BASE}${doc.audio.url}`, { method: 'HEAD' }).catch(() => null);
  if (!ar || !ar.ok) assetBad.push(`${entry.name}: audio ${doc.audio.url} HTTP ${ar ? ar.status : 'no response'}`);
}
check('every layer asset serves with the declared size', assetBad.length === 0,
  assetBad.slice(0, 3).join(' | '));
// 3 layers per pack, EXCEPT where the pack has fewer than 3 photos: you cannot
// invent layers from one frame. istanbul-bw has a single image, so 13 packs
// give 12*3 + 1 = 37, not 39.
const packsManifest = JSON.parse(fs.readFileSync('packs/manifest.json', 'utf8'));
const expectedLayers = packEntries.reduce((n, e) => {
  const slug = e.file.match(/pack-(.+)\.swr-set\.json$/)[1];
  const stills = (packsManifest.packs[slug] || []).filter((f) => /\.(webp|png|jpe?g|avif)$/i.test(f));
  return n + Math.min(3, stills.length);
}, 0);
check('layer count matches the photos each pack actually has',
  layerCount === expectedLayers, `${layerCount} layers, ${expectedLayers} expected`);

check('every set has a real description', docs.every(({ doc }) =>
  typeof doc.description === 'string' && doc.description.length >= 40));

check('every set carries an engine, fx and settings', docs.every(({ doc }) =>
  typeof doc.engine === 'string' && doc.fx && typeof doc.fx === 'object'
  && doc.settings && typeof doc.settings.bpm === 'number'));

check('packs are free — no price field on any set', docs.every(({ doc }) =>
  !('price' in doc) && !('priceCents' in doc) && !('paid' in doc)));

// Name hygiene: str.title() used to ship "Ufo Portrait" / "Istanbul Bw".
const badNames = docs.map(d => d.doc.name).filter(n => /\b(Ufo|Bw|Ai|Dj|Hd|Idm)\b/.test(n));
check('display names use real casing (UFO, B&W)', badNames.length === 0, badNames.join(' | '));

// The curated files are committed, so the page and the engine agree.
const onDisk = fs.readdirSync('marketplace/curated').filter(f => /^pack-.*\.swr-set\.json$/.test(f));
check('set files are tracked on disk', onDisk.length === 13, `${onDisk.length} files`);

for (const r of results) if (!r.ok) console.log(`  ✗ ${r.name}${r.detail ? ` — ${r.detail}` : ''}`);
console.log(failed === 0 ? 'OK — all pack-store checks passed' : `FAILED — ${failed} check(s) failed`);
process.exit(failed === 0 ? 0 : 1);
