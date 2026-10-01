---
title: Do Not Mix Build, Learn, and Critique in One Prompt
impact: HIGH
impactDescription: Prevents MODE-CONFUSION; keeps Claude from producing a diluted response that satisfies none of the three goals
tags: anti-patterns, mode-mixing, mode-confusion, build, learn, critique
---

## Do Not Mix Build, Learn, and Critique in One Prompt

Combining Build (create something new), Learn (extract a rule), and Critique (evaluate
quality) in a single prompt is the primary trigger for the MODE-CONFUSION root-cause
pattern. Claude must simultaneously optimize for output completeness, insight
generalizability, and evaluative accuracy -- three conflicting cognitive stances.

**What MODE-CONFUSION looks like in output:**
- A "build" section that is thin because Claude spent tokens on critique
- A critique that hedges because Claude is trying to also be constructive
- A "lesson" that is obvious because Claude did not have space to go deep

**Detection fingerprint (all three signals together):**
1. Mixed-mode language: Build markers ("write", "generate") + Learn markers ("explain why",
   "extract the pattern") + Critique markers ("evaluate", "score", "what is wrong")
2. FAIL on rubric items `clarity.task-objective` AND `clarity.no-conflicts`
3. No dominant OVERENGINEERED signal (caps stacking absent)

**Fix:** Split into sequenced single-mode prompts, or pick the one mode that matters most
and defer the others.

**Incorrect (Build + Learn + Critique in one prompt -- MODE-CONFUSION trigger):**

```text
Write a new summary prompt, explain what makes it effective, and rate the one I am
currently using on a scale of 1-10 with justification.
```

**Correct (sequenced single-mode prompts):**

```text
# Turn 1 (Critique)
MODE: Debug
Rate the current summary prompt on clarity (1-10). Identify the top weakness only.

# Turn 2 (Build)
MODE: Build
Write a replacement that fixes the weakness identified above.

# Turn 3 (Learn)
MODE: Learn
Extract the single most transferable technique from the improvement above.
```

Reference: `modes-four-modes.md` for the Four Modes framework and mode-declaration pattern.
