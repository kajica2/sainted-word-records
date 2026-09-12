// scripts/build-vodolija-showcase.js
// Reads artists/vodolija/_candidates_web/*.png, groups them by session
// (parsed from the filename), and writes artists/vodolija/index.html —
// a per-session 4-up grid of logo candidates with a click-to-enlarge
// lightbox. No image binaries are committed (see .gitignore); the page
// reads from the local dir at dev time.
//
// Run from project root:  node scripts/build-vodolija-showcase.js

import { readFileSync, writeFileSync, readdirSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const CANDIDATES = resolve(ROOT, 'artists/vodolija/_candidates_web');
const OUT = resolve(ROOT, 'artists/vodolija');

const files = readdirSync(CANDIDATES).filter(f => f.endsWith('.png'));

// Group by session. Each session is the unique portion of the filename
// before the trailing _<digit>.png. We strip the long UUIDs to make
// labels readable.
function groupKey(name) {
  // strip trailing _<n>.png
  const m = /^(.*)_(\d+)\.png$/.exec(name);
  if (!m) return name;
  let prefix = m[1];
  // Strip the trailing uuid (last underscore + 8-4-4-4-12)
  prefix = prefix.replace(/_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, '');
  // Also strip bare hashes that survive (e.g. _eb12ufi)
  return prefix;
}

function labelFor(key) {
  // Map known prompt prefixes to short session labels
  const lc = key.toLowerCase();
  if (lc.startsWith('a_simple_and_modern_logo_for_the_band_vodolija')) return 'Session 1 · Vodolija (simple/modern)';
  if (lc.startsWith('a_simple_and_elegant_logo_design_for_the_band_vodolija')) return 'Session 1b · Vodolija (simple/elegant)';
  if (lc.startsWith('a_simple_logo_for_the_band_vodolei')) return 'Session 2 · Vodolei (windmill)';
  if (lc.startsWith('a_simple_logo_for_vodelli_things')) return 'Session 3 · Vodelli Things';
  if (lc.startsWith('a_logo_for_vodoluminaria')) return 'Session 4 · Vodoluminaria (V + two)';
  if (lc.startsWith('the_logo_consists_of_an_abstract_style_shape_with_the_text_vo')) return 'Session 5 · VO (abstract)';
  if (lc.startsWith('the_logo_consists_of_an_abstract_stylized_shape_and_the_text')) return 'Session 6 · VO (stylized)';
  if (lc.startsWith('a_woodcut_print_of_the_fish')) return 'Session 7 · Woodcut fish';
  if (lc.startsWith('__c_10_--chaos_10_--ar_43_--raw_--profile_eb12ufi_--stylize_1_e15fce72')) return 'Session 8 · chaos 10 / raw (C1)';
  if (lc.startsWith('__c_10_--chaos_10_--ar_43_--raw_--profile_eb12ufi_--stylize_1_774cc09d')) return 'Session 9 · chaos 10 / raw (C2)';
  if (lc.startsWith('__d_10_--chaos_10_--ar_43_--raw_--profile_eb12ufi_--stylize_1')) return 'Session 10 · chaos 10 / raw (D)';
  // Fallback: first 50 chars of the key
  return key.slice(0, 60) + (key.length > 60 ? '…' : '');
}

const groups = new Map();
for (const f of files) {
  const k = groupKey(f);
  if (!groups.has(k)) groups.set(k, []);
  groups.get(k).push(f);
}

// Sort: numeric "Session N" labels in order, then anything else
const ordered = [...groups.entries()].sort((a, b) => {
  const la = labelFor(a[0]);
  const lb = labelFor(b[0]);
  const na = parseInt((la.match(/Session (\d+)/) || [])[1] || '999', 10);
  const nb = parseInt((lb.match(/Session (\d+)/) || [])[1] || '999', 10);
  if (na !== nb) return na - nb;
  return la.localeCompare(lb);
});

function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

const sessionBlocks = ordered.map(([key, list]) => {
  const label = labelFor(key);
  const tiles = list.sort().map((f, i) => {
    return `
      <figure class="tile" data-file="${esc(f)}">
        <img loading="lazy" src="_candidates_web/${esc(f)}" alt="${esc(label)} candidate ${i + 1}" />
        <figcaption class="tile-meta">
          <span class="tile-num">${i + 1}</span>
          <button class="copy" type="button" data-copy="${esc(f)}" aria-label="Copy filename">copy</button>
        </figcaption>
      </figure>`;
  }).join('\n          ');
  return `
      <section class="session">
        <h2>${esc(label)} <span class="session-count">${list.length} candidates</span></h2>
        <div class="grid">${tiles}
        </div>
      </section>`;
}).join('\n');

const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Vodolija — logo candidates · SWR</title>
  <meta name="description" content="34 logo candidates for the band Vodolija from Midjourney session 4, grouped by prompt session. Pick the one that should become the brand mark." />
  <meta name="theme-color" content="#0a0612" />
  <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
  <style>
    :root {
      --bg: #0a0612; --bg-2: #150b22; --panel: #1a0f30; --panel-2: #221540;
      --ink: #f5e9ff; --ink-2: #c8b5e0; --muted: #8a7aa0; --line: #2a1d3e;
      --accent: #00f0ff;
    }
    * { box-sizing: border-box; }
    html, body { margin: 0; padding: 0; background: var(--bg); color: var(--ink);
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
    a { color: var(--accent); text-decoration: none; }
    .wrap { max-width: 1280px; margin: 0 auto; padding: 32px 18px 80px; }
    header.top { display: flex; align-items: center; gap: 12px; margin-bottom: 16px; }
    header.top .badge { display: inline-flex; align-items: center; gap: 8px;
      padding: 5px 12px; border: 1px solid var(--accent); border-radius: 999px;
      color: var(--accent); font-size: 10px; letter-spacing: 0.18em; text-transform: uppercase; }
    header.top .spacer { flex: 1; }
    header.top a.back { font-size: 10px; letter-spacing: 0.14em; text-transform: uppercase;
      padding: 6px 12px; border: 1px solid var(--line); border-radius: 4px; color: var(--ink-2); }
    h1 { font-size: 30px; font-weight: 700; margin: 0 0 6px; letter-spacing: 0.04em; }
    .lede { color: var(--ink-2); font-size: 13px; max-width: 760px; margin: 0 0 28px; line-height: 1.6; }
    .lede code { color: var(--accent); padding: 1px 5px; background: var(--panel-2); border-radius: 3px; }

    .session { margin-bottom: 36px; }
    .session h2 { font-size: 12px; letter-spacing: 0.16em; text-transform: uppercase;
      color: var(--ink); margin: 0 0 12px; display: flex; align-items: baseline; gap: 10px;
      border-left: 3px solid var(--accent); padding-left: 10px; }
    .session-count { font-size: 10px; color: var(--muted); font-weight: 400; }
    .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 12px; }

    .tile { margin: 0; background: var(--panel); border: 1px solid var(--line);
      border-radius: 6px; overflow: hidden; transition: border-color 0.18s, transform 0.18s;
      cursor: zoom-in; }
    .tile:hover { border-color: var(--accent); transform: translateY(-1px); }
    .tile img { display: block; width: 100%; height: auto; background: #0a0612; }
    .tile-meta { display: flex; align-items: center; justify-content: space-between;
      padding: 6px 10px; border-top: 1px solid var(--line); font-size: 10px;
      color: var(--muted); letter-spacing: 0.1em; text-transform: uppercase; }
    .tile-num { color: var(--ink-2); }
    .copy { background: transparent; border: 1px solid var(--line); color: var(--ink-2);
      padding: 3px 8px; border-radius: 3px; font: 9px/1 ui-monospace;
      letter-spacing: 0.14em; cursor: pointer; }
    .copy:hover { color: var(--accent); border-color: var(--accent); }
    .copy.copied { color: #00ffa3; border-color: #00ffa3; }

    /* Lightbox */
    #lightbox { position: fixed; inset: 0; background: rgba(5, 3, 10, 0.94);
      display: none; align-items: center; justify-content: center; z-index: 100;
      padding: 40px; cursor: zoom-out; }
    #lightbox.open { display: flex; }
    #lightbox img { max-width: 92vw; max-height: 88vh; box-shadow: 0 12px 60px rgba(0,0,0,0.6);
      border: 1px solid var(--line); }
    #lightbox .lb-cap { position: fixed; bottom: 16px; left: 0; right: 0; text-align: center;
      color: var(--muted); font-size: 10px; letter-spacing: 0.14em; text-transform: uppercase; }

    footer.foot { margin-top: 40px; padding-top: 16px; border-top: 1px solid var(--line);
      font-size: 10px; color: var(--muted); letter-spacing: 0.12em; text-transform: uppercase; }
  </style>
