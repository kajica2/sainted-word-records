#!/usr/bin/env node
// scripts/grant-invite.mjs — admin CLI for the invite-code store.
//
// Usage:
//   KV_REST_API_URL=... KV_REST_API_TOKEN=... \
//     node scripts/grant-invite.mjs create                # generates and prints a code
//   KV_REST_API_URL=... KV_REST_API_TOKEN=... \
//     node scripts/grant-invite.mjs create --code FOO-BAR-BAZ --label "alice launch"
//   KV_REST_API_URL=... KV_REST_API_TOKEN=... \
//     node scripts/grant-invite.mjs disable FOO-BAR-BAZ
//   KV_REST_API_URL=... KV_REST_API_TOKEN=... \
//     node scripts/grant-invite.mjs enable  FOO-BAR-BAZ
//   KV_REST_API_URL=... KV_REST_API_TOKEN=... \
//     node scripts/grant-invite.mjs delete  FOO-BAR-BAZ
//   KV_REST_API_URL=... KV_REST_API_TOKEN=... \
//     node scripts/grant-invite.mjs inspect FOO-BAR-BAZ
//
// The store key shape and value shape live in api/_lib/kv.js — this CLI
// imports from there so the two cannot drift.

import { parseArgs } from 'node:util';
import {
  generateCode,
  normalizeCode,
  readInvite,
  writeInvite,
  deleteInvite,
} from '../api/_lib/kv.js';

function die(msg, code = 1) {
  console.error(`grant-invite: ${msg}`);
  process.exit(code);
}

async function main() {
  const { values, positionals } = parseArgs({
    options: {
      code: { type: 'string' },
      label: { type: 'string' },
    },
    allowPositionals: true,
  });
  const cmd = positionals[0];
  if (!cmd) die('usage: grant-invite.mjs <create|disable|enable|delete|inspect> [--code FOO-BAR-BAZ] [--label "..."]');

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

main().catch((e) => {
  console.error('grant-invite: error:', e && e.stack || e);
  process.exit(1);
});
