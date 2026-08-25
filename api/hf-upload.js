// api/hf-upload.js
// ---------------------------------------------------------------
// Admin endpoint: build & push the magenta-dsp-procedural bundle to
// the Hugging Face Hub on behalf of an authenticated user.
//
//   POST /api/hf-upload
//     body: { token, tag?, src?, dryRun? }
//     auth: requires a swrc_session cookie AND the user's email must
//           appear in the server-side SWR_ADMIN_EMAILS allow-list
//           (see api/_lib/session.js requireAdmin). Member sessions
//           that reach this endpoint get 403.
//
//   Response:
//     { command, output, url, dryRun }
//
// SAFETY
//   - Token never leaves the request lifecycle (echoed in commands
//     only when --dry-run explicitly opts in; for live pushes it is
//     passed via the HF_TOKEN env var, never argv).
//   - dryRun=true returns the *exact* hf upload command without
//     contacting the Hub.
//   - The build script never reads or writes paths outside the repo
//     and the named magenta-dsp source dir.
//   - Vercel env: this endpoint will NOT run unless HF_TOKEN_ORG_ADMIN
//     and SWR_ADMIN_EMAILS are both configured server-side — see
//     docs/hf-publish.md.
// ---------------------------------------------------------------

import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readJsonBody, sendJson, setCors } from './_lib/http.js';
import { requireAdmin } from './_lib/session.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const DEFAULT_TAG = process.env.MAGENTA_DSP_DEFAULT_TAG || 'v0.1.0';
const DEFAULT_SRC = process.env.MAGENTA_DSP_SRC || '';
const HF_REPO = 'kaidjuric/magenta-dsp-procedural';

function run(cmd, args, env = {}) {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, {
      cwd: REPO_ROOT,
      env: { ...process.env, ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '';
    let err = '';
    child.stdout.on('data', (b) => (out += b.toString('utf8')));
    child.stderr.on('data', (b) => (err += b.toString('utf8')));
    child.on('close', (code) => resolve({ code, out, err }));
  });
}

export default async function handler(req, res) {
  setCors(res, req.headers.origin);
  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    return res.end();
  }
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST, OPTIONS');
    return sendJson(res, 405, { error: 'method_not_allowed' });
  }

  const auth = await requireAdmin(req, res);
  if (!auth) return; // 401/403/503 already sent

  const body = await readJsonBody(req);
  const token = body && body.token;
  const tag = (body && body.tag) || DEFAULT_TAG;
  const src = (body && body.src) || DEFAULT_SRC;
  const dryRun = !!(body && body.dryRun);

  if (!token || typeof token !== 'string' || !token.startsWith('hf_')) {
    return sendJson(res, 400, { error: 'invalid_token' });
  }
  if (!/^v?\d+\.\d+\.\d+$/.test(tag)) {
    return sendJson(res, 400, { error: 'invalid_tag', hint: 'expected semver like v0.1.0' });
  }

  // Build the bundle first (always — dry-run or apply)
  const buildEnv = { SWR_HF_BUNDLE_REQUIRED: '1' };
  if (src) buildEnv.MAGENTA_DSP_SRC = src;
  const buildArgs = ['scripts/build-magenta-dsp-bundle.sh', '--tag', tag];
  if (!dryRun) buildArgs.push('--apply');

  const build = await run('bash', buildArgs, buildEnv);
  if (build.code !== 0) {
    return sendJson(res, 500, {
      error: 'build_failed',
      output: build.out,
      stderr: build.err,
    });
  }

  if (dryRun) {
    // Compute the canonical command from the just-built bundle path.
    // Bundle path is derived from a semver-validated tag — no path traversal risk.
    const bundlePath = path.join(REPO_ROOT, 'dist-hf', tag);
    // Export HF_TOKEN in your shell first; do NOT echo the token itself.
    const cmd = [
      `# Auth: set HF_TOKEN in your shell, then:`,
      `bash scripts/push-magenta-dsp-to-hf.sh --tag ${tag} --no-build --private`,
      `# bundle: ${bundlePath}`,
      `hf upload ${HF_REPO} dist-hf/${tag}/ . --repo-type model --commit-message "release: ${tag}"`,
    ].join('\n');
    return sendJson(res, 200, {
      dryRun: true,
      command: cmd,
      url: `https://huggingface.co/${HF_REPO}`,
      output: build.out,
    });
  }

  // Live push — pass the token via env (HF_TOKEN), never argv.
  // Pass MAGENTA_DSP_SRC so the push script sees the same env as the build
  // did; --no-build skips re-running the build step.
  const pushEnv = { HF_TOKEN: token };
  if (src) pushEnv.MAGENTA_DSP_SRC = src;
  const push = await run(
    'bash',
    ['scripts/push-magenta-dsp-to-hf.sh', '--tag', tag, '--no-build'],
    pushEnv
  );

  if (push.code !== 0) {
    return sendJson(res, 502, {
      error: 'push_failed',
      output: push.out,
      stderr: push.err,
      exit: push.code,
    });
  }

  return sendJson(res, 200, {
    dryRun: false,
    command: `hf upload ${HF_REPO} dist-hf/${tag}/ . --repo-type model --commit-message "release: ${tag}"`,
    url: `https://huggingface.co/${HF_REPO}/tree/main`,
    output: push.out,
  });
}
