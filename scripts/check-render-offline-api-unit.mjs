#!/usr/bin/env node
// scripts/check-render-offline-api-unit.mjs — HTTP contract for /api/render.
//
// Boots scripts/dev-api.mjs handleApi on a plain node:http server with a
// temp SWRC_DATA_DIR and SWR_RENDER_DRY_RUN=1 so create→status→download
// never launches Chrome. Pins:
//   1. GET ?action=health → available:true off Vercel
//   2. VERCEL=1 → create answers 503 offline_render_unavailable
//   3. POST without auth → 401
//   4. POST without audioPath → 400 missing_audio_path
//   5. POST with bad path → 400 invalid_path
//   6. POST with missing file → 404 not_found
//   7. POST create (secret) → 202 queued/running + job id
//   8. dry-run worker finishes → status done + downloadReady
//   9. GET download → 200 video/mp4 with bytes
//  10. GET list includes the job
//  11. unknown variant → 400 unknown_variant
//  12. GET health stays public (no secret)
//
// Exit 0 = all green, 1 = any failure.

import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { strict as assert } from 'node:assert';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'swrc-render-api-'));
const AUDIO = path.join(ROOT, 'audios', 'neon.mp3');

process.env.SWRC_DATA_DIR = TMP;
process.env.SWR_RENDER_SECRET = 'unit-render-secret';
process.env.SWR_RENDER_DRY_RUN = '1';
process.env.SWR_RENDER_MAX_CONCURRENT = '1';
process.env.NODE_ENV = 'test';
delete process.env.VERCEL;
delete process.env.DATABASE_URL;
delete process.env.POSTGRES_URL;

const { handleApi } = await import('./dev-api.mjs');

let failed = 0;
function test(name, fn) {
  return Promise.resolve()
    .then(fn)
    .then(() => process.stdout.write(`  ✓ ${name}\n`))
    .catch((e) => {
      failed += 1;
      process.stderr.write(`  ✗ ${name}\n    ${e.stack || e.message}\n`);
    });
}

const server = http.createServer((req, res) =>
  handleApi(req, res, () => {
    res.statusCode = 404;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ error: 'no_handler' }));
  })
);
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const BASE = `http://127.0.0.1:${server.address().port}`;

