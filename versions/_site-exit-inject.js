// versions/_site-exit-inject.js — codemod: give every full-viewport engine
// page one way back to the site.
//
// Run from the product root:
//   node versions/_site-exit-inject.js
//
// Why: the 22 variants and the two music-video cuts render full-viewport with
// their own transport header instead of the shared <swr-nav>. Their only
// in-page links walked between variants — the five core variants formed a
// closed neon→film→grid→smoke→hallucination→neon loop — and
// versions/music_video.html and versions/music_video_mtv.html carried no <a>
// at all, so a visitor could not reach the marketing site or the versions index
// without the browser back button.
//
// What it injects, immediately after the shared transport <header>:
//
//   <!-- SWR-SITE-EXIT --><a class="swr-site-exit" href="/" …>← Site</a>
//
// Inline styles only: these pages carry their own stylesheets and must not
// depend on lib/components.css.
//
// Idempotent: a page already carrying the SWR-SITE-EXIT marker is skipped.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.dirname(__dirname);

const PAGES = [
  'aurora', 'bachdrop', 'baroque', 'chrome', 'collage', 'echo-manifold',
  'eclipse', 'film', 'fractal', 'glitch', 'grid', 'hallucination', 'kraft',
  'mosaic', 'neon', 'phosphor', 'pulse', 'smoke', 'spectrum', 'tape',
  'typography', 'void', 'watercolor', 'music_video', 'music_video_mtv',
];

const MARKER = 'SWR-SITE-EXIT';
const LINK =
  `<!-- ${MARKER} --><a class="swr-site-exit" href="/" title="Sainted Word Records — home"` +
  ` style="font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:10px;` +
  `color:var(--muted);text-decoration:none;border:1px solid var(--line);border-radius:3px;` +
  `padding:4px 7px;white-space:nowrap;line-height:1">← Site</a>`;

const HEADER_RE = /(<!-- SWR-HEADER-DATA-ICONS -->\s*<header[^>]*>)/;
const BODY_RE = /(<body[^>]*>)/;

let patched = 0;
let skipped = 0;
const errors = [];

for (const name of PAGES) {
  const file = path.join(ROOT, 'versions', `${name}.html`);
  if (!fs.existsSync(file)) { errors.push(`${name}.html not found`); continue; }
  const html = fs.readFileSync(file, 'utf8');
  if (html.includes(MARKER)) { skipped++; continue; }

  const m = html.match(HEADER_RE) || html.match(BODY_RE);
  if (!m) { errors.push(`${name}.html has no <header> or <body>`); continue; }

  const patchedHtml = html.replace(m[0], `${m[0]}\n      ${LINK}`);
  fs.writeFileSync(file, patchedHtml);
  patched++;
}

console.log(`${patched} patched, ${skipped} skipped (already carry ${MARKER})`);
if (errors.length) {
  console.error('errors:\n  ' + errors.join('\n  '));
  process.exit(1);
}
