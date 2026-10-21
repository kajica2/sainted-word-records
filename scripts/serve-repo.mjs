#!/usr/bin/env node
// scripts/serve-repo.mjs
//
// Serves the repository as a static site, with the same HTML transforms
// the build applies, so a page behaves locally the way it does deployed.
//
//   npm run serve:local            → http://127.0.0.1:8099
//   npm run serve:local -- --port=3000
//
// It mirrors three of vite.config.js's HTML plugins:
//
//   strip-absolute-module-scripts  absolute <script type="module"> becomes
//                                  a plain deferred script
//   engine-layout-inject          the shared layout stylesheet and
//                                  controller, for pages that import
//                                  engine-genops
//   audio-damp-inject             lib/audio-damp.client.js, same anchor
//
// It does NOT run the real build: there is no bundling, no minification,
// and the per-variant automix config is not inlined. Everything else is
// the source you have, served as-is.
//
// Why this exists: `npm run dev` needs the dev dependencies installed,
// and the repository is often worked on without them. This gives a
// faithful-enough local site with nothing but Node.

import { createServer } from 'node:http';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');

const argv = process.argv.slice(2);
const arg = (name, fallback) => {
  const hit = argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
};
const PORT = Number(arg('port', process.env.PORT || 8099));
const HOST = arg('host', '127.0.0.1');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/plain; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.avif': 'image/avif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.m4a': 'audio/mp4',
  '.ogg': 'audio/ogg',
  '.flac': 'audio/flac',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mov': 'video/quicktime',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.wasm': 'application/wasm',
  '.map': 'application/json',
};

// The three HTML transforms, ported from vite.config.js.
function transformHtml(html) {
  // strip-absolute-module-scripts
  html = html.replace(
    /<script\s+type="module"\s+src="\/([^"]+)"\s*><\/script>/g,
    '<script src="/$1" defer></script>'
  );

  // engine-layout-inject + audio-damp-inject
  if (/engine-genops\.client\.js/.test(html)) {
    if (!/engine-layout\.client\.js/.test(html)) {
      html = html
        .replace(
          /(<link rel="stylesheet" href="\.\.\/engine-genops\.css" \/>)/,
          '$1\n  <link rel="stylesheet" href="../engine-layout.css" />'
        )
        .replace(
          /(<script src="\.\.\/engine-genops\.client\.js"><\/script>)/,
          '$1\n<script src="../engine-layout.client.js"></script>'
        );
    }
    if (!/audio-damp\.client\.js/.test(html)) {
      html = html.replace(
        /(<script src="\.\.\/engine-genops\.client\.js"><\/script>)/,
        '$1\n<script src="../lib/audio-damp.client.js"></script>'
      );
    }
  }
  return html;
}

const server = createServer(async (req, res) => {
  try {
    let pathname = decodeURIComponent((req.url || '/').split('?')[0]);
    if (pathname.endsWith('/')) pathname += 'index.html';

    // Keep the path inside the repository.
    const filePath = join(ROOT, normalize(pathname).replace(/^(\.\.[/\\])+/, ''));
    if (!filePath.startsWith(ROOT + sep) && filePath !== ROOT) {
      res.writeHead(403).end('forbidden');
      return;
    }

    const info = await stat(filePath).catch(() => null);
    if (!info || !info.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain' }).end('not found: ' + pathname);
      return;
    }

    const ext = extname(filePath).toLowerCase();
    if (ext === '.html') {
      const { readFile } = await import('node:fs/promises');
      const html = transformHtml(await readFile(filePath, 'utf8'));
      res.writeHead(200, {
        'Content-Type': MIME['.html'],
        'Cache-Control': 'no-store',
      });
      res.end(html);
      return;
    }

    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Content-Length': info.size,
      'Cache-Control': 'no-store',
    });
    createReadStream(filePath).pipe(res);
  } catch (err) {
    res.writeHead(500, { 'Content-Type': 'text/plain' }).end(String(err));
  }
});

server.listen(PORT, HOST, () => {
  console.log('SWR local server — ' + ROOT);
  console.log('  http://' + HOST + ':' + PORT + '/');
  console.log('  http://' + HOST + ':' + PORT + '/engine.html');
  console.log('  http://' + HOST + ':' + PORT + '/versions/neon.html');
});
