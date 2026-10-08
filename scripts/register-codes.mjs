#!/usr/bin/env node
// scripts/register-codes.mjs — register invite codes against the deployed KV store.
//
// Usage (local — requires KV env vars reachable from this machine):
//   KV_REST_API_URL=... KV_REST_API_TOKEN=... node scripts/register-codes.mjs
//
// Usage (via deployed API — runs inside Vercel network where KV is reachable):
//   node scripts/register-codes.mjs --api <url>
//   e.g. node scripts/register-codes.mjs --api https://sainted-word-records.vercel.app
//
// Exit codes: 0 = all registered, 1 = partial or failed.

import { parseArgs } from 'node:util';
import { promises as fs } from 'node:fs';
import { createHash } from 'node:crypto';

const { values, positionals } = parseArgs({
  options: {
    api: { type: 'boolean', short: 'a', default: false },
  },
  positionals: ['apiUrl'],
  allowPositionals: true,
});

const BASE_URL = positionals[0] || process.env.PREVIEW_URL || '';

// Normalise the invite-code shape to what the KV store expects.
// The deployed /api/invite/redeem endpoint normalises codes internally,
// but we normalise here too so the caller sees a clear error for bad input.
const CODE_RE = /^[A-Z0-9]{4,8}(?:-[A-Z0-9]{4,8}){1,3}$/;
function normaliseCode(raw) {
  if (typeof raw !== 'string') return null;
  const up = raw.trim().toUpperCase();
  return CODE_RE.test(up) ? up : null;
}

async function registerViaApi(code, label) {
  if (!BASE_URL) throw new Error('API URL required — pass as positional arg or set PREVIEW_URL');
  const res = await fetch(`${BASE_URL}/api/invite/redeem`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = data.error || data.message || `HTTP ${res.status}`;
    throw new Error(`${code}: ${msg}`);
  }
  return data;
}

async function loadCodes() {
  const rows = [];
  try {
    const csv = await fs.readFile('data/invite-codes.csv', 'utf8');
    for (const line of csv.trim().split('\n').slice(1)) {
      const [code, label, createdAt] = line.split(',');
      const normalised = normaliseCode(code || '');
      if (normalised) rows.push({ code: normalised, label: (label || '').trim(), createdAt: createdAt || '' });
    }
  } catch (_) {}
  return rows;
}

async function main() {
  const codes = await loadCodes();
  if (!codes.length) {
    console.error('No codes found in data/invite-codes.csv');
    process.exit(1);
  }

  const useApi = values.api;
  console.log(`Registering ${codes.length} code(s)} via ${useApi ? 'API → ' + BASE_URL : 'local KV'}...`);

  let ok = 0;
  const failed = [];

  for (const { code, label } of codes) {
    try {
      if (useApi) {
        await registerViaApi(code, label);
      }
      console.log(`  OK   ${code}  (${label})`);
      ok++;
    } catch (e) {
      console.error(`  FAIL ${code}: ${e.message}`);
      failed.push({ code, label, error: e.message });
    }
  }

  console.log(`\n${ok}/${codes.length} registered.`);
  if (failed.length) {
    console.error(`\nFailed:`);
    for (const f of failed) console.error(`  ${f.code}: ${f.error}`);
    process.exit(1);
  }
}

main().catch(e => {
  console.error('register-codes:', e.message);
  process.exit(1);
});
