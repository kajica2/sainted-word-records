// tools/swr-session-summary.mjs — generate a session-end summary for
// the Obsidian journal. Captures the recent commit range, the open
// TODOs in the project, and the active P0/P1 backlog from
// docs/PLANS/. Writes a markdown block to STDOUT (so the calling shell
// can pipe it into `swr-journal-log.mjs session`).
//
// Usage:
//   node tools/swr-session-summary.mjs [since-commit-sha]
//   SWR_SESSION_SUMMARY="$(node tools/swr-session-summary.mjs)" \
//     node tools/swr-journal-log.mjs session

import { execSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const SWR = join(HERE, '..');

function sh(cmd) {
  try {
    return execSync(cmd, { cwd: SWR, stdio: ['pipe', 'pipe', 'pipe'] }).toString().trim();
  } catch (_) { return ''; }
}
function dateNow() { return new Date().toISOString(); }
function safeRead(p) { try { return readFileSync(p, 'utf8'); } catch (_) { return ''; } }

function commitsSince(sha) {
  const range = sha ? `${sha}..HEAD` : 'HEAD~10..HEAD';
  const out = sh(`git log --no-merges --format="%h %s" ${range}`);
  if (!out) return ['(no commits in range)'];
  return out.split('\n').filter(Boolean);
}
function changedFilesSince(sha) {
  const range = sha ? `${sha}..HEAD` : 'HEAD~10..HEAD';
  const out = sh(`git diff --name-only ${range}`);
  if (!out) return [];
  return out.split('\n').filter(Boolean);
}
function openTodos() {
  // Find .todo, TODO, FIXME files; cap output
  const out = sh("grep -RIn --include='*.js' --include='*.mjs' -E 'TODO|FIXME' . 2>/dev/null | head -20");
  return out.split('\n').filter(Boolean);
}
function plansBacklog() {
  const dir = join(SWR, 'docs', 'PLANS');
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith('.md'))
    .map((f) => {
      const p = join(dir, f);
      const body = safeRead(p);
      const firstP0 = body.match(/P0(?:\.[1-9])?:\s*([^\n]+)/);
      const firstP1 = body.match(/P1(?:\.[1-9])?:\s*([^\n]+)/);
      return { file: f, p0: firstP0 ? firstP0[1].trim() : null, p1: firstP1 ? firstP1[1].trim() : null };
    })
    .filter((r) => r.p0 || r.p1);
}
function testsGate() {
  // Read the last `npm run check` result from anywhere we can find.
  // The orchestrator is read-only here; do not run npm (slow).
  return 'see `npm run check` for current gate status';
}
function runSince(sha) {
  return [
    '### Commits since ' + (sha || 'HEAD~10'),
    ...commitsSince(sha).map((c) => '- ' + c),
    '',
    '### Files changed',
    ...(changedFilesSince(sha).length
      ? changedFilesSince(sha).slice(0, 20).map((f) => '- `' + f + '`')
      : ['- (none reported)']),
    '',
  ].join('\n');
}
function todosBlock() {
  const todos = openTodos();
  if (!todos.length) return '';
  return [
    '### Open TODOs (sample, top 20)',
    ...todos.slice(0, 20).map((t) => '- ' + t),
    '',
  ].join('\n');
}
function plansBlock() {
  const plans = plansBacklog();
  if (!plans.length) return '';
  return [
    '### Active plans (P0/P1 highlights)',
    ...plans.slice(0, 6).map((p) => {
      const parts = [];
      if (p.p0) parts.push('P0: ' + p.p0);
      if (p.p1) parts.push('P1: ' + p.p1);
      return '- `' + p.file + '` — ' + parts.join(' / ');
    }),
    '',
  ].join('\n');
}
function render(sha) {
  return [
    '### Session summary · ' + dateNow(),
    '',
    '#### Git',
    '- HEAD: ' + (sh('git rev-parse HEAD') || '?'),
    '- Branch: ' + (sh('git rev-parse --abbrev-ref HEAD') || '?'),
    '',
    runSince(sha),
    todosBlock(),
    plansBlock(),
    '### Tests',
    testsGate(),
    '',
  ].join('\n');
}

const since = process.argv[2] || process.env.SWR_SESSION_SINCE;
process.stdout.write(render(since));
