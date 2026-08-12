# Section 10 · Financial model

The headline on the previous section — **$3,200 to $7,400 in 90 days** — is a range, not a forecast. This section puts the actual math behind it: what each unit costs, what it earns, when the books balance, and what breaks if the assumptions don't hold. Every number below is auditable; every assumption is named.

## Assumptions

1. **No paid acquisition in the first 90 days.** Distribution runs through organic posts (forums, TikTok, Reels, Discord) and one-on-one outreach for commissions. Paid channels activate only after the per-video vector proves a 20%+ repeat-customer rate — that's the gate for ROI.
2. **CAC by vector is operator time, not ad spend.** Vector 1 (study) CAC is $1.50 in posting labor; vector 2 (rendering) is $8 in content creation; vector 4 (commissions) is $50 in outreach; vector 5 (SaaS) is $30 blended acquisition once active.
3. **Fixed monthly costs are $25 in months 1–2 and $45 in month 3.** Vercel Pro ($20), domain ($1.50), Supabase free tier in month 1–2, Supabase Pro $25 in month 3 when the SaaS groundwork ships. No salaries, no rent — this is a laptop business.
4. **Hosted tier churn is 7% per month** (mid of typical indie-SaaS range 5–10%). ARPU blends to $19 across the $9 / $19 / $29 tiers. Simple LTV = ARPU / churn = **$271 per user**.
5. **Operator labor is treated as revenue, not cost.** When vector 2 takes 90 minutes per video, that's the operator earning roughly $17/hr of effective wage on a $25 sale — not a deduction from the line. This is honest because the alternative is the operator's time earning $0.

## Per-vector unit economics

### Vector 1 — Market study paywall ($5/study)

Price $5. Variable cost: Lemon Squeezy fee 5% + $0.30 = **$0.55**. Net per sale $4.45. CAC $1.50. **Contribution margin $2.95 (59%).** Break-even: **17 sales per month** covers all fixed costs. 90-day base case: 200 sales = **$590 contribution**. Optimistic (500 sales) = $1,475. Pessimistic (80 sales) = $236.

### Vector 2 — Per-video rendering service (€25/video)

Price $25. Variable cost: Stripe fee 2.9% + $0.30 = $1.03, plus ~$0.50 cloud compute per render. Net per video $23.47. CAC $8. **Contribution margin $15.47 (62%)** before operator labor. Break-even: **4 videos per month** to cover fixed. 90-day base: 50 videos = **$774 contribution**. Optimistic (120 videos) = $1,856. Pessimistic (15 videos) = $232.

### Vector 3 — Curated library presets ($15–30/pack)

Price $20 blended (range $15–30). Variable cost: Lemon Squeezy fee $1.30. Net per pack $18.70. CAC $1. **Contribution margin $17.70 (89%)** — the highest-margin vector for a reason, since it's a digital file that ships itself. Break-even: **3 packs per month**. 90-day base: 40 packs = **$708 contribution**. Optimistic (100 packs) = $1,770. Pessimistic (10 packs) = $177.

### Vector 4 — Sponsored / commissioned visual versions ($200–1,000/project)

Price $500 blended (range $200–1,000). Variable cost: Stripe fee 2.9% + $0.30 = **$14.80**. CAC $50 (outbound labor — 4–6 hours of DMs, emails, calls). **Contribution margin $435 (87%)** per project, but lumpy: you can do 0 in a month or 3. Break-even: **1 commission every 4 months** covers fixed. 90-day base: 2 commissions = **$870 contribution**. Optimistic (5) = $2,175. Pessimistic: 0.

### Vector 5 — Hosted "studio" tier ($9–29/mo, recurring)

Price $19 ARPU. Variable cost: Stripe fee $0.85, hosting $0.50/user/month (Supabase + Vercel, per-user) = $1.35. **Contribution margin $17.65/user/month (93%).** Churn 7%/month → LTV $271. At $30 CAC, **LTV/CAC = 9x** (healthy band is 3–5x). Payback period 1.7 months. 90-day base: **$0 contribution** — Q1 is groundwork; the SaaS pays back in months 4–12 as MRR compounds. Optimistic (a handful of early paying users) = $200. Pessimistic: 0.

## Runway & sensitivity

Cumulative business contribution, base case: month 1 ≈ $50, month 2 ≈ $450, month 3 ≈ $2,440. After $95 in fixed costs over 90 days, the business clears **~$2,940 in net cash by day 90** and is self-funding from month 1.

The honest runway question is personal, not business. At $2,000/month living expenses:

- **Base scenario:** month 1 −$1,975, month 2 −$1,575, month 3 +$395. Cumulative **−$3,155.** You need ~3 months of personal savings.
- **Optimistic scenario:** cumulative **+$3,500** — engine pays rent from month 2, SaaS MRR compounds into Q2.
- **Pessimistic scenario:** cumulative **−$5,500** — you burn the runway and have nothing to show.

**Stress test on the base case:**
- **CAC 2x** (vector 1 from $1.50 to $3): contribution drops to ~$2,100. Personal runway gap widens by ~$850.
- **Conversion 0.5x:** 90-day contribution falls to ~$1,470. Covers fixed, doesn't cover rent.
- **Both stresses combined:** contribution falls to ~$1,050. Engine pays for itself, not the operator. The floor before paid acquisition is "indie side project," not "quit your day job."

## The bottom line

The four active vectors sum to **$2,942 net contribution over 90 days** (base), with a band of **$645 (pessimistic) to $7,476 (optimistic)**. The business clears its own costs from day 1; whether it clears the operator's living costs is a question of personal runway, not unit economics. The only way to shorten that question is to ship vector 1 this week and let the numbers replace this model.
