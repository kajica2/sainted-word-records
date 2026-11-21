# GTM research & target campaigns (November 2026)

**Product:** Sainted Word Records (SWR) — browser audio-reactive video engine (`/engine`), free, no signup.  
**Related surfaces:** `marketing/scripts/`, `marketing/personas/full/`, `targeting-pipeline/`, `campaign.html` (paid render service), `market-study.html` (internal sizing narrative).

**Status:** Planning artifact — update KPI columns weekly; external TAM figures are indicative only (sources linked).

---

## 1. Two funnels (do not mix messages)

| Funnel | Promise | Primary URL | Monetization |
|--------|---------|-------------|--------------|
| **Self-serve engine** | Drop song + your clips → reactive video in the browser | `/engine`, `/make-video`, `/tiktok` | Store / packs later; growth = usage + save projects |
| **Done-for-you render** | 48h audio-reactive MP4, multi-aspect | `campaign.html` outreach | €25–45 per render (manual fulfillment per `campaign.html`) |

Campaign copy must pick **one** funnel per ad/DM. The engine lead is always: **free, browser, no signup.** The service lead is: **concrete style names + 48h + price.**

---

## 2. Research synthesis

### 2.1 In-repo audience model (ground truth for positioning)

**Four marketing segments** (`marketing/scripts/README.md`):

| Segment | Script | Personas mapped in `build-rules.mjs` | Count |
|---------|--------|--------------------------------------|-------|
| Music creators | `01-music-creators.md` | fx-surgeon, audio-theorist, bedroom-producer, theory-sonifier, album-cover-designer, data-sonifier, anchor-curator, music-therapist | **8** |
| Video creators | `02-video-creators.md` | ar-loop-poster, storyboard-editor, version-hopper, recorder-renderer, film-composer, short-film-scorer, touring-visualist, podcast-visual-editor, ad-creative-director, wedding-videographer, choreographer | **11** |
| Educators | `03-educators.md` | online-music-teacher, ar-storyboard-reviewer | **2** |
| Casual creators | `04-casual-creators.md` | ar-poster-artist, ar-flashcards, gallery-curator | **3** |

**Cross-cutting personas** (no segment banner; engine targeting only): live-vj, transition-choreo, auth-projects, tag-janitor.

**Interpretation:** Product–story fit is deepest for **video creators** (11 personas) and **music creators** (8). The shipped **primary hooks** already match:

- Music: *"Reacts to your actual song, not templates"* (`bedroom-producer` banner in `build-rules.mjs`).
- Video: *"Your existing folder suddenly feels alive"* (`02-video-creators.md`).

**High-leverage persona IDs for campaigns:** `bedroom-producer`, `recorder-renderer`, `version-hopper`, `wedding-videographer`, `short-film-scorer`, `podcast-visual-editor`.

### 2.2 Internal market study (narrative TAM — verify before citing in ads)

`market-study.html` (not on public deploy IA) asserts rough **paying-user** segments:

- Indie musicians self-releasing on YouTube/TikTok — ~**620k** globally, ~11% YoY
- Bedroom producers publishing a video per release — ~**1.1M**, growth driven by short-form expectations
- Vertical (9:16) workflow called out as table stakes for indie segment

Treat these as **hypotheses** until backed by your own conversion data; use them for **prioritization**, not investor slides.

### 2.3 External market context (sizing — wide error bars)

