// scripts/check-neon-image-clip.mjs — the image-clip gate for versions/neon.html.
//
// Stills are already clips on this page, so the failure mode is not "images
// do not load" — it is a still that ingests fine and then never reaches the
// stage (a canvas-backed source, for instance, has no .complete/.naturalWidth
// and is silently gated out by the draw path). This drives the real page:
//
// Proves three things about the image-clip surface on versions/neon.html:
//   1. addImageClips ingests a still ONCE (no duplicate) as type 'image'
//   2. the still is framed to IMAGE_SLOT (1280x720), so a swap cannot re-frame
//   3. it actually reaches the stage canvas — a silent no-draw would fail here
import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import puppeteer from 'puppeteer';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..', 'dist');
const PORT = 8137;

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.mp3': 'audio/mpeg', '.mp4': 'video/mp4', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif', '.svg': 'image/svg+xml' };

const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  let file = path.join(ROOT, p);
  if (p.endsWith('/')) file = path.join(file, 'index.html');
  if (!fs.existsSync(file) && fs.existsSync(file + '.html')) file = file + '.html';
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); res.end('nf'); return; }
  res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
});

let failures = 0;
const ok = (cond, msg, extra) => {
  if (cond) console.log('  ✓ ' + msg + (extra ? ' (' + extra + ')' : ''));
  else { failures++; console.log('  ✗ ' + msg + (extra ? ' — ' + extra : '')); }
};

await new Promise((r) => server.listen(PORT, r));
const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
try {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(`http://127.0.0.1:${PORT}/versions/neon.html`, { waitUntil: 'networkidle2', timeout: 30000 });

  await page.waitForFunction(() => !!(window.SWRImages && window.SWR && window.Layers), { timeout: 15000 });
  ok(true, 'SWRImages + SWR + Layers are published');

  ok(await page.evaluate(() => window.SWRImages.slot.w === 1280 && window.SWRImages.slot.h === 720),
    'the slot is 1280x720');

  const result = await page.evaluate(async () => {
    // A 400x300 still: a NON-16:9 aspect, so the slot is observable.
    const c = document.createElement('canvas'); c.width = 400; c.height = 300;
    const cx = c.getContext('2d'); cx.fillStyle = '#ff0044'; cx.fillRect(0, 0, 400, 300);
    const blob = await new Promise((r) => c.toBlob(r, 'image/png'));
    const file = new File([blob], 'probe-400x300.png', { type: 'image/png' });

    const before = window.SWR.Library.items.length;
    const added = await window.SWRImages.addImageClips([file]);
    const after = window.SWR.Library.items.length;

    // Wait for the classify pass to finish (it reads naturalWidth + builds a thumb).
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline && added[0] && (!added[0].thumb || !added[0].w)) {
      await new Promise((r) => setTimeout(r, 50));
    }

    let painted = false;
    let diag = {};
    if (added[0]) {
      window.Layers.add(added[0]);
      const stage = document.getElementById('render');
      const scx = stage.getContext('2d');
      // Poll: the still's <img> loads asynchronously and the draw gate
      // (`complete && naturalWidth`) skips the layer until it has.
      const until = Date.now() + 4000;
      while (Date.now() < until) {
        await new Promise((r) => requestAnimationFrame(r));
        if (!stage.width || !stage.height) continue;
        const d = scx.getImageData(0, 0, stage.width, stage.height).data;
        let lit = 0;
        for (let i = 0; i < d.length; i += 4) if (d[i] > 60 || d[i + 1] > 60 || d[i + 2] > 60) lit++;
        if (lit > (stage.width * stage.height) * 0.05) { painted = true; break; }
      }
      diag = {
        stageW: stage.width, stageH: stage.height,
        elComplete: !!(added[0]._el && added[0]._el.complete),
        elNatural: (added[0]._el && added[0]._el.naturalWidth) || 0,
        layers: window.Layers.list.length,
        assetOnLayer: !!(window.Layers.list[0] && window.Layers.list[0].asset),
      };
    }
    return {
      before, after, painted,
      count: added.length,
      type: added[0] && added[0].type,
      w: added[0] && added[0].w,
      h: added[0] && added[0].h,
      diag,
    };
  });

  ok(result.count === 1, 'one still added', 'count=' + result.count);
  ok(result.after - result.before === 1, 'ingested exactly once (no duplicate ingest)',
    result.before + ' → ' + result.after);
  ok(result.type === 'image', 'classified as an image clip', String(result.type));
  ok(result.w === 1280 && result.h === 720,
    'framed to the slot despite a 400x300 source', result.w + 'x' + result.h);
  ok(result.painted, 'the still actually reached the stage canvas',
    'painted=' + result.painted + ' diag=' + JSON.stringify(result.diag));
  ok(errors.length === 0, 'no page errors', errors.slice(0, 3).join(' | '));
} finally {
  await browser.close();
  server.close();
}

console.log(failures ? `\n${failures} CHECK(S) FAILED` : '\nNEON IMAGE CLIP: ALL GREEN');
process.exit(failures ? 1 : 0);
