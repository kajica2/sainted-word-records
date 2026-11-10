// api/render.js — HTTP API for offline / full-song renders.
//
// Wraps scripts/render-full-song.mjs (Puppeteer + CDP + ffmpeg) behind a
// job queue that only runs on a local Node host. Vercel serverless always
// answers 503 — Chrome + multi-minute ffmpeg is not a function.
//
//   POST /api/render
//     { audioPath, variant?, libraryPaths?, fps?, width?, height?, autoPick? }
//     → { ok, job }
//
//   GET  /api/render?action=status&jobId=<id>
//     → { ok, job }
//
//   GET  /api/render?action=list&limit=50
//     → { ok, jobs }
//
//   GET  /api/render?action=download&jobId=<id>
//     → video/mp4 body when status=done
//
//   GET  /api/render?action=health
//     → { ok, available, maxConcurrent }
//
// Auth (either):
//   - Header  x-swr-render-secret: <SWR_RENDER_SECRET>
//   - Header  Authorization: Bearer <SWR_RENDER_SECRET>
//   - Signed-in session cookie (requireUser)
//
// Path rules: audioPath / libraryPaths must resolve under the repo root or
// SWRC_DATA_DIR; `..` and absolute escapes are refused.

import fs from 'node:fs';
import { requireUser } from './_lib/session.js';
import { rateLimit } from './_lib/db.js';
import { readJsonBody, sendJson, setCors } from './_lib/http.js';
import {
  createJob,
  getJob,
  listJobs,
  publicJob,
  tryStartNext,
  isOfflineRenderAvailable,
  maxConcurrent,
} from './_lib/render-jobs.js';

const RENDER_SECRET = () => (process.env.SWR_RENDER_SECRET || '').trim();

function readSecret(req, body) {
  const h = req.headers || {};
  const header =
    (h['x-swr-render-secret'] && String(h['x-swr-render-secret'])) ||
    (h['X-Swr-Render-Secret'] && String(h['X-Swr-Render-Secret'])) ||
    '';
  if (header) return header.trim();
  const auth = h.authorization || h.Authorization || '';
  if (typeof auth === 'string' && /^Bearer\s+/i.test(auth)) {
    return auth.replace(/^Bearer\s+/i, '').trim();
  }
  if (body && typeof body.secret === 'string') return body.secret.trim();
  return '';
}

async function authorize(req, res, body) {
  const expected = RENDER_SECRET();
  const provided = readSecret(req, body);
  if (expected && provided && provided === expected) {
    return { mode: 'secret', user: null };
  }
  // Session path: requireUser writes 401 itself when missing.
  // If a secret is configured but wrong, refuse before falling through —
  // otherwise a wrong machine secret would silently become a browser session.
  if (expected && provided && provided !== expected) {
    sendJson(res, 401, { error: 'unauthorized', hint: 'bad_render_secret' });
    return null;
  }
  const ctx = await requireUser(req, res);
  if (!ctx) return null;
  return { mode: 'session', user: ctx.user };
}

function unavailable(res) {
  return sendJson(res, 503, {
    error: 'offline_render_unavailable',
    hint:
      'Full-song offline render needs a local Node host with Chrome + ffmpeg. ' +
      'Run `npm run dev` (or a dedicated render worker) and call /api/render there. ' +
      'Vercel serverless cannot run Puppeteer image2pipe jobs.',
  });
}

/** Secret mode sees every job; session mode only jobs owned by that user. */
function canAccessJob(auth, job) {
  if (!auth || !job) return false;
  if (auth.mode === 'secret') return true;
  if (auth.mode === 'session' && auth.user && job.userId === auth.user.id) return true;
  return false;
}

