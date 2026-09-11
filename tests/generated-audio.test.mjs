// tests/generated-audio.test.mjs — node test for lib/generated-audio.client.js
//
// Loads the client module in a vm context with a stubbed `window` so we can
// assert the public surface without spinning up a browser. The module is
// designed to be a single global seam; the unit test only checks the
// public API contract.
//
// Run: `npm run test:generated-audio`
// or:  `node tests/generated-audio.test.mjs`

import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

let passed = 0;
let failed = 0;
const failures = [];

function assert(cond, msg) {
  if (cond) {
    passed++;
    console.log(`  ok  ${msg}`);
  } else {
    failed++;
    failures.push(msg);
    console.log(`  FAIL ${msg}`);
  }
}

// Build a stubbed window: SWR.Audio has load() + play() spies; SWR_GENERATED_AUDIO
// is initially undefined so we can verify the module installs it.
function makeContext() {
  const calls = { load: [], play: [] };
  const win = {
    SWR: {
      Audio: {
        load: (file) => { calls.load.push(file); return undefined; },
        play: () => { calls.play.push(true); return undefined; },
      },
    },
    // Minimal global URL needed by blob/file creation in the module.
    URL: { createObjectURL: () => 'blob:stub', revokeObjectURL: () => {} },
    // Class shims — File is referenced explicitly via globalThis; the real
    // Node 18+ exposes File as a global. Provide a fallback constructor
    // that produces a duck-typed instance good enough for assertions.
    File: globalThis.File,
  };
  if (!win.File) {
    win.File = class FakeFile {
      constructor(parts, name, opts = {}) {
        this.parts = parts;
        this.name = name;
        this.type = (opts && opts.type) || '';
      }
    };
  }
  const ctx = {
    window: win,
    globalThis: win,
    URL: win.URL,
    File: win.File,
    console,
    setTimeout,
    Promise,
  };
  ctx.globalThis.window = win;
  ctx.globalThis.SWR = win.SWR;
  return { ctx, calls, win };
}

function loadModule() {
  const { ctx, calls, win } = makeContext();
  const src = readFileSync(resolve(ROOT, 'lib/generated-audio.client.js'), 'utf8');
  // The module references `window` directly; expose window + globals via vm context.
  vm.createContext(ctx);
  vm.runInContext(src, ctx);
  return { win, calls };
}

// ---------------------------------------------------------------------------
// Suite 1: importMp3 happy path
// ---------------------------------------------------------------------------
console.log('suite: importMp3 happy path');
{
  const { win, calls } = loadModule();
  assert(typeof win.SWR_GENERATED_AUDIO === 'object', 'module installs window.SWR_GENERATED_AUDIO');
  assert(typeof win.SWR_GENERATED_AUDIO.importMp3 === 'function', 'importMp3 is a function');
  assert(typeof win.SWR_GENERATED_AUDIO.fromUrl === 'function', 'fromUrl is a function');
  assert(typeof win.SWR_GENERATED_AUDIO.fromFile === 'function', 'fromFile is a function');
  assert(typeof win.SWR_GENERATED_AUDIO.isAvailable === 'function', 'isAvailable is a function');

  const blob = new win.File([new Uint8Array([1, 2, 3])], 'orig.mp3', { type: 'audio/mpeg' });
  // Web Blob is a global in Node 18+; if absent, build a tiny shim.
  const BlobCtor = globalThis.Blob || class { constructor(parts, opts) { this.parts = parts; this.type = (opts && opts.type) || ''; } };
  const realBlob = new BlobCtor([new Uint8Array([1, 2, 3])], { type: 'audio/mpeg' });

  const p = win.SWR_GENERATED_AUDIO.importMp3(realBlob);
  assert(p && typeof p.then === 'function', 'importMp3 returns a thenable');

  let resolved = null;
  await p.then((f) => { resolved = f; });
  assert(resolved instanceof win.File, 'resolves to a File');
  assert(calls.load.length === 1, 'SWR.Audio.load called once');
  assert(calls.load[0] === resolved, 'SWR.Audio.load called with the resolved File');
  assert(calls.play.length === 1, 'SWR.Audio.play called once (autoplay default true)');
  assert(resolved.name.endsWith('.mp3'), `File name ends with .mp3 (got ${resolved.name})`);
  assert(resolved.type === 'audio/mpeg', `File type is audio/mpeg (got ${resolved.type})`);
}

