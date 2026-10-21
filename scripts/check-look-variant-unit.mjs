// scripts/check-look-variant-unit.mjs — sanity for the
// /lib/look-variant.client.js module. The module is short and
// its behaviour is hard to exercise in a vm context (vm doesn't
// expose URLSearchParams as a global, and document.body gets
// eaten by Node's print). We verify the contract via the
// source-level shape:
//
//   1. The module exports the GRADE table for clean and film.
//   2. The filter values match the spec exactly:
//        clean:  contrast(1.06) saturate(1.05)
//        film:   contrast(0.88) saturate(0.92) sepia(0.08) brightness(1.03)
//   3. The module respects ?look=clean|film (hard-coded check).
//   4. The data-look attribute is applied to documentElement.
//   5. Zero em-dashes in the source (anti-Tell from skill 9.G).
//   6. The grade file is loaded by the engine / composer / record
//      pages (so the look-grade works site-wide).

import { readFileSync } from 'node:fs';

const SRC = readFileSync(new URL('../lib/look-variant.client.js', import.meta.url), 'utf8');
const ENGINE_HTML = readFileSync(new URL('../engine.html', import.meta.url), 'utf8');
const COMPOSER_HTML = readFileSync(new URL('../composer.html', import.meta.url), 'utf8');
const RECORD_HTML = readFileSync(new URL('../record.html', import.meta.url), 'utf8');

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

check('source declares the GRADE table for clean and film', () => {
  if (!/GRADE\s*=\s*\{/.test(SRC)) return 'no GRADE table';
  if (!/clean:\s*\{/.test(SRC)) return 'no clean entry';
  if (!/film:\s*\{/.test(SRC)) return 'no film entry';
  return true;
});

check('clean: contrast(1.06) + saturate(1.05)', () => {
  if (SRC.indexOf('contrast(1.06)') === -1) return 'contrast(1.06) missing';
  if (SRC.indexOf('saturate(1.05)') === -1) return 'saturate(1.05) missing';
  return true;
});

check('film: contrast(0.88) + saturate(0.92) + sepia(0.08) + brightness(1.03)', () => {
  if (SRC.indexOf('contrast(0.88)') === -1) return 'contrast(0.88) missing';
  if (SRC.indexOf('saturate(0.92)') === -1) return 'saturate(0.92) missing';
  if (SRC.indexOf('sepia(0.08)')    === -1) return 'sepia(0.08) missing';
  if (SRC.indexOf('brightness(1.03)') === -1) return 'brightness(1.03) missing';
  return true;
});

check('module guards against unknown ?look values', () => {
  // The guard is the early-return on line 18.
  if (SRC.indexOf("if (look !== 'clean' && look !== 'film') return") === -1) {
    return 'no guard for unknown look values';
  }
  return true;
});

check('module writes data-look to document.documentElement', () => {
  if (SRC.indexOf('document.documentElement.setAttribute(\'data-look\'') === -1) {
    return 'no data-look attribute write';
  }
  return true;
});

check('em-dashes banned from the JS source', () => {
  if (SRC.indexOf('\u2014') !== -1) return 'em-dash (U+2014) detected';
  if (SRC.indexOf('\u2013') !== -1) return 'en-dash (U+2013) detected';
  return true;
});

check('engine.html loads lib/look-variant.client.js', () => {
  if (ENGINE_HTML.indexOf('/lib/look-variant.client.js') === -1) {
    return 'engine.html does not load the look-variant module';
  }
  return true;
});

check('composer.html loads lib/look-variant.client.js', () => {
  if (COMPOSER_HTML.indexOf('/lib/look-variant.client.js') === -1) {
    return 'composer.html does not load the look-variant module';
  }
  return true;
});

check('record.html loads lib/look-variant.client.js', () => {
  if (RECORD_HTML.indexOf('/lib/look-variant.client.js') === -1) {
    return 'record.html does not load the look-variant module';
  }
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
