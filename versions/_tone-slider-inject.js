#!/usr/bin/env node
// versions/_tone-slider-inject.js — codemod: mount the tone/desaturation
// slider (lib/tone-slider.client.js) on every variant that carries the FX
// intensity control and a renderer that consumes the u_tone grade:
//   - fx-postprocess.js pages   → window.FX.setTone (overlay u_tone)
//   - versions-presets.js pages → window.SWR_FX_TONE (FRAG u_tone)
//
//   node versions/_tone-slider-inject.js
//
// Idempotent: re-runs skip pages that already carry data-fx-tone-mount.

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MOUNT = '<span data-fx-tone-mount></span>';
const SCRIPT = '<script src="../lib/tone-slider.client.js" defer></script>';

const MOUNT_RE = /([ \t]*)<span data-fx-intensity-mount><\/span>/;
const SCRIPT_RE = /([ \t]*)<script src="\.\.\/lib\/intensity-slider\.client\.js" defer><\/script>/;

let patched = 0, skipped = 0, manual = 0;
for (const f of fs.readdirSync(__dirname).filter((x) => x.endsWith('.html'))) {
  const p = path.join(__dirname, f);
  let s = fs.readFileSync(p, 'utf8');
  if (s.includes('data-fx-tone-mount') || s.includes('tone-slider.client.js')) { skipped++; continue; }
  if (!s.includes('intensity-slider')) { skipped++; continue; }
  if (!s.includes('fx-postprocess') && !s.includes('versions-presets')) {
    console.log('  no tone consumer:', f); manual++; continue;
  }
  if (!MOUNT_RE.test(s) || !SCRIPT_RE.test(s)) {
    console.log('  anchor missing (manual):', f); manual++; continue;
  }
  s = s.replace(MOUNT_RE, (m, ind) => m + '\n' + ind + MOUNT);
  s = s.replace(SCRIPT_RE, (m, ind) => m + '\n' + ind + SCRIPT);
  fs.writeFileSync(p, s);
  patched++; console.log('  patched:', f);
}
console.log('  ' + patched + ' patched, ' + skipped + ' skipped, ' + manual + ' manual');
