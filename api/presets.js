// api/presets.js — GET all presets, grouped by family.
//
//   GET /api/presets
//   GET /api/presets?family=AMBIENT        — filter by family (case-insensitive)
//   GET /api/presets?search=dark           — full-text search across name, desc, tags
//
// Returns: { families: string[], presets: Preset[] }
//
// No auth required — presets are public creative assets.
//
// Used by:
//   - lib/presets-dropdown.client.js (the personality browser dropdown)
//   - Any future admin tooling

import fs from 'node:fs';
import path from 'node:path';
import { sendJson, setCors } from './_lib/http.js';

const PRESETS_ROOT = path.join(process.cwd(), 'presets');

// Lightweight in-memory cache — rebuilt on every cold start.
let _cache = null;
let _cacheTs = 0;
const CACHE_TTL_MS = 30_000; // 30 s

async function readPresets() {
  if (_cache && Date.now() - _cacheTs < CACHE_TTL_MS) return _cache;
  let files;
  try {
    files = await fs.promises.readdir(PRESETS_ROOT);
  } catch {
    return { families: [], presets: [] };
  }
  const jsonFiles = files.filter((f) => f.endsWith('.json'));
  const presets = [];
  for (const file of jsonFiles) {
    let raw;
    try {
      raw = await fs.promises.readFile(path.join(PRESETS_ROOT, file), 'utf8');
    } catch {
      continue;
    }
    let p;
    try {
      p = JSON.parse(raw);
    } catch {
      continue;
    }
    // Strip heavy fields not needed by the dropdown UI.
    const { inspiration, motion, audio_reactivity, fx_state, ...rest } = p;
    presets.push({
      ...rest,
      tags: (p.preview && p.preview.tags) || [],
      palette: p.palette || {},
      // Include compact audio_reactivity for the dropdown's reactivity summary
      audio_reactivity: audio_reactivity || {},
    });
  }
  // Collect families in order of first appearance.
  const families = [];
  const seen = new Set();
  for (const p of presets) {
    if (p.family && !seen.has(p.family)) {
      seen.add(p.family);
      families.push(p.family);
    }
  }
  _cache = { families, presets };
  _cacheTs = Date.now();
  return _cache;
}

export default async function handler(req, res) {
  setCors(res, req.headers.origin);
  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    return res.end();
  }
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET, OPTIONS');
    return sendJson(res, 405, { error: 'method_not_allowed' });
  }

  const url = req.url || '';
  const qsIdx = url.indexOf('?');
  const params = qsIdx >= 0 ? new URLSearchParams(url.slice(qsIdx + 1)) : new URLSearchParams();

  const familyFilter = (params.get('family') || '').trim();
  const searchQuery = (params.get('search') || '').trim().toLowerCase();

  let { families, presets } = await readPresets();

  if (familyFilter) {
    const f = familyFilter.toUpperCase();
    presets = presets.filter((p) => (p.family || '').toUpperCase() === f);
  }

  if (searchQuery) {
    presets = presets.filter((p) => {
      const hay = [
        p.name || '',
        p.description || '',
        ...(p.tags || []),
        p.family || '',
      ]
        .join(' ')
        .toLowerCase();
      return hay.includes(searchQuery);
    });
  }

  return sendJson(res, 200, { families, presets });
}
