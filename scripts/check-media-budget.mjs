#!/usr/bin/env node
// scripts/check-media-budget.mjs — gate wrapper: ensure dist/ then run media-budget.
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { ensureDist } from './with-dist.mjs';

const ROOT = dirname(fileURLToPath(import.meta.url));

await ensureDist();

const r = spawnSync(process.execPath, [join(ROOT, 'media-budget.mjs')], {
  stdio: 'inherit',
  cwd: join(ROOT, '..'),
});
process.exit(typeof r.status === 'number' ? r.status : 1);
