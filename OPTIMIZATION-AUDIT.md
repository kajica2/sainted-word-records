# Sainted Word Records — Target-user optimization audit

Date: 2026-08-24
Author: Hermes (optimization pass)

## Target users (post-pivot)

| Persona | What they want | How the engine serves them now | Gap |
|---|---|---|---|
| **Graphic designer** | Animated typography, brand kits, motion graphics, social clips | 13 engines (neon, glitch, etc.) — all are "music-video" flavored, none are brand/typography-led | **No typography engine**. No way to import brand assets. No way to export a 15-second Instagram story. No templates. |
| **Media / motion designer** | Cinemagraphs, music-driven loops, typographic posters in motion | 4 cinematic engines (film, hallucination, watercolor, void) — strong core | **No motion-graphics library**. No timeline editor (only real-time). No "still + motion" hybrid export. |
| **Musician** | Music video for their track | 13 engines, all aimed here | Strong. But: no sharing, no collaboration, no way to sell a finished video. |
| **VJ / live performer** | Real-time reactivity for a set | Recording + reactivity works | **No MIDI / OSC input**. No Ableton Link. No setlist mode. |

## What exists today

- 13 engine presets in `versions/`, each rendered on a `<canvas>` + a WebGL post-process pass
- 23 "personas" in `landing.html` (musicians, labels, podcasters) — listing is long and undifferentiated
- `versions-presets.js` is a per-engine GLSL preset dictionary (1 preset per page)
- `engine-lfos.client.js` (newer) — adds per-layer LFOs/modulators
- `engine-automap.client.js` (newer) — per-engine auto-map recipes
- `engine-settings.client.js` (newer) — ⚙ dropdown
- `engine-timeline.client.js` (newest, just landed) — beat-marker strip
- `engine-keys.client.js` (newest) — keyboard shortcuts
- Library (IndexedDB) stores songs + assets
- Recording: MP4/WebM export with canvas + audio
- Audio: bass/mid/treble/beat/centroid/BPM/key features
- LFO: 9 modulator modules, 13 engine pages wired
- Auto-map: per-engine recipe → reactor + LFO attachments
- Settings: panel visibility toggles, per-engine auto-map
- Timeline: waveform + beat-marker strip
- Keys: keyboard dispatcher

## What's missing for the target pivot

### 1. `.swr-set` import / export

The biggest gap. A "set" = a packaged music video recipe: song + engine + FX state + layer arrangement + reactor/LFO bindings. Today none of this is shareable except as a screen recording.

Format proposal:
```json
{
  "version": 1,
  "name": "Synthwave Sunset",
  "author": "Kai",
  "description": "Neon-style synthwave with pink/orange gradient and slow LFO hue drift",
  "engine": "neon",
  "audioUrl": "songs/loop-demo.wav",
  "fx": { "temp": 0.3, "glow": 0.85, "vignette": 0.5, "chroma": 0.2, "grain": 0.15, "sepia": 0.1, "blur": 0.05, "posterize": 0, "grayscale": 0, "liquid": 0, "pearl": 0, "glitch": 0, "mut": 0, "mutAlgo": 0 },
  "layers": [ { "name": "Hero", "assetUrl": "...", "reactorScales": { ... }, "modulators": [ ... ] } ],
  "metadata": { "createdAt": "...", "tags": ["synthwave", "neon", "80s"] }
}
```

### 2. Marketplace surface

Need a `marketplace.html` that:
- Lists featured / curated `.swr-set` files
- Lets the user upload a `.swr-set` to import (FileReader → state restore)
- Shows "Installed Sets" (from IndexedDB)
- v1: no payments, no upload-to-server, no auth. v2: actual marketplace.

### 3. Persona selector in onboarding

Replace the current "drop a song" hero with 3 paths:
- **I'm a musician** → load song, pick engine, get music video
- **I'm a designer** → upload brand assets + audio, get motion graphics
- **I'm both** → mixed-media: video clips + typography + audio

Each path picks the right default engine and shows a relevant demo loop.

### 4. New engines for designers

- **typography** — animated text, brand-safe, low-motion (for IG stories)
- **spectrum** — pure audio-reactive visualizer (no footage, no library needed) — good for musicians who don't have clips
- **collage** — multi-layer split-screen, magazine layout feel

These are 3 of 13 = +23% catalog. Worth it because designers and musicians are the explicit target.

### 5. Positioning copy

Current copy is 80% musician-focused. New copy needs to:
- Lead with the engine's flexibility (drop in *anything* — song, footage, type, brand kit)
- Show 3 use cases up front: music video, motion graphic, social clip
- Shorter, more visual

## Plan (the 7 todo items)

1. ✓ Audit (this doc)
2. Add 3 new engines: typography, spectrum, collage
3. Build `.swr-set` export + import
4. Persona selector in onboarding (3 paths)
5. Marketplace page (browse, install, installed)
6. Reposition landing + campaign copy
7. Build, smoke-test, push

## Out of scope (explicit)

- Real auth / payments / Stripe Connect (would need a backend, weeks of work)
- Server-side file storage (v1 uses file:// imports)
- Live collaboration (would need WebRTC + presence)
- MIDI / OSC / Ableton Link (VJ market — separate audit)
- Mobile app wrapper (PWA install already works)

## Success criteria

- A graphic designer can drop a PNG + an audio file and get a 15-second brand clip in <2 minutes
- A musician can save a finished video as a `.swr-set` and a friend can import it on a different machine
- A mixed-media user can find a curated set for their genre in the marketplace and have it running in 1 click
- The 3 user types can each see the engine do something useful for them within 30 seconds of landing
