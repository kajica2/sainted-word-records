#!/usr/bin/env node
// verify-artists.mjs — smoke test for the artist showcase pages.
//
//   node verify-artists.mjs
//
// Boots a local static server, hits /artists/index.html, then visits every
// /artists/<id>.html and asserts:
//   1. The page returns 200
//   2. <h1> contains the artist name
//   3. The bio is rendered
//   4. There is a <audio loop> element with the right track src
//   5. The play-gate button is present
//   6. The number of work tiles matches artists.json

import { readFileSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = 5188;
const artists = JSON.parse(readFileSync(join(__dirname, 'artists.json'), 'utf8'));

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
      if (p === '/') p = '/artists/index.html';
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
    console.log('verify-artists: artist showcase pages');
    await step('index /artists/index.html lists all cards', async () => {
      const html = await fetchText(`http://localhost:${PORT}/artists/index.html`);
      for (const a of artists) {
        if (!html.includes(a.name)) throw new Error(`name missing: ${a.name}`);
        if (!html.includes(`/artists/${a.id}`)) throw new Error(`link missing: ${a.id}`);
      }
    });

    for (const a of artists) {
      await step(`${a.id} page renders`, async () => {
        const html = await fetchText(`http://localhost:${PORT}/artists/${a.id}.html`);
        if (!html.includes(`<h1>${a.name}`)) throw new Error(`h1 not "${a.name}"`);
        if (!html.includes(a.bio.slice(0, 40))) throw new Error('bio missing');
        if (!html.includes(`<audio`)) throw new Error('no <audio> element');
        if (!html.includes(`loop`)) throw new Error('audio not looped');
        if (!html.includes(a.track)) throw new Error(`track src ${a.track} missing`);
        if (!html.includes(`id="playGate"`)) throw new Error('no play-gate');
        const workCount = (html.match(/class="work( |")/g) || []).length;
        const expected = a.works ? a.works.length : 0;
        if (workCount !== expected) throw new Error(`expected ${expected} work tiles, got ${workCount}`);
      });
    }

    // Vodolija-specific: the logo-candidates showcase page is the user's
    // review surface, not a per-artist page. Verify it exists and shows
    // the candidates with lightbox wiring.
    if (artists.find(a => a.id === 'vodolija')) {
      await step('vodolija logo-candidates showcase renders', async () => {
        // The static-server try-path joins <p>/index.html. So we strip
        // the .html suffix and let the fallback resolve the index.
        const html = await fetchText(`http://localhost:${PORT}/artists/vodolija/index.html`);
        if (!html.includes('candidates across')) throw new Error('no "candidates across" intro copy');
        const tiles = (html.match(/class="tile"/g) || []).length;
        if (tiles < 28) throw new Error(`expected 28+ tiles, got ${tiles}`);
        const sessions = (html.match(/class="session"/g) || []).length;
        if (sessions < 5) throw new Error(`expected 5+ session blocks, got ${sessions}`);
        if (!html.includes('id="lightbox"')) throw new Error('no lightbox');
        if (!html.includes('navigator.clipboard.writeText')) throw new Error('no copy-button wiring');
      });
    }
    console.log(process.exitCode ? '\nFAIL' : '\nALL GREEN');
  } finally {
    server.close();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
