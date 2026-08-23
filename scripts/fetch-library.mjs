#!/usr/bin/env node
// scripts/fetch-library.mjs
//
// One-time + every-CI-run: download the engine's demo asset library from
// Vercel Blob. This is the production counterpart of the local `./library/`
// directory, which is git-ignored. Runs as a prebuild step in CI (and
// locally when the user wants to mirror prod assets).
//
// Usage:
//   LIBRARY_BLOB_URL=https://<id>.public.blob.vercel-storage.com/library.tar.gz \
//     node scripts/fetch-library.mjs
//
// Or with explicit auth (for private blobs):
//   BLOB_READ_WRITE_TOKEN=vercel_blob_xxx node scripts/fetch-library.mjs
//
// Idempotent: if ./library/ already exists and contains manifest.json, exits
// 0 without re-downloading (unless FORCE=1 is set).

import { existsSync, mkdirSync, createWriteStream, rmSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { createGunzip } from 'node:zlib';
import { Readable } from 'node:stream';

const URL_  = process.env.LIBRARY_BLOB_URL;
const TOKEN = process.env.BLOB_READ_WRITE_TOKEN;
const FORCE = process.env.FORCE === '1';
const LIB   = resolve('library');
const TMP   = resolve('.library.tmp.tar.gz');

function log(m) { process.stdout.write(`[fetch-library] ${m}\n`); }

async function downloadTo(url, destPath) {
  const headers = {};
  if (TOKEN) headers.Authorization = `Bearer ${TOKEN}`;
  const res = await fetch(url, { headers });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} ${res.statusText} for ${url}`);
  }
  const fileStream = createWriteStream(destPath);
  await pipeline(Readable.fromWeb(res.body), fileStream);
}

async function extractTarGz(srcPath, destDir) {
  // Use the tar CLI if available (Node 18+ doesn't have a built-in tar parser,
  // and pulling in a dependency for one extraction is overkill).
  const { spawn } = await import('node:child_process');
  return new Promise((resolveP, rejectP) => {
    const child = spawn('tar', ['-xzf', srcPath, '-C', destDir], { stdio: 'inherit' });
    child.on('error', rejectP);
    child.on('exit', (code) => code === 0 ? resolveP() : rejectP(new Error(`tar exited ${code}`)));
  });
}

async function main() {
  if (!URL_) {
    log('LIBRARY_BLOB_URL not set — skipping (engine will ship without demo assets).');
    log('  Local dev: expected. The engine has no library to demo.');
    log('  Production: set this in the Vercel project environment.');
    process.exit(0);
  }

  // Skip if already present (CI warm cache, repeated local builds)
  if (!FORCE && existsSync(resolve(LIB, 'manifest.json'))) {
    log(`./library already present (manifest.json exists) — skipping download.`);
    log(`  (set FORCE=1 to re-download)`);
    process.exit(0);
  }

  log(`fetching ${URL_}`);
  if (existsSync(TMP)) rmSync(TMP, { force: true });
  await downloadTo(URL_, TMP);
  const size = statSync(TMP).size;
  log(`downloaded ${(size / 1024 / 1024).toFixed(1)} MB`);

  // Wipe existing library/ if it exists, then extract
  if (existsSync(LIB)) rmSync(LIB, { recursive: true, force: true });
  mkdirSync(LIB, { recursive: true });
  await extractTarGz(TMP, LIB);
  log(`extracted to ./library`);

  // Cleanup the tarball
  rmSync(TMP, { force: true });
  log('done');
}

main().catch((err) => {
  console.error(`[fetch-library] FAILED: ${err.message}`);
  // Don't fail the build on missing assets — just warn. The build still
  // produces a working (empty-library) site. The warning in vite.config.js
  // is enough signal for ops to notice.
  log('continuing build without demo assets');
  process.exit(0);
});
