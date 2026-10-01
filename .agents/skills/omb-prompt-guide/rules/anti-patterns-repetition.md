---
title: Do Not Restate the Same Rule Multiple Times
impact: MEDIUM
impactDescription: Reduces prompt token cost and eliminates precedence confusion from contradictory restatements
tags: anti-patterns, repetition, redundancy, clarity
---

## Do Not Restate the Same Rule Multiple Times

Restating the same instruction in multiple places does not reinforce it -- it raises the
risk that the two restatements differ subtly, creating an implicit conflict. It also
inflates prompt length, consuming tokens that could carry new information.

**Why this is harmful:**
- Two restatements that differ even slightly ("never modify X" / "do not modify X unless
  required") create ambiguity about which applies when.
- Repeated rules add no additional constraint weight in practice; Claude does not count
  repetitions as votes.
- Redundant instructions push other content deeper into the context where it may receive
  less attention.

**Diagnosis signal:** If you can grep your prompt for the same keyword (e.g., "confirm",
"do not", "must") and find it in 3+ distinct rules, audit for overlap.

**Incorrect (the no-delete constraint appears three times with slight variation):**

```text
Do not delete any files.
...
Always preserve existing files; never remove them.
...
File deletion is not allowed in this workflow.
```

**Correct (stated once, unambiguously):**

```text
Do not delete files. If a file needs replacing, write the replacement first, then confirm
with the user before removing the old version.
```

Reference: `anti-patterns-over-triggering.md` for the related pattern of stacking emphasis
markers (CRITICAL/MUST/NEVER) instead of writing once with precision.
