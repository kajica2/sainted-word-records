#!/usr/bin/env node
// scripts/gen-invite-codes.mjs — generate invite codes without KV.
//
// Standalone: no @vercel/kv, no network, no dependencies beyond Node built-ins.
// Generates codes in the same XXXXX-XXXXX-XXXXX format the real KV store uses.
//
// Usage:
//   node scripts/gen-invite-codes.mjs              # 10 codes
//   node scripts/gen-invite-codes.mjs --count 20  # 20 codes
//   node scripts/gen-invite-codes.mjs --count 5 --label "launch batch"
//   node scripts/gen-invite-codes.mjs --save        # append to data/invite-codes.csv

import { parseArgs } from 'node:util';
import { promises as fs } from 'node:fs';
import path from 'node:path';

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // 32 chars, no 0/O/1/I

function randomBlock(len) {
  const buf = new Uint8Array(len);
  globalThis.crypto.getRandomValues(buf);
  let out = '';
  for (let i = 0; i < len; i++) out += CODE_ALPHABET[buf[i] % CODE_ALPHABET.length];
  return out;
}

function generateCode() {
  return `${randomBlock(5)}-${randomBlock(5)}-${randomBlock(5)}`;
}

async function main() {
  const { values, positionals } = parseArgs({
    options: {
      count: { type: 'string', short: 'n' },
      label: { type: 'string', short: 'l' },
      save: { type: 'boolean', short: 's' },
    },
  });

  const count = Math.max(1, Math.min(200, parseInt(values.count || '10', 10)));
  const label = values.label || '';
  const timestamp = new Date().toISOString().split('T')[0];
  const rows = [];

  for (let i = 0; i < count; i++) {
    const code = generateCode();
    rows.push({ code, label, createdAt: timestamp });
    process.stdout.write(`${label ? `${label}\t` : ''}${code}\n`);
  }

  if (values.save) {
    const dataDir = path.join(process.cwd(), 'data');
    try { await fs.mkdir(dataDir, { recursive: true }); } catch (_) {}
    const csvPath = path.join(dataDir, 'invite-codes.csv');
    const header = 'code,label,createdAt\n';
    const existing = await fs.readFile(csvPath, 'utf8').catch(() => '');
    const csv = existing.startsWith('code,') ? existing : header;
    const newRows = rows.map((r) => `${r.code},${r.label},${r.createdAt}`).join('\n') + '\n';
    await fs.writeFile(csvPath, csv + newRows, 'utf8');
    process.stderr.write(`saved ${count} code(s) to ${csvPath}\n`);
  } else {
    process.stderr.write(`generated ${count} code(s) — pass --save to persist to data/invite-codes.csv\n`);
    process.stderr.write(`register with: KV_REST_API_URL=... KV_REST_API_TOKEN=... node scripts/grant-invite.mjs create --code CODE --label "${label}"\n`);
  }
}

main().catch((e) => {
  console.error('gen-invite-codes:', e && e.message || e);
  process.exit(1);
});
