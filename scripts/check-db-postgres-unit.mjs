// scripts/check-db-postgres-unit.mjs — run the API data-layer suite against
// a real Postgres instead of the JSON-file fallback.
//
// Why this exists: api/_lib/db.js has two interchangeable backends. The
// test suite (scripts/test-api.mjs) exercises the filesystem one by
// default, so the Postgres path — the one production actually uses — had
// no coverage at all. This runs the same suite against it.
//
// Env-skip pattern (see AGENTS.md): CI has no Postgres, so without
// DATABASE_URL this prints the marker and passes. To run it locally:
//
//   docker run -d --name swr-pg-dev \
//     -e POSTGRES_USER=swr -e POSTGRES_PASSWORD=swrdev -e POSTGRES_DB=swr \
//     -p 5433:5432 postgres:16-alpine
//
//   DATABASE_URL='postgres://swr:swrdev@localhost:5433/swr?sslmode=disable' \
//     npm run check:db-postgres
//
// Exit 0 = all green (or skipped). Exit 1 = a real failure.

import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const URL = process.env.DATABASE_URL || process.env.POSTGRES_URL || '';

if (!URL) {
  console.log(
    '(env skip: DATABASE_URL not set — Postgres backend not exercised. ' +
    'Start one with the docker command in this script\'s header to run it.)',
  );
  console.log('ALL GREEN (skipped)');
  process.exit(0);
}

// The suite writes to whatever the backend is; reset first so a stale
// table from an earlier run cannot make assertions pass or fail spuriously.
try {
  const { default: pg } = await import('pg');
  const pool = new pg.Pool({
    connectionString: URL,
    ssl: /sslmode=disable/.test(URL) ? false : { rejectUnauthorized: false },
  });
  await pool.query('CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value JSONB NOT NULL, updated_at TIMESTAMPTZ NOT NULL DEFAULT now())');
  await pool.query('TRUNCATE kv');
  await pool.end();
} catch (e) {
  console.error(`  ✗ could not reach Postgres at DATABASE_URL: ${e.message}`);
  process.exit(1);
}

// test-api.mjs sets SWRC_DATA_DIR itself; DATABASE_URL in the inherited env
// is what makes db.js select the Postgres path.
const r = spawnSync(process.execPath, ['scripts/test-api.mjs'], {
  cwd: REPO_ROOT,
  env: process.env,
  encoding: 'utf8',
});

process.stdout.write(r.stdout || '');
if (r.status !== 0) {
  process.stderr.write(r.stderr || '');
  console.error('\nDB POSTGRES UNIT: FAILED');
  process.exit(1);
}
console.log('\nDB POSTGRES UNIT: ALL GREEN (backend = postgres)');
