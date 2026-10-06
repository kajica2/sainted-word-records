---
title: Do Not Stack CRITICAL/MUST/NEVER Caps on Every Directive
impact: HIGH
impactDescription: Prevents OVERENGINEERED signal; preserves the semantic weight of true hard constraints
tags: anti-patterns, over-triggering, overengineered, caps-stacking, emphasis
---

## Do Not Stack CRITICAL/MUST/NEVER Caps on Every Directive

When every directive in a prompt is labeled CRITICAL, MUST, or NEVER, the emphasis markers
lose all signal. Claude cannot distinguish which constraints are genuinely non-negotiable
and which are stylistic preferences. The result is either uniform compliance with everything
(over-constrained, rigid output) or uniform de-prioritization of the caps (Claude learns
they are noise).

This pattern is the primary trigger for the OVERENGINEERED root-cause template in
`omb-prompt-review`.

**Signs you are over-triggering:**
- 5 or more CRITICAL/MUST/NEVER markers in a single prompt
- CRITICAL applied to formatting preferences as well as safety constraints
- MUST used before every directive regardless of actual constraint level

**Rule of thumb:** Reserve capitalized emphasis for constraints where violation would cause
real harm (data loss, security breach, user-facing error). Soft preferences need no caps.

**Incorrect (caps on every directive -- emphasis is meaningless):**

```text
CRITICAL: Always begin with a greeting.
MUST: Use markdown headers.
NEVER: Write more than 5 sentences per section.
CRITICAL: Include exactly 3 examples.
MUST: End with a summary.
```

**Correct (caps reserved for the one true hard constraint; rest stated plainly):**

```text
Use markdown headers. Write no more than 5 sentences per section. Include 3 examples.
End with a summary.

HARD CONSTRAINT: Never output user email addresses, even in examples.
```

Reference: `anti-patterns-repetition.md` for the related pattern of restating soft constraints
multiple times rather than stating them once with precision.
