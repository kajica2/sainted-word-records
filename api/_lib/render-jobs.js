// api/_lib/render-jobs.js — offline render job store + local worker spawn.
//
// The Chrome + ffmpeg pipeline in scripts/render-full-song.mjs cannot run on
// Vercel serverless (25-minute songs, Puppeteer, image2pipe). Jobs live under
// DATA_ROOT/render-jobs/ and a local Node worker does the work.
//
// Public surface:
//   createJob(input) → job
//   getJob(id) → job | null
//   listJobs({ limit }) → job[]
//   updateJob(id, patch) → job
//   resolveAllowedPath(p) → absolute path or throws
//   tryStartNext() → spawned job id | null
//   isOfflineRenderAvailable() → boolean
//   maxConcurrent() → number

import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { DATA_ROOT, readJson, writeJson, withLock, uuid } from './db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '../..');
const JOBS_DIR = path.join(DATA_ROOT, 'render-jobs');
const INDEX_PATH = path.join(JOBS_DIR, 'index.json');
const OUT_DIR = path.join(DATA_ROOT, 'render-out');

const AUDIO_EXT = new Set(['.mp3', '.wav', '.m4a', '.aac', '.flac', '.ogg']);
const LIBRARY_EXT = new Set([
  ...AUDIO_EXT,
  '.mp4', '.webm', '.mov', '.gif', '.png', '.jpg', '.jpeg', '.webp',
]);

const VARIANT_RE = /^[a-z0-9_-]+$/;

function nowIso() {
  return new Date().toISOString();
}

export function isOfflineRenderAvailable() {
  // Vercel serverless cannot host Puppeteer + ffmpeg for full-song renders.
  // Local `npm run dev` / serve-repo / a dedicated render host can.
  if (process.env.VERCEL) return false;
  if (process.env.SWR_RENDER_DISABLE === '1') return false;
  return true;
}

export function maxConcurrent() {
  const n = Number(process.env.SWR_RENDER_MAX_CONCURRENT || '1');
  if (!Number.isFinite(n) || n < 1) return 1;
  return Math.min(4, Math.floor(n));
}

function jobPath(id) {
  return path.join(JOBS_DIR, `${id}.json`);
}

function ensureDirs() {
  fs.mkdirSync(JOBS_DIR, { recursive: true });
  fs.mkdirSync(OUT_DIR, { recursive: true });
}

async function readIndex() {
  ensureDirs();
  const raw = await readJson(INDEX_PATH, []);
  return Array.isArray(raw) ? raw : [];
}

async function writeIndex(ids) {
  ensureDirs();
  await writeJson(INDEX_PATH, ids);
}

/** Resolve a caller-supplied path and refuse anything outside the repo or DATA_ROOT. */
export function resolveAllowedPath(input, { kind = 'audio' } = {}) {
  if (typeof input !== 'string' || !input.trim()) {
    throw Object.assign(new Error('path required'), { code: 'missing_path' });
  }
  const raw = input.trim();
  if (raw.includes('\0') || raw.includes('..')) {
    throw Object.assign(new Error('path traversal refused'), { code: 'invalid_path' });
  }
  const abs = path.isAbsolute(raw) ? path.resolve(raw) : path.resolve(REPO_ROOT, raw);
  const underRepo = abs === REPO_ROOT || abs.startsWith(REPO_ROOT + path.sep);
  const underData = abs === DATA_ROOT || abs.startsWith(DATA_ROOT + path.sep);
  if (!underRepo && !underData) {
    throw Object.assign(new Error('path outside allowed roots'), { code: 'invalid_path' });
  }
  if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) {
    throw Object.assign(new Error('file not found'), { code: 'not_found' });
  }
  const ext = path.extname(abs).toLowerCase();
  const allowed = kind === 'library' ? LIBRARY_EXT : AUDIO_EXT;
  if (!allowed.has(ext)) {
    throw Object.assign(new Error(`unsupported extension ${ext}`), { code: 'bad_extension' });
  }
  return abs;
}

export function assertVariant(variant) {
  const v = String(variant || 'hallucination');
  if (!VARIANT_RE.test(v)) {
    throw Object.assign(new Error('invalid variant'), { code: 'invalid_variant' });
  }
  const page = path.join(REPO_ROOT, 'versions', `${v}.html`);
  if (!fs.existsSync(page)) {
    throw Object.assign(new Error(`unknown variant: ${v}`), { code: 'unknown_variant' });
  }
  return v;
}

