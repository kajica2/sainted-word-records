#!/usr/bin/env node
// scripts/render-offline-worker.mjs — local worker for /api/render jobs.
//
// Spawned by api/_lib/render-jobs.js tryStartNext(). Reads the job JSON from
// SWRC_DATA_DIR/render-jobs/<id>.json, runs renderVariant() (or a dry-run
// stub when SWR_RENDER_DRY_RUN=1), updates status, then kicks the next
// queued job.
//
//   node scripts/render-offline-worker.mjs --jobId=<uuid>
//
// Env:
//   SWRC_DATA_DIR          job + output root (required; set by the spawner)
//   SWR_RENDER_DRY_RUN=1   skip Chrome/ffmpeg; write a tiny placeholder mp4

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');

function arg(name) {
  const prefix = `--${name}=`;
  const hit = process.argv.find((a) => a.startsWith(prefix));
  return hit ? hit.slice(prefix.length) : null;
}

const jobId = arg('jobId');
if (!jobId) {
  console.error('usage: node scripts/render-offline-worker.mjs --jobId=<uuid>');
  process.exit(2);
}

// Import AFTER env is in place — db.js resolves DATA_ROOT at load time.
const {
  getJob,
  updateJob,
  tryStartNext,
  assertVariant,
} = await import(pathToFileURL(path.join(REPO_ROOT, 'api/_lib/render-jobs.js')).href);

async function fail(msg) {
  await updateJob(jobId, { status: 'failed', error: String(msg), pid: null });
  try { await tryStartNext(); } catch { /* ignore */ }
  process.exitCode = 1;
}

const job = await getJob(jobId);
if (!job) {
  console.error(`job not found: ${jobId}`);
  process.exit(1);
}

await updateJob(jobId, {
  status: 'running',
  progress: { pct: 1 },
  error: null,
});

try {
  let variant = job.variant || 'hallucination';
  if (job.autoPick && process.env.SWR_RENDER_DRY_RUN !== '1') {
    // Best-effort auto-pick via the same CLI batch-video uses. Failures
    // fall back to the job's stored variant (default hallucination).
    try {
      const { spawnSync } = await import('node:child_process');
      const { pick } = await import(
        pathToFileURL(path.join(REPO_ROOT, 'lib/variant-picker.mjs')).href
      );
      const r = spawnSync(
        process.execPath,
        [path.join(REPO_ROOT, 'scripts/analyze-mp3.mjs'), job.audioPath],
        { encoding: 'utf8', cwd: REPO_ROOT, maxBuffer: 16 * 1024 * 1024 }
      );
      if (r.status === 0 && r.stdout.trim()) {
        const analysis = JSON.parse(r.stdout.trim().split('\n').filter(Boolean).pop());
        const picked = pick(analysis);
        if (picked && picked.variant) {
          variant = assertVariant(picked.variant);
          await updateJob(jobId, {
            variant,
            progress: { pct: 5, picked: picked.variant, score: picked.score },
          });
        }
      } else {
        await updateJob(jobId, {
          progress: { pct: 5, autoPickError: (r.stderr || `analyze exit ${r.status}`).slice(0, 400) },
        });
      }
    } catch (e) {
      await updateJob(jobId, {
        progress: { pct: 5, autoPickError: e.message },
      });
    }
  } else {
    variant = assertVariant(variant);
  }

  fs.mkdirSync(path.dirname(job.outPath), { recursive: true });

  if (process.env.SWR_RENDER_DRY_RUN === '1') {
    // Minimal ISO BMFF "ftyp" box so the download endpoint has a real file.
    const ftyp = Buffer.from([
      0x00, 0x00, 0x00, 0x18, // size 24
      0x66, 0x74, 0x79, 0x70, // 'ftyp'
      0x69, 0x73, 0x6f, 0x6d, // major 'isom'
      0x00, 0x00, 0x02, 0x00,
      0x69, 0x73, 0x6f, 0x6d,
      0x6d, 0x70, 0x34, 0x31,
    ]);
    fs.writeFileSync(job.outPath, ftyp);
    await updateJob(jobId, {
      status: 'done',
      progress: { pct: 100, dryRun: true },
      framesWritten: 0,
      durationMs: 0,
      variant,
      pid: null,
      error: null,
    });
  } else {
    const { renderVariant } = await import(
      pathToFileURL(path.join(REPO_ROOT, 'scripts/render-full-song.mjs')).href
    );
    const result = await renderVariant({
      inputPath: job.audioPath,
      outPath: job.outPath,
      variant,
      libraryPaths: job.libraryPaths || [],
      fps: job.fps,
      width: job.width,
      height: job.height,
      quiet: process.env.SWR_RENDER_QUIET !== '0',
    });
    await updateJob(jobId, {
      status: 'done',
      progress: { pct: 100 },
      framesWritten: result.framesWritten ?? null,
      durationMs: result.durationMs ?? null,
      variant,
      pid: null,
      error: null,
    });
  }
} catch (e) {
  await fail(e && e.stack ? e.stack : e);
  process.exit(1);
}

try {
  await tryStartNext();
} catch {
  /* queue kick is best-effort */
}

process.exit(0);
