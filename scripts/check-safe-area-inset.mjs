#!/usr/bin/env node
// scripts/check-safe-area-inset.mjs  -  iPhone safe-area + overscroll gate (P2.3).
//
// Two properties, and they pull in opposite directions, which is the whole
// reason this needs a gate rather than a find-and-replace:
//
//   1. env(safe-area-inset-*) is inert without viewport-fit=cover. Every one of
//      these pages is a full-bleed dark app surface aimed at iPhone, and
//      engine.html carried `padding-top: env(safe-area-inset-top)` for months
//      while its viewport meta said nothing but `width=device-width,
//      initial-scale=1`. iOS resolved every inset to 0px, so the transport
//      header sat under the Dynamic Island and the global footer sat under the
//      home indicator, and the CSS looked correct the whole time.
//
//   2. overscroll-behavior: none is NOT a site-wide fix. Safari's rubber-band
//      overscroll triggers a full reload, which tears down the AudioContext and
//      every in-flight composition state mid-render  -  genuinely fatal on the
//      engine. But on a page that scrolls naturally it just deletes the bounce
//      the reader expects. So the gate asserts both directions: fixed-chrome
//      pages MUST carry it, scrolling pages MUST NOT.
//
// The fixed/scrolling classification is DERIVED from each file, not hardcoded,
// so the moment someone bolts a fixed overlay onto a scrolling page the gate
// starts demanding overscroll-behavior on it. See hasFixedChrome() below for
// exactly what counts as fixed chrome.
//
// The third failure mode this catches is subtler than either: putting the
// padding on an element that the `position: fixed` chrome escapes from.
// Padding body does nothing for a fixed child, because fixed resolves against
// the viewport. composer.html had all four env() paddings on body and a
// position:fixed .stage-frame shell that ignored every one of them. Hence the
// shell-padded assertion below.
//
// That assertion has to read the fixed chrome out of BOTH places a page can
// declare it. The 27 renderer variants under versions/ are the reason: their
// entire <style> can be inset-correct and the page still be broken, because the
// two overlays that need the inset - the mood reference and the automix debug
// panel - carry their whole declaration in an inline style="" attribute, while
// everything the <style> block does position is a full-bleed `inset: 0` overlay
// that is CORRECTLY inset-unaware because covering the notch is its job. A
// <style>-only reader sees nothing wrong and the regression walks straight
// through. See fixedShells().
//
// Run: node scripts/check-safe-area-inset.mjs [--verbose] [--self-test]

import fs from 'node:fs';
import path from 'node:path';

const VERBOSE = process.argv.includes('--verbose');
const ROOT = path.resolve(import.meta.dirname, '..');

// The surfaces P2.3 names. Each is a different CASE on purpose, so the gate
// cannot pass on a blank file or on one shape only. Three shapes today:
//
//   shell   - viewport-locked app surface. engine.html and composer.html are
//             this: a position:fixed or position:absolute shell that pads
//             itself, with the insets on that shell rather than on body.
//   doc     - a scrolling document. record.html, tour.html and
//             shortcuts-movie.html: no fixed chrome, so overscroll-behavior is
//             FORBIDDEN here and asserted absent. They need bottom/left/right,
//             never top (their top chrome is the shared sticky nav, which body
//             padding cannot reach).
//   variant - a fullscreen renderer variant: a #app grid pinned to 100vh plus
//             two or three small position:fixed overlays (the mood reference,
//             the automix debug panel) whose only inset-aware rule is an inline
//             style="" attribute. Structurally the tightest case in the file -
//             its whole <style> can be inset-correct and it still fails if the
//             overlays are not, because the overlays are what a reader's thumb
//             actually lands on near the home indicator.
//
// The three document pages under versions/ are deliberately NOT here: they are
// case `doc`, and they mount the shared nav + footer that 112 other pages
// mount. Their top chrome is shared chrome, so their fix belongs in
// lib/components.css, not in four page edits - see the note in the run() output.
const PAGES = [
  { file: 'engine.html',          note: 'engine shell: 19 position:fixed overlays, viewport-locked' },
  { file: 'composer.html',        note: 'composer shell: position:fixed .stage-frame grid shell' },
  { file: 'swr-app.html',         note: 'app shell: 100dvh flex, viewport-locked, 4 fixed overlays' },
  { file: 'record.html',          note: 'recorder: scrolling document, safe-area only' },
  { file: 'tour.html',            note: 'tour: scrolling document, sticky shared nav' },
  { file: 'shortcuts-movie.html', note: 'shortcuts movie: scrolling document, sticky shared nav' },

  // The fullscreen renderer variants. One line each: every one of them is a
  // #app grid at height:100vh under html/body overflow:hidden, with the mood
  // reference and/or the automix debug panel fixed against the viewport.
  ...[
    'aurora', 'bachdrop', 'baroque', 'chrome', 'clean', 'collage',
    'echo-manifold', 'eclipse', 'film', 'fractal', 'glitch', 'grid',
    'hallucination', 'kraft', 'mosaic', 'music_video', 'music_video_mtv',
    'neon', 'phosphor', 'pulse', 'simple', 'smoke', 'spectrum', 'tape',
    'typography', 'void', 'watercolor',
  ].map((n) => ({ file: `versions/${n}.html`, note: 'renderer variant: 100vh #app grid + fixed overlays' })),
];

