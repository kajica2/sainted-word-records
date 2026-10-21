#!/usr/bin/env node
// scripts/publish-media-offsite.mjs
// ---------------------------------------------------------------
// Publish the curated media packs OFF-SITE so the deploy does not have
// to carry them.
//
// Why: `packs/` is 582 files and ~40 MB — a quarter of the build. The
// packs are opt-in content: the library drawer and /packs.html fetch
// /packs/manifest.json and then load the media listed in it. The seam
// is exactly one file, the manifest, so the build can ship the manifest
// alone (with its `base` rewritten to the off-site URL) and let the
// browser fetch the media cross-origin from the host.
//
// This script is the other half: it uploads the media and prints the
// PACKS_BASE the deploy environment needs.
//
// Hosts:
//   1. Vercel Blob — BLOB_READ_WRITE_TOKEN (or any <PREFIX>_READ_WRITE_TOKEN,
//      the same shape the repo's api/_lib/db.js uses). Public CDN URLs,
//      already a dependency. This is the default host.
//   2. Hugging Face Hub — HF_TOKEN plus HF_REPO (a dataset repo), pushed
//      with the `hf` CLI. See docs/hf-publish.md for the Hub setup.
//
//   node scripts/publish-media-offsite.mjs                 → upload to Blob
//   node scripts/publish-media-offsite.mjs --host hf       → upload to the Hub
//   node scripts/publish-media-offsite.mjs --dry-run       → print, upload nothing
//
// With no credential for the selected host the script prints
// `(env skip: ...)` and exits 0 — the repo's convention for a step that
// needs a resource it does not have.
//
// After a successful upload the host is VERIFIED: one uploaded file is
// fetched (HEAD, falling back to GET) and must come back with an
// access-control-allow-origin header. The engine fetches the media from
// the engine's own origin, so a host without CORS would break the packs
// at runtime — that is a failure, not a warning.
//
// Exit codes: 0 ok (including env skip), 1 the upload or the CORS check
// failed.
// ---------------------------------------------------------------

import { readFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';

import {
  PACKS_DIR,
  listPackFiles,
  normalizeBase,
} from './lib/packs-offsite.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CONCURRENCY = 8;
const SAMPLE = 5;

// The content types the packs actually use. Anything unknown is served as
// an octet stream — the browser only needs a sane type for the audio and
// video elements.
const CONTENT_TYPES = {
  '.webp': 'image/webp',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mov': 'video/quicktime',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
  '.m4a': 'audio/mp4',
  '.json': 'application/json',
};

// ---- pure planning --------------------------------------------------------

// The Blob/Hub path of a pack file: the packs directory as a prefix, so
// the off-site host mirrors what the deploy used to serve.
export function blobPath(rel) {
  return `${PACKS_DIR}/${rel}`;
}

// The plan for an upload: what would be uploaded, to where. Pure — it
// touches neither the network nor the filesystem, so the unit gate can
// pin it down without a host.
export function planUpload(files, host) {
  const list = Array.isArray(files) ? files : [];
  const entries = list.map((f) => ({
    rel: f.rel,
    path: blobPath(f.rel),
    bytes: f.bytes,
  }));
  return {
    host,
    count: entries.length,
    bytes: entries.reduce((sum, e) => sum + e.bytes, 0),
    entries,
    sample: entries.slice(0, SAMPLE).map((e) => e.rel),
  };
}

// The operator-facing lines for a plan. Used by --dry-run.
export function describePlan(plan) {
  const lines = [];
  lines.push(`[packs] host    = ${plan.host}`);
  lines.push(`[packs] files   = ${plan.count}`);
  lines.push(`[packs] bytes   = ${plan.bytes}`);
  for (const rel of plan.sample) lines.push(`[packs]   ${blobPath(rel)}`);
  if (plan.count > plan.sample.length) {
    lines.push(`[packs]   … and ${plan.count - plan.sample.length} more`);
  }
  return lines;
}

// ---- hosts ---------------------------------------------------------------

// The repo's own Blob credentials are resolved from any
// <PREFIX>_READ_WRITE_TOKEN in the env (see api/_lib/db.js). Reuse the
// same shape so a deployment only has to set the one variable it already
// has.
export function blobToken(env = process.env) {
  const direct = env.BLOB_READ_WRITE_TOKEN;
  if (direct) return direct;
  for (const key of Object.keys(env)) {
    if (!/_read_write_token$/i.test(key)) continue;
    if (env[key]) return env[key];
  }
  return null;
}

export function hfCredentials(env = process.env) {
  const token = env.HF_TOKEN;
  const repo = env.HF_REPO;
  if (!token || !repo) return null;
  return { token, repo };
}

// The Hub's public path for a pack file.
export function hfBase(repo) {
  return `https://huggingface.co/datasets/${repo}/resolve/main/${PACKS_DIR}/`;
}

function contentTypeFor(rel) {
  const dot = rel.lastIndexOf('.');
  const ext = dot === -1 ? '' : rel.slice(dot).toLowerCase();
  return CONTENT_TYPES[ext] || 'application/octet-stream';
}

// The Blob base for a given public URL: the URL up to and including the
// packs/ prefix. The Blob CDN serves the packs directory from the same
// store, so the URL of any uploaded file reveals the base.
export function baseFromBlobUrl(url) {
  const raw = String(url || '');
  const marker = `/${PACKS_DIR}/`;
  let path = raw;
  try {
    const parsed = new URL(raw);
    path = parsed.pathname;
  } catch {
    // Not a URL — fall back to the raw string below.
  }
  if (!path.startsWith(marker)) return '';
  return normalizeBase(raw.slice(0, raw.indexOf(marker) + marker.length));
}

function isNotFound(err) {
  if (!err) return false;
  if (err.name === 'BlobNotFoundError') return true;
  if (err.statusCode === 404) return true;
  if (/does not exist/i.test(String(err.message || ''))) return true;
  return /not found/i.test(String(err.message || ''));
}

// ---- the Blob upload ------------------------------------------------------

async function blobUploadOne(file, token, stats) {
  const { put, head } = await import('@vercel/blob');
  const pathname = blobPath(file.rel);

  // A re-run must be cheap: if the file is already there, leave it alone.
  try {
    const existing = await head(pathname, { token });
    if (existing && existing.url) {
      stats.skipped++;
      return existing.url;
    }
  } catch (err) {
    if (!isNotFound(err)) throw err;
  }

  const data = readFileSync(join(ROOT, PACKS_DIR, file.rel));
  try {
    const result = await put(pathname, data, {
      access: 'public',
      addRandomSuffix: false,
      contentType: contentTypeFor(file.rel),
      token,
    });
    stats.uploaded++;
    return result.url;
  } catch (err) {
    // The path was taken between the head() and the put(): the file is
    // already there, which is exactly what this run wanted.
    if (!/already exists/i.test(String(err && err.message))) throw err;
    const existing = await head(pathname, { token });
    stats.skipped++;
    return existing.url;
  }
}

// ---- the Hub upload -------------------------------------------------------

function hfBinary() {
  const res = spawnSync('which', ['hf'], { encoding: 'utf8' });
  return res.status === 0 ? res.stdout.trim() : null;
}

function hfUpload(repo, token) {
  const bin = hfBinary();
  if (!bin) {
    process.stderr.write(
      '[packs] hf CLI not found — install it (https://huggingface.co/docs/huggingface_hub/guides/cli) ' +
      'to publish the media to the Hub\n'
    );
    return false;
  }
  const res = spawnSync(bin, ['upload', repo, PACKS_DIR, '--repo-type', 'dataset', '--path-in-repo', PACKS_DIR], {
    encoding: 'utf8',
    cwd: ROOT,
    env: { ...process.env, HF_TOKEN: token },
  });
  if (res.status !== 0) {
    process.stderr.write(`[packs] hf upload failed: ${(res.stderr || res.stdout || '').trim()}\n`);
    return false;
  }
  return true;
}

// ---- the CORS check -------------------------------------------------------

// The engine fetches the media from the engine's own origin, so the host
// must answer with access-control-allow-origin. HEAD first (cheap),
// GET as the fallback (some hosts refuse HEAD).
export async function verifyCors(url) {
  let res = null;
  try {
    res = await fetch(url, { method: 'HEAD' });
  } catch (err) {
    throw new Error(`the host could not be reached: ${err.message}`);
  }
  if (res.status >= 400 || res.status === 405) {
    res = await fetch(url);
  }
  const allow = res.headers.get('access-control-allow-origin');
  return { ok: res.ok, status: res.status, allow };
}

// ---- main -----------------------------------------------------------------

function parseArgs(argv) {
  const args = Array.isArray(argv) ? argv : [];
  let host = null;
  let dryRun = false;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--dry-run') dryRun = true;
    else if (arg === '--host') host = args[++i] || null;
    else if (arg.startsWith('--host=')) host = arg.slice('--host='.length);
  }
  if (host && host !== 'blob' && host !== 'hf') {
    process.stderr.write(`[packs] unknown host: ${host} — use blob or hf\n`);
    process.exit(1);
  }
  return { host, dryRun };
}

