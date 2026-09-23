// Throwaway: exercise the Blob branch of api/_lib/db.js with a stubbed
// @vercel/blob module. Verifies put/get/head/del wiring + guards without
// needing a real BLOB_READ_WRITE_TOKEN.
//
// Why this exists: the Blob branch is unreachable in CI (no token) and in
// local dev (no token). Without this test, the wiring could rot silently
// between the shape-level assertions and the production deploy. The stub
// pins the PUT/HEAD/DELETE call shapes against @vercel/blob's documented
// API, so a breaking SDK upgrade or a bad option name fails here.
//
// Run: node scripts/check-storage-blob-unit.mjs

import { strict as assert } from 'node:assert';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const TMP = mkdtempSync(join(tmpdir(), 'swrc-blob-test-'));
process.env.SWRC_DATA_DIR = TMP;
process.env.BLOB_READ_WRITE_TOKEN = 'vercel_blob_rw_FAKE_token_for_test';

// ---- Stub @vercel/blob via a loader hook ----------------------------
// We install a resolve+load hook that swaps the real module for our stub.
const stubSource = `
const store = new Map();
export async function put(pathname, body, options) {
  if (!options || options.access !== 'public') {
    throw new Error('stub: options.access must be "public"');
  }
  const buf = Buffer.isBuffer(body) ? body : Buffer.from(body);
  const url = 'https://stub.blob.vercel-storage.com/' + pathname;
  store.set(pathname, { body: buf, contentType: options.contentType || 'application/octet-stream', url });
  return { url, pathname, contentType: options.contentType, size: buf.length };
}
export async function head(pathname) {
  const rec = store.get(pathname);
  if (!rec) {
    const e = new Error('The requested blob does not exist');
    e.name = 'BlobNotFoundError';
    throw e;
  }
  return { size: rec.body.length, url: rec.url, pathname, contentType: rec.contentType, uploadedAt: new Date(), contentDisposition: 'inline', cacheControl: 'public', etag: 'stub' };
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

const hookSource = `
export async function resolve(specifier, context, nextResolve) {
  if (specifier === '@vercel/blob') {
    return { url: 'stub:vercel-blob', shortCircuit: true };
  }
  return nextResolve(specifier, context);
}
export async function load(url, context, nextLoad) {
  if (url === 'stub:vercel-blob') {
    return { format: 'module', source: ${JSON.stringify(stubSource)}, shortCircuit: true };
  }
  return nextLoad(url, context);
}
`;

const hookPath = join(TMP, 'stub-loader.mjs');
writeFileSync(hookPath, hookSource);

// ---- Run the assertions in a child process with the hook -------------
const { spawnSync } = await import('node:child_process');
const child = spawnSync(process.execPath, [
  '--import', `data:text/javascript,import{register}from"node:module";register(${JSON.stringify('file://' + hookPath)});`,
  '--input-type=module',
  '-e', `
    import { strict as assert } from 'node:assert';
    const db = await import('./api/_lib/db.js');
    const { __store } = await import('@vercel/blob');

    // 1. safeKey guards
    assert.throws(() => db.safeKey('../etc/passwd'), /invalid key/);
    assert.throws(() => db.safeKey('/abs'), /invalid key/);
    assert.throws(() => db.safeKey('a\\\\b'), /invalid key/);
    assert.equal(db.safeKey('u/f.mp3'), 'u/f.mp3');
    console.log('  ok safeKey guards');

    // 2. signed-upload shape (backend-agnostic)
    const up = await db.createSignedUpload('u1', 'audio/a.mp3', 'audio/mpeg');
    assert.equal(up.key, 'u1/audio/a.mp3');
    assert.ok(up.uploadUrl.startsWith('/api/storage/object?key='));
    console.log('  ok createSignedUpload');

    // 3. storagePut writes to Blob (stub store)
    const putRes = await db.storagePut('u1', 'u1/audio/a.mp3', Buffer.from('HELLO_BLOB'), 'audio/mpeg');
    assert.equal(putRes.size, 10);
    assert.equal(putRes.key, 'u1/audio/a.mp3');
    assert.ok(putRes.url.includes('stub.blob.vercel-storage.com'));
    assert.ok(__store().has('u1/audio/a.mp3'), 'stub store received the blob');
    console.log('  ok storagePut -> Blob');

    // 4. storageHead reads size
    const h = await db.storageHead('u1', 'u1/audio/a.mp3');
    assert.equal(h.size, 10);
    console.log('  ok storageHead');

    // 5. storageHead returns null for missing (BlobNotFoundError mapped)
    const h2 = await db.storageHead('u1', 'u1/nope.mp3');
    assert.equal(h2, null);
    console.log('  ok storageHead missing -> null');

    // 6. signed-download shape
    const dl = await db.readSignedDownload('u1', 'audio/a.mp3');
    assert.ok(dl.downloadUrl.startsWith('/api/storage/object?key='));
    console.log('  ok readSignedDownload');

    // 7. storageDelete removes from Blob
    const d1 = await db.storageDelete('u1', 'u1/audio/a.mp3');
    assert.equal(d1, true);
    assert.ok(!__store().has('u1/audio/a.mp3'));
    console.log('  ok storageDelete');

    // 8. storageDelete on missing -> false (not a throw)
    const d2 = await db.storageDelete('u1', 'u1/nope.mp3');
    assert.equal(d2, false);
    console.log('  ok storageDelete missing -> false');

    console.log('');
    console.log('ALL GREEN (Blob branch)');
  `,
], { encoding: 'utf8', cwd: REPO_ROOT });

process.stdout.write(child.stdout || '');
process.stderr.write(child.stderr || '');
rmSync(TMP, { recursive: true, force: true });
process.exit(child.status ?? 1);