const SIDES = ['top', 'right', 'bottom', 'left'];

const failures = [];
const notes = [];
const fail = (file, msg) => failures.push(`${file}: ${msg}`);
const note = (msg) => notes.push(msg);

// ── predicates ────────────────────────────────────────────────────────────────

// Strip /* ... */ comments out of <style> blocks before any CSS predicate runs.
// engine.html's and record.html's prose both mention properties they do not
// set - record.html's own comment says "nothing is position:fixed", and a
// regex reading that classifies a scrolling document as a fixed-chrome shell.
// A comment must never be able to decide a layout question; AGENTS.md calls
// this exact failure mode out for check:doc-truth, where prose that drifts from
// code is a tracked defect. Inline style="" attributes in markup are real
// styles and are deliberately left alone.
function stripStyleComments(html) {
  return html.replace(/<style\b[^>]*>([\s\S]*?)<\/style>/gi, (_, css) =>
    `<style>${css.replace(/\/\*[\s\S]*?\*\//g, '')}</style>`);
}

// A page is a fixed-chrome page when it positions something against the
// viewport or locks the root scroller. Both signals are real:
//   position:fixed     -  an overlay or bar the reader cannot scroll away from
//   root overflow:hidden  -  html/body, so the page never scrolls at all
// A `position:absolute` alone does NOT count: shortcuts-movie.html has five of
// them, every one inside a position:relative stage, and it is a scrolling
// document. Counting those would have forced overscroll-behavior onto a page
// that has no reason to have it.
function hasFixedChrome(html) {
  if (/position:\s*fixed/.test(html)) return true;
  const rootBlock = html.match(/(?:^|[}\s])(?:html\s*,\s*body|html|body)\s*\{([^}]*)\}/);
  return !!rootBlock && /overflow:\s*hidden/.test(rootBlock[1]);
}

const viewportMeta = (html) =>
  (html.match(/<meta\s+name="viewport"\s+content="([^"]*)"/i) || [, ''])[1];

// Declared: the inset is introduced via env() WITH its 0px fallback, which is
// what keeps desktop and every non-notched browser pixel-identical.
const declaresInset = (html, side) =>
  new RegExp(`env\\(\\s*safe-area-inset-${side}\\s*,`).test(html);

// Applied: a padding declaration is fed by that inset, either through the
// --safe-* token indirection or directly. The `padding` shorthand counts as
// well as `padding-<side>`, because a 4-value composed shorthand is the most
// readable way to write exactly this - swr-app.html's onboarding modal and
// versions/simple.html's brand modal are both one declaration - and a gate that
// could not see it would invite someone to "simplify" a longhand back into a
// shorthand and get a false failure.
//
// The value may also be COMPOSED rather than bare. `[^;}]*?` cannot cross a `;`
// or a `}`, so the token still has to live in this one declaration - but it may
// sit inside max()/calc() alongside the padding the element already had. That
// is not a looser reading, it is how every inset is actually applied once a
// page has real spacing to preserve: versions/echo-manifold.html's scroll pane
// is `calc(24px + var(--safe-bottom))`. Requiring a bare var() would have
// called that page unpatched and pushed the fix back to a bare env(), which is
// the composition this whole gate exists to prevent.
//
// Note `padding` (bare) does NOT match inside `padding-top`, because `\\s*:`
// cannot match the `-top` - so the two forms cannot be confused for each other.
const appliedRe = (side) => new RegExp(
  `padding(?:-${side})?\\s*:\\s*[^;}]*?(?:var\\(\\s*--safe-${side}\\s*\\)|env\\(\\s*safe-area-inset-${side}\\b)`, 'i');

