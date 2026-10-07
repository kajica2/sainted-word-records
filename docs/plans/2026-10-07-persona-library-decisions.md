# Plan — Persona-library decisions (D1–D11)

Source: `persona-library.html` (the explainer & decision memo) — 28 workflow
personas · 14 strategic typologies · 11 surfaces · 4 conflicts · 5 revenue
vectors · 4 risks · 11 pending decisions.

This plan does not re-derive the analysis. It takes the memo's **11 decisions
(D1–D11)** and turns them into an **executable, dependency-ordered plan**. The
memo answers *what must be decided*; this answers *in what order, what blocks
what, and how you know it's done*.

## Goal

Remove the blockers that stop the site taking money and making a claim, in an
order where each step unblocks the next — without violating any of the nine
GUARDS the persona library surfaced.

## Reconciled against the repo — 2026-10-07

The memo was written against an earlier snapshot. Three of its premises have
since moved, so **re-measure before acting on D1, D2 and D7**:

- **D1 — the persona counts drifted *and* got worse.** `personas.html` now
  states **both** "8 personas" (its `<title>`, "8 personas, 6 registers") *and*
  "11 personas" in the page body — a self-contradiction on a single page, where
  the memo recorded 8 vs the licence page's 23. Shipping one canonical number
  therefore starts with fixing that page against itself.
- **D2 — "12 visual styles" is still live copy.** The memo's four-way split
  (5 / 12 / 22 / 25) has not been resolved in the tree; re-count Looks vs
  Surfaces before publishing.
- **D7 — the AR route moved.** `/ar-loop` is now a **404**. `/engine-ar-loop`
  301s to **`/ar-gif`**, which is live (200) and present in `site-map.json`
  under `tools` + `discovered` — but **not in `nav`**. Current nav is
  Engine · Personas · Learn. So D7's finding still holds (the AR surface has no
  discoverable entry point) while the route name in the memo is stale. The
  no-login-share commitment is unchanged and still applies.

## What this adds over the memo

| The memo has | This plan adds |
| --- | --- |
| 11 decisions with owner / trigger / why / act | Phases ordered by what unblocks what |
| 9 GUARDS (constraints) | GUARDS as **acceptance gates** each phase must not break |
| 4 RISKS | The **critical path** and the gates that must be respected |
| decisions marked `hot` | A "do now, no code" shortlist vs a blocked list |
| — | Per-decision **acceptance criteria** (verifiable) and **effort** |

## Critical path

```
D3 media rights ──► per-video service (€25–75) ──► repeat-customer rate ──► ads
D4 paywall      ──► market study can be promoted
D1 + D2         ──► any persona-led / style-led message is claimable
```

Two hard gates, both stated in the memo and both non-negotiable:

- **No rendered output containing a bundled asset is sold until D3 lands.**
- **No paid acquisition until the per-video service shows a ~20 %
  repeat-customer rate** (RISK 3 — $5/day burns before it returns).

---

## Phase 0 — Now · no code · unblocks all messaging, stops build cost

These are copy/data decisions. They gate every marketing claim, so they go
first even though they are the cheapest.

| # | Decision | Act | Acceptance criteria |
| --- | --- | --- | --- |
| **D9** | Freeze the daily preset pipeline | Freeze 90 days; resume after the per-video service shows a repeat rate | Cron stopped; no new `presets/*.json` merged for 90 days |
| **D1** | One canonical persona count | Ship **23** as the marketed number; reclassify 28 + 14 as internal | No public page states a persona count other than 23; `personas.html` (8) and the licence page (23) agree |
| **D2** | One canonical style count | Split **Looks** vs **Surfaces** in the data model; publish only the Looks count | The data carries a `kind` field of `look` or `surface`; only Look counts appear in copy |

**Why first:** D1/D2 are marked "before any persona-led / style-led message."
Today three persona counts (8 / 23 / 28+14) and four style counts (5 / 12 /
22 / 25) are public at once, so *any* such claim is unfalsifiable until these
land. D9 is marked "Now" and stops ongoing build cost that produces marketing
surface rather than revenue.

---

## Phase 1 — Revenue blockers · before the first paid order

Nothing gets sold until both of these land. This is the critical path.

| # | Decision | Act | Acceptance criteria |
| --- | --- | --- | --- |
| **D3** | Clear the bundled-media rights position | Replace the bundled library with redistribution-licensed assets, **or** ship an explicit asset-rights declaration + customer-side verification step | Either no bundled asset ships, or the rights declaration is published and the verification step is in the order flow. No paid render uses a bundled asset |
| **D4** | Replace the client-side paywall | Real Stripe / Lemon Squeezy with **server-side verification** | Paywall cannot be bypassed by editing `localStorage`; entitlement is checked server-side; RISK 1 closed |

