// scripts/check-site-keys-unit.mjs — unit coverage for lib/site-keys.client.js,
// the sitewide shortcut layer (marketing + docs pages).
//
// node:vm sandbox with stub window/document/location and a controllable clock
// (the module's G-prefix arming uses Date.now()).
//
// Pass criteria: every assertion succeeds, exit 0, last line
// `SITE KEYS UNIT: ALL GREEN (N tests)`.

import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import vm from 'node:vm';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const src = readFileSync(path.join(__dirname, '..', 'lib', 'site-keys.client.js'), 'utf8');

// Sandbox factory. `opts.engineHelp` simulates engine-keys being present with
// its own keymap; `opts.search` whether a search input exists; `opts.disable`
// sets the opt-out flag.
function makeEnv(opts = {}) {
  let T = 1000;
  const listeners = [];
  const navigations = [];
  const themeToggles = { n: 0 };
  const elements = [];

  const searchInput = opts.search === false ? null : { tagName: 'INPUT', focus() { this.focused = true; }, select() {}, focused: false };

  const sb = {
    console: { log: () => {}, warn: () => {} },
    Math, Object, Array, JSON, Number, String, Boolean, Promise,
    Date: { now: () => T },
    document: {
      createElement: () => ({ style: {}, setAttribute() {}, appendChild() {}, innerHTML: '' }),
      querySelector: (sel) => (searchInput && /search/.test(sel) ? searchInput : null),
      body: { appendChild: (el) => elements.push(el) },
    },
    window: {
      addEventListener: (t, fn) => { if (t === 'keydown') listeners.push(fn); },
      location: { assign: (u) => navigations.push(u) },
      SWR_NAV: { toggleTheme: () => { themeToggles.n++; } },
    },
  };
  if (opts.engineHelp) {
    sb.window.SWR_KEYS = { help: () => opts.engineHelp.map((keys) => ({ keys, label: 'x' })) };
  }
  if (opts.disable) sb.window.SWR_SITE_KEYS_DISABLE = true;
  sb.globalThis = sb.window;
  vm.createContext(sb);
  vm.runInContext(src, sb);
  return {
    KEYS: sb.window.SWR_SITE_KEYS,
    searchInput,
    elements,
    navigations,
    themeToggles,
    advance: (ms) => { T += ms; },
    // Fire a keydown through the real listener, like the browser would.
    fire(key, { target = null, shiftKey = false, ctrlKey = false, metaKey = false, altKey = false, code = '' } = {}) {
      let prevented = false;
      for (const fn of listeners) {
        fn({ key, code, target, shiftKey, ctrlKey, metaKey, altKey, preventDefault: () => { prevented = true; } });
      }
      return prevented;
    },
  };
}

const results = [];
function check(name, fn) {
  try { fn(); results.push('  \u2713 ' + name); }
  catch (err) { results.push('  \u2717 ' + name + ' \u2014 ' + err.message); process.exitCode = 1; }
}

// 1. surface
check('1. public surface (help/isEnabled/showHelp/hideHelp/simulate)', () => {
  const { KEYS } = makeEnv();
  for (const k of ['help', 'isEnabled', 'showHelp', 'hideHelp', 'simulate']) {
    assert.equal(typeof KEYS[k], 'function', 'missing: ' + k);
  }
});

// 2. the binding table is the documented set
check('2. help() lists the 4 single keys + 2 G sequences', () => {
  const { KEYS } = makeEnv();
  const rows = KEYS.help();
  const keys = Array.from(rows, (r) => r.keys);   // host-realm copy (vm arrays differ by prototype)
  assert.deepEqual(keys, ['?', 'Esc', '/', 'T', 'G then H', 'G then M']);
  for (const r of rows) assert.ok(r.label && r.label.length > 0, 'label missing for ' + r.keys);
});

// 3. '?' opens, Esc closes (and Esc only claims the key while open)
check('3. ? opens the overlay; Esc closes it; Esc alone is a no-op', () => {
  const { KEYS, fire, elements } = makeEnv();
  assert.equal(fire('Escape'), false, 'Esc with nothing open must not claim the key');
  assert.equal(fire('?'), true, '? should claim the key');
  assert.equal(elements.length, 1, 'overlay element should be appended');
  assert.equal(fire('Escape'), true, 'Esc should claim the key while open');
  assert.equal(KEYS.help().length, 6);
});

// 4. theme toggle delegates to the nav component
check('4. T toggles the theme via SWR_NAV.toggleTheme', () => {
  const { fire, themeToggles } = makeEnv();
  assert.equal(fire('t'), true);
  assert.equal(themeToggles.n, 1, 'toggleTheme should be called once');
  assert.equal(fire('T', { shiftKey: true }), false, 'Shift+T must be left alone');
  assert.equal(themeToggles.n, 1, 'Shift+T must not toggle');
});