</head>
<body>
  <div class="wrap">
    <header class="top">
      <span class="badge">VODOLIJA · LOGO CANDIDATES</span>
      <span class="spacer"></span>
      <a class="back" href="/artists">← ARTISTS</a>
    </header>
    <h1>Vodolija — 34 candidates across 10 sessions</h1>
    <p class="lede">
      Source: Midjourney session 4. Click any tile to enlarge. To promote a
      candidate to the brand hero, click <code>copy</code> on the tile and
      paste the filename into the artist page JSON. Binaries live in
      <code>artists/vodolija/_candidates_web/</code> (gitignored; reviewed
      locally, not deployed). Sessions are grouped by prompt — sessions 1-7
      are name-typed, sessions 8-10 are <code>--chaos 10 --raw</code> refinements.
    </p>

    ${sessionBlocks}

    <footer class="foot">
      click any image to enlarge · copy button puts the filename on your clipboard
    </footer>
  </div>

  <div id="lightbox" role="dialog" aria-label="Logo preview">
    <img id="lbImg" alt="" />
    <div class="lb-cap" id="lbCap">press esc to close</div>
  </div>

  <script>
    (function () {
      // Lightbox: click tile → show full size.
      document.querySelectorAll('.tile').forEach(function (tile) {
        tile.addEventListener('click', function (e) {
          if (e.target.classList.contains('copy')) return;
          var img = tile.querySelector('img');
          var lb = document.getElementById('lightbox');
          var lbImg = document.getElementById('lbImg');
          lbImg.src = img.src.replace('/_candidates_web/', '/_candidates_web/');
          lbImg.alt = img.alt;
          lb.classList.add('open');
        });
      });
      document.getElementById('lightbox').addEventListener('click', function () {
        this.classList.remove('open');
      });
      document.addEventListener('keydown', function (e) {
        if (e.key === 'Escape') document.getElementById('lightbox').classList.remove('open');
      });

      // Copy buttons
      document.querySelectorAll('.copy').forEach(function (btn) {
        btn.addEventListener('click', function (e) {
          e.stopPropagation();
          var fn = btn.dataset.copy;
          navigator.clipboard.writeText(fn).then(function () {
            btn.classList.add('copied');
            btn.textContent = 'copied';
            setTimeout(function () {
              btn.classList.remove('copied');
              btn.textContent = 'copy';
            }, 1400);
          }).catch(function () {
            btn.textContent = 'press ⌘C';
          });
        });
      });
    })();
  </script>
</body>
</html>
`;

mkdirSync(OUT, { recursive: true });
writeFileSync(resolve(OUT, 'index.html'), html);
console.log(`wrote ${OUT}/index.html — ${ordered.length} sessions, ${files.length} candidates`);
