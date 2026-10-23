// api/control-centre.js — GET/POST /api/control-centre?action=…
//
// The control centre's only data source. Every card on super-admin.html
// reads from here, and every action it offers goes through here.
//
//   status      system + git + pipeline + store, in one round trip
//   system      load, memory, disk and uptime of the serving instance
//   git         branch, last commit, recent workflow runs (GitHub API)
//   health      the store's health plus a probe of the site's own pages
//   state       a JSON export of the site's real state
//   logs        the control centre's action log
//   clear-logs  wipe the action log
//   run-tests   trigger the CI suite        (needs GITHUB_TOKEN)
//   stop        cancel in-flight CI runs   (needs GITHUB_TOKEN)
//
// Reads need no token — the repository is public, so the GitHub API
// answers unauthenticated. Writes need GITHUB_TOKEN; without it the
// action refuses and says so. Nothing here ever reports a success it
// did not have.
//
// Note on "system resources": this is a serverless function, so the
// numbers describe the instance serving the request, not the machine
// that pushed the commit. The card labels them as such.

import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { readJson, writeJson, withLock, health, DATA_ROOT } from './_lib/db.js';
import { send, sendJson, setCors, readJsonBody, appOrigin } from './_lib/http.js';

const REPO = 'kajica2/sainted-word-records';
const GH = 'https://api.github.com';
const LOG_PATH = path.join(DATA_ROOT, 'control', 'logs.json');
const LOG_MAX = 200;

const TOKEN = (process.env.GITHUB_TOKEN || process.env.GH_TOKEN || '').trim();

function nowIso() { return new Date().toISOString(); }

// ── the action log ────────────────────────────────────────────────────────
// Real entries, in the real store (Postgres in production, JSON locally).
// "Clear Logs" and "View All Logs" read and write this.

async function readLogs() {
  const raw = await readJson(LOG_PATH, []);
  return Array.isArray(raw) ? raw : [];
}

async function appendLog(entry) {
  return withLock(async () => {
    const logs = await readLogs();
    logs.unshift({ at: nowIso(), ...entry });
    while (logs.length > LOG_MAX) logs.pop();
    await writeJson(LOG_PATH, logs);
    return logs;
  });
}

async function clearLogs() {
  return withLock(async () => {
    await writeJson(LOG_PATH, []);
    return [];
  });
}

// ── system ────────────────────────────────────────────────────────────────

function diskUsage(target) {
  try {
    const s = fs.statfsSync(target);
    const total = s.blocks * s.bsize;
    const free = s.bavail * s.bsize;
    const used = total - free;
    return {
      total,
      free,
      used,
      pct: total ? Math.round((used / total) * 1000) / 10 : null,
    };
  } catch (e) {
    return null;
  }
}

function systemStats() {
  const cores = os.cpus()?.length || 1;
  const load = os.loadavg();
  const totalMem = os.totalmem();
  const freeMem = os.freemem();
  return {
    cores,
    load1: Math.round(load[0] * 100) / 100,
    load5: Math.round(load[1] * 100) / 100,
    load15: Math.round(load[2] * 100) / 100,
    cpuPct: Math.min(100, Math.round((load[0] / cores) * 1000) / 10),
    memTotal: totalMem,
    memUsed: totalMem - freeMem,
    memPct: totalMem ? Math.round(((totalMem - freeMem) / totalMem) * 1000) / 10 : null,
    disk: diskUsage('/'),
    uptimeSec: Math.round(os.uptime()),
    node: process.version,
    platform: `${os.platform()} ${os.arch()}`,
    // The instance the request landed on, not a fleet-wide number.
    scope: 'this serving instance',
  };
}

// ── GitHub ─────────────────────────────────────────────────────────────────

