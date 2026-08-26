// scripts/lib/verify-runner.mjs — shared orchestrator for the verify-*.mjs
// smokes that npm run check:verify (and CI) call.
//
// Each verifier is a self-contained script that boots its own static
// server and launches Puppeteer. The orchestrator runs them sequentially
// (Puppeteer Chromium does not tolerate parallel instances on small
// runners), gives each a bounded wall-clock budget, surfaces stdout/
// stderr inline, and exits non-zero on the first failure or timeout.
//
// Public API:
//   const runner = createRunner({ defaultTimeoutMs: 90_000, cwd: process.cwd() });
//   const result = await runner.run([
//     { name: 'cloud-auth',  script: 'verify-cloud-auth.mjs',  timeoutMs: 60_000 },
//     { name: 'hf-publish',  script: 'verify-hf-publish.mjs',  timeoutMs: 60_000 },
//   ]);
//
// `result` is { ok: boolean, results: [{ name, script, ok, ms, code, reason }] }

import { spawn } from 'node:child_process';
import { resolve } from 'node:path';

const DEFAULTS = {
  defaultTimeoutMs: 90_000,
  cwd: process.cwd(),
  nodeBin: process.execPath,
  extraEnv: {},
};

export function createRunner(opts = {}) {
  const { defaultTimeoutMs, cwd, nodeBin, extraEnv } = { ...DEFAULTS, ...opts };

  /**
   * Run a single verifier child-process. Resolves with a structured
   * result; never throws. The child is SIGKILL'd if it overruns the
   * per-script timeout.
   */
  function runOne({ name, script, timeoutMs = defaultTimeoutMs, env = {} }) {
    const scriptPath = resolve(cwd, script);
    const started = Date.now();
    return new Promise((resolvePromise) => {
      const child = spawn(nodeBin, [scriptPath], {
        cwd,
        env: { ...process.env, ...extraEnv, ...env, FORCE_COLOR: '0' },
        stdio: ['ignore', 'pipe', 'pipe'],
      });

      let stdout = '';
      let stderr = '';
      let killedReason = null;

      child.stdout.on('data', (b) => {
        const s = b.toString();
        stdout += s;
        process.stdout.write(s);
      });
      child.stderr.on('data', (b) => {
        const s = b.toString();
        stderr += s;
        process.stderr.write(s);
      });

      const timer = setTimeout(() => {
        killedReason = `timeout after ${timeoutMs}ms`;
        child.kill('SIGKILL');
      }, timeoutMs);

      child.on('exit', (code, signal) => {
        clearTimeout(timer);
        const ms = Date.now() - started;
        if (killedReason) {
          resolvePromise({
            name, script, ok: false, ms, code, signal,
            reason: killedReason, stdout, stderr,
          });
          return;
        }
        resolvePromise({
          name, script, ok: code === 0, ms, code, signal,
          reason: code === 0 ? null : `exit ${code}${signal ? ` (${signal})` : ''}`,
          stdout, stderr,
        });
      });

      child.on('error', (err) => {
        clearTimeout(timer);
        resolvePromise({
          name, script, ok: false, ms: Date.now() - started,
          code: null, signal: null,
          reason: `spawn error: ${err.message}`, stdout, stderr,
        });
      });
    });
  }

  /**
   * Boot a child server process before a verifier runs. Returns a
   * shutdown function. Used by verifiers that need a running dev/API
   * server (e.g. cloud-auth against `npm run dev`).
   *
   * The boot log is captured (last 4 KB) and surfaced if readiness
   * polling fails — most "didn't start" failures are actually "Vite
   * couldn't bind the port" or "module threw on import".
   */
  function bootService({ name, cmd, args, cwd, env = {}, readyUrl, readyTimeoutMs = 30_000 }) {
    const child = spawn(cmd, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, ...env } });
    let bootLog = '';
    child.stdout.on('data', (b) => { bootLog += b.toString(); });
    child.stderr.on('data', (b) => { bootLog += b.toString(); });

    const shutdown = () => {
      if (!child.killed) {
        try { child.kill('SIGTERM'); } catch {}
        setTimeout(() => { if (!child.killed) try { child.kill('SIGKILL'); } catch {} }, 3000);
      }
    };

    return new Promise((resolve, reject) => {
      const deadline = Date.now() + readyTimeoutMs;
      const poll = async () => {
        if (Date.now() > deadline) {
          shutdown();
          reject(new Error(`${name} did not become ready within ${readyTimeoutMs}ms\n--- service log ---\n${bootLog.slice(-2000)}`));
          return;
        }
        try {
          const res = await fetch(readyUrl);
          if (res.ok || res.status < 500) {
            resolve(shutdown);
            return;
          }
        } catch { /* not up yet */ }
        setTimeout(poll, 250);
      };
      poll();
    });
  }

  async function run(scripts) {
    const results = [];
    let okCount = 0;
    for (const entry of scripts) {
      const { name = entry.script, script } = entry;
      process.stdout.write(`\n─── verify:${name} ───\n`);
      let shutdown = null;
      if (typeof entry.before === 'function') {
        try {
          shutdown = await entry.before();
          if (typeof shutdown === 'function') {
            // stash on entry so the finally below can call it
            entry._shutdown = shutdown;
          }
        } catch (e) {
          const ms = 0;
          process.stderr.write(`\n� verify:${name} setup failed: ${e.message}\n`);
          results.push({
            name, script, ok: false, ms, code: null, signal: null,
            reason: `setup failed: ${e.message}`, stdout: '', stderr: '',
          });
          continue;
        }
      }
      const r = await runOne({
        name, script, timeoutMs: entry.timeoutMs, env: entry.env,
      });
      results.push(r);
      if (r.ok) okCount += 1;
      else process.stderr.write(`\n✗ verify:${name} ${r.reason}\n`);
      if (typeof entry._shutdown === 'function') {
        try { entry._shutdown(); } catch {}
        entry._shutdown = null;
      }
    }
    return {
      ok: okCount === scripts.length,
      okCount,
      total: scripts.length,
      results,
    };
  }

  return { run, runOne, bootService };
}