// ---------------------------------------------------------------------------
// Suite 2: fromUrl CORS failure → rejects with { cors: true }
// ---------------------------------------------------------------------------
console.log('suite: fromUrl CORS failure');
{
  const { win, calls } = loadContext_withFetchStub(/* throws */ true);
  // Re-use makeContext but override fetch on the same window — loadModule
  // already ran, so we need a fresh ctx that also runs the module after
  // stubbing fetch. Easier: build a new ctx with a fetch thrower.
  function loadWithFetch(impl) {
    const { ctx, calls: c2, win: w2 } = makeContext();
    ctx.fetch = impl;
    ctx.globalThis.fetch = impl;
    const src = readFileSync(resolve(ROOT, 'lib/generated-audio.client.js'), 'utf8');
    vm.createContext(ctx);
    vm.runInContext(src, ctx);
    return { win: w2, calls: c2 };
  }
  const { win: w2 } = loadWithFetch(() => Promise.reject(new TypeError('CORS preflight failed')));
  let rejectedWith = null;
  await w2.SWR_GENERATED_AUDIO.fromUrl('https://x.example/y.mp3').catch((r) => { rejectedWith = r; });
  assert(rejectedWith && rejectedWith.cors === true, 'fromUrl CORS failure rejects with { cors: true }');
}

// ---------------------------------------------------------------------------
// Suite 3: fromUrl HTTP error → rejects with { http: <status> }
// ---------------------------------------------------------------------------
console.log('suite: fromUrl HTTP error');
{
  function loadWithFetch(impl) {
    const { ctx, calls: c2, win: w2 } = makeContext();
    ctx.fetch = impl;
    ctx.globalThis.fetch = impl;
    const src = readFileSync(resolve(ROOT, 'lib/generated-audio.client.js'), 'utf8');
    vm.createContext(ctx);
    vm.runInContext(src, ctx);
    return { win: w2, calls: c2 };
  }
  const BlobCtor = globalThis.Blob || class { constructor(parts, opts) { this.parts = parts; this.type = (opts && opts.type) || ''; } };
  const { win: w2 } = loadWithFetch(() => Promise.resolve({
    ok: false,
    status: 404,
    blob: () => Promise.resolve(new BlobCtor([], { type: 'audio/mpeg' })),
  }));
  let rejectedWith = null;
  await w2.SWR_GENERATED_AUDIO.fromUrl('https://x.example/y.mp3').catch((r) => { rejectedWith = r; });
  assert(rejectedWith && rejectedWith.http === 404, `fromUrl HTTP 404 rejects with { http: 404 } (got ${JSON.stringify(rejectedWith)})`);
}

// ---------------------------------------------------------------------------
// Suite 4: isAvailable() reflects window state
// ---------------------------------------------------------------------------
console.log('suite: isAvailable');
{
  const { win } = loadModule();
  assert(win.SWR_GENERATED_AUDIO.isAvailable() === true, 'isAvailable true when SWR.Audio.load exists');

  const ctxNoSWR = { window: {}, console, setTimeout, Promise, File: globalThis.File, URL: { createObjectURL: () => '' } };
  ctxNoSWR.globalThis = ctxNoSWR;
  ctxNoSWR.window.URL = ctxNoSWR.URL;
  const src = readFileSync(resolve(ROOT, 'lib/generated-audio.client.js'), 'utf8');
  vm.createContext(ctxNoSWR);
  vm.runInContext(src, ctxNoSWR);
  assert(ctxNoSWR.window.SWR_GENERATED_AUDIO.isAvailable() === false, 'isAvailable false when SWR.Audio missing');
}

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------
console.log('');
console.log(`${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.log('failures:');
  failures.forEach((m) => console.log('  - ' + m));
  process.exit(1);
}
process.exit(0);

// helper alias used above — defined at bottom so the reads at top still type-check
function loadContext_withFetchStub() {
  return makeContext();
}