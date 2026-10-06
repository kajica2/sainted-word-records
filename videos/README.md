# Videos

MP4s that ship with the site (copied to `dist/videos/` by vite's `dirs` list).

**Homepage demos** — `landing.html`'s "Flip through the renders" gallery:
`stage.mp4`, `meadow.mp4`, `lights.mp4` (+ `.jpg` poster frames). They are
real engine renders, transcoded for the web from the originals:
1024 px wide, 24 fps, H.264 CRF 31, AAC 80 kbps, `+faststart`, with the poster
cut at 1 s — the same poster-frame rule the apps use for uploaded clips
(`lib/media-store.client.js`). The source WebMs came out of MediaRecorder with
no duration in their header, which is why the browser showed no seek bar; the
MP4 transcode fixes that.

**Gallery placeholders** — `neon.mp4`, `grid.mp4`, `film.mp4` are still the
small placeholder clips used by `versions/music-video-gallery.html`.
Filenames there must match that page's references.