export default async function handler(req, res) {
  setCors(res, req.headers.origin);
  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    return res.end();
  }

  const q = req.query || {};
  const action = String(q.action || (req.method === 'POST' ? 'create' : 'health')).toLowerCase();

  // Health is public so callers can probe before auth. GET-only — a
  // POST ?action=health must NOT skip the availability guard below (that
  // would let create run on Vercel / when SWR_RENDER_DISABLE=1).
  if (req.method === 'GET' && action === 'health') {
    return sendJson(res, 200, {
      ok: true,
      available: isOfflineRenderAvailable(),
      maxConcurrent: maxConcurrent(),
      vercel: !!process.env.VERCEL,
    });
  }

  if (!isOfflineRenderAvailable()) {
    return unavailable(res);
  }

  if (req.method === 'GET') {
    if (action === 'status') {
      const auth = await authorize(req, res, null);
      if (!auth) return;
      const jobId = String(q.jobId || '').trim();
      const job = await getJob(jobId);
      if (!job || !canAccessJob(auth, job)) {
        return sendJson(res, 404, { error: 'job_not_found' });
      }
      return sendJson(res, 200, { ok: true, job: publicJob(job) });
    }

    if (action === 'list') {
      const auth = await authorize(req, res, null);
      if (!auth) return;
      const limit = Number(q.limit || 50);
      // Secret auth sees the full queue; session users only their own jobs.
      const jobs = await listJobs({
        limit,
        userId: auth.mode === 'session' ? auth.user.id : undefined,
      });
      return sendJson(res, 200, { ok: true, jobs });
    }

    if (action === 'download') {
      const auth = await authorize(req, res, null);
      if (!auth) return;
      const jobId = String(q.jobId || '').trim();
      const job = await getJob(jobId);
      if (!job || !canAccessJob(auth, job)) {
        return sendJson(res, 404, { error: 'job_not_found' });
      }
      if (job.status !== 'done' || !job.outPath) {
        return sendJson(res, 409, {
          error: 'not_ready',
          status: job.status,
          hint: 'poll ?action=status until downloadReady is true',
        });
      }
      if (!fs.existsSync(job.outPath)) {
        return sendJson(res, 404, { error: 'artifact_missing' });
      }
      const stat = fs.statSync(job.outPath);
      res.statusCode = 200;
      res.setHeader('Content-Type', 'video/mp4');
      res.setHeader('Content-Length', String(stat.size));
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="swr-render-${job.id}.mp4"`
      );
      fs.createReadStream(job.outPath).pipe(res);
      return;
    }

    return sendJson(res, 400, {
      error: 'unknown_action',
      hint: 'status | list | download | health',
    });
  }

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST, OPTIONS');
    return sendJson(res, 405, { error: 'method_not_allowed' });
  }

  const body = await readJsonBody(req, { maxBytes: 64_000 });
  if (body && body.__error) {
    return sendJson(res, 400, { error: body.__error });
  }

  const auth = await authorize(req, res, body);
  if (!auth) return;

  const rlKey = auth.user
    ? `render:${auth.user.id}`
    : `render:secret:${(req.socket && req.socket.remoteAddress) || 'local'}`;
  const rl = rateLimit({ key: rlKey, windowMs: 60_000, max: 10 });
  if (!rl.ok) {
    res.setHeader('Retry-After', String(Math.ceil(rl.retryAfterMs / 1000)));
    return sendJson(res, 429, { error: 'rate_limited' });
  }

  const postAction = String((body && body.action) || 'create').toLowerCase();
  if (postAction !== 'create') {
    return sendJson(res, 400, { error: 'unknown_action', hint: 'create' });
  }

  if (!body || !body.audioPath) {
    return sendJson(res, 400, {
      error: 'missing_audio_path',
      hint: 'POST { audioPath: "audios/neon.mp3", variant?: "film", autoPick?: true }',
    });
  }

  let job;
  try {
    job = await createJob({
      audioPath: body.audioPath,
      libraryPaths: body.libraryPaths,
      variant: body.variant,
      autoPick: body.autoPick,
      fps: body.fps,
      width: body.width,
      height: body.height,
      userId: auth.user ? auth.user.id : null,
    });
  } catch (e) {
    const code = e && e.code ? e.code : 'invalid_input';
    const status = code === 'not_found' ? 404 : 400;
    return sendJson(res, status, { error: code, message: e.message });
  }

  // Kick the queue (no-op if already at the concurrency cap).
  let started = null;
  try {
    started = await tryStartNext();
  } catch (e) {
    // Job is still queued; surface the spawn error without losing the job.
    return sendJson(res, 200, {
      ok: true,
      job: publicJob(job),
      started: null,
      warn: 'spawn_failed',
      message: e.message,
    });
  }

  // Re-read so the response carries running vs queued.
  const fresh = (await getJob(job.id)) || job;
  return sendJson(res, 202, {
    ok: true,
    job: publicJob(fresh),
    started,
  });
}
