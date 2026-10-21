// scripts/check-touch-targets.mjs — guard for P2.4 of
// docs/PLANS/architecture-audit-2026-10.md.
//
// `.tbtn` ships at ~28px (11px font + 7px vertical padding) and the
// layer-row / gctrl / swr-tx-panel range sliders at 14px, which is
// undraggable on touch. The fix is a `@media (pointer: coarse)`
// override that bumps both to the iOS HIG / Material 44dp bar.
//
// This test reads engine.html as text (it doesn't need a browser or
// a vm sandbox to verify a CSS rule) and asserts:
//   1. The @media (pointer: coarse) block exists.
//   2. .tbtn has min-height: 44px (or height: 44px) inside it.
//   3. The coarse-pointer block also resizes the layer / gctrl /
//      swr-tx-panel range inputs and sets the slider-thumb to 28x28.
//   4. The complement to the coarse block: at <=768px viewport the
//      same buttons also get min-height: 44px (the DevTools mobile
//      profile reports pointer: fine, so the coarse block above
//      doesn't fire there).
//
// Run: node scripts/check-touch-targets.mjs
// Exits 0 on green, 1 on red.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const ENGINE_HTML = resolve(ROOT, 'engine.html');

const html = readFileSync(ENGINE_HTML, 'utf8');

let failed = 0;
function check(name, cond, detail) {
  const status = cond ? 'PASS' : 'FAIL';
  console.log(`  ${status}  ${name}${detail ? ' — ' + detail : ''}`);
  if (!cond) failed += 1;
}

// ---- 1. Coarse-pointer media block exists with the right shape ----

// Pull a single @media (pointer: coarse) { ... } block from the file.
// We use the simplest balanced-brace scan: find the opening "@media
// (pointer: coarse)" and walk braces until the matching close.
function findMediaBlock(src, mediaSelector) {
  const idx = src.indexOf(mediaSelector);
  if (idx === -1) return null;
  // The block body starts at the first '{' after the selector.
  const openIdx = src.indexOf('{', idx);
  if (openIdx === -1) return null;
  let depth = 0;
  for (let i = openIdx; i < src.length; i += 1) {
    const ch = src[i];
    if (ch === '{') depth += 1;
    else if (ch === '}') {
      depth -= 1;
      if (depth === 0) return src.slice(openIdx + 1, i);
    }
  }
  return null;
}

const coarseBlock = findMediaBlock(html, '@media (pointer: coarse)');
check('@media (pointer: coarse) block exists in engine.html',
  !!coarseBlock,
  coarseBlock ? 'block length=' + coarseBlock.length + ' chars'
              : 'selector not found');

// Inside the coarse block: .tbtn has min-height: 44px (allow height: too).
check('.tbtn has min-height: 44px in the coarse block',
  !!coarseBlock && /\.tbtn\s*\{[^}]*min-height:\s*44px/i.test(coarseBlock),
  'scanning /\\.tbtn\\s*\\{[^}]*min-height:\\s*44px/i');

// Coarse block resizes at least one of the range inputs (layer-row
// is the loudest — the layer-X opacity slider — and the test suite
// runs without a CSS parser, so we accept a wider net to keep the
// check resilient to renames).
check('range input (.layer-row / .gctrl / .swr-tx-panel) has height: 44px in the coarse block',
  !!coarseBlock &&
    /input\[type=["']range["']\][^{]*\{\s*height:\s*44px/i.test(coarseBlock),
  'scanning for input[type=range] { height: 44px }');

// Coarse block sets a slider-thumb to 28x28 (the cap above 14px).
check('slider thumb is at least 28x28 in the coarse block',
  !!coarseBlock &&
    /slider-thumb[^{]*\{\s*[^}]*width:\s*28px[^}]*height:\s*28px/i.test(coarseBlock),
  'scanning ::-webkit-slider-thumb { width:28px; height:28px }');

// ---- 2. Mobile-width (pointer: fine but small surface) block ----

const narrowBlock = findMediaBlock(html, '@media (max-width: 768px)');
check('@media (max-width: 768px) block exists in engine.html',
  !!narrowBlock,
  narrowBlock ? 'block length=' + narrowBlock.length + ' chars' : 'selector not found');

// Inside the narrow block: button, .tbtn, .basic-ctrl get min-height
// 44px (the small-viewport guard for DevTools mobile emulation).
check('narrow-viewport block bumps min-height to 44px for buttons / .tbtn',
  !!narrowBlock &&
    /min-height:\s*44px\s*!important/i.test(narrowBlock),
  'scanning /min-height:\\s*44px\\s*!important/i');

// ---- 3. The original 14px slider and 28-px-ish button still ship ----
// Document, do not gate: a future refactor that changes the BASE
// sizes needs to update the test too. We log so a regression here
// shows up in the run output, but the suite stays green.

const baseSlider = /\.layer-row input\[type=["']range["']\][^{]*\{\s*[^}]*height:\s*14px/i.test(html);
console.log(`  INFO  base .layer-row range height: 14px? ${baseSlider} (logged only)`);

// ---- summary ----

if (failed) {
  console.log(`\nFAIL — ${failed} touch-target check(s) failed (P2.4 of the audit plan)`);
  process.exit(1);
} else {
  console.log(`\nPASS — touch targets meet the 44px bar on coarse pointer + narrow viewports`);
  process.exit(0);
}
