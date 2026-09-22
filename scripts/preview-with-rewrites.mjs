#!/usr/bin/env node
// Tiny static server for dist/ that applies vercel.json rewrites,
// so local preview URLs match what Vercel serves in production.
// Usage: node scripts/preview-with-rewrites.mjs [port]

import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const root = resolve(__dirname, '..', 'dist');
const port = Number(process.argv[2] || process.env.PORT || 4173);

const vercel = JSON.parse(
  await readFile(resolve(__dirname, '..', 'vercel.json'), 'utf8'),
);
const rewrites = (vercel.rewrites || []).map((r) => ({
  src: r.source,
  dest: r.destination,
  re: compile(r.source),
}));

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
};

function compile(pattern) {
  // Convert :param to ([^/]+) and escape other regex chars
  const escaped = pattern
    .replace(/[.+*?^$(){}|[\]\\]/g, '\\$&')
    .replace(/:([A-Za-z_][A-Za-z0-9_]*)/g, '(?<$1>[^/]+)')
    .replace(/\*/g, '.*');
  return new RegExp('^' + escaped + '$');
}

function resolveRewrite(urlPath) {
  for (const r of rewrites) {
    const m = urlPath.match(r.re);
    if (!m) continue;
    let dest = r.dest;
    for (const k of Object.keys(m.groups || {})) {
      dest = dest.replaceAll(':' + k, m.groups[k]);
    }
    return dest;
  }
  return null;
}

function safeJoin(base, rel) {
  const joined = normalize(join(base, rel));
  if (!joined.startsWith(base + sep) && joined !== base) return null;
  return joined;
}

async function tryFile(p) {
  try {
    const s = await stat(p);
    if (s.isFile()) return p;
    if (s.isDirectory()) {
      const idx = join(p, 'index.html');
      try {
        const s2 = await stat(idx);
        if (s2.isFile()) return idx;
      } catch {}
    }
  } catch {}
  return null;
}

async function resolvePath(urlPath) {
  // Strip query
  const cleanPath = urlPath.split('?')[0].split('#')[0];
  if (cleanPath.includes('..')) return null;

  // 1. Direct file in dist/
  let candidate = safeJoin(root, cleanPath);
  if (candidate) {
    const f = await tryFile(candidate);
    if (f) return f;
  }

  // 2. Apply rewrites
  const dest = resolveRewrite(cleanPath);
  if (dest) {
    candidate = safeJoin(root, dest);
    if (candidate) {
      const f = await tryFile(candidate);
      if (f) return f;
    }
  }

  // 3. .html fallback for cleanUrls:false paths like /about → /about.html
  candidate = safeJoin(root, cleanPath + '.html');
  if (candidate) {
    const f = await tryFile(candidate);
    if (f) return f;
  }

  return null;
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    const filePath = await resolvePath(url.pathname);
    if (!filePath) {
      // 404 fallback
      const fallback = safeJoin(root, '404.html');
      const body = fallback ? await readFile(fallback) : Buffer.from('Not found');
      res.writeHead(404, { 'content-type': 'text/html; charset=utf-8' });
      res.end(body);
      return;
    }
    const body = await readFile(filePath);
    const type = MIME[extname(filePath).toLowerCase()] || 'application/octet-stream';
    const headers = { 'content-type': type, 'content-length': body.length };
    if (type.startsWith('text/') || type === 'application/javascript' || type === 'application/json') {
      headers['cache-control'] = 'no-cache';
    }
    res.writeHead(200, headers);
    res.end(body);
  } catch (err) {
    res.writeHead(500, { 'content-type': 'text/plain' });
    res.end('Server error: ' + err.message);
  }
});

server.listen(port, '0.0.0.0', () => {
  console.log(`preview-with-rewrites: serving dist/ at http://localhost:${port}/`);
  console.log(`  rewrites applied: ${rewrites.length} (from vercel.json)`);
});

// Graceful shutdown
for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    console.log(`\npreview-with-rewrites: received ${sig}, shutting down`);
    server.close(() => process.exit(0));
  });
}