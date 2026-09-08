#!/usr/bin/env node
// Mirror PR #23's library × button to all non-music_video version pages.
//
// For each versions/<page>.html (except music_video.html, which already has it),
// apply five patches in order, all idempotent:
//   A. Layers.cleanupForAsset  — drop layers whose asset was removed
//   B. Lib.removeItem          — splice item, revoke URL, call cleanupForAsset
//   C. Lib.render() updates   — × button, confirm-on-delete, click-guard
//   D. window.SWR_LIB = Lib   — expose for smoke testing
//   E. CSS rules              — .li .rm, hover, armed
//
// Pages without a Lib IIFE (audio-only / showcase pages) are reported as
// "skipped: no Lib". Pages with Lib but no Layers (e.g. collage) get B/C/D/E
// but not A. Pages already patched are reported as "skipped: already patched".
//
// All patch strings embed the correct indentation (matching the existing
// 2-space-indent repo style). Anchor strings include the same leading
// whitespace as the replacement strings, so `html.replace(anchor, repl)`
// preserves exact column alignment.
//
// Usage:
//   node scripts/mirror-library-remove.mjs                # all versions/*.html
//   node scripts/mirror-library-remove.mjs versions/neon.html   # single file

import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readdirSync } from 'node:fs';

const here = fileURLToPath(new URL('.', import.meta.url));
const repoRoot = resolve(here, '..');

function listTargets(args) {
  if (args.length) {
    return args.map((a) => resolve(repoRoot, a));
  }
  const dir = resolve(repoRoot, 'versions');
  return readdirSync(dir)
    .filter((n) => n.endsWith('.html'))
    .map((n) => resolve(dir, n))
    .sort();
}

// === PATCH CONTENT (mirrors versions/music_video.html 692-755 + 812-825 + CSS 61-67) ===

// Patch A: Layers.cleanupForAsset (defined as a method, 6-space header).
const LAYERS_CLEANUP = [
  '      cleanupForAsset(it) {',
  '        const before = this.list.length;',
  '        this.list = this.list.filter(l => l.asset !== it);',
  '        if (this.list.length !== before) {',
  '          this.render();',
  '          try { window.SWR_RENDER && window.SWR_RENDER.invalidate && window.SWR_RENDER.invalidate(); } catch (_) {}',
  '        }',
  '      },',
].join('\n');

// Patch B: Lib.removeItem (defined as a method, 6-space header).
const LIB_REMOVE_ITEM = [
  '      removeItem(id) {',
  '        const i = this.items.findIndex(x => x.id === id);',
  '        if (i < 0) return false;',
  '        const it = this.items[i];',
  '        // Revoke the blob URL to free the underlying file from memory.',
  '        try { if (it.url) URL.revokeObjectURL(it.url); } catch (_) {}',
  '        // Drop any layer that referenced this asset. Layers lives in',
  "        // the same IIFE scope below — it's defined after Lib but by",
  '        // the time removeItem is called (user click), the whole IIFE',
  "        // has run and Layers is bound. Use the closure reference so",
  "        // we don't depend on window.SWR.Layers being set.",
  "        try { if (typeof Layers.cleanupForAsset === 'function') Layers.cleanupForAsset(it); } catch (_) {}",
  '        this.items.splice(i, 1);',
  '        this.render();',
  '        return true;',
  '      },',
].join('\n');

// Patch C parts: the Lib.render() updates. The innerHTML line exists in two
// variants across pages: `d.innerHTML = \`...\`;` (with space) and
// `d.innerHTML=\`...\`;` (no space). We match the body template literal
// substring (which is invariant) instead of the leading whitespace, so both
// shapes patch cleanly. We DO carry leading 10-space indent so the first
// replacement line is column-aligned with the original.

