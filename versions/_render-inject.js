// versions/_render-inject.js — codemod: route every engine page's render
// through the shared engine-render.client.js (DPR-aware canvas + per-layer
// cache). Run from the product root:
//
//   node versions/_render-inject.js
//
// Idempotent: re-running reports "skipped" for pages already patched.
//
// Two edits per page:
//   1) fit() body — replaced with the new DPR-aware sizing.
//   2) The "clear + iterate layers + drawFx + drawMeter" block — replaced
//      with a call to SWR_RENDER.frame().
//
// The page's own drawLayer is reused as the layer-draw hook: we just rewrite
// it to take `(l, r, ctx, cssW, cssH)` and drop its `applyR` call (the page
// supplies `r` to the hook from outside). We inject a `pageDrawLayer` alias
// that captures the closure, so the rest of the page keeps calling `drawLayer`.

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const ENGINES = [
  'aurora', 'chrome', 'eclipse', 'film', 'fractal', 'glitch', 'grid',
  'hallucination', 'neon', 'pulse', 'smoke', 'void', 'watercolor',
];

const DIR = path.dirname(fileURLToPath(import.meta.url));

const RENDER_TAG = '<script src="../engine-render.client.js"></script>';
const TIMING_TAG = '<script src="../engine-timing.client.js"></script>';
const TIMING_PANEL_TAG = '<script src="../engine-timing-panel.client.js"></script>';
const LFOS_TAG = '<script src="../engine-lfos.client.js"></script>';
const LFO_PANEL_TAG = '<script src="../engine-lfo-panel.client.js"></script>';
const AUTOMAP_TAG = '<script src="../engine-automap.client.js"></script>';
const SETTINGS_TAG = '<script src="../engine-settings.client.js"></script>';
const KEYS_TAG = '<script src="../engine-keys.client.js"></script>';
const PROJECT_TAG = '<script src="../project.client.js"></script>';
const SCHEDULER_TAG = '<script src="../layer-scheduler.client.js"></script>';

const FIT_REPLACEMENT = `    function fit() {
      const m = SWR_RENDER.fit(stage);
      W = m.cssW; H = m.cssH;
      ctx.setTransform(m.dpr, 0, 0, m.dpr, 0, 0);
    }`;

let patched = 0, skipped = 0, failed = 0, unparsed = [];

