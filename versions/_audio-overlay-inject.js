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
const TARGETS = [
  { file: 'eclipse.html',     song: '../audios/eclipse.mp3' },
  { file: 'film.html',        song: '../audios/film.mp3' },
  { file: 'grid.html',        song: '../audios/grid.mp3' },
  { file: 'hallucination.html', song: '../audios/hallucination.mp3' },
  { file: 'neon.html',        song: '../audios/neon.mp3' },
  { file: 'smoke.html',       song: '../audios/smoke.mp3' },
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
      } catch (e) {
        if (sub) sub.textContent = 'tap "load song" to start';
        console.warn('swr auto-start failed:', e);
      }
      overlay.classList.add('hide');
      setTimeout(function(){ overlay.remove(); }, 600);
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
  const HAS_V3_PATTERN  = /function waitForPick/.test(src);
  const HAS_V2_PATTERN  = /canAutoplay|swr\.audio\.armed/.test(src) && !HAS_V3_PATTERN;
  const HAS_V1_PATTERN  = src.includes('id="swr-start"') && !HAS_V2_PATTERN;
  const HAS_BROKEN_OVERLAY_CLICK = /overlay\.addEventListener\('click',\s*start,\s*\{\s*once:\s*true\s*\}\);/.test(src);

  if (HAS_V3_PATTERN) {
    console.log(`  ${target.file}: already patched (v3)`);
    alreadyPatched++;
    continue;
  }

  // For pages with v1 (broken) or v2 (race-condition) pattern, repair
  // by replacing the entire overlay IIFE block. The shape is consistent
  // across all 6 patched pages: an inline <script>...</script> block
  // that contains the overlay IIFE.
  if (HAS_BROKEN_OVERLAY_CLICK || HAS_V2_PATTERN) {
    const brokenRe = /(  <div id="swr-start"[\s\S]*?  \}\)\(\);\n  <\/script>\n)/;
    const bm = src.match(brokenRe);
    if (bm) {
      src = src.replace(bm[1], buildOverlay(target.song) + '\n');
      console.log(`  ${target.file}: repaired v${HAS_BROKEN_OVERLAY_CLICK ? '1' : '2'} → v3 overlay`);
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
