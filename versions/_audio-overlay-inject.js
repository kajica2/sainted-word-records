#!/usr/bin/env node
// versions/_audio-overlay-inject.js — codemod: add the swr-start
// auto-load overlay + IIFE to versions/*.html pages that ship
// without one. Mirrors the pattern in versions/fractal.html,
// grid.html, neon.html, etc.
//
// Why: browser autoplay policy requires one user gesture before
// AudioContext can play. The auto-start overlay gives the user
// a single click that loads the last-used song (from IndexedDB,
// via SWR_PICK_DEFAULT_SONG from last-song.js) OR falls back to
// the per-page bundled audios/<name>.mp3. Without this overlay,
// window.SWR.Audio.el stays null on a fresh visit and any test
// or production flow that expects audio to be loaded fails.
//
//   node versions/_audio-overlay-inject.js
//
// Idempotent: re-runs report "skipped" for pages already patched.

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Pages known to be missing the auto-load overlay. gallery.html is
// excluded — it's a marketing page that links TO engines, not an
// engine page itself (no engine IIFE, no SWR, no Audio module).
//
// The 13 main reactive engines + collage (which loads library media
// in panels). The 3 decorative engines (spectrum/typography/collage)
// have hard-coded DEFAULT_SONGs pointing to MP3s that were never
// created (collage.mp3 / spectrum.mp3 / typography.mp3 don't exist
// in audios/). They fall back to the shared loop WAVs that the other
// decorative engines use — same shape as the engine, just no bespoke
// demo audio.
const TARGETS = [
  // 13 main reactive engines
  { file: 'aurora.html',         song: '../audios/aurora.mp3' },
  { file: 'chrome.html',         song: '../audios/chrome.mp3' },
  { file: 'eclipse.html',        song: '../audios/eclipse.mp3' },
  { file: 'film.html',           song: '../audios/film.mp3' },
  { file: 'fractal.html',        song: '../audios/fractal.mp3' },
  { file: 'glitch.html',         song: '../audios/glitch.mp3' },
  { file: 'grid.html',           song: '../audios/grid.mp3' },
  { file: 'hallucination.html',  song: '../audios/hallucination.mp3' },
  { file: 'neon.html',           song: '../audios/neon.mp3' },
  { file: 'pulse.html',          song: '../audios/pulse.mp3' },
  { file: 'smoke.html',          song: '../audios/smoke.mp3' },
  { file: 'void.html',           song: '../audios/void.mp3' },
  { file: 'watercolor.html',     song: '../audios/watercolor.mp3' },
  // collage has a real library pipeline (panels load clips + video)
  // but its bespoke collage.mp3 was never created. Fall back to
  // loop-grain.wav so the auto-start actually plays something.
  { file: 'collage.html',        song: '../library/audio/loop-grain.wav' },
  // Decorative engines with missing demo audio. Each gets a loop
  // that suits its visual (loop-demo for the spectrum visualizer,
  // loop-shimmer for the typography temperature slider).
  { file: 'spectrum.html',       song: '../library/audio/loop-demo.wav' },
  { file: 'typography.html',     song: '../library/audio/loop-shimmer.wav' },
];

// CSS block to inject right before </style>. Matches the
// fractal/aurora/etc. style block exactly (these 5 pages use the
// same engine CSS scaffold).
const CSS_BLOCK = `
    /* AUTO-START overlay (browser autoplay policy requires one user gesture) */
    #swr-start {
      position: fixed; inset: 0; z-index: 10000;
      display: flex; align-items: center; justify-content: center;
      background: rgba(0,0,0,0.78);
      cursor: pointer;
      transition: opacity 0.4s ease;
    }
    #swr-start .box {
      text-align: center; color: var(--ink);
      font-family: ui-monospace, monospace;
      padding: 28px 36px;
      border: 1px solid var(--r);
      background: rgba(0,0,0,0.65);
      box-shadow: 0 0 32px var(--r);
    }
    #swr-start .arrow { font-size: 56px; color: var(--r); line-height: 1; margin-bottom: 14px; }
    #swr-start .label { font-size: 13px; letter-spacing: 0.32em; text-transform: uppercase; color: var(--ink); }
    #swr-start .sub   { font-size: 9px;  letter-spacing: 0.18em; text-transform: uppercase; color: var(--g); margin-top: 8px; }
    #swr-start.hide { opacity: 0; pointer-events: none; }
`;

