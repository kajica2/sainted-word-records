# asset-curator.md — auto-process uploaded media via existing HF Space agents

**Status:** Plan + Stage 1 starting.
**Branch:** `feat/asset-curator`
**Base:** `feat/music-video-hologram`

---

## What this is

Wires the user's existing HF Space agents into the music_video
upload pipeline so that dropped assets are **automatically
processed**:

- **png-creator** removes white/black backgrounds (Threshold mode or
  rembg AI mode) — produces a transparent B&W PNG
- **association** tags the result with CLIP zero-shot classification
- The asset lands in a folder derived from the tags

This is the **Swarm Orchestrator pattern** (`kaidjuric/orchestrator`)
applied to the music_video upload pipeline: existing agents chained
together to process user uploads.

---

## Why this exists

Today, when a user drops an asset into music_video.html:
- PNG goes into the library as-is, with whatever background it has
- GIF goes into the library with whatever background it has
- No automatic processing, no auto-folder routing, no background
  removal

This feature makes uploads **smart**: drop a gift bag with a white
background, and the user sees it land in `/gift-bags` as a
transparent B&W PNG within seconds — no clicks, no manual cleanup.

---

## Architecture

```
   user drops file
        │
        ▼
   library/upload handler (client-side)
        │
        ├─ if (kind === 'image/png' || kind === 'image/jpeg')
        │     │
        │     ▼
        │   client/asset-curator.client.js
        │     │
        │     ├─ Step 1: corner-pixel sniff → detect uniform bg color
        │     │   (sample 4 corners, check if RGB within ε of each other)
        │     │
        │     ├─ Step 2: if uniform bg detected → Canvas chroma key
        │     │   (set alpha=0 where pixel is within ε of detected color)
        │     │   produces transparent PNG in <50ms, no model download
        │     │
        │     ├─ Step 3: call kaidjuric/association via HF Space API
        │     │   (CLIP zero-shot tags → folder name)
        │     │   1-3s latency, fallback to local heuristics on timeout
        │     │
        │     └─ Step 4: route to folder by tag
        │         asset.folder = "gift-bags" (or "transparent-pngs", etc.)
        │
        └─ if (kind === 'image/gif')  → log + route to "/needs-review"
           (animated GIF background removal is out of scope this round)
```

The png-creator logic is replicated **client-side** with Canvas API.
HF Spaces are not on the critical path for background removal —
they're only for tagging (which has a local fallback).

---

## Why client-side instead of calling the HF Space directly

1. **The HF Space is currently broken** (`runtime.stage: "BUILD_ERROR"`).
2. **Free-tier Spaces sleep after 48h.** First request is 30-60s cold start.
3. **The threshold algorithm is trivial** — 10 lines of Canvas API.
4. **No new dependencies.** Pure browser primitives.
5. **Same algorithm as the HF Space.** Read the Space's source:
   `image.convert("L").point(lambda x: 255 if x > threshold else 0, mode="1")`
   then `data[white_mask, 3] = 0`. Reproducible exactly in browser.
6. **Tagging still uses HF Space** (the `association` Space) — but
   that's a fire-and-forget call with a 3s timeout and local fallback
   so the user experience never blocks on HF availability.

If you want me to also replicate the rembg path client-side, that's
Stage 4 (~2 days, requires a WASM model like `@imgly/background-removal`).

---

## Stage 1 — client-side background removal + folder routing

New file `client/asset-curator.client.js` (~180 lines). Pure browser.
No network. No dependencies. Reads from a `File` object, returns a
`{ file: Blob, folder: string, tags: string[] }` result.

API:
```js
window.SWR_ASSET_CURATOR.process(file: File): Promise<{
  file: Blob,                // the cleaned file (or original if no-op)
  folder: string,             // "gift-bags" | "transparent-pngs" | ...
  tags: string[],             // ["gift bag", "transparent", ...]
  status: 'cleaned' | 'passthrough' | 'skipped',
  tookMs: number,
}>
```

Implementation:
- Corner-pixel sniff: read 4 corner pixels, if all within ε of each
  other, that's the bg color. ε = 5 RGB units.
- Chroma key via Canvas API:
  ```js
  const ctx = canvas.getContext('2d');
  const imgData = ctx.getImageData(0, 0, w, h);
  for (let i = 0; i < imgData.data.length; i += 4) {
    const r = imgData.data[i], g = imgData.data[i+1], b = imgData.data[i+2];
    const dr = r - bg.r, dg = g - bg.g, db = b - bg.b;
    if (dr*dr + dg*dg + db*db < bgThreshold * bgThreshold) {
      imgData.data[i+3] = 0; // transparent
    }
  }
  ctx.putImageData(imgData, 0, 0);
  ```
- Tag via local heuristic on filename + image dimensions (no HF):
  ```js
  const TAG_RULES = [
    { test: (f) => /gift|bag|present/i.test(f.name), tag: 'gift bag', folder: 'gift-bags' },
    { test: (f) => f.width === f.height && f.width < 256, tag: 'icon', folder: 'transparent-pngs' },
    { test: (f) => /silhouette|outline/i.test(f.name), tag: 'silhouette', folder: 'transparent-pngs' },
    // ... etc
  ];
  ```

The Stage 2 HF Space call replaces the heuristic — Stage 1 ships the
heuristic so the feature works immediately, no network dependency.

