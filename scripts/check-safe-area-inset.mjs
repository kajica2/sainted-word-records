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
// The fourth is the same trap for position:absolute, and it is the only one
// that cannot be answered by reading declarations. An absolute overlay is
// placed by its own offsets against the PADDING box of its nearest POSITIONED
// ancestor - so padding a box does not reach it, and neither does positioning
// that same box, because the padding is inside the box whose edge would have to
// move. Every rule above reads what a page SAYS; this one has to know where a
// box is placed FROM. Hence the element tree, hence rule (6). See
// escapingAbsolutes() for the measured numbers.
//
// Run: node scripts/check-safe-area-inset.mjs [--verbose] [--self-test]

import fs from 'node:fs';
import path from 'node:path';

const VERBOSE = process.argv.includes('--verbose');
const ROOT = path.resolve(import.meta.dirname, '..');

// The surfaces P2.3 names. Each is a different CASE on purpose, so the gate
// cannot pass on a blank file or on one shape only. Four shapes today:
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
//   anchored - the same variant, plus a position:absolute overlay that escapes
//             the grid entirely and is laid out from the viewport. This is the
//             shape aaf7e39d left behind: correct grid chrome, correct fixed
//             overlays, and an absolute overlay still sitting under the notch.
//             See escapingAbsolutes() for why padding on the grid cannot reach it and
//             why position:relative on the grid would not either.
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

// ── the fourth shape: absolute overlays the page's own padding cannot reach ─
//
// Rule (5) below is about position:fixed. position:absolute carries the same
// trap with a quieter symptom, and it is what aaf7e39d left behind.
//
// The padding P2.3 puts on #app insets #app's grid TRACKS, and it works: the
// transport header and the footer bar both clear the notch. An absolutely
// positioned descendant is a different mechanism. It is placed by its OWN
// offsets, against the PADDING box of its nearest POSITIONED ancestor, and
// against the initial containing block (the viewport) when it has none. #app is
// position:static, so on the renderer variants it captures nothing: an absolute
// overlay with no intermediate positioned box is laid out from the SCREEN EDGE,
// which is exactly where the Dynamic Island and the home indicator are.
// versions/neon.html:549's #hook-panel is the measured case - `bottom:48px`
// off the viewport bottom, while the 36px footer track it was written to sit
// above is correctly inset.
//
// The tempting one-word fix is `position: relative` on #app, and it does NOT
// work, for a reason worth writing down precisely because it looks right: the
// containing block of an absolutely positioned element is the PADDING box of
// its positioned ancestor. The padding lives INSIDE that box, so padding #app
// and then positioning #app leaves the containing block the same size it already
// was - #app is 100vh with no border on all 26 grid variants, so its padding box
// IS the viewport box. `bottom:48px` resolves to the same 48px either way.
// Padding only ever reaches a box's CONTENT, which for a grid container means
// the tracks. That is the whole reason P2.3's fix works, and the whole reason
// it cannot reach this overlay. The inset has to go in the overlay's own
// offsets, which is what rule (6) demands.
//
// Why the tree, when every other predicate here is a regex: this question is
// about ANCESTRY ("is this element inside a box that establishes a containing
// block?"), and no regex over the page text can answer it. The parser below is
// deliberately dumb - nesting, id, class and inline style="" only - and it
// FAILS CLOSED: an ancestor whose declarations cannot be resolved counts as
// establishing nothing, so a gap in the parser produces a visible failure on a
// page instead of a silent pass on one. The measured escape set is 6 elements
// across the 33 gated pages, so a false failure is a one-line edit.
const VOID_TAGS = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input',
  'link', 'meta', 'param', 'source', 'track', 'wbr']);
// Raw-text elements: their content is not markup, and a `</div>` inside a
// string literal would otherwise close an element that is still open.
const RAW_TEXT_TAGS = new Set(['script', 'style', 'textarea', 'title']);