// Variant A: with the V/I tag prefix (used by aurora, chrome, eclipse,
// fractal, glitch, grid, hallucination, neon, pulse, void, watercolor).
const INNER_BODY_A = "`<span class=\"tag\">${it.type==='video'?'V':'I'}</span><span class=\"nm\">${it.name}</span>`;";
// Variant B: no prefix (used by film, smoke).
const INNER_BODY_B = "`<span class=\"nm\">${it.name}</span>`;";
// Variant C: prefix + truncated name (used by grid).
const INNER_BODY_C = "`<span class=\"tag\">${it.type==='video'?'V':'I'}</span><span class=\"nm\">${it.name.slice(0,18)}</span>`;";
const INNER_AFTER_LINES_A = [
  "          d.innerHTML = `<span class=\"tag\">${it.type==='video'?'V':'I'}</span>`",
  '                      + `<span class="rm" data-id="${it.id}" title="Remove">×</span>`',
  '                      + `<span class="nm">${it.name}</span>`;',
];
const INNER_AFTER_LINES_B = [
  "          d.innerHTML = `<span class=\"nm\">${it.name}</span>`",
  '                      + `<span class="rm" data-id="${it.id}" title="Remove">×</span>`;',
];
const INNER_AFTER_LINES_C = [
  "          d.innerHTML = `<span class=\"tag\">${it.type==='video'?'V':'I'}</span>`",
  '                      + `<span class="rm" data-id="${it.id}" title="Remove">×</span>`',
  '                      + `<span class="nm">${it.name.slice(0,18)}</span>`;',
];

const CLICK_BEFORE = "          d.addEventListener('click', () => Layers.add(it));";
const CLICK_AFTER = [
  "          d.addEventListener('click', (e) => {",
  '            // Don\'t fire "add to layer" if the click was on the × button.',
  "            if (e.target.classList.contains('rm')) return;",
  '            Layers.add(it);',
  '          });',
].join('\n');

const APPEND_BEFORE = '          el.appendChild(d);\n        }\n      }';
const APPEND_AFTER = [
  '          el.appendChild(d);',
  '        }',
  '        // Wire the × buttons. Done after innerHTML so we attach listeners',
  '        // to the live DOM nodes (innerHTML-replaced elements lose their',
  '        // listeners on each re-render).',
  "        const rmButtons = el.querySelectorAll('.rm');",
  '        rmButtons.forEach(btn => {',
  "          btn.addEventListener('click', (e) => {",
  '            e.stopPropagation();',
  "            const id = parseInt(btn.getAttribute('data-id'), 10);",
  '            const it = this.items.find(x => x.id === id);',
  '            if (!it) return;',
  '            // Confirm-on-delete: first click arms, second click within',
  '            // 1.5s fires. The button itself turns red (var(--m)) to',
  '            // indicate the armed state. After the timeout, returns.',
  "            if (btn.classList.contains('rm-armed')) {",
  '              this.removeItem(id);',
  "              if (typeof setStatus === 'function') setStatus('removed · ' + it.name, 'ok');",
  '            } else {',
  "              btn.classList.add('rm-armed');",
  "              btn.title = 'click again to confirm';",
  "              if (typeof setStatus === 'function') setStatus('click × again to remove · ' + it.name, 'err');",
  '              setTimeout(() => {',
  '                // Only disarm if the button still exists in the DOM.',
  "                if (btn.isConnected) {",
  "                  btn.classList.remove('rm-armed');",
  "                  btn.title = 'Remove';",
  '                }',
  '              }, 1500);',
  '            }',
  '          });',
  '        });',
  '      }',
].join('\n');

// Patch D: window.SWR_LIB exposure (4-space indent, IIFE-top level).
const SWR_LIB_INSERT = [
  '',
  '    // Expose Lib for smoke testing (parallels window.SWR.Layers).',
  '    window.SWR_LIB = Lib;',
  '',
].join('\n');

// Patch E: CSS rules at 4-space indent. Inserted immediately before
// `  </style>` (the closing tag, indented 2 spaces). The CSS must NOT
// carry extra leading whitespace that would stack with the existing
// indent — the splice is at the `<` of `</style>`, so the 2 spaces of
// indent that preceded `</style>` will precede our first CSS line.
// Strip those 2 spaces by anchoring on `  </style>` and replacing with
// CSS_RULES + the same `  </style>`.
const STYLE_CLOSE_BEFORE = '  </style>';
const STYLE_CLOSE_AFTER = [
  '    .li .rm { position: absolute; top: 2px; right: 2px; width: 14px; height: 14px;',
  '      background: rgba(0,0,0,0.6); color: var(--muted); border: none; border-radius: 2px;',
  '      font: 11px/1 ui-monospace, monospace; cursor: pointer; padding: 0;',
  '      opacity: 0; transition: opacity 0.1s, color 0.1s, background 0.1s; }',
  '    .li:hover .rm { opacity: 1; }',
  '    .li .rm:hover { color: var(--m); background: rgba(0,0,0,0.85); }',
  '    .li .rm.rm-armed { color: #fff; background: var(--m); opacity: 1; }',
  '',
  '  </style>',
].join('\n');

// === PATCH FUNCTIONS ===

