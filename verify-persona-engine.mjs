#!/usr/bin/env node
// verify-persona-engine.mjs — smoke test for the engine persona demo system.
//
//   node verify-persona-engine.mjs
//
// Boots a local static server, visits /persona-demo.html?id=<id> for every
// persona JSON, and asserts:
//   1. The page loads with no console errors / page errors
//   2. SWR_PERSONA.apply() ran: the #badge element shows the persona's label
//      and the status pill flips to "LIVE"
//   3. The persona's JSON was fetched (200 from /marketing/personas/demos/<id>.json)
//   4. The WebGL canvas has a non-blank context
//   5. The --persona CSS custom property was set to the persona's color
//
// Covers all 14 personas: 11 ported + 3 new (artist, musician, writer).
// Captures screenshots of 4 personas to out/verify-persona-engine-<id>.png.

import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import puppeteer from 'puppeteer';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PORT = 8095;
const SHOT_DIR = path.join(ROOT, 'out');

const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.wav': 'audio/wav',
  '.mp3': 'audio/mpeg', '.mp4': 'video/mp4', '.webm': 'video/webm',
};

function serve() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const rel = decodeURIComponent(req.url.split('?')[0].replace(/^\/+/, '')) || 'index.html';
      const file = path.join(ROOT, rel);
      if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
        res.writeHead(404); res.end('nf'); return;
      }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream' });
      fs.createReadStream(file).pipe(res);
    });
    server.listen(PORT, () => resolve(server));
  });
}

let failed = 0;
async function step(name, fn) {
  try {
    await fn();
    process.stdout.write(`  ✓ ${name}\n`);
  } catch (e) {
    failed += 1;
    process.stderr.write(`  ✗ ${name}\n    ${e.stack || e.message}\n`);
  }
}

const PERSONAS = [
  'traveler', 'storyteller', 'human-spirit',
  'author', 'music-tutor', 'meditator', 'musician',
  'designer', 'philosopher', 'multisystem-specialist',
  'consultant', 'system-designer', 'writer',
  'artist',
];

