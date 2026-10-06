#!/usr/bin/env node
// scripts/check-grade-smoke.mjs — the shared house grade follows the grading
// rules (docs/grade-house-rules.md).
//
//  1. the spec's numbers sit inside the rules' ranges (saturation trim vs the
//     +8 ceiling, blacks lifted 0.02-0.05, whites parked 0.90-0.95, ~5% grain)
//  2. the CSS chain derived from those numbers is what the browser applies,
//     and it is applied to exactly one canvas — never doubled on the stage and
//     the fx overlay at once
//  3. the grain floor really lands in the stage pixels: measured as spatial
//     high-frequency energy on a flat field, A/B against setEnabled(false)
//
// A synthetic page carries the flat field so the measurement is deterministic
// (the real variant pages animate, which would swamp the noise metric); the
// module is the shipped one, loaded by URL like every other page loads it.

import puppeteer from 'puppeteer';
import http from 'node:http';
import fs from 'node:fs';

const ROOT = process.cwd();

const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.webp': 'image/webp', '.jpg': 'image/jpeg', '.mp3': 'audio/mpeg',
};

const server = http.createServer((req, res) => {
  const url = req.url.split('?')[0];
  const fullPath = ROOT + (url === '/' ? '/index.html' : url);
  if (!fs.existsSync(fullPath) || fs.statSync(fullPath).isDirectory()) {
    res.statusCode = 404;
    res.end('not found');
    return;
  }
  res.setHeader('Content-Type', MIME[fullPath.slice(fullPath.lastIndexOf('.'))] || 'application/octet-stream');
  res.end(fs.readFileSync(fullPath));
});
// Ephemeral port on loopback. A hardcoded port can already be held by an
// unrelated local app on 127.0.0.1 while Node's default `::` bind still
// succeeds — the listen looks fine but the page loads silently reach the
// other server, so the module never appears. Same pattern as
// check-p35-smoke.mjs.
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const PORT = server.address().port;

