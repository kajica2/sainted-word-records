// api/manifest.js — GET / POST library/manifest.json
//
// Used by tools/manifest-editor.html to round-trip the curated library
// manifest. Reads are open (anyone can list the manifest — same as
// serving library/manifest.json statically would). Writes require the
// header `x-swr-manifest-token: <MANIFEST_EDITOR_TOKEN>` when the env
// var is set; when unset, writes are blocked entirely (dev mode).
//
// Also handles `?action=known-files` (GET only) — walks the on-disk
// library/ and returns the file list, used by the editor's "missing on
// disk" column. (Previously a separate endpoint; merged here to stay
// under Vercel's 12-endpoint Hobby cap.)
//
// This is NOT a replacement for the offline "edit JSON, commit, push"
// flow — it's a convenience for local dev where pushing + waiting for
// Vercel is slow. Production deployments should treat this endpoint
// as read-only and edit the manifest via git.

import fs from 'node:fs/promises';
import path from 'node:path';
import { setCors, send, readJsonBody } from './_lib/http.js';

const MANIFEST_PATH = path.join(process.cwd(), 'library', 'manifest.json');
const LIBRARY_ROOT = path.join(process.cwd(), 'library');
const WRITE_TOKEN = process.env.MANIFEST_EDITOR_TOKEN || '';

function setCorsPublic(res, origin) {
  // Same-origin requests don't need CORS, but tools served from
  // dev-api.mjs's localhost:8787 might. Echo the origin if present.
  if (origin) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-swr-manifest-token');
  res.setHeader('Access-Control-Max-Age', '600');
}

async function walkDiskFiles() {
  const files = [];
  async function walk(dir, prefix) {
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch (e) { return; }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      const rel = prefix ? `${prefix}/${e.name}` : e.name;
      if (e.isDirectory()) {
        await walk(full, rel);
      } else if (e.isFile()) {
        files.push(rel);
      }
    }
  }
  await walk(LIBRARY_ROOT, '');
  // Filter:
  //   - skip the manifest itself
  //   - skip hidden files (.DS_Store etc.)
  //   - skip the audio/ subdir (audio is not part of the visual curated
  //     library; the variant engine loads it from /audios/ at boot)
  return files.filter((f) => {
    if (f === 'manifest.json') return false;
    if (f.startsWith('.')) return false;
    if (f === 'audio' || f.startsWith('audio/')) return false;
    return true;
  });
}

function validate(m) {
  const errors = [];
  if (!m || typeof m !== 'object') errors.push('manifest must be an object');
  if (!Array.isArray(m.files)) errors.push('top-level "files" must be an array');
  if (m.files) {
    const seen = new Set();
    m.files.forEach((p, i) => {
      if (typeof p !== 'string') errors.push(`files[${i}] is not a string`);
      else if (p.indexOf('..') >= 0) errors.push(`files[${i}] contains ..: ${p}`);
      else if (seen.has(p)) errors.push(`files[${i}] duplicate: ${p}`);
      seen.add(p);
    });
  }
  if (m.personaGroups && typeof m.personaGroups === 'object') {
    const fileSet = new Set(m.files || []);
    for (const [g, paths] of Object.entries(m.personaGroups)) {
      if (!Array.isArray(paths)) {
        errors.push(`personaGroups.${g} must be an array`);
        continue;
      }
      paths.forEach((p, i) => {
        if (typeof p !== 'string') errors.push(`personaGroups.${g}[${i}] is not a string`);
        else if (!fileSet.has(p)) errors.push(`personaGroups.${g} references "${p}" not in files[]`);
      });
    }
  } else if (m.personaGroups !== undefined) {
    errors.push('personaGroups must be an object');
  }
  return errors;
}

export default async function handler(req, res) {
  setCorsPublic(res, req.headers.origin);
  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    return res.end();
  }

  if (req.method === 'GET') {
    // P3.5b — `?action=known-files` merges the previously-separate
    // /api/manifest-known-files endpoint (Vercel Hobby plan caps at
    // 12 serverless functions; merging buys us one slot). Behavior
    // matches the old endpoint exactly: walks library/ on disk and
    // returns { files: [...] } filtered to visual curated assets.
    const url = req.url || '';
    const qsIdx = url.indexOf('?');
    if (qsIdx >= 0) {
      const params = new URLSearchParams(url.slice(qsIdx + 1));
      if (params.get('action') === 'known-files') {
        try {
          const files = await walkDiskFiles();
          return send(res, 200, { files });
        } catch (e) {
          return send(res, 500, { error: 'walk_failed', message: e.message });
        }
      }
    }
    try {
      const raw = await fs.readFile(MANIFEST_PATH, 'utf8');
      const json = JSON.parse(raw);
      return send(res, 200, json);
    } catch (e) {
      if (e.code === 'ENOENT') return send(res, 404, { error: 'manifest_not_found' });
      return send(res, 500, { error: 'read_failed', message: e.message });
    }
  }

  if (req.method === 'POST') {
    if (!WRITE_TOKEN) {
      return send(res, 503, {
        error: 'writes_disabled',
        message: 'MANIFEST_EDITOR_TOKEN env var is not set. Edit the manifest via git, or set the token to enable live writes (dev only).',
      });
    }
    const provided = (req.headers['x-swr-manifest-token'] || '').toString();
    if (provided !== WRITE_TOKEN) {
      return send(res, 403, { error: 'invalid_token' });
    }
    const body = await readJsonBody(req, { maxBytes: 1_000_000 });
    if (!body || body.__error) return send(res, 400, { error: 'invalid_body' });

    const errors = validate(body);
    if (errors.length) {
      return send(res, 400, { error: 'validation_failed', errors });
    }

    // Pretty-print so the committed file stays diff-friendly.
    const out = JSON.stringify(body, null, 2) + '\n';
    try {
      await fs.writeFile(MANIFEST_PATH, out, 'utf8');
      return send(res, 200, { ok: true, path: 'library/manifest.json', bytes: Buffer.byteLength(out) });
    } catch (e) {
      return send(res, 500, { error: 'write_failed', message: e.message });
    }
  }

  return send(res, 405, { error: 'method_not_allowed' });
}
