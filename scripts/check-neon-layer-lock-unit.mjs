// NEON layer lock + 3-layer cap. Run: node scripts/check-neon-layer-lock-unit.mjs
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const neon = readFileSync(new URL('../versions/neon.html', import.meta.url), 'utf8');
const root = readFileSync(new URL('../neon.html', import.meta.url), 'utf8');

const markers = [
  ['MAX constant', /Layers = \{ list: \[\], sel: null, MAX: 3,/],
  ['locked on add', /locked: false, reactors:/],
  ['toggleLock API', /toggleLock\(l\) \{/],
  ['lock button class', /className = 'lk'/],
  ['locked card class', /\(l\.locked\?' locked':''\)/],
  ['refuse remove while locked', /unlock to remove/],
  ['refuse assign while locked', /unlock to change media/],
  ['remap preserves locked', /if \(prev\[i\] && prev\[i\]\.locked\)/],
  ['roles capped to MAX', /\.slice\(0, max\)/],
  ['3 layers max status', /3 layers max/],
  ['position lock in applyR', /if \(l\.locked\) \{[\s\S]*?out\.scale = Number\.isFinite\(l\.baseScale\)/],
  ['lock-in-place status', /layer locked in place/],
];

for (const [name, re] of markers) {
  assert.match(neon, re, 'versions/neon.html: ' + name);
  assert.match(root, re, 'neon.html: ' + name);
  console.log('PASS:', name);
}

const schedSrc = readFileSync(new URL('../layer-scheduler.client.js', import.meta.url), 'utf8');
assert.match(schedSrc, /filter\(function \(l\) \{ return !l \|\| !l\.locked; \}\)/,
  'scheduler filters locked layers out of the pick list');
assert.match(schedSrc, /if \(!layer \|\| layer\.locked\) return false;/,
  'scheduler refuses a locked target in applySwap');
console.log('PASS: scheduler skips locked layers');

const imageMode = readFileSync(new URL('../client/automix-image-mode.client.js', import.meta.url), 'utf8');
assert.match(imageMode, /layer\.locked/, 'automix image mode skips locked layers');
console.log('PASS: automix image mode skips locked layers');

const demo = readFileSync(new URL('../client/neon-demo-panel.client.js', import.meta.url), 'utf8');
assert.match(demo, /layer:lock/, 'demo panel registers layer:lock');
assert.match(demo, /toggleLock/, 'demo panel calls Layers.toggleLock');
console.log('PASS: demo panel layer:lock control');

assert.match(neon, /Layers\.resolveTransform = applyR/, 'versions/neon.html exposes resolveTransform');
assert.match(root, /Layers\.resolveTransform = applyR/, 'neon.html exposes resolveTransform');
console.log('PASS: resolveTransform probe hook');

console.log('NEON layer lock unit passed (' + (markers.length + 4) + ' checks)');
