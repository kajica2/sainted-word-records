import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const js = readFileSync(new URL('./client/remix-studio.client.js', import.meta.url), 'utf8');
const css = readFileSync(new URL('./client/remix-studio.css', import.meta.url), 'utf8');
const engine = readFileSync(new URL('./engine.html', import.meta.url), 'utf8');

// Markup is JSON-escaped line-by-line to preserve copy and avoid template injection.
function getMarkup() {
  const start = js.indexOf('  modal.innerHTML = [');
  const end = js.indexOf("  ].join('\\n');", start);
  assert.ok(start >= 0 && end > start, 'Expected static, auditable dialog markup');
  const lines = js.slice(start + '  modal.innerHTML = ['.length, end)
    .trim().split('\n').map(s => s.trim()).filter(Boolean);
  return lines.map(line => JSON.parse(line.endsWith(',') ? line.slice(0, -1) : line)).join('\n');
}

test('Remix dialog has all required accessible controls and unique ids', () => {
  const html = getMarkup();
  const ids = Array.from(html.matchAll(/\bid="([^"]+)"/g), m => m[1]);
  assert.equal(ids.length, new Set(ids).size, 'Duplicate DOM ids');
  for (const id of [
    'swr-remix-title', 'swr-remix-files', 'swr-remix-loops', 'swr-remix-candidates',
    'swr-remix-track', 'swr-remix-energy-line', 'swr-remix-duration', 'swr-remix-bpm',
    'swr-remix-creativity', 'swr-remix-seed', 'swr-remix-preview', 'swr-remix-status',
    'swr-remix-stat-cuts', 'swr-remix-stat-sources', 'swr-remix-stat-length',
    'swr-remix-duration-display', 'swr-remix-source-count',
  ]) assert.ok(ids.includes(id), 'Missing UI id ' + id);
  for (const action of ['close', 'generate', 'render', 'download', 'send', 'shuffle']) {
    assert.ok(html.includes('data-remix="' + action + '"'), 'Missing action ' + action);
  }
  assert.match(html, /aria-live="polite"/);
  assert.match(html, /aria-label="Arrangement candidates"/);
  assert.match(html, /class="swr-remix-pane swr-remix-pane--sources"/);
  assert.match(html, /class="swr-remix-pane swr-remix-pane--canvas"/);
  assert.match(html, /class="swr-remix-pane swr-remix-pane--controls"/);
});

test('Opt-in UI is styled and loaded by the engine', () => {
  assert.match(engine, /href="\/client\/remix-studio.css"/);
  assert.match(engine, /src="\/client\/remix-studio.client.js"/);
  assert.match(css, /#swr-remix-dialog\[hidden\]/);
  assert.match(css, /@media\(max-width:680px\)/);
  assert.match(css, /prefers-reduced-motion/);
});

test('Waveforms, take selection and visual handoff have listeners', () => {
  assert.match(js, /function renderMiniWave\(/);
  assert.match(js, /function selectCandidate\(/);
  assert.match(js, /swr:remix-loaded/);
  assert.match(js, /function invalidateParameters\(/);
  assert.match(js, /renderRemix\(plan, state\.buffers/);
});

test('Remix ESM dependencies ship with the static build', () => {
  // The engine's Vite config intentionally copies HTML and browser modules as
  // static files. A dependency added to the source but not to rootFiles works
  // in dev yet fails on every deployed engine page with HTTP 404.
  const config = readFileSync(new URL('./vite.config.js', import.meta.url), 'utf8');
  const begin = config.indexOf('const rootFiles = [');
  const end = config.indexOf('\n  ];', begin);
  assert.ok(begin >= 0 && end > begin, 'Expected Vite copyStatic rootFiles allowlist');
  const deployFiles = config.slice(begin, end);
  const rootImports = [...js.matchAll(/^import\s+.+?\s+from\s+['"]\.\.\/([^'"]+)['"]\s*;/gm)]
    .map(match => match[1]);
  assert.deepEqual(rootImports.sort(), [
    'remix-planner.js', 'remix-renderer.js', 'remix-workflow.js',
  ], 'Keep test synchronized with static browser ESM imports');
  for (const dependency of rootImports) {
    assert.ok(
      deployFiles.includes("'" + dependency + "'"),
      dependency + ' must be in Vite copyStatic rootFiles (otherwise deployed HTTP 404)'
    );
    assert.doesNotThrow(
      () => readFileSync(new URL('./' + dependency, import.meta.url), 'utf8'),
      dependency + ' must exist in repository'
    );
  }
});
