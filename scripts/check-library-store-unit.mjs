// scripts/check-library-store-unit.mjs — Phase 1 contract for
// api/_lib/library-store.js. Tests run on the local-FS path (which is
// always available — the Firestore path is dormant in Phase 1).
//
// Verifies:
//   - readLibraryManifest(uid) returns an empty manifest for an
//     unknown user (count:0, sizeBytes:0, lastSyncAt:null)
//   - writeLibraryManifest(uid, items) persists the manifest + a
//     compact items log; reads back the same numbers
//   - seedSampleLibrary + listSampleZops expose the demo zops
//   - wipeLibrary(uid) removes both files

import nodePath from 'node:path';
import { tmpdir } from 'node:os';
import { mkdtempSync, rmSync } from 'node:fs';

const results = [];
async function check(name, fn) {
  let ok = false;
  let detail = '';
  try {
    const r = await fn();
    // Convention: test fns return true on pass, a string on fail.
    // Anything else (undefined, a Promise, etc.) is treated as a
    // setup bug, which we surface as a clear failure with a helpful
    // message instead of letting `r === true` quietly fail.
    if (r === true) ok = true;
    else if (typeof r === 'string') { ok = false; detail = r; }
    else if (r === undefined) { ok = false; detail = 'test fn returned undefined (missing return statement?)'; }
    else { ok = false; detail = 'unexpected return: ' + JSON.stringify(r); }
  } catch (e) {
    detail = (e && e.message) ? e.message : String(e);
  }
  results.push({ name, ok, detail });
  console.log((ok ? '  PASS  ' : '  FAIL  ') + name + (detail ? ' — ' + detail : ''));
}

async function withTempDir(fn) {
  const dir = mkdtempSync(nodePath.join(tmpdir(), 'swr-library-'));
  process.env.SWR_USER_LIBRARY_ROOT = dir;
  const url = (await import('node:url')).pathToFileURL(
    nodePath.resolve(nodePath.dirname(new URL(import.meta.url).pathname), '../api/_lib/library-store.js')
  ).href + '?nocache=' + Math.random();
  const mod = await import(url);
  try {
    return await fn(mod);
  } finally {
    delete process.env.SWR_USER_LIBRARY_ROOT;
    rmSync(dir, { recursive: true, force: true });
  }
}

await check('readLibraryManifest returns empty manifest for an unknown user', async () => {
  return await withTempDir(async (mod) => {
    const m = await mod.readLibraryManifest('somebody-new-' + Math.random());
    if (m.count !== 0) return 'count: ' + m.count;
    if (m.sizeBytes !== 0) return 'sizeBytes: ' + m.sizeBytes;
    if (m.lastSyncAt !== null) return 'lastSyncAt: ' + m.lastSyncAt;
    if (m.schema !== 'swr-user-library/v1') return 'schema: ' + m.schema;
    return true;
  });
});

await check('writeLibraryManifest persists count + sizeBytes; reads back', async () => {
  return await withTempDir(async (mod) => {
    const uid = 'u-' + Math.random();
    const items = [
      { id: 'a', name: 'a', type: 'image', size: 1024, w: 100, h: 100, duration: 0, thumb: null, source: 'browser', updatedAt: '2026-10-20T00:00:00.000Z' },
      { id: 'b', name: 'b', type: 'video', size: 4096, w: 200, h: 200, duration: 5, thumb: null, source: 'browser', updatedAt: '2026-10-20T00:00:00.000Z' },
    ];
    const out = await mod.writeLibraryManifest(uid, items);
    if (out.count !== 2) return 'write: count: ' + out.count;
    if (out.sizeBytes !== 5120) return 'write: sizeBytes: ' + out.sizeBytes;
    const back = await mod.readLibraryManifest(uid);
    if (back.count !== 2) return 'readback count: ' + back.count;
    if (back.sizeBytes !== 5120) return 'readback sizeBytes: ' + back.sizeBytes;
    if (!back.lastSyncAt) return 'readback lastSyncAt empty';
    return true;
  });
});

await check('seedSampleLibrary writes the demo zops', async () => {
  return await withTempDir(async (mod) => {
    const uid = 'demo-' + Math.random();
    const out = await mod.seedSampleLibrary(uid);
    if (out.count < 1) return 'no items: ' + out.count;
    const back = await mod.readLibraryManifest(uid);
    if (back.count !== out.count) return 'mismatch: ' + back.count + ' vs ' + out.count;
    return true;
  });
});

await check('listSampleZops returns at least 5 demo entries', async () => {
  return await withTempDir(async (mod) => {
    const zops = await mod.listSampleZops();
    if (!Array.isArray(zops) || zops.length < 5) return 'zops: ' + (zops && zops.length);
    if (!zops[0].id || !zops[0].name || !zops[0].type) return 'shape: ' + JSON.stringify(zops[0]);
    return true;
  });
});

await check('wipeLibrary removes the persisted manifest', async () => {
  return await withTempDir(async (mod) => {
    const uid = 'wipe-' + Math.random();
    await mod.seedSampleLibrary(uid);
    const m1 = await mod.readLibraryManifest(uid);
    if (m1.count === 0) return 'preconditions failed (empty after seed)';
    const out = await mod.wipeLibrary(uid);
    if (out.count !== 0) return 'wipe did not zero manifest: ' + out.count;
    const m2 = await mod.readLibraryManifest(uid);
    if (m2.count !== 0) return 'post-wipe manifest not empty';
    return true;
  });
});

await check('writeLibraryManifest handles mixed-type items without crashing', async () => {
  return await withTempDir(async (mod) => {
    const uid = 'mixed-' + Math.random();
    const items = [
      { id: 'a', name: 'a', type: 'image', size: 100, w: 0, h: 0, duration: 0 },
      { id: 'b', name: 'b', type: 'xml', size: 100, w: 0, h: 0, duration: 0 },
    ];
    const out = await mod.writeLibraryManifest(uid, items);
    if (typeof out.count !== 'number') return 'no count: ' + JSON.stringify(out);
    return true;
  });
});

// ---- summary ----
(async () => {
  await new Promise((r) => setTimeout(r, 100));
  const pass = results.filter((r) => r.ok).length;
  const fail = results.filter((r) => !r.ok).length;
  console.log(`\n${pass} passed, ${fail} failed (${results.length} checks)`);
  if (fail > 0) process.exit(1);
})();

