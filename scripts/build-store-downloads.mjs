#!/usr/bin/env node
// scripts/build-store-downloads.mjs
// ---------------------------------------------------------------
// Package the sellable downloads into ZIP archives — OUTSIDE the
// deploy.
//
// The products are listed in site-map.json → store.downloads[]. Each
// entry names the repo directories that make up the product (`source`).
// This script zips them into out/store/<id>.zip, which is deliberately
// NOT part of dist/: the deploy carries the storefront, not the
// product payloads. The archives are published off-site by
// scripts/publish-store-downloads.mjs, which writes the public URL
// back into store.downloads[].downloadUrl.
//
//   node scripts/build-store-downloads.mjs            → build every product
//   node scripts/build-store-downloads.mjs preset-pack → build one
//   node scripts/build-store-downloads.mjs --list     → list the products
//
// Output:
//   out/store/<id>.zip        the archive
//   out/store/manifest.json   { id, file, bytes, entries } — the publish
//                              step and the site read the sizes from here
//
// Exit codes: 0 ok, 1 a product could not be packaged.
// ---------------------------------------------------------------

import { readFileSync, writeFileSync, existsSync, mkdirSync, statSync, readdirSync } from 'node:fs';
import { join, resolve, relative, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createZip } from './lib/zip.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = join(ROOT, 'out', 'store');
const MAP_PATH = join(ROOT, 'site-map.json');

function readStore() {
  const map = JSON.parse(readFileSync(MAP_PATH, 'utf8'));
  const store = map.store || {};
  const downloads = Array.isArray(store.downloads) ? store.downloads : [];
  return { map, store, downloads };
}

function listFiles(dir) {
  const out = [];
  const walk = (d) => {
    for (const entry of readdirSync(d, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const p = join(d, entry.name);
      if (entry.isDirectory()) walk(p);
      else if (entry.isFile()) out.push(p);
    }
  };
  walk(dir);
  return out;
}

// A product's `source` entries are repo-relative directories. Anything
// that escapes the repo is refused — a product file is never allowed to
// read outside the tree.
export function resolveSource(src) {
  const abs = resolve(ROOT, src);
  const rel = relative(ROOT, abs);
  if (rel.startsWith('..') || resolve(abs) !== abs) {
    throw new Error(`source escapes the repo: ${src}`);
  }
  if (!existsSync(abs) || !statSync(abs).isDirectory()) {
    throw new Error(`source is not a directory: ${src}`);
  }
  return abs;
}

function build(download) {
  const sources = Array.isArray(download.source) ? download.source : [];
  if (!sources.length) throw new Error('no source directories');

  const entries = [];
  for (const src of sources) {
    const dir = resolveSource(src);
    for (const file of listFiles(dir)) {
      entries.push({
        name: relative(ROOT, file).split('\\').join('/'),
        data: readFileSync(file),
        mtime: statSync(file).mtime,
      });
    }
  }
  if (!entries.length) throw new Error('source directories are empty');

  const buf = createZip(entries);
  const file = join(OUT_DIR, `${download.id}.zip`);
  writeFileSync(file, buf);
  // The manifest records a repo-relative path — the publish step and any
  // other tool read it from the repo root, not from this machine.
  const rel = relative(ROOT, file).split('\\').join('/');
  return { id: download.id, file: rel, bytes: buf.length, entries: entries.length };
}

export function main() {
  const args = process.argv.slice(2);
  const { downloads } = readStore();

  if (args.includes('--list')) {
    if (!downloads.length) {
      process.stdout.write('(no downloads in site-map.json → store.downloads)\n');
      return;
    }
    for (const d of downloads) {
      const sources = (d.source || []).join(', ');
      process.stdout.write(`${d.id}\t${d.name}\t${sources}\n`);
    }
    return;
  }

  const only = args.filter(a => !a.startsWith('-'));
  const selected = only.length ? downloads.filter(d => only.includes(d.id)) : downloads;
  if (only.length && !selected.length) {
    process.stderr.write(`no such product: ${only.join(', ')}\n`);
    process.exit(1);
  }
  if (!selected.length) {
    process.stdout.write('(no downloads in site-map.json → store.downloads)\n');
    return;
  }

  mkdirSync(OUT_DIR, { recursive: true });
  const manifest = [];
  let failed = 0;
  for (const d of selected) {
    try {
      const res = build(d);
      manifest.push(res);
      process.stdout.write(
        `[store] ${res.id}\t${(res.bytes / 1024).toFixed(1)} KiB\t${res.entries} files\t` +
        `out/store/${res.id}.zip\n`
      );
    } catch (err) {
      failed++;
      process.stderr.write(`[store] ${d.id}\tFAILED\t${err.message}\n`);
    }
  }

  const manifestPath = join(OUT_DIR, 'manifest.json');
  if (only.length && existsSync(manifestPath)) {
    // A single-product build keeps the other entries of the manifest.
    const previous = JSON.parse(readFileSync(manifestPath, 'utf8'));
    const merged = previous.filter(p => !selected.some(s => s.id === p.id)).concat(manifest);
    writeFileSync(manifestPath, JSON.stringify(merged, null, 2) + '\n');
  } else {
    writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
  }

  if (failed) process.exit(1);
}

// Only run as a CLI — the unit gate imports resolveSource.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