function elementTree(html) {
  const root = { tag: '#root', attrs: {}, children: [], parent: null };
  let cur = root;
  let i = 0;
  while (i < html.length) {
    const lt = html.indexOf('<', i);
    if (lt === -1) break;
    if (html.startsWith('<!--', lt)) { i = html.indexOf('-->', lt) + 3; continue; }
    if (html.startsWith('<!', lt)) { i = html.indexOf('>', lt) + 1; continue; }
    if (html.startsWith('</', lt)) {
      const gt = html.indexOf('>', lt);
      let n = cur;
      const want = html.slice(lt + 2, gt).trim().toLowerCase();
      while (n && n.tag !== want) n = n.parent;
      cur = n ? n.parent : cur;
      i = gt + 1;
      continue;
    }
    const gt = html.indexOf('>', lt);
    if (gt === -1) break;
    let inner = html.slice(lt + 1, gt);
    const selfClose = inner.endsWith('/');
    if (selfClose) inner = inner.slice(0, -1);
    const m = inner.match(/^([A-Za-z][A-Za-z0-9:-]*)/);
    if (!m) { i = gt + 1; continue; }
    const tag = m[1].toLowerCase();
    const attrs = {};
    for (const a of inner.matchAll(/([A-Za-z_:][-A-Za-z0-9_:.]*)\s*=\s*("([^"]*)"|'([^']*)'|([^\s"'>]+))/g)) {
      attrs[a[1].toLowerCase()] = a[3] ?? a[4] ?? a[5] ?? '';
    }
    const node = { tag, attrs, children: [], parent: cur };
    cur.children.push(node);
    i = gt + 1;
    if (VOID_TAGS.has(tag) || selfClose) continue;
    cur = node;
    if (RAW_TEXT_TAGS.has(tag)) {
      const close = html.toLowerCase().indexOf(`</${tag}`, i);
      node.text = html.slice(i, close === -1 ? html.length : close);
      i = close === -1 ? html.length : html.indexOf('>', close) + 1;
      cur = node.parent;
    }
  }
  return root;
}

function eachElement(node, fn) {
  for (const c of node.children) { fn(c); eachElement(c, fn); }
}

function decls(s) {
  const out = {};
  for (const part of String(s || '').split(';')) {
    const c = part.indexOf(':');
    if (c === -1) continue;
    out[part.slice(0, c).trim().toLowerCase()] = part.slice(c + 1).trim();
  }
  return out;
}

// The <style> rules a page declares, as {selectors, declarations}. Comments are
// stripped first, by the same helper every other predicate uses - a commented
// `position:relative` must not be able to claim it is an ancestor's box.
function styleRules(tree) {
  const rules = [];
  eachElement(tree, (n) => {
    if (n.tag !== 'style' || typeof n.text !== 'string') return;
    const css = stripStyleComments(`<style>${n.text}</style>`).replace(/<\/?style>/g, '');
    for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      const declarations = decls(m[2]);
      for (const sel of m[1].split(',').map((s) => s.trim()).filter(Boolean)) {
        rules.push({ sel, declarations });
      }
    }
  });
  return rules;
}

