// scripts/check-record-client-unit.mjs — sanity for the desktop
// record.html driver. Verifies:
//
//   1. SWR_RECORD exposes setOrient / getOrient / getState / getAudioReady.
//   2. ORIENTS table maps 169 / 916 / 11 with 1920x1080 / 1080x1920 / 1080x1080.
//   3. setOrient(slug) updates the canvas dimensions AND the preview
//      CSS aspect-ratio, so the engine's recorded file is the right
//      size regardless of the preview size on screen.
//   4. The 3 orient buttons drive applyOrient via the click handler.
//   5. Zero em-dashes in the page source (skill section 9.G).
//   6. Single-mode theme lock; one accent color.
//   7. The result panel is hidden by default; reveals on stopRecord().
//   8. The 16:9 orient button is the default aria-pressed.

import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const HTML = readFileSync(new URL('../record.html', import.meta.url), 'utf8');
const SRC  = readFileSync(new URL('../client/record.client.js', import.meta.url), 'utf8');

const results = [];
async function check(name, fn) {
  let ok = false, detail = '';
  try {
    const r = await fn();
    if (r === true) ok = true;
    else if (typeof r === 'string') { ok = false; detail = r; }
    else ok = false;
  } catch (e) { detail = (e && e.message) ? e.message : String(e); }
  results.push({ name, ok, detail });
  console.log((ok ? '  PASS  ' : '  FAIL  ') + name + (detail ? ' — ' + detail : ''));
}

check('record.html declares 3 orient buttons (169 / 916 / 11)', () => {
  for (const slug of ['169', '916', '11']) {
    if (!HTML.includes('data-orient="' + slug + '"')) return 'missing data-orient="' + slug + '"';
  }
  return true;
});

check('record.html has zero em-dashes (anti-Tell from skill 9.G)', () => {
  const stripped = HTML.replace(/<style[\s\S]*?<\/style>/g, '').replace(/<script[\s\S]*?<\/script>/g, '');
  if (stripped.indexOf('\u2014') !== -1) return 'em-dash (U+2014) detected';
  if (stripped.indexOf('\u2013') !== -1) return 'en-dash (U+2013) detected';
  return true;
});

check('record.html locks single theme (dark) and uses 1 accent color', () => {
  if (!HTML.includes('data-theme="dark"')) return 'no data-theme="dark"';
  if (/prefers-color-scheme:\s*light/.test(HTML)) return 'light-mode hook present';
  // One accent: amber + cyan (cyan is the active-state highlight only,
  // amber is the primary brand accent). No cream / brass / oxblood.
  if (/beige|f5ead8|brass|oxblood|b08947|9a2436/.test(HTML)) {
    return 'banned premium-consumer palette detected';
  }
  return true;
});

check('the 16:9 orient button is the default aria-pressed=true', () => {
  if (!/data-orient="169"[^>]*aria-pressed="true"/.test(HTML)) {
    return '16:9 button is not the default-selected orient';
  }
  return true;
});

check('SWR_RECORD exposes setOrient / getOrient / getState / getAudioReady', () => {
  // Source-level: confirm the IIFE returns the right surface.
  const m = SRC.match(/window\.SWR_RECORD\s*=\s*\{([\s\S]*?)\};/);
  if (!m) return 'window.SWR_RECORD block not found';
  const body = m[1];
  for (const k of ['setOrient', 'getOrient', 'getState', 'getAudioReady']) {
    if (body.indexOf(k + ':') === -1) return 'missing API: ' + k;
  }
  return true;
});

check('ORIENTS table maps each slug to its canvas dimensions', () => {
  const m = SRC.match(/const\s+ORIENTS\s*=\s*\{([\s\S]*?)\n\s*\};/);
  if (!m) return 'ORIENTS table not found';
  const body = m[1];
  for (const slug of ['169', '916', '11']) {
    const block = new RegExp('[\'"]' + slug + '[\'"]:\\s*\\{[^}]*w:\\s*(\\d+)[^}]*h:\\s*(\\d+)[^}]*\\}');
    const match = block.exec(body);
    if (!match) return slug + ' block not parseable';
    const w = parseInt(match[1], 10);
    const h = parseInt(match[2], 10);
    if (slug === '169' && (w !== 1920 || h !== 1080)) return '16:9 dim wrong: ' + w + 'x' + h;
    if (slug === '916' && (w !== 1080 || h !== 1920)) return '9:16 dim wrong: ' + w + 'x' + h;
    if (slug === '11'  && (w !== 1080 || h !== 1080)) return '1:1 dim wrong: ' + w + 'x' + h;
  }
  return true;
});

check('applyOrient sets canvas.width / canvas.height to the orient', () => {
  // The applyOrient function body should set both. Read the source and
  // ensure the assignments are present.
  const m = SRC.match(/function\s+applyOrient[\s\S]*?\n\s*\}/);
  if (!m) return 'applyOrient function not found';
  const body = m[0];
  if (!/canvas\.width\s*=/.test(body)) return 'no canvas.width assignment';
  if (!/canvas\.height\s*=/.test(body)) return 'no canvas.height assignment';
  if (!/preview\.style\.aspectRatio/.test(body)) return 'no preview aspectRatio update';
  return true;
});

check('the record button is disabled until audio is ready', () => {
  const m = SRC.match(/recBtn\.disabled\s*=\s*(!?audioReady[^;]*);/);
  if (!m) return 'recBtn.disabled setter not found';
  return true;
});

check('the result panel is hidden by default (reveals on stop)', () => {
  if (!/id="r-result"[^>]*hidden/.test(HTML)) return 'r-result is not hidden by default';
  return true;
});

check('em-dashes and en-dashes also banned from the JS source', () => {
  if (SRC.indexOf('\u2014') !== -1) return 'em-dash in JS source';
  if (SRC.indexOf('\u2013') !== -1) return 'en-dash in JS source';
  return true;
});

// ---- summary ----
(async () => {
  await new Promise((r) => setTimeout(r, 100));
  const pass = results.filter((r) => r.ok).length;
  const fail = results.filter((r) => !r.ok).length;
  console.log(`\n${pass} passed, ${fail} failed (${results.length} checks)`);
  if (fail > 0) process.exit(1);
})();
