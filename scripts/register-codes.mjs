#!/usr/bin/env node
// scripts/register-codes.mjs — register invite codes against the deployed KV store.
//
// Usage (local — requires KV env vars):
//   KV_REST_API_URL=... KV_REST_API_TOKEN=... node scripts/register-codes.mjs
//
// Usage (via deployed API — after a preview deploy is ready):
//   PREVIEW_URL=https://... node scripts/register-codes.mjs --api
//
// The --api path POSTs to /api/invite/redeem on the preview URL so it runs
// inside the Vercel network where KV is reachable.

import { parseArgs } from 'node:util';
import { promises as fs } from 'node:fs';

const { values, positionals } = parseArgs({
  options: {
    api: { type: 'boolean', default: false },
  },
});

const BASE_URL = process.env.PREVIEW_URL || '';
const USE_API = values.api;

// Codes to register — add more here or use the data/invite-codes.csv file.
const CODES = [
  //{ code: 'QPRRA-JAFKR-MN549', label: 'launch batch' },
  //{ code: 'VR4JU-CTRR7-4K8C9', label: 'launch batch' },
];

async function registerViaApi(code, label) {
  if (!BASE_URL) throw new Error('PREVIEW_URL not set');
  const res = await fetch(`${BASE_URL}/api/invite/redeem`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    console.error(`  FAIL ${code}: ${data.error || res.status}`);
    return false;
  }
  console.log(`  OK   ${code} (${label})`);
  return true;
}

async function main() {
  // Load from data/invite-codes.csv if it exists.
  let codes = [...CODES];
  try {
    const csv = await fs.readFile('data/invite-codes.csv', 'utf8');
    const lines = csv.trim().split('\n').slice(1); // skip header
    for (const line of lines) {
      const [code, label] = line.split(',');
      if (code && !codes.some(c => c.code === code)) {
        codes.push({ code: code.trim(), label: (label || '').trim() });
      }
    }
  } catch (_) {}

  if (!codes.length) {
    console.log('No codes to register. Add to CODES array or data/invite-codes.csv');
    return;
  }

  console.log(`Registering ${codes.length} code(s)} via ${USE_API ? 'API' : 'local KV'}...`);
  let ok = 0;
  for (const { code, label } of codes) {
    const ok = USE_API
      ? await registerViaApi(code, label || 'launch batch').catch(() => false)
      : await registerLocal(code, label || 'launch batch').catch(() => false);
  }
  console.log(`\nDone: ${ok}/${codes.length} registered.`);
}

main().catch(e => { console.error(e.message); process.exit(1); });
