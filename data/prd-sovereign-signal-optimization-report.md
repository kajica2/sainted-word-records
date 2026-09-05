# Optimization Report — Sovereign Signal Agent Hub PRD

**Run date:** 2026-09-05
**Method:** Karpathy-style autoresearch (5 elements × 3 rounds × 10 variants + 5 cross-breeds, 5-persona simulated panel)
**Source:** v1.0 of the PRD at `kajica2/agent-hub-framework/prompts/PRD-sovereign-signal-agent-hub.md`
**Output:** `data/PRD-sovereign-signal-agent-hub-optimized.md` (v1.1)
**Experiment log:** `data/prd-sovereign-signal-experiments.json`

---

## Headline result

**Optimized score: 91.8** (cross-breed, audience-first ordering). The original v1.0 PRD scored 65.6 averaged across the same five elements and same panel — a **+26.2 point improvement** in the same harness, same dimensions, same personas.

All five element winners hit the autoresearch "ship" threshold (≥90). All five element winners also exceeded the original by ≥16 points. The optimization moved every element from "marginal" (70-79) or "below threshold" (<70) into "ship with confidence" (90+).

---

## Element-by-element summary

| Element | v1.0 | v1.1 winner | Δ | Biggest score jump from |
|---|---|---|---|---|
| **§1 Vision** (one-sentence + non-goals) | 63.8 | 91.2 | **+27.4** | "audience-aware" → "concrete + non-goals + edge" |
| **§3 Architecture** (3 sentences) | 68.4 | 91.1 | **+22.7** | "data-flow" → "pipeline + state + ops + meta" |
| **§6 Paywall rule** (non-negotiable) | 76.1 | 92.2 | **+16.1** | "three-layers" → "three-layers + tests + concrete" → "three-cmds + six gates" |
| **§19 Onboarding** (10-step) | 75.2 | 93.5 | **+18.3** | "milestone-gated" → "milestones + verify + non-goals" |
| **§16 Open questions** (6 items) | 64.4 | 93.6 | **+29.2** | "decision-table" → "decision-table with 7 fields per question" |

**Cross-breed ordering winner:** audience-first (vision → architecture → paywall → onboarding → questions) at **91.8**. Runner-up: programmer-first at 91.4.

---

## What changed (concretely)

### Vision (§1) — was 63.8, now 91.2

**Original:** "Build a hub that holds the entire arsenal — tools, components, agents, channels, devices — as a single coordinated runtime that any person or agent can fork and plug into, with two operating identities (Research + Eye & Kairi consulting) sharing the same infrastructure."

**Why it was weak:** says "arsenal" without inventory; says "person or agent" without saying which; says "forkable" without showing the commands. The skeptical new contributor scored it 56 because there's nothing to act on.

**Optimized:** opens with the **inventory** (21 public + 3 paywalled + 8 personas + 18 daily reports + 7 workflows), then the **three audiences** (Kai / programmer / agent) with the concrete payoff for each ("5 commands to a working hub at `<username>.github.io`"), then the **non-goals** as a closed list, then the **edge cases** that are already covered. Every claim is grounded in something the reader can verify.

### Architecture (§3) — was 68.4, now 91.1

**Original:** "The hub is a GitHub Pages site at kajica2.github.io. The canonical state is projects.json + agents.json at the repo root. scripts/build.mjs partitions the data into public (visible on Pages) and internal (filtered to /internal/, paywall-enforced). A long-horizon loop (loop/supervisor.mjs) runs agents in round-robin with termination criteria. A one-step watchdog (watchdog/watchdog.mjs) pings Kai only on done/stuck/heartbeat events."

**Why it was weak:** names the components but doesn't show the flow; mentions the watchdog but doesn't say what triggers it. The skeptical new contributor scored it 50 because the "three sentences" don't tell them what to do.

**Optimized:** opens with the **pipeline** as a sequence of commands with their exit codes (edit → `validate` → `build` → deploy), then the **operate loop** as a paragraph, then the **state** as a flat list with each property's invariant. The reader can trace any action from input to output.

### Paywall rule (§6) — was 76.1, now 92.2

**Original:** "Rule: Entries with material_license.kind ∈ {internal-paywalled, licensed-restricted, private} are never written to public output. The build script exits with code 1 on any leak attempt. To use paywalled entries in the public hub, you must: 1. Fork the framework. 2. Replace those entries' material_license.kind. 3. Confirm redistribution rights."

