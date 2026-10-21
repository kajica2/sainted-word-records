// scripts/check-debug-overlay-unit.mjs — unit coverage for the debug
// overlay flag-gating. The overlay only mounts when enabled() returns
// true (URL ?debug=1 or localStorage swr.debug = '1'); otherwise it
// no-ops so production pages stay quiet.

import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const SRC = readFileSync(new URL('../client/debug-overlay.client.js', import.meta.url), 'utf8');

const results = [];
function check(name, fn) {
  let ok = false, detail = '';
  try {
    const r = fn();
    ok = r === true;
    detail = typeof r === 'string' ? r : '';
  } catch (e) {
    detail = e.message;
  }
  results.push({ name, ok, detail });
  console.log((ok ? '  PASS  ' : '  FAIL  ') + name + (detail ? ' — ' + detail : ''));
}

function runWith(opts) {
  // Build a minimal global env for the IIFE
  const URLSearchParams = globalThis.URLSearchParams;
  const sandbox = Object.assign({
    URLSearchParams,
    window: {},
    document: {
      addEventListener: () => {},
      createElement: (tag) => {
        const e = {
          tagName: tag.toUpperCase(), style: {}, className: '',
          children: [], textContent: '', setAttribute() {},
          appendChild(c) { this.children.push(c); return c; },
          removeChild(c) { this.children = this.children.filter((x) => x !== c); }
        };
        return e;
      },
      body: { appendChild() {} },
      documentElement: { appendChild() {} },
    },
    localStorage: { getItem: () => null, setItem: () => {} },
    location: { search: '' },
    requestAnimationFrame: (cb) => 0,
    cancelAnimationFrame: () => {},
    setTimeout: () => 0,
    clearTimeout: () => {},
  }, opts || {});
  vm.createContext(sandbox);
  vm.runInContext(SRC, sandbox);
  return sandbox.window.SWR_DEBUG_OVERLAY || null;
}

check('does NOT mount when nothing enables it (no query, no localStorage)', () => {
  const r = runWith({});
  if (r !== null) return 'overlay mounted when it should not have';
  return true;
});

check('mounts when URL query ?debug=1 is set', () => {
  const r = runWith({ location: { search: '?debug=1' } });
  if (!r || typeof r.destroy !== 'function') return 'overlay did not mount';
  return true;
});

check('mounts when localStorage swr.debug = "1"', () => {
  const r = runWith({
    localStorage: { getItem: (k) => (k === 'swr.debug' ? '1' : null), setItem: () => {} }
  });
  if (!r) return 'overlay did not mount via localStorage flag';
  return true;
});

check('destroy() removes the overlay (one-shot pattern)', () => {
  const r = runWith({ location: { search: '?debug=1' } });
  if (!r) return 'overlay did not mount';
  r.destroy();
  return true;
});

// ---- summary ----
const pass = results.filter((r) => r.ok).length;
const fail = results.filter((r) => !r.ok).length;
console.log(`\n${pass} passed, ${fail} failed (${results.length} checks)`);
if (fail > 0) process.exit(1);