// HTML overlay + IIFE to inject right after the last </div> in the
// page body (just before the <script src="./last-song.js"> tag).
function buildOverlay(defaultSong) {
  return `
  <div id="swr-start" role="button" aria-label="Start Sainted Word Records">
    <div class="box">
      <div class="arrow">▶</div>
      <div class="label">Drop a song</div>
      <div class="sub" id="swr-start-sub">Radio + Video</div>
    </div>
  </div>
  <script>
  (function(){
    var DEFAULT_SONG = '${defaultSong}';
    var overlay = document.getElementById('swr-start');
    var sub = document.getElementById('swr-start-sub');
    var fired = false;

    // Can we autoplay without a user gesture? Modern browsers
    // (Chrome 94+, Safari 16.4+, Firefox 121+) relax autoplay for
    // sites the user has interacted with before. The MediaSession
    // API surfaces a "activation hint" — non-empty activation
    // means the user has clicked/tapped/typed since the page loaded,
    // and we can autoplay. On pages where this is true, run start()
    // immediately and skip the overlay.
    var canAutoplay = false;
    try {
      if (navigator.userActivation && navigator.userActivation.isActive) {
        canAutoplay = true;
      }
    } catch (_) {}

    async function start() {
      if (fired) return;
      fired = true;
      var succeeded = false;
      try {
        // Prefer the user's last-loaded song (from engine.html IDB),
        // fall back to the per-page bundled audio.
        var picked = window.SWR_PICK_DEFAULT_SONG
          ? await window.SWR_PICK_DEFAULT_SONG(DEFAULT_SONG)
          : null;
        if (!picked) throw new Error('no song source available');
        var blob = picked.blob;
        var name = picked.name;
        var file = new File([blob], name, { type: blob.type || picked.type || 'audio/mpeg' });
        if (window.SWR && window.SWR.Audio) {
          window.SWR.Audio.load(file);
          await window.SWR.Audio.play();
          if (sub) {
            var tag = picked.source === 'saved' ? 'last song · ' : 'playing · ';
            sub.textContent = tag + name;
          }
        }
        succeeded = true;
      } catch (e) {
        // Failure path: leave the overlay visible so the user can
        // click again. Reset the fired flag so the click handler
        // can fire a fresh attempt. Without this, a single failed
        // autoplay leaves the user stranded — the overlay disappears
        // and the "tap to start" hint vanishes with it. This is the
        // exact "media is not loading" symptom we were trying to
        // avoid.
        fired = false;
        if (sub) sub.textContent = 'tap "load song" to start';
        console.warn('swr auto-start failed:', e);
      }
      // Only hide + remove the overlay on success. The overlay is
      // the manual fallback for browsers that still block autoplay;
      // removing it on failure strands the user with no retry path.
      if (succeeded) {
        overlay.classList.add('hide');
        setTimeout(function(){ overlay.remove(); }, 600);
      }
    }

    // Track a one-shot user gesture anywhere on the page to arm the
    // audio for next time. Once armed, the overlay can autoplay.
    document.addEventListener('pointerdown', function arm() {
      try { localStorage.setItem('swr.audio.armed', '1'); } catch (_) {}
    }, { once: true, capture: true });

    if (canAutoplay || (function () {
      try { return localStorage.getItem('swr.audio.armed') === '1'; }
      catch (_) { return false; }
    })()) {
      // Try to autoplay immediately — if the browser blocks, the
      // overlay stays visible (start()'s catch path) and the user
      // can click it manually. Either way, the engine renders
      // visual content on enter via the normal RAF loop.
      //
      // Wait for window.SWR_PICK_DEFAULT_SONG to be defined —
      // last-song.js (which defines it) loads AFTER this inline
      // script. Poll until it's there, then fire. This avoids the
      // race where the auto-start fires before last-song.js has
      // registered the helper.
      function waitForPick() {
        if (window.SWR_PICK_DEFAULT_SONG) {
          start();
          return;
        }
        var tries = 0;
        var iv = setInterval(function() {
          tries++;
          if (window.SWR_PICK_DEFAULT_SONG) {
            clearInterval(iv);
            start();
          } else if (tries > 50) {  // ~5s timeout
            clearInterval(iv);
            // Don't fire — overlay stays as fallback.
          }
        }, 100);
      }
      waitForPick();
    }

    // If the autoplay attempt didn't fire the overlay (because
    // play() resolved), keep the overlay visible until the user
    // explicitly hides it. The overlay remains the manual fallback
    // for browsers that still block autoplay.
    overlay.addEventListener('click', function manualStart() {
      if (!fired) start();
    });
    document.addEventListener('keydown', function(ev){
      if (!fired && (ev.key === 'Enter' || ev.key === ' ')) { ev.preventDefault(); start(); }
    }, { once: true });
  })();
  </script>
`;
}

let patched = 0, skipped = 0, failed = 0, alreadyPatched = 0;

