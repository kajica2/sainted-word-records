#!/usr/bin/env node
// verify-persona-v.mjs — smoke test for the visual-persona demo pages.
//
//   node verify-persona-v.mjs
//
// Boots a local static server, hits /personas/v/index.html, then visits every
// /personas/v/<key>.html and asserts:
//   1. The page returns 200
//   2. <h1> contains the persona label
//   3. The tagline element contains the persona desc
//   4. There are exactly 15 gauge rows (one per FX uniform)
//   5. The persona's expected value for one canonical uniform (chroma for
//      hallucination) appears in the page text

import { readFileSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = __dirname;
const PORT = 5185;
const PERSONAS = JSON.parse(readFileSync(resolve(ROOT, 'personas_extracted.json'), 'utf8'));
const ORDER = [
  'raw','poster','mask','fx','filter',
  'neon','filmfilm','grid','smoke','hallucination',
  'liquidglass','pearlhaze','clubstrobe','vhsvibe','neonwash',
  'morphaanchor','morphaflow','morphafracture','morphavoid','morphaecho',
  'trainstage1','trainstage2','trainstage3',
];

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css':  'text/css; charset=utf-8',
  '.js':   'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg':  'image/svg+xml',
  '.png':  'image/png',
  '.ico':  'image/x-icon',
};

function startServer() {
  return new Promise((resolveServer) => {
    const server = createServer((req, res) => {
      let p = req.url.split('?')[0];
      if (p === '/') p = '/personas/v/index.html';
      // SPA-style: try the file as-is, then with .html, then 404
      const tryPaths = [join(ROOT, p), join(ROOT, p + '.html')];
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
    console.log('verify-persona-v: visual persona demo pages');
    await step('index /personas/v/index.html lists 23 cards', async () => {
      const html = await fetchText(`http://localhost:${PORT}/personas/v/index.html`);
      const cards = (html.match(/href="\/personas\/v\/[a-z0-9]+"/g) || []).length;
      if (cards < 23) throw new Error(`expected 23 cards, found ${cards}`);
    });

    for (const key of ORDER) {
      const p = PERSONAS[key];
      if (!p) { console.warn(`  ! skipping ${key} (no data)`); continue; }
      await step(`${key} page renders`, async () => {
        const html = await fetchText(`http://localhost:${PORT}/personas/v/${key}.html`);
        if (!html.includes(`<h1>${p.label}`)) throw new Error(`h1 not "${p.label}"`);
        if (!html.includes(p.desc.slice(0, 40))) throw new Error('tagline missing');
        const gaugeCount = (html.match(/gauge-row/g) || []).length;
        if (gaugeCount !== 15) throw new Error(`expected 15 gauges, got ${gaugeCount}`);
        // Canonical check: chroma for hallucination should be 1.00
        if (key === 'hallucination' && !html.includes('1.00')) throw new Error('chroma 1.00 missing');
        if (key === 'raw' && !html.includes('RAW')) throw new Error('RAW label missing');
      });
    }
    console.log(process.exitCode ? '\nFAIL' : '\nALL GREEN');
  } finally {
    server.close();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
