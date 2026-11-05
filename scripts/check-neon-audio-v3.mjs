// Regression checks for the transient detection. Run with node scripts/check-neon-audio-v3.mjs
//
// These checks used to read versions/neon.html, which carried its own inline
// audio object. Neon now runs the engine's audio core (lib/audio.client.js),
// so the behaviour lives there — and the engine gets it too.
import { readFileSync } from 'node:fs';
import assert from 'node:assert';
const src = readFileSync(new URL('../lib/audio.client.js', import.meta.url), 'utf8');
for (const [name, pattern] of [
  ['beat debounce state', /lastBeatAt: -Infinity/],
  ['onset debounce state', /lastOnsetAt: -Infinity/],
  ['beat refractory interval', /this\.clock - this\.history\.lastBeatAt >= 0\.22/],
  ['onset refractory interval', /this\.clock - this\.history\.lastOnsetAt >= 0\.08/],
  ['valid tempo range', /avg >= 1 \/ 3 && avg <= 1/],
  ['zero-band guard', /return c \? s \/ c \/ 255 : 0/],
  ['frame-independent envelopes', /Math\.exp\(-dt \/ tau\)/],
  ['five frequency bands', /\['sub', 'bass', 'mid', 'treble', 'air'\]/],
  ['fast attack', /smooth\(previous, raw, 0\.045, 0\.24\)/],
  ['tempo bound on the autocorrelation path', /v2bpm >= 60 && v2bpm <= 180/],
  ['tempo bound on the offline path', /result\.bpm >= 60 && result\.bpm <= 180/],
  ['reset envelope state on load', /lastSampleAt: null/],
  ['one reset path, so the stamps survive', /resetHistory\(\)/],
  ['original reactor contract', /this\.feat\.beatPulse\s+= beatHit;\s*this\.feat\.onsetPulse = onsetHit/]
]) {
  assert.match(src, pattern, name);
  console.log('PASS', name);
}

// The stamps have to survive a song load. A reset that rebuilds `history`
// without them drops the fields to undefined, and `clock - undefined` is
// NaN — which silently stops every beat.
{
  const resets = src.match(/this\.history = /g) || [];
  assert.equal(resets.length, 1, 'history must be rebuilt in exactly one place: resetHistory()');
  const resetBody = /resetHistory\(\) \{([\s\S]*?)\n {4}\}/.exec(src);
  assert.ok(resetBody, 'resetHistory() not found');
  for (const field of ['lastBeatAt', 'lastOnsetAt', 'lastSampleAt']) {
    assert.ok(resetBody[1].includes(field), `resetHistory() must restore ${field}`);
  }
  console.log('PASS resetHistory keeps the timing stamps');
}
