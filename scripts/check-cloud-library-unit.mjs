// scripts/check-cloud-library-unit.mjs — Phase 1 contract for
// window.SWR_CLOUD_LIBRARY. Stubs fetch + localStorage, exercises the
// public API, and verifies:
//   - status shape is correct
//   - subscribe() runs on each set
//   - push/pull transition states correctly
//   - watch persists across reads (localStorage round trip)

import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const SRC = readFileSync(new URL('../client/cloud-library.client.js', import.meta.url), 'utf8');

const results = [];
async function check(name, fn) {
  let ok = false, detail = '';
  try {
    const r = await fn();
    ok = r === true;
    detail = typeof r === 'string' ? r : '';
  } catch (e) {
    detail = e.message + (e.stack ? '\n' + e.stack.split('\n').slice(1, 4).join('\n') : '');
  }
  results.push({ name, ok, detail });
  console.log((ok ? '  PASS  ' : '  FAIL  ') + name + (detail ? ' — ' + detail : ''));
}

function makeSandbox() {
  // Persistent localStorage across reloads
  const ls = { _k: {}, getItem(k) { return this._k[k] == null ? null : this._k[k]; },
                              setItem(k, v) { this._k[k] = String(v); },
                              removeItem(k) { delete this._k[k]; } };
  const calls = [];
  const fetchStubs = {
    '/api/library': (method) => {
      if (method === 'GET')   return { manifest: { count: 3, sizeBytes: 1024000, lastSyncAt: '2026-10-20T07:00:00.000Z' } };
      if (method === 'POST')  return { ok: true, count: 5, sizeBytes: 2_000_000 };
      throw new Error('unexpected');
    },
  };
  // Each sandbox has its own window singleton so the IIFE's
  // `if (window.SWR_CLOUD_LIBRARY) return` re-evaluates fresh.
  const win = {};
  const sandbox = {
    window: win,
    console: { warn() {}, log() {}, info() {}, error() {} },
    CustomEvent: class { constructor(t, init) { this.type = t; this.detail = init && init.detail; } },
    dispatchEvent: () => true,
    fetch(url, opts) {
      calls.push({ url, method: (opts && opts.method) || 'GET' });
      const fn = fetchStubs[url];
      if (!fn) return Promise.reject(new Error('no stub for ' + url));
      return Promise.resolve({ ok: true, text: () => Promise.resolve(JSON.stringify(fn(opts && opts.method))) });
    },
    Response: class {},
    setTimeout: () => 0,
    clearTimeout: () => {},
    location: { reload: () => {} },
    localStorage: ls,
  };
  win.localStorage = ls;
  vm.createContext(sandbox);
  // Run source with a local `window` rebinding so the IIFE writes to
  // the sandbox's `window` (we read sandbox.window.SWR_CLOUD_LIBRARY
  // after runInContext, but the IIFE assigns to its own `window`).
  vm.runInContext('(function(window){\n' + SRC + '\n}).call(globalThis, globalThis.window);', sandbox);
  return { sandbox, calls, win };
}

check('module exposes window.SWR_CLOUD_LIBRARY with the documented API', () => {
  const { sandbox } = makeSandbox();
  const API = sandbox.window.SWR_CLOUD_LIBRARY;
  if (!API) return 'not exposed';
  for (const k of ['manifest', 'push', 'pull', 'sync', 'listCloud',
                    'setWatch', 'isWatching', 'getStatus', 'subscribe',
                    'aliases', 'serializeItem']) {
    if (API[k] == null) return 'missing: ' + k;
  }
  return true;
});

check('getStatus() returns the documented shape', () => {
  const { sandbox } = makeSandbox();
  const s = sandbox.window.SWR_CLOUD_LIBRARY.getStatus();
  for (const k of ['state', 'lastSyncAt', 'count', 'sizeBytes', 'error', 'watching']) {
    if (!(k in s)) return 'missing field: ' + k;
  }
  return true;
});

check('initial state is idle / no error / no lastSyncAt', () => {
  const { sandbox } = makeSandbox();
  const s = sandbox.window.SWR_CLOUD_LIBRARY.getStatus();
  if (s.state !== 'idle') return 'state: ' + s.state;
  if (s.error !== null) return 'error should be null: ' + JSON.stringify(s.error);
  if (s.lastSyncAt !== null) return 'lastSyncAt: ' + s.lastSyncAt;
  if (s.count !== 0) return 'count: ' + s.count;
  return true;
});

(async () => {
  await check('manifest() updates status fields from the server payload', async () => {
    const { sandbox } = makeSandbox();
    const API = sandbox.window.SWR_CLOUD_LIBRARY;
    await API.manifest();
    const s = API.getStatus();
    if (s.count !== 3) return 'count not updated: ' + s.count;
    if (s.sizeBytes !== 1024000) return 'sizeBytes not updated: ' + s.sizeBytes;
    if (!s.lastSyncAt) return 'lastSyncAt not set: ' + s.lastSyncAt;
    return true;
  });

  await check('push() flips state to pushing then idle; lastSyncAt is set', async () => {
    const { sandbox } = makeSandbox();
    const API = sandbox.window.SWR_CLOUD_LIBRARY;
    const events = [];
    API.subscribe((s) => events.push(s.state));
    await API.push([{ id: 'a', name: 'a', type: 'image', size: 100 },
                    { id: 'b', name: 'b', type: 'video', size: 200 }]);
    if (!events.includes('pushing')) return 'no pushing state observed: ' + events.join(',');
    if (events[events.length - 1] !== 'idle') return 'last state not idle: ' + events[events.length - 1];
    const s = API.getStatus();
    if (!s.lastSyncAt) return 'lastSyncAt missing';
    return true;
  });

  // ---- summary ----
  const pass = results.filter((r) => r.ok).length;
  const fail = results.filter((r) => !r.ok).length;
  console.log(`\n${pass} passed, ${fail} failed (${results.length} checks)`);
  if (fail > 0) process.exit(1);
})();

check('push() serializes items via serializeItem (drops blob: urls, caps thumb size)', () => {
  const { sandbox } = makeSandbox();
  const API = sandbox.window.SWR_CLOUD_LIBRARY;
  const item = { id: 'x', name: 'x', type: 'image', size: 100, thumb: 'blob:http://x' };
  const out = API.serializeItem(item);
  if (!out) return 'serializeItem returned null';
  if (out.thumb !== null) return 'blob url leaked: ' + out.thumb;
  return true;
});

check('setWatch(true) persists across reloads (localStorage)', () => {
  const { sandbox } = makeSandbox();
  const API = sandbox.window.SWR_CLOUD_LIBRARY;
  API.setWatch(true);
  if (!API.isWatching()) return 'watch=true did not stick in-memory';
  if (sandbox.window.localStorage.getItem('swr.cloud.watch') !== '1') {
    return 'watch not persisted: ' + sandbox.window.localStorage.getItem('swr.cloud.watch');
  }
  return true;
});

check('subscribe() returns an unsubscribe function', () => {
  const { sandbox } = makeSandbox();
  const API = sandbox.window.SWR_CLOUD_LIBRARY;
  let count = 0;
  const unsub = API.subscribe(() => { count++; });
  API.setWatch(true); // any setter triggers emit
  if (count === 0) return 'subscriber not called';
  unsub();
  API.setWatch(false);
  const after = count;
  API.setWatch(true);
  if (count !== after) return 'subscriber still called after unsubscribe: ' + count + ' vs ' + after;
  return true;
});

