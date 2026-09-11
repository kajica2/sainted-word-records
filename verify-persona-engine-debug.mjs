#!/usr/bin/env node
// Minimal debug: just one persona, no screenshots, fast timeout.
import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import puppeteer from 'puppeteer';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PORT = 8096;
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.mp3': 'audio/mpeg' };

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

const server = await serve();
const browser = await puppeteer.launch({
  headless: 'new',
  args: ['--no-sandbox', '--use-gl=swiftshader', '--enable-webgl', '--autoplay-policy=no-user-gesture-required'],
});

try {
  const page = await browser.newPage();
  const errs = [];
  const logs = [];
  page.on('pageerror', (e) => errs.push('PE: ' + e.message));
  page.on('console', (m) => logs.push(`${m.type()}: ${m.text()}`));
  page.on('requestfailed', (r) => errs.push('RF: ' + r.url() + ' ' + r.failure()?.errorText));

  const t0 = Date.now();
  console.log(`[${Date.now()-t0}ms] goto...`);
  await page.goto(`http://localhost:${PORT}/persona-demo.html?id=artist`, { waitUntil: 'load', timeout: 10000 });
  console.log(`[${Date.now()-t0}ms] loaded`);

  // Give the runtime a moment to apply
  await new Promise((r) => setTimeout(r, 1500));
  console.log(`[${Date.now()-t0}ms] after 1.5s wait`);

  const result = await page.evaluate(() => {
    return {
      badge: document.getElementById('badge')?.textContent,
      status: document.getElementById('status')?.textContent,
      personaColor: getComputedStyle(document.documentElement).getPropertyValue('--persona').trim(),
      hasGL: !!document.getElementById('render')?.getContext('webgl'),
      swrPersona: typeof window.SWR_PERSONA,
    };
  });
  console.log('RESULT:', JSON.stringify(result, null, 2));
  console.log('LOGS:', logs.slice(0, 20).join('\n'));
  console.log('ERRS:', errs.join('\n'));
  await page.close();
} finally {
  await browser.close();
  server.close();
}