let pass = 0;
let fail = 0;
function check(name, ok, detail) {
  console.log(`${ok ? '✓' : '✗'} ${name}${detail ? ' (' + detail + ')' : ''}`);
  if (ok) pass += 1; else fail += 1;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
let page;
const errors = [];
try {
  page = await browser.newPage();
  // pageerror always counts; console noise that is environmental (missing
  // assets, the local 8787 dev bridge no one runs in tests) is filtered.
  const NOISE = /Failed to load resource|ws:\/\/127\.0\.0\.1:8787|WebSocket connection/;
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (msg) => {
    if (msg.type() === 'error' && !NOISE.test(msg.text())) errors.push(msg.text());
  });
  await page.setViewport({ width: 900, height: 700 });

  // A page whose frame the test owns: a flat grey field, redrawn on demand,
  // with the same swr-frame-end hook the real variants dispatch.
  await page.goto(`http://127.0.0.1:${PORT}/scripts/_grade-smoke-fixture.html`, { waitUntil: 'domcontentloaded' });
  const ready = await page.waitForFunction(() => !!(window.SWR_NATURAL && window.SWR_NATURAL.GRADE && window.__drawField), { timeout: 10000 })
    .then(() => true).catch(() => false);
  check('module loads on a page and exposes the grade spec', ready);

  // ---- 1. spec inside the rules' ranges -----------------------------------
  const spec = await page.evaluate(() => ({
    grade: JSON.parse(JSON.stringify(window.SWR_NATURAL.GRADE)),
    css: window.SWR_NATURAL.gradeCSS,
  }));
  const g = spec.grade;
  check('saturation stays inside the rules ceiling (a boost may not exceed 1.08)',
    g.saturation > 0.8 && g.saturation <= 1.08, `saturation=${g.saturation}`);
  check('blacks lifted slightly, not washed out (0.02–0.05)',
    g.black >= 0.02 && g.black <= 0.05, `black=${g.black.toFixed(3)}`);
  check('whites parked just below clipping (0.90–0.95)',
    g.white >= 0.90 && g.white <= 0.95, `white=${g.white.toFixed(3)}`);
  check('grain floor present and subtle (2–8%)',
    g.grain >= 0.02 && g.grain <= 0.08, `grain=${g.grain}`);
  check('the applied chain is derived from the spec',
    spec.css === `saturate(${g.saturation}) contrast(${g.contrast}) brightness(${g.brightness})`, spec.css);

  // ---- 2. applied to exactly one canvas -----------------------------------
  const applied = await page.evaluate(() => {
    const stage = document.getElementById('stage');
    return {
      stage: getComputedStyle(stage).filter,
      others: Array.from(document.querySelectorAll('canvas')).filter((c) => c !== stage)
        .map((c) => ({ id: c.id, filter: getComputedStyle(c).filter })),
    };
  });
  check('the stage carries the service chain', applied.stage === spec.css, applied.stage);
  check('no second canvas is graded (grade must not double)',
    applied.others.every((o) => o.filter === 'none'), JSON.stringify(applied.others));

  // ---- 3. grain floor really lands in the pixels ---------------------------
  // Spatial high-frequency energy on a flat field: grain is the only thing that
  // adds it. Quality is pinned because headless runs below the module's
  // adaptive threshold, which would shed the whole composite pass.
  const grainAB = await page.evaluate(async () => {
    const N = window.SWR_NATURAL;
    const stage = document.getElementById('stage');
    const ctx = stage.getContext('2d');
    const hf = () => {
      const d = ctx.getImageData(40, 40, 120, 120).data;
      let sum = 0, n = 0;
      for (let y = 0; y < 119; y++) {
        for (let x = 0; x < 119; x++) {
          const i = (y * 120 + x) * 4;
          const j = i + 4;
          sum += Math.abs(d[i] - d[j]);
          n += 1;
        }
      }
      return sum / n;
    };
    const mean = () => {
      const d = ctx.getImageData(40, 40, 120, 120).data;
      let s = 0;
      for (let i = 0; i < d.length; i += 4) s += d[i];
      return s / (d.length / 4);
    };
    N._forceQuality(2);
    window.__drawField();
    await new Promise((r) => setTimeout(r, 400));
    const hfOn = hf(), meanOn = mean();
    N.setEnabled(false);
    window.__drawField();
    await new Promise((r) => setTimeout(r, 400));
    const hfOff = hf(), meanOff = mean();
    N.setEnabled(true);
    return { hfOn, hfOff, meanOn, meanOff, field: window.__field };
  });
  check('grain raises the high-frequency energy of a flat field',
    grainAB.hfOn > Math.max(grainAB.hfOff * 1.5, grainAB.hfOff + 0.4),
    `hf on=${grainAB.hfOn.toFixed(3)} off=${grainAB.hfOff.toFixed(3)}`);
  // Amplitude band, not the mean: the trail/mirror composite lifts a *static*
  // field on its own (pre-existing), but only grain adds high-frequency energy —
  // and it must stay subtle (±32-level tile at 5% ≈ 1-2 levels per step).
  check('grain amplitude stays subtle (0.4–8 levels per step)',
    grainAB.hfOn >= 0.4 && grainAB.hfOn <= 8,
    `hf on=${grainAB.hfOn.toFixed(2)}`);

  // ---- 4. a real variant page applies the same single grade ----------------
  await page.goto(`http://127.0.0.1:${PORT}/versions/hallucination.html`, { waitUntil: 'domcontentloaded' });
  const variant = await page.waitForFunction(() => !!window.SWR_NATURAL, { timeout: 15000 })
    .then(() => true).catch(() => false);
  const variantGrade = variant ? await page.evaluate(() => {
    const stage = window.SWR.stage || document.getElementById('stage');
    const fx = document.getElementById('fx-canvas');
    const fxVisible = !!fx && fx.offsetParent !== null;
    const graded = Array.from(document.querySelectorAll('canvas'))
      .filter((c) => getComputedStyle(c).filter && getComputedStyle(c).filter !== 'none');
    return {
      css: window.SWR_NATURAL.gradeCSS,
      gradedIds: graded.map((c) => c.id || '(unnamed)'),
      // Contract: the grade sits on the TOPMOST visible canvas — the fx overlay
      // when it is up (it composites the stage), the stage otherwise.
      expected: fxVisible ? 'fx-canvas' : 'stage',
      gotTopmost: graded.length === 1 && (graded[0] === (fxVisible ? fx : stage)),
    };
  }) : null;
  check('a real variant page grades exactly its topmost canvas',
    !!variantGrade && variantGrade.gotTopmost,
    variantGrade ? JSON.stringify(variantGrade) : 'no SWR_NATURAL');

  check('no page or module errors during the run', errors.length === 0, errors.slice(0, 3).join('|'));
} finally {
  await browser.close();
  server.close();
}

console.log(`\n${pass}/${pass + fail} grade checks passed`);
process.exit(fail === 0 ? 0 : 1);
