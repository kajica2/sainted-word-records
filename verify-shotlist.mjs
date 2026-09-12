#!/usr/bin/env node
// verify-shotlist.mjs — smoke test for the director's shot list page.
//
//   node verify-shotlist.mjs
//
// Boots a local static server, fetches /shotlist/index.html, and asserts:
//   1. Page returns 200
//   2. There is a 5-slot timeline
//   3. There are at least 50 candidate tiles
//   4. Sessions are grouped by camera move + style
//   5. The drag/drop wiring + localStorage + copy/download buttons are present

import { readFileSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = 5193;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css':  'text/css; charset=utf-8',
  '.js':   'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg':  'image/svg+xml',
  '.png':  'image/png',
  '.mp3':  'audio/mpeg',
  '.wav':  'audio/wav',
  '.ico':  'image/x-icon',
};

function startServer() {
  return new Promise((resolveServer) => {
    const server = createServer((req, res) => {
      let p = req.url.split('?')[0];
      if (p === '/') p = '/shotlist/index.html';
      const tryPaths = [
        join(__dirname, p),
        join(__dirname, p + '.html'),
        join(__dirname, p, 'index.html'),
      ];
      for (const fp of tryPaths) {
        try {
          const s = statSync(fp);
          if (s.isFile()) {
            res.writeHead(200, { 'content-type': MIME[extname(fp)] || 'application/octet-stream' });
            res.end(readFileSync(fp));
            return;
          }
        } catch (_) { /* fallthrough */ }
      }
      res.writeHead(404, { 'content-type': 'text/plain' });
      res.end('not found: ' + p);
    });
    server.listen(PORT, () => resolveServer(server));
  });
}

async function fetchText(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url} -> ${r.status}`);
  return r.text();
}

function step(name, fn) {
  return fn().then(
    () => console.log(`  ✓ ${name}`),
    (e) => { console.error(`  ✗ ${name}: ${e.message}`); process.exitCode = 1; throw e; }
  );
}

async function main() {
  const server = await startServer();
  try {
    console.log('verify-shotlist: director shot list');
    await step('index /shotlist/index.html renders', async () => {
      const html = await fetchText(`http://localhost:${PORT}/shotlist/index.html`);
      if (!html.includes("Director's shot list")) throw new Error('title copy missing');

      const slots = (html.match(/data-slot="/g) || []).length;
      if (slots !== 5) throw new Error(`expected 5 timeline slots, got ${slots}`);

      const tiles = (html.match(/class="tile"/g) || []).length;
      if (tiles < 50) throw new Error(`expected 50+ tiles, got ${tiles}`);

      const sessions = (html.match(/class="session"/g) || []).length;
      if (sessions < 10) throw new Error(`expected 10+ sessions, got ${sessions}`);

      if (!html.includes('application/x-shot')) throw new Error('no drag data type');
      if (!html.includes("'swrc.shotlist'")) throw new Error('no localStorage key');
      if (!html.includes('exportText')) throw new Error('no copy-text button');
      if (!html.includes('exportJson')) throw new Error('no download-json button');

      // Style breakdown — at least one session of each style
      if (!html.includes('data-style="vintage_texture"')) throw new Error('no vintage_texture sessions');
      if (!html.includes('data-style="hologram_wireframe"')) throw new Error('no hologram_wireframe sessions');
    });

    // Spot-check: a sample candidate image is reachable
    await step('sample candidate image serves 200', async () => {
      // Read the index, pick the first <img src="_candidates_web/..."> URL.
      const html = await fetchText(`http://localhost:${PORT}/shotlist/index.html`);
      const m = /src="(_candidates_web\/[^"]+)"/.exec(html);
      if (!m) throw new Error('no candidate <img> in HTML');
      const r = await fetch(`http://localhost:${PORT}/shotlist/${m[1]}`);
      if (!r.ok) throw new Error(`sample image returned ${r.status}`);
      const ct = r.headers.get('content-type') || '';
      if (!ct.startsWith('image/')) throw new Error(`unexpected content-type: ${ct}`);
    });

    console.log(process.exitCode ? '\nFAIL' : '\nALL GREEN');
  } finally {
    server.close();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
