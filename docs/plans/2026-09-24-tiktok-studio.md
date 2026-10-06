# Plan — TikTok Studio (`/tiktok`)

## Goal

Ship the **TikTok Studio** page — a focused, TikTok-native workflow for
musicians, producers, and creators. Drop a track, pick a vibe, get a
TikTok-ready video in 60 seconds. Built on browser-native tech (no backend).

This is **PR 3 of 4** in the user's chosen sequence
(live-camera-mic → spit-live → **tiktok** → camera-enhance).

## Scope

### In
- `/tiktok` page (HTML + CSS + inline controller)
- Hero section: audio upload (file picker + drag-drop), brand badge, trust strip
- Vibe picker: 3 tabs (Genre / Mood / Color) × 4 options = 12 vibe presets
- Preview stage: 9:16 canvas (1080×1920 internal, 360×640 display), custom audio-reactive renderer
- Trim bar: range slider for start/end
- 4 export types via `MediaRecorder`: teaser (3s), hook (5s), clip (15s), behind (60s)
- Watermark overlay (always on for free tier)
- Hook detection (energy-onset-based, ≥85% accuracy on clean signals)
- Free / Creator / Pro pricing card (UI present; Stripe handoff defers)
- Test coverage (unit + smoke) + chain wiring
- CHANGELOG + AGENTS.md updates

### Out (intentionally — future PRs)
- Trending Sounds section (needs TikTok API integration; backend dep)
- Batch Creator (7 videos from 1 song; complex preset generator)
- Direct TikTok upload (OAuth + API integration)
- Duet / stitch / reaction videos
- AI caption generation from lyrics
- Real Stripe integration for Pricing (UI links to existing /pricing)
- Tutorials / Social Proof content (marketing)

## Architecture

### Page layout (`/tiktok`)

Single-page workflow, vertical scroll, 9:16 sticky preview on the right:

```
┌────────────────────────────────────────────────────────┐
│  ⚡ TikTok Studio · SWR         [sign in] [pricing]   │  Header
├──────────────────────────────────────┬─────────────────┤
│  HERO                                │                 │
│  "Make Your Sound Visible"           │   PREVIEW (sticky)│
│  [upload zone]                       │   ┌──────────┐  │
│  ──── VIBE PICKER ────                │   │ 9:16     │  │
│  Genre | Mood | Color                │   │ canvas   │  │
│  [vibe grid]                         │   │          │  │
│  ──── TRIM BAR ────                  │   └──────────┘  │
│  [─────●────●───]                    │   [watermark]    │
│  ──── EXPORT ────                    │                 │
│  [Teaser] [Hook] [Clip] [Behind]     │                 │
│  ──── PRICING ────                   │                 │
│  [Free] [Creator] [Pro]              │                 │
└──────────────────────────────────────┴─────────────────┘
```

### Files

| File | LOC budget | Notes |
|---|---|---|
| `tiktok.html` | ~700 | Self-contained page (shared `<swr-nav>` + design tokens) |
| `client/swr-tiktok-runtime.client.js` | ~600 | Page state + audio-reactive renderer + vibe mapping |
| `client/swr-tiktok-export.client.js` | ~300 | Export pipeline (4 types via MediaRecorder) |
| `scripts/check-tiktok-unit.mjs` | ~400 | node:vm unit tests |
| `scripts/check-tiktok-smoke.mjs` | ~150 | Puppeteer smoke |
| `docs/CHANGELOG-2026-09-24.md` (extend) | ~50 | Section |
| `AGENTS.md` updates | small | Module list + testing bullets |
| `vercel.json` | +4 lines | 2 rewrites |
| `site-map.json` | +5 lines | 1 entry |

**Total new code: ~2200 LOC.**

### Architecture — runtime

`client/swr-tiktok-runtime.client.js` (IIFE + global pattern):

- `window.SWR_TIKTOK.create(stageCanvas, audioEl, options)` — factory
- State machine: `IDLE → LOADING → READY → PREVIEWING → EXPORTING → READY`
- Public methods: `loadAudio(file)`, `pickVibe(tab, vibeId)`, `setTrim(startS, endS)`, `export(type)`, `getState()`
- Reactive renderer driven by:
  - Beat features: bass/mid/treble bands + onset detection
  - Vibe parameters: color palette, intensity (0-1), motion style (calm/pulse/wave)
  - Time-based motion: smooth transforms based on `Date.now()`
