# Backfill missing og:image + twitter:image on 4 versions/*.html + ship 4 missing keyart PNGs

**Cycle**: 2026-09-08T22-09
**Type**: quality
**Priority**: P1
**Estimated effort**: M

## TL;DR

Four `versions/*.html` pages currently produce **404 social previews** when shared on Twitter, LinkedIn, Slack, Discord, iMessage, etc. — every other sharing signal (`og:title`, `og:description`, `twitter:title`, `twitter:description`, `twitter:card=summary_large_image`) is present, but the image asset that the share picker actually loads is missing. Concretely:

- `versions/collage.html` — has og:title/desc/twitter:title/desc, **no `og:image` or `twitter:image`** at all. The browser/Twitter crawler falls back to no preview card.
- `versions/spectrum.html` — same gap (no `og:image` / `twitter:image`).
- `versions/typography.html` — same gap (no `og:image` / `twitter:image`).
- `versions/music_video.html` — has `og:image` AND `twitter:image` pointing at `/keyart/music_video.png`, but **that PNG does not exist on disk** — the file `keyart/music_video.png` is absent (`ls keyart/music_video*` → No such file or directory). Every share of `versions/music_video.html` (the page shipped as the focus of PRs #4-#31) gets a 404 image, which both Twitter's crawler AND Open Graph validators flag.

Plus a **second-order bug**: the existing `_inject_meta.mjs` script that *should* be the canonical way to backfill missing meta tags has two issues that prevented these pages from being patched in the first place:

1. Its `ENGINES` array (line 36-39) lists only the 19 GLSL-preset variants. `collage`, `spectrum`, `typography`, `music_video` are all absent — the latter three have their own preset definitions inside their `<script>` blocks (not in `versions-presets.js`), and `music_video` uses the gradient-panel/automix flow.
2. Its idempotency guard (line 52) skips pages that *already* contain `og:title` — but `collage.html`, `spectrum.html`, and `typography.html` already have `og:title` from manual patching, so re-running the script never reaches them even after the ENGINES list is corrected. The script needs a stricter guard that checks for `og:image` specifically.

Ship order: (a) regenerate the 4 missing keyart PNGs (1200x630, same shape as the other 19), (b) patch `_inject_meta.mjs` so the next regression can't recur silently, (c) add the missing `<meta>` tags to the 3 pages, (d) add a `check-meta-tags.mjs` script that fails `npm run check` if any `versions/*.html` is missing `og:image` or `twitter:image` — so this can't drift again.

## Why this cycle

**Scan evidence** (Phase 2):

- **Page-by-page audit** (run via `for f in versions/*.html; do name=$(basename "$f" .html); has_og=$(grep -c 'og:image' "$f"); has_keyart=$(ls keyart/${name}.png 2>/dev/null >/dev/null && echo YES || echo NO); echo "$name og=$has_og keyart=$has_keyart"; done`):
  ```
  aurora         og=1 keyart=YES    barcode       og=1 keyart=YES    chrome       og=1 keyart=YES
  collage        og=0 keyart=NO     ← gap         eclipse        og=1 keyart=YES    film         og=1 keyart=YES
  fractal        og=1 keyart=YES    gallery       og=1 keyart=YES    glitch       og=1 keyart=YES
  grid           og=1 keyart=YES    hallucination og=1 keyart=YES    kraft        og=1 keyart=YES
  mosaic         og=1 keyart=YES    music_video   og=1 keyart=NO     ← og:image points at 404
  neon           og=1 keyart=YES    phosphor      og=1 keyart=YES    pulse        og=1 keyart=YES
  smoke          og=1 keyart=YES    spectrum      og=0 keyart=NO     ← gap         tape         og=1 keyart=YES
  typography     og=0 keyart=NO     ← gap         void           og=1 keyart=YES    watercolor   og=1 keyart=YES
  ```
  Three pages are missing the meta tag entirely; one page has the tag but the asset doesn't exist. 4/23 = **17% of the version fleet** ships broken social previews today.
- **The hand-rolled `<meta>` blocks on the 3 broken pages** (e.g. `versions/collage.html:11-19`) are clean — `og:title`, `og:description`, `og:url`, `twitter:card=summary_large_image`, `twitter:title`, `twitter:description` are all present and correct. The gap is **only** the two `<meta property="og:image">` and `<meta name="twitter:image">` lines. This is a surgical insert, not a rewrite.
- **`_inject_meta.mjs` is the canonical patcher but has 2 bugs that explain how the gap formed**:
  - Line 36-39 — `ENGINES = ['aurora', 'baroque', 'chrome', 'eclipse', 'film', 'fractal', 'gallery', 'glitch', 'grid', 'hallucination', 'kraft', 'mosaic', 'neon', 'phosphor', 'pulse', 'smoke', 'tape', 'void', 'watercolor']` — exactly the 19 pages whose preset dicts live in `versions-presets.js:94-417`. The 3 manually-tagged pages (`collage`, `spectrum`, `typography`) and the `music_video` page are absent because their presets are inline in their own `<script>` blocks.
  - Line 52 — `if (src.includes('og:title') || src.includes('property="og:image"')) { skip }` — short-circuits if **either** `og:title` OR `og:image` is present. `collage.html`, `spectrum.html`, `typography.html` already have `og:title` (from manual tagging), so even if they were added to ENGINES they'd be skipped. The check needs to be `if (src.includes('property="og:image"'))` so only true positives skip.
- **The `music_video` keyart was apparently generated at some point** — `versions/music_video.html:15` and `:20` both reference `/keyart/music_video.png`, and the file `keyart/music_video.png` is missing from `git log keyart/` history (last commit touching keyart: `168fa40 fix(deploy): ship 11 missing engine scripts + portfolio/ directory`). The file was either never committed, was lost in a merge conflict resolution, or the asset-generation step that produced the other 19 never ran for `music_video`. Whatever the cause, the *current* state is a 404 link in production HTML.
- **Working-tree compatibility**: `git status` shows untracked on `package.json:24-41` (a script-block edit, not a `check` script change), `.worktrees/`, `.improvements/2026-09-08T*`, and the recent `._static_server.mjs`. None touch `versions/*.html` head blocks, `_inject_meta.mjs`, `keyart/`, or `scripts/check-*.mjs`. This plan edits 4 head blocks + 1 root script + 1 root script (new) + 4 PNG files + 1 package.json edit — all clean.
- **Existing related regression guards**: `scripts/check-syntax.mjs` validates inline script syntax but does NOT audit meta tags. There is currently **no automated check** for og:image completeness — that's why this gap drifted in the first place. The new `scripts/check-meta-tags.mjs` closes that hole permanently.
- **Why now (not lower priority)**: PR #25 (Solo toggle), #26 (master transform toggle), #28 (per-layer cover), #30 (mirror × button) — all of the most-recently-merged work touched `versions/music_video.html` (the highest-traffic variant) and made the broken og:image more visible (every shared demo link goes through that page). Kai is actively pushing music-video as the flagship demo surface; broken social previews undermine the share flow that's supposed to drive organic reach.
- **Why not industry-template**: 32 of the 33 prior cycles are speed/quality plans; the 1 industry-template (fitness) is still un-shipped (per `STATE.json:in_flight_proposals`, it's absent — implying the user actioned/deferred it). Another industry page adds to the same backlog. Quality wins compound: ship the social-preview fix (concrete bug, low effort, high payoff), keep the in-flight fitness template on the table for next cycle.

## Goal

Every `versions/*.html` page (23 total) has both `<meta property="og:image">` AND `<meta name="twitter:image">` pointing at a PNG that exists on disk (relative to the deployed root). `_inject_meta.mjs` is fixed so the next regression can't recur. A new `scripts/check-meta-tags.mjs` runs in `npm run check` and fails loudly if any future regression appears. The fix lands as one PR (`fix(versions): backfill missing og:image + twitter:image + 4 missing keyart PNGs`).

## Plan

### Step 1 — generate the 4 missing keyart PNGs (1200x630, matching the rest of the fleet)

- **Files**: new files at `keyart/collage.png`, `keyart/spectrum.png`, `keyart/typography.png`, `keyart/music_video.png`. Plus a matching `keyart/<name>.svg` for each (a `<svg>` wrapping `<image href="<name>.png" width="1200" height="630" />` — matches the existing pattern in `keyart/aurora.svg` etc.).
- **Action**: render a 1200x630 PNG for each variant. Source-of-truth for the visual identity comes from the variant's existing CSS theme-color and og:description:
  - `collage.png` — `#f4f0e8` background, `#d8232a` accent, "Mixed-media magazine grid" headline. Use a 3x3 tile grid sample rendered at 1200x630.
  - `spectrum.png` — `#050811` background, `#ff6090` accent + `#fff0a0` highlight. Render an FFT-bar visualization across the full width.
  - `typography.png` — `#0e0e0e` background, `#ff3030` accent. Render a large "Aa" headline in `Archivo Black` (the variant already imports that font at `versions/typography.html:15`).
  - `music_video.png` — `#05030a` background (matches `versions/music_video.html:21`), a gradient halo with the 19 anchor dots from `client/preset-anchor-map.client.js` scattered across the canvas. This page already has the gradient-panel/automix identity baked in — the keyart should hint at the gradient panel.
- **Verify**: `file keyart/{collage,spectrum,typography,music_video}.png` returns `PNG image data, 1200 x 630` for each. `du -h keyart/{collage,spectrum,typography,music_video}.png` returns sizes in the same 250-650 KB range as the existing 19 PNGs (not 2 MB blobs, not 30 KB stubs). Open one in a viewer and visually confirm the headline is legible at 600x315 (Twitter's preview-card render scale).

### Step 2 — add the 6 missing meta tags to the 3 broken pages

- **Files**: `versions/collage.html:18-19`, `versions/spectrum.html:18-19`, `versions/typography.html:18-19`.
- **Action**: insert immediately after the existing `<meta name="twitter:description" .../>` line in each:
  ```html
    <meta property="og:image" content="/keyart/<name>.png" />
    <meta name="twitter:image" content="/keyart/<name>.png" />
  ```
  Where `<name>` is `collage`, `spectrum`, `typography` respectively. Match the `og:url` line at `:15` for spacing — single space indent inside `<head>`.
- **Verify**: `grep -nE 'og:image|twitter:image' versions/{collage,spectrum,typography}.html` returns 2 hits per file (the existing 1 hit per file was for `og:title`/`twitter:title`, not images). Specifically `og:image` and `twitter:image` lines must now exist.

### Step 3 — fix `_inject_meta.mjs` so the next regression can't recur silently

- **Files**: `_inject_meta.mjs:36-39` (ENGINES array) and `_inject_meta.mjs:52` (idempotency guard).
- **Action**:
  1. Expand `ENGINES` to include the 4 missing pages: `collage`, `spectrum`, `typography`, `music_video`. Their `label`/`desc` come from the existing `<meta property="og:title">` and `<meta property="og:description">` lines in each HTML file (the script can fall back to parsing the HTML's existing meta tags when the preset isn't in `versions-presets.js` — same regex pattern, different source file).
  2. Tighten the skip-check from `if (src.includes('og:title') || src.includes('property="og:image"'))` to `if (src.includes('property="og:image"'))` so that pages with `og:title` but no `og:image` (the exact failure mode of this cycle) get re-patched.
  3. Re-run `node _inject_meta.mjs` after the fix lands; expected output: `4 patched` for `collage`, `spectrum`, `typography`, `music_video` (the latter only needs the auto-generated meta to match the now-shipped PNG), `19 skipped` for the existing 19, `0 failed`.
- **Verify**: re-running the script prints `4 patched, 19 skipped, 0 failed` and exits 0. The diff on the 4 patched pages should be limited to the 2 lines per page inserted in Step 2 (or zero, if Step 2 already landed them — the script should be idempotent on a clean tree).

### Step 4 — write `scripts/check-meta-tags.mjs` and wire it into `npm run check`

- **Files**: new `scripts/check-meta-tags.mjs` at repo root, plus a one-line edit to `package.json:24-41` (the `check` script entry) to insert `&& npm run check:meta-tags` between existing checks.
- **Action**: `scripts/check-meta-tags.mjs`:
  ```js
  // scripts/check-meta-tags.mjs — every versions/*.html must declare both
  // og:image AND twitter:image pointing at a PNG that exists on disk.
  // Catches the regression that produced 2026-09-08T22-09.
  //
  // Exits 0 if all 23 pages pass, 1 with a clear list of failures otherwise.

  import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
  import { join } from 'node:path';

  const ROOT = new URL('..', import.meta.url).pathname;
  const VERSIONS_DIR = join(ROOT, 'versions');
  const KEYART_DIR = join(ROOT, 'keyart');

  const pages = readdirSync(VERSIONS_DIR).filter(f => f.endsWith('.html')).sort();
  let failed = 0;
  const failures = [];
  for (const f of pages) {
    const src = readFileSync(join(VERSIONS_DIR, f), 'utf8');
    const ogImg = src.match(/<meta property="og:image"\s+content="\/keyart\/([^"]+)"/);
    const twImg = src.match(/<meta name="twitter:image"\s+content="\/keyart\/([^"]+)"/);
    const pageName = f.replace(/\.html$/, '');
    const problems = [];
    if (!ogImg) problems.push('missing og:image');
    if (!twImg) problems.push('missing twitter:image');
    const expectedPng = `keyart/${pageName}.png`;
    if (!existsSync(join(ROOT, expectedPng))) problems.push(`asset ${expectedPng} missing on disk`);
    if (problems.length) {
      failed++;
      failures.push(`  ${f}: ${problems.join(', ')}`);
    }
  }
  if (failed) {
    console.error(`check-meta-tags: ${failed} page(s) failed:\n${failures.join('\n')}`);
    process.exit(1);
  }
  console.log(`check-meta-tags: ${pages.length} pages OK`);
  ```
  Then add `"check:meta-tags": "node scripts/check-meta-tags.mjs",` to `package.json:scripts` and add `&& npm run check:meta-tags` to the `check` chain.
- **Verify**: `npm run check:meta-tags` exits 0 after Steps 1-3 land; intentionally re-introduce the gap (delete `keyart/music_video.png`) and confirm `npm run check:meta-tags` exits 1 with the expected error message; restore and confirm exit 0. `npm run check` (full chain) passes.

### Step 5 — commit as a single PR

- **Files**: `versions/{collage,spectrum,typography}.html`, `_inject_meta.mjs`, new `keyart/{collage,spectrum,typography,music_video}.png` + `.svg`, new `scripts/check-meta-tags.mjs`, `package.json`.
- **Action**: `git add versions/ _inject_meta.mjs keyart/ scripts/check-meta-tags.mjs package.json && git commit -m "fix(versions): backfill missing og:image + twitter:image + 4 missing keyart PNGs"`.
- **Verify**: `npm run check` passes locally. `git log -1` shows the new SHA. Open a PR; per `AGENTS.md:78-91` the repo-local git config is unset, so the assistant commits ship as the global user `kajica2 <kai.djuric@gmail.com>` — Vercel deploys auto on merge to `main` (`AGENTS.md:127`).

## Verification

- `npm run check` passes (includes the new `check:meta-tags` step)
- `npm run build` passes (vite copy step ships `dist/keyart/{collage,spectrum,typography,music_video}.png`; vite.config.js's `copy-static` plugin handles `keyart/` via the standard public-dir pattern — verify via `ls dist/keyart/` post-build).
- For each of the 23 versions pages: `curl -sI https://sainted-word-records.vercel.app/versions/<name>.html | grep -iE 'og:image|twitter:image'` returns both meta tags. For the 4 pages in this fix, `curl -sI https://sainted-word-records.vercel.app/keyart/<name>.png` returns `HTTP/2 200` (not 404).
- Twitter Card Validator (https://cards-dev.twitter.com/validator) for each of the 4 fixed URLs returns "Card loaded successfully" with the new image.
- Manually share each URL in iMessage/Slack/Discord and confirm the preview card shows the new keyart.

## Risks / gotchas

- **PNG file size budget**: each existing PNG is 250-650 KB; 4 new PNGs at the same size adds ~2 MB to the repo. Repo size isn't a hard constraint per AGENTS.md (only the `library/` 100MB Vercel Hobby cap is cited), but worth a sanity check via `du -sh .` before commit. If the 4 new PNGs blow the budget, lower JPEG quality / use WebP — but WebP doesn't have universal Twitter crawler support, so stick with PNG.
- **Vite `copy-static` plugin**: `keyart/` is at the repo root, not under `public/`. Confirm the plugin copies it through to `dist/keyart/` (post-build `ls dist/keyart/` shows all 23 PNGs). If not, add a `copyKeyArt` plugin step in `vite.config.js`. Same check applies to `dist/keyart/<name>.svg` (the SVG fallbacks — used by some older Twitter clients).
- **The 3 manually-tagged pages were hand-edited, not auto-generated**: their meta-tag format may differ subtly from `_inject_meta.mjs`'s META_TPL (e.g. `og:site_name` vs `og:site-name`, double vs single quotes, different spacing). Don't auto-rewrite them in Step 3 — only add the 2 missing image lines. A separate cleanup PR could normalize all 23 to the META_TPL format, but that's out of scope.
- **`check:meta-tags` order in `npm run check`**: the chain is `check:syntax && check:manifest && check:bundle && check:automix-unit && ... && test-api.mjs`. Adding `check:meta-tags` between `check:bundle` and `check:automix-unit` is fine — it runs in <1s and has no node_modules or dist/ dependencies.
- **`_inject_meta.mjs` re-run after Step 3 fix**: if the diff shows the script trying to *replace* existing tags on the 3 hand-tagged pages (e.g. normalizing spacing), that's wrong. The script must only insert the 2 missing lines. Test by running `git diff versions/collage.html` after the re-run — expect 2-line insertion, not 14-line replacement.
- **music_video keyart redesign**: the music_video page has the gradient-panel/automix identity that's distinctly different from the other 19 GLSL variants. The keyart should reflect that. If a static 1200x630 PNG can't capture the "gradient anchors + audio-reactive depth" idea, render a stylized anchor-map with 19 dots scattered across the canvas — that's the visual signature of the page.

## Out of scope

- Normalizing the meta-tag format across all 23 pages to META_TPL (some are hand-edited, some are auto-generated — they differ in spacing and minor keys). Ship a separate cleanup PR if it matters.
- Adding OG meta tags to non-version pages (`landing.html`, `engine.html`, `personas.html`, `weddings.html`, etc.) — those already have them (verified per spot-check). The 4-page gap is contained to `versions/*.html`.
- Adding a `<meta name="theme-color">` audit (3 hand-tagged pages already have it; not all 23 do).
- Replacing the existing 19 PNGs with a more uniform visual style — they're a mix of styles from different generations; that's fine for now.
- Generating alt-text for the keyart images — `landing.html:17` has `og:image:alt` set but no `versions/*.html` does. Could be a follow-up plan.
