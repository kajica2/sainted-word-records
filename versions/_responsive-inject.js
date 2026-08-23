// versions/_responsive-inject.js — codemod: make every engine page's
// layout responsive from 320px mobile up to 1440px desktop.
//
// Run from the product root:
//   node versions/_responsive-inject.js
//
// Idempotent: re-running reports "skipped" for pages already patched.
//
// Background: all 13 engine pages share an identical layout skeleton:
//   #app { display: grid; grid-template-columns: 220px 1fr 240px;
//          grid-template-rows: <44-52px> 1fr <36-40px>; height: 100vh; }
//   header { grid-column: 1 / -1; display: flex; ...; padding: 0 18px; ... }
//   aside.lib, aside.layers { background: var(--panel); overflow-y: auto; }
//
// At viewports below ~720px the 220+240 = 460px of fixed side columns
// consumes more than the viewport width. The center column collapses
// to 0 (the canvas disappears). Worse, the header is forced to span
// all 3 grid tracks via `grid-column: 1 / -1`, so the header ends up
// 460px wide and its controls are clipped off-screen because
// html/body has overflow:hidden (so the user sees an empty header).
//
// Fix, applied to every engine:
//   1. Replace `1fr` with `minmax(0, 1fr)` so the center column can
//      shrink to fit (avoids grid blow-out).
//   2. Add min-width: 0 to flex/grid children (header, aside.lib,
//      aside.layers, #app) so they don't enforce intrinsic min-content.
//   3. Add flex-wrap: wrap + max-height: 30vh + overflow-y: auto to
//      the header so transport controls wrap to a second line on narrow
//      screens instead of clipping off the right edge.
//   4. Add a single @media (max-width: 720px) block that:
//        - collapses the 3-column grid into a single column
//        - re-orders the rows so the canvas (stage) is at the top
//          and the two side panels stack below it (both scrollable
//          with bounded max-height)
//        - shrinks header padding, transport-control gap, .meter width
//   5. max-width: 100% on header <input>/<select> so they can't push
//      the flex container past the viewport.
//
// Desktop layout (≥720px) is unchanged: 220/1fr/240 grid, header in
// one row, side panels at full height. The 1440px / 1024px / 768px
// breakpoints stay exactly as designed.

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.dirname(__dirname);

const ENGINES = [
  'aurora','chrome','eclipse','film','fractal','glitch','grid',
  'hallucination','neon','pulse','smoke','void','watercolor',
];

// CSS fragments we want to ensure exist after the codemod runs.
// The body of @media (max-width: 720px) is the entire responsive
// redesign — desktop CSS is preserved unchanged.
const RESPONSIVE_MARKER = 'SWR-RESPONSIVE-MARKER';

const RESPONSIVE_BLOCK = `
    /* ---------- Responsive layout (mobile-first additions) ----------
       SWR-RESPONSIVE-MARKER
       Original desktop layout (grid-template-columns: 220px 1fr 240px,
       header in one row) is preserved. Below 720px viewport we collapse
       the 3-column grid to a single column, stack the canvas on top of
       the library + layers panels (each scrollable with a bounded
       height), and let the header wrap + scroll vertically. */
    #app { min-width: 0; }
    header { flex-wrap: wrap; max-height: 30vh; overflow-y: auto; min-width: 0; }
    header > * { min-width: 0; }
    header input, header select, header button { max-width: 100%; }
    aside.lib, aside.layers { min-width: 0; }
    footer { flex-wrap: wrap; max-height: 24vh; overflow-y: auto; min-width: 0; row-gap: 4px; }
    footer > * { min-width: 0; }
    @media (max-width: 720px) {
      #app {
        grid-template-columns: minmax(0, 1fr);
        grid-template-rows: auto auto 1fr auto auto;
      }
      header { padding: 6px 10px; gap: 6px; max-height: 22vh; }
      .meter { width: 100px; }
      aside.lib, aside.layers { max-height: 30vh; }
      aside.lib { grid-row: 3; border-right: none; border-top: 1px solid var(--line); }
      aside.layers { grid-row: 4; border-left: none; border-top: 1px solid var(--line); }
      section.stage { grid-row: 2; min-height: 320px; }
    }
`;

function patchFile(file) {
  let s = fs.readFileSync(file, 'utf8');

  // Already patched → skip.
  if (s.includes(RESPONSIVE_MARKER)) return { file, status: 'skipped' };

  // 1) Replace `1fr` with `minmax(0, 1fr)` in CSS grid definitions.
  //    Two distinct grid contexts need this:
  //    a) #app's 3-column grid  (`220px 1fr 240px`)
  //    b) Layer panel rows      (`.l .r { grid-template-columns: 50px 1fr }`)
  //    We replace `1fr` only when it's a grid-track value followed by `;`
  //    or surrounded by spaces, not when it's a flex value (which would
  //    already behave correctly).
  s = s.replace(
    /(grid-template-columns:\s*(?:\d+px\s+))1fr(\s+\d+px\s*;)/,
    '$1minmax(0, 1fr)$2',
  );
  s = s.replace(
    /(grid-template-columns:\s*\d+px\s+)1fr(\s*\})/g,
    '$1minmax(0, 1fr)$2',
  );

  // 2) Inject the responsive block right before the .swr-watermark
  //    CSS rule, which is the last CSS block in every engine file
  //    (the watermark overlay sits in the bottom-right of the canvas
  //    via `position: absolute`). Some engines have a leading
  //    `/* SWR watermark overlay */` comment, others don't — anchor on
  //    the rule selector itself for resilience.
  const anchor = '\n    .swr-watermark {';
  if (!s.includes(anchor)) {
    return { file, status: 'error: anchor .swr-watermark { not found' };
  }
  s = s.replace(anchor, RESPONSIVE_BLOCK + anchor);

  fs.writeFileSync(file, s);
  return { file, status: 'patched' };
}

const results = [];
for (const e of ENGINES) {
  const p = path.join(ROOT, 'versions', `${e}.html`);
  results.push(patchFile(p));
}
const patched = results.filter((r) => r.status === 'patched').length;
const skipped = results.filter((r) => r.status === 'skipped').length;
const errors = results.filter((r) => r.status.startsWith('error'));
for (const r of results) {
  console.log(`  ${r.file.replace(ROOT + '/', '')}: ${r.status}`);
}
console.log(`\n${patched} patched, ${skipped} skipped, ${errors.length} errors`);
process.exit(errors.length === 0 ? 0 : 1);