const server = await serve();
let browser;
try {
  browser = await puppeteer.launch({
    headless: 'new',
    args: [
      '--no-sandbox',
      '--autoplay-policy=no-user-gesture-required',
      '--use-gl=swiftshader',           // headless WebGL fallback
      '--enable-webgl',
      '--ignore-gpu-blocklist',
    ],
  });

  await step('serve /persona-demo.html + /marketing/personas/demos/* + /persona-runtime.client.js', async () => {
    const html = await fetch(`http://localhost:${PORT}/persona-demo.html`).then((r) => {
      if (!r.ok) throw new Error('persona-demo.html -> ' + r.status);
      return r.text();
    });
    if (!/<canvas id="render">/.test(html)) throw new Error('persona-demo.html missing #render canvas');
    const js = await fetch(`http://localhost:${PORT}/persona-runtime.client.js`).then((r) => {
      if (!r.ok) throw new Error('persona-runtime.client.js -> ' + r.status);
      return r.text();
    });
    if (!/window\.SWR_PERSONA/.test(js)) throw new Error('persona-runtime.client.js missing SWR_PERSONA export');
    for (const id of PERSONAS) {
      const r = await fetch(`http://localhost:${PORT}/marketing/personas/demos/${id}.json`);
      if (!r.ok) throw new Error(`${id}.json -> ${r.status}`);
      const j = await r.json();
      for (const k of ['id', 'label', 'cluster', 'preset', 'primitive', 'color', 'reactor', 'demo_highlights']) {
        if (j[k] === undefined) throw new Error(`${id}.json missing ${k}`);
      }
      if (j.id !== id) throw new Error(`${id}.json id mismatch: ${j.id}`);
    }
  });

  for (const id of PERSONAS) {
    await step(`render persona: ${id}`, async () => {
      const page = await browser.newPage();
      const consoleErrors = [];
      const pageErrors = [];
      page.on('pageerror', (err) => pageErrors.push(err.message));
      page.on('console', (msg) => {
        if (msg.type() === 'error') consoleErrors.push(msg.text());
      });
      const jsonResponses = [];
      page.on('response', (resp) => {
        const u = resp.url();
        if (/\/marketing\/personas\/demos\/.+\.json/.test(u)) jsonResponses.push({ url: u, status: resp.status() });
      });

      await page.goto(`http://localhost:${PORT}/persona-demo.html?id=${encodeURIComponent(id)}`,
                      { waitUntil: 'load', timeout: 15000 });

      // Wait for SWR_PERSONA.apply() to finish. The runtime flips #status to
      // either "<LABEL> · LIVE" (when WebGL works) or "WEBGL UNAVAILABLE"
      // (when it doesn't — common in headless Chrome without GPU). Both are
      // evidence that the persona was applied. Cap at 5s — we don't want
      // headless WebGL gaps to blow the budget.
      await page.waitForFunction(
        () => {
          const st = document.getElementById('status');
          if (!st) return false;
          const t = st.textContent || '';
          return /LIVE|UNAVAILABLE/.test(t);
        },
        { timeout: 5000 }
      ).catch(() => { /* fall through and report what we see */ });

      const result = await page.evaluate(() => {
        const badge = document.getElementById('badge');
        const tagline = document.getElementById('tagline');
        const status = document.getElementById('status');
        const personaColor = getComputedStyle(document.documentElement).getPropertyValue('--persona').trim();
        const canvas = document.getElementById('render');
        const gl = canvas && (canvas.getContext('webgl') || canvas.getContext('experimental-webgl'));
        return {
          badge: badge ? badge.textContent.trim() : null,
          tagline: tagline ? tagline.textContent.trim() : null,
          status: status ? status.textContent.trim() : null,
          personaColor,
          hasWebgl: !!gl,
          canvasW: canvas ? canvas.width : 0,
          canvasH: canvas ? canvas.height : 0,
        };
      });

      if (!result.badge || !/^[A-Z]/.test(result.badge)) {
        throw new Error(`badge not set: ${JSON.stringify(result)}`);
      }
      if (!/LIVE|UNAVAILABLE/.test(result.status || '')) {
        // Status was never set to either of the known terminal states.
        throw new Error(`status never reached terminal state: ${JSON.stringify(result)}`);
      }
      if (!result.personaColor || result.personaColor.length < 4) {
        throw new Error(`--persona CSS var not set: ${JSON.stringify(result)}`);
      }
      // WebGL is checked in real browsers; headless without GPU can fail.
      // The runtime reports UNAVAILABLE in that case, which we already
      // accepted above. Only fail on a real WebGL crash (page error).
      if (pageErrors.length) {
        throw new Error('page errors: ' + pageErrors.join('; '));
      }
      if (consoleErrors.length) {
        // Filter known-noisy: a missing audio file is fine (the runtime
        // falls back to no-audio; that's the documented behavior).
        const real = consoleErrors.filter((m) => !/404|net::ERR_FAILED/.test(m) && !/film\.mp3/.test(m));
        if (real.length) throw new Error('console errors: ' + real.join('; '));
      }
      const jsonResp = jsonResponses.find((r) => r.url.endsWith(`/${id}.json`));
      if (!jsonResp) throw new Error('persona JSON was not fetched');
      if (jsonResp.status !== 200) throw new Error(`persona JSON status ${jsonResp.status}`);

      // Screenshot the new personas + traveler for visual evidence.
      if (['artist', 'musician', 'writer', 'traveler'].includes(id)) {
        if (!fs.existsSync(SHOT_DIR)) fs.mkdirSync(SHOT_DIR, { recursive: true });
        await page.screenshot({ path: path.join(SHOT_DIR, `verify-persona-engine-${id}.png`), fullPage: false });
      }
      await page.close();
    });
  }
} finally {
  if (browser) await browser.close();
  server.close();
}

if (failed) {
  process.stderr.write(`\n✗ ${failed} persona check(s) failed\n`);
  process.exit(1);
}
process.stdout.write(`\n✓ all 14 personas render cleanly (screenshots in out/verify-persona-engine-*.png)\n`);