export async function main(argv = process.argv.slice(2)) {
  const { host, dryRun } = parseArgs(argv);

  const hasBlob = !!blobToken();
  const hf = hfCredentials();
  const selected = host || (hasBlob ? 'blob' : hf ? 'hf' : 'blob');

  let missing = '';
  if (selected === 'blob' && !hasBlob) {
    missing =
      'BLOB_READ_WRITE_TOKEN is not set — set it for Vercel Blob, ' +
      'or HF_TOKEN + HF_REPO for the Hugging Face Hub';
  } else if (selected === 'hf' && !hf) {
    missing = 'HF_TOKEN + HF_REPO are not set — the Hugging Face Hub needs both';
  }

  const files = listPackFiles(ROOT, PACKS_DIR);
  if (!files.length) {
    process.stderr.write(`[packs] ${PACKS_DIR}/ is missing or empty — nothing to publish\n`);
    return 1;
  }

  const plan = planUpload(files, selected);
  for (const line of describePlan(plan)) process.stdout.write(line + '\n');

  if (missing) {
    process.stdout.write(`(env skip: ${missing})\n`);
    if (dryRun) process.stdout.write('(dry run — nothing was uploaded)\n');
    return 0;
  }

  if (dryRun) {
    process.stdout.write('(dry run — nothing was uploaded)\n');
    return 0;
  }

  let base = '';
  let verifyUrl = '';

  if (selected === 'blob') {
    const token = blobToken();
    const stats = { uploaded: 0, skipped: 0 };
    let firstUrl = '';
    let cursor = 0;
    const workers = Array.from({ length: Math.min(CONCURRENCY, plan.count) }, async () => {
      while (cursor < plan.entries.length) {
        const entry = plan.entries[cursor++];
        const url = await blobUploadOne(
          { rel: entry.rel, bytes: entry.bytes },
          token,
          stats
        );
        if (!firstUrl) firstUrl = url;
      }
    });
    await Promise.all(workers);
    process.stdout.write(
      `[packs] blob  uploaded ${stats.uploaded}, skipped ${stats.skipped} — ${plan.count} file(s)\n`
    );
    base = baseFromBlobUrl(firstUrl);
    verifyUrl = firstUrl;
  } else {
    const ok = hfUpload(hf.repo, hf.token);
    if (!ok) return 1;
    process.stdout.write(`[packs] hub   uploaded ${plan.count} file(s) to ${hf.repo}\n`);
    base = normalizeBase(hfBase(hf.repo));
    verifyUrl = `${base}${plan.entries.length ? plan.entries[0].rel : ''}`;
  }

  if (!base) {
    process.stderr.write('[packs] could not work out the off-site base URL\n');
    return 1;
  }

  // The CORS check: a host that does not serve the media cross-origin
  // breaks the packs in the browser.
  let cors = { ok: false, status: 0, allow: null };
  try {
    cors = await verifyCors(verifyUrl);
  } catch (err) {
    process.stderr.write(`[packs] CORS check failed: ${err.message}\n`);
    return 1;
  }
  if (!cors.allow) {
    process.stderr.write(
      '[packs] WARNING: the host does not send access-control-allow-origin ' +
      `(HTTP ${cors.status}) — the browser cannot load the packs from the engine's origin\n`
    );
    process.stderr.write(`[packs] PACKS_BASE=${base}\n`);
    return 1;
  }
  process.stdout.write(`[packs] cors  access-control-allow-origin: ${cors.allow}\n`);
  process.stdout.write(`[packs] base  ${base}\n`);
  process.stdout.write(`PACKS_BASE=${base}\n`);
  return 0;
}

// Only run as a CLI — the unit gate imports the planning functions.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().then(code => {
    if (code) process.exit(code);
  }).catch(err => {
    process.stderr.write(`[packs] ${err.message}\n`);
    process.exit(1);
  });
}
