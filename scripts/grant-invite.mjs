#!/usr/bin/env node
// scripts/grant-invite.mjs — admin CLI for the invite-code store.
//
// The store is the app's own (api/_lib/kv.js): Postgres when DATABASE_URL
// is set — which is what production and preview run — and JSON files under
// ./data otherwise. To manage production codes from a terminal, run
// `vercel env pull .env` first so DATABASE_URL points at the real store;
// batch registration from data/invite-codes.csv goes through the deployed
// /api/invite/register endpoint instead (see .github/workflows/invite-codes.yml).
// No KV env vars, no separate database account.
//
// Usage:
//   node scripts/grant-invite.mjs create                # generates and prints a code
//   node scripts/grant-invite.mjs create --code FOO-BAR-BAZ --label "alice launch"
//   node scripts/grant-invite.mjs batch --emails "a@x.com, b@y.com, c@z.com"
//   #   one code per email (XXXXX-XXXXX-XXXXX), label = email, CSV on stdout;
//   #   --emails accepts commas AND newlines; re-running reuses existing grants;
//   #   --dry-run prints the CSV without writing to the store.
//   node scripts/grant-invite.mjs disable FOO-BAR-BAZ
//   node scripts/grant-invite.mjs enable  FOO-BAR-BAZ
//   node scripts/grant-invite.mjs delete  FOO-BAR-BAZ
//   node scripts/grant-invite.mjs inspect FOO-BAR-BAZ
//
// The store key shape and value shape live in api/_lib/kv.js — this CLI
// imports from there so the two cannot drift.

import { parseArgs } from 'node:util';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  generateCode,
  normalizeCode,
  readInvite,
  writeInvite,
  deleteInvite,
  readEmailIndex,
  writeEmailIndex,
} from '../api/_lib/kv.js';

function die(msg, code = 1) {
  console.error(`grant-invite: ${msg}`);
  process.exit(code);
}

// Split a batch input on commas AND newlines, trim, drop empties, dedupe in
// first-seen order. Used by the `batch` command; exported for unit tests.
export function parseEmails(raw) {
  if (typeof raw !== 'string') return [];
  const seen = new Set();
  const out = [];
  for (const part of raw.split(/[\n,]/)) {
    const email = part.trim().toLowerCase();
    if (!email || seen.has(email)) continue;
    seen.add(email);
    out.push(email);
  }
  return out;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Validate one email; returns null when it fails the shape check.
export function normalizeEmail(email) {
  if (typeof email !== 'string') return null;
  const e = email.trim().toLowerCase();
  return EMAIL_RE.test(e) ? e : null;
}

// Build the batch plan without touching the store: for each email, decide
// create | reuse and the code (existing code when reuse; a fresh one when
// create). Pure — callers inspect `plan[].action` and write where needed.
// `existing` is a Map<email, code> the caller pre-fills from the index.
export function planBatch(emails, existing) {
  const index = existing || new Map();
  const plan = [];
  for (const email of emails) {
    const reused = index.has(email) ? index.get(email) : null;
    plan.push({
      email,
      action: reused ? 'reuse' : 'create',
      code: reused || generateCode(),
    });
  }
  return plan;
}

async function main() {
  const { values, positionals } = parseArgs({
    options: {
      code: { type: 'string' },
      label: { type: 'string' },
      emails: { type: 'string' },
      'dry-run': { type: 'boolean', short: 'n' },
    },
    allowPositionals: true,
  });
  const cmd = positionals[0];
  if (!cmd) die('usage: grant-invite.mjs <create|batch|disable|enable|delete|inspect> [--code FOO-BAR-BAZ] [--label "..."] [--emails "a@x.com, b@y.com"] [--dry-run]');

  if (cmd === 'create') {
    let code = normalizeCode(values.code);
    if (values.code && !code) die(`invalid --code: ${JSON.stringify(values.code)}`);
    if (!code) code = generateCode();
    const existing = await readInvite(code);
    if (existing && existing.enabled !== false) {
      die(`code ${code} already exists and is enabled (use --code to pick another, or delete first)`);
    }
    const value = {
      enabled: true,
      createdAt: new Date().toISOString(),
      label: values.label || null,
    };
    await writeInvite(code, value);
    console.log(code);
    return;
  }

  if (cmd === 'batch') {
    const raw = values.emails || '';
    const emails = parseEmails(raw);
    const valid = emails.map(normalizeEmail).filter(Boolean);
    const invalid = emails.filter((e) => !normalizeEmail(e));
    if (!valid.length) die('batch: no valid emails (pass comma-separated --emails "a@x.com, b@y.com")');

    // Pre-fill the index: reuse an existing grant per email (idempotent).
    const existing = new Map();
    for (const email of valid) {
      const prior = await readEmailIndex(email).catch(() => null);
      if (prior) existing.set(email, prior);
    }
    const plan = planBatch(valid, existing);

    if (values['dry-run']) {
      for (const row of plan) {
        console.log(`${row.email},${row.code},${row.action}`);
      }
      console.error(`batch: dry-run — ${plan.length} ${plan.length === 1 ? 'grant' : 'grants'} printed; nothing written to the store`);
      if (invalid.length) console.error(`batch: skipped ${invalid.length} invalid: ${invalid.join(', ')}`);
      return;
    }

    let created = 0;
    let reused = 0;
    for (const row of plan) {
      if (row.action === 'reuse') {
        reused++;
        console.log(`${row.email},${row.code},reused`);
        continue;
      }
      const value = {
        enabled: true,
        createdAt: new Date().toISOString(),
        label: row.email,
      };
      await writeInvite(row.code, value);
      await writeEmailIndex(row.email, row.code);
      created++;
      console.log(`${row.email},${row.code},created`);
    }
    console.error(`batch: ${created} created, ${reused} reused${invalid.length ? `, ${invalid.length} invalid skipped (${invalid.join(', ')})` : ''}`);
    return;
  }

  if (cmd === 'disable' || cmd === 'enable') {
    const raw = positionals[1];
    const code = normalizeCode(raw);
    if (!raw || !code) die(`usage: grant-invite.mjs ${cmd} <CODE>`);
    const entry = await readInvite(code);
    if (!entry) die(`code ${code} not found`);
    entry.enabled = cmd === 'enable';
    await writeInvite(code, entry);
    console.log(`${cmd}d ${code}`);
    return;
  }

  if (cmd === 'delete') {
    const raw = positionals[1];
    const code = normalizeCode(raw);
    if (!raw || !code) die(`usage: grant-invite.mjs delete <CODE>`);
    await deleteInvite(code);
    console.log(`deleted ${code}`);
    return;
  }

  if (cmd === 'inspect') {
    const raw = positionals[1];
    const code = normalizeCode(raw);
    if (!raw || !code) die(`usage: grant-invite.mjs inspect <CODE>`);
    const entry = await readInvite(code);
    console.log(JSON.stringify({ code, entry }, null, 2));
    return;
  }

  die(`unknown command: ${cmd}`);
}

// Guard: only run main() when this file is the entry point, not when it is
// imported (the batch unit test imports the pure helpers). Imported like
// `node scripts/grant-invite.mjs create` still executes main; imported as a
// module it exposes parseEmails / normalizeEmail / planBatch only.
const isMain = process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (isMain) {
  main().catch((e) => {
    console.error('grant-invite: error:', e && e.stack || e);
    process.exit(1);
  });
}
