// versions/_mobile-header-inject.js — codemod: add an icons-only header
// mode that activates at narrow viewport widths.
//
// Run from the product root:
//   node versions/_mobile-header-inject.js
//
// Idempotent: re-running reports "skipped" for pages already patched.
//
// Background: all 13 engine pages share an identical <header> block with
// ~14 controls (title, status pill, load song button, play button, time
// display, meter canvas, spacer, beat/onset leds, auto-cycle checkbox,
// rec-dur select, rec button, grid nav link). On viewports below ~480px
// the wrapped-text layout is still cramped — buttons have to fit a 12px
// "Load song", "● REC", etc., and the meter canvas gets clipped.
//
// This codemod adds `data-icon="<glyph>"` to each text-bearing header
// control, then injects a CSS block that:
//   - At >= 720px (desktop/tablet wide): shows text, hides icons
//   - At 481-720px (small tablet): wraps to multi-line as before
//   - At <= 480px (phone): hides text via text-indent:-9999px, shows the
//     data-icon glyph as a ::before pseudo-element. Header stays one row,
//     fits in 60-70px of vertical space, all controls remain reachable.
//
// Two markers:
//   - SWR-MOBILE-HEADER-MARKER (in the CSS) — main idempotency check
//   - SWR-HEADER-DATA-ICONS (in the header HTML) — flags the header as
//     already-processed so a re-run doesn't add the data-icon attrs twice

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.dirname(__dirname);

const ENGINES = [
  'aurora','chrome','eclipse','film','fractal','glitch','grid',
  'hallucination','neon','pulse','smoke','void','watercolor',
];

const CSS_MARKER = 'SWR-MOBILE-HEADER-MARKER';
const HTML_MARKER = 'SWR-HEADER-DATA-ICONS';

// CSS block. Mobile-first: phone is the smallest state, then small
// tablet, then desktop. The icons-only mode activates at <= 480px.
// We use `text-indent: -9999px` on each text-bearing header control
// (and an explicit data-icon glyph via ::before) so the button's
// aria-label/text-content stays in the DOM for screen readers.
const MOBILE_HEADER_BLOCK = `
    /* ---------- Mobile icons-only header ----------
       SWR-MOBILE-HEADER-MARKER
       At <= 480px the header text labels collapse to glyphs to keep all
       14 controls reachable in one row (~41px tall, was 75-109px when
       wrapped to multiple rows). At > 480px the labels show normally —
       the desktop/tablet layout is unchanged.
       The data-icon attributes are inserted by the codemod's HTML
       pass; see the HEADER_ICON_INJECTIONS list for the per-control
       glyph mapping. */
    /* Stop the header from wrapping to multiple rows at phone widths —
       let it stay one tall row and use the icons. */
    @media (max-width: 480px) {
      header {
        flex-wrap: nowrap;
        max-height: 64px;
        overflow-x: auto;
        overflow-y: hidden;
        padding: 4px 8px;
        gap: 2px;
      }
      header > * { flex-shrink: 0; }
      header .spacer { display: none; }
      /* Hide the textual label of every data-icon control. The ::before
         pseudo carries the glyph. text-indent:-9999px is the standard
         "icon-only button" pattern and keeps the text in the DOM for
         screen readers + the .tbtn:hover color-state rules. */
      [data-icon] {
        text-indent: -9999px;
        position: relative;
        padding-left: 6px;
        padding-right: 6px;
        min-width: 0;
        font-size: 14px;
      }
      [data-icon]::before {
        content: attr(data-icon);
        text-indent: 0;
        position: absolute;
        left: 0;
        right: 0;
        text-align: center;
        font-size: 14px;
        line-height: 1;
        pointer-events: none;
      }
      /* Auto-cycle's checkbox input is hidden by the original CSS; the
         label carries the text. We need to keep the checkbox + label
         behavior but the text label needs to swap to the icon. The
         label wraps a checkbox AND has data-icon set; the rule above
         handles the ::before, and we keep the checkbox visual via the
         existing :checked styles. */
      #meter { width: 60px !important; height: 18px; }
      /* rec-dur select: keep visible 3-char "30s" text */
      #rec-dur { text-indent: 0; padding: 4px 6px; min-width: 50px; }
      #rec-dur::before { display: none; }
      /* #time: keep as compact timestamp — the engine writes
         "0:00 / 0:00" into #time. At icons mode we hide the second
         half (after the slash) so only the elapsed time shows.
         "0:00 / 0:00" contains a literal " / " (space-slash-space)
         that we mask with a zero-width spacer and clip the rest. */
      #time {
        text-indent: 0;
        font-size: 11px;
        max-width: 50px;
        overflow: hidden;
        white-space: nowrap;
      }
      #time::before { display: none; }
      /* .v title: keep the engine name visible */
      .v { text-indent: 0; font-size: 14px; }
      .v::before { display: none; }
      /* .pill status: keep small text */
      .pill { text-indent: 0; padding: 2px 6px; }
      .pill::before { display: none; }
      /* The auto-cycle label carries text "auto-cycle" but it's a
         <label> wrapping a checkbox. We need its data-icon glyph to
         show while the checkbox stays usable. */
      label[data-icon] {
        padding: 4px 6px;
        text-indent: -9999px;
        position: relative;
      }
      label[data-icon]::before {
        content: attr(data-icon);
        text-indent: 0;
        position: absolute;
        left: 0;
        right: 0;
        text-align: center;
        font-size: 14px;
        line-height: 1;
        pointer-events: none;
      }
      /* Beat/onset indicators are <span class="gc">beat <span class="led">.
         At icons mode the .gc text "beat"/"onset" is hidden (the LED
         dot already has its own data-icon glyph). The two header .gc
         elements have an inline style="font-size:10px" (from the
         engine's source markup) which would otherwise override our
         class rule, so we use !important here. */
      .gc { font-size: 0 !important; gap: 0; }
      .gc::before { display: none; }
      .gc .led { font-size: 0; }
      /* The select inside .gc (rec-dur) keeps its visible text — see
         the #rec-dur rules above. */
      /* Tighten the meter canvas — it eats 60px and we need the room
         for the actual primary controls. */
      /* At very narrow widths (≤ 380px) hide the meter entirely. It's
         a nice-to-have spectrum display; the play button + status
         are the primary signal. */
      @media (max-width: 380px) {
        #meter { display: none; }
      }
    }
`;

