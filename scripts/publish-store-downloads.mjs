#!/usr/bin/env node
// scripts/publish-store-downloads.mjs
// ---------------------------------------------------------------
// Publish the packaged downloads OFF-SITE and write the public URLs
// back into site-map.json → store.downloads[].downloadUrl.
//
// The deploy carries the storefront, never the product payloads: the
// archives built by scripts/build-store-downloads.mjs live in out/store/
// (outside dist/) and are pushed to a host that sits next to the site
// rather than inside it.
//
// Hosts (first one with a credential wins):
//   1. Vercel Blob — BLOB_READ_WRITE_TOKEN (or <PREFIX>_READ_WRITE_TOKEN).
//      First-party to the deploy, public CDN URLs, already integrated by
//      api/_lib/db.js. This is the default host.
//   2. Hugging Face Hub — HF_TOKEN plus HF_REPO (a dataset repo), pushed
//      with the `hf` CLI. Free and good for cold archives; see
//      docs/hf-publish.md for the Hub setup this repo already uses.
//   3. Gumroad — nothing to push. The file is uploaded to the Gumroad
//      product page by hand and the product URL is pasted into
//      store.downloads[].gumroadUrl; the marketplace links there.
//
// With no credential for any host the script prints `(env skip: ...)`
// and exits 0 — the repo's convention for a check that needs a resource
// it does not have. Nothing is written to site-map.json in that case.
//
//   node scripts/publish-store-downloads.mjs            → publish all
//   node scripts/publish-store-downloads.mjs preset-pack → publish one
//   node scripts/publish-store-downloads.mjs --dry-run  → print, write nothing
//
// Exit codes: 0 ok (including env skip), 1 a product could not be published.
// ---------------------------------------------------------------

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = join(ROOT, 'out', 'store');
const MAP_PATH = join(ROOT, 'site-map.json');

function readMapText() {
  return readFileSync(MAP_PATH, 'utf8');
}

// ---- hosts ---------------------------------------------------------------

// The repo's own Blob credentials are resolved from any
// <PREFIX>_READ_WRITE_TOKEN in the env (see api/_lib/db.js). Reuse the
// same shape so a deployment only has to set the one variable it already
// has.
function blobToken() {
  const env = process.env;
  const direct = env.BLOB_READ_WRITE_TOKEN;
  if (direct) return direct;
  for (const key of Object.keys(env)) {
    if (!/^blob\d*_read_write_token$/i.test(key)) continue;
    if (env[key]) return env[key];
  }
  return null;
}

async function publishToBlob(file, id) {
  const token = blobToken();
  if (!token) return null;
  const { put } = await import('@vercel/blob');
  const data = readFileSync(file);
  const result = await put(`store/${id}.zip`, data, {
    access: 'public',
    addRandomSuffix: false,
    allowOverwrite: true,
    contentType: 'application/zip',
    token,
  });
  return result.url;
}

function publishToHf(file, id) {
  const token = process.env.HF_TOKEN;
  const repo = process.env.HF_REPO;
  if (!token || !repo) return null;
  const cli = spawnSync('which', ['hf'], { encoding: 'utf8' });
  const bin = cli.status === 0 ? cli.stdout.trim() : null;
  if (!bin) {
    process.stderr.write('[store] hf CLI not found — install `huggingface-cli` to publish to the Hub\n');
    return null;
  }
  const res = spawnSync(bin, ['upload', repo, file, `store/${id}.zip`, '--repo-type', 'dataset'], {
    encoding: 'utf8',
    env: { ...process.env, HF_TOKEN: token },
  });
  if (res.status !== 0) {
    process.stderr.write(`[store] hf upload failed: ${(res.stderr || res.stdout || '').trim()}\n`);
    return null;
  }
  return `https://huggingface.co/datasets/${repo}/resolve/main/store/${id}.zip`;
}

// ---- site-map write-back -------------------------------------------------

