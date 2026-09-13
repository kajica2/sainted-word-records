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
//   ensureDist(): synchronously checks for dist/index.html. If
//     missing, runs `npm run build` (which fires prebuild →
//     scripts/fetch-library.mjs → vite build) and waits for it to
//     finish. Skips if dist/ already exists (cheap stat, no rebuild).
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
// Performance: skip path is ~1ms (one fs.statSync). Build path takes
// 2-5s depending on the project — happens at most once per checkout.

import { execFileSync } from 'node:child_process';
import { existsSync, statSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
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

export function ensureDist(opts) {
  if (hasDist()) return false;  // already built — nothing to do
  console.log('[with-dist] dist/ missing — running npm run build…');
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