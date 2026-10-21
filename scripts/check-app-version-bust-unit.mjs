// scripts/check-app-version-bust-unit.mjs — unit coverage for the version
// cache-bust script. Loads lib/app-version-bust.js in a node:vm sandbox
// with stubbed localStorage / window.SWR_APP_VERSION / window.location /
// window.caches, then exercises the 8 cases below.
//
// The check helper is sync; the one case that needs to await a microtask
// (caches.delete() is called inside a Promise.then) waits for it inline
// and returns a boolean so the harness stays simple.
//
// Run: node scripts/check-app-version-bust-unit.mjs

import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const SRC = readFileSync(new URL('../lib/app-version-bust.js', import.meta.url), 'utf8');

function makeSandbox({ version, lsState, hasCaches = true, lsThrows = false }) {
  // Backing store. The script iterates localStorage with Object.keys()
  // and reads via .getItem / .setItem / .removeItem. We use a Map for
  // the data and expose a proxy whose own keys mirror the map.
  const backing = new Map(Object.entries(lsState || {}));
  const ls = lsThrows ? {
    getItem() { throw new Error('quota'); },
    setItem() { throw new Error('quota'); },
    removeItem() { throw new Error('quota'); },
    clear() { throw new Error('quota'); },
    key() { throw new Error('quota'); },
    get length() { throw new Error('quota'); },
  } : {
    getItem(k) { return backing.has(k) ? backing.get(k) : null; },
    setItem(k, v) { backing.set(k, String(v)); },
    removeItem(k) { backing.delete(k); },
    clear() { backing.clear(); },
    key(i) { return Array.from(backing.keys())[i] || null; },
    get length() { return backing.size; },
  };
  // The script's `Object.keys(localStorage)` walks the OWN keys of the
  // object. With a plain object literal that's the static set; to mirror
  // the Map dynamically we use a Proxy that reports the map's keys via
  // ownKeys + getOwnPropertyDescriptor.
  const lsProxy = lsThrows ? ls : new Proxy(ls, {
    ownKeys() {
      return Array.from(backing.keys());
    },
    getOwnPropertyDescriptor(target, key) {
      if (!backing.has(key)) return undefined;
      return { configurable: true, enumerable: true, value: backing.get(key) };
    },
  });

  let reloadCalled = 0;
  // Pre-seeded SW cache names. Independent of localStorage (caches is a
  // separate API), but the test stub returns them when the script calls
  // caches.keys(). Stored in a closure so the test can read what was
  // deleted.
  const swCacheNames = new Set();
  const windowObj = {
    SWR_APP_VERSION: version,
    location: {
      reload() { reloadCalled++; },
    },
    sessionStorage: {
      _cleared: 0,
      clear() { this._cleared++; },
    },
  };
  if (hasCaches) {
    const deleted = [];
    windowObj.caches = {
      keys: () => Promise.resolve(Array.from(swCacheNames)),
      delete: (n) => { deleted.push(n); swCacheNames.delete(n); return Promise.resolve(true); },
      _deleted: deleted,
      // Test helper: pre-seed a cache name.
      _seed: (n) => { swCacheNames.add(n); },
    };
  }
  const sandbox = {
    console,
    window: windowObj,
    // Provide global aliases the script's IIFE might read. The script
    // references bare `caches` and `localStorage`; in a browser these
    // resolve via the global object, so we expose them at the top of
    // the sandbox too.
    location: windowObj.location,
    sessionStorage: windowObj.sessionStorage,
    localStorage: lsProxy,
    ...(hasCaches ? { caches: windowObj.caches } : {}),
    setTimeout,
    clearTimeout,
  };
  sandbox.globalThis = sandbox;
  return { sandbox, reloadCalled: () => reloadCalled, backing };
}

const results = [];
function check(name, fn) {
  let ok = false, detail = '';
  try {
    const r = fn();
    if (r && typeof r.then === 'function') {
      throw new Error('check() returned a promise; wrap with `await (async () => ...)` or use checkAsync');
    }
    ok = r === true;
    detail = typeof r === 'string' ? r : '';
  } catch (e) {
    detail = e.message;
  }
  results.push({ name, ok, detail });
  console.log(`  ${ok ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`);
}

