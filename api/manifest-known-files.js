// api/manifest-known-files.js — list files that currently exist in
// library/ on disk. Powers the editor's "missing on disk" column.
//
// Read-only, open (same data anyone could get by listing /library/).

import fs from 'node:fs/promises';
import path from 'node:path';
import { setCors, send } from './_lib/http.js';

const LIBRARY_ROOT = path.join(process.cwd(), 'library');

async function walk(dir, prefix, out) {
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch (e) {
    return;
  }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    const rel = prefix ? `${prefix}/${e.name}` : e.name;
    if (e.isDirectory()) {
      await walk(full, rel, out);
    } else if (e.isFile()) {
      out.push(rel);
    }
  }
}

export default async function handler(req, res) {
  if (req.headers.origin) {
    res.setHeader('Access-Control-Allow-Origin', req.headers.origin);
    res.setHeader('Vary', 'Origin');
  }
  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    return res.end();
  }
  if (req.method !== 'GET') return send(res, 405, { error: 'method_not_allowed' });

  const files = [];
  await walk(LIBRARY_ROOT, '', files);
  // Filter:
  //   - skip the manifest itself
  //   - skip hidden files (.DS_Store etc.)
  //   - skip the audio/ subdir (audio is not part of the visual curated
  //     library; the variant engine loads it from /audios/ at boot)
  // The editor manages only the visual curated set (images, videos,
  // persona PNGs) — that's what the on-disk library ships to the
  // browser via vite's copy-static.
  const filtered = files.filter((f) => {
    if (f === 'manifest.json') return false;
    if (f.startsWith('.')) return false;
    if (f === 'audio' || f.startsWith('audio/')) return false;
    return true;
  });
  return send(res, 200, { files: filtered });
}
