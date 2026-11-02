// NEON Phase 1 static regression guard. Run: node scripts/check-neon-v2-phase1.mjs
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const src = readFileSync(new URL('../versions/neon.html', import.meta.url), 'utf8');
const checks = [
  ['legacy startup accent', /--r:\s*var\(--m\)/],
  ['dynamic viewport height', /height:\s*100dvh/],
  ['bounded desktop grid stage', /grid-template-rows:\s*44px minmax\(0, 1fr\) 36px/],
  ['startup focusable', /id="swr-start"[^>]*tabindex="0"/],
  ['startup keyboard activation', /event\.key === 'Enter' \|\| event\.key === ' '/],
  ['reduced motion support', /prefers-reduced-motion:\s*reduce/],
  ['existing playback control retained', /id="play"/],
  ['existing recording control retained', /id="rec"/],
  ['existing automix control retained', /id="automix-toggle"/]
];
for (const [name, re] of checks) {
  assert.match(src, re, name);
  console.log('PASS:', name);
}
console.log('NEON phase 1 static guard passed (' + checks.length + ' checks)');