// For the one case that needs to await a microtask (caches.delete() is
// called inside a Promise.then), use checkAsync.
async function checkAsync(name, fn) {
  let ok = false, detail = '';
  try {
    const r = await fn();
    ok = r === true;
    detail = typeof r === 'string' ? r : '';
  } catch (e) {
    detail = e.message;
  }
  results.push({ name, ok, detail });
  console.log(`  ${ok ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`);
}

// ---- 1. Same version → no reload -------------------------------------
check('same version on disk as current → no reload', () => {
  const { sandbox, reloadCalled } = makeSandbox({
    version: '2026.10.13.1',
    lsState: { swr_app_version_seen: '2026.10.13.1' },
  });
  vm.createContext(sandbox);
  vm.runInContext(SRC, sandbox);
  if (reloadCalled() !== 0) return `reloaded ${reloadCalled()} time(s)`;
  return true;
});

// ---- 2. Different version → clear + reload ---------------------------
check('different version → localStorage cleared, reload once', () => {
  const { sandbox, reloadCalled, backing } = makeSandbox({
    version: '2026.10.13.1',
    lsState: {
      swr_app_version_seen: '2026.10.13.0',
      'swr.fx.intensity': '0.5',
      'swr.render.dprAutoLow': '1.5',
      'user-theme-pref': 'dark',  // not SWR-owned, must survive
    },
  });
  vm.createContext(sandbox);
  vm.runInContext(SRC, sandbox);
  if (reloadCalled() !== 1) return `reloaded ${reloadCalled()} time(s), expected 1`;
  if (backing.has('swr.fx.intensity')) return 'swr.fx.intensity not cleared';
  if (backing.has('swr.render.dprAutoLow')) return 'swr.render.dprAutoLow not cleared';
  if (!backing.has('user-theme-pref')) return 'non-SWR key (user-theme-pref) was wrongly cleared';
  if (backing.get('swr_app_version_seen') !== '2026.10.13.1') return 'SEEN_KEY not updated to current version';
  return true;
});

// ---- 3. Loop break after 3 reloads -----------------------------------
// 3 iterations, each with the prior counter, plus a 4th run that must bail.
check('loop break after 3 reloads in 60s', () => {
  let totalReloads = 0;
  for (let i = 0; i < 3; i++) {
    const { sandbox, reloadCalled, backing } = makeSandbox({
      version: '2026.10.13.1',
      lsState: { swr_app_version_seen: '2026.10.13.0' },
    });
    // Pre-seed the reload counter so each iteration sees the prior count.
    backing.set('swr_app_version_reload_count', String(i));
    vm.createContext(sandbox);
    vm.runInContext(SRC, sandbox);
    totalReloads += reloadCalled();
  }
  if (totalReloads !== 3) return `expected 3 reloads, got ${totalReloads}`;

  // 4th run — counter is 3, must NOT reload.
  const { sandbox, reloadCalled, backing } = makeSandbox({
    version: '2026.10.13.1',
    lsState: { swr_app_version_seen: '2026.10.13.0' },
  });
  backing.set('swr_app_version_reload_count', '3');
  vm.createContext(sandbox);
  vm.runInContext(SRC, sandbox);
  if (reloadCalled() !== 0) return `4th run reloaded (${reloadCalled()}) — loop not broken`;
  if (backing.has('swr_app_version_reload_count')) return 'reload counter not cleared on bail';
  return true;
});

// ---- 4. localStorage throws (private mode) → no crash ---------------
check('localStorage throws → no crash, reload still attempted', () => {
  const { sandbox, reloadCalled } = makeSandbox({
    version: '2026.10.13.1',
    lsState: {},
    lsThrows: true,
  });
  vm.createContext(sandbox);
  try {
    vm.runInContext(SRC, sandbox);
  } catch (e) {
    return `script threw: ${e.message}`;
  }
  if (reloadCalled() !== 1) return `reloaded ${reloadCalled()} time(s), expected 1`;
  return true;
});

