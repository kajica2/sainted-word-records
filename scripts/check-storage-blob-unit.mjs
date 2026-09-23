// scripts/check-storage-blob-unit.mjs — unit coverage for the Vercel Blob
// branch of api/_lib/db.js, with the SDK swapped for an in-memory stub.
//
// Why this exists: the Blob branch is unreachable in CI (no credentials)
// and in a bare local dev checkout (no credentials). Without this test,
// bad option names or a breaking @vercel/blob upgrade would only surface
// in production. The stub pins the PUT/HEAD/DELETE call shapes against
// the documented SDK API.
//
// Covers all three credential states, because getting the detection wrong
// silently degrades to the ephemeral filesystem (the exact bug this
// storage layer was written to fix):
//   1. BLOB_READ_WRITE_TOKEN          -> 'read-write-token'
//   2. BLOB_STORE_ID + VERCEL_OIDC_TOKEN -> 'oidc'
//   3. neither                        -> 'local-fs'
//
// Run: node scripts/check-storage-blob-unit.mjs

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const TMP = mkdtempSync(join(tmpdir(), 'swrc-blob-test-'));

// ---- In-memory @vercel/blob stand-in ---------------------------------
const STUB_SOURCE = `
const store = new Map();
export async function put(pathname, body, options) {
  if (!options || options.access !== 'public') {
    throw new Error('stub: put() requires options.access === "public"');
  }
  const buf = Buffer.isBuffer(body) ? body : Buffer.from(body);
  const url = 'https://stub.blob.vercel-storage.com/' + pathname;
  store.set(pathname, { body: buf, contentType: options.contentType, url });
  return { url, pathname, contentType: options.contentType, size: buf.length };
}
export async function head(pathname) {
  const rec = store.get(pathname);
  if (!rec) {
    const e = new Error('The requested blob does not exist');
    e.name = 'BlobNotFoundError';
    throw e;
  }
  return {
    size: rec.body.length, url: rec.url, pathname,
    contentType: rec.contentType, uploadedAt: new Date(),
    contentDisposition: 'inline', cacheControl: 'public', etag: 'stub',
  };
}
export async function del(pathname) {
  if (!store.has(pathname)) {
    const e = new Error('The requested blob does not exist');
    e.name = 'BlobNotFoundError';
    throw e;
  }
  store.delete(pathname);
}
export function __store() { return store; }
`;

const HOOK_SOURCE = `
export async function resolve(specifier, context, nextResolve) {
  if (specifier === '@vercel/blob') return { url: 'stub:vercel-blob', shortCircuit: true };
  return nextResolve(specifier, context);
}
export async function load(url, context, nextLoad) {
  if (url === 'stub:vercel-blob') {
    return { format: 'module', source: ${JSON.stringify(STUB_SOURCE)}, shortCircuit: true };
  }
  return nextLoad(url, context);
}
`;

const hookPath = join(TMP, 'stub-loader.mjs');
writeFileSync(hookPath, HOOK_SOURCE);
const hookImport = `data:text/javascript,import{register}from"node:module";register(${JSON.stringify('file://' + hookPath)});`;

// ---- Assertions run in a child so env can differ per case ------------
const ASSERT_BLOB = `
  const { strict: assert } = await import('node:assert');
  const db = await import('./api/_lib/db.js');
  const { __store } = await import('@vercel/blob');

  // Detection: the mode must match the credential state, because a wrong
  // detection here silently degrades to the ephemeral filesystem.
  const backend = db.storageBackend();
  assert.equal(backend.mode, EXPECTED_MODE, 'storageBackend().mode');
  assert.equal(backend.persistent, true, 'persistent');

  // safeKey guards stay intact in every mode.
  assert.throws(() => db.safeKey('../etc/passwd'), /invalid key/);
  assert.throws(() => db.safeKey('/abs'), /invalid key/);
  assert.throws(() => db.safeKey('a\\\\b'), /invalid key/);
  assert.equal(db.safeKey('u/f.mp3'), 'u/f.mp3');

  // signed-upload / signed-download keep the same URL shape in both modes.
  const up = await db.createSignedUpload('u1', 'audio/a.mp3', 'audio/mpeg');
  assert.equal(up.key, 'u1/audio/a.mp3');
  assert.equal(up.method, 'PUT');
  assert.ok(up.uploadUrl.startsWith('/api/storage/object?key='));
  const dl = await db.readSignedDownload('u1', 'audio/a.mp3');
  assert.ok(dl.downloadUrl.startsWith('/api/storage/object?key='));

  // Round-trip through the blob branch.
  const putRes = await db.storagePut('u1', 'u1/audio/a.mp3', Buffer.from('HELLO_BLOB'), 'audio/mpeg');
  assert.equal(putRes.size, 10);
  assert.equal(putRes.key, 'u1/audio/a.mp3');
  assert.ok(putRes.url.includes('stub.blob.vercel-storage.com'), 'went to the Blob stub');
  assert.ok(__store().has('u1/audio/a.mp3'), 'stub store holds the blob');

  assert.equal((await db.storageHead('u1', 'u1/audio/a.mp3')).size, 10);
  assert.equal(await db.storageHead('u1', 'u1/nope.mp3'), null, 'missing head -> null');

  assert.equal(await db.storageDelete('u1', 'u1/audio/a.mp3'), true);
  assert.ok(!__store().has('u1/audio/a.mp3'));
  assert.equal(await db.storageDelete('u1', 'u1/nope.mp3'), false, 'missing delete -> false');

  // Health reports the mode so a live deploy can be checked with one GET.
  assert.equal((await db.health()).storage.mode, EXPECTED_MODE);
`;

