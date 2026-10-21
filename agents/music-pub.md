# Music Pub

**URL:** https://github.com/kajica2/music-pub  
**Status:** Public repository

---

## What It Is

Real-time audio visualization with 3D rendering and CD Baby integration.

## Features

- **Web Audio API**: Real-time FFT analysis with frequency band separation (Bass, Mid, High)
- **3D Rendering**: React Three Fiber with 60fps target, GPU-accelerated
- **Layer System**: Background video, 3D models, and image overlays
- **CD Baby Integration**: OAuth authentication and data synchronization

## Project Structure

```
music-pub/
├── apps/web/              # Next.js 14 App Router application
├── packages/
│   ├── audio/           # Audio analysis utilities and hooks
│   └── cdbaby/         # CD Baby API types and schemas
└── docs/                # Documentation
```

## Tech Stack

- Next.js 14
- React Three Fiber
- Web Audio API
- Supabase
- CD Baby API
- pnpm workspaces

## For SWR

This is related to audio/music workflow. Can integrate with:
- Digital twin audio processing
- SWR engine audio analysis
- Artist distribution/royalty tracking via CD Baby