async function gh(pathname, init = {}) {
  const headers = {
    'User-Agent': 'swr-control-centre',
    Accept: 'application/vnd.github+json',
  };
  if (TOKEN) headers.Authorization = `Bearer ${TOKEN}`;
  const res = await fetch(GH + pathname, { ...init, headers: { ...headers, ...(init.headers || {}) } });
  if (!res.ok) {
    // Unauthenticated reads get 60 requests an hour per IP, and a serverless
    // deployment shares its egress IP. Say that, rather than "github 403".
    let detail = `github ${res.status}`;
    if (res.status === 403 && res.headers.get('x-ratelimit-remaining') === '0') {
      const reset = Number(res.headers.get('x-ratelimit-reset')) * 1000;
      const mins = reset ? Math.max(1, Math.round((reset - Date.now()) / 60000)) : null;
      detail = mins
        ? `github rate limit reached (60/hour unauthenticated), resets in ~${mins} min`
        : 'github rate limit reached (60/hour unauthenticated)';
    }
    const err = new Error(detail);
    err.status = res.status;
    throw err;
  }
  return res.json();
}

async function gitInfo() {
  const repo = await gh(`/repos/${REPO}`);
  const branch = repo.default_branch || 'main';
  const commits = await gh(`/repos/${REPO}/commits?sha=${branch}&per_page=5`);
  let runs = { workflow_runs: [] };
  try {
    runs = await gh(`/repos/${REPO}/actions/runs?branch=${branch}&per_page=12`);
  } catch (e) {
    runs = { workflow_runs: [], error: e.message };
  }
  return {
    repo: REPO,
    branch,
    pushedAt: repo.pushed_at,
    openIssues: repo.open_issues_count,
    stars: repo.stargazers_count,
    commits: (commits || []).map((c) => ({
      sha: c.sha.slice(0, 7),
      message: (c.commit?.message || '').split('\n')[0],
      author: c.commit?.author?.name || c.author?.login || '—',
      date: c.commit?.author?.date || c.commit?.committer?.date || null,
      url: c.html_url,
    })),
    runs: (runs.workflow_runs || []).map((r) => ({
      id: r.id,
      name: r.name,
      status: r.status,
      conclusion: r.conclusion,
      event: r.event,
      branch: r.head_branch,
      sha: (r.head_sha || '').slice(0, 7),
      startedAt: r.created_at,
      updatedAt: r.updated_at,
      url: r.html_url,
    })),
    runsError: runs.error || null,
  };
}

// ── health ────────────────────────────────────────────────────────────────
// The store's own health, plus a live probe of pages the site serves.
// A probe failure is reported, never swallowed.

async function probe(url) {
  const started = Date.now();
  try {
    const res = await fetch(url, { redirect: 'follow' });
    return { url, ok: res.ok, status: res.status, ms: Date.now() - started };
  } catch (e) {
    return { url, ok: false, status: 0, error: e.message, ms: Date.now() - started };
  }
}

async function healthInfo(origin) {
  const store = await health();
  const targets = [
    `${origin}/`,
    `${origin}/versions/neon.html`,
    `${origin}/engine.html`,
    `${origin}/super-admin.html`,
    `${origin}/api/manifest?action=ping`,
  ];
  const probes = await Promise.all(targets.map(probe));
  return {
    store,
    probes,
    ok: probes.every((p) => p.ok) && store.ok !== false,
  };
}

// ── state export ──────────────────────────────────────────────────────────

async function stateExport() {
  const store = await health();
  let siteMap = null;
  try {
    const raw = await fs.readFile(path.join(process.cwd(), 'site-map.json'), 'utf8');
    const parsed = JSON.parse(raw);
    siteMap = {
      nav: (parsed.nav || []).length,
      tools: (parsed.tools || []).length,
      legal: (parsed.legal || []).length,
      discovered: (parsed.discovered || []).length,
    };
  } catch (e) {
    // site-map.json is read from disk rather than bundled, so on a
    // serverless deployment the file is often not there. Say which it is
    // rather than reporting zero counts that look like a measurement.
    siteMap = e.code === 'ENOENT'
      ? { error: e.message, note: 'site-map.json is not present in this deployment' }
      : { error: e.message, note: 'site-map.json could not be read' };
  }
  return {
    exportedAt: nowIso(),
    store,
    siteMap,
    env: {
      nodeEnv: process.env.NODE_ENV || 'development',
      database: process.env.DATABASE_URL ? 'postgres' : 'json',
      githubToken: TOKEN ? 'configured' : 'absent',
    },
  };
}

// ── actions that need the token ───────────────────────────────────────────

