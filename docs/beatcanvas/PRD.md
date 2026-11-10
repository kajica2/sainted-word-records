# BeatCanvas — validation-first MVP (2026-11-10)
**Status:** Experimental feature branch; not launched or production-ready.

## Problem and buyer
Independent musicians need publishable beat-aware visuals without specialist editing. Educators and general creators are secondary research cohorts, not MVP personas.

## Hypothesis and goals
A musician uploads a finished song and produces three compelling, synchronized promotional assets. Target 20 discovery interviews (10 musicians, 5 educators, 5 creators). This first sprint is only a research dashboard plus an audio-analysis integration spike, **not video generation**.

## Research method
Ask about most recent real project: tools, publishing frequency, time, spend, pain, consequences of not publishing. Only after that demonstrate the product and ask for a credible paid commitment. Interview targets: 10/5/5. Track consent appropriately; do not commit interview data, contact information, song files, or payments to git.

## Proposed go/no-go gates (not statistical proof)
- Strong: >=7/10 musicians report recurring meaningful pain; >=3 credible paid commitments after usable demonstration.
- Mixed: engagement without purchase intent; narrow scope or price.
- Weak: low pain or no buying intent.
- Test $12/month, $29/month, and $5–9 single export; no charges until a reviewed billing integration exists.

## Roadmap
- Days 1–14: interviews, code audit, research dashboard and audio spike.
- Days 15–30: first beat-aware music-to-video render, 9:16.
- Days 31–45: private musician beta.
- Days 46–60: pricing experiments and conversion evidence.
- Days 61–75: export/quality/security release candidate.
- Days 76–90: invite-only paid launch decision.

## Functional acceptance for sprint 1
1. Browser accepts selected audio formats with size checks, decodes locally, and calls existing AudioAnalysisV2.analyzeBuffer; display uncertain BPM honestly.
2. Research tracker stores validated records on the same device and permits export, individual deletion and full wipe. No identity fields; no backend writes.
3. Isolated /beatcanvas/ page and /beatcanvas/research.html work in Vite and preview build.
4. Run BeatCanvas tests and existing BPM regression checks before requesting review.

## Privacy and limitations
No authentication exists in this prototype; the research page itself can be accessed by anyone with the URL, while records remain only in each browser's origin storage. Browser storage is neither encrypted nor synchronized and other same-origin scripts can potentially access it. Use a trusted browser profile; never enter personal identifying data. Audio stays local and is not persisted. Recording/export, section-based visuals, billing, authentication, cloud storage and three-video output are future work.

## Technical fit
Reuse root audio-analysis-v2.js (browser global API), do not modify its algorithm. Existing music-video-maker.html / make-video.html, engine-render.client.js, Vite copy-static, existing BPM and section-detection tests were inspected; renderer integration is deferred to a separate PR. No direct changes to production main. KAI SWARM: <=2 agents; <=$2/day AI API.

## Stage 2 experimental composer (2026-11-10)
- 9:16 540 × 960 canvas with three procedural identity presets.
- Live spectral energy from Web Audio + pulse estimated from existing SWR BPM analysis (not sample-accurate beat tracking).
- Up to 15 seconds of WebM browser recording with audio via MediaStreamDestination, where browser-supported.
- Audio decoding, visualization and recording remain local.
- Still missing: real image/video layers, reproducible song-section sequencing, MP4 fallback, full-song export, cross-browser export verification, and three-output workflow.
- Manual smoke gate: load song, play/pause/seek, switch all styles, record 15-second clip with both picture and audio, then re-upload another file.
- Run visual.test.mjs, previous BeatCanvas tests, existing BPM and section gates, full Vite build. No production merge without all gates and reviewed preview.

## Stage 3 image-sequencing spike
- Optional local PNG/JPEG/WebP batch (up to 12 images, 12 MB/image), decoded as ImageBitmap and held only in memory.
- Deterministic image selection every four detected beats, looping throughout the preview and short recording. When BPM is unclear use 90 BPM as a clearly documented timing fallback.
- Cover-fit images below procedural FX; no raw asset upload, server persistence or image export.
- Still **not** a section-aware director, transition editor, full track exporter or three-asset release workflow.
- Manual QA: add 3 images, change song, seek timeline, validate index mapping, record and inspect 15-second video/audio; ensure invalid inputs do not replace a valid set.
- Caution: preview recording relies on real-time playback and browser MediaRecorder. Verify synchrony and cleanup on target browsers. Do not merge without completing this gate.