// ---- 5. window.caches missing → no crash -----------------------------
check('window.caches missing → no crash', () => {
  const { sandbox, reloadCalled } = makeSandbox({
    version: '2026.10.13.1',
    lsState: { swr_app_version_seen: '2026.10.13.0' },
    hasCaches: false,
  });
  vm.createContext(sandbox);
  try {
    vm.runInContext(SRC, sandbox);
  } catch (e) {
    return `script threw: ${e.message}`;
  }
  if (reloadCalled() !== 1) return `reloaded ${reloadCalled()} time(s), expected 1`;
  return true;
});

// ---- 6. SWR-owned keys cleared, others preserved ---------------------
check('SWR keys cleared; non-SWR keys preserved', () => {
  const { sandbox, reloadCalled, backing } = makeSandbox({
    version: '2026.10.13.1',
    lsState: {
      'swr.fx.tone': '0.7',
      'swr_targeting_dismissed': '1',
      'airlock_logs': '[]',
      'airlock_version': '2026.10.12.1',
      'third-party-key': 'keep',
      'unrelated-setting': 'keep',
    },
  });
  vm.createContext(sandbox);
  vm.runInContext(SRC, sandbox);
  for (const k of ['swr.fx.tone', 'swr_targeting_dismissed', 'airlock_logs', 'airlock_version']) {
    if (backing.has(k)) return `${k} not cleared`;
  }
  for (const k of ['third-party-key', 'unrelated-setting']) {
    if (!backing.has(k)) return `${k} wrongly cleared`;
  }
  if (reloadCalled() !== 1) return `reloaded ${reloadCalled()} time(s), expected 1`;
  return true;
});

// ---- 7. SW caches other than current are deleted ---------------------
// Async because the script calls caches.delete() inside a .then.
checkAsync('SW caches other than swr-v5 are deleted', async () => {
  const { sandbox, reloadCalled } = makeSandbox({
    version: '2026.10.13.1',
    lsState: { swr_app_version_seen: '2026.10.13.0' },
  });
  // Pre-seed cache names via the stub's _seed helper. caches is a
  // separate API from localStorage, so we don't conflate the two.
  sandbox.window.caches._seed('swr-v4');
  sandbox.window.caches._seed('swr-v5');
  vm.createContext(sandbox);
  vm.runInContext(SRC, sandbox);
  // Wait for the Promise.then to resolve.
  await new Promise(r => setTimeout(r, 10));
  const deleted = sandbox.window.caches._deleted;
  if (!deleted.includes('swr-v4')) return `swr-v4 not deleted (got: ${JSON.stringify(deleted)})`;
  if (deleted.includes('swr-v5')) return `swr-v5 wrongly deleted`;
  if (reloadCalled() !== 1) return `reloaded ${reloadCalled()} time(s), expected 1`;
  return true;
});

// ---- 8. Missing window.SWR_APP_VERSION → bail silently ---------------
check('window.SWR_APP_VERSION undefined → no reload, no crash', () => {
  const { sandbox, reloadCalled } = makeSandbox({
    version: undefined,  // app-version.js didn't load
    lsState: {},
  });
  vm.createContext(sandbox);
  try {
    vm.runInContext(SRC, sandbox);
  } catch (e) {
    return `script threw: ${e.message}`;
  }
  if (reloadCalled() !== 0) return `reloaded ${reloadCalled()} time(s), expected 0`;
  return true;
});

// Top-level await — the async check has been pushed but its promise must
// settle before we read results[].
await new Promise(r => setTimeout(r, 50));

const failed = results.filter((r) => !r.ok);
console.log('');
console.log(failed.length === 0
  ? `APP-VERSION-BUST UNIT: ALL GREEN (${results.length} checks)`
  : `APP-VERSION-BUST UNIT: ${failed.length} CHECK(S) FAILED`);
process.exit(failed.length === 0 ? 0 : 1);
