# Section 11 · 90-day execution calendar

Thirteen weeks, four phases, one source of truth. Each row ships something public. Week 1 starts Tue 18 Aug 2026; Week 13 ends Mon 16 Nov 2026. Dependencies sit in the deliverables column; the per-week note names the one thing that has to be true first.

| Week | Phase | Top deliverables | Target metric |
| --- | --- | --- | --- |
| **Wk 1** · Aug 18–24 | Phase 01 · Paywall live | Sign up for Lemon Squeezy, create the $5 SKU · swap `localStorage.setItem('ms-paid','1')` for the LS redirect in `market-study.html` · deploy `dist/` to Vercel · post on r/WeAreTheMusicMakers + KVR *(dep: account verified)* | **$50 revenue** / 5 signups |
| **Wk 2** · Aug 25–31 | Phase 01 · Paywall live | Finish Sections 4–9 of the study · serve the PDF from the success page · post 3 watermarked 30s renders to TikTok · DM 10 indie artists *(dep: Wk 1 charges a real card)* | **$200 cumulative** / 15 customers |
| **Wk 3** · Sep 1–7 | Phase 02 · First services | Add "Hire me · $25 · 48h" callout to `landing.html` + `index.html` · create a Stripe Payment Link · render 5 demo videos · email 20 artists *(dep: 60s render still fast)* | **$400 cumulative** / 10 DMs sent |
| **Wk 4** · Sep 8–14 | Phase 02 · First services | Stand up a 48h intake form · ship 3 paid videos at $15 seed pricing · post a before/after render on Shorts *(dep: Wk 3 link takes a charge)* | **$700 cumulative** / 3 paid videos |
| **Wk 5** · Sep 15–21 | Phase 02 · First services | Move to $25 standard · stamp "Made with SWR" on every MP4 · publish second Shorts + first Reels clip · join 3 producer Discords *(dep: 1 testimonial from Wk 4)* | **$1,000 cumulative** / 10 paid videos total |
| **Wk 6** · Sep 22–28 | Phase 02 · First services | Open 48h intake publicly · pitch 5 small labels re: commissions · bundle the first 2 render-preset packs · host first Discord office hours *(dep: repeat rate >15%)* | **$1,500 cumulative** / hit $1k/week once |
| **Wk 7** · Sep 29 – Oct 5 | Phase 03 · Presets & commissions | Build "Vaporwave 90s VHS" pack · build "Synthwave outrun" pack · list both on Lemon Squeezy at $9 and $19 · DM 5 ambient/synthwave subs *(dep: 2 packs zipped)* | **$1,800 cumulative** / 8 pack sales |
| **Wk 8** · Oct 6–12 | Phase 03 · Presets & commissions | Build "Hip-hop 16mm" pack at $19 · email 10 small labels re: $400 commissions · add "Build me a custom version" tier *(dep: 1 inbound inquiry)* | **$2,200 cumulative** / 5 DMs sent |
| **Wk 9** · Oct 13–19 | Phase 03 · Presets & commissions | Take 1 paid commission at $400 (SKOOL_JAZZ variant) · ship "Lo-fi bedroom pop" pack at $19 · publish a Substack post on the one-person studio *(dep: commission paid up front)* | **$2,800 cumulative** / 1 commission closed |
| **Wk 10** · Oct 20–26 | Phase 03 · Presets & commissions | Deliver SKOOL_JAZZ, publish a behind-the-scenes post · open 2 November commission slots · ship the case study post *(dep: Wk 9 approved)* | **$3,400 cumulative** / 3 commission slots open |
| **Wk 11** · Oct 27 – Nov 2 | Phase 04 · SaaS groundwork | Decide Supabase · wire cloud-library sync into the engine (free, ungated) · pick 5 power users for free lifetime SaaS · add a deposit line to the commission form *(dep: Supabase provisioned)* | **$3,700 cumulative** / 5 power users contacted |
| **Wk 12** · Nov 3–9 | Phase 04 · SaaS groundwork | Ship email auth flow · sync user libraries across devices · soft-launch free tier to 50 invited users *(dep: auth working on localhost)* | **$3,900 cumulative** / 50 signups |
| **Wk 13** · Nov 10–16 | Phase 04 · SaaS groundwork | Lock the pricing page · publish "SaaS coming Q1 2027" waitlist on `landing.html` · ship the 90-day retrospective post *(dep: week-2 retention >40%)* | **$4,200 cumulative** / 200 waitlist signups |

## Per-week notes

**Wk 1** — bottleneck is payment plumbing. If the SKU isn't live by Friday, the forum post has no link.

**Wk 2** — the success page must deliver a PDF, or the first $5 buyers email asking where the study is.

**Wk 3** — the hinge. The Stripe Payment Link has to exist before the callout goes up.

**Wk 4** — discount season. $15 for the first three buys you three testimonials and three honest critiques.

**Wk 5** — at $1k cumulative with a testimonial, $25 is earned. Below $400, hold $15 another week.

**Wk 6** — make-or-break. The trigger for opening commissions is repeat-customer rate, not total revenue.

**Wk 7–8** — content weeks. Packs are mostly assembly: re-bin `library/` with new metadata, color grades, a readme.

**Wk 9** — first commission. Charge up front. The custom-version format is the most defensible revenue stream.

**Wk 10** — the case study that closes the next two commissions. Cheapest customer-acquisition channel in the plan.

**Wk 11–12** — quiet on revenue, loud on architecture. Supabase ships auth, storage, edge in one project.

**Wk 13** — a publishing week. If 50 free-tier users don't show week-2 retention above 40%, the SaaS launch is Q2 2027.

## What to drop if you're behind

- **Cut the second Discord office hours in Wk 6.** One is enough.
- **Cut the "Lo-fi bedroom pop" pack in Wk 9.** The Wk 7–8 packs are the money shots.
- **Cut the Substack post in Wk 9.** The Wk 10 case study is the post that matters.
- **Don't cut the deposit line in Wk 11.** Without an upfront deposit, commissions become collection work.
- **Don't cut the waitlist in Wk 13.** A waitlist of 30 is a different answer than 300.
