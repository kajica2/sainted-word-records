// versions/_svg-grade-inject.js — codemod: move each renderer's per-frame
// 2D ctx.filter chain (the audio-driven path) onto the SVG filter graph
// in lib/svg-grade.client.js.
//
// Why: variants whose grade is the audio-driven one (smoke.html, currently)
// grade the layer with a CSS filter on the 2D context every frame. That
// chain is a full-frame software pass — measured ~19ms of a ~27ms frame on
// smoke.html. SVG <filter> gives the same chain on the compositor (one
// pass over an overlay canvas) at ~2-4ms/frame on M-class chips. It also
// gives a real DAG vs Chromium's flat ctx.filter list.
//
// What it does per page:
//   1. injects <svg class="swr-svg-grade"><defs><filter id="g">…</filter></defs></svg>
//      + <script src="../lib/svg-grade.client.js" defer></script>
//      at the end of body (marker-guarded, idempotent).
//   2. rewrites the audio-driven `ctx.filter = \`blur(...) sepia(...) hue-rotate(...)
//      brightness(...) contrast(...) saturate(...)\`` chain into
//      `SWR_SVG_GRADE.setFilter(blur, sepia, hue, bright, contrast, sat)`,
//      preserving the per-frame audio-driven expressions verbatim.
//   3. removes the `_ctx.filter = 'none'` reset (no longer needed once the
//      chain is on the overlay canvas — the overlay composite handles it).
//
// Pages whose grade is not a single plain audio-driven `ctx.filter` chain
// (multiple chains, `_ctx.filter = 'none'` only, GPU-grade already covers
// them, no blur, or chains on private `_ctx` with no _ctx alias declared)
// are skipped and listed — they need a per-layer decision, not a codemod.
//
// Not loaded by any page. Run it manually:
//   node versions/_svg-grade-inject.js --dry-run
//   node versions/_svg-grade-inject.js
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR = path.dirname(fileURLToPath(import.meta.url));
const MARKER = '<!-- SWR-SVG-GRADE-MARKER -->';
const SVG_DEFS = [
  '<svg class="swr-svg-grade" hidden aria-hidden="true" focusable="false" style="position:absolute;width:0;height:0;overflow:hidden;">',
  '  <defs>',
  '    <filter id="g" width="200%" height="200%" x="-50%" y="-50%" color-interpolation-filters="sRGB">',
  '      <feGaussianBlur in="SourceGraphic" stdDeviation="0" result="blurred"/>',
  '      <feColorMatrix in="blurred" type="matrix" values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 1 0" result="sepia"/>',
  '      <feColorMatrix in="sepia" type="hueRotate" values="0" result="rotated"/>',
  '      <feColorMatrix in="rotated" type="saturate" values="1" result="sat"/>',
  '      <feComponentTransfer in="sat" type="linear" slope="1" intercept="0" result="bright"/>',
  '      <feComponentTransfer in="bright" type="linear" slope="1" intercept="0" result="contrast"/>',
  '    </filter>',
  '  </defs>',
  '</svg>',
  '<script src="../lib/svg-grade.client.js" defer></script>',
].join('\n');
const TAG = MARKER + '\n' + SVG_DEFS;

// Match a function call like blur( ... ) or hue-rotate( ... deg ).
// Supports nested parens up to one level (e.g. translate(...)) — the
// CSS filter primitives used here don't nest, but the existing precedent
// (_fx-grade-inject.js) handles the same shape and we want to stay
// consistent.
const CHAIN_RE = /([A-Za-z-]+)\(([^()]*(?:\([^()]*\)[^()]*)*)\)/g;

const dry = process.argv.includes('--dry-run');
let changed = 0, skipped = 0;

