# Sainted Word Records — Launch Submission

**Tagline:** Drop a song. Drop a library. Get a music video.

**One-liner (60 chars):** Audio-reactive music video engine in the browser.

## What it is

Sainted Word Records is a single-page web app that turns any audio track into a layered music video. You load a song, drop in a folder of clips/images/GIFs, and the app's audio engine analyzes the signal in real time (bass, mids, treble, beats, onsets) and drives a composition of your assets — scale, position, rotation, opacity, hue, blend modes, all reactive.

The whole thing runs in the browser. No upload, no install, no server. Export the result as MP4 directly from the page.

## Who it's for

- **Musicians** who want a visual for a release without paying $200+ for a video editor or waiting on a friend.
- **DJs and live performers** who want a reactive visual layer behind their set.
- **Vibe-coding builders** who want a generative engine that listens, not a fixed preset.

## Differentiators

- **Audio-reactive engine, not a slideshow.** Layers pulse on beats, drift on mids, shimmer on treble, and the BPM detector locks the visuals to the song's tempo.
- **Five curated visual presets** (Pulse, Drift, Strobe, Warp, Mosh) — pick a mood, the engine picks the reactors.
- **Wizard mode** — loads a song, samples 8 seconds of audio, classifies the vibe (techno, jazz, dnb, ambient, lo-fi, classical, rock), and applies the matching preset + temperature + mutation automatically.
- **GLSL post-process** — temperature tint, six mutation algorithms (vortex, glitch, liquid, kaleidoscope, ripple, chromatic noise) running on the GPU.
- **Auto-swap Web Worker** — off-thread timer that swaps in a new clip every 5–10 seconds so the visuals keep moving while you focus on the music.
- **MP4 export** — WebM/MP4 record straight from the canvas + audio mix.

## How to try it

1. Open https://sainted-word-records.vercel.app/landing.html
2. Click **OPEN ENGINE**
3. Drop a song file
4. Drop a folder of clips (or use the seeded library)
5. Hit play

No login, no signup, no install. Works offline once loaded.

## Links

- **Live demo:** https://sainted-word-records.vercel.app/
- **Marketing page:** https://sainted-word-records.vercel.app/landing.html
- **30-second how-to:** https://sainted-word-records.vercel.app/interactive-howto.html
- **Market study:** https://sainted-word-records.vercel.app/market-study.html
- **Source:** https://github.com/kajica2/rnn (monorepo, sainted-word-records/ subdirectory)
- **Open Graph image:** https://sainted-word-records.vercel.app/og.png

## Tech

Single-file Vite + vanilla JS + Web Audio API + WebGL fragment shader. 51 KB bundle. No framework dependencies.

## Pricing

Free. No paid tier yet.

## Categories (suggest)

- Music & Audio
- Video & Animation
- Generative AI
- Design Tools
- Developer Tools

## Maker

Kai Djuric. Solo developer. Email: kajicadjuric at the usual domains.

## Assets for the submission

- **Hero / OG image (1200×630):** https://sainted-word-records.vercel.app/og.png
- **Full-page screenshot (1440×4794):** `landing-full.png` (in repo)
- **Light + dark screenshots:** `landing-light.png`, `landing-dark.png`
- **Catalog views:** `landing-catalog.png`, `landing-catalog-dark.png`
- **30-second how-to walkthrough:** `interactive-howto.html`

## Submission form fields (copy/paste ready)

**Name:**
Sainted Word Records

**Tagline:**
Drop a song. Drop a library. Get a music video.

**Short description (160 chars):**
Audio-reactive music video engine. Drop a song, drop a folder of clips, and the browser turns it into a layered composition that breathes with the music. MP4 export.

**Long description:**
Sainted Word Records is a browser-based audio-reactive video engine. You load a song, drop in a folder of clips and images, and the audio signal becomes the score — bass, mids, treble, beats, and onsets drive a layered composition of your assets. Layers pulse on beats, drift on mids, shimmer on treble, and the BPM detector locks the visuals to the song's tempo. Pick a visual preset (Pulse, Drift, Strobe, Warp, Mosh) or let the Wizard classify the song's vibe and pick for you. Temperature tint, six GPU mutation algorithms (vortex, glitch, liquid, kaleidoscope, ripple, chromatic noise) all run in a single WebGL fragment shader. Export the result as MP4 directly from the page. Single-file Vite + vanilla JS + Web Audio API + WebGL. No framework. 51 KB bundle. No login, no signup, no install. Free.

**Demo URL:**
https://sainted-word-records.vercel.app/

**Maker:**
Kai Djuric

**Topics / tags:**
audio-reactive, music-video, web-audio, webgl, generative, video-engine, mp4-export, music, creative-tools