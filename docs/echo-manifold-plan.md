# ECHO Manifold — port plan

## TL;DR

Port the Gemini-shared "Harmonic Manifold 5.0 (Definitive)" / ECHO engine into
the SWR repo as a new variant at `versions/echo-manifold.html`. It's a
**standalone, WebAudio-only** generative engine (no media library, no timeline,
no library) with 9 sections × ~30 "formulas", 5 generative modes (Eno, Euclid,
Chaos, Phi, Cellular), and a Canvas2D visualizer. Ships as a single HTML
file with the audio + draw code inlined.

## What I will and will not do

**Will:**

- Copy the JS engine code from `/Users/kaidejuricmasscmbook/.hermes/cache/spillover/canvas.html` **verbatim** — 1,295 lines of working audio synthesis + 30 visualizer branches.
- Strip the two CDN deps: `cdn.tailwindcss.com` script + Google Fonts `@import`. AGENTS.md forbids CDN deps.
- Hand-author the ~40 unique Tailwind utility classes the file uses as a static `<style>` block. Use system fonts: `system-ui, -apple-system, ...` for Inter, `ui-monospace, SFMono-Regular, Menlo, ...` for JetBrains Mono.
- Keep the Tailwind class names in the HTML (so the visual diff is zero). I just need the class definitions to be local instead of via the CDN.
- Add a **small "back to SWR" link** in the header so visitors can navigate out — non-destructive, additive.
- Ship via the existing `versions/`-copy path in `vite.config.js` (already covers `dirs: [{ src: 'versions', dst: 'versions' }]`, line 194).
- Add a `vercel.json` rewrite: `/echo-manifold` → `/versions/echo-manifold.html`.
- Add the new variant to the `versions.html` style-card grid so it's discoverable.
- Verify: `npm run check:syntax`, `curl localhost:5174/versions/echo-manifold.html` after dev server start, Puppeteer smoke (load → enter button → arrow-key cycle).

**Will NOT (without explicit ask):**

- Touch the 5 generative mode algorithms, the audio routing, or the visualizer branches. The brief is a working engine; "porting verbatim" means keeping the math and the audio graph intact.
- Wire it into the SWR library system, timeline, recording, or audio-analysis-v2. The brief is explicitly standalone (no media library required).
- Add a fancy landing page or marketing surface. The engine IS the page.
- Run the same engine at the project root in addition to `versions/`. One location unless the user asks.
- Modify `AGENTS.md`.

## Phase 1 — port the engine file

File: `versions/echo-manifold.html` (~1,800 lines estimated).

- Single `<style>` block with the 30+ Tailwind utilities the file uses (I scanned: `flex`, `flex-col`, `items-center`, `justify-center`, `justify-between`, `gap-N`, `p-N`, `m-N`, `w-N`, `h-N`, `text-[Npx]`, `tracking-[Nem]`, `uppercase`, `rounded`, `rounded-full`, `rounded-2xl`, `border`, `border-white/N`, `bg-white/N`, `bg-cyan-N`, `bg-black/N`, `text-cyan-400`, `text-slate-N`, `text-purple-N`, `text-red-N`, `text-yellow-N`, `text-green-N`, `transition-all`, `hover:...`, `active:scale-90`, `hidden`, `fixed`, `inset-0`, `pointer-events-none`, `z-[N]`, `absolute`, `relative`, `animate-spin`, `animate-pulse`, `animate-ping`, `animate-[spin_Xs_linear_infinite]`, `selection:bg-cyan-500/30`, `bg-drift`, `glass`, `mono`, `text-glow`, `custom-scrollbar`, `formula-pulse`, `node-active`, `nav-btn`, `gen-eno`, `gen-euclid`, `gen-chaos`, `gen-phi`, `gen-cell`, `modal-closed`).
- Keep the original `@keyframes drift` + the `.bg-drift` class.
- System fonts only.
- Add a single `<a href="/" class="back-link">← SWR</a>` chip in the header (top-left, before "COSMIC TUNE") so a deep-link visitor can leave. Style: matches the existing glass aesthetic.

Verification:

```bash
node --check <(awk '/<script>/{f=1; next} /<\/script>/{f=0} f' versions/echo-manifold.html)   # syntax check on the inline JS only
npm run check:syntax                                                                       # full repo integrity
curl -sI http://127.0.0.1:5174/versions/echo-manifold.html                                # dev server serves it
```

## Phase 2 — wire it into the variant surface

Three changes, all additive:

