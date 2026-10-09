#!/usr/bin/env node
// versions/_drive-inject.js — codemod: add Google Drive import button
// and modal to every variant page.
//
// Required additions:
//   1. CSS: <link rel="stylesheet" href="/lib/drive-modal.css">
//   2. Scripts: google-drive.client.js, drive-modal.client.js
//   3. Button: #swr-drive-btn next to the load-song button
//   4. Click handler: inline script to open modal
//
// Usage:
//   node versions/_drive-inject.js [--dry-run]
//
// Idempotent: skips pages that already have swr-drive-btn

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DRY_RUN = process.argv.includes('--dry-run');

// Patterns to inject
const CSS_LINK = '<link rel="stylesheet" href="/lib/drive-modal.css" />';
const AUTH_SCRIPT = '<script src="/lib/auth.client.js" defer></script>';
const GDRIVE_SCRIPT = '<script src="/lib/google-drive.client.js" defer></script>';
const MODAL_SCRIPT = '<script src="/lib/drive-modal.client.js" defer></script>';

// Button to add after load-song button
const DRIVE_BTN = '<button type="button" id="swr-drive-btn" class="tbtn ghost" title="Import from Google Drive">Drive</button>';

// Click handler script - includes auto-OAuth flow
const DRIVE_HANDLER = `
  <script>
    (function() {
      var driveBtn = document.getElementById('swr-drive-btn');
      if (!driveBtn) return;

      function getDriveState() {
        return window.SWR_AUTH ? window.SWR_AUTH.get() : Promise.resolve(null);
      }

      function updateBtnState(user) {
        if (!user) {
          driveBtn.title = 'Sign in to import from Google Drive';
          driveBtn.style.opacity = '0.4';
        } else if (!user.googleDriveLinkedAt) {
          driveBtn.title = 'Connect Google Drive to import files';
          driveBtn.style.opacity = '0.7';
        } else {
          driveBtn.title = 'Import from Google Drive';
          driveBtn.style.opacity = '1';
        }
      }

      // Bootstrap: check session and listen for auth changes.
      if (window.SWR_AUTH) {
        getDriveState().then(updateBtnState);
        window.SWR_AUTH.onChange(updateBtnState);
      } else {
        driveBtn.title = 'Sign in to import from Google Drive';
        driveBtn.style.opacity = '0.4';
      }

      driveBtn.addEventListener('click', function() {
        getDriveState().then(function(user) {
          if (!user) {
            // Not logged in → redirect to login with return path.
            var returnTo = encodeURIComponent(location.pathname);
            location.href = '/auth/login?redirect=' + returnTo;
            return;
          }
          if (!user.googleDriveLinkedAt) {
            // Drive not linked → initiate OAuth in popup.
            if (window.SWR_GDRIVE) {
              window.SWR_GDRIVE.link(location.pathname)
                .then(function() { updateBtnState(Object.assign({}, user, { googleDriveLinkedAt: new Date().toISOString() })); })
                .catch(function(e) {
                  if (e.message !== 'popup_blocked' && e.message !== 'oauth_timeout') {
                    console.warn('[drive] link error:', e);
                  }
                });
            }
            return;
          }
          // Drive linked → open browser modal.
          if (window.SWR_DRIVE_MODAL) {
            window.SWR_DRIVE_MODAL.show();
          }
        });
      });
    })();
  </script>`;

// Regex patterns
const CSS_RE = /<link rel="stylesheet" href="\/lib\/drive-modal.css" \/>/;
const AUTH_RE = /<script src="\/lib\/auth\.client\.js"/;
const GDRIVE_RE = /<script src="\/lib\/google-drive\.client\.js"/;
const MODAL_RE = /<script src="\/lib\/drive-modal\.client\.js"/;
const BTN_RE = /id="swr-drive-btn"/;
const LOAD_SONG_RE = /<button[^>]*id="load-song"[^>]*>/;
const BODY_CLOSE_RE = /<\/body>/;

let patched = 0, skipped = 0, errors = 0;

for (const f of fs.readdirSync(__dirname).filter((x) => x.endsWith('.html'))) {
  // Skip non-variant pages
  if (f === 'index.html' || f === 'gallery.html' || f === 'console.html' ||
      f === 'music_video.html' || f === 'music_video_mtv.html' || 
      f === 'music-video-gallery.html' || f === 'bachdrop.html') {
    skipped++;
    continue;
  }

  const p = path.join(__dirname, f);
  let s = fs.readFileSync(p, 'utf8');

  // Skip if already has drive button
  if (BTN_RE.test(s)) {
    skipped++;
    continue;
  }

  // Skip if no load-song button (not a variant with media)
  if (!LOAD_SONG_RE.test(s)) {
    console.log('  no load-song:', f);
    skipped++;
    continue;
  }

  try {
    // 1. Add CSS after existing stylesheets
    if (!CSS_RE.test(s)) {
      // Find a </head> or the last <link> to insert after
      const lastLink = s.match(/<link[^>]*href="\/lib\/[^"]*"[^>]*>/);
      if (lastLink) {
        s = s.replace(lastLink[0], lastLink[0] + '\n  ' + CSS_LINK);
      } else if (s.includes('</head>')) {
        s = s.replace('</head>', '  ' + CSS_LINK + '\n</head>');
      }
    }

    // 2. Add scripts before </body>
    if (!GDRIVE_RE.test(s)) {
      s = s.replace('</body>', AUTH_SCRIPT + '\n' + GDRIVE_SCRIPT + '\n  ' + MODAL_SCRIPT + '\n</body>');
    }

    // 3. Add button after </button> of load-song (not inside it)
    // Find load-song button and its closing tag
    const loadSongMatch = s.match(/(<button[^>]*id="load-song"[^>]*>[\s\S]*?)<\/button>/);
    if (loadSongMatch) {
      const afterButton = loadSongMatch[1] + '</button>\n      ' + DRIVE_BTN;
      s = s.replace(loadSongMatch[0], afterButton);
    }

    // 4. Add click handler before </body>
    s = s.replace('</body>', DRIVE_HANDLER + '\n</body>');

    if (!DRY_RUN) {
      fs.writeFileSync(p, s);
    }
    patched++;
    console.log(DRY_RUN ? '  would patch:' : '  patched:', f);
  } catch (e) {
    errors++;
    console.log('  error:', f, e.message);
  }
}

console.log('  ' + patched + ' patched, ' + skipped + ' skipped, ' + errors + ' errors');
if (DRY_RUN) console.log('  (dry run — no files written)');