// Patch A: insert Layers.cleanupForAsset after Layers.reset (if present) or
// after Layers.rm. Idempotent.
//
// Anchors are scoped to the Layers block (we look at the range between
// `const Layers = {` and `// === LAYERS ===` boundary... actually no, the
// Layers block extends past that comment, so we use the literal `rm(id) {`
// or `reset() {` method definitions, which are unique to Layers).
function patchCleanupForAsset(html) {
  if (/\n      cleanupForAsset\(it\) \{/.test(html)) {
    return { html, changed: false, reason: 'already patched' };
  }

  // Anchor preference: reset() closing brace, else rm() closing brace.
  const resetAnchor = 'try { window.SWR_RENDER && window.SWR_RENDER.invalidate && window.SWR_RENDER.invalidate(); }';
  if (html.includes(resetAnchor)) {
    const idx = html.indexOf(resetAnchor);
    let depth = 0;
    let closeIdx = -1;
    for (let i = idx; i < html.length; i++) {
      if (html[i] === '{') depth++;
      else if (html[i] === '}') {
        depth--;
        if (depth === 0) { closeIdx = i; break; }
      }
    }
    if (closeIdx < 0 || html[closeIdx + 1] !== ',') {
      throw new Error('patch A: cannot locate reset() closing brace');
    }
    const insertAt = closeIdx + 2; // past `},`
    html = html.slice(0, insertAt) + '\n' + LAYERS_CLEANUP + html.slice(insertAt);
    return { html, changed: true };
  }

  // Fallback: rm() method. Two compact-form variants exist across pages;
  // use a regex that matches both and captures the closing `},`.
  // Pattern: rm(id) { <body containing l.id !== id> },
  const rmRe = /rm\(id\)\s*\{[^{}]*l\.id\s*!==\s*id[^{}]*\}/;
  const m = html.match(rmRe);
  if (!m) {
    return { html, changed: false, reason: 'no Layers.rm anchor' };
  }
  const insertAt = m.index + m[0].length + 1; // past `},`
  html = html.slice(0, insertAt) + '\n' + LAYERS_CLEANUP + html.slice(insertAt);
  return { html, changed: true };
}

// Patch B: insert Lib.removeItem after _classify's closing `},`.
function patchRemoveItem(html) {
  if (/\n      removeItem\(id\) \{/.test(html)) {
    return { html, changed: false, reason: 'already patched' };
  }

  const start = html.indexOf('_classify(it) {');
  if (start < 0) {
    return { html, changed: false, reason: 'no _classify anchor' };
  }
  let depth = 0;
  let i = start + '_classify(it) {'.length - 1;
  for (; i < html.length; i++) {
    if (html[i] === '{') depth++;
    else if (html[i] === '}') {
      depth--;
      if (depth === 0) break;
    }
  }
  if (depth !== 0) {
    throw new Error('patch B: unbalanced braces in _classify');
  }
  if (html[i + 1] !== ',') {
    html = html.slice(0, i + 1) + ',' + html.slice(i + 1);
    i = i + 1;
  }
  const insertAt = i + 2;
  html = html.slice(0, insertAt) + '\n' + LIB_REMOVE_ITEM + html.slice(insertAt);
  return { html, changed: true };
}

// Patch C: rewrite Lib.render().
function patchRender(html) {
  if (html.includes('class="rm" data-id=')) {
    return { html, changed: false, reason: 'already patched' };
  }

  // 1) innerHTML line — match the body template literal so both
  // `d.innerHTML = ...` and `d.innerHTML=...` variants patch. Two
  // template variants exist across pages: variant A has the
  // `<span class="tag">V/I</span>` prefix, variant B doesn't.
  let innerRe;
  let innerReplacement;
  if (html.includes(INNER_BODY_A)) {
    innerRe = /[ \t]*d\.innerHTML\s*=\s*`<span class="tag">\$\{it\.type==='video'\?'V':'I'\}<\/span><span class="nm">\$\{it\.name\}<\/span>`;/;
    innerReplacement = INNER_AFTER_LINES_A.join('\n');
  } else if (html.includes(INNER_BODY_B)) {
    innerRe = /[ \t]*d\.innerHTML\s*=\s*`<span class="nm">\$\{it\.name\}<\/span>`;/;
    innerReplacement = INNER_AFTER_LINES_B.join('\n');
  } else if (html.includes(INNER_BODY_C)) {
    innerRe = /[ \t]*d\.innerHTML\s*=\s*`<span class="tag">\$\{it\.type==='video'\?'V':'I'\}<\/span><span class="nm">\$\{it\.name\.slice\(0,18\)\}<\/span>`;/;
    innerReplacement = INNER_AFTER_LINES_C.join('\n');
  } else {
    return { html, changed: false, reason: 'no innerHTML anchor (neither A, B, nor C variant)' };
  }
  const innerMatch = html.match(innerRe);
  if (!innerMatch) {
    throw new Error('patch C: innerHTML regex failed despite substring match');
  }
  html = html.replace(innerRe, innerReplacement);

  // 2) Click handler — match exact leading-10-spaces anchor.
  if (!html.includes(CLICK_BEFORE)) {
    throw new Error('patch C: cannot find d.addEventListener click anchor');
  }
  html = html.replace(CLICK_BEFORE, CLICK_AFTER);

  // 3) × wiring after the thumbnail loop.
  if (!html.includes(APPEND_BEFORE)) {
    throw new Error('patch C: cannot find el.appendChild loop end anchor');
  }
  html = html.replace(APPEND_BEFORE, APPEND_AFTER);
  return { html, changed: true };
}

// Patch D: insert `window.SWR_LIB = Lib;` right after the Lib object's
// closing `};` (and before the `const Layers = {` that follows on most
// pages). Anchor on `const Layers = {` first (the common shape) and
// fall back to the marker `// === LAYERS ===` for pages that don't have
// that comment. If neither anchor exists, find the `};` that closes Lib
// by tracking brace depth from `const Lib = {`.
function patchSWR_LIB(html) {
  if (html.includes('window.SWR_LIB = Lib')) {
    return { html, changed: false, reason: 'already patched' };
  }
  // Locate the closing `};` of Lib by depth-tracking from `const Lib = {`.
  // This works on every page that has a Lib object regardless of the
  // surrounding comments or Layers shape.
  const startMarker = 'const Lib = {';
  const startIdx = html.indexOf(startMarker);
  if (startIdx < 0) {
    return { html, changed: false, reason: 'no const Lib = { marker' };
  }
  let depth = 0;
  let closeIdx = -1;
  for (let i = startIdx + startMarker.length - 1; i < html.length; i++) {
    if (html[i] === '{') depth++;
    else if (html[i] === '}') {
      depth--;
      if (depth === 0) { closeIdx = i; break; }
    }
  }
  if (closeIdx < 0) {
    return { html, changed: false, reason: 'cannot find Lib closing `};`' };
  }
  // Skip past `};` and any whitespace/newline to insert before next stmt.
  let insertAt = closeIdx + 2;
  while (insertAt < html.length && /\s/.test(html[insertAt])) insertAt++;
  html = html.slice(0, insertAt) + '\n    // Expose Lib for smoke testing (parallels window.SWR.Layers).\n    window.SWR_LIB = Lib;\n\n' + html.slice(insertAt);
  return { html, changed: true };
}

// Patch E: append CSS rules right before `</style>`. Anchor on the exact
// `  </style>` (2-space indent) so the inserted CSS lines sit at 4-space
// indent (matching the rest of the <style> block).
function patchCSS(html) {
  if (html.includes('.li .rm.rm-armed')) {
    return { html, changed: false, reason: 'already patched' };
  }
  if (!html.includes(STYLE_CLOSE_BEFORE)) {
    // Some files may have `</style>` at column 0 (rare). Fall back to
    // a no-anchor insert.
    const closeStyle = html.indexOf('</style>');
    if (closeStyle < 0) {
      return { html, changed: false, reason: 'no </style> closing tag' };
    }
    const cssNoAnchor = STYLE_CLOSE_AFTER.replace(STYLE_CLOSE_BEFORE, '');
    html = html.slice(0, closeStyle) + cssNoAnchor + html.slice(closeStyle);
    return { html, changed: true };
  }
  html = html.replace(STYLE_CLOSE_BEFORE, STYLE_CLOSE_AFTER);
  return { html, changed: true };
}

// === DRIVER ===

function applyAll(html) {
  const out = { steps: [], ok: true };

  const hasLib = /const Lib = \{/.test(html);
  const hasLayers = /const Layers = \{/.test(html);
  const hasClassify = /_classify\(it\) \{/.test(html);
  // Collage-style pages have a Lib with addFiles + items but no render()
  // method — they use panels, not thumbnails. The × button doesn't apply
  // because there's no .li element to attach it to. Skip them entirely.
  const hasRender = /render\(\)\s*\{[^}]*this\.items/.test(html)
                 || /render\(\)\s*\{[^}]*for \(const it of this\.items/.test(html);

  if (!hasLib) {
    return { ok: true, skipped: 'no Lib IIFE (audio-only / showcase page)' };
  }
  if (!hasClassify) {
    return { ok: true, skipped: 'Lib present but no _classify (shape mismatch)' };
  }
  if (!hasRender) {
    return { ok: true, skipped: 'Lib has no thumbnail render() (collage-style panels)' };
  }

  // Patch B (Lib.removeItem)
  try {
    const r = patchRemoveItem(html); html = r.html; out.steps.push({ id: 'B: removeItem', changed: r.changed, reason: r.reason });
  } catch (e) { out.ok = false; out.error = 'B: ' + e.message; return out; }

  // Patch C (Lib.render × button)
  try {
    const r = patchRender(html); html = r.html; out.steps.push({ id: 'C: render × button', changed: r.changed, reason: r.reason });
  } catch (e) { out.ok = false; out.error = 'C: ' + e.message; return out; }

  // Patch D (window.SWR_LIB)
  try {
    const r = patchSWR_LIB(html); html = r.html; out.steps.push({ id: 'D: window.SWR_LIB', changed: r.changed, reason: r.reason });
  } catch (e) { out.ok = false; out.error = 'D: ' + e.message; return out; }

  // Patch E (CSS)
  try {
    const r = patchCSS(html); html = r.html; out.steps.push({ id: 'E: CSS', changed: r.changed, reason: r.reason });
  } catch (e) { out.ok = false; out.error = 'E: ' + e.message; return out; }

  // Patch A (Layers.cleanupForAsset) — only if Layers is present.
  if (hasLayers) {
    try {
      const r = patchCleanupForAsset(html); html = r.html; out.steps.push({ id: 'A: cleanupForAsset', changed: r.changed, reason: r.reason });
    } catch (e) { out.ok = false; out.error = 'A: ' + e.message; return out; }
  } else {
    out.steps.push({ id: 'A: cleanupForAsset', changed: false, reason: 'no Layers (collage-style page)' });
  }

  return { ...out, html };
}

async function processFile(path) {
  const original = await readFile(path, 'utf8');
  if (path.endsWith('music_video.html')) {
    return { path, status: 'skipped', reason: 'already has × button (PR #23)' };
  }
  const result = applyAll(original);
  if (!result.ok) {
    return { path, status: 'error', reason: result.error };
  }
  if (result.skipped) {
    return { path, status: 'skipped', reason: result.skipped };
  }
  const changed = result.steps.some((s) => s.changed);
  if (changed) {
    await writeFile(path, result.html, 'utf8');
  }
  return {
    path,
    status: changed ? 'patched' : 'already-patched',
    steps: result.steps,
  };
}

function shortPath(p) { return p.replace(repoRoot + '/', ''); }

async function main() {
  const args = process.argv.slice(2);
  const targets = listTargets(args);
  if (!targets.length) {
    console.error('no targets');
    process.exit(1);
  }
  console.log(`Mirroring library × button across ${targets.length} file(s):\n`);
  const summary = { patched: [], skipped: [], errored: [], alreadyPatched: [] };
  for (const t of targets) {
    const r = await processFile(t);
    const sp = shortPath(r.path);
    const tail = r.steps ? r.steps.map((s) => `${s.changed ? '+' : '·'}${s.id}`).join(' ') : '';
    console.log(`${r.status.padEnd(14)} ${sp}${tail ? '  ' + tail : '  ' + (r.reason || '')}`);
    if (r.status === 'patched') summary.patched.push(sp);
    else if (r.status === 'already-patched') summary.alreadyPatched.push(sp);
    else if (r.status === 'skipped') summary.skipped.push({ file: sp, reason: r.reason });
    else if (r.status === 'error') summary.errored.push({ file: sp, reason: r.reason });
  }
  console.log('\n=== Summary ===');
  console.log(`patched:         ${summary.patched.length}`);
  console.log(`already patched: ${summary.alreadyPatched.length}`);
  console.log(`skipped:         ${summary.skipped.length}`);
  console.log(`errors:          ${summary.errored.length}`);
  if (summary.skipped.length) {
    console.log('\nSkipped:');
    for (const s of summary.skipped) console.log(`  ${s.file} — ${s.reason}`);
  }
  if (summary.errored.length) {
    console.log('\nErrors:');
    for (const e of summary.errored) console.log(`  ${e.file} — ${e.reason}`);
    process.exit(1);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