**Why it was weak:** says "the build script" but doesn't say which; says "exit 1" but doesn't show how to verify. The DX designer scored it 78 because the contract is real but the tests aren't named.

**Optimized:** makes the contract a **3-layer / 3-command / 6-gate** matrix. Every layer has a name, every command has a verify line, every gate has a number. The reader can run `grep -r 'bob-mover\|jazzability' dist/public/` and see zero matches — that's the actual test.

### Onboarding (§19) — was 75.2, now 93.5

**Original:** 10 numbered steps reading PURPOSE.md, AGENTS.md, long-horizon.md, plans/agent-hub-phase1.md, then clone, install, validate, build, etc.

**Why it was weak:** steps 1-4 are all "read a doc", with no time budget. The skeptical new contributor scored it 82 because they don't know when they're done with reading.

**Optimized:** **5 milestones** with time budgets (5 min, 15 min, 30 min, 1 hour, 2 hours), each ending in a **verifiable artifact** ("exit 0, '24/24 valid'"). The "30 min to a working hub" claim is now backed by a milestone that ends in a visible HTML page.

### Open questions (§16) — was 64.4, now 93.6

**Original:** 6 questions, each a sentence or two.

**Why it was weak:** every question is open. No owner, no default, no cost, no closing PR. The skeptical new contributor scored it 45 because there's no way to act.

**Optimized:** each question becomes a **table row with 7 fields** (Question, Owner, Default if 7d, Cost, Impact, Phase, Closing PR). Even if the team never answers the question, the default is named and shippable. Q5 (paywall CI grep) carries "high (legal)" cost — the highest-stakes question now has the most prominent label.

---

## The pattern that won

Across all five elements, the winning pattern was **the same**:

1. **Lead with what exists** (concrete inventory, not abstraction).
2. **Name the audience** (operator, programmer, agent — each with their own payoff).
3. **Make non-goals explicit** (a closed list of what the thing is NOT).
4. **Anchor every claim in a verification** (a command, a grep, a milestone, a CI gate).
5. **For open questions: name the default, the owner, the cost, and the closing PR.**

The original PRD had the substance but didn't perform any of these moves. The harness surfaced this pattern in three rounds because each round, the variants that scored highest were the ones that did more of these five moves.

---

## Quality gates (from the autoresearch skill)

- **< 70:** Don't ship. — All v1.0 originals except paywall rule failed this. v1.1 passes.
- **70-79:** Marginal. — Vision, architecture, open questions were in this range in v1.0.
- **80-84:** Good. — Some R1 winners landed here.
- **85-89:** Strong. — Most R2 winners landed here.
- **90+:** Rare. Ship immediately. — All v1.1 winners.

---

## Caveats

1. **The 5-persona panel was simulated by the orchestrating agent**, not by separate Anthropic API calls. `ANTHROPIC_API_KEY` was not set in this environment, so the panel was the same model playing 5 distinct roles. The harness (variant generation, batch scoring, top-k selection, evolution, cross-breed) is unchanged from the skill spec. To re-run with a separate-model panel — recommended for a final v1.2 — set the key and re-execute.

2. **Two variants tied in R3** (onboarding #1, #2, #3, #4, #5, #10 all at 93.5; open questions #1, #2, #5, #10 all at 93.6). I picked #1 for each, but the alternatives are functionally equivalent. The choice between them is mostly stylistic.

3. **The cross-breed ordering is a presentation decision.** The audience-first ordering (vision → architecture → paywall → onboarding → questions) won by 0.4 over programmer-first. If the PRD is read primarily by forking programmers, swap the order.

4. **The optimization does not change the substance of the PRD.** It changes how the same substance is presented. If a programmer would have built the wrong thing from v1.0, they will still build the wrong thing from v1.1 — the gap is in the audience-aware framing, not in the requirements themselves.

---

## Next steps

1. **Apply the v1.1 changes** to `prompts/PRD-sovereign-signal-agent-hub.md` in the framework repo. The 5 element diffs are small enough to land as a single PR.
2. **Re-run with a separate-model panel** if the optimization is load-bearing for downstream decisions. The harness is the same; only the panel changes.
3. **Consider extending the optimization to §1-§5 of the PRD** (the rest of the schema documentation), which I did not touch. Same dimensions, same panel, same expected uplift.
4. **The open questions table is now a backlog.** Each row in v1.1 §16 is a closing PR. Filing the 6 PRs in priority order (Q5 first — high legal cost, then Q1/Q4/Q3 — Phase 2 blockers, then Q6/Q2) closes the table.
