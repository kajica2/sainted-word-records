# Deploying to Vercel

The repo is already wired for Vercel: `vite.config.js` builds into `dist/`,
`package.json` has a `build:vercel` script, `.vercel/project.json` links to
the existing `sainted-word-records` project (`team_KY5T7HVOj3wnX1ylM2x0g8o0`).

This document is the deploy recipe. It assumes the local `vercel` CLI
51.x is installed (`brew install vercel`).

## Prerequisites

- `node` 20+ (the project targets `>=20.0.0`)
- `vercel` CLI 51+
- One of:
  - **Interactive login** (`vercel login` in your terminal — opens a
    browser, completes the OAuth flow).
  - **`VERCEL_TOKEN`** environment variable (a long-lived token from
    Vercel Account Settings → Tokens). Recommended for CI.

If neither is in place, the deploy command will hang waiting for
interactive input. The deploy script (`tools/deploy-vercel.sh`)
detects this and exits cleanly with a message.

## One-command deploy

```bash
bash tools/deploy-vercel.sh
```

This runs, in order:

1. **`npm run check`** — full smoke (syntax + manifest + magenta-dsp
   bundle + API tests). All green is required before the deploy.
2. **`npm run build:vercel`** — runs `scripts/fetch-library.mjs` to pull
   the curated library/audio assets, then Vite builds into `dist/`.
3. **`vercel deploy --yes --archive=tgz`** — non-interactive deploy,
   packaged as a tarball (faster than the default per-file upload).
   The CLI returns a preview URL like
   `https://sainted-word-records-<hash>.vercel.app`.

Total time on a clean build: ~30–60 seconds.

## Inspect / promote / rollback

```bash
vercel ls                       # list all deployments
vercel inspect <url>            # build + deployment summary
vercel logs <url>               # tail logs of a deployment
vercel promote <url>            # move a preview to production
vercel rollback <url>           # roll production back to a previous deployment
```

`promote` is the **single irreversible step** — it changes what
production serves. Preview deploys (`vercel deploy --yes`) are
sandboxed under their hash URL until promoted.

## What ships

The Vercel build:

- Serves `dist/` as the project root.
- Honors `vercel.json` for rewrites (API routes, clean URLs).
- Is **stateless on the server side.** The dev API (`scripts/dev-api.mjs`)
  is Vite-only and does not run in production. The Vite config mounts
  the same handlers as functions on Vercel via `api/_lib/*.js`.
- Reads `VERCEL_ENV`, `NODE_ENV`, and any `vercel env` values from
  the project settings.

Anything that depends on the local-only `scripts/dev-api.mjs`
middleware (e.g. `vite.config.js`'s dev-mode route stitching) does
**not** ship to production.

## The visualizer-control transport (this session's work)

`client/visualizer-controller.js` and `tools/mobile/index.html` ship
through Vercel as static assets. They work in production **only if**
the WS bridge (port 8787) is reachable from the browser's origin.
By default, the Vercel deployment is HTTPS-public, so the bridge
needs to either:

- Bind to `wss://` on the same origin (requires the bridge to be
  served behind TLS at `ws.yourdomain.com`).
- Be reachable from the LAN when the user opens the visualizer
  (only works for a LAN-hosted demo, not for a public demo).

See `docs/CROSS-APP-BRIDGE.md` for the three deployment shapes; this
document assumes the user picks A (one PR to freq-lab to add the
bridge script as a built-in feature) or B (run a local bridge
beside the Vercel deploy).

## Reversibility

The deploy itself is **non-destructive** until `vercel promote`.
The script (`tools/deploy-vercel.sh`) and this doc are reversible
by file deletion.

The Vercel project itself (in your account dashboard) is the only
piece that survives this loop. Deleting the project in the
dashboard is the rollback — `git log` cannot undo it.

## What this script doesn't do

- **Doesn't run `vercel login`.** Auth is up to you.
- **Doesn't manage environment variables.** Set them in the Vercel
  dashboard under Project Settings → Environment Variables.
- **Doesn't promote to production.** Preview deploys are non-prod
  by design.
- **Doesn't touch the `package.json` / `package-lock.json` /
  `verify-hf-publish.mjs` / `.github/workflows/ci.yml` /
  `docs/CI-VERIFY-STRATEGY.md` / `scripts/check-verify-smoke.mjs` /
  `scripts/lib/` WIP** — those are unrelated and not part of this
  deploy path.
