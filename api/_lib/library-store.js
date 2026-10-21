// api/_lib/library-store.js — Cloud library backend for /api/library.
//
// Local-FS path (default, dormant Firestore):
//   - Manifest lives at <ROOT>/library/<userId>.json
//   - readLibraryManifest(uid) reads it; missing file → empty manifest
//   - writeLibraryManifest(uid, items) writes manifest + a compact
//     per-item log (<ROOT>/library/<uid>/items.jsonl). The blobs
//     themselves are not stored yet — that's the gap Phase 2 fills
//     via signed-upload URLs to Cloud Storage.
//
// Firestore path (when SWR_PROJECTS_STORE=firestore AND configured):
//   - manifest: users/<uid>/library/manifest (a doc with count, size,
//     lastSyncAt, schema)
//   - items:    users/<uid>/library/items/<id> (per-asset document,
//     max 1 MiB; thumbs stored inline up to 250 KB)
//
// Phase 1 ships only the local-FS path. Phase 2 swaps in Firestore
// via the same `getFirestore()` helper used by connect-store.

import path from 'node:path';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';

const ROOT = process.env.SWR_USER_LIBRARY_ROOT ||
             process.env.SWR_ROOT ||
             path.resolve(process.cwd(), '.swr-data');

function userDir(userId) {
  const safe = String(userId || '').replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 64);
  return path.join(ROOT, 'library', safe);
}
function manifestPath(userId) {
  return path.join(userDir(userId), 'manifest.json');
}
function itemsPath(userId) {
  return path.join(userDir(userId), 'items.jsonl');
}

function emptyManifest() {
  return { count: 0, sizeBytes: 0, lastSyncAt: null, schema: 'swr-user-library/v1' };
}

async function readLibraryManifest(userId) {
  if (!userId) return emptyManifest();
  const fp = manifestPath(userId);
  if (!existsSync(fp)) return emptyManifest();
  try {
    const raw = await readFile(fp, 'utf8');
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object') return Object.assign(emptyManifest(), parsed);
    return emptyManifest();
  } catch (_) {
    return emptyManifest();
  }
}

async function writeLibraryManifest(userId, items) {
  const dir = userDir(userId);
  await mkdir(dir, { recursive: true });
  const now = new Date().toISOString();
  const count = Array.isArray(items) ? items.length : 0;
  const sizeBytes = Array.isArray(items)
    ? items.reduce((s, it) => s + (Number(it && it.size) || 0), 0)
    : 0;
  const manifest = { count, sizeBytes, lastSyncAt: now, schema: 'swr-user-library/v1' };
  await writeFile(manifestPath(userId), JSON.stringify(manifest, null, 2), 'utf8');
  // Compact per-item log (one JSON line per item). Skipped silently
  // when items is empty — the manifest alone is enough to answer GET.
  if (Array.isArray(items) && items.length) {
    const lines = items.map((it) => JSON.stringify(it)).join('\n') + '\n';
    await writeFile(itemsPath(userId), lines, 'utf8');
  }
  return manifest;
}

async function wipeLibrary(userId) {
  const dir = userDir(userId);
  try {
    if (existsSync(manifestPath(userId))) {
      const { unlink } = await import('node:fs/promises');
      await unlink(manifestPath(userId));
    }
    if (existsSync(itemsPath(userId))) {
      const { unlink } = await import('node:fs/promises');
      await unlink(itemsPath(userId));
    }
  } catch (_) { /* directory empty */ }
  return emptyManifest();
}

// ---- demo / sample seed --------------------------------------------------
// For local dev + demos: a curated set of small "zops" (the docs/data
// blobs the API returns when the user has no library yet, or when a
// demo account wants to show off a non-empty state). These are NOT
// real media — they're synthetic JSON descriptions the client renders
// as placeholders. Replace with curated assets in production.

const SAMPLE_ZOPS = [
  {
    id: 'zop-purple-001', name: 'Purple wash', type: 'image',
    w: 1280, h: 720, duration: 0, size: 184_320,
    thumb: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVQYV2NgYAAAAAMAAWgmWQ0AAAAASUVORK5CYII=',
    updatedAt: new Date().toISOString(),
    source: 'demo',
  },
  {
    id: 'zop-neon-002', name: 'Neon loop', type: 'video',
    w: 1920, h: 1080, duration: 8, size: 2_457_600,
    updatedAt: new Date().toISOString(),
    source: 'demo',
  },
  {
    id: 'zop-arcade-003', name: 'Arcade bleep', type: 'audio',
    w: 0, h: 0, duration: 4, size: 92_160,
    updatedAt: new Date().toISOString(),
    source: 'demo',
  },
  {
    id: 'zop-grid-004', name: 'Grid plate', type: 'image',
    w: 1280, h: 720, duration: 0, size: 245_760,
    updatedAt: new Date().toISOString(),
    source: 'demo',
  },
  {
    id: 'zop-camera-005', name: 'Camera prism', type: 'camera',
    w: 1280, h: 720, duration: 0, size: 0,
    updatedAt: new Date().toISOString(),
    source: 'demo',
  },
  {
    id: 'zop-ray-006', name: 'Ray trace', type: 'video',
    w: 1920, h: 1080, duration: 12, size: 4_718_592,
    updatedAt: new Date().toISOString(),
    source: 'demo',
  },
];

async function seedSampleLibrary(userId, count) {
  const n = (typeof count === 'number' && count > 0) ? Math.min(SAMPLE_ZOPS.length, count) : SAMPLE_ZOPS.length;
  const items = SAMPLE_ZOPS.slice(0, n).map((z) => Object.assign({}, z, {
    updatedAt: new Date().toISOString(),
  }));
  return writeLibraryManifest(userId, items);
}

async function listSampleZops() {
  return SAMPLE_ZOPS.slice();
}

export { readLibraryManifest, writeLibraryManifest, wipeLibrary,
         seedSampleLibrary, listSampleZops, emptyManifest };
export default { readLibraryManifest, writeLibraryManifest, wipeLibrary,
                 seedSampleLibrary, listSampleZops };
