# Offline render API

HTTP front door for the full-song renderer (`scripts/render-full-song.mjs`).
Same Puppeteer + CDP screenshot + ffmpeg `image2pipe` pipeline the batch
CLI uses — exposed as a job queue for local / self-hosted Node.

**Not available on Vercel serverless.** A create/status call against the
deployed Hobby/Pro functions returns `503 offline_render_unavailable`.
Run it under `npm run dev` (or any host that loads `scripts/dev-api.mjs`).

## Quick start

```bash
# 1. local API (dev middleware serves /api/*)
export SWR_RENDER_SECRET=dev-secret
npm run dev

# 2. enqueue a render (repo-relative audio path)
curl -sS -X POST http://127.0.0.1:5174/api/render \
  -H "content-type: application/json" \
  -H "x-swr-render-secret: $SWR_RENDER_SECRET" \
  -d '{"audioPath":"audios/neon.mp3","variant":"film","fps":12}'

# → { "ok": true, "job": { "id": "…", "status": "running"|"queued", … } }

# 3. poll
curl -sS "http://127.0.0.1:5174/api/render?action=status&jobId=<id>" \
  -H "x-swr-render-secret: $SWR_RENDER_SECRET"

# 4. download when downloadReady is true
curl -sS -OJ "http://127.0.0.1:5174/api/render?action=download&jobId=<id>" \
  -H "x-swr-render-secret: $SWR_RENDER_SECRET"
```

Auto-pick the variant (same scorer as `batch-video.mjs`):

```bash
curl -sS -X POST http://127.0.0.1:5174/api/render \
  -H "content-type: application/json" \
  -H "x-swr-render-secret: $SWR_RENDER_SECRET" \
  -d '{"audioPath":"audios/neon.mp3","autoPick":true}'
```

## Endpoints

| Method | Query / body | Result |
|--------|--------------|--------|
| `GET` | `?action=health` | `{ ok, available, maxConcurrent, vercel }` — **public** |
| `POST` | `{ audioPath, variant?, libraryPaths?, fps?, width?, height?, autoPick? }` | `202` `{ ok, job, started }` |
| `GET` | `?action=status&jobId=` | `{ ok, job }` |
| `GET` | `?action=list&limit=` | `{ ok, jobs }` |
| `GET` | `?action=download&jobId=` | `video/mp4` when `status=done` |

## Auth

Either:

- Header `x-swr-render-secret: <SWR_RENDER_SECRET>` (or `Authorization: Bearer …`)
- A signed-in `swrc_session` cookie (same as the rest of the API)

Wrong secret → `401` (does not fall through to an anonymous session).

## Paths

`audioPath` / `libraryPaths[]` must resolve under the **repo root** or
`SWRC_DATA_DIR`. Absolute escapes and `..` segments are refused.

## Env

| Var | Default | Meaning |
|-----|---------|---------|
| `SWR_RENDER_SECRET` | unset | Shared secret for machine clients |
| `SWR_RENDER_MAX_CONCURRENT` | `1` | Cap simultaneous Chrome workers (max 4) |
| `SWR_RENDER_DRY_RUN` | unset | Worker writes a tiny placeholder mp4 (gate / CI) |
| `SWR_RENDER_DISABLE` | unset | Force `available:false` even locally |
| `SWRC_DATA_DIR` | `./data` | Job JSON + output mp4 root |

Jobs live at `$SWRC_DATA_DIR/render-jobs/<id>.json`; outputs at
`$SWRC_DATA_DIR/render-out/<id>.mp4`.

## Gate

`npm run check:render-offline-api-unit` (in the `check` group) — hermetic
HTTP suite with `SWR_RENDER_DRY_RUN=1`, no Chrome.

## Related

- CLI batch path: `docs/BATCH-VIDEO.md`, `scripts/batch-video.mjs`
- Renderer: `scripts/render-full-song.mjs` → `renderVariant()`
- Worker: `scripts/render-offline-worker.mjs`