function publicJob(job) {
  if (!job) return null;
  // Never leak absolute host paths to clients that did not supply them —
  // keep basename + status fields only for list views. Full job is returned
  // to the owner over the authenticated status endpoint; still strip nothing
  // essential for polling.
  return {
    id: job.id,
    status: job.status,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    variant: job.variant,
    fps: job.fps,
    width: job.width,
    height: job.height,
    autoPick: !!job.autoPick,
    audioName: job.audioName,
    libraryCount: Array.isArray(job.libraryPaths) ? job.libraryPaths.length : 0,
    progress: job.progress || null,
    error: job.error || null,
    framesWritten: job.framesWritten ?? null,
    durationMs: job.durationMs ?? null,
    downloadReady: job.status === 'done' && !!job.outPath,
  };
}

export { publicJob };

export async function getJob(id) {
  if (!id || typeof id !== 'string' || !/^[a-f0-9-]{8,40}$/i.test(id)) return null;
  ensureDirs();
  const job = await readJson(jobPath(id), null);
  return job && job.id ? job : null;
}

export async function updateJob(id, patch) {
  return withLock(async () => {
    const job = await getJob(id);
    if (!job) return null;
    const next = { ...job, ...patch, updatedAt: nowIso() };
    await writeJson(jobPath(id), next);
    return next;
  });
}

export async function listJobs({ limit = 50, userId } = {}) {
  const ids = await readIndex();
  const out = [];
  const cap = Math.max(1, Math.min(200, limit));
  for (const id of ids) {
    if (out.length >= cap) break;
    const job = await getJob(id);
    if (!job) continue;
    if (userId !== undefined && job.userId !== userId) continue;
    out.push(publicJob(job));
  }
  return out;
}

export async function createJob(input = {}) {
  ensureDirs();
  const audioPath = resolveAllowedPath(input.audioPath, { kind: 'audio' });
  const libraryPaths = Array.isArray(input.libraryPaths)
    ? input.libraryPaths.map((p) => resolveAllowedPath(p, { kind: 'library' }))
    : [];

  const autoPick = !!input.autoPick;
  let variant = 'hallucination';
  if (!autoPick) {
    variant = assertVariant(input.variant || 'hallucination');
  } else if (input.variant) {
    variant = assertVariant(input.variant);
  }

  const fps = clampInt(input.fps, 1, 60, 24);
  const width = clampInt(input.width, 160, 1920, 640);
  const height = clampInt(input.height, 90, 1080, 360);

  const id = uuid();
  const outPath = path.join(OUT_DIR, `${id}.mp4`);
  const job = {
    id,
    status: 'queued',
    createdAt: nowIso(),
    updatedAt: nowIso(),
    userId: input.userId || null,
    audioPath,
    audioName: path.basename(audioPath),
    libraryPaths,
    variant,
    autoPick,
    fps,
    width,
    height,
    outPath,
    progress: { pct: 0 },
    error: null,
    pid: null,
    framesWritten: null,
    durationMs: null,
  };

  await withLock(async () => {
    await writeJson(jobPath(id), job);
    const ids = await readIndex();
    ids.unshift(id);
    while (ids.length > 200) ids.pop();
    await writeIndex(ids);
  });

  return job;
}

function clampInt(v, min, max, fallback) {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.round(n)));
}

function isActiveStatus(status) {
  // `starting` is claimed but not yet marked running — it must consume a
  // concurrency slot or overlapping tryStartNext() calls overshoot the cap.
  return status === 'starting' || status === 'running';
}

function workerScript() {
  return path.join(REPO_ROOT, 'scripts', 'render-offline-worker.mjs');
}

/** Spawn the next queued job if under the concurrency cap. Returns job id or null. */
export async function tryStartNext() {
  if (!isOfflineRenderAvailable()) return null;

  // Capacity check + claim happen under ONE lock so two overlapping kicks
  // cannot both see "under cap" and both claim a queued job.
  const claimed = await withLock(async () => {
    const ids = await readIndex();
    let active = 0;
    for (const id of ids) {
      const job = await getJob(id);
      if (job && isActiveStatus(job.status)) active += 1;
    }
    if (active >= maxConcurrent()) return null;

    let nextId = null;
    for (const id of ids) {
      const job = await getJob(id);
      if (job && job.status === 'queued') {
        nextId = id;
        break;
      }
    }
    if (!nextId) return null;

    const job = await getJob(nextId);
    if (!job || job.status !== 'queued') return null;
    const next = { ...job, status: 'starting', updatedAt: nowIso() };
    await writeJson(jobPath(nextId), next);
    return next;
  });
  if (!claimed) return null;

  const nextId = claimed.id;
  const child = spawn(process.execPath, [workerScript(), `--jobId=${nextId}`], {
    cwd: REPO_ROOT,
    env: {
      ...process.env,
      SWRC_DATA_DIR: DATA_ROOT,
      // Inherit dry-run / secrets; worker never needs the HTTP secret.
    },
    detached: true,
    stdio: ['ignore', 'ignore', 'ignore'],
  });
  child.unref();

  await updateJob(nextId, { status: 'running', pid: child.pid });
  return nextId;
}
