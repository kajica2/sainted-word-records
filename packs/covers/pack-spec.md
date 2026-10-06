# Media Pack NFT Spec — auto-start audio + video, zipped, NFT-ready

Companion spec for `scripts/generate-media-pack.mjs`. Every pack is a self-contained
`.swr-set` (schema v2, media embedded as dataUrls) + a rendered video + cover +
animation + NFT metadata, zipped for download. Installing the zip whose `.swr-set`
lands in the user's Library with audio + video **auto-starting**.

## Pack anatomy (one ZIP per pack)

```
out/media-pack/<pack>/                     <-- generator output root
├── <pack>.swr-set.json                    schema v2; audio + video layers, dataUrl-embedded
├── <pack>.mp4                             rendered video (batch-video pipeline)
├── cover.webp                             1280x720, first frame of the render (ffmpeg -frames:v 1)
├── cover-anim.html                        packs/covers/hyperframe-cover.html?pack=<pack>&clips=N&audio=<track>
├── preview.mp3                            15s audio preview (ffmpeg -t 15)
├── nft-metadata.json                      ERC-721/1155-style metadata (below)
└── LICENSE.txt                            MIT — Kai Djuric, 2026 (repo LICENSE)
```

## NFT metadata shape (nft-metadata.json)

```json
{
  "name": "SWR Pack — <Pack>",
  "description": "10s HyperFrames cover + rendered video + auto-start audio/video .swr-set, MP4, cover, preview. Rendered by the SWR engine.",
  "image": "cover.webp",
  "animation_url": "cover-anim.html",
  "external_url": "https://sainted-word-records.vercel.app/packs.html",
  "attributes": [
    { "trait_type": "pack",           "value": "<pack id>" },
    { "trait_type": "clips",          "value": <clip count> },
    { "trait_type": "audio_track",    "value": <audio track count> },
    { "trait_type": "duration_sec",   "value": 10 },
    { "trait_type": "license",        "value": "CC0 media / MIT code" },
    { "trait_type": "price_usd",      "value": <tier price> }
  ],
  "properties": {
    "files": {
      "type": "application/zip",
      "uri": "<pack>.zip",
      "size": <zip bytes>
    },
    "authors": [
      { "name": "Kai Djuric", "role": "creator", "url": "https://github.com/kajica2" }
    ],
    "license": "CC0-1.0"
  }
}
```

## Author credits + licence

- **Author / creator:** Kai Djuric (repo global git user `kajica2 <kai.djuric@gmail.com>`).
- **Code (engine, generator, animation template):** MIT — `LICENSE` (C) 2026 Kai Djuric.
- **Media (video clips):** `packs/manifest.json` describes the packs as "Curated opt-in
  media packs shipped with the build" — treat clip licensing as **CC0** for the pack
  metadata unless a per-clip source says otherwise. `attributes[].license` mirrors this.
- **Audio preview:** derived from the source track; the pack's `.swr-set` audio is
  the same track embedded at full length. `preview.mp3` is a 15s trim for the card UI.

## Price tiers — depend on the number of audio tracks (mp3s) in the pack

The NFT price scales with **track count** (the user's "pack price ranges depending
on amount of mp3s"). Single-track packs are the base tier; more tracks per pack lift
the tier. Table is a suggestion — adjust the boundary numbers in the generator.

| Audio tracks in pack | Price USD | Tier |
| -------------------- | --------- | ---- |
| 1                    | 4.99      | seed |
| 2–3                  | 7.99      | duo  |
| 4–6                  | 11.99     | set  |
| 7+                   | 14.99     | vault|

`attributes[].price_usd` carries the tier price; a `price-tier` trait carries the tier
name so marketplaces can group by price band.

## 15s audio preview

`ffmpeg -i <source> -t 15 -ac 2 -ar 44100 -b:a 128k out/media-pack/<pack>/preview.mp3`

Source tracks are all ~11s at 48 kHz stereo, so the preview is effectively the full
track; the `-t 15` cap keeps the contract valid for longer tracks.

## HyperFrames cover animation

`packs/covers/hyperframe-cover.html` — 10s, single paused timeline on
`window.__timelines` (zero-dep RAF facade, no GSAP — repo "no extra deps"),
deterministic (no Math.random/Date.now), transform/opacity only. See its header
for parameters (`pack=`, `clips=`, `audio=`, `accent=`). Render to MP4 the same
way the batch pipeline renders variants (CDP screenshots + ffmpeg image2pipe).

## Round-trip guarantee

`<pack>.swr-set.json` must pass `window.SWR_SETS.importSet()` (schema v2) and its
layers must carry `mimeType: "video/mp4"`. The marketplace zip import
(`marketplace.html` + `lib/zip-reader.client.js` + `swr-sets.js`) must accept the
zip, expand it, map `doc.audio.name` / `doc.layers[].asset.name` to the zip's media
entries, `saveInstalled()` each set, and call `Library.addFiles()` so the media
flows into the user's Library. `applySet()` then auto-plays audio; video layers
autoplay driven by audio play state (engine `drawLayer`).