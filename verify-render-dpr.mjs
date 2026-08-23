// verify-render-dpr.mjs — visual sanity check at 1× and 2× DPR.
// Loads film.html twice (different deviceScaleFactor), runs a synthetic
// library + layers, snapshots the canvas, and reports whether the 2×
// backing store is exactly 2× the 1× backing store in each dimension.

import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import puppeteer from 'puppeteer';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PORT = 8130;

const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.wav': 'audio/wav',
};

function serve() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const rel = decodeURIComponent(req.url.split('?')[0].replace(/^\/+/, '')) || 'index.html';
      const file = path.join(ROOT, rel);
      if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
        res.writeHead(404); res.end('nf'); return;
      }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
      fs.createReadStream(file).pipe(res);
    });
    server.listen(PORT, () => resolve(server));
  });
}

const SEED_PAGE = `(() => {
  const L = window.SWR.Layers, Lib = window.SWR.Library;
  Lib.items = [];
  for (let i = 1; i <= 4; i++) {
    const cv = document.createElement('canvas');
    cv.width=320; cv.height=180;
    const cx = cv.getContext('2d');
    cx.fillStyle = 'hsl(' + (i*60) + ', 70%, 50%)';
    cx.fillRect(0, 0, 320, 180);
    cx.fillStyle = 'white';
    cx.font = 'bold 40px monospace';
    cx.fillText('LAYER ' + i, 100, 100);
    Lib.items.push({ id: i, name: 'synth-'+i+'.png', type: 'image', blob: null, url: cv.toDataURL(), w: 320, h: 180, luma: 0.5, hue: i/4, motion: 0, thumb: null });
  }
  L.list = Lib.items.slice(0, 4).map((it, i) => ({
    id: 'L' + (i + 1), asset: it, blend: i % 2 ? 'screen' : 'source-over', opacity: 0.9,
    baseScale: 1.0, hue: i * 30, brightness: 1.0, contrast: 1.0, locks: {},
    reactors: [{ feature: 'rms', target: 'scale', scale: 0.4, ease: 'soft' }],
  }));
  L.sel = L.list[0];
  L.render();
})()`;

const PROBE = `(() => {
  const s = window.SWR.stage;
  const ctx = s.getContext('2d');
  const d = ctx.getImageData(s.width/2, s.height/2, 4, 1).data;
  return JSON.stringify({
    stage: { w: s.width, h: s.height },
    css: { w: window.SWR_RENDER.cssW, h: window.SWR_RENDER.cssH },
    dpr: window.SWR_RENDER.dpr,
    centerPixel: Array.from(d),
  });
})()`;

const server = await serve();
const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });

const results = {};
for (const dpr of [1, 2]) {
  const page = await browser.newPage();
  await page.setViewport({ width: 1400, height: 800, deviceScaleFactor: dpr });
  await page.goto(`http://localhost:${PORT}/versions/film.html`, { waitUntil: 'domcontentloaded', timeout: 20000 });
  await page.waitForFunction('window.SWR && window.SWR.Layers && window.SWR_RENDER', { timeout: 10000 });
  await page.evaluate(SEED_PAGE);
  await new Promise(r => setTimeout(r, 600));
  const probe = await page.evaluate(PROBE);
  results[dpr] = JSON.parse(probe);
  console.log(`dpr=${dpr}:`, JSON.stringify(results[dpr]));
  await page.close();
}

await browser.close();
server.close();

// Sanity assertions
const a = results[1], b = results[2];
const expected = a.stage.w * 2;
const ok = b.dpr === 2 && b.stage.w === expected && b.css.w === a.css.w;
console.log('\n2× backing store:');
console.log('  stage.w: 1x=' + a.stage.w + ' 2x=' + b.stage.w + ' expected=' + expected + ' OK=' + (b.stage.w === expected));
console.log('  css.w  : 1x=' + a.css.w + ' 2x=' + b.css.w + ' (should match) OK=' + (b.css.w === a.css.w));
console.log('  dpr    : 1x=' + a.dpr + ' 2x=' + b.dpr + ' OK=' + (b.dpr === 2));
process.exit(ok ? 0 : 1);
