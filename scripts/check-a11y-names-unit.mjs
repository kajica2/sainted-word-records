#!/usr/bin/env node
// scripts/check-a11y-names-unit.mjs — the accessible-name rule, enforced
// on the SOURCE rather than measured on the built site.
//
// WHY A SOURCE GATE
// -----------------
// The accessibility gate (scripts/check-a11y.mjs) measures the BUILT site
// with a browser and compares per-rule totals against a baseline. That is
// the right instrument for "did the site get less accessible", but it is
// the wrong instrument for "is this element's accessible name still
// correct":
//
//   - it reports a COUNT, so a regression of one element on one page is
//     indistinguishable from the measurement's own noise (the gate's
//     tolerance is two instances);
//   - it can only report the FIRST element it finds on a page, so a
//     second broken name on the same page is invisible until the first is
//     fixed;
//   - it needs a browser, so it runs in CI but not on a contributor's
//     machine, and on a loaded runner it is the step that takes hours.
//
// The rule it cannot check cheaply is WCAG 2.5.3, "Label in Name": an
// element's accessible name must CONTAIN the text the user can see. A
// control whose visible label is "v2026.10.13.1" but whose accessible name
// is "App version 2026.10.13.1, link to changelog" breaks it — the screen
// reader says something the user cannot see on the page.
//
// That is not hypothetical. The version badge had exactly that shape on
// every page that loads lib/version-badge.client.js, and it was the
// accessibility gate's own named example for this rule.
//
// WHAT THIS GATE ASSERTS
// ----------------------
// 1. The version badge: its accessible name contains its visible text.
// 2. Every start overlay: its accessible name contains its visible text.
// 3. A census of every other labelled element in the shipped pages, held
//    against a baseline — the census may only SHRINK. See
//    qa/a11y-names-baseline.json.
//
// This is a LINT, not a browser measurement, and it is deliberately
// narrow: it asserts the rule for the elements this repo ships, not for
// arbitrary HTML.
//
// Run: node scripts/check-a11y-names-unit.mjs
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const checks = [];
const pass = (m, d) => { checks.push({ ok: true, m, d }); console.log('PASS:', m, d ? `(${d})` : ''); };
const fail = (m, d) => { checks.push({ ok: false, m, d }); console.log('FAIL:', m, d ? `(${d})` : ''); };

const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

/**
 * Normalise a string the way an accessible name comparison does:
 * whitespace collapses, case is ignored.
 */
function norm(s) {
  return String(s || '').replace(/\s+/g, ' ').trim().toLowerCase();
}

/**
 * Evaluate a simple JS concatenation expression made of string literals
 * and the identifier `v` (the app version). That is the whole language
 * the badge's two attributes are written in, so a real evaluator would
 * be a liability rather than an asset.
 */
function evalExpr(expr, v) {
  return expr
    .split('+')
    .map((raw) => {
      const p = raw.trim();
      if (/^'.*'$/.test(p) || /^".*"$/.test(p)) return p.slice(1, -1);
      if (p === 'v') return v;
      return p;
    })
    .join('');
}

// ---- the shipped pages --------------------------------------------------
// The set of files the site actually ships. `git ls-files` is the truth
// (it excludes the build output and the worktrees); the filesystem walk
// is the fallback for a copy of the tree without git.
const SKIP_DIRS = new Set([
  'node_modules', 'dist', 'dist-dev', '.git', '.worktrees', '_archive',
  '.tmp', 'out', '.vercel',
]);

function shippedHtml() {
  let files = [];
  try {
    const out = execFileSync('git', ['ls-files', '--cached', '--', '*.html'], {
      cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'],
    });
    files = out.split('\n').filter(Boolean);
  } catch (_) {
    const walk = (dir, depth) => {
      if (depth > 3) return;
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        if (SKIP_DIRS.has(e.name)) continue;
        const full = path.join(dir, e.name);
        if (e.isDirectory()) walk(full, depth + 1);
        else if (e.isFile() && e.name.endsWith('.html')) files.push(path.relative(ROOT, full));
      }
    };
    walk(ROOT, 0);
  }
  return files.sort();
}

// ---- 1. the version badge ----------------------------------------------
// The badge is the site's most widespread labelled element: it is on
// every page that loads lib/version-badge.client.js.
{
  const src = read('lib/version-badge.client.js');
  const visible = src.match(/a\.textContent\s*=\s*([^;]+);/);
  const labelled = src.match(/setAttribute\(\s*'aria-label'\s*,\s*([^)]+)\)/);
  if (!visible) {
    fail('the version badge sets its visible text', 'no a.textContent assignment found');
  } else if (!labelled) {
    fail('the version badge sets an accessible name', 'no aria-label assignment found');
  } else {
    // The name and the visible text are built from the same version
    // string, so both are evaluated against the same value.
    const v = '2026.10.13.1';
    const visibleText = evalExpr(visible[1], v);
    const accessibleName = evalExpr(labelled[1], v);
    if (norm(accessibleName).includes(norm(visibleText))) {
      pass('the version badge\'s accessible name contains its visible text',
        `"${visibleText}" is in "${accessibleName}"`);
    } else {
      fail('the version badge\'s accessible name contains its visible text',
        `visible "${visibleText}" is not in the accessible name "${accessibleName}"`);
    }
  }
}

