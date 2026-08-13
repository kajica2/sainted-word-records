# Sainted Word Records

> **Audio-reactive video engine that lives in your browser.** Drop a song, drop a library of clips, get a music video. **23 personas, 20 CSS filters, local-first, zero backend, your-footage-driven.**

**🌐 Live:** [sainted-word-records.vercel.app](https://sainted-word-records.vercel.app/)

---

## TL;DR

| You want to | Use | Price |
|---|---|---|
| Make a music video from **your** song + **your** library | The engine (free, browser-native) | Free |
| Have someone **render it for you** (5 curated media sets) | [Service tier](./campaign.html#pricing) | €25 / €45 / €75 |
| Use the engine yourself, **no watermark**, with credits | [Personal Tier (PT)](./campaign.html#pt) | €120 / €280 / €600 (one-time) |

Pick one. Mix-and-match. The engine stays open-source under MIT.

---

## What is this?

A browser-native, library-driven, audio-reactive video engine for indie musicians, beatmakers, small labels, and live performers. The product exists because the current options for music-driven visuals split into three bad categories:

1. **Template tools** (Renderforest, VibeMV) — quick, generic, every visualizer looks the same
2. **AI tools** (Freebeat, Plazmapunk, Neural Frames) — novel footage, but not yours
3. **Pro VJ** (Resolume €799, TouchDesigner $600/yr, Notch $3,500/yr) — total control, 3-month learning curve

SWR is the **fourth category**: load **your** clips, drop in **your** song, the engine analyses the audio (BPM, key, beats, onsets, chromagram) and renders a **real-time reactive composition** with 23 persona presets, 5 character presets, and 20 stackable CSS filters. Output: WebM at 1080p (MP4 in v1.1).

The whole pipeline runs **locally in the browser** — no upload, no server render, no SaaS fees, no telemetry. The song and library are stored in **IndexedDB** and persist across reloads. **PWA-installable** on iOS, Android, and desktop.

---

## Try it (60 seconds)

1. Open the splash at [sainted-word-records.vercel.app](https://sainted-word-records.vercel.app/) → click **"Open the engine"** (or jump straight to [/engine/](https://sainted-word-records.vercel.app/engine/))
2. Click **LOAD SONG** → pick any MP3 / WAV / MP4
3. Library auto-loads with 27 demo clips (first visit only)
4. Click **▶ PLAY** + **RE-MAP** until you like the composition
5. Pick a duration: `10s / 15s / 30s / 60s / song`
6. Click **● REC** — auto-stops, downloads `sainted-word-{timestamp}.webm`

Done. Upload to YouTube, Spotify Canvas, TikTok, anywhere.

> The splash and the engine are **separate URLs** — splash at `/`, engine at `/engine/`. The PWA installs to `/engine/` so opening the installed app takes you straight to the studio.

---

## Pricing

### Service — I render for you
[Order at campaign.html →](./campaign.html#pricing)

| Tier | What you get | Price |
|---|---|---|
| Single | 1 curated set · 1 song · 30s render | **€25** |
| Double | 2 sets, A/B test | **€45** |
| Full Rotation | All 5 sets · 5 renders | **€75** |
| Custom Source | Your assets + 1 SWR set | **€55** |

48-hour delivery. Commercial rights. Founding customers (first 5) get 30% off.

### Personal Tier — engine for yourself
[Order at campaign.html →](./campaign.html#pt)

| Tier | Credits | Price | What you get |
|---|---|---|---|
| PT Solo | 50 | **€120** | Full engine · watermark removed · 1 year updates |
| PT Band | 150 | **€280** | + MP4 export (v1.1) · 2 years · priority support |
| PT Label | 500 | **€600** | + 4K vertical (v1.3) · 5 seats · Yugo pack · lifetime |

Credit-bank, not subscription. Credits never expire. Top up with another key anytime — credits stack.

---

## Features

- **Adaptive beat detection** — bass-energy tracker with adaptive threshold
- **Audio analysis v2** — zero-deps BPM (autocorrelation), key (Krumhansl-Schmuckler), chromagram, beat phase
- **23 personas** in 4 families: 10 original (RAW, POSTER, MASK, FX, FILTER, NEON, FILM, GRID, SMOKE, HALLUCINATION) + 5 generative (LIQUID GLASS, PEARL HAZE, CLUB STROBE, VHS VIBE, NEON WASH) + 5 MORPHA (ANCHOR, FLOW, FRACTURE, VOID, ECHO) + 3 Train-stages
- **14 WebGL FX** on a fullscreen quad: posterize, vignette, chroma, grain, sepia, glow, grayscale, blur, liquid, pearl, glitch, mut, mutAlgo, temp
- **20 stackable CSS filters** on the live stage: kenburns, pan-scan, mesh-warp, liquify, light-leak, film-grain, VHS, RGB-split, pixel-sort, CRT, hue-shift, kaleidoscope, zoom-pulse, camera-shake + 3 combos
- **Persistent library** (IndexedDB v2) — both `assets` (per-clip) and `songs` (current) stores. Survives reload.
- **MP4-as-audio source** — drop a video file, the engine extracts audio. No conversion.
- **PWA** — installable, offline, iOS splash screens, 4 PNG icons (192/512/maskable/apple-touch)
- **Watermark engine** — 3 concepts (monogram / wordmark / icon+text). Suppressed for PT users.
- **Layer scheduler** — per-layer rotate +90° + randomise, with `r` keyboard shortcut
- **Auto-swap (AUTO DRIFT)** — engine cycles assets/FX automatically
- **Per-clip library** — drag a folder of clips, auto-classify by motion/luma/hue

---

## Quick start (dev)

```bash
git clone git@github.com:kai-djuric/sainted-word-records.git
cd sainted-word-records
npm install
npm run dev   # http://localhost:5174
```

Or production build:

```bash
npm run build  # → dist/ (engine + 5 versions + 27-item library)
```

---

## Project structure

```
sainted-word-records/
├── engine.html               # The main engine (live, served at /engine/, ~32 KB)
├── landing.html              # Public landing page
├── campaign.html             # 17-section sales page with pricing
├── personas.html             # 23-persona gallery with family filter
├── library/                  # 27 demo assets (12 mp4 + 15 jpg/png)
├── versions/                 # 5 audio-reactive variants (neon, film, grid, smoke, hallucination)
├── fx-postprocess.js         # WebGL 14-FX pipeline
├── personas.js               # 23 personas as state
├── audio-analysis-v2.js      # Zero-deps BPM + key + chromagram
├── pt.client.js              # Personal Tier license + credit ledger
├── pt-panel.client.js        # PT activation UI
├── pwa-bootstrap.js          # PWA install + service worker registration
├── sw.js                     # Service worker (app shell precache)
├── manifest.webmanifest      # PWA manifest
├── offline.html              # Styled offline fallback
├── icons/                    # 4 PWA icons
├── verify-*.mjs              # 9 Puppeteer end-to-end test suites
├── output/                   # PRD research + audit reports
├── launch/                   # 5 launch docs (plan, dm-templates, social, stripe, watermark)
├── ROADMAP.md                # Current state + roadmap
└── output/prd.md             # Product Requirements Document v1.0
```

---

## License

MIT — see [LICENSE](./LICENSE).

## Author

**Kai Djuric** · [@kai-djuric](https://github.com/kai-djuric) · kai [at] saintedwordrecords [dot] com
