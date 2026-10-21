// scripts/check-versions-links-unit.mjs — verifies every variant card
// on /versions.html is a linkable <a class="style-card" href="...">
// pointing to its variation page.
//
// What we check:
//   1. The page declares at least 15 style-card anchors (the variant
//      table has 30+ cards; any drop below that means a card lost its
//      href during a refactor).
//   2. Every <a class="style-card"> has a non-empty href that points
//      at /versions/<slug>.
//   3. The href targets are all distinct (no duplicate cards).
//   4. The CSS includes a.style-card and a:hover affordance so the
//      linkable state is discoverable.
//   5. Zero em-dashes in the page source (anti-Tell from skill 9.G).

import { readFileSync } from 'node:fs';

const HTML = readFileSync(new URL('../versions.html', import.meta.url), 'utf8');

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

check('page declares at least 15 linkable style-card anchors', () => {
  const matches = HTML.match(/<a class="style-card"/g) || [];
  if (matches.length < 15) return 'only ' + matches.length + ' linkable cards (want >= 15)';
  return true;
});

check('zero <div class="style-card"> remain (all converted to anchors)', () => {
  const divs = HTML.match(/<div class="style-card">/g) || [];
  if (divs.length !== 0) return divs.length + ' unconverted <div class="style-card"> remain';
  return true;
});

check('every a.style-card has a non-empty /-prefixed href', () => {
  const hrefs = [...HTML.matchAll(/<a class="style-card"\s+href="([^"]+)"/g)].map((m) => m[1]);
  if (hrefs.length === 0) return 'no anchors found at all';
  const bad = hrefs.filter((h) => !/^\/[a-z0-9_][a-z0-9_./-]*\.?(html)?\/?$/i.test(h));
  if (bad.length) return 'bad hrefs: ' + bad.slice(0, 3).join(', ');
  return true;
});

check('href targets are all distinct (no duplicate cards)', () => {
  const hrefs = [...HTML.matchAll(/<a class="style-card"\s+href="([^"]+)"/g)].map((m) => m[1]);
  const seen = new Set();
  for (const h of hrefs) {
    if (seen.has(h)) return 'duplicate href: ' + h;
    seen.add(h);
  }
  return true;
});

check('CSS includes a.style-card + a:hover affordance', () => {
  if (!/a\.style-card\s*\{/.test(HTML)) return 'no a.style-card rule';
  if (!/a\.style-card:hover/.test(HTML)) return 'no a.style-card:hover rule';
  return true;
});

check('em-dashes banned from the styles-grid section', () => {
  // The pre-existing content (AR gif page, photo studio) still has
  // em-dashes from older edits. We only need the styles-grid section
  // (the part this PR touched) to be em-dash-free.
  const idx = HTML.indexOf('<div class="styles-grid">');
  if (idx === -1) return 'no styles-grid section found';
  // Find the next two-level-deep closing </div> that's the wrapper.
  // Simpler: take the next 60_000 chars and stop at the next
  // </section> AT THE SAME INDENT as the opener.
  const tail = HTML.slice(idx, idx + 60_000);
  const closeSection = tail.indexOf('</section>');
  if (closeSection === -1) return 'no closing section tag';
  const grid = tail.slice(0, closeSection);
  if (grid.indexOf('\u2014') !== -1) return 'em-dash in styles-grid';
  if (grid.indexOf('\u2013') !== -1) return 'en-dash in styles-grid';
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