// ---- 2. the start overlay ----------------------------------------------
// The drop-a-song overlay is a role="button" whose visible text lives in
// its children. Its accessible name is either the aria-label it carries
// or — when it carries none — its own content, which is exactly the
// visible text. Either way the name must contain the visible text.
{
  const offenders = [];
  let overlays = 0;

  const files = shippedHtml();
  files.push('versions/_audio-overlay-inject.js');

  for (const rel of files) {
    const full = path.join(ROOT, rel);
    if (!fs.existsSync(full)) continue;
    const src = fs.readFileSync(full, 'utf8');
    const re = /<div id="swr-start"[^>]*>/g;
    let m;
    while ((m = re.exec(src)) !== null) {
      overlays++;
      const tag = m[0];
      const body = blockAfter(src, m.index + tag.length);
      const visible = visibleText(body);
      const aria = tag.match(/aria-label="([^"]*)"/);
      // With no aria-label the accessible name IS the content — that is
      // the case that satisfies the rule by construction. With an
      // aria-label, the label has to carry the visible text itself.
      const name = aria ? aria[1] : visible;
      if (!visible) continue;
      if (!norm(name).includes(norm(visible))) {
        offenders.push(`${rel}: visible "${visible}" not in name "${name}"`);
      }
    }
  }

  if (!overlays) {
    fail('the start overlay is present in the tree', 'no #swr-start overlay found');
  } else if (offenders.length) {
    fail('every start overlay\'s accessible name contains its visible text',
      offenders.slice(0, 4).join('; ') + (offenders.length > 4 ? ` (+${offenders.length - 4} more)` : ''));
  } else {
    pass('every start overlay\'s accessible name contains its visible text', `${overlays} overlays`);
  }
}

/** The markup of the div that starts at `from`, balanced on div tags. */
function blockAfter(src, from) {
  const re = /<(\/?)div\b[^>]*>/g;
  re.lastIndex = from;
  let depth = 1;
  let m;
  while ((m = re.exec(src)) !== null) {
    if (m[1] === '/') {
      depth--;
      if (depth === 0) return src.slice(from, m.index);
    } else {
      depth++;
    }
  }
  return src.slice(from, from + 4000);
}

/** The text a user can see inside a block of markup. */
function visibleText(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// ---- 3. the census ------------------------------------------------------
// Every element in the shipped pages that sets an aria-label AND shows
// text must have that text in its name. The shipped tree already carries
// a backlog of offenders that predate this gate; the census is held
// against a baseline so the backlog cannot GROW, and every offender is
// listed so it can be worked down.
{
  const baselinePath = path.join(ROOT, 'qa', 'a11y-names-baseline.json');
  const baseline = JSON.parse(fs.readFileSync(baselinePath, 'utf8'));

  // A single element with an aria-label and text content.
  const EL = /<([a-zA-Z][a-zA-Z0-9-]*)((?:[^>"]|"[^"]*")*?)>([^<]{1,200})</g;
  const offenders = [];
  let labelled = 0;

  for (const rel of shippedHtml()) {
    const src = fs.readFileSync(path.join(ROOT, rel), 'utf8');
    let m;
    while ((m = EL.exec(src)) !== null) {
      const [, tag, attrs, text] = m;
      if (!/\baria-label\s*=/.test(attrs)) continue;
      if (/^(script|style|meta|link|title|br|img|input|hr)$/i.test(tag)) continue;
      const nameMatch = attrs.match(/aria-label="([^"]*)"/);
      if (!nameMatch) continue;
      const visible = norm(text);
      if (!visible) continue;
      labelled++;
      if (!norm(nameMatch[1]).includes(visible)) {
        offenders.push(`${rel} <${tag}>: "${text.trim()}" not in "${nameMatch[1]}"`);
      }
    }
  }

  const allowed = baseline.count;
  if (offenders.length > allowed) {
    fail('the labelled-element census has not grown',
      `${offenders.length} offenders against a baseline of ${allowed}: ` +
      offenders.slice(0, 5).join('; ') + (offenders.length > 5 ? ` (+${offenders.length - 5} more)` : ''));
  } else {
    pass('the labelled-element census has not grown',
      `${offenders.length} offenders against a baseline of ${allowed} (${labelled} labelled elements)`);
  }
}

console.log('');
console.log(`A11Y NAMES UNIT: ${checks.filter(c => c.ok).length}/${checks.length} checks passed`);
if (checks.some(c => !c.ok)) process.exit(1);
console.log('OK');
