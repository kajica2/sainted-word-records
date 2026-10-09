# SIMPLE · SWR

Minimal audio-reactive spectrum visualizer — drop a song, get a spectrum.

**Live:** https://sainted-word-records.vercel.app/versions/simple

---

## Features

### Audio
- **64-band spectrum** with HSL coloring (purple → pink → yellow)
- **Waveform overlay** (semi-transparent, center)
- **Beat / onset detection** with damped envelope followers
- Works with any browser-supported audio format (mp3, wav, aac, ogg, etc.)

### Controls

#### Header
| Control | Description |
|---------|-------------|
| **Load** | Open file picker for audio |
| **▶** | Play / Pause (disabled until a song loads) |
| **0:00 / 0:00** | Current time / total duration |
| **Meter** | 5-band spectrum mini-display (bass, mid, treble, air, rms) |
| **beat / onset LEDs** | Flash with detected beat and onset events |
| **Rec format** | MP4 auto · MP4 · WebM |
| **Rec FPS** | 24 · 30 · 60 frames per second |
| **Rec duration** | manual · 15s · 30s · 60s · song |
| **● REC** | Start / stop recording |
| **⚙** | Open branding options |

#### Footer
| Slider | Range | Default | Description |
|--------|-------|---------|-------------|
| **sens** | 0.20 – 3.00 | 1.20 | Sensitivity multiplier for all audio features |
| **gate** | 1.05 – 2.50 | 1.40 | Beat gate threshold (higher = less sensitive) |
| **decay** | 0.50 – 0.99 | 0.85 | Envelope decay speed (higher = slower falloff) |

---

## Keyboard Shortcuts

| Key | Action |
|-----|--------|
| `Space` | Play / Pause |
| `?` | Toggle this help overlay |

---

## Branding Modal

Click **⚙** to toggle the **SWR watermark** on/off. When enabled, a small SWR monogram appears in the bottom-right corner of the canvas and is embedded in recordings.

---

## Recording

Recordings are saved as `simple-YYYY-MM-DDTHH-MM-SS.mp4` (or `.webm`). The canvas animation and audio are captured together via `MediaRecorder` + `captureStream()`.

- **Auto-stop:** If a duration is selected (15s / 30s / 60s / song), recording stops automatically.
- **Manual:** Select `manual` for unlimited recording — stop manually with the REC button.

---

## Responsive

At ≤ 720px the header and footer wrap, and the spectrum meter shrinks. At ≤ 480px the header uses compact icon-style buttons.

---

## Architecture

- **Self-contained** — no external JS dependencies, runs entirely in the browser
- **Web Audio API** — `AnalyserNode` with FFT size 256, smoothing 0.75
- **Canvas 2D** — hardware-accelerated spectrum + waveform rendering
- **~12 KB** total (HTML + inline CSS + inline JS)