for (const file of fs.readdirSync(DIR).filter((f) => f.endsWith('.html')).sort()) {
  const fullPath = path.join(DIR, file);
  let src = fs.readFileSync(fullPath, 'utf8');

  // Find every `…ctx.filter = \`…\`;` line. The receiver counts as the
  // page's main grade when it is `ctx`, `X.ctx`, or `_ctx` (the alias
  // declared as `const _ctx = c || ctx;` on smoke / watercolor / etc.).
  const filterLines = [...src.matchAll(/^ *([\w.$]+)\.filter = `([^`]+)`;/gm)];
  const alias = /_ctx = c \|\| ctx/.test(src);
  const isMain = (recv) => /(^|\.)ctx$/.test(recv) || (alias && /^_ctx$/.test(recv));
  const plain = filterLines.filter((m) => isMain(m[1]));

  if (plain.length === 0) {
    skipped++;
    continue;
  }

  // Skip variants whose only main-ctx chain is the 'none' reset (e.g.
  // film/void/watercolor). The GPU path covers them already.
  const live = plain.filter((m) => m[2].trim() !== 'none');
  if (live.length === 0) {
    skipped++;
    continue;
  }

  // The SVG-grade migration targets ONE audio-driven chain per page.
  // Multiple live chains need a per-layer decision (and the SVG filter
  // graph is single-purpose — it can host only one filter per overlay).
  if (live.length > 1) {
    console.log(`skip: ${file} (${live.length} live chain(s) — per-layer decision)`);
    skipped++;
    continue;
  }

  const main = live[0];
  const chain = main[2];
  // The chain must include at least the audio-driven primitives we
  // can map onto the SVG filter graph. Variants that only do a static
  // blur or sepia (no audio reactivity) belong on the GPU path; we
  // skip them here.
  const has = (name) => chain.includes(name + '(');
  if (!has('blur') || !has('sepia') || !has('hue-rotate') ||
      !has('brightness') || !has('contrast') || !has('saturate')) {
    console.log(`skip: ${file} (chain missing required primitives — GPU path covers it)`);
    skipped++;
    continue;
  }

  // Extract the per-filter argument as a JS expression. The raw text
  // inside the parens is a CSS-filter primitive value — typically a
  // number, an arithmetic, or a template-literal interpolation like
  // `${A.feat.mid*8 + 6}`. Strip the `${…}` wrapper so the result is
  // a JS expression that can be passed to setFilter() at the
  // call-site. Also strip a trailing 'deg' / 'px' unit; the SVG
  // primitives are unitless.
  const args = { blur: '0', sepia: '0', hue: '0', brightness: '1', contrast: '1', saturate: '1' };
  let seen = 0;
  for (const m of chain.matchAll(CHAIN_RE)) {
    const fn = m[1].toLowerCase();
    let raw = m[2].trim()
      .replace(/deg$/, '')
      .replace(/px$/, '')
      .trim();
    // Unwrap a single `${…}` template substitution if present. The
    // raw is the *contents* between `${` and `}` — those characters
    // are JS syntax inside a backtick string but invalid outside it.
    const tmpl = raw.match(/^\$\{([\s\S]+)\}$/);
    if (tmpl) raw = tmpl[1].trim();
    const key = fn === 'hue-rotate' ? 'hue' : fn;
    if (!(key in args)) continue;
    args[key] = raw;
    seen++;
  }
  if (seen < 6) {
    console.log(`skip: ${file} (only ${seen}/6 recognised filters in chain)`);
    skipped++;
    continue;
  }

  // The replacement line preserves the original audio expressions:
  //   _ctx.filter = `blur(${…}px) sepia(${…}) …`;
  // becomes
  //   if (window.SWR_SVG_GRADE) window.SWR_SVG_GRADE.setFilter(blur, sepia, hue, bright, contrast, sat);
  // with each … stripped of units (deg / px) and the trailing
  // backtick expression unwrapped.
  const indent = main[0].match(/^ */)[0];
  const call =
    indent + '// SVG grade (lib/svg-grade.client.js) — this chain used to run as a per-frame\n'
    + indent + '// 2D ctx.filter, a full-frame software pass. Same maths, SVG <filter> graph\n'
    + indent + '// composited on an overlay above #render.\n'
    + indent + 'if (window.SWR_SVG_GRADE && window.SWR_SVG_GRADE.setFilter) {\n'
    + indent + '  window.SWR_SVG_GRADE.setFilter(\n'
    + indent + '    ' + args.blur + ',\n'
    + indent + '    ' + args.sepia + ',\n'
    + indent + '    ' + args.hue + ',\n'
    + indent + '    ' + args.brightness + ',\n'
    + indent + '    ' + args.contrast + ',\n'
    + indent + '    ' + args.saturate + '\n'
    + indent + '  );\n'
    + indent + '}';
  src = src.replace(main[0], call);

  // Remove the immediately-following `_ctx.filter = 'none';` reset if
  // it's the next non-blank line. Without this the page would still
  // try to reset the (now absent) ctx filter every frame.
  const noneResetRe = new RegExp(
    '^' + indent + '_?ctx\\.filter = \'none\';\\s*\\n',
    'm'
  );
  src = src.replace(noneResetRe, '');

  // Inject the SVG defs + script tag at the end of <body>. Marker-
  // guarded so a re-run is a no-op.
  if (!src.includes(MARKER)) {
    const at = src.lastIndexOf('</body>');
    if (at === -1) { console.log(`skip: ${file} (no </body>)`); skipped++; continue; }
    src = src.slice(0, at) + TAG + '\n' + src.slice(at);
  }

  if (!dry) fs.writeFileSync(fullPath, src);
  changed++;
  console.log(`svg-grade: ${file}  setFilter(${args.blur}, ${args.sepia}, ${args.hue}, ${args.brightness}, ${args.contrast}, ${args.saturate})`);
}

console.log(`\n${dry ? '[dry-run] ' : ''}${changed} page(s) migrated, ${skipped} skipped`);