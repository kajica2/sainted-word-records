---
title: Learn Mode -- Extract Knowledge from Prompt/Output Pairs
impact: HIGH
impactDescription: Surfaces transferable rules; prevents shallow summaries that do not generalize
tags: modes, learn, knowledge-extraction, generalization
---

## Learn Mode -- Extract Knowledge from Prompt/Output Pairs

Use Learn mode when you want Claude to analyze a prompt/output pair (or a set of them)
and produce transferable, generalizable knowledge: a rule, a pattern, a causal explanation.
In Learn mode Claude should optimize for insight and applicability, not for summarizing
what already happened.

**When to use Learn mode:**
- You have a prompt that worked unexpectedly well; extract the technique
- You have a before/after pair of prompts; extract what the revision did mechanically
- You are building a guide entry from observed behavior; get the canonical rule

**Define the output audience** (`foundation-audience.md`): knowledge extracted for a
senior prompt engineer differs from knowledge extracted for a new team member. Name the
audience so Claude calibrates depth and vocabulary.

**Incorrect (no mode; output is a description, not a transferable rule):**

```text
Here is a prompt that worked well. What do you think?
<prompt>...</prompt>
Output: <output>...</output>
```

**Correct (Learn mode; audience defined; output format specified):**

```text
MODE: Learn

Analyze the prompt/output pair below. Extract the single most important technique that
accounts for the quality of the output. Express it as a reusable rule: one sentence
stating what to do, one sentence stating why it works, and one counter-example showing
what would happen without it.

Audience: mid-level engineers writing their first agent prompts.

<prompt>...</prompt>
<output>...</output>
```

Reference: `foundation-audience.md` for audience-definition guidance used in Learn mode outputs.