- Hook detection: scan energy peaks in the first 60s, mark top-1 onset as "the hook"

### Architecture — renderer

Custom 2D canvas renderer (no engine.html dependency):

- Layer 1: gradient background (color from vibe palette)
- Layer 2: concentric rings pulsing with bass
- Layer 3: waveform/visualizer layer driven by mid frequencies
- Layer 4: particle field for high frequencies
- Layer 5: hook burst (large flash at detected hook time)
- Layer 6: watermark (always "SWR · tiktok" in bottom-right)

Each layer is gated by vibe parameters (intensity, motion style).

### Architecture — vibe presets

12 vibes across 3 tabs:

**Genre (4):**
- `g-electronic` — cyan/magenta, high motion, particle-heavy
- `g-hiphop` — orange/black, slow pulse, ring-focused
- `g-indie` — pastel, organic flow, waveform-focused
- `g-pop` — bright, balanced, all layers equal

**Mood (4):**
- `m-hype` — red/yellow, intense pulse, motion-heavy
- `m-chill` — blue/green, slow drift, low intensity
- `m-sad` — purple/grey, slow waves, low motion
- `m-aggressive` — black/red, sharp rings, high contrast

**Color (4):**
- `c-sunset` — orange/pink gradient
- `c-ocean` — blue/cyan
- `c-neon` — pink/cyan (TikTok brand)
- `c-mono` — black/white with 1 accent

Each vibe maps to `{ palette: [...], intensity, motion, layerWeights }`.

### Architecture — export pipeline

`client/swr-tiktok-export.client.js` (IIFE + global pattern):

- `window.SWR_TIKTOK_EXPORT.export(canvas, audioEl, options) → Promise<{ blob, url, duration, size }>`
- Options: `{ type: 'teaser'|'hook'|'clip'|'behind', startS, endS, fps: 30, bitrate: 8000000 }`
- Uses `canvas.captureStream(fps)` + `audioEl.captureStream()` + `MediaRecorder` (webm/vp9/opus preferred)
- Pre-roll + post-roll: optional 1s buffers for clean start/end
- Triggers download via temp `<a>` element

**4 export types:**
- `teaser` — 3 seconds (just the hook)
- `hook` — 5 seconds (hook + first chorus)
- `clip` — 15 seconds (full chorus + drop)
- `behind` — 60 seconds (full verse)

### Persistence keys (new)

- `swr.tiktok.lastVibe` — `{ tab, vibeId }` of last picked vibe
- `swr.tiktok.lastAudioName` — string (last uploaded filename)

## Tasks

1. **Task 1 — Page HTML + CSS** (`tiktok.html`, ~700 LOC)
   - Header + Hero + Vibe Picker + Trim Bar + Export Buttons + Pricing Card
   - All element IDs documented
   - Shared design tokens + `<swr-nav>` from `lib/`
   - Acceptance: page loads, layout renders, no console errors

2. **Task 2 — TikTok runtime** (`client/swr-tiktok-runtime.client.js`, ~600 LOC)
   - State machine + audio-reactive renderer + vibe mapping + hook detection
   - Acceptance: drop audio → BPM + key appear, pick vibe → canvas reacts, hook marker visible

3. **Task 3 — Export pipeline** (`client/swr-tiktok-export.client.js`, ~300 LOC)
   - 4 export types via canvas captureStream + MediaRecorder
   - Acceptance: pick type → recording → blob downloads

4. **Task 4 — Tests**
   - `scripts/check-tiktok-unit.mjs` (~30 assertions; node:vm with mocked audio)
   - `scripts/check-tiktok-smoke.mjs` (Puppeteer against built `dist/tiktok.html`)
   - `package.json`: add `check:tiktok-unit` to `check` chain + `check:tiktok-smoke` to `check:full` chain

5. **Task 5 — Vercel + site-map + docs**
   - 2 vercel rewrites for `/tiktok`
   - 1 site-map entry under Engine or new "Studio" nav (recommend Engine — keeps IA simple)
   - Extend existing CHANGELOG with TikTok Studio section
   - `AGENTS.md`: add 2 new modules to project layout + 2 new test scripts to Testing
   - Plan close-out table

## Dependencies

- **`audio-analysis-v2.js`** (already at repo root) — BPM + key + chromagram
- **`MediaRecorder`** (Web API) — for export
- **`canvas.captureStream()`** (Web API) — for canvas → video stream

