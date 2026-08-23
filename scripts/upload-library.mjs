#!/usr/bin/env node
// scripts/upload-library.mjs
//
// One-time + on-demand: upload the local ./library/ directory to Vercel Blob
// as a single tarball, and rewrite library/manifest.json URLs to point at
// the blob CDN. Run this after adding new assets to ./library/.
//
// Usage:
//   1) Install:  npm install --save-dev @vercel/blob
//   2) Get a token: vercel env pull .env.local  (or grab BLOB_READ_WRITE_TOKEN
//      from the Vercel dashboard → Storage → Blob → your-store → tokens)
//   3) Upload:  BLOB_READ_WRITE_TOKEN=... node scripts/upload-library.mjs
//
// The script:
//   - tars up ./library/ into a .tar.gz
//   - uploads it to Vercel Blob under pathname 'library/library.tar.gz'
//   - prints the public URL  →  set that as LIBRARY_BLOB_URL in Vercel
//   - rewrites library/manifest.json entries to use absolute blob URLs
//   - prints a summary so you can review before committing the manifest
//
// Does NOT auto-commit. You commit the new manifest yourself after review.

import { createReadStream, statSync, readFileSync, writeFileSync, existsSync, createWriteStream } from 'node:fs';
import { resolve, basename } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { createGzip } from 'node:zlib';
import { spawn } from 'node:child_process';

const TOKEN = process.env.BLOB_READ_WRITE_TOKEN;
if (!TOKEN) {
  console.error('BLOB_READ_WRITE_TOKEN not set. Aborting.');
  console.error('  Get one from: Vercel dashboard → Storage → your-store → Tokens');
  process.exit(1);
}
if (!existsSync(resolve('library'))) {
  console.error('./library/ does not exist. Nothing to upload.');
  process.exit(1);
}

const log = (m) => process.stdout.write(`[upload-library] ${m}\n`);
const TAR_PATH = resolve('.library.upload.tar.gz');

async function main() {
  log('tarring ./library/');
  await new Promise((res, rej) => {
    const child = spawn('tar', ['-czf', TAR_PATH, 'library'], { stdio: 'inherit' });
    child.on('error', rej);
    child.on('exit', (code) => code === 0 ? res() : rej(new Error(`tar exited ${code}`)));
  });
  const size = statSync(TAR_PATH).size;
  log(`tarball: ${(size / 1024 / 1024).toFixed(1)} MB`);

  // Import dynamically so the script can be run without @vercel/blob installed
  // in older setups. (Once you install it, this works.)
  const { put } = await import('@vercel/blob');
  log('uploading to Vercel Blob …');
  const blob = await put('library/library.tar.gz', createReadStream(TAR_PATH), {
    access: 'public',
    token: TOKEN,
    contentType: 'application/gzip',
    addRandomSuffix: false,  // keep the name stable for LIBRARY_BLOB_URL
  });
  log(`uploaded: ${blob.url}`);

  // Cleanup tarball
  const { unlinkSync } = await import('node:fs');
  unlinkSync(TAR_PATH);

  // Rewrite manifest URLs
  const manifestPath = resolve('library/manifest.json');
  if (!existsSync(manifestPath)) {
    log('no library/manifest.json — skipping URL rewrite');
  } else {
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'));
    const baseUrl = blob.url.replace(/\/library\.tar\.gz$/, '');
    log(`rewriting manifest URLs to base: ${baseUrl}`);
    let changed = 0;
    function rewrite(entry) {
      if (entry && typeof entry === 'object') {
        if (typeof entry.url === 'string' && entry.url.startsWith('library/')) {
          entry.url = baseUrl + '/' + entry.url.slice('library/'.length);
          changed++;
        }
        if (Array.isArray(entry.items)) entry.items.forEach(rewrite);
        if (Array.isArray(entry.assets)) entry.assets.forEach(rewrite);
        for (const v of Object.values(entry)) {
          if (Array.isArray(v)) v.forEach(rewrite);
        }
      }
    }
    rewrite(manifest);
    writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
    log(`rewrote ${changed} URL(s) in manifest.json`);
  }

  log('');
  log('NEXT STEPS:');
  log(`  1) Set LIBRARY_BLOB_URL=${blob.url} in the Vercel project environment.`);
  log('  2) Commit the new library/manifest.json.');
  log('  3) Push to main — Vercel auto-deploys, and the build will fetch the tarball.');
  log('');
  log('To test locally:');
  log(`  LIBRARY_BLOB_URL=${blob.url} npm run build:vercel`);
}

main().catch((err) => {
  console.error(`[upload-library] FAILED: ${err.message}`);
  console.error(err.stack);
  process.exit(1);
});