**Why blocking:** D3 sits under the service tier, the per-video vector *and*
the €55 Custom Source tier at once, and across 42 personas **none** addresses
rights — so the library can't inform it. D4 is RISK 1: a bypassable gate teaches
every user the whole product is fake.

---

## Phase 2 — Before the campaign runs

| # | Decision | Act | Acceptance criteria |
| --- | --- | --- | --- |
| **D7** | Give the AR surface a public entry point | Surface the AR page in the main navigation; confirm in writing that **no share link ever requires a login** | The AR page is reachable from the main nav; the no-login-share commitment is documented (it is GUARD #1). The route moved since the memo — see the drift note below |
| **D10** | Pull the galleries out of the funnel | Move galleries behind a subdomain or frame them explicitly as R&D, below the funnel in nav | The funnel's nav path contains no gallery entry; galleries are labelled R&D |
| **D8** | Decide whether education / clinical / museum are real segments | If a segment: ship a stated **non-commercial tier** (not a smaller free tier). If not: say so and stop counting them | A published segment decision; pricing reflects it |

**Why here:** D7 carries the strongest documented persona signal in the library
(8 personas, two camps, unanimous refusal of login-gated shares) yet has no
discoverable route. D10 is the memo's own CONFLICT #4 (broad surfaces dilute a
narrow service pitch). D8 must land "before pricing is final."

---

## Phase 3 — Next release

| # | Decision | Act | Acceptance criteria |
| --- | --- | --- | --- |
| **D5** | Name the two export paths apart | Distinct names for **WebM (live MediaRecorder)** vs **MP4 (native encode)** in UI, tiers and docs | No surface uses one word for both; each tier states which path it ships |
| **D6** | Move preset discovery off the notification pill | Make new presets discoverable **through navigation**; keep the hand-authored anchor map stable and named as the reference set | No nudge/pill drives discovery; the anchor map is stable and named |

**Why gated on release:** both are "next release" and neither blocks revenue.
D5 matters because 20 personas depend on WebM while the campaign depends on MP4
and the licence page currently contradicts the landing copy. D6 matters because
five strategic typologies have *zero* tolerance for the pill mechanism — and it
is GUARD-adjacent ("no notifications, no streaks").

---

## Phase 4 — Deliberate, when ready

| # | Decision | Act | Acceptance criteria |
| --- | --- | --- | --- |
| **D11** | Answer the refusal question publicly | Write the refusals down as **product commitments** — the GUARDS section is the draft | Published refusals: zero backend · no install · no render farm · no login-gated share link · no smart auto-correction |

**Why last:** it is marked "sometime, deliberately." It is the memo's most
actionable open item (both READMEs converge on it) but it depends on the earlier
phases being real — publishing refusals while the paywall is a stub would be
hollow.

---

## Hard constraints — GUARDS (do not break these)

Every phase above must not violate the nine guards the library surfaced. Treat
these as the acceptance gate for *any* change, not just persona work.

1. **Never gate a share link** — the AR loop fails the moment viewing needs login.
2. **Never replace magic-link with OAuth** — venue laptops, hospital firewalls, agency procurement.
3. **Never collapse the variants** — 26+ styles stay peers (no "theme picker").
4. **Never auto-fire a transition** — the silence between transitions is the work.
5. **Never hide the auto-picker** — the override workflow is why these users came.
6. **Never drop WebM** — every downstream ffmpeg / Vimeo / archive pipeline assumes it.
7. **No notifications, no streaks** — the largest single anti-signal (5 typologies, zero tolerance).
8. **No auto-tagging model** — the chromagram is ground truth; a ~20 %-wrong model costs the tag janitor.
9. **Keep the mobile-only AR constraint** — read as honest, not broken; do not "fix" it into a login.

## Out of scope

- The abandoned consumer personas (`marketing/personas/abandoned/`) — explicitly
  not part of the deliverable; do not plan against that layer.
- The storyboard surface (SB) is **planned** — seven personas design against it
  anyway; carry the signal into planning but do not treat SB as shipped.
- Re-deriving the persona analysis — that lives in `persona-library.html`.

## Dependencies at a glance

```
Phase 0 (D9, D1, D2)  ──►  Phase 1 (D3, D4)  ──►  Phase 2 (D7, D10, D8)
                                                      │
                                                      ▼
                                              Phase 3 (D5, D6) ──► Phase 4 (D11)
```

Phase 1 is the only true blocker chain: **D3 → service tier → repeat rate → ads.**
Everything else is claim-hygiene, funnel hygiene, or naming.
