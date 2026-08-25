# HF Publish — `magenta-dsp-procedural`

Push the Magenta.js procedural audio bundle to the Hugging Face Hub as
the model `kaidjuric/magenta-dsp-procedural`.

The bundle source is the SIBLING repo
`~/Documents/autodashboard/magenta-dsp-procedural/` — DrumRNN,
MelodyInterpolator, TrioGenerator. This repo (sainted-word-records)
only orchestrates the push.

## Quick start (local CLI)

1. Install the Hugging Face CLI (skip if already on PATH):

       brew install huggingface-cli
       # …or:
       pip install -U "huggingface_hub[cli]"

2. Login:

       hf auth login
       # …or set HF_TOKEN (write scope, scoped to kaidjuric)

3. From this repo's root, push:

       bash scripts/push-magenta-dsp-to-hf.sh --tag v0.1.0

   First run creates the model repo on the Hub. Add `--private` to
   create it as private; omit for public.

## Quick start (admin panel)

1. Login to sainted-word-records in any tab.
2. Open `http://localhost:5174/tools/hf-publish/` (or the deployed URL).
3. Paste HF write token, pick a tag, leave "Dry-run only" ON for the
   first preview, click Publish, then uncheck to push for real.

Token is held in `sessionStorage` only — wiped on submit and on tab close.

## What gets published

`dist-hf/<tag>/` contains (15 files, ~128 KB):

| Path | Purpose |
|------|---------|
| `README.md`         | HF model card (YAML frontmatter REQUIRED on first push) |
| `INFERENCE.md`      | How to load & run each module |
| `LICENSE`           | MIT, inherited from this repo |
| `MANIFEST.json`     | Generated inventory with file sizes |
| `.hfignore`         | Hub-side excludes (node_modules/, *.log, etc.) |
| `01-drum-rnn/`      | Drum pattern generation (MusicRNN) |
| `02-melody-interpolator/` | Melody VAE latent-space interpolation |
| `03-trio-generator/` | Drum + bass + melody co-generation (MusicVAE trio) |
| `index.html`        | Landing index for the demo bundle |
| `test-*`, `debug-*` | Smoke / verify scripts |
| `verify_puppeteer.mjs` | Headless verifier |

Excluded: `node_modules/` (29 MB, references Google CDN at runtime),
`package-lock.json` (regenerated on `npm install`).

## Verify

- `bash scripts/build-magenta-dsp-bundle.sh --apply` writes the bundle.
- `bash scripts/push-magenta-dsp-to-hf.sh --dry-run --no-build` prints
  the exact `hf upload` command without contacting the Hub.
- `node verify-hf-publish.mjs` boots a static server and asserts the
  panel renders the token field, tag input, dry-run checkbox, and
  submit button.
- `node verify-cloudpages-deploy.mjs` ensures none of the new routes
  break the existing page list.

## Server-side hardening (Vercel)

| Item | Why |
|------|-----|
| Endpoint requires `swrc_session` cookie | Blocks anonymous abuse of HF writes |
| `HF_TOKEN_ORG_ADMIN` env (optional)     | If set, the serverless proxy requires its presence as a kill-switch |
| Allowed origin echo from `setCors`      | Tight CORS — same-origin only by default |
| Token scrubbed from argv → env-only     | Avoids leaking via process listings / `ps` |
| `sessionStorage` only, never `localStorage` | Single-tab footprint, no persistent leak |

## Troubleshooting

- **404 from `hf repos list`** — first push needs `--repo-type model`
  (the script passes it). If you bypass the script, add manually.
- **"No such option '--author'"** — the CLI namespace flag is
  `--namespace`, not `--author`. Use `hf repos list --namespace kaidjuric`.
- **Permission denied pushing as `kai-djuric/...`** — that org is
  read-only for Space-create; always push to `kaidjuric/...`.
- **First push needs `README.md` with YAML frontmatter** — the bundle
  script writes one automatically. Don't override without `license:`
  set or the Hub rejects the new repo.
- **`hf auth login` interactive prompt hangs in CI** — set
  `HF_TOKEN` env var instead of relying on the prompt.

## Roll back

The Hub keeps full history; to roll a release back:

    hf upload kaidjuric/magenta-dsp-procedural dist-hf/<previous-tag>/ . \
      --repo-type model --commit-message "revert: roll back to <previous-tag>" \
      --delete "dist-hf/<tag>/*"

Local revert: `bash scripts/push-magenta-dsp-to-hf.sh --tag <previous-tag>`.
