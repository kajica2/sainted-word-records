// verify-engine-boot.mjs — the gate that was missing.
//
// Why this exists: the console-engine toolbar rewrite deleted element ids that
// the inline runtime still dereferenced. `$('export-video').addEventListener`
// threw inside UI.init(), which aborted boot() BEFORE Renderer.init() — so the
// engine looked perfectly healthy (styled page, empty-state copy, no visible
// error) while nothing could ever render or evolve. check:syntax parses it fine,
// and verify-story-graph.mjs only *prints* pageerrors (it never fails on them).
//
// This asserts the things that actually distinguish "boots" from "looks fine":
//   1. zero uncaught page errors during load + settle
//   2. zero console errors
//   3. the renderer ran its sizing pass (canvas backing store == CSS box)
//   4. no element id is duplicated in a way that lets a hidden node hijack the
//      lookup a script performs with getElementById()
//
// Run: npm run verify:engine-boot
import puppeteer from 'puppeteer';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.ENGINE_BOOT_PORT || 5199);
const BASE = `http://localhost:${PORT}`;

const results = [];
const pass = (m) => { results.push([true, m]); console.log(`  \x1b[32m✓\x1b[0m ${m}`); };
const fail = (m, d) => { results.push([false, m]); console.log(`  \x1b[31m✗\x1b[0m ${m}${d ? ` — ${d}` : ''}`); };

// ---- own static server (matches the other verify-*.mjs scripts: standalone) ----
const server = spawn('node', ['-e', `
  const http=require('http'),fs=require('fs'),path=require('path');
  const ROOT=${JSON.stringify(ROOT)};
  const TYPES={'.html':'text/html','.js':'text/javascript','.css':'text/css',
    '.json':'application/json','.webmanifest':'application/manifest+json','.svg':'image/svg+xml',
    '.png':'image/png','.jpg':'image/jpeg','.webp':'image/webp','.mp3':'audio/mpeg','.woff2':'font/woff2'};
  http.createServer((req,res)=>{
    let p=decodeURIComponent(req.url.split('?')[0]);
    if(p==='/'||p==='/engine') p='/engine.html';
    const f=path.join(ROOT,p.replace(/^\\//,''));
    if(!f.startsWith(ROOT)) return res.writeHead(403).end();
    fs.readFile(f,(e,b)=>{ if(e) return res.writeHead(404).end('nf');
      res.writeHead(200,{'Content-Type':TYPES[path.extname(f)]||'application/octet-stream'}).end(b); });
  }).listen(${PORT},()=>console.log('ready'));
`], { stdio: ['ignore', 'pipe', 'pipe'] });

await new Promise((resolve, reject) => {
  const to = setTimeout(() => reject(new Error('static server did not start')), 8000);
  server.stdout.on('data', (d) => { if (String(d).includes('ready')) { clearTimeout(to); resolve(); } });
  server.stderr.on('data', (d) => process.stderr.write(`[server] ${d}`));
});

let browser;
try {
  browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });

  const pageErrors = [], consoleErrors = [];
  page.on('pageerror', (e) => pageErrors.push(e.message.split('\n')[0]));
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text().slice(0, 160)); });

  await page.goto(`${BASE}/engine.html`, { waitUntil: 'load', timeout: 45000 });

  await page.waitForFunction(
    () => !!(window.SWR && window.SWR.Story && window.SWR.Story.STORY && window.SWR.Story.STORY.fragments),
    { timeout: 30000, polling: 400 }
  ).catch(() => { /* reported by assertion 1/3 below */ });

  await new Promise((r) => setTimeout(r, 2500));

  // 1. uncaught errors — the exact signal that would have caught the boot abort
  const realErrors = pageErrors.filter((m) => !/favicon|ResizeObserver|AudioContext/i.test(m));
  if (!realErrors.length) pass('no uncaught page errors during boot');
  else fail('page threw during boot', `${realErrors.length}: ${realErrors.slice(0, 3).join(' | ')}`);

  // 2. console errors
  const realConsole = consoleErrors.filter((m) => !/favicon|404|Failed to load resource|AudioContext/i.test(m));
  if (!realConsole.length) pass('no console errors during boot');
  else fail('console errors during boot', `${realConsole.length}: ${realConsole.slice(0, 2).join(' | ')}`);

  // 3. the runtime actually initialised far enough to size the canvas
  const boot = await page.evaluate(() => {
    const c = document.getElementById('render');
    const r = c && c.getBoundingClientRect();
    return {
      swr: !!window.SWR, story: !!(window.SWR && window.SWR.Story),
      layers: !!(window.SWR && window.SWR.Layers),
      render: !!c, backing: c ? c.width : 0, css: r ? Math.round(r.width) : 0,
    };
  });
  if (boot.swr && boot.story && boot.layers) pass('window.SWR exposes Story + Layers');
  else fail('SWR runtime incomplete', JSON.stringify(boot));
  if (boot.render && boot.backing > 0 && Math.abs(boot.backing - boot.css) <= 2)
    pass(`renderer sized its canvas to layout (backing ${boot.backing} == css ${boot.css})`);
  else fail('renderer never sized the canvas (Renderer.init did not run)',
            `backing=${boot.backing} css=${boot.css}`);

  // 4. hidden duplicate ids hijacking getElementById
  const hijack = await page.evaluate(() => {
    const seen = new Map();
    for (const el of document.querySelectorAll('[id]')) {
      const id = el.id;
      if (!seen.has(id)) seen.set(id, []);
      seen.get(id).push(el);
    }
    const bad = [];
    for (const [id, els] of seen) {
      if (els.length < 2) continue;
      const first = els[0];
      const hidden = getComputedStyle(first).display === 'none' || first.hidden;
      const alsoVisible = els.slice(1).some((e) => getComputedStyle(e).display !== 'none' && !e.hidden);
      if (hidden && alsoVisible) bad.push(id);            // scripts resolve to the hidden node
    }
    return { dupes: [...seen].filter(([, v]) => v.length > 1).map(([k]) => k), hijack: bad };
  });
  if (!hijack.hijack.length) pass('no hidden element hijacks an id lookup');
  else fail('duplicate id shadowed by a hidden element', hijack.hijack.join(', '));
  if (hijack.dupes.length)
    console.log(`  \x1b[33m!\x1b[0m ${hijack.dupes.length} duplicate id(s) in the document: ${hijack.dupes.join(', ')}`);
} finally {
  if (browser) await browser.close();
  server.kill();
}

const failed = results.filter(([ok]) => !ok).length;
console.log('\n────────────────');
console.log(failed ? `Engine boot: ${results.length - failed}/${results.length} passed`
                   : `ENGINE BOOT: ALL GREEN (${results.length} checks)`);
process.exit(failed ? 1 : 0);
