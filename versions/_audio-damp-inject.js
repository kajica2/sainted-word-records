// versions/_audio-damp-inject.js — codemod: load lib/audio-damp.client.js in every
// set renderer.
//
// Why: lib/audio-damp.client.js exists precisely for this repo's jitter problem —
// its own header says "Each variant reads A.feat.{bass,mid,...} directly in its
// drawLayer / applyR, which makes values jitter on every frame (audio analyser
// quantizes noisily even when nothing is changing)" — and no page loaded it.
// Pages that call it guarded (`window.SWR_AUDIO_DAMP && SWR_AUDIO_DAMP.damp`),
// like versions/neon.html's beat pulse, silently fell through to the raw value:
// a full-canvas magenta wash restrobed every frame. Reactors fed raw features
// into rot/hue/brightness/scale, so layers twitched on the spot.
//
// Idempotent: a page already carrying the tag (or the marker) is skipped.
// Not loaded by any page. Run it manually:
//
//   node versions/_audio-damp-inject.js --dry-run
//   node versions/_audio-damp-inject.js
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR = path.dirname(fileURLToPath(import.meta.url));
const MARKER = '<!-- SWR-AUDIO-DAMP-MARKER -->';
const TAG = MARKER + '\n<script src="../lib/audio-damp.client.js"></script>';

const dry = process.argv.includes('--dry-run');
let injected = 0, skipped = 0;

for (const name of fs.readdirSync(DIR).filter((f) => f.endsWith('.html')).sort()) {
  const file = path.join(DIR, name);
  let src = fs.readFileSync(file, 'utf8');
  if (src.includes(MARKER)) { skipped++; continue; }
  const at = src.lastIndexOf('</body>');
  if (at === -1) { console.log(`skip: ${name} (no </body>)`); skipped++; continue; }
  // Load it before the page's own scripts run their first frame: place it beside
  // the other lib/ tags near the end of body, after any existing markers.
  src = src.slice(0, at) + TAG + '\n' + src.slice(at);
  if (!dry) fs.writeFileSync(file, src);
  injected++;
  console.log(`damp: ${name}`);
}

console.log(`\n${dry ? '[dry-run] ' : ''}${injected} page(s) injected, ${skipped} skipped`);