1. `vercel.json` — append two rewrite entries (no trailing slash variants, matching the pattern of `/ar-loop` at line 19-26):
   ```json
   { "source": "/echo-manifold", "destination": "/versions/echo-manifold.html" },
   { "source": "/echo-manifold/", "destination": "/versions/echo-manifold.html" }
   ```

2. `versions.html` — add one `<a class="style-card" href="/versions/echo-manifold.html">` entry to the style grid (look at lines 524/564/574 for the existing pattern). New card: title "ECHO · Manifold 5.0", tagline "Generative audio · 30 formulas · 5 modes".

3. `vite.config.js` — **no change needed**. The `dirs: [{ src: 'versions', dst: 'versions' }]` entry at line 194 already copies every file in `versions/` recursively. The new file will ship to `dist/versions/echo-manifold.html` automatically.

Verification:

```bash
node -e "JSON.parse(require('fs').readFileSync('vercel.json','utf8'))"   # valid JSON
npm run check:full                                                      # full pre-PR gate (slow)
# OR if user wants fast: npm run check
```

## Phase 3 — browser smoke test

A small `verify-echo-manifold.mjs` (Puppeteer) at the repo root, following the existing pattern in `verify-ar-loop.mjs`. Steps:

1. Boot the dev server (`npm run dev`, port 5174).
2. Navigate to `http://127.0.0.1:5174/versions/echo-manifold.html`.
3. Wait for `#intro-overlay` to be visible (intro shows after 2s loading).
4. Click `#enter-btn`. Confirm `AudioContext.state === 'running'` via `page.evaluate`.
5. Press `ArrowRight` 3 times. Confirm `#viz-title` text changes 3 times.
6. Click `#gen-mode-btn` 3 times. Confirm the icon cycles from `○` → `∞` → `◴` → `@` and the button's class picks up `gen-eno`, `gen-euclid`, `gen-chaos` respectively.
7. Take a screenshot of the canvas after 3 seconds of playback — visually confirm there's something drawing on the canvas (sample a pixel via `page.evaluate(() => ctx.getImageData(0,0,1,1).data)` and assert any of R/G/B is non-zero).
8. Wire as `npm run verify:echo-manifold` in `package.json`.

Pass criteria: 7/7 checks pass. The verify script should print `(env skip: ...)` and exit 0 if Puppeteer's bundled Chromium is unavailable on the host (matching the `verify-hf-publish` pattern at line 36 of `package.json`).

## Phase 4 — commit

Single commit, conventional format, with the exact path list (per `code-work-defaults` rule 13):

```bash
git -c user.name="Kai Djuric" -c user.email="kai.djuric@gmail.com" \
  add versions/echo-manifold.html vercel.json versions.html package.json verify-echo-manifold.mjs docs/echo-manifold-plan.md
git diff --cached --stat                          # confirm only my files
git -c user.name="Kai Djuric" -c user.email="kai.djuric@gmail.com" \
  commit -m "feat(echo-manifold): port ECHO/Harmonic Manifold 5.0 standalone engine

Verbatim port of the Gemini-shared ECHO generative audio engine (30
formulas across 9 sections, 5 generative modes: Eno/Euclid/Chaos/Phi/
Cellular). Standalone — no media library required.

- versions/echo-manifold.html: port, inlined Tailwind utilities +
  system fonts (no CDN, per AGENTS.md)
- vercel.json: /echo-manifold → /versions/echo-manifold.html rewrite
- versions.html: add style-card entry
- verify-echo-manifold.mjs: Puppeteer smoke test
- docs/echo-manifold-plan.md: this plan"
```

Per `code-work-defaults` rule 14, I do not edit `AGENTS.md`. I do not push.

## Reversibility

Every change is additive. To revert:

```bash
git revert HEAD
```

No existing file is modified destructively (vercel.json, versions.html, and package.json are all append-only; the new file is brand-new).

## What ships

| File                                | Status   | Lines  |
|-------------------------------------|----------|--------|
| `versions/echo-manifold.html`       | NEW      | ~1,800 |
| `vercel.json`                       | +2 lines | +2     |
| `versions.html`                     | +1 card  | +12    |
| `verify-echo-manifold.mjs`          | NEW      | ~80    |
| `package.json`                      | +1 script| +1     |
| `docs/echo-manifold-plan.md`        | NEW      | this   |

## Open questions for after Phase 1

1. Does the engine's UI need a "back to SWR" link, or is the deep-link-only pattern fine?
2. The original uses 432Hz as a quasi-mystical anchor — any SWR voice concern? (My read: keep verbatim. It's a creative tool, not a science claim.)
3. Do you want a `keyart/echo-manifold.png` for the style-card thumbnail? (If yes, I can render a frame from the canvas via the same verifier.)