// 5. '/' focuses search when present, and does NOT claim the key when absent
check('5. / focuses the nav search field, or defers when the page has none', () => {
  const withSearch = makeEnv({ search: true });
  assert.equal(withSearch.fire('/'), true, 'should claim the key when a field exists');
  assert.equal(withSearch.searchInput.focused, true, 'field should be focused');

  const without = makeEnv({ search: false });
  assert.equal(without.fire('/'), false, 'a page with no search must keep the browser default');
});

// 6. form fields are never hijacked
check('6. keystrokes inside a form field are ignored', () => {
  const { fire, themeToggles, elements } = makeEnv();
  const input = { tagName: 'INPUT' };
  assert.equal(fire('t', { target: input }), false);
  assert.equal(fire('?', { target: input }), false);
  assert.equal(themeToggles.n, 0);
  assert.equal(elements.length, 0, 'no overlay from a keystroke in a field');

  const editable = { tagName: 'DIV', isContentEditable: true };
  assert.equal(fire('t', { target: editable }), false);
  assert.equal(themeToggles.n, 0);
});

// 7. modifier combinations belong to the browser / other layers
check('7. Ctrl/Meta/Alt combos are ignored', () => {
  const { fire, themeToggles } = makeEnv();
  assert.equal(fire('t', { ctrlKey: true }), false);
  assert.equal(fire('t', { metaKey: true }), false);
  assert.equal(fire('t', { altKey: true }), false);
  assert.equal(themeToggles.n, 0, 'no toggle from a modified key');
});

// 8. page-level opt-out
check('8. SWR_SITE_KEYS_DISABLE=true makes the layer inert', () => {
  const { KEYS, fire, themeToggles, elements } = makeEnv({ disable: true });
  assert.equal(KEYS.isEnabled(), false);
  assert.equal(fire('t'), false);
  assert.equal(fire('?'), false);
  assert.equal(themeToggles.n, 0);
  assert.equal(elements.length, 0);
});

// 9. deference to engine-keys (the 16 engine pages)
check('9. keys claimed by engine-keys are skipped here', () => {
  const { fire, themeToggles, elements } = makeEnv({ engineHelp: ['T', 'Shift+R', 'V', 'Space'] });
  assert.equal(fire('t'), false, 'engine-keys owns T — the site layer must yield');
  assert.equal(themeToggles.n, 0);
  assert.equal(fire('?'), true, '? is not claimed by engine-keys here, so we take it');
  assert.equal(elements.length, 1);

  // And a page whose engine keymap does claim '?' keeps it.
  const both = makeEnv({ engineHelp: ['?', 'Slash'] });
  assert.equal(both.fire('?'), false, 'engine-keys owns ? → yield');
  assert.equal(both.elements.length, 0);
});

// 10. G-prefix navigation
check('10. G then H navigates home; G then M to the music video', () => {
  const a = makeEnv();
  assert.equal(a.fire('g'), true, 'G should arm and claim the key');
  assert.equal(a.fire('h'), true, 'H should complete the sequence');
  assert.deepEqual(a.navigations, ['/']);

  const b = makeEnv();
  b.fire('g');
  b.fire('m');
  assert.deepEqual(b.navigations, ['/versions/music_video.html']);
});

// 11. the G prefix expires
check('11. an expired G prefix does not navigate', () => {
  const { fire, navigations, advance } = makeEnv();
  fire('g');
  advance(5000);                      // well past G_TIMEOUT_MS
  assert.equal(fire('h'), false, 'a stale prefix must not claim the key');
  assert.deepEqual(navigations, [], 'no navigation from an expired sequence');
});

// 12. G followed by a non-destination key is harmless
check('12. G then an unbound key does not navigate', () => {
  const { fire, navigations } = makeEnv();
  fire('g');
  assert.equal(fire('q'), false);
  assert.deepEqual(navigations, []);
});

// 13. G is also subject to engine-keys deference
check('13. G yields to engine-keys when it claims G', () => {
  const { fire, navigations } = makeEnv({ engineHelp: ['G'] });
  fire('g');
  fire('h');
  assert.deepEqual(navigations, [], 'engine owned G — the site sequence must not fire');
});

// 14. idempotent singleton
check('14. re-execution keeps the same singleton', () => {
  const { KEYS } = makeEnv();
  const env2 = makeEnv();
  assert.ok(KEYS !== env2.KEYS, 'separate sandboxes are separate instances');
  assert.equal(typeof env2.KEYS.help, 'function');
});

console.log(results.join('\n'));
if (process.exitCode) {
  console.log('\nSITE KEYS UNIT: FAILURES ABOVE');
} else {
  console.log('\nSITE KEYS UNIT: ALL GREEN (' + results.length + ' tests)');
}