async function runTests() {
  if (!TOKEN) {
    return {
      ok: false,
      error: 'token_missing',
      message: 'GITHUB_TOKEN is not set on this deployment, so the CI suite cannot be triggered from here. Push a commit, or set the token to enable it.',
    };
  }
  await gh(`/repos/${REPO}/actions/workflows/ci.yml/dispatches`, {
    method: 'POST',
    body: JSON.stringify({ ref: 'main' }),
  });
  return { ok: true, message: 'CI suite dispatched on main.' };
}

async function stopRuns() {
  if (!TOKEN) {
    return {
      ok: false,
      error: 'token_missing',
      message: 'GITHUB_TOKEN is not set on this deployment, so in-flight runs cannot be cancelled from here.',
    };
  }
  const runs = await gh(`/repos/${REPO}/actions/runs?branch=main&status=in_progress&per_page=20`);
  const cancelled = [];
  for (const r of runs.workflow_runs || []) {
    try {
      await gh(`/repos/${REPO}/actions/runs/${r.id}/cancel`, { method: 'POST' });
      cancelled.push({ id: r.id, name: r.name, sha: (r.head_sha || '').slice(0, 7) });
    } catch (e) {
      cancelled.push({ id: r.id, name: r.name, error: e.message });
    }
  }
  return { ok: true, cancelled, message: cancelled.length ? `Cancelled ${cancelled.length} run(s).` : 'No runs were in flight.' };
}

// ── handler ───────────────────────────────────────────────────────────────

export default async function handler(req, res) {
  const origin = req.headers.origin || '';
  setCors(res, origin);
  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    return res.end();
  }
  if (req.method !== 'GET' && req.method !== 'POST') {
    return send(res, 405, { error: 'method_not_allowed' });
  }

  let action = 'status';
  try {
    const q = new URL(req.url, 'http://x').searchParams;
    action = q.get('action') || 'status';
  } catch (e) { /* keep the default */ }

  // The site's own origin, from the platform's forwarded headers — not from
  // the caller's Origin header, which is caller-controlled and absent on a
  // same-origin GET anyway.
  const site = appOrigin(req);

  try {
    if (action === 'status') {
      const [sys, git, store] = await Promise.all([
        Promise.resolve(systemStats()),
        gitInfo().catch((e) => ({ error: e.message })),
        health().catch((e) => ({ ok: false, error: e.message })),
      ]);
      return sendJson(res, 200, { ok: true, at: nowIso(), system: sys, git, store });
    }

    if (action === 'system') {
      return sendJson(res, 200, { ok: true, at: nowIso(), system: systemStats() });
    }

    if (action === 'git') {
      const git = await gitInfo().catch((e) => ({ error: e.message }));
      return sendJson(res, 200, { ok: !git.error, at: nowIso(), git });
    }

    if (action === 'health') {
      return sendJson(res, 200, { ok: true, at: nowIso(), health: await healthInfo(site) });
    }

    if (action === 'state') {
      return sendJson(res, 200, await stateExport());
    }

    if (action === 'logs') {
      return sendJson(res, 200, { ok: true, logs: await readLogs() });
    }

    if (action === 'clear-logs') {
      await clearLogs();
      await appendLog({ level: 'info', message: 'Action log cleared.', action: 'clear-logs' });
      return sendJson(res, 200, { ok: true, logs: await readLogs() });
    }

    if (action === 'run-tests') {
      const result = await runTests();
      await appendLog({
        level: result.ok ? 'success' : 'error',
        message: result.message,
        action: 'run-tests',
      });
      return sendJson(res, result.ok ? 200 : 503, result);
    }

    if (action === 'stop') {
      const result = await stopRuns();
      await appendLog({
        level: result.ok ? 'warning' : 'error',
        message: result.message,
        action: 'stop',
      });
      return sendJson(res, result.ok ? 200 : 503, result);
    }

    if (action === 'log' && req.method === 'POST') {
      const body = await readJsonBody(req, { maxBytes: 20_000 });
      if (!body || body.__error) return send(res, 400, { error: 'invalid_body' });
      await appendLog({
        level: body.level || 'info',
        message: String(body.message || '').slice(0, 500),
        action: body.action || 'note',
      });
      return sendJson(res, 200, { ok: true, logs: await readLogs() });
    }

    return send(res, 400, { error: 'unknown_action', action });
  } catch (e) {
    return send(res, 500, { error: 'control_centre_failed', message: e.message, action });
  }
}