const appliesInset = (html, side) => appliedRe(side).test(html);
const appliedSides = (html) => SIDES.filter(s => appliesInset(html, s));

// overscroll-behavior: none has to be on the root scroller (html or body);
// #app is accepted because engine.html's grid was the page's de-facto root
// before it moved.
const rootOverscrollNone = (html) =>
  /(?:^|[,{}\s])(?:html\s*,\s*body|html|body|#app)\s*\{[^}]*overscroll-behavior:\s*none/.test(html);

// The fixed viewport-anchored shells a page owns, as {sel, block} pairs.
//
// Two sources, and both are real:
//
//   a) a `position: fixed` rule inside a <style> block
//   b) a `position:fixed` in an element's inline style="" attribute, where the
//      attribute IS the whole rule block
//
// (b) is not a nicety. The fullscreen renderer variants declare the only two
// overlays that genuinely need the inset that way and nothing else:
// neon.html's #mood-overlay and the #automix-debug-panel on all 24 variants
// that carry one are both bare `style="position:fixed; top:16px; ..."`. A gate
// that read <style> alone would see nothing but the full-bleed #swr-start /
// .drop-zone overlays - which are correctly inset-unaware, because they are
// meant to cover the notch - and would call a fully patched variant broken.
// Tag-level scan, so it does not care whether id comes before style.
function fixedShells(html) {
  const out = [];
  const re = /([.#][A-Za-z0-9_-]+)\s*\{[^{}]*position:\s*fixed\s*;/g;
  let m;
  while ((m = re.exec(html))) out.push({ sel: m[1], block: blockFor(html, m[1]) });
  for (const tag of html.match(/<[a-z][a-z0-9-]*\b[^>]*>/gi) || []) {
    const id = (tag.match(/\bid="([^"]+)"/i) || [])[1];
    const st = (tag.match(/\bstyle="([^"]*)"/i) || [])[1];
    if (id && st && /position:\s*fixed/.test(st)) out.push({ sel: `#${id}`, block: st });
  }
  return out;
}

function blockFor(html, selector) {
  const i = html.indexOf(selector);
  if (i === -1) return null;
  const open = html.indexOf('{', i);
  if (open === -1) return null;
  let depth = 0;
  for (let j = open; j < html.length; j++) {
    if (html[j] === '{') depth++;
    else if (html[j] === '}') { depth--; if (depth === 0) return html.slice(open, j); }
  }
  return null;
}

// Which of `sides` are applied inside this one rule block.
const sidesInBlock = (block, sides) => sides.filter(s => appliedRe(s).test(block));

// Does this one rule keep itself clear of the notch / home indicator, either by
// padding inside its own box or by folding the inset into its placement?
const isInsetAware = (block) =>
  SIDES.some(s => appliedRe(s).test(block)) ||
  /(?:^|[;{\s])(?:top|right|bottom|left)\s*:\s*[^;}]*?(?:var\(\s*--safe-|env\(\s*safe-area-inset-)/.test(block);

// ── the rule, factored out so the self-test exercises the real thing ─────────

// Returns a list of {rule, msg}. Empty means the page is correct.
function findProblems(html, { file = 'page' } = {}) {
  const out = [];
  const bad = (rule, msg) => out.push({ file, rule, msg });

  // (1) viewport-fit=cover. Without it every assertion below is theatre.
  const vp = viewportMeta(html);
  if (!vp) bad('viewport-fit', 'no <meta name="viewport">');
  else if (!/viewport-fit\s*=\s*cover/.test(vp)) {
    bad('viewport-fit', `viewport meta lacks viewport-fit=cover, so every env(safe-area-inset-*) below resolves to 0px  -  got: "${vp}"`);
  }

  const fixed = hasFixedChrome(html);
  const shell = fixed ? 'fixed chrome' : 'scrolling document';

  // (2) All four insets declared WITH their fallback.
  for (const side of SIDES) {
    if (!declaresInset(html, side)) {
      bad('declare', `no env(safe-area-inset-${side}, <fallback>) declared  -  the 0px fallback is what keeps desktop unchanged`);
    }
  }

  // (3) Applied where it matters. Fixed-chrome pages need top+bottom (the two
  //     that collide with the notch and the home indicator). Scrolling pages
  //     need bottom+left+right: the home indicator overlaps the end of the
  //     document, and the landscape insets overlap the rounded corners. Top is
  //     deliberately NOT required of a scrolling page  -  its top chrome is the
  //     shared sticky nav (lib/components.css .swr-nav), which body padding
  //     cannot reach because sticky resolves against the scrollport. That is a
  //     shared-chrome fix on 112 pages, not a page fix.
  const applied = appliedSides(html);
  const need = fixed ? ['top', 'bottom'] : ['bottom', 'left', 'right'];
  for (const side of need) {
    if (!appliesInset(html, side)) {
      bad('apply', `${shell}: nothing applies padding-${side} from a safe-area inset (expected e.g. \`padding-${side}: var(--safe-${side})\`); applied: ${applied.join('/') || 'none'}`);
    }
  }

  // (4) overscroll-behavior, asserted in BOTH directions.
  const noOverscroll = rootOverscrollNone(html);
  if (fixed && !noOverscroll) {
    bad('overscroll', `${shell}: html or body has no \`overscroll-behavior: none\`  -  Safari's rubber-band overscroll reloads the page, which tears down the AudioContext and every in-flight composition state mid-render`);
  }
  if (!fixed && noOverscroll) {
    bad('overscroll', `${shell}: sets \`overscroll-behavior: none\` but has no fixed chrome and does scroll  -  that deletes the rubber-band a reader expects. Remove it, or make the shell genuinely viewport-locked`);
  }

  // (5) The composer-shaped trap: fixed chrome that is not inset-aware at all,
  //     while the page's safe-area padding sits exclusively on body. body
  //     padding is inert for a fixed child, so the page looks fixed and behaves
  //     unfixed. "Inset-aware" covers the two legitimate ways to do it: padding
  //     inside the fixed element's own rule (composer.html's .stage-frame), or
  //     an offset that folds the inset into its placement (engine.html's bottom
  //     sheets, `bottom: max(24px, var(--safe-bottom))`). A full-bleed
  //     `inset:0` overlay is not inset-aware and does not need to be - it is
  //     meant to cover the notch - but then some OTHER fixed element must be.
  if (fixed) {
    const shells = fixedShells(html);
    const aware = shells.filter(({ block }) => block && isInsetAware(block));
    if (shells.length && applied.length && !aware.length) {
      bad('shell-padding', `safe-area padding is applied only to in-flow elements, but none of the ${shells.length} fixed elements is inset-aware  -  position:fixed resolves against the viewport, so an in-flow padding box never reaches them. Either pad the shell itself or fold the inset into its bottom/right offset`);
    }
  }

  return { problems: out, fixed, applied, noOverscroll };
}

// ── run ───────────────────────────────────────────────────────────────────────

function run() {
  for (const { file } of PAGES) {
    const abs = path.join(ROOT, file);
    if (!fs.existsSync(abs)) { fail(file, 'file not found'); continue; }
    const html = fs.readFileSync(abs, 'utf8');
    const { problems, fixed, applied, noOverscroll } = findProblems(stripStyleComments(html), { file });
    for (const p of problems) fail(p.file, `[${p.rule}] ${p.msg}`);
    note(`${file.padEnd(21)} ${(fixed ? 'fixed chrome' : 'scrolling doc').padEnd(14)} applied: ${(applied.join('/') || 'none').padEnd(20)}${noOverscroll ? 'overscroll:none' : 'overscroll:natural'}`);
  }

  console.log(`${PAGES.length} pages checked`);
  if (VERBOSE) for (const n of notes) console.log('  · ' + n);
  if (failures.length) {
    console.log(`✗ ${failures.length} problem(s)`);
    for (const f of failures) console.log('  ✗ ' + f);
    process.exit(1);
  }
  console.log('✓ all safe-area + overscroll checks passed');
}

// ── self-test ─────────────────────────────────────────────────────────────────
// A permanently green gate that can no longer detect anything is worse than no
// gate. These synthetic pages each violate exactly one rule (or a known count of
// them); every one must be caught, and the clean fixtures must stay quiet.
function selfTest() {
  const TOKENS = `:root{--safe-top:env(safe-area-inset-top,0px);--safe-bottom:env(safe-area-inset-bottom,0px);`
    + `--safe-left:env(safe-area-inset-left,0px);--safe-right:env(safe-area-inset-right,0px)}`;
  const VP_COVER = `<meta name="viewport" content="width=device-width, viewport-fit=cover">`;
  const SHELL = `.shell{position:fixed;inset:0;padding-top:var(--safe-top);padding-bottom:var(--safe-bottom);`
    + `padding-left:var(--safe-left);padding-right:var(--safe-right)}`;

  // A correct viewport-locked shell: insets declared, applied ON THE SHELL,
  // overscroll killed at the root.
  const CLEAN_SHELL = `${VP_COVER}<style>${TOKENS}body{padding-top:var(--safe-top);padding-bottom:var(--safe-bottom);padding-left:var(--safe-left);padding-right:var(--safe-right);overscroll-behavior:none}${SHELL}</style>`;
  // A correct scrolling document: bottom/left/right applied, no overscroll, no
  // fixed anything (the stage uses position:relative like the real pages).
  const CLEAN_DOC = `${VP_COVER}<style>${TOKENS}body{padding-bottom:var(--safe-bottom);padding-left:var(--safe-left);padding-right:var(--safe-right)}`
    + `.stage{position:relative;overflow:hidden}.stage canvas{position:absolute;inset:0}</style>`;
  // A shell that folds the inset into its offset instead of padding itself  - 
  // engine.html's bottom sheets. Also carries the comment that used to fool
  // the classifier: it says "position:fixed" while the block below does not
  // set it anywhere the reader would expect.
  const CLEAN_SHEET = `${VP_COVER}<style>${TOKENS}body{padding-top:var(--safe-top);padding-bottom:var(--safe-bottom);overscroll-behavior:none}`
    + `/* not a position:fixed element */`
    + `.sheet{position:fixed;left:50%;bottom:max(24px,var(--safe-bottom));transform:translateX(-50%)}</style>`;

  // THIRD SHAPE: a fullscreen renderer variant (versions/neon.html). A #app grid
  // pinned to 100vh under html/body overflow:hidden, plus exactly two fixed
  // overlays - one full-bleed, correctly inset-unaware because it is meant to
  // cover the notch, and one small viewport-anchored overlay whose entire
  // declaration lives in an inline style="" attribute.
  //
  // Modelled separately because it is the tightest case in the file. Its
  // <style> can be completely inset-correct and the page still be broken,
  // because the overlays are what a thumb actually lands on near the home
  // indicator - and a gate that read <style> alone would call the
  // hardcoded-px variant CLEAN and let the regression straight through.
  const VARIANT_GRID = `#app{display:grid;grid-template-rows:44px 1fr 36px;height:100vh}`
    + `#app{padding-top:var(--safe-top);padding-bottom:var(--safe-bottom);padding-left:var(--safe-left);padding-right:var(--safe-right)}`
    + `#swr-start{position:fixed;inset:0;z-index:10000}`;
  const mood = (top, right) =>
    `<img id="mood-overlay" alt="mood reference" style="position:fixed;top:${top};right:${right};width:160px;z-index:50;display:none;">`;
  const MOOD_SAFE = mood('max(16px, var(--safe-top))', 'max(16px, var(--safe-right))');
  const CLEAN_VARIANT = `${VP_COVER}<style>${TOKENS}html,body{margin:0;height:100%;overflow:hidden;overscroll-behavior:none}${VARIANT_GRID}</style>`
    + MOOD_SAFE;

  const cases = [
    { name: 'clean shell', html: CLEAN_SHELL, expect: 0 },
    { name: 'clean scrolling document', html: CLEAN_DOC, expect: 0 },
    { name: 'clean fixed sheet, inset in offset', html: CLEAN_SHEET, expect: 0 },
    { name: 'clean renderer variant', html: CLEAN_VARIANT, expect: 0 },
    { name: 'comment cannot fake fixed chrome', html: CLEAN_DOC.replace('.stage{', '/* position:fixed;inset:0 */.stage{'), expect: 0 },
    { name: 'no viewport-fit=cover', html: CLEAN_SHELL.replace(' viewport-fit=cover', ''), expect: 1, rule: 'viewport-fit' },
    { name: 'variant without viewport-fit=cover', html: CLEAN_VARIANT.replace(' viewport-fit=cover', ''), expect: 1, rule: 'viewport-fit' },
    { name: 'inset token missing', html: CLEAN_DOC.replace('--safe-bottom:env(safe-area-inset-bottom,0px);', ''), expect: 1, rule: 'declare' },
    { name: 'env() with no fallback', html: CLEAN_DOC.replace('env(safe-area-inset-bottom,0px)', 'env(safe-area-inset-bottom)'), expect: 1, rule: 'declare' },
    { name: 'shell without overscroll', html: CLEAN_SHELL.replace(';overscroll-behavior:none', ''), expect: 1, rule: 'overscroll' },
    { name: 'scrolling doc with overscroll', html: CLEAN_DOC.replace('padding-right:var(--safe-right)', 'padding-right:var(--safe-right);overscroll-behavior:none'), expect: 1, rule: 'overscroll' },
    { name: 'padding only on body, fixed shell', html: CLEAN_SHELL.replace(SHELL, '.shell{position:fixed;inset:0}'), expect: 1, rule: 'shell-padding' },
    // The exact defect P2.3 fixes on versions/neon.html:512 - the whole
    // <style> is correct and only the inline overlay is wrong.
    { name: 'variant overlay at hardcoded px', html: CLEAN_VARIANT.replace(MOOD_SAFE, mood('16px', '16px')), expect: 1, rule: 'shell-padding' },
    // Same page with the overlay removed: the <style> is still perfect, and the
    // page is still wrong, because nothing inset-aware is left against the
    // viewport. This is the assertion that stops a blank file passing.
    { name: 'variant with no inset-aware overlay', html: CLEAN_VARIANT.replace(MOOD_SAFE, ''), expect: 1, rule: 'shell-padding' },
    // Composition is application: a padding that keeps its own 24px and adds
    // the inset on top (versions/echo-manifold.html) counts as applied.
    { name: 'composed inset in calc()', html: CLEAN_DOC.replace('padding-bottom:var(--safe-bottom);', 'padding-bottom:calc(24px + var(--safe-bottom));'), expect: 0 },
    { name: 'padding shorthand counts', html: CLEAN_DOC.replace('padding-bottom:var(--safe-bottom);', 'padding:max(24px, var(--safe-top)) max(24px, var(--safe-right)) max(24px, var(--safe-bottom)) max(24px, var(--safe-left));'), expect: 0 },
    { name: 'doc with no bottom inset applied', html: CLEAN_DOC.replace('padding-bottom:var(--safe-bottom);', ''), expect: 1, rule: 'apply' },
    { name: 'shell with no top inset applied', html: CLEAN_SHELL.replaceAll('padding-top:var(--safe-top);', ''), expect: 1, rule: 'apply' },
  ];

  let bad = 0;
  for (const c of cases) {
    const { problems } = findProblems(stripStyleComments(c.html));
    const rules = new Set(problems.map(p => `${p.rule}`));
    const ok = problems.length === c.expect && (!c.rule || rules.has(c.rule));
    if (!ok) bad++;
    const got = problems.map(p => `${p.rule}`).join(',') || 'none';
    console.log(`  ${ok ? '✓' : '✗'} ${c.name.padEnd(34)} ${String(problems.length).padStart(2)} finding(s) [${got}] expected ${c.expect}${c.rule ? ` via ${c.rule}` : ''}`);
  }
  if (bad) { console.log(`✗ self-test: ${bad} of ${cases.length} cases wrong`); process.exit(1); }
  console.log(`✓ self-test: ${cases.length} cases behave as specified`);
}

if (process.argv.includes('--self-test')) selfTest();
else run();