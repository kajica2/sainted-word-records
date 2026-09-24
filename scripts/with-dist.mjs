#!/usr/bin/env node
// scripts/with-dist.mjs
//
// Shared helper for smoke scripts that need a built dist/ to serve.
//
// Why: PR #8 and PR #9 hit the "forgot to npm run build" foot-gun
// repeatedly — smoke scripts that serve dist/ return 404s if dist/
// hasn't been built. Forcing every contributor to remember the
// `npm run build` pre-step is a friction point.
//
// Behaviour:
//   ensureDist(): cheap source-vs-dist freshness check, then
//     `npm run build` (which fires prebuild → scripts/fetch-library.mjs →
//     vite build) when dist is MISSING **or STALE**. Skips the build when
//     dist is already current (~1ms of fs.stats).
//
// Why staleness matters: the original check only looked for dist's
// existence. A dist built before the latest source change would be served
// silently, so smokes tested OLD code — which is how a capture-smoke came to
// hang on a dist that predated the frame-end hook, and why a whole
// verification round was spent diagnosing the wrong layer. Comparing mtimes
// is the cheap fix.
//
// Usage:
//   import { ensureDist } from './with-dist.mjs';
//   await ensureDist();
//   ...start your static server on dist/...
//
// Why not just run `vite build` directly: this preserves the
// prebuild hook (library fetch on Vercel) and the exact same build
// pipeline the production deploy uses. No drift.
//
// Performance: skip path is ~1ms (one directory walk of the source set).
// Build path takes 2-5s depending on the project — happens at most once
// per source change.

import { execFileSync } from 'node:child_process';
import { existsSync, statSync, readdirSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
// Vite's entry is engine.html (see vite.config.js rollupOptions.input),
// so the canonical "did the build succeed" marker is dist/engine.html
// rather than the default dist/index.html.
const DIST_ENTRY = resolve(ROOT, 'dist', 'engine.html');

export function hasDist() {
  try {
    return existsSync(DIST_ENTRY) && statSync(DIST_ENTRY).size > 0;
  } catch (_) {
    return false;
  }
}

// Source roots the build consumes. Kept deliberately narrow: directories the
// copy-static table actually reads, plus the root-level scripts a page loads.
const SOURCE_DIRS = ['lib', 'client', 'versions', 'packs', 'default-library', 'audios'];
const SOURCE_FILES = [
  'engine.html', 'fx-postprocess.js', 'versions-presets.js', 'video-fx.css',
  'engine-render.client.js', 'engine-timing.client.js', 'engine-keys.client.js',
  'layer-scheduler.client.js', 'layer-scheduler.worker.js', 'audio-analysis-v2.js',
  'pwa-bootstrap.js', 'sw.js', 'manifest.webmanifest', 'vite.config.js',
];

// Newest mtime under SOURCE_DIRS/SOURCE_FILES, or 0 when nothing readable.
// Directory walk is bounded (files only, no symlink chasing) and skips
// node_modules/dist by construction — SOURCE_DIRS never contains them.
function newestSourceMtime() {
  let newest = 0;
  const consider = (p) => {
    try {
      const st = statSync(p);
      if (st.isFile() && st.mtimeMs > newest) newest = st.mtimeMs;
      return st;
    } catch (_) { return null; }
  };
  for (const f of SOURCE_FILES) consider(join(ROOT, f));
  const walk = (dir, depth) => {
    if (depth > 3) return;
    let entries;
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch (_) { return; }
    for (const e of entries) {
      const p = join(dir, e.name);
      if (e.isDirectory()) walk(p, depth + 1);
      else if (e.isFile()) consider(p);
    }
  };
  for (const d of SOURCE_DIRS) walk(join(ROOT, d), 0);
  return newest;
}

/**
 * Is dist behind the source tree?
 * true  → a rebuild is warranted
 * false → dist is current (or the check itself is inconclusive; we prefer
 *         NOT rebuilding on error so a permissions quirk can't wedge CI)
 */
export function distIsStale() {
  if (!hasDist()) return true;
  try {
    const distM = statSync(DIST_ENTRY).mtimeMs;
    const srcM = newestSourceMtime();
    return srcM > distM;
  } catch (_) {
    return false;
  }
}

export function ensureDist(opts) {
  if (!distIsStale()) return false;  // current — nothing to do
  const why = hasDist() ? 'dist/ is older than the source tree' : 'dist/ missing';
  console.log(`[with-dist] ${why} — running npm run build…`);
  // Allow tests / wrappers to inject extra env (e.g. PATH pointing at
  // a fake npm binary). Production callers don't pass opts and get
  // the default behaviour.
  const env = opts && opts.env ? Object.assign({}, process.env, opts.env) : process.env;
  // Hand the cwd to the spawned process via an env var so wrappers
  // (notably tests with a fake `npm` binary) can locate it. The cwd
  // option to execFileSync still does its job; SWD_DIST_CWD is just
  // for visibility / external scripts.
  env.SWD_DIST_CWD = ROOT;
  execFileSync('npm', ['run', 'build'], {
    cwd: ROOT,
    stdio: 'inherit',  // surface the build output
    env: env,
  });
  if (!hasDist()) {
    throw new Error('[with-dist] npm run build completed but dist/engine.html is still missing — check build output above');
  }
  console.log('[with-dist] dist/ ready.');
  return true;  // we built it
}

// Convenience: serve a dist/ path on a given port. Returns a `close()`
// function. Uses the same minimal HTTP server pattern the smoke
// scripts already use, so they can drop the duplicated boilerplate.
//
// Usage:
//   const { close } = await serveDist(5180);
//   ...puppeteer runs against http://localhost:5180/...
//   await close();
export async function serveDist(port) {
  const http = await import('node:http');
  const fs = await import('node:fs');
  const path = await import('node:path');

  ensureDist();  // no-op if already built

  const MIME = {
    '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript',
    '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml',
    '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
    '.gif': 'image/gif', '.wav': 'audio/wav', '.mp3': 'audio/mpeg',
    '.mp4': 'video/mp4', '.webm': 'video/webm',
  };
  const server = http.createServer((req, res) => {
    let rel = decodeURIComponent(req.url.split('?')[0].replace(/^\/+/, '')) || 'index.html';
    if (rel === 'app' || rel === 'app/') rel = 'swr-app.html';
    const full = path.join(ROOT, 'dist', rel);
    if (!full.startsWith(path.join(ROOT, 'dist'))) { res.writeHead(403); return res.end('forbidden'); }
    fs.readFile(full, (err, buf) => {
      if (err) { res.writeHead(404); return res.end('not found'); }
      const ext = path.extname(full).toLowerCase();
      res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
      res.end(buf);
    });
  });
  await new Promise(r => server.listen(port, r));
  return {
    url: 'http://localhost:' + port,
    close: () => new Promise(r => server.close(r)),
  };
}