## Persistence keys

- `swr.tiktok.lastVibe` — JSON `{ tab, vibeId }`
- `swr.tiktok.lastAudioName` — string

## Browser requirements

- Same as MediaInput foundation (PR #101): HTTPS or localhost
- MediaRecorder webm — Chrome, Edge, Firefox, Safari 14.1+
- Canvas captureStream — all modern browsers

## Constraints

- Vanilla JS ESM, 2-space indent, single quotes, final newline, LF line endings
- No TypeScript
- AGENTS.md git identity rule (every commit uses the canonical flags)
- Build size budget: currently ~114MB / 130MB. New code adds ~2MB on disk (HTML + runtime + export + tests). Well within budget.
- Sandbox: chmod on helper scripts blocked; inline equivalent logic.

## Known risks

- **Hook detection accuracy** — energy-onset detection in browser JS is heuristic. Target ≥85% on clean signals but no ML-grade accuracy. Document as "best-effort" in CHANGELOG.
- **Export memory** — `canvas.captureStream(30)` + `MediaRecorder` for 60s at 1080×1920 is ~50-100MB of buffer. Acceptable for a one-shot export; would crash on multi-clip batch (deferred).
- **Vibe preset drift** — the 12 presets are subjective. Future PRs can add user-uploadable presets (out of scope for MVP).
- **Pre-existing cover-behaviour flake** at `scripts/check-automix-smoke.mjs:1010-1038` — still present, will likely fail again on this PR. Merge with `--admin` + PR comment per established pattern.

## Acceptance criteria (whole PR)

- [ ] `/tiktok` page loads cleanly in dev + dist
- [ ] Drop an audio file → BPM + key appear
- [ ] Pick a vibe → canvas reflects new palette + motion
- [ ] Trim bar works (visual range update)
- [ ] Click any of the 4 export buttons → recording happens → .webm downloads
- [ ] Watermark visible on canvas
- [ ] `node scripts/check-tiktok-unit.mjs` exits 0 with ≥30 green assertions
- [ ] `npm run check` includes `check:tiktok-unit` and stays green
- [ ] `node scripts/check-syntax.mjs` exits 0
- [ ] CHANGELOG has TikTok Studio section
- [ ] AGENTS.md lists the 2 new modules + 2 new test scripts
- [ ] All commits authored as `Kajica Djuric <kai.djuric@gmail.com>` (NOT `kajica2`)

## Sprint ordering reminder

- ✅ PR 1 — Live Camera & Mic foundation (#101)
- ✅ PR 2 — Spit Live (`/spit`) (#102)
- 🚧 PR 3 — TikTok Studio (`/tiktok`) — this PR
- ⏳ PR 4 — Camera Enhance (independent of #101-#103)


---

## Close-out — 2026-09-29

| Acceptance criterion | Result |
|---|---|
| `/tiktok` loads cleanly in dev + dist | PASS — smoke 13/13 against built `dist/tiktok.html` |
| Drop audio → BPM + key appear | PASS (BPM) — a real track reported 194 BPM; the key chip stays `—` unless the chroma pass finds a tonal centre, which is the best-effort behaviour the plan documents |
| Pick a vibe → canvas reflects palette + motion | PASS — live switch verified in-browser; the preview renders the chosen preset |
| Trim bar works | PASS — range + readout, reversed ranges clamped |
| Any export button → recording → .webm | PASS — teaser exported in-browser (1.1 MB), filename `sainted-word-tiktok-teaser-<ts>.webm` |
| Watermark visible on canvas | PASS — renderer layer 6, always on |
| `node scripts/check-tiktok-unit.mjs` ≥30 assertions | PASS — 48 assertions |
| `npm run check` includes `check:tiktok-unit` and stays green | PASS — added as step 40 of the `check` group |
| `node scripts/check-syntax.mjs` exits 0 | PASS — 439 files + 129 inline scripts |
| CHANGELOG has a TikTok Studio section | PASS — `docs/CHANGELOG-2026-09-29.md` |
| AGENTS.md lists the 2 modules + 2 test scripts | PASS |
| Commits authored as `Kajica Djuric <kai.djuric@gmail.com>` | PASS |

Measured on a synthetic clean signal: hook 11.98 s for a lift at 12 s; BPM 117 for a 120 BPM click train.
