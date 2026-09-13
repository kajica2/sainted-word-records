# Music Video Next/Prev with Flip Transition

File: `versions/music-video-gallery.html`
Goal: Add Previous / Next buttons to flip through multiple music videos on a single page, with a 3D flip transition between them.

---

## How It Works

- One HTML page contains all music videos.
- Only one video is visible at a time.
- "Previous" and "Next" buttons flip between them with a 3D flip animation.
- Keyboard arrows (← / →) also work.
- Optional: swipe on mobile.

---

## Setup

1. Add `<source src="/videos/your-file.mp4" type="video/mp4" />` for each video you want to show.
2. Drop the MP4 files into `/videos/` (top-level repo directory, NOT `library/`).
3. The JS auto-detects how many `.music-video` sections exist and updates the counter.

Currently ships with three example sections: Neon, Grid, Film. Add or remove `<section class="music-video">` blocks as needed — filenames must match (e.g. `neon.mp4`, `grid.mp4`, `film.mp4`).

---

## Features

- **3D flip transition** via CSS `perspective: 1600px` and `rotateY` transforms
- **Direction-aware**: next flips in from the right, previous from the left
- **Keyboard navigation**: ← / → arrow keys
- **Touch swipe** on mobile (50px threshold)
- **Deep linking**: `#video-2` jumps to the second video
- **Auto-pause**: only the active video plays; others are paused and reset to 0
- **Reduced motion**: respects `prefers-reduced-motion: reduce`, falls back to fade

---

## CSS + JS

Both are inlined in `versions/music-video-gallery.html`:

- `<style>` block: stage layout, flip animation, nav bar styling, reduced-motion fallback
- `<script>` block (just before `</body>`): the `show(nextIndex, direction)` function that drives the flip

No external dependencies. No build step required — the file is served as-is from the repo root.

---

## URLs

- Local dev: `http://localhost:5174/versions/music-video-gallery.html`
- Production: `https://sainted-word-records.vercel.app/music-video-gallery` (Vercel rewrite)

---

## Troubleshooting

- **Both videos visible**: make sure each `<section>` has `class="music-video"` and only one has `is-active`.
- **No flip, only fade**: check that the parent has `perspective: 1600px`.
- **Page jumps height when flipping**: the `.is-active` video uses `position: relative` so it holds the height; non-active ones are `position: absolute`.
- **Video keeps playing after flip**: the `pauseAllExcept` helper handles it. If you added videos dynamically, re-run the setup.
- **Autoplay blocked**: browsers block autoplay with sound. Don't auto-play on flip unless muted.
- **Vercel clean URLs**: `/music-video-gallery` rewrites to `/versions/music-video-gallery.html`. Keep the path consistent with `vercel.json`.

---

## Deploy

The page is auto-shipped by `vite.config.js` (it picks up anything in `site-map.json` under `nav`/`footer`/`legal`/`tools`). The corresponding `/videos/` directory is also auto-copied.

```bash
git add versions/music-video-gallery.html videos/README.md site-map.json vercel.json
git commit -m "Add music video gallery with next/prev flip navigation"
git push
```

Vercel auto-deploys.