// The manifest is hand-formatted, so the write-back is a targeted text
// edit inside the store.downloads block instead of a JSON re-serialise
// (which would reformat the whole file).
export function writeDownloadUrl(text, id, url, bytes) {
  const downloadsAt = text.indexOf('"downloads"');
  if (downloadsAt === -1) return text;
  const arrayAt = text.indexOf('[', downloadsAt);
  if (arrayAt === -1) return text;

  // Find the matching ']' of the downloads array.
  let depth = 0;
  let inString = false;
  let escape = false;
  let end = -1;
  for (let i = arrayAt; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escape) escape = false;
      else if (ch === '\\') escape = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') { inString = true; continue; }
    if (ch === '[' || ch === '{') depth++;
    else if (ch === ']' || ch === '}') {
      depth--;
      if (depth === 0) { end = i; break; }
    }
  }
  if (end === -1) return text;

  const block = text.slice(arrayAt, end + 1);
  const idAt = block.indexOf(`"id": "${id}"`);
  if (idAt === -1) return text;

  // The object that holds this id ends at the next '}'.
  const objEnd = block.indexOf('}', idAt);
  if (objEnd === -1) return text;
  const obj = block.slice(idAt, objEnd);

  let updated = obj;
  updated = updated.replace(/("downloadUrl"\s*:\s*)"[^"]*"/, `$1"${url}"`);
  updated = updated.replace(/("bytes"\s*:\s*)\d+/, `$1${bytes}`);
  const newBlock = block.slice(0, idAt) + updated + block.slice(objEnd);
  return text.slice(0, arrayAt) + newBlock + text.slice(end + 1);
}

// ---- main ----------------------------------------------------------------

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const only = args.filter(a => !a.startsWith('-'));

  const map = JSON.parse(readMapText());
  const downloads = (map.store && Array.isArray(map.store.downloads)) ? map.store.downloads : [];
  const selected = only.length ? downloads.filter(d => only.includes(d.id)) : downloads;
  if (only.length && !selected.length) {
    process.stderr.write(`no such product: ${only.join(', ')}\n`);
    process.exit(1);
  }
  if (!selected.length) {
    process.stdout.write('(no downloads in site-map.json → store.downloads)\n');
    return;
  }

  const manifestPath = join(OUT_DIR, 'manifest.json');
  if (!existsSync(manifestPath)) {
    process.stderr.write('out/store/manifest.json is missing — run scripts/build-store-downloads.mjs first\n');
    process.exit(1);
  }
  const built = JSON.parse(readFileSync(manifestPath, 'utf8'));
  const builtById = new Map(built.map(b => [b.id, b]));

  const hasBlob = !!blobToken();
  const hasHf = !!(process.env.HF_TOKEN && process.env.HF_REPO);
  if (!hasBlob && !hasHf) {
    process.stdout.write(
      '(env skip: no off-site host credential — set BLOB_READ_WRITE_TOKEN for Vercel Blob, ' +
      'or HF_TOKEN + HF_REPO for the Hugging Face Hub)\n'
    );
    return;
  }

  let text = readMapText();
  let published = 0;
  let failed = 0;

  for (const d of selected) {
    const info = builtById.get(d.id);
    if (!info) {
      process.stderr.write(`[store] ${d.id}\tSKIPPED\tnot built — run scripts/build-store-downloads.mjs\n`);
      failed++;
      continue;
    }
    const file = join(ROOT, info.file);
    if (!existsSync(file)) {
      process.stderr.write(`[store] ${d.id}\tSKIPPED\t${info.file} is missing\n`);
      failed++;
      continue;
    }
    let url = null;
    try {
      url = hasBlob ? await publishToBlob(file, d.id) : publishToHf(file, d.id);
    } catch (err) {
      process.stderr.write(`[store] ${d.id}\tFAILED\t${err.message}\n`);
      failed++;
      continue;
    }
    if (!url) {
      process.stderr.write(`[store] ${d.id}\tFAILED\tno host accepted the upload\n`);
      failed++;
      continue;
    }
    published++;
    process.stdout.write(`[store] ${d.id}\t${(info.bytes / 1024).toFixed(1)} KiB\t${url}\n`);
    if (!dryRun) text = writeDownloadUrl(text, d.id, url, info.bytes);
  }

  if (!dryRun && published) {
    writeFileSync(MAP_PATH, text);
    process.stdout.write(`[store] wrote ${published} download URL(s) into site-map.json\n`);
  } else if (dryRun) {
    process.stdout.write('(dry run — site-map.json was not changed)\n');
  }

  if (failed) process.exit(1);
}

// Only run as a CLI — the unit gate imports writeDownloadUrl.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(err => {
    process.stderr.write(`[store] ${err.message}\n`);
    process.exit(1);
  });
}
