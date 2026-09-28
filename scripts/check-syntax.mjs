// scripts/check-syntax.mjs — fast parse check for every JS / MJS file
// AND every inline <script> block inside .html files.
//
// `node --check` on each file catches typos and broken syntax before
// the full vite build does. Cheaper than the build itself (no bundler,
// no plugins, no asset copy) so it's worth running in pre-commit and
// pre-push.
//
// The inline <script> extraction matters: codemod bugs that drop a
// closing paren in inline scripts (e.g. a stage.getContext(...) call
// that ends with `))` instead of `)`) produce SyntaxErrors that vite
// doesn't surface because vite bundles inline scripts as-is into the
// HTML output. `npm run build` ships the broken page. `node --check`
// on the extracted block catches it here.
//
// Excludes: node_modules, dist, dist-dev (already excluded by find -prune),
// .vite cache, public/ (shadow copies; vite.config.js comments confirm
// they're not canonical).
//
// Exit code 0 = all parse, 1 = any file failed.

import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync, writeFileSync, mkdtempSync, statSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, resolve } from 'node:path';

const ROOT = process.cwd();
const EXCLUDE_DIRS = new Set(['node_modules', 'dist', 'dist-dev', '.vite', '.git', '.hermes', 'public', '.worktrees']);
const EXCLUDE_FILES = new Set([]); // none yet

/** @type {string[]} */
const targets = [];
/** @type {{file: string, line: number}[]} */
const inlineScripts = [];

function walk(dir) {
  for (const entry of readdirSync(dir)) {
    if (EXCLUDE_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    if (EXCLUDE_FILES.has(relative(ROOT, full))) continue;
    const st = statSync(full);
    if (st.isDirectory()) {
      walk(full);
    } else if (st.isFile()) {
      if (entry.endsWith('.js') || entry.endsWith('.mjs')) {
        targets.push(full);
      } else if (entry.endsWith('.html')) {
        collectInlineScripts(full);
      }
    }
  }
}

// Extract inline <script>...</script> blocks (no src= attribute) from
// the HTML so we can node --check them. Record the 1-based line
// number of the opening <script> tag so error messages point back
// into the original HTML.
//
// Implementation note: a naive regex that matches <script> tokens
// will false-positive on <script> appearing inside JS or HTML
// comments inside the body of another script (engine.html has this
// pattern at line ~48035: "// Lives in an inline non-module
// <script> so it can sit beside the..."). To avoid that we do a
// character-by-character scan that respects:
//   - HTML comments (<!-- ... -->)
//   - JS line comments (// ...)
//   - JS block comments (/* ... */)
//   - JS string literals (', ", `)
function collectInlineScripts(htmlPath) {
  const src = readFileSync(htmlPath, 'utf8');
  const lower = src.toLowerCase();
  const blocks = [];
  let i = 0;
  while (i < src.length) {
    // HTML comments (a <script> token inside one is not a real tag).
    if (src.startsWith('<!--', i)) {
      const end = src.indexOf('-->', i + 4);
      i = end < 0 ? src.length : end + 3;
      continue;
    }
    const m = /<script(\s[^>]*)?>/i.exec(src.slice(i));
    if (m && m.index === 0) {
      const tagStart = i;
      const tag = m[0];
      i += tag.length;
      // Per the HTML spec a <script> element's content ends at the FIRST
      // "</script" sequence, regardless of JS string/comment context: an
      // unescaped </script> inside a template literal terminates the element
      // in the browser (escaping it as <\/script> is the fix).
      const close = lower.indexOf('</script', i);
      if (close < 0) { i = src.length; break; }
      // Skip external (src=), JSON data islands and modules — but still
      // consume the WHOLE element. Skipping only the open tag left the
      // scanner inside bodies whose template literals generate HTML with
      // <script> tags, which it then mistook for real opens (engine.html).
      const skip = /\ssrc\s*=/.test(tag) ||
        /type\s*=\s*["']application\/(?:json|ld\+json)["']/.test(tag) ||
        /type\s*=\s*["']module["']/.test(tag);
      if (!skip) {
        const body = src.slice(i, close);
        if (body.trim()) {
          blocks.push({ file: htmlPath, line: src.slice(0, tagStart).split('\n').length, source: body });
        }
      }
      const gt = src.indexOf('>', close);
      i = gt < 0 ? src.length : gt + 1;
      continue;
    }
    i++;
  }
  for (const b of blocks) inlineScripts.push(b);
}

walk(ROOT);

let failed = 0;

// Parse-check standalone .js/.mjs files.
for (const f of targets) {
  try {
    execFileSync('node', ['--check', f], { stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (e) {
    const stderr = e.stderr ? e.stderr.toString().trim() : '';
    console.error(`✗ ${relative(ROOT, f)}\n    ${stderr.split('\n').slice(0, 4).join('\n    ')}`);
    failed++;
  }
}

// Parse-check inline <script> blocks from .html files. Write each
// block to a temp file and node --check it. Errors include the
// originating html:line so they're easy to locate.
if (inlineScripts.length) {
  const tmpRoot = mkdtempSync(join(tmpdir(), 'swr-syntax-'));
  try {
    for (let i = 0; i < inlineScripts.length; i++) {
      const { file, line, source } = inlineScripts[i];
      const tmp = join(tmpRoot, `block-${i}.mjs`);
      writeFileSync(tmp, source);
      try {
        execFileSync('node', ['--check', tmp], { stdio: ['ignore', 'pipe', 'pipe'] });
      } catch (e) {
        const stderr = e.stderr ? e.stderr.toString().trim() : '';
        const rel = relative(ROOT, file);
        console.error(`✗ ${rel}:${line} (inline <script>)\n    ${stderr.split('\n').slice(0, 4).join('\n    ')}`);
        failed++;
      }
    }
  } finally {
    rmSync(tmpRoot, { recursive: true, force: true });
  }
}

if (failed) {
  console.error(`\n${failed} parse check(s) failed`);
  process.exit(1);
}
console.log(`✓ ${targets.length} files + ${inlineScripts.length} inline scripts parse OK`);