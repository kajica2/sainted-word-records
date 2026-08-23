// verify-responsive.mjs — audit horizontal overflow at 5 breakpoints for 13 engines.
//
// IMPORTANT: the engines set `html, body { overflow: hidden }` so they
// fill the viewport like a creative console. That means the body never
// scrolls — overflow is clipped, not scrollable. So the usual
// `documentElement.scrollWidth > innerWidth` check returns false even
// when content is positioned far past the right edge.
//
// The real failure mode is: an element is rendered at e.g. x=700 when
// the viewport is 320 wide. The element is "present" but invisible to
// the user. We audit by checking each element's bounding rect against
// the viewport edges and reporting anything that extends past them.
//
// Exit 0 = all combinations clean (no overflow). Non-zero otherwise.

import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import puppeteer from 'puppeteer';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PORT = 8131;
const ENGINES = ['aurora','chrome','eclipse','film','fractal','glitch','grid',
                 'hallucination','neon','pulse','smoke','void','watercolor'];
const BREAKPOINTS = [[320, 568], [375, 667], [768, 1024], [1024, 768], [1440, 900]];

const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.wav': 'audio/wav',
};

function serve() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const url = decodeURIComponent(req.url.split('?')[0].replace(/^\/+/, ''));
      const file = path.join(ROOT, url || 'index.html');
      if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
        res.writeHead(404); res.end('nf'); return;
      }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
      fs.createReadStream(file).pipe(res);
    });
    server.listen(PORT, '127.0.0.1', () => resolve(server));
  });
}

const js = `(() => {
  const innerW = window.innerWidth;
  const innerH = window.innerHeight;
  const overflows = [];
  document.querySelectorAll('*').forEach((el) => {
    if (el.tagName === 'HTML' || el.tagName === 'BODY' || el.tagName === 'HEAD' || el.tagName === 'SCRIPT' || el.tagName === 'STYLE') return;
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) return;
    const isInteractive = ['BUTTON','INPUT','SELECT','TEXTAREA','A'].includes(el.tagName);
    const offRight = r.right > innerW + 1;
    const offLeft = r.left < -1;
    if (offRight || offLeft) {
      overflows.push({
        tag: el.tagName,
        cls: (el.className || '').toString().substring(0, 40),
        id: el.id || '',
        left: Math.round(r.left), right: Math.round(r.right), width: Math.round(r.width),
        text: (el.textContent || '').trim().substring(0, 30),
        interactive: isInteractive,
      });
    }
  });
  return {
    innerW, innerH,
    overflowCount: overflows.length,
    interactiveOverflowCount: overflows.filter(o => o.interactive).length,
    firstOverflows: overflows.slice(0, 4),
  };
})()`;

async function main() {
  const server = await serve();
  const browser = await puppeteer.launch({
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
    headless: 'new',
  });
  const results = [];
  try {
    for (const engine of ENGINES) {
      for (const [w, h] of BREAKPOINTS) {
        const page = await browser.newPage();
        await page.setViewport({ width: w, height: h, deviceScaleFactor: 1 });
        await page.goto(`http://127.0.0.1:${PORT}/versions/${engine}.html?v=${w}`,
                        { waitUntil: 'domcontentloaded', timeout: 20000 }).catch(() => null);
        await new Promise((r) => setTimeout(r, 1200));
        const data = await page.evaluate(js);
        results.push({ engine, w, h, ...data });
        await page.close();
        process.stdout.write('.');
      }
    }
    console.log('');
  } finally {
    await browser.close();
    server.close();
  }

  // Print results grouped by viewport
  const byW = {};
  for (const r of results) (byW[r.w] ??= []).push(r);
  let totalOverflow = 0;
  let totalInteractive = 0;
  for (const w of Object.keys(byW).sort((a, b) => +a - +b)) {
    console.log(`\n=== ${w}px viewport ===`);
    for (const r of byW[w]) {
      if (r.overflowCount > 0) {
        totalOverflow++;
        totalInteractive += r.interactiveOverflowCount;
        console.log(`  OVERFLOW  ${r.engine.padEnd(14)} innerW=${r.innerW} total=${r.overflowCount} interactive=${r.interactiveOverflowCount}`);
        for (const o of r.firstOverflows) {
          console.log(`    <${o.tag}.${o.cls.slice(0,25)}${o.id ? '#'+o.id : ''}> L=${o.left} R=${o.right} W=${o.width}${o.interactive ? ' [interact]' : ''}`);
        }
      } else {
        console.log(`  ok         ${r.engine.padEnd(14)} innerW=${r.innerW}`);
      }
    }
  }
  console.log(`\n${totalOverflow === 0 ? 'PASS' : 'FAIL'} — ${totalOverflow} overflow combos, ${totalInteractive} interactive elements clipped`);
  process.exit(totalOverflow === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(2); });