// Does `sel` name this element? Supports the three forms these pages actually
// use - `tag`, `.class`, `#id`, any combination of them, and descendant
// combinators between them. A selector it cannot parse returns false, which
// fails closed (see above).
function selMatches(node, sel) {
  const parts = sel.trim().split(/\s+/);
  let node2 = node;
  for (let p = parts.length - 1; p >= 0; p--) {
    const simple = parts[p].match(/^([a-z0-9-]*)((?:[.#][A-Za-z0-9_-]+)*)$/i);
    if (!simple || !node2) return false;
    const [, tag, rest] = simple;
    if (tag && node2.tag !== tag.toLowerCase()) return false;
    for (const tok of rest.match(/[.#][A-Za-z0-9_-]+/g) || []) {
      if (tok[0] === '#') { if (node2.attrs.id !== tok.slice(1)) return false; }
      else if (!(node2.attrs.class || '').split(/\s+/).includes(tok.slice(1))) return false;
    }
    if (p > 0) node2 = node2.parent;
  }
  return true;
}

// Every declaration that applies to this element, as a `prop: value;` string -
// the same shape isInsetAware() and appliedRe() already read, so the new rule
// reuses the existing predicates rather than restating them.
//
// The cascade is deliberately not computed. "Does any rule naming this element
// establish a containing block?" is answerable without one, and an element that
// two rules disagree about is either positioned (and the gate is quiet) or
// explicitly static (handled below), so there is no third case to lose.
function ownDecls(node, rules) {
  const inline = decls(node.attrs.style || '');
  if (inline.position && /^static$/.test(inline.position)) return inline;
  let out = {};
  for (const r of rules) {
    if (!selMatches(node, r.sel)) continue;
    for (const [k, v] of Object.entries(r.declarations)) {
      if (k === 'position' && /^static$/.test(v)) continue;   // never positions anything
      out[k] = v;
    }
  }
  return Object.assign(out, inline);
}

// Does this element establish a containing block for its descendants?
//
// The first four are the CSS 2.1 §10.1 list. transform, filter, perspective and
// will-change also capture position:FIXED descendants - which is why the
// variants' fixed overlays resolve against the viewport today: #app declares
// none of them. `position: relative` does NOT, and that asymmetry is the whole
// content of the comment above.
function establishesContainingBlock(d) {
  if (/^(relative|absolute|fixed|sticky)$/.test((d.position || '').trim())) return true;
  for (const k of ['transform', 'filter', 'backdrop-filter', 'perspective']) {
    if (d[k] && d[k] !== 'none') return true;
  }
  if (d['will-change'] && /transform|filter|perspective/.test(d['will-change'])) return true;
  if (d.contain && /paint|layout|strict|content/.test(d.contain)) return true;
  if (d['content-visibility'] && d['content-visibility'] !== 'visible') return true;
  return false;
}

// A full-bleed overlay is one that is MEANT to cover the notch, so being
// inset-unaware is its job, not its bug: #swr-start, .drop-zone, .swr-load.
const isFullBleed = (declsStr) =>
  /(?:^|[;{\s])inset\s*:\s*0(?:px|%)?\s*(?:;|$)/.test(declsStr) ||
  SIDES.every((s) => new RegExp(`(?:^|[;{\\s])${s}\\s*:\\s*0(?:px|%)?\\s*(?:;|$)`).test(declsStr));

const declsStr = (d) => Object.entries(d).map(([k, v]) => `${k}: ${v};`).join(' ');
const insetOffsetRe = /(?:^|[;{\s])(?:top|right|bottom|left)\s*:\s*[^;}]*?(?:var\(\s*--safe-|env\(\s*safe-area-inset-)/;
const hasInsetPadding = (d) => SIDES.some((s) => appliedRe(s).test(declsStr(d)));

// Every position:absolute overlay inside a page's padded grid that no padding
// can reach. Returned as {name, why}.
//
// The scope is deliberate and it is the difference between a gate that is
// useful and one that cries wolf. An element only counts when there is a PADDED
// ANCESTOR (R) whose padding was supposed to reach it - otherwise it is not
// this rule's business, and the other five rules already own the page. That
// scope is what keeps the measured finding set at 6 elements rather than the 11
// a wider reading produces: engine.html's #basic-mode-ui clip bar and
// swr-app.html's .pricing section are both absolutely-positioned chrome in
// IN-FLOW regions that sit outside the padded shell, and neither is an overlay
// over a fullscreen canvas.
//
// Within that scope the element is clean when ANY of these hold:
//
//   * it folds the inset into its own offsets            (the fix)
//   * it is full-bleed                                    (its job is the notch)
//   * it sits inside a full-bleed ancestor, at any level
//   * its containing block A is a STRICT descendant of R - A's box is inside
//     the padding, so A's padding edge is already clear of the notch. This is
//     the other 95 of the 100 position:absolute elements the 27 renderer
//     variants carry (`section.stage`, `aside`, `footer`, `.relative`, the
//     `#swr-start` start screen), and it is why the escape count is 6 and not
//     100.
//   * A itself is positioned with the inset folded into its offsets
//
// and it FAILS when A is R itself - the `position: relative` trap, named as its
// own finding because it is the fix someone will reach for first.
function escapingAbsolutes(html) {
  const tree = elementTree(html);
  const rules = styleRules(tree);
  const out = [];
  eachElement(tree, (n) => {
    const d = ownDecls(n, rules);
    if ((d.position || '').trim() !== 'absolute') return;
    // Offset-anchored only. An absolute element with no top/right/bottom/left
    // sits at its STATIC position rather than at a screen edge, so no inset
    // applies to its placement: versions/smoke.html's `svg.swr-svg-grade` is
    // exactly this - a 0x0 hidden sprite sheet parked on <body>.
    if (!SIDES.some((s) => d[s] !== undefined)) return;
    const own = declsStr(d);
    if (insetOffsetRe.test(own)) return;
    if (isFullBleed(own)) return;

    let R = null;
    for (let a = n; a; a = a.parent) if (hasInsetPadding(ownDecls(a, rules))) { R = a; break; }
    if (!R) return;

    let A = null;
    for (let a = n.parent; a; a = a.parent) {
      if (establishesContainingBlock(ownDecls(a, rules))) { A = a; break; }
    }
    const name = n.attrs.id ? '#' + n.attrs.id
      : n.tag + ((n.attrs.class || '').trim() ? '.' + (n.attrs.class || '').trim().split(/\s+/)[0] : '');
    const rName = R.attrs.id ? '#' + R.attrs.id
      : R.tag + ((R.attrs.class || '').trim() ? '.' + (R.attrs.class || '').trim().split(/\s+/)[0] : '');

    if (!A) {
      out.push({ name, rName, why: `no positioned ancestor at all, so its containing block is the VIEWPORT and it escapes the safe-area padding on ${rName} entirely` });
      return;
    }
    for (let a = A; a; a = a.parent) if (isFullBleed(declsStr(ownDecls(a, rules)))) return;
    if (A !== R && isDescendant(A, R)) return;
    if (A === R) {
      out.push({ name, rName, why: `its containing block IS ${rName}, the padded element  -  adding \`position: relative\` there does not help, because the containing block of an absolutely positioned element is the PADDING box of its positioned ancestor, and the padding lives inside that box` });
      return;
    }
    if (insetOffsetRe.test(declsStr(ownDecls(A, rules)))) return;
    out.push({ name, rName, why: `its containing block is neither a strict descendant of the padded ${rName} nor inset-aware itself` });
  });
  return out;
}

function isDescendant(node, ancestor) {
  for (let q = node; q; q = q.parent) if (q === ancestor) return true;
  return false;
}

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

  // (6) The same trap for position:absolute, and the only rule in this file
  //     that has to look at a page's ANCESTRY. Everything above reads
  //     declarations; this one has to know whether a box is inside another box,
  //     because that is what decides where an absolutely positioned overlay is
  //     placed from. See escapingAbsolutes() for the full reasoning, including
  //     why `position: relative` on the padded grid is NOT the fix.
  for (const o of escapingAbsolutes(html)) {
    bad('abs-anchor', `${o.name} is position:absolute and ${o.why}. Padding on an in-flow element can only ever reach that element's CONTENT, which for the grid means its TRACKS, so the inset has to go into this overlay's own offsets - e.g. \`bottom: calc(var(--safe-bottom) + 48px)\` for a panel authored to sit above the footer track, or \`max(16px, var(--safe-top))\` for one pinned to an edge`);
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

  // FOURTH SHAPE: the same variant, plus one absolutely positioned overlay
  // inside the padded grid that has no positioned ancestor of its own, so its
  // containing block is the viewport. This is the measured aaf7e39d leftover:
  // correct grid chrome, correct fixed overlays, and #hook-panel still 48px off
  // the SCREEN bottom while the 36px footer track it was written to sit above
  // is correctly inset.
  //
  // Modelled separately because it is invisible to every other rule here. They
  // all ask whether the page DECLARES the inset somewhere; this one asks where
  // a box is placed FROM, which is a question about ancestry. A gate reading
  // only <style> sees a perfect page.
  const app = (inner) => `<div id="app">${inner}</div>`;
  const hook = (bottom, left, right) =>
    `<div id="hook-panel" style="position:absolute;bottom:${bottom};left:${left};right:${right};z-index:5;"></div>`;
  const HOOK_SAFE = hook('calc(var(--safe-bottom) + 48px)', 'calc(var(--safe-left) + 8px)', 'calc(var(--safe-right) + 8px)');
  const CLEAN_ANCHORED = `${VP_COVER}<style>${TOKENS}html,body{margin:0;height:100%;overflow:hidden;overscroll-behavior:none}${VARIANT_GRID}</style>`
    + app(HOOK_SAFE) + MOOD_SAFE;

  const cases = [
    { name: 'clean shell', html: CLEAN_SHELL, expect: 0 },
    { name: 'clean scrolling document', html: CLEAN_DOC, expect: 0 },
    { name: 'clean fixed sheet, inset in offset', html: CLEAN_SHEET, expect: 0 },
    { name: 'clean renderer variant', html: CLEAN_VARIANT, expect: 0 },
    { name: 'clean anchored variant', html: CLEAN_ANCHORED, expect: 0 },
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

    // ── the fourth shape, rule `abs-anchor` ─────────────────────────────────
    // The measured defect: the grid is inset-correct, the fixed overlay is
    // inset-correct, and this one absolute overlay is still 48px off the
    // viewport bottom. Nothing else in the file can see it.
    { name: 'abs overlay at hardcoded px', html: CLEAN_ANCHORED.replace(HOOK_SAFE, hook('48px', '8px', '8px')), expect: 1, rule: 'abs-anchor' },
    // The tempting one-word fix, and the case that has to FAIL. Positioning
    // #app does not inset an absolute descendant: the containing block is the
    // PADDING box of the positioned ancestor, and the padding lives inside it,
    // so #app's padding box is the same viewport-sized box either way. Without
    // this case the gate could be silenced by a change that fixes nothing.
    { name: 'position:relative grid root is not a fix', html: CLEAN_ANCHORED.replace('#app{display:grid', '#app{position:relative;display:grid').replace(HOOK_SAFE, hook('48px', '8px', '8px')), expect: 1, rule: 'abs-anchor' },
    // The correct way to contain one: a positioned wrapper INSIDE the padded
    // grid. Its box is already inside the padding, so it needs no inset of its
    // own. This is the 95 renderer-variant overlays in `section.stage`,
    // `aside`, `footer` and `.relative`, and it is why the measured finding
    // count is 6 and not 100.
    { name: 'abs overlay inside positioned panel', html: CLEAN_ANCHORED.replace(HOOK_SAFE, `<section style="position:relative">${hook('48px', '8px', '8px')}</section>`), expect: 0 },
    // A full-bleed overlay is meant to cover the notch, so being inset-unaware
    // is its job rather than its bug: #swr-start, .drop-zone, .swr-load.
    { name: 'full-bleed abs overlay', html: CLEAN_ANCHORED.replace(HOOK_SAFE, '<div id="drop-zone" style="position:absolute;top:0;right:0;bottom:0;left:0;z-index:9;"></div>'), expect: 0 },
    // An absolute element with no offsets is in its STATIC position, not pinned
    // to a screen edge, so no inset applies: versions/smoke.html's 0x0
    // `svg.swr-svg-grade` sprite sheet is exactly this.
    { name: 'abs overlay in static position', html: CLEAN_ANCHORED.replace(HOOK_SAFE, '<span class="sprite" style="position:absolute;width:0;height:0;overflow:hidden;"></span>'), expect: 0 },
    // The scope, and why the wider reading is not used: an absolute overlay in
    // an IN-FLOW region outside the padded shell is not this rule's business.
    // engine.html's #basic-mode-ui clip bar and swr-app.html's .pricing section
    // are the real cases, and a rule that reached them would cry wolf on 11
    // findings instead of 6.
    { name: 'abs overlay outside the padded grid', html: CLEAN_ANCHORED.replace(app(HOOK_SAFE), hook('48px', '8px', '8px')), expect: 0 },
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