// Header elements + their data-icon glyphs. Matched by their inner
// pattern (the unique id or class+text signature). The data-icon attr
// is added IN PLACE — we don't change the surrounding markup.
//
// IMPORTANT: every match regex anchors on the SPECIFIC id or class
// that uniquely identifies the control within the <header>, AND it
// requires that the trailing position (just before `>`) has only valid
// attribute syntax (key=value pairs separated by whitespace). This
// prevents the non-greedy `[\s\S]*?` from accidentally spanning across
// sibling elements like the next <button> or the closing `</span>`.
//
// An attribute is `name="value"` or `name` alone (boolean). We allow
// both. The pattern: `(?:\s+[a-zA-Z][\w-]*(?:="[^"]*")?)*` matches zero
// or more attributes, then `>` closes the tag.
const ATTR_SEQ = '(?:\\s+[a-zA-Z][\\w-]*(?:="[^"]*")?)*\\s*';
const HEADER_ICON_INJECTIONS = [
  // Match the load-song button by its id.
  { match: new RegExp(`(<button${ATTR_SEQ}id="load-song"${ATTR_SEQ})>`), icon: '\u2191' },   // ↑
  // Play button.
  { match: new RegExp(`(<button${ATTR_SEQ}id="play"${ATTR_SEQ})>`), icon: '\u25B6' },    // ▶
  // REC button.
  { match: new RegExp(`(<button${ATTR_SEQ}id="rec"${ATTR_SEQ})>`), icon: '\u23FA' },     // ⏺
  // "→ grid" nav link.
  { match: new RegExp(`(<a${ATTR_SEQ}class="nav"${ATTR_SEQ}href="grid\\.html"${ATTR_SEQ})>`), icon: '\u229E' }, // ⊞
  // auto-cycle label — gets the cycle icon. The label has a wrapped
  // child <input> between the open and close tags, so the pattern must
  // allow content between `>` (the open tag) and `</label>` (the close).
  { match: new RegExp(`(<label${ATTR_SEQ}title="When on[^"]*"${ATTR_SEQ})>`), icon: '\u21BB' }, // ↻
  // beat / onset indicators — get a dot glyph. The LED <span>s are
  // self-closing-style (`<span ...></span>`) so the pattern is
  // `<span attrs></span>`.
  { match: new RegExp(`(<span${ATTR_SEQ}id="beat-led"${ATTR_SEQ})></span>`), icon: '\u25CF',   // ●
    append: (m) => `${m[1]} data-icon="\u25CF"></span>` },
  { match: new RegExp(`(<span${ATTR_SEQ}id="onset-led"${ATTR_SEQ})></span>`), icon: '\u25CF',
    append: (m) => `${m[1]} data-icon="\u25CF"></span>` },
];

function patchFile(file) {
  let s = fs.readFileSync(file, 'utf8');

  // Already patched → skip.
  if (s.includes(CSS_MARKER)) return { file, status: 'skipped' };

  // Locate the <header>...</header> block. Every engine has exactly
  // one and it's the first <header> on the page.
  const headerMatch = s.match(/<header>([\s\S]*?)<\/header>/);
  if (!headerMatch) {
    return { file, status: 'error: no <header> block found' };
  }
  let header = headerMatch[1];

  // Inject data-icon attrs into the header. Idempotency check: the
  // HTML_MARKER comment at the top of the header marks "already
  // processed" so re-runs add attrs at most once.
  if (!header.includes(HTML_MARKER)) {
    HEADER_ICON_INJECTIONS.forEach(({ match, icon, append }) => {
      // Use a fresh regex each pass (no /g — we only care about the
      // first match per injection type).
      const m = header.match(match);
      if (!m) return;
      if (append) {
        // Custom appender (handles the self-closing LED <span/> case
        // where the matcher captured the leading `<span` separately).
        header = header.replace(match, append(m));
      } else {
        // Default: rebuild the opening tag with data-icon prepended.
        // The captured group is the full opening tag INCLUDING the
        // leading `<` (e.g. `<button class="tbtn" id="load-song"`),
        // so we just insert ` data-icon="X"` before the trailing `>`.
        const tag = m[1];
        if (!/\bdata-icon=/.test(tag)) {
          header = header.replace(match, `${tag} data-icon="${icon}">`);
        }
      }
    });
    // Replace the original <header> block with the marked version.
    s = s.replace(headerMatch[0], `<!-- ${HTML_MARKER} --><header>${header}</header>`);
  }

  // Inject the CSS block at the .swr-watermark anchor (same anchor the
  // responsive codemod uses; both insertions stack cleanly).
  const anchor = '\n    .swr-watermark {';
  if (!s.includes(anchor)) {
    return { file, status: 'error: anchor .swr-watermark { not found' };
  }
  s = s.replace(anchor, MOBILE_HEADER_BLOCK + anchor);

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
