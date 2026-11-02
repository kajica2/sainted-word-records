// Regression checks for NEON transient detection. Run with node scripts/check-neon-audio-v3.mjs
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
const src = readFileSync(new URL('../versions/neon.html', import.meta.url), 'utf8');
for (const [name, pattern] of [
  ['beat debounce state', /lastBeatAt:-Infinity/],
  ['onset debounce state', /lastOnsetAt:-Infinity/],
  ['beat refractory interval', /now - this\.hist\.lastBeatAt >= 0\.22/],
  ['onset refractory interval', /now - this\.hist\.lastOnsetAt >= 0\.08/],
  ['valid tempo range', /a >= 1\/3 && a <= 1/],
  ['zero-band guard', /return c \? s\/c\/255 : 0/],
  ['original reactor contract', /this\.feat\.beatPulse = beatHit; this\.feat\.onsetPulse = onsetHit/]
]) {
  assert.match(src, pattern, name);
  console.log('PASS', name);
}
