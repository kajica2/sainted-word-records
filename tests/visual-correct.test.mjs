import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../scripts/visual-correct.mjs', import.meta.url), 'utf8');
const checkSource = source.slice(source.indexOf('async function checkAndCorrect'), source.indexOf('\n(async () =>'));

function fixture(omit = '') {
  const button = textContent => ({ textContent });
  const actions = { querySelectorAll: () => ['Settings', 'Profile'].filter(x => x.toLowerCase() !== omit).map(button) };
  const scenes = { parentNode: { querySelectorAll: () => omit === 'save' ? [] : [button('Save')] } };
  const top = { querySelector: () => omit === 'top-actions' ? null : actions };
  const elements = { '.swr-cc-top': top, '.swr-cc-panel': {}, '[data-cc-scenes]': scenes };
  if (omit === 'top') delete elements['.swr-cc-top'];
  if (omit === 'panels') delete elements['.swr-cc-panel'];
  if (omit === 'scenes') delete elements['[data-cc-scenes]'];
  return { querySelector: selector => elements[selector] || null };
}

async function inspect(omit) {
  const context = vm.createContext({ document: fixture(omit) });
  vm.runInContext(checkSource, context);
  return context.checkAndCorrect({ evaluate: fn => vm.runInContext('(' + fn.toString() + ')()', context) });
}

test('complete shipped controls pass', async () => assert.equal((await inspect('')).ok, true));
for (const missing of ['top', 'top-actions', 'settings', 'profile', 'panels', 'scenes', 'save']) {
  test('missing ' + missing + ' fails without DOM repair', async () => {
    const result = await inspect(missing);
    assert.equal(result.ok, false);
    assert.ok(result.missing.includes(missing));
    assert.equal(result.fixes.length, 0);
  });
}
test('timeout path marks process failure', () => {
  assert.match(source, /process\.exitCode = 1;\s*break;/);
});
