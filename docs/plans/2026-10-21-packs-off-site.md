# The shipped media off-site — the packs

**Date:** 2026-10-21
**Status:** implemented; the operator step (publish + set `PACKS_BASE`) is
awaiting a host credential.
**Why now:** the build is mostly media. `packs/` is 582 files and 39.6 MB
— 22% of a build that sits close to the 180 MiB CI ceiling, and the
packs are opt-in content that most visitors never open.

## The seam

The packs are reached through exactly one file. The engine's library drawer
(`client/library-packs.client.js`), `/packs.html` and `/photo-scrolls.html`
all fetch `/packs/manifest.json` and then load the media the manifest
lists, resolved against the manifest's `base`:

```
manifest.base = "/packs/"          → the media comes from the deploy
manifest.base = "https://host/packs/" → the media comes from the host
```

Nothing else in the tree knows the packs' paths. So the deploy can ship
the manifest alone and let the browser fetch the media from somewhere
else — the same trick the store already uses for the paid downloads
(`store.downloads[].source` → `out/store/*.zip` → the host).

## What changed

| | before | after |
|---|---|---|
| `PACKS_BASE` unset | the whole `packs/` directory ships | unchanged — the default is byte-identical |
| `PACKS_BASE` set | — | only `packs/manifest.json` ships, with `base` rewritten to the URL |

- `scripts/lib/packs-offsite.mjs` — the shared logic: base normalisation
  (absolute http(s) only, trailing slash guaranteed), the manifest
  rewrite (every other key preserved verbatim), the copy plan, the file
  walk and the byte count.
- `vite.config.js` — `copy-static` learns the `offsite` flag on the
  `packs` entry. With `PACKS_BASE` set it writes the rewritten manifest
  and removes anything else in the output directory, so a stale
  `public/packs/` cannot put the media back into the build.
- `scripts/publish-media-offsite.mjs` — uploads the packs to **Vercel
  Blob** (`BLOB_READ_WRITE_TOKEN`) or the **Hugging Face Hub**
  (`HF_TOKEN` + `HF_REPO`, pushed with the `hf` CLI), then prints the
  `PACKS_BASE=` line for the deploy environment. With no credential it
  prints `(env skip: …)` and exits 0.

## The measurement

`check:media-offsite-smoke` builds the site a second time with
`PACKS_BASE` set, into a separate output directory, and proves:

- the built `packs/` directory holds the manifest and nothing else;
- the manifest's `base` is the off-site URL, and the 19 packs are still
  listed;
- the normal build ships 39.6 MB of pack media — exactly what the host
  has to serve;
- in a real browser, against a stand-in host on a **different origin**:
  every pack image points at that origin, the images load, and a
  cross-origin `fetch()` of a pack file — the exact call the engine's
  library makes — succeeds.

## The operator steps

1. `npm run media:publish` — uploads the packs and prints
   `PACKS_BASE=https://…/packs/`. The script verifies the host's CORS
   header and fails if it is missing.
2. Set `PACKS_BASE` in the deploy environment (Vercel) **and** in the CI
   environment, so the CI build-size gate measures the build that is
   actually deployed.
3. Re-run the build and confirm the size: the packs' 39.6 MB should be
   gone from `dist/`.

Until step 2 happens, the site is unchanged: the packs are served by the
deploy exactly as they are today.

## The risks

- **A host without CORS breaks the packs.** The engine fetches the media
  from its own origin, so the host must answer with
  `access-control-allow-origin`. The publish script checks this and
  fails; the smoke proves the browser path.
- **The manifest stays in the deploy.** That is deliberate: the browser
  fetches it same-origin, so the site keeps working (and the packs keep
  resolving to the deploy) when no host is configured.
- **Only the packs.** `audios/` (39.9 MB) is the next biggest directory,
  but the demo songs are loaded by hardcoded paths in each variant page —
  a wider change, and not this one.