| Pool | Order-of-magnitude | Source (2024–2025) | Relevance to SWR |
|------|-------------------|-------------------|------------------|
| Hands-on music creators | **~76M** (2024, excl. AI-only) | [MIDiA Recalibration](https://www.midiaresearch.com/reports/music-creator-survey-recalibration) via aggregators | Top of funnel; filter to *self-releasers* and *visual-needy* |
| Self-releasing artists | **~8.2M** (2024) | MIDiA via industry press | Strong overlap with **Campaign A** |
| “Music creators” (broad, incl. AI) | **~148.7M** (2025) | MIDiA / home-studio roundups | Too broad for messaging; use for “large market” intuition only |
| Producers (survey-defined) | **~20M** (global, Tracklib study framing) | [MusicTech / Tracklib 2025](https://musictech.com/news/industry/music-producers-are-rejecting-ai-study-reveals-over-80-of-producers-are-against-ai-generated-songs/) | Bedroom producer wedge; **anti-AI-slop** aligns with human-in-the-loop visuals |
| TikTok creators | **~1.5M–15.8M+** depending on definition | [Exploding Topics](https://explodingtopics.com/blog/tiktok-creator-stats), [Click Analytic](https://www.clickanalytic.com/creator-economy-report/tiktok/) | **Campaign B** — niche by #musicvisualizer #beatmaker etc. |
| TikTok MAU | **>1.6B** | [HypeAuditor 2025](https://hypeauditor.com/state-of-influencer-marketing-2025/) | Awareness only |

**Strategic read:** Largest *addressable attention* is short-form video + self-release music. SWR’s **unfair advantage** is instant try (no signup) + uses **your** library (not stock loops) + real audio analysis (BPM/key/onsets). Compete on **time-to-first-wow** (<2 min), not on enterprise features.

### 2.4 Segment priority scorecard (for Q4 2026)

Scored 1–5 (5 = best). Weighted toward **activation** and **message fit**, not raw TAM.

| Segment | Reach | Fit | Activation (free engine) | Monetization near-term | **Priority** |
|---------|-------|-----|-------------------------|------------------------|--------------|
| Music creators / bedroom producer | 4 | 5 | 5 | 3 (service + future packs) | **P0** |
| Video creators (TikTok/YT short) | 5 | 5 | 4 | 3 | **P0** |
| Casual creators | 4 | 4 | 5 | 1 | **P1** (viral lottery) |
| Wedding / event video | 2 | 4 | 3 | 4 (service) | **P1** (high ARPU, low volume) |
| Educators | 2 | 3 | 3 | 2 | **P2** |
| Live VJ / touring | 1 | 5 | 2 | 2 | **P2** (credibility, not volume) |

---

## 3. Planned target campaigns (12-week horizon)

Each campaign has: **goal**, **persona anchor**, **message**, **landing**, **channels**, **creative checklist**, **KPIs (week 4)**, **UTM convention**.

Global UTM pattern:  
`https://sainted-word-records.vercel.app/engine?utm_source={source}&utm_medium={medium}&utm_campaign={id}`

---

### Campaign A — **Drop Friday** (P0 · music creators)

| Field | Detail |
|-------|--------|
| **ID** | `drop-friday-2026q4` |
| **Persona** | `bedroom-producer`, `album-cover-designer` |
| **Segment script** | `marketing/scripts/01-music-creators.md` |
| **Objective** | Indie/self-release artists try the engine **within 48h of single drop** |
| **Core message** | "Reacts to your actual song, not templates. Free. No signup." |
| **Landing** | `/engine` (preset: neon or film via shared demo song first, then their WAV) |
| **Secondary** | `campaign.html` for artists who want **you** to ship the MP4 by Thursday (€25) |

**Channels (ordered)**

1. **Instagram / TikTok DMs** — 10–20 micro artists/day (1k–50k followers); lead with **10s screen capture** of *their genre* (jazz, trap, ambient), not explanation.
2. **Reddit** — r/WeAreTheMusicMakers, r/edmproduction, r/trapproduction (comment/help first; link only when asked).
3. **Discord** — producer servers (FL/Ableton); one `#showcase` post/week with before/after.
4. **YouTube Shorts** — same song, 5 looks (`version-hopper` angle), 8s contrast.

**Creative checklist** (from `campaign.html` playbook A–E)

- [ ] Before/after: silent waveform → reactive layers
- [ ] Screen record: drop WAV + folder, hit play
- [ ] Style comparison: neon / film / smoke same track
- [ ] One **free 10s preview** for a local artist (credit trade)

**Week-4 KPIs**

| Metric | Target |
|--------|--------|
| Engine sessions with external referrer | 200+ |
| Median time on `/engine` | ≥3 min |
| Record button used (qualitative: screen caps) | ≥15 posts |
| Paid render inquiries | 3+ |

---

### Campaign B — **Folder comes alive** (P0 · video creators)

| Field | Detail |
|-------|--------|
| **ID** | `folder-alive-2026q4` |
| **Persona** | `recorder-renderer`, `version-hopper`, `podcast-visual-editor` |
| **Segment script** | `marketing/scripts/02-video-creators.md` |
| **Objective** | Editors with **folders of B-roll** publish one reactive cut without opening AE |
| **Core message** | "The engine reads the BPM, locks onto the beat, and makes your existing footage react." |
| **Landing** | `/engine` or `/make-video`; export path via recorder |

**Channels**

1. **TikTok / Reels / Shorts** — hook: "100 clips, zero keyframes" + beat-sync demo.
2. **YouTube** — titles like "music visualizer without After Effects" (long-tail SEO).
3. **CapCut / editor communities** — tutorial positioning, not competitor bashing.

**Content formats**

- 9:16 export demo (`/tiktok` surface if positioned for vertical).
- Podcast clip: voice + reactive stills (`podcast-visual-editor`).

**Week-4 KPIs**

| Metric | Target |
|--------|--------|
| Short-form posts live | 8+ |
| Views on best clip | 5k+ (organic) |
| Engine visits from `utm_campaign=folder-alive-*` | 150+ |
| WebM/MP4 exports shared (hashtag scan) | 10+ |

---

### Campaign C — **No After Effects tonight** (P1 · casual creators)

| Field | Detail |
|-------|--------|
| **ID** | `no-ae-tonight-2026q4` |
| **Persona** | `ar-poster-artist`, `gallery-curator` |
| **Segment script** | `marketing/scripts/04-casual-creators.md` |
| **Objective** | Low-friction **event/birthday** videos; maximize shares |
| **Landing** | `/engine` or `/make-video` |

**Channels:** Instagram stories, family/event Facebook groups (light touch), friend-of-founder seeding.

**Week-4 KPIs:** 5+ user-generated shares; 50+ sessions; zero jargon in every caption (voice lint: no "AI-powered", "seamless").

---

### Campaign D — **48h visual** (P1 · paid service · `campaign.html`)

| Field | Detail |
|-------|--------|
| **ID** | `render-48h-2026q4` |
| **Persona** | Indie musician dropping Friday (`campaign.html` ad angle 6) |
| **Objective** | **Revenue + case studies** — manual renders, not engine scale |
| **Core message** | Style names (Neon Church, Morning Haunt, …) + "free 10s preview" |
| **Landing** | `/campaign#outreach` |

**Tactics** (from `campaign.html` §09)

- 20 personalized DMs/day with **demo**, not tech spec.
- Portfolio: 5 genres (jazz, hip-hop, ambient, electronic, rock) before scaling outreach.

**Week-4 KPIs**

| Metric | Target |
|--------|--------|
| DMs sent | 80+ |
| Reply rate | ≥10% |
| Paid orders | 2+ |
| Testimonials / credits | 2+ |

---

### Campaign E — **Lecture pulse** (P2 · educators)

| Field | Detail |
|-------|--------|
| **ID** | `lecture-pulse-2026q4` |
| **Persona** | `online-music-teacher` |
| **Segment script** | `marketing/scripts/03-educators.md` |
| **Objective** | Music/arts educators use engine for **engagement clips** in LMS |
| **Landing** | `/engine` + `/tutorial-30s` |

**Channels:** Teacher TikTok, music-ed YouTube, university jazz/conservatory adjunct networks.

**Week-4 KPIs:** 3 educator trials; 1 recorded mini-lesson featuring SWR.

---

## 4. Execution calendar (first 4 weeks)

| Week | Focus | Deliverables |
|------|-------|--------------|
| **1** | Assets | 5 genre portfolio renders; 3 screen recordings; UTM links for A+B |
| **2** | Launch A+B | 10 DMs/day; 2 Shorts; 1 Reddit value post |
| **3** | Iterate | Double down on channel with highest **engine time**; start Campaign D previews |
| **4** | Measure | Fill KPI tables; pick **one** winning hook per segment; kill weak channel |

---

## 5. Measurement & tooling

| Need | Approach |
|------|----------|
| Attribution | UTM on all outbound links; note source in spreadsheet |
| On-site behavior | Vercel Web Analytics / Plausible if enabled |
| Voice compliance | `marketing/scripts/README.md` banned phrases; `targeting/voice-lint.json` |
| In-product segment test | `client/targeting.client.js` on `/engine` (persona classification banners) |
| qualitative | Save best clips to `promo/` or `reels/` when cleared |

**Campaign tracker:** `marketing/campaigns/campaign-tracker.md` (weekly KPI rows).

---

## 6. Open research questions (next pass)

1. Validate `market-study.html` segment sizes against **your** first 50 conversions (geo, genre, aspect ratio).
2. Which subreddit/Discord gives **lowest CAC** time-to-first-render?
3. TikTok policy: music copyright on exported clips (user responsibility vs platform risk).
4. Split test: **engine-only CTA** vs **free preview render CTA** for same audience.

---

## 7. References in repo

- Personas: `marketing/personas/full/README.md`, `CURRENT-STATE-MAP.md`
- Voice + scripts: `marketing/scripts/README.md`, `01–04-*.md`
- Targeting tables: `targeting-pipeline/build-rules.mjs`
- Service GTM: `campaign.html` (§07–10), `market-study.html` (#segments)
- Public pages: `landing.html`, `personas.html`, `campaign.html`, `tutorial-30s.html`
