# remove-demo-library.md — strip the curated demo asset bundle from build + production

**Status:** Plan only.
**Branch:** `feat/remove-demo-library` (from `main` after PR #73 ships).
**Scope:** local-only `library/` cleanup + production-deploy stripping + delete `fetch-library.mjs`. **Keep `audios/`** (each variant page auto-loads its own demo MP3; per-page dependency, not a curated bundle).

---

## Why

1. **Vercel Hobby 100MB build cap.** The curated `library/` is 126MB. The `audios/` is 4.6MB and is the only thing keeping first-visit UX alive on every variant.
2. **No production library ever reaches a user.** `library/` is gitignored and only populated by `fetch-library.mjs` at build time from `LIBRARY_BLOB_URL` (Vercel Blob). In CI without the env var, the engine ships empty already (vite.config.js:338-340 logs "WARNING: ./library not present" and continues). The strip target is to formalize that: no Vercel Blob, no Blob token, no library code path.
3. **First-visit UX degrades gracefully.** Each variant already auto-loads `audios/<variant>.mp3` via `<script>` in `versions/*.html`. The Media Manager tab will say "drop files" instead of showing stock thumbs. That's the new normal — every user brings their own.

---

## What gets deleted

| Path | Size | Notes |
|---|---|---|
| `library/` (whole tree, 173 files) | 126MB | All `*.gif`, `*.mp4`, `*.png`, `*.jpg`, `*.wav`, `*.mp3`. Gitignored already; just a `rm -rf` locally. |
| `scripts/fetch-library.mjs` | ~120 lines | The Vercel Blob → `library/` populator. Dead. |
| `scripts/upload-library.mjs` | ~? lines | The reverse (local → Vercel Blob). Dead. |
| `scripts/build-manifest.mjs` | ~? lines | Generates `library/manifest.json` from the local `library/` tree. Dead. |
| `scripts/compress-gifts.mjs` | ~? lines | GIF compression for the demo bundle. Dead. |
| `scripts/downsize-library.py` | ~? lines | Re-encode demo videos for size cap. Dead. |

## What gets edited

| File | Change |
|---|---|
| `vite.config.js` (lines 70, 243-296, 334-441) | Remove the `copyStatic()` library branch (the curated-copy plugin). Keep the `audios/` copy at lines 286-297 — that's intentional per-variant demo audio. Remove the `if (!existsSync('library'))` warning log (it's no longer a warning, it's the new normal). |
| `vercel.json` (line 65) | Remove the `/library/:path*` rewrite. Keep `/audios/:path*` (line 56). |
| `package.json` | Remove `prebuild`, `build:vercel`, `upload:library`, and `verify:library-loads`, `verify:library-switcher`. (Keep the other verify-* scripts that don't touch `library/`.) |
| `engine.html:6524-6559` | The "Auto-load pre-seeded assets" block. Delete it. Falls through to the existing "drop files" hint. |
| `engine.html:7104-7109` | The `SONGS` list entries that reference `/library/audio/*`. Replace with empty array or a single entry: `{ url: '/audios/film.mp3', name: 'Demo', artist: 'procedural' }`. |
| `versions/music_video.html:462` | The "swr-request-demo" link that points to `/library/manifest.json`. Delete or repoint to `/audios/film.mp3`. |
| `versions/music_video.html:470` | `DEFAULT_SONG = '../audios/film.mp3'` — **KEEP**. This is the per-variant demo audio and is the entire reason `audios/` stays. |
| `client/library-loader.client.js` | The first-visit pre-seeder that fetches `./library/manifest.json`. **KEEP** the file but make it a no-op: when manifest fetch fails (the new normal), just resolve with `[]`. ~5-line edit. |
| `client/library-packs.client.js` | The "Are.na packs" tab in the Media Manager. **KEEP** — these are user-facing pack bundles from Are.na, not the demo library. Different feature. |
| `lib/library-*.client.js` (6 files) | All the library-management UX (library-switcher, library-persist, library-hygiene, library-manager, media-store). **KEEP** — they manage the user's *uploaded* library (IndexedDB), not the curated demo bundle. The asset-curator wires into this for incoming uploads. |
| `client/asset-curator.client.js` | **KEEP** — runs on user uploads, doesn't depend on the demo library. |
| `.gitignore` | Already ignores `library/`. No change. |
| `docs/BATCH-VIDEO.md`, `docs/plans/batch-*.md` | Don't touch — these docs are about the batch-video CLI, not the demo library. They mention `library/` only as a target for the renderer's `--library` flag, which is still a valid flag (it just points at user uploads now). |
| `AGENTS.md` | Update the `library/` line in the project layout block: "Library: empty by default. Populate via user upload only." Add a "Build behavior" subsection noting that `npm run build` no longer downloads from Vercel Blob. |

## What does NOT change

- `audios/` — ships with the engine, used by every variant.
- `library/` IndexedDB code path — `lib/library-persist.client.js`, `lib/library-manager.client.js`, `client/library-packs.client.js`, all `versions/*.html` library aside. These are *user* library code, not the curated bundle.
- Asset curator — runs on user uploads, not the demo bundle.
- Any of the 17 engine variants' visual identity, FX, audio reactivity — none of that touches the demo library.
- `verify-*.mjs` smokes that don't reference `library/` — they keep working.

---

## Stage 1 — local cleanup + remove dead scripts (~30 min)

**Goal:** Working tree clean, `npm run check` green, engine boots empty.

Tasks:
- [ ] `rm -rf library/` locally
- [ ] `git rm scripts/fetch-library.mjs scripts/upload-library.mjs scripts/build-manifest.mjs scripts/compress-gifts.mjs scripts/downsize-library.py`
- [ ] `git rm scripts/check-manifest.mjs` (validator for the dead manifest)
- [ ] **Verify no orphan references:** `rg -l "fetch-library\|upload-library\|build-manifest\|compress-gifts\|downsize-library\|check-manifest" --type-add 'config:*.{json,js,mjs,yml,yaml}' scripts lib client engine versions package.json vercel.json vite.config.js .github` should return zero matches.
- [ ] `git rm scripts/test-api.mjs` ONLY if it references the dead scripts (it doesn't, per the earlier search — keep it).

---

## Stage 2 — strip build pipeline (~2 hours)

**Goal:** `npm run build` no longer references `library/` or `fetch-library.mjs`. Vercel deploys work without `LIBRARY_BLOB_URL`.

Tasks:
- [ ] **`vite.config.js`** — remove the `copyStatic()` library branch (the curated-copy plugin at lines 243-296 and 334-441). Keep `audios/`. Remove the `if (!existsSync('library'))` warning log.
- [ ] **`vercel.json`** — remove the `/library/:path*` rewrite (line 65).
- [ ] **`package.json`** — remove `prebuild`, change `build:vercel` to just `vite build`, remove `upload:library` script, remove `verify:library-loads` and `verify:library-switcher` (these probably 404 once the engine is empty — re-add only if they're standalone smoke for the library UI, which they likely are; verify by reading each before deleting).
- [ ] **`engine.html:6524-6559`** — delete the "Auto-load pre-seeded assets from `./library/`" block. Falls through to "drop files" UI.
- [ ] **`engine.html:7104-7109`** — replace the `SONGS` library references with a single demo entry pointing at `/audios/film.mp3` (or whatever the variant's primary demo is).
- [ ] **`versions/music_video.html:462`** — remove or repoint the `swr-request-demo` link (currently points at `/library/manifest.json`).
- [ ] **Run** `npm run build` — should succeed without warnings. Check `dist-dev/` has no `library/` directory.
- [ ] **Run** `npm run check` — syntax/manifest/auth/unit all green.

---

## Stage 3 — engine.html library-loader stub (~30 min)

**Goal:** `client/library-loader.client.js` no longer tries to fetch `./library/manifest.json`; it returns `[]` immediately, letting the "drop files" UI render.

Tasks:
- [ ] **`client/library-loader.client.js`** — wrap the `fetch('./library/manifest.json')` in a try/catch, on any failure return `[]`. Or, more honest: replace the whole module body with `window.SWR_LIBRARY_LOADER = { load: async () => [] };`.
- [ ] **Run** `verify:library-loads` (if it's a UX smoke and not a content smoke) — should still pass against the empty library.
- [ ] **Visual check** — boot engine locally, Media Manager shows "drop files", no console errors.

---

## Stage 4 — AGENTS.md + docs (~30 min)

**Goal:** New contributors don't try to fetch a library that doesn't exist.

Tasks:
- [ ] **`AGENTS.md`** — update the project layout entry for `library/` → "Empty by default. User uploads only." Add a note to the setup commands: "`npm run build` no longer downloads from Vercel Blob. To demo the engine with curated assets, run `scripts/upload-library.mjs` (deleted — restore if needed) or use user uploads."
- [ ] **`README.md`** — if it mentions the demo library or `LIBRARY_BLOB_URL`, remove or note as deprecated.
- [ ] **`SECURITY.md`** — if it mentions storage scoped to `library/`, clarify it's user-uploaded IDB only.

---

## Stage 5 — ship + verify (~1 hour)

**Goal:** PR merged to main, production deploys clean, no demo bundle on the live URL.

Tasks:
- [ ] `npm run check` — green
- [ ] `npm run check:verify` — green (smoke tests still pass with empty library)
- [ ] `git checkout -b feat/remove-demo-library`
- [ ] `git add -A && git commit -m "feat(build): strip curated demo library; users bring their own"`
- [ ] `git push origin feat/remove-demo-library`
- [ ] Open PR → `main`
- [ ] Verify Vercel deploys with no `library/` in `dist/` (curl `https://.../library/manifest.json` → 404; `curl https://.../audios/film.mp3` → 200)
- [ ] Tag + merge per the standard SWR flow

---

## Total effort

| Stage | Time |
|---|---|
| 1. local cleanup | 30 min |
| 2. build pipeline | 2 hours |
| 3. library-loader stub | 30 min |
| 4. AGENTS.md / docs | 30 min |
| 5. ship + verify | 1 hour |

**Total: ~4.5 hours.**

---

## Risks

1. **`engine.html:6524-6559` is bigger than the 38 lines it occupies in the read.** It may also register Media Manager thumbs, set up first-visit onboarding, etc. Reading the whole block before deleting it is mandatory.
2. **`client/library-loader.client.js` may be imported by other client modules** (e.g. the asset curator). The "return `[]`" stub preserves the API surface, so this should be safe, but verify with `rg -l 'library-loader'`.
3. **Vercel Hobby cap.** Currently the build outputs ~140MB total (library 126MB + audio 4.6MB + engine code ~10MB). After this change, ~14MB. Headroom for assets the user uploads.
4. **`build:vercel` is referenced in `vercel.json`'s `buildCommand`.** Removing the script means `buildCommand` becomes just `vite build`. Need to update `vercel.json` too — Stage 2 task list includes this.
5. **`LIBRARY_BLOB_URL` env var becomes a no-op.** If anyone (the user, a CI matrix) is still setting it, the engine ignores it silently. That's fine.
6. **First-visit UX regression.** A new user landing on `engine.html` or `versions/music_video.html` will see "drop files" instead of curated assets. Some users may bounce. Mitigations: the per-variant demo MP3 still auto-loads, so the visualizer runs immediately; a single demo asset (e.g. one curated 30s MP4 in `audios/`) could be added if the empty state feels too austere — out of scope for this round.

---

## Out of scope (deferred)

- Migrating curated library to an opt-in download (toggle in settings). Punt: users who want stock assets can use `Are.na` packs (`client/library-packs.client.js` already supports this).
- Pre-seeding the IndexedDB with one demo asset on first run. Punt: keep the cold-start empty.
- Auto-publish demos from a sister repo. Punt: the user's existing `~/Documents/autodashboard` setup is unrelated.
- Cloud-side library (Cloudflare R2, S3, etc.). Punt: explicitly **out** of scope per the user's call ("Library never re-populates").