const ASSERT_LOCAL = `
  const { strict: assert } = await import('node:assert');
  const { existsSync } = await import('node:fs');
  const { join } = await import('node:path');
  const db = await import('./api/_lib/db.js');
  const { __store } = await import('@vercel/blob');

  // No credentials -> the ephemeral filesystem, and the stub must stay
  // untouched (proves we did not call the SDK).
  const backend = db.storageBackend();
  assert.equal(backend.mode, 'local-fs', 'storageBackend().mode');
  assert.equal(backend.persistent, false, 'not persistent');

  const putRes = await db.storagePut('u1', 'u1/audio/a.mp3', Buffer.from('HELLO_DISK'), 'audio/mpeg');
  assert.equal(putRes.size, 10);
  assert.equal(putRes.url, undefined, 'local-fs put has no Blob url');
  assert.equal(__store().size, 0, 'Blob SDK was not called');
  assert.ok(existsSync(join(process.env.SWRC_DATA_DIR, 'storage', 'u1', 'audio', 'a.mp3')), 'file landed on disk');

  assert.equal((await db.storageHead('u1', 'u1/audio/a.mp3')).size, 10);
  assert.equal(await db.storageHead('u1', 'u1/nope.mp3'), null);
  assert.equal(await db.storageDelete('u1', 'u1/audio/a.mp3'), true);
  assert.equal(await db.storageDelete('u1', 'u1/nope.mp3'), false);
`;

const CASES = [
  {
    label: 'read-write token',
    expected: 'read-write-token',
    env: { BLOB_READ_WRITE_TOKEN: 'vercel_blob_rw_FAKE_for_test' },
    body: ASSERT_BLOB,
  },
  {
    label: 'OIDC (store id + oidc token)',
    expected: 'oidc',
    env: { BLOB_STORE_ID: 'store_FAKE', VERCEL_OIDC_TOKEN: 'oidc_FAKE' },
    body: ASSERT_BLOB,
  },
  {
    label: 'no credentials -> local-fs',
    expected: 'local-fs',
    env: {},
    body: ASSERT_LOCAL,
  },
];

let failed = 0;
for (const c of CASES) {
  // Start from a clean env: never inherit a real token from the shell.
  const env = { ...process.env };
  delete env.BLOB_READ_WRITE_TOKEN;
  delete env.BLOB_STORE_ID;
  delete env.VERCEL_OIDC_TOKEN;
  Object.assign(env, c.env, {
    SWRC_DATA_DIR: TMP,
    NODE_ENV: 'test', // suppress the local-fs warning during the suite
  });

  // Run each case from a temp .mjs file: `-e` with --input-type=module
  // does not reliably parse top-level await across Node versions. The file
  // lives in REPO_ROOT so the body's relative imports resolve, and is
  // removed after the run.
  const casePath = join(REPO_ROOT, `.storage-blob-case-${c.expected}.mjs`);
  writeFileSync(casePath, `const EXPECTED_MODE = ${JSON.stringify(c.expected)};\n${c.body}\nconsole.log('ok');\n`);

  const child = spawnSync(process.execPath, [
    '--import', hookImport,
    casePath,
  ], { encoding: 'utf8', cwd: REPO_ROOT, env });
  rmSync(casePath, { force: true });

  if (child.status === 0 && /(^|\n)ok(\n|$)/.test(child.stdout || '')) {
    console.log(`  ✓ ${c.label} -> ${c.expected}`);
  } else {
    failed++;
    console.log(`  ✗ ${c.label} -> expected ${c.expected}`);
    const detail = (child.stderr || child.stdout || '').trim();
    if (detail) console.log(detail.split('\n').slice(0, 12).map((l) => '      ' + l).join('\n'));
  }
}

// Remove the disks the local-fs case wrote.
rmSync(TMP, { recursive: true, force: true });

console.log('');
console.log(failed === 0
  ? 'STORAGE BLOB UNIT: ALL GREEN (3 credential states)'
  : `STORAGE BLOB UNIT: ${failed} CASE(S) FAILED`);
process.exit(failed === 0 ? 0 : 1);