for (const name of ENGINES) {
  const file = path.join(DIR, name + '.html');
  if (!fs.existsSync(file)) { console.log(`  ${name}.html: MISSING`); failed++; continue; }

  let src = fs.readFileSync(file, 'utf8');
  const before = src;

  // ---- 1. inject the script tag in <head> (idempotent) ----------------
  // The page's inline <script> calls into SWR_RENDER (via fit() and loop()),
  // so the module MUST load before that inline script runs. Putting the
  // script tag in <head> achieves that; placing it at the end of <body>
  // would mean the page's IIFE runs first and SWR_RENDER is undefined.
  // engine-timing.client.js is also injected here: SWR_RENDER.frame() calls
  // into SWR_TIMING.step() every frame, so timing must load before the
  // page's IIFE too.
  if (!src.includes('engine-render.client.js')) {
    const headTag = '</head>';
    if (!src.includes(headTag)) {
      console.log(`  ${name}.html: FAILED (no </head>)`);
      failed++; continue;
    }
    // Insert before the genops module's <link rel="stylesheet"> so render
    // gets a chance to load in parallel with the genops script. layer-scheduler
    // loads last because it depends on SWR + SWR_TIMING being ready (the
    // scheduler reads SWR.Layers + SWR.Library on boot and applies swap
    // commands through SWR_TIMING.crossfade).
    const genopsLink = '<link rel="stylesheet" href="../engine-genops.css" />';
    if (src.includes(genopsLink)) {
      src = src.replace(genopsLink, RENDER_TAG + '\n' + TIMING_TAG + '\n' + TIMING_PANEL_TAG + '\n' + LFOS_TAG + '\n' + LFO_PANEL_TAG + '\n' + AUTOMAP_TAG + '\n' + SETTINGS_TAG + '\n' + KEYS_TAG + '\n' + PROJECT_TAG + '\n' + SCHEDULER_TAG + '\n' + genopsLink);
    } else {
      src = src.replace(headTag, RENDER_TAG + '\n' + TIMING_TAG + '\n' + TIMING_PANEL_TAG + '\n' + LFOS_TAG + '\n' + LFO_PANEL_TAG + '\n' + AUTOMAP_TAG + '\n' + SETTINGS_TAG + '\n' + KEYS_TAG + '\n' + PROJECT_TAG + '\n' + SCHEDULER_TAG + headTag);
    }
  }
  // Idempotent tag fills: a previous pass may have inserted some tags via
  // a manual edit. Add the missing ones without disturbing the others.
  if (src.includes('engine-render.client.js') && !src.includes('engine-timing.client.js')) {
    src = src.replace(RENDER_TAG, RENDER_TAG + '\n' + TIMING_TAG);
  }
  if (src.includes('engine-timing.client.js') && !src.includes('engine-timing-panel.client.js')) {
    src = src.replace(TIMING_TAG, TIMING_TAG + '\n' + TIMING_PANEL_TAG);
  }
  if (src.includes('engine-timing-panel.client.js') && !src.includes('engine-lfos.client.js')) {
    src = src.replace(TIMING_PANEL_TAG, TIMING_PANEL_TAG + '\n' + LFOS_TAG);
  }
  if (src.includes('engine-lfos.client.js') && !src.includes('engine-lfo-panel.client.js')) {
    src = src.replace(LFOS_TAG, LFOS_TAG + '\n' + LFO_PANEL_TAG);
  }
  if (src.includes('engine-lfo-panel.client.js') && !src.includes('engine-automap.client.js')) {
    src = src.replace(LFO_PANEL_TAG, LFO_PANEL_TAG + '\n' + AUTOMAP_TAG);
  }
  if (src.includes('engine-automap.client.js') && !src.includes('engine-settings.client.js')) {
    src = src.replace(AUTOMAP_TAG, AUTOMAP_TAG + '\n' + SETTINGS_TAG);
  }
  if (src.includes('engine-settings.client.js') && !src.includes('engine-keys.client.js')) {
    src = src.replace(SETTINGS_TAG, SETTINGS_TAG + '\n' + KEYS_TAG);
  }
  if (src.includes('engine-keys.client.js') && !src.includes('project.client.js')) {
    src = src.replace(KEYS_TAG, KEYS_TAG + '\n' + PROJECT_TAG);
  }
  // layer-scheduler: only add the tag itself, never re-insert the whole
  // tail block. The block re-emit (previously here) silently duplicated
  // every tag already present, which is what produced the
  // engine-timing.client.js double-load on the live site.
  if (src.includes('project.client.js') && !src.includes('layer-scheduler.client.js')) {
    src = src.replace(PROJECT_TAG, PROJECT_TAG + '\n' + SCHEDULER_TAG);
  }

  // ---- 2. rewrite fit() ------------------------------------------------
  if (src.includes('SWR_RENDER.fit(stage)')) {
    // already done
  } else {
    // The current fit() sets stage.width/height in CSS px and then W = stage.width.
    // We replace the entire body with the DPR-aware version.
    const fitRe = /function fit\(\)\s*\{[\s\S]*?\n    \}/;
    if (!fitRe.test(src)) {
      console.log(`  ${name}.html: FAILED (fit() not matched)`);
      failed++; continue;
    }
    src = src.replace(fitRe, FIT_REPLACEMENT);
  }

  // ---- 2b. fit() in 6-space-indented engines (eclipse) -----------------
  // eclipse uses 6-space indent for its fit body. The regex above matches
  // both 4- and 6-space closings; this is a no-op for engines that already
  // have 4-space fit (which the previous step handled).
  if (!src.includes('SWR_RENDER.fit(stage)')) {
    const fitRe2 = /function fit\(\)\s*\{[\s\S]*?\n      \}/;
    if (fitRe2.test(src)) {
      src = src.replace(fitRe2, FIT_REPLACEMENT.replace(/\n    \}/, '\n      }'));
    }
  }

  // ---- 3. draw-loop body ------------------------------------------------
  // NOTE: cache + frame() rewrite is deferred to a follow-up. The page's
  // own drawLayer uses the closure `ctx` directly, so the off-screen
  // render pattern needs more invasive surgery than the codemod does
  // safely. For this pass we deliver DPR-aware sizing (crispness) and the
  // rest of the render stays in the page. Cache + audio-hash invalidation
  // live in the module and are exposed for a later, hand-rolled migration.
  //
  // What we still do here: nothing to the loop body.

  if (src.includes('SWR_RENDER.frame(')) {
    // already done
  } else if (/function loop\s*\(/.test(src)) {
    // 11 engines
    // Strip the `W,H`-scaled fillRect + the layer iteration + drawFx/drawMeter
    // and replace with a single SWR_RENDER.frame() call. Keep the trailing
    // requestAnimationFrame and any other per-frame work (onset micro-shake
    // decay, beat counter, fps calculation, etc.).
    //
    // Capture the section from "ctx.fillStyle = '...'; ctx.fillRect(0,0,W,H);"
    // up to (but not including) the next "requestAnimationFrame(loop);".
    const blockRe = /(\s*)(ctx\.fillStyle\s*=\s*['"][^'"]+['"];\s*ctx\.fillRect\(0,0,W,H\);[\s\S]*?drawMeter\(\);)/;
    const m = src.match(blockRe);
    if (!m) {
      console.log(`  ${name}.html: FAILED (loop body not matched for shape a)`);
      failed++; continue;
    }
    const lead = m[1];
    // Extract the bg color from the matched line.
    const bg = (m[2].match(/ctx\.fillStyle\s*=\s*['"]([^'"]+)['"]/) || [null, '#000'])[1];

    // The replacement reuses the page's drawLayer as the per-layer hook. We
    // need to call it with the layer and a precomputed r. The simplest way is
    // to bind the page's `applyR` inside a small wrapper at module load time.
    // We do that by emitting a `__render_drawLayer = (l, r, ctx) => drawLayer(l, r, ctx, W, H)`
    // alias and calling SWR_RENDER.frame(stage, ctx, sorted, applyR, __render_drawLayer, ...).
    const extraDraws = [];
    if (/\bfunction drawFx\(/.test(before)) extraDraws.push('drawFx');
    if (/\bfunction drawMeter\(/.test(before)) extraDraws.push('drawMeter');
    const extra = extraDraws.length
      ? ', { extraDraws: [' + extraDraws.join(', ') + '] }'
      : '';

    // Build each line already at the right indent (one further than `lead`),
    // so the first line replaces the captured newline+spaces cleanly.
    const indent = lead.replace(/[^\n]/g, '').replace('\n', '') + '      ';  // 6 spaces of inner indent
    const body =
      `SWR_RENDER.setBackground('${bg}');\n` +
      indent + `const __render_layers = (typeof sorted !== 'undefined' ? sorted : Layers.list.slice().sort((a,b) => (a.z||0) - (b.z||0)));\n` +
      indent + `const __render_drawLayer = (l, r, c) => drawLayer(l, r, c, W, H);\n` +
      indent + `SWR_RENDER.frame(stage, ctx, __render_layers, applyR, __render_drawLayer${extra});`;
    src = src.replace(m[0], lead + body);
  } else if (/function draw\s*\(/.test(src)) {
    // eclipse: function draw() with A.sample() and a corona overlay that uses
    // DOM elements. We can't fully migrate corona (it touches coronaEl), but
    // we CAN migrate the layer drawing. Strategy: extract the body up to and
    // including the layer iteration, replace with frame(), and leave the rest
    // (corona, RAF) intact.
    const blockRe = /(ctx\.fillStyle\s*=\s*['"][^'"]+['"];[\s\S]*?ctx\.fillRect\(\s*0\s*,\s*0\s*,\s*W\s*,\s*H\s*\);\s*for\s*\(let i=0;i<Layers\.list\.length;i\+\+\)\s*drawLayer\(Layers\.list\[i\],\s*i\);)/;
    const m = src.match(blockRe);
    if (!m) {
      console.log(`  ${name}.html: FAILED (eclipse-style draw body not matched)`);
      failed++; continue;
    }
    const bg = (m[1].match(/ctx\.fillStyle\s*=\s*['"]([^'"]+)['"]/) || [null, '#000'])[1];
    const replacement =
      `SWR_RENDER.setBackground('${bg}');\n` +
      `      SWR_RENDER.frame(stage, ctx, Layers.list, applyR, (l, r, c) => drawLayer(l, r, c, W, H));`;
    src = src.replace(m[1], replacement);
  } else {
    console.log(`  ${name}.html: FAILED (no loop() or draw() found)`);
    failed++; continue;
  }

  // ---- 4. adapt drawLayer to take (l, r, ctx, cssW, cssH) -------------
  // The current drawLayer does:
  //   function drawLayer(l) { … const r = applyR(l); ctx.save(); … ctx.drawImage(…); … ctx.restore(); }
  // We want:
  //   function drawLayer(l, r, targetCtx, cssW, cssH) { if (!r) r = applyR(l);
  //       const ctx = targetCtx; // (alias — page uses local `ctx` heavily)
  //       …rest unchanged, but using cssW/cssH instead of W/H…
  //   }
  //
  // Simplest approach: add a wrapper function next to the original drawLayer
  // and rename the original to drawLayerImpl. Skip — the regex surgery is
  // error-prone across 13 files. Instead: emit a tiny adapter that calls
  // drawLayer(l) but captures r. Pages still own drawLayer; we pass a hook
  // that just calls drawLayer(l) — same as before. The cache key uses r._v
  // which is missing; we add it in applyR.
  //
  // For now: append `r._v = …` to applyR so cache versioning works. This is
  // a one-line addition per page.
  if (!/out\._v\s*=\s*["']0["']/.test(src)) {
    // Add `out._v = "0";` after the applyR function builds `out`.
    // The pattern: `return out;` inside applyR (the ONLY function with that
    // return shape) — replace with `out._v = "0"; return out;`
    //
    // Idempotency: the guard regex looks for the exact line we're about
    // to insert. The previous guard used `/r\._v\s*=/` (looking for
    // `r._v =`) which never matched `out._v = "0"` and so this block
    // re-fired on every run, accumulating 10+ duplicate `out._v = "0";`
    // lines per page. See fix(versions): dedupe out._v in engine pages.
    const arRe = /(function applyR\([^)]*\)\s*\{[\s\S]*?)(\n\s*)return out;/;
    if (arRe.test(src)) {
      src = src.replace(arRe, (full, body, lead) => body + lead + 'out._v = "0";' + lead + 'return out;');
    }
  }

  // ---- 5. ensure `ease` is defined (used by 3 engines' applyR) -------
  // grid, hallucination, and smoke reference `ease(name, t)` inside their
  // applyR() but never declare it. Other engines (film, eclipse) define it
  // locally as a `function ease(name, t)` that handles 'sharp'/'soft'.
  // Inject a shared no-op fallback for the three engines that miss it.
  if (/ease\(\s*r\.ease\s*,/.test(src) && !/function ease\s*\(/.test(src)) {
    const easeDef =
      `    function ease(name, t) {\n` +
      `      if (name === 'sharp') return Math.pow(t, 0.4);\n` +
      `      if (name === 'soft') return t * t * (3 - 2 * t);\n` +
      `      if (name === 'smooth') return t;\n` +
      `      return t;\n` +
      `    }\n`;
    // Insert right after the IIFE's `const clamp = …;` line.
    const anchor = src.match(/(\s*const clamp = \(v,lo,hi\) => Math\.max\(lo,Math\.min\(hi,v\)\);)/);
    if (anchor) src = src.replace(anchor[0], anchor[0] + '\n' + easeDef);
  }

  // ---- 6. hook Layers.render to mark the cache dirty on changes -------
  if (!/SWR_RENDER\.invalidate/.test(src)) {
    // Find `Layers.render = function() { … }` and append an invalidate call.
    // If `Layers.render = function` doesn't exist (it's a method literal),
    // wrap it via SWR_RENDER.invalidateAll. Simpler: append the line after
    // the Layers.add call chain — but that's brittle. Do it via a hook on
    // the function reference at module level.
    //
    // We rely on the page calling SWR_RENDER.markDirty() in its own places
    // (Layers.add / Layers.rm / Layers.remap). But the cleanest path: append
    // a single line at the end of the IIFE that monkey-patches Layers.render.
    //
    // Locate the `window.SWR = { ... }` line, insert just before it.
    const swrRe = /window\.SWR\s*=\s*\{/;
    if (swrRe.test(src)) {
      const hook = `    // Invalidate the per-layer cache whenever the page rebuilds.\n` +
                    `    if (Layers && typeof Layers.render === 'function') {\n` +
                    `      const __r = Layers.render.bind(Layers);\n` +
                    `      Layers.render = function () { try { SWR_RENDER.invalidate(); } catch (_) {} return __r(); };\n` +
                    `    }\n`;
      src = src.replace(swrRe, hook + '    window.SWR = {');
    }
  }

  if (src === before) { console.log(`  ${name}.html: no change`); skipped++; continue; }

  fs.writeFileSync(file, src, 'utf8');
  // Sanity: the new block is present.
  const ok = src.includes('SWR_RENDER.frame(') && src.includes('SWR_RENDER.fit(stage)');
  if (!ok) { console.log(`  ${name}.html: WROTE but verification failed`); unparsed.push(name); continue; }
  console.log(`  ${name}.html: patched (DPR + cache + invalidate hook)`);
  patched++;
}

console.log(`\n${patched} patched, ${skipped} skipped, ${failed} failed` + (unparsed.length ? `, ${unparsed.length} unparsed: ${unparsed.join(',')}` : ''));
process.exit(failed || unparsed.length ? 1 : 0);
