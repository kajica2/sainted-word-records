#!/usr/bin/env node
// scripts/check-verify-smoke.mjs — runs the curated 5-verifier smoke that
// gates PRs and main-branch pushes via .github/workflows/ci.yml.
//
// Why only 5?
//   The repo has ~80 verify-*.mjs scripts. Running them all on every push
//   is ~2 hours of CI on a small runner and most are redundant or stale.
//   These 5 are the highest-signal smokes:
//
//     1. cloud-auth        — auth + storage + projects loop (the API surface)
//     2. hf-publish        — admin panel UI + bundle/push dry-run chain
//     3. rotation-enabled  — engine.html mount + per-layer ROTATE toggle
//     4. autoplay          — engine "auto-play last loaded song" feature
//     5. e2e-media-record  — full engine bootstrap → MediaRecorder cycle
//
//   They cover: API correctness, page mount, feature smoke, render,
//   recording. Any other verify-*.mjs is treated as a developer aid (run
//   on demand) and lives outside CI.
//
// Per-script timeout is 60s. Total budget ≤5min. Puppeteer runs the
// scripts sequentially because Chromium is not parallel-safe on small
// runners. Override a single script's timeout with VERIFY_TIMEOUT_<NAME>MS
// (e.g. VERIFY_TIMEOUT_E2EMEDIARECORD_MS=120000).
//
// Exit 0 = all green. Exit 1 = at least one failed or timed out.

import { createRequire } from 'node:module';
import { createRunner } from './lib/verify-runner.mjs';

const VERIFIERS = [
  {
    name: 'cloud-auth',
    script: 'verify-cloud-auth.mjs',
    timeoutMs: 90_000,
    // Boot a fresh Vite dev server on :5175 with a clean data dir so the
    // verifier doesn't trample developer state and doesn't collide with
    // `npm run dev` on :5174. Wait for /api/health to return 200 before
    // running. Pass the matching BASE + SWRC_DATA_DIR to the verifier
    // child via its env (NOT process.env — that would leak across scripts).
    env: {}, // populated by `before`
    before: async () => {
      const { mkdtempSync } = await import('node:fs');
      const { tmpdir } = await import('node:os');
      const { join } = await import('node:path');
      const dataDir = mkdtempSync(join(tmpdir(), 'swrc-verify-'));
      const idx = VERIFIERS.findIndex((v) => v.name === 'cloud-auth');
      // Same SWRC_DATA_DIR must reach BOTH the dev server and the verifier
      // — otherwise the verifier reads an empty file while the server
      // wrote into a different one.
      const sharedEnv = {
        SWRC_DATA_DIR: dataDir,
        BASE: 'http://127.0.0.1:5175',
      };
      VERIFIERS[idx].env = sharedEnv;
      const shutdown = await runner.bootService({
        name: 'vite-dev',
        cmd: 'npx',
        args: ['vite', '--port', '5175', '--strictPort'],
        cwd: process.cwd(),
        env: sharedEnv,
        readyUrl: 'http://127.0.0.1:5175/api/health',
        readyTimeoutMs: 45_000,
      });
      return shutdown;
    },
  },
  { name: 'hf-publish',       script: 'verify-hf-publish.mjs' },
  { name: 'rotation-enabled', script: 'verify-rotation-enabled.mjs' },
  { name: 'autoplay',         script: 'verify-autoplay.mjs' },
  { name: 'e2e-media-record', script: 'verify-e2e-media-record.mjs' },
];

// Allow per-script overrides via env, e.g. VERIFY_TIMEOUT_E2EMEDIARECORD_MS=120000
for (const v of VERIFIERS) {
  const envKey = `VERIFY_TIMEOUT_${v.name.replace(/-/g, '_').toUpperCase()}_MS`;
  if (process.env[envKey]) v.timeoutMs = Number(process.env[envKey]);
}

const runner = createRunner({ defaultTimeoutMs: 60_000 });
const t0 = Date.now();
const summary = await runner.run(VERIFIERS);
const totalMs = Date.now() - t0;

process.stdout.write(
  `\n=== verify-smoke summary: ${summary.okCount}/${summary.total} green in ${(totalMs / 1000).toFixed(1)}s ===\n`
);
for (const r of summary.results) {
  const tag = r.ok ? '✓' : '✗';
  process.stdout.write(`  ${tag} ${r.name.padEnd(20)} ${String(r.ms).padStart(6)}ms${r.reason ? `  ${r.reason}` : ''}\n`);
}

// Silence unused-var lint if createRequire isn't needed yet (kept for
// future ESM/CJS interop without re-importing).
void createRequire;

process.exit(summary.ok ? 0 : 1);