Wire the call:
- `versions/music_video.html`'s `handleLibraryFile()`:
  - For `image/png` and `image/jpeg`: call `SWR_ASSET_CURATOR.process(file)`
  - Replace the original file with the result.file in the library
  - Tag the asset with `asset.folder` and `asset.tags`
  - Show toast: "✓ gift bag" or "ℹ passthrough"
- Library aside renders assets grouped by `folder` with a small
  folder header per group

**Success criteria:**
- 5 unit tests in `scripts/check-asset-curator-unit.mjs`:
  - White-bg PNG → cleaned file has alpha channel non-zero on edges
  - Transparent PNG (already alpha) → passthrough, no change
  - Photo with non-uniform bg (e.g. landscape) → passthrough
  - Black-bg PNG → cleaned with bgThreshold=30
  - Filename "gift_bag_01.png" with white bg → folder='gift-bags'

---

## Stage 2 — HF Space tagging with local fallback

Extend `client/asset-curator.client.js` to **augment** the local
heuristic with the `kaidjuric/association` Space when available:

```js
// After the local heuristic produces tags, fire a parallel HF call
// that returns additional CLIP tags. Merge with local tags, dedup.
// If HF takes >3s or returns an error, use the local tags only.

async function tagViaHF(imageBlob) {
  try {
    const form = new FormData();
    form.append('data', imageBlob, 'asset.png');
    const r = await fetch('https://kaidjuric-association.hf.space/gradio_api/call/tag', {
      method: 'POST', body: form, signal: AbortSignal.timeout(3000)
    });
    if (!r.ok) return null;
    const j = await r.json();
    return Object.entries(j).map(([tag, score]) => ({ tag, score }));
  } catch { return null; }
}
```

Wire into `process()`:
- Run local heuristic synchronously (always)
- Fire `tagViaHF()` in parallel; await with timeout
- If HF returns, merge + re-rank + pick final folder

**Success criteria:**
- 3 unit tests:
  - Local-only (no HF) returns local tags
  - HF timeout after 3s falls back to local
  - HF 200 with valid tags merges them with local

---

## Stage 3 — UI surface + smoke + ship

`versions/music_video.html`:
- Replace the library aside's flat list with a folder-grouped list
- Each folder has a header: `📁 gift-bags (5)`, `📁 transparent-pngs (12)`, etc.
- Each asset shows: thumbnail, name, tags (small chips), `🤖 cleaned`
  badge if it was processed
- Drag-and-drop still works on the page (existing handler)
- A small "Agent curator" status pill in the footer: "online" /
  "unavailable" — reflects whether the proxy endpoint is reachable

`scripts/check-asset-curator-smoke.mjs` (Puppeteer):
- Boots music_video.html
- Mocks `/api/asset-curator/process` to return a fixed response
- Drops a synthetic PNG via the file input
- Verifies the asset appears in the right folder
- Verifies the toast and status badge appear

---

## File plan

**New (2):**
- `client/asset-curator.client.js` (~200 lines, browser-only)
- `scripts/check-asset-curator-unit.mjs` (~180 lines, 8 unit tests)

**Modified (1):**
- `versions/music_video.html`:
  - Extend the library `<aside>` to render folder-grouped assets
    (~50 lines added)
  - Extend `handleLibraryFile()` to call `SWR_ASSET_CURATOR.process()`
    after a PNG/JPEG drop (~30 lines added)
  - Add the "Asset curator" status pill to the footer (~15 lines)

**Unchanged:**
- The other 19 versions/*.html pages
- The engine, recorder, GIF support, score-evolution work
- Auth, music-video-hologram foundation

---

## Total effort

- Stage 1: 1 day (client module + tests + wiring)
- Stage 2: 0.5 day (HF tagging + fallback)
- Stage 3: 0.5 day (UI polish + smoke + ship)

Total: ~2 days.

---

## Risks

1. **HF Spaces cold-start.** Free-tier Spaces sleep after 48h.
   First request after wakeup is 30-60s. The HF call has a 3s
   `AbortSignal.timeout()` — local fallback kicks in immediately.
   User sees the asset land with local-only tags.
2. **The png-creator Space is currently broken** (`BUILD_ERROR`).
   That doesn't affect Stage 1 because we're not calling it
   client-side. But it affects Stage 4 (rembg path) if we ever
   add it. Punt to "use the local threshold path until HF Space
   is fixed."
3. **The `association` Space API shape.** I assumed
   `gradio_api/call/tag` with form-encoded `data` field. Need to
   verify by hitting the Space's `/gradio_api/info` endpoint. If
   the API path is different, Stage 2 falls back to local-only
   tags gracefully (the heuristic already covers the common cases).
4. **GIF background removal.** Out of scope; GIFs go to
   `/needs-review` so the user can manually clean them.
5. **Tagger accuracy.** Local heuristic covers ~12 common cases
   (gift bag, icon, silhouette, etc.). HF Space adds ~50 more via
   CLIP. The user's eyes are the final fallback — `uncategorized`
   folder catches anything unknown.

---

## Out of scope (deferred)

- Animated GIF background removal
- User-trained custom tagger
- Auto-publish to a community pack store
- Cloud storage of processed assets (stays in browser IDB for now)