async function req(method, urlPath, { body, headers = {}, raw = false } = {}) {
  const h = { ...headers };
  if (body !== undefined) h['Content-Type'] = 'application/json';
  const res = await fetch(BASE + urlPath, {
    method,
    headers: h,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (raw) {
    const buf = Buffer.from(await res.arrayBuffer());
    return { status: res.status, headers: res.headers, buf };
  }
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { json = { __raw: text }; }
  return { status: res.status, json, headers: res.headers };
}

function withSecret(extra = {}) {
  return { 'x-swr-render-secret': 'unit-render-secret', ...extra };
}

await test('GET health is public and available off Vercel', async () => {
  const r = await req('GET', '/api/render?action=health');
  assert.equal(r.status, 200);
  assert.equal(r.json.ok, true);
  assert.equal(r.json.available, true);
  assert.equal(r.json.vercel, false);
});

await test('create on VERCEL returns 503 offline_render_unavailable', async () => {
  process.env.VERCEL = '1';
  // Re-import won't re-bind env reads (isOfflineRenderAvailable reads live),
  // so a direct call is enough — handler reads process.env each request.
  const r = await req('POST', '/api/render', {
    headers: withSecret(),
    body: { audioPath: 'audios/neon.mp3' },
  });
  delete process.env.VERCEL;
  assert.equal(r.status, 503);
  assert.equal(r.json.error, 'offline_render_unavailable');
});

await test('POST ?action=health on VERCEL still 503 (no create bypass)', async () => {
  process.env.VERCEL = '1';
  const r = await req('POST', '/api/render?action=health', {
    headers: withSecret(),
    body: { audioPath: 'audios/neon.mp3' },
  });
  delete process.env.VERCEL;
  assert.equal(r.status, 503);
  assert.equal(r.json.error, 'offline_render_unavailable');
});

await test('POST without auth → 401', async () => {
  const r = await req('POST', '/api/render', {
    body: { audioPath: 'audios/neon.mp3' },
  });
  assert.equal(r.status, 401);
});

await test('POST without audioPath → 400 missing_audio_path', async () => {
  const r = await req('POST', '/api/render', {
    headers: withSecret(),
    body: { variant: 'film' },
  });
  assert.equal(r.status, 400);
  assert.equal(r.json.error, 'missing_audio_path');
});

await test('POST with path traversal → 400 invalid_path', async () => {
  const r = await req('POST', '/api/render', {
    headers: withSecret(),
    body: { audioPath: '../etc/passwd' },
  });
  assert.equal(r.status, 400);
  assert.equal(r.json.error, 'invalid_path');
});

await test('POST with missing file → 404 not_found', async () => {
  const r = await req('POST', '/api/render', {
    headers: withSecret(),
    body: { audioPath: 'audios/does-not-exist-xyz.mp3' },
  });
  assert.equal(r.status, 404);
  assert.equal(r.json.error, 'not_found');
});

await test('POST with unknown variant → 400 unknown_variant', async () => {
  assert.ok(fs.existsSync(AUDIO), 'fixture audios/neon.mp3 must exist');
  const r = await req('POST', '/api/render', {
    headers: withSecret(),
    body: { audioPath: 'audios/neon.mp3', variant: 'not-a-real-variant' },
  });
  assert.equal(r.status, 400);
  assert.equal(r.json.error, 'unknown_variant');
});

let jobId = null;

await test('POST create → 202 with job id; dry-run finishes', async () => {
  const r = await req('POST', '/api/render', {
    headers: withSecret(),
    body: {
      audioPath: 'audios/neon.mp3',
      variant: 'hallucination',
      fps: 12,
      width: 320,
      height: 180,
    },
  });
  assert.equal(r.status, 202, JSON.stringify(r.json));
  assert.equal(r.json.ok, true);
  assert.ok(r.json.job && r.json.job.id, 'job.id present');
  jobId = r.json.job.id;
  assert.ok(['queued', 'starting', 'running', 'done'].includes(r.json.job.status));

  // Poll until dry-run worker marks done (usually <1s).
  let done = null;
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    const s = await req('GET', `/api/render?action=status&jobId=${jobId}`, {
      headers: withSecret(),
    });
    assert.equal(s.status, 200);
    if (s.json.job.status === 'done') {
      done = s.json.job;
      break;
    }
    if (s.json.job.status === 'failed') {
      throw new Error('job failed: ' + s.json.job.error);
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  assert.ok(done, 'job reached done within 15s');
  assert.equal(done.downloadReady, true);
  assert.equal(done.variant, 'hallucination');
  assert.equal(done.audioName, 'neon.mp3');
});

await test('GET download returns video/mp4 bytes', async () => {
  assert.ok(jobId);
  const r = await req('GET', `/api/render?action=download&jobId=${jobId}`, {
    headers: withSecret(),
    raw: true,
  });
  assert.equal(r.status, 200);
  assert.match(String(r.headers.get('content-type') || ''), /video\/mp4/);
  assert.ok(r.buf.length >= 24, 'placeholder ftyp is 24 bytes');
  // 'ftyp' at offset 4
  assert.equal(r.buf.slice(4, 8).toString('ascii'), 'ftyp');
});

await test('GET list includes the job', async () => {
  const r = await req('GET', '/api/render?action=list', {
    headers: withSecret(),
  });
  assert.equal(r.status, 200);
  assert.equal(r.json.ok, true);
  assert.ok(Array.isArray(r.json.jobs));
  assert.ok(r.json.jobs.some((j) => j.id === jobId));
});

await test('Bearer secret auth works', async () => {
  const r = await req('GET', `/api/render?action=status&jobId=${jobId}`, {
    headers: { Authorization: 'Bearer unit-render-secret' },
  });
  assert.equal(r.status, 200);
  assert.equal(r.json.job.id, jobId);
});

await test('bad secret is refused (does not fall through to session)', async () => {
  const r = await req('GET', `/api/render?action=status&jobId=${jobId}`, {
    headers: { 'x-swr-render-secret': 'wrong-secret' },
  });
  assert.equal(r.status, 401);
  assert.equal(r.json.error, 'unauthorized');
});

await test('session user cannot read another user\'s job or download it', async () => {
  const { createUser, createSession } = await import('../api/_lib/db.js');
  const { COOKIE_NAME } = await import('../api/_lib/http.js');
  const owner = await createUser({ email: 'owner-render@example.com' });
  const other = await createUser({ email: 'other-render@example.com' });
  const ownerSess = await createSession({ userId: owner.id });
  const otherSess = await createSession({ userId: other.id });

  const created = await req('POST', '/api/render', {
    headers: {
      Cookie: `${COOKIE_NAME}=${ownerSess.token}`,
    },
    body: {
      audioPath: 'audios/neon.mp3',
      variant: 'hallucination',
      fps: 12,
    },
  });
  assert.equal(created.status, 202, JSON.stringify(created.json));
  const ownedId = created.json.job.id;

  // Wait for dry-run so download can be attempted.
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    const s = await req('GET', `/api/render?action=status&jobId=${ownedId}`, {
      headers: { Cookie: `${COOKIE_NAME}=${ownerSess.token}` },
    });
    if (s.json.job && s.json.job.status === 'done') break;
    await new Promise((r) => setTimeout(r, 100));
  }

  const peek = await req('GET', `/api/render?action=status&jobId=${ownedId}`, {
    headers: { Cookie: `${COOKIE_NAME}=${otherSess.token}` },
  });
  assert.equal(peek.status, 404);
  assert.equal(peek.json.error, 'job_not_found');

  const dl = await req('GET', `/api/render?action=download&jobId=${ownedId}`, {
    headers: { Cookie: `${COOKIE_NAME}=${otherSess.token}` },
    raw: true,
  });
  assert.equal(dl.status, 404);

  const list = await req('GET', '/api/render?action=list', {
    headers: { Cookie: `${COOKIE_NAME}=${otherSess.token}` },
  });
  assert.equal(list.status, 200);
  assert.ok(!list.json.jobs.some((j) => j.id === ownedId));

  const ownerList = await req('GET', '/api/render?action=list', {
    headers: { Cookie: `${COOKIE_NAME}=${ownerSess.token}` },
  });
  assert.equal(ownerList.status, 200);
  assert.ok(ownerList.json.jobs.some((j) => j.id === ownedId));
});

await test('tryStartNext capacity counts starting under one lock', async () => {
  const jobs = await import('../api/_lib/render-jobs.js');
  process.env.SWR_RENDER_MAX_CONCURRENT = '1';
  // Plant a fake "starting" job so the next kick must refuse.
  const planted = await jobs.createJob({
    audioPath: 'audios/neon.mp3',
    variant: 'hallucination',
  });
  await jobs.updateJob(planted.id, { status: 'starting' });
  const kicked = await jobs.tryStartNext();
  assert.equal(kicked, null, 'must not start another job while one is starting');
  // Clean up so leftover starting jobs don't poison later runs of this suite.
  await jobs.updateJob(planted.id, { status: 'failed', error: 'capacity_test' });
});

server.close();
try { fs.rmSync(TMP, { recursive: true, force: true }); } catch { /* ignore */ }

if (failed) {
  console.error(`\nFAIL: ${failed} assertion(s)`);
  process.exit(1);
}
console.log('\nPASS: check-render-offline-api-unit');
process.exit(0);