for (const target of TARGETS) {
  const file = path.join(__dirname, target.file);
  if (!fs.existsSync(file)) { console.log(`  ${target.file}: MISSING`); failed++; continue; }
  let src = fs.readFileSync(file, 'utf8');
  const before = src;

  // Idempotency: a page is "already patched" only if it has the
  // v3 pattern (with the waitForPick race fix). The v1 pattern
  // (just the click handler) and the v2 pattern (no race fix) get
  // re-patched.
  // v3-with-failure-fix: the current canonical overlay. Has the
  // `var succeeded = false;` guard plus the conditional hide+remove.
  // Pages that match this are up-to-date — skip.
  // v3-without-fix: the original v3 from commit 7d9bb75. Has
  // `function waitForPick` but lacks the failure-path guard. Needs
  // re-patch to upgrade.
  const HAS_V3_FIXED = /var succeeded = false;/.test(src);
  const HAS_V3_OLD   = /function waitForPick/.test(src) && !HAS_V3_FIXED;
  const HAS_V2_PATTERN  = /canAutoplay|swr\.audio\.armed/.test(src) && !HAS_V3_OLD && !HAS_V3_FIXED;
  const HAS_V1_PATTERN  = src.includes('id="swr-start"') && !HAS_V2_PATTERN;
  const HAS_BROKEN_OVERLAY_CLICK = /overlay\.addEventListener\('click',\s*start,\s*\{\s*once:\s*true\s*\}\);/.test(src);

  if (HAS_V3_FIXED) {
    console.log(`  ${target.file}: already patched (v3 with failure fix)`);
    alreadyPatched++;
    continue;
  }

  // v3-without-fix gets re-patched: the codemod will replace the
  // entire overlay block with the canonical template (which now
  // includes the failure-path guard). The HAS_BROKEN_OVERLAY_CLICK
  // check below intentionally does NOT match v3-old (no
  // `once: true` on the click handler), so we use HAS_V3_OLD as an
  // additional repair trigger.
  const NEEDS_REPAIR = HAS_BROKEN_OVERLAY_CLICK || HAS_V2_PATTERN || HAS_V3_OLD;

  // For pages with v1 (broken), v2 (race-condition), or v3-old
  // (missing the failure-path fix) pattern, repair by replacing
  // the entire overlay IIFE block. The shape is consistent across
  // all patched pages: an inline <script>...</script> block that
  // contains the overlay IIFE.
  if (NEEDS_REPAIR) {
    // The original v1 overlay block: <div id="swr-start" ...></div>
    // followed by a <script> IIFE that ends with `})();\n</script>`.
    // The exact whitespace before <div>, before })(), and before
    // </script> varies across the 13+8 engines (some pages indent by
    // 2 spaces, some have <div> flush with the previous line). Match
    // any whitespace, not a fixed indent.
    //
    // Capture group required — bm[1] is the matched text, not the
    // regex match object. Without `()`, bm[1] is undefined and
    // String.replace(undefined, …) would replace the literal
    // "undefined" somewhere in the page (e.g. `typeof x !==
    // 'undefined'`).
    const brokenRe = /(<div id="swr-start"[\s\S]*?\}\)\(\);\s*<\/script>)/;
    const bm = src.match(brokenRe);
    if (bm) {
      src = src.replace(bm[1], buildOverlay(target.song) + '\n');
      const fromVer = HAS_BROKEN_OVERLAY_CLICK ? '1' : (HAS_V2_PATTERN ? '2' : '3 (no failure fix)');
      console.log(`  ${target.file}: repaired v${fromVer} → v3 with failure fix`);
      if (src === before) { console.log(`  ${target.file}: no change`); skipped++; continue; }
      fs.writeFileSync(file, src, 'utf8');
      patched++;
      continue;
    } else {
      console.log(`  ${target.file}: broken pattern detected but regex didn't match`);
      failed++;
      continue;
    }
  }

  if (src.includes('id="swr-start"')) {
    // Some other version of the overlay is present; skip.
    console.log(`  ${target.file}: already patched (other)`);
    alreadyPatched++;
    continue;
  }

  // Inject CSS right before </style>. Every target page has exactly
  // one </style> tag in <head>. Use a simple string replace.
  if (!src.includes('</style>')) {
    console.log(`  ${target.file}: no </style> tag found`);
    failed++;
    continue;
  }
  src = src.replace('</style>', CSS_BLOCK + '  </style>');

  // Inject overlay + IIFE right before the last-song.js script tag.
  // Each target page has `<script src="./last-song.js"></script>`
  // and the overlay must come BEFORE it so SWR_PICK_DEFAULT_SONG
  // is already loaded when the IIFE runs.
  const lastSongTag = '<script src="./last-song.js"></script>';
  if (!src.includes(lastSongTag)) {
    console.log(`  ${target.file}: no last-song.js script tag`);
    failed++;
    continue;
  }
  src = src.replace(lastSongTag, buildOverlay(target.song) + '\n  ' + lastSongTag);

  if (src === before) { console.log(`  ${target.file}: no change`); skipped++; continue; }
  fs.writeFileSync(file, src, 'utf8');
  console.log(`  ${target.file}: patched`);
  patched++;
}

console.log(`\n${patched} patched, ${alreadyPatched} already patched, ${skipped} skipped, ${failed} failed`);
process.exit(failed ? 1 : 0